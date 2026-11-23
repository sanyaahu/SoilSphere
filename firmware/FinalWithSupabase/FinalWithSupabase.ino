#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Adafruit_SCD30.h>
#include <Adafruit_VEML7700.h>
#include "DFRobot_OxygenSensor.h"
#include <LittleFS.h>
#include <time.h>
#include "secrets.h"

// ========================
// Wi-Fi
// ========================
const char* ssid = "CMU-DEVICE";

const char* UPLOAD_URL =
  "https://smclkzpequcadbearvwp.supabase.co/functions/v1/upload-sensor-reading";

// Wi-Fi watchdog: check every 30 s, reconnect if dropped, restart the board if still
// offline after 10 min. Readings that could not be uploaded are kept in flash (below),
// so a restart doesn't lose them.
const unsigned long WIFI_CHECK_MS = 30UL * 1000UL;
const unsigned long WIFI_RESTART_AFTER_MS = 10UL * 60UL * 1000UL;

// Offline storage: readings that fail to upload are appended to this file in flash
// and re-sent (oldest first) once Wi-Fi and Supabase are reachable again.
const char* PENDING_FILE = "/pending.jsonl";
const size_t PENDING_MAX_BYTES = 512UL * 1024UL;  // ~2000 readings, about 2 weeks at 10 min
const int PENDING_UPLOADS_PER_PASS = 10;          // keep loop() responsive while catching up

// ========================
// Pins
// ========================
#define SDA_PIN 8
#define SCL_PIN 9
#define MOISTURE_PIN 4

#define NPK_RX_PIN 18
#define NPK_TX_PIN 17
#define NPK_RTS_PIN 16

#define OXYGEN_ADDRESS ADDRESS_3
#define COLLECT_NUMBER 10

// ========================
// Pump motor
// ========================
// MOSFET driver "In" pin: HIGH = pump on, LOW = pump off (one direction only).
#define PUMP_PIN 7

// Auto-watering: pump runs while moisture is below the threshold, stops once it's at or above.
const float MOISTURE_THRESHOLD_PERCENT = 5.0f;
const int MOISTURE_FAULT_RAW = 3500;  // above this the probe is likely disconnected: don't pump

// Manual control from the app's hold-to-run button (Pump tab).
// The app re-sends /pump/on about every 0.5 s while the button is held. If those stop
// arriving (finger lifted but /pump/off lost, Wi-Fi drop, app closed), the pump stops
// by itself once the lease runs out.
const unsigned long MANUAL_LEASE_MS = 2000;

// ========================
// Moisture calibration
// ========================
// Raw ADC readings from our experiments:
//
// Dry soil:         2254 -> 0%
// Medium soil:      1776 -> 25%
// Wet soil:         1046 -> 50%
// Waterlogged soil:    0 -> 100%
//
// These percentages represent relative
// moisture, NOT volumetric water content.

const int MOISTURE_DRY = 2254;
const int MOISTURE_MEDIUM = 1776;
const int MOISTURE_WET = 1046;
const int MOISTURE_WATERLOGGED = 0;

// Convert raw ADC reading to moisture %
float calculateMoisturePercent(int raw) {

  // Drier than our dry calibration
  if (raw >= MOISTURE_DRY) {
    return 0.0f;
  }

  // Dry to medium: 0% - 25%
  if (raw >= MOISTURE_MEDIUM) {
    return 25.0f *
           (MOISTURE_DRY - raw) /
           (MOISTURE_DRY - MOISTURE_MEDIUM);
  }

  // Medium to wet: 25% - 50%
  if (raw >= MOISTURE_WET) {
    return 25.0f +
           25.0f *
           (MOISTURE_MEDIUM - raw) /
           (MOISTURE_MEDIUM - MOISTURE_WET);
  }

  // Wet to waterlogged: 50% - 100%
  if (raw > MOISTURE_WATERLOGGED) {
    return 50.0f +
           50.0f *
           (MOISTURE_WET - raw) /
           (MOISTURE_WET - MOISTURE_WATERLOGGED);
  }

  // Waterlogged or beyond
  return 100.0f;
}

// ========================
// Sensors
// ========================
Adafruit_SCD30 scd30;
Adafruit_VEML7700 veml;
DFRobot_OxygenSensor oxygen;

HardwareSerial npkSerial(1);
WebServer server(80);

// ========================
// Sensor readings
// ========================
float co2 = NAN;
float temperature = NAN;
float humidity = NAN;
float lux = NAN;
float oxygenLevel = NAN;

int moistureRaw = 0;
float moisturePercent = 0.0f;

// Pump state
volatile bool autoPumpRunning = false;
volatile bool manualPumpOn = false;
volatile unsigned long manualLeaseUntil = 0;

int nitrogen = -1;
int phosphorus = -1;
int potassium = -1;

bool scd30Connected = false;
bool vemlConnected = false;
bool oxygenConnected = false;
bool npkValid = false;

// ========================
// Timing
// ========================
unsigned long lastSensorUpdate = 0;
const unsigned long sensorInterval = 3000;

// Historical logging: one 30-second averaging window every 10 minutes.
const unsigned long HISTORY_INTERVAL_MS = 10UL * 60UL * 1000UL;
const unsigned long HISTORY_WINDOW_MS = 30UL * 1000UL;
unsigned long historyWindowStart = 0;
bool historyWindowActive = false;
bool freshSCD30Reading = false;

struct AverageAccumulator {
  double total = 0;
  unsigned int count = 0;
  void add(float value) {
    if (isfinite(value)) { total += value; count++; }
  }
  String json() const {
    return count ? String(total / count, 3) : String("null");
  }
};

AverageAccumulator avgCO2, avgTemp, avgHumidity, avgLux, avgOxygen;
AverageAccumulator avgMoistureRaw, avgMoisturePercent;
AverageAccumulator avgNitrogen, avgPhosphorus, avgPotassium;
unsigned int historySampleCount = 0;

void resetHistoryAverages() {
  avgCO2 = AverageAccumulator();
  avgTemp = AverageAccumulator();
  avgHumidity = AverageAccumulator();
  avgLux = AverageAccumulator();
  avgOxygen = AverageAccumulator();
  avgMoistureRaw = AverageAccumulator();
  avgMoisturePercent = AverageAccumulator();
  avgNitrogen = AverageAccumulator();
  avgPhosphorus = AverageAccumulator();
  avgPotassium = AverageAccumulator();
  historySampleCount = 0;
}

void collectHistorySample() {
  historySampleCount++;
  // SCD30 can retain an old value when dataReady() is false. Only average fresh data.
  if (freshSCD30Reading) {
    avgCO2.add(co2);
    avgTemp.add(temperature);
    avgHumidity.add(humidity);
  }
  if (vemlConnected) avgLux.add(lux);
  if (oxygenConnected) avgOxygen.add(oxygenLevel);
  if (moistureRaw <= MOISTURE_FAULT_RAW) {
    avgMoistureRaw.add((float)moistureRaw);
    avgMoisturePercent.add(moisturePercent);
  }
  if (npkValid) {
    avgNitrogen.add((float)nitrogen);
    avgPhosphorus.add((float)phosphorus);
    avgPotassium.add((float)potassium);
  }
}

// ========================
// Clock (NTP) for reading timestamps
// ========================
// Readings saved while offline are uploaded later, so each one carries the time it was
// measured. The clock is set from the internet once Wi-Fi connects and keeps running after.
bool clockIsSet() {
  return time(nullptr) > 1700000000;  // any time after Nov 2023 means NTP has synced
}

String isoTimestamp(time_t t) {
  struct tm utc;
  gmtime_r(&t, &utc);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(buf);
}

// ========================
// Uploading + offline storage
// ========================
// Returns the HTTP status, or a negative number if the request couldn't be sent.
int postReading(const String& json) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure client;
  // PROTOTYPE ONLY: TLS encryption without server certificate validation.
  // Replace with a trusted root CA certificate before production deployment.
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(5000);
  if (!http.begin(client, UPLOAD_URL)) return -2;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", SOILSPHERE_DEVICE_TOKEN);
  int status = http.POST(json);
  if (status < 200 || status >= 300) {
    Serial.printf("[history] Upload HTTP status: %d %s\n", status, http.getString().c_str());
  }
  http.end();
  return status;
}

// 4xx other than auth/rate-limit means Supabase rejected this reading itself; retrying
// would never succeed and would block everything queued behind it.
bool rejectedForGood(int status) {
  return status >= 400 && status < 500 && status != 401 && status != 403 &&
         status != 408 && status != 429;
}

void savePending(const String& json) {
  File f = LittleFS.open(PENDING_FILE, FILE_APPEND);
  if (!f) {
    Serial.println("[offline] Could not open storage - reading lost");
    return;
  }
  if (f.size() + json.length() + 1 > PENDING_MAX_BYTES) {
    f.close();
    Serial.println("[offline] Storage full - reading lost");
    return;
  }
  f.println(json);
  f.close();
  Serial.println("[offline] Saved reading to flash; will upload when back online");
}

bool hasPending() {
  if (!LittleFS.exists(PENDING_FILE)) return false;
  File f = LittleFS.open(PENDING_FILE, FILE_READ);
  bool any = f && f.size() > 0;
  if (f) f.close();
  return any;
}

// Re-sends up to PENDING_UPLOADS_PER_PASS saved readings, oldest first.
// Stops at the first temporary failure so the order is kept.
void uploadPending() {
  if (WiFi.status() != WL_CONNECTED || !hasPending()) return;

  File in = LittleFS.open(PENDING_FILE, FILE_READ);
  File out = LittleFS.open("/pending.tmp", FILE_WRITE);
  if (!in || !out) {
    if (in) in.close();
    if (out) out.close();
    return;
  }

  int sent = 0, attempts = 0;
  bool stopped = false;
  while (in.available()) {
    String line = in.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;
    if (stopped || attempts >= PENDING_UPLOADS_PER_PASS) {
      out.println(line);  // keep for the next pass
      continue;
    }
    attempts++;
    int status = postReading(line);
    if (status >= 200 && status < 300) {
      sent++;
    } else if (rejectedForGood(status)) {
      Serial.println("[offline] Supabase rejected a saved reading; skipping it");
    } else {
      out.println(line);
      stopped = true;  // offline or server problem: try again later
    }
  }
  in.close();
  out.close();
  LittleFS.remove(PENDING_FILE);
  LittleFS.rename("/pending.tmp", PENDING_FILE);
  if (sent > 0) Serial.printf("[offline] Uploaded %d saved reading(s)\n", sent);
}

void uploadHistoryAverages() {
  if (historySampleCount == 0) return;
  if (String(SOILSPHERE_DEVICE_TOKEN).startsWith("PASTE_")) {
    Serial.println("[history] Set SOILSPHERE_DEVICE_TOKEN in secrets.h before uploading");
    return;
  }

  String json = "{";
  json += "\"co2\":" + avgCO2.json();
  json += ",\"temperature\":" + avgTemp.json();
  json += ",\"humidity\":" + avgHumidity.json();
  json += ",\"lux\":" + avgLux.json();
  json += ",\"oxygen\":" + avgOxygen.json();
  json += ",\"moisture_raw\":" + avgMoistureRaw.json();
  json += ",\"moisture_percent\":" + avgMoisturePercent.json();
  json += ",\"nitrogen\":" + avgNitrogen.json();
  json += ",\"phosphorus\":" + avgPhosphorus.json();
  json += ",\"potassium\":" + avgPotassium.json();
  json += ",\"sample_count\":" + String(historySampleCount);
  // When the measurement happened. Without a synced clock (no Wi-Fi since boot) it's
  // omitted and Supabase stamps the reading with its upload time instead.
  if (clockIsSet()) json += ",\"recorded_at\":\"" + isoTimestamp(time(nullptr)) + "\"";
  json += "}";

  // Send any backlog first so readings arrive oldest-first.
  uploadPending();
  if (hasPending()) {  // still behind (or offline): queue this one after the backlog
    savePending(json);
    return;
  }
  int status = postReading(json);
  if (status >= 200 && status < 300) {
    Serial.printf("[history] Uploaded (HTTP %d)\n", status);
  } else if (rejectedForGood(status)) {
    Serial.println("[history] Supabase rejected this reading; not saving it");
  } else {
    savePending(json);
  }
}

// ========================
// Wi-Fi watchdog
// ========================
unsigned long lastWifiCheck = 0;
unsigned long wifiOfflineSince = 0;  // 0 = currently online

void checkWifi() {
  if (millis() - lastWifiCheck < WIFI_CHECK_MS) return;
  lastWifiCheck = millis();

  if (WiFi.status() == WL_CONNECTED) {
    if (wifiOfflineSince != 0) {
      Serial.print("[wifi] Reconnected, IP address: ");
      Serial.println(WiFi.localIP());
      wifiOfflineSince = 0;
    }
    uploadPending();  // catch up on anything saved while offline
    return;
  }

  if (wifiOfflineSince == 0) wifiOfflineSince = millis();
  unsigned long offlineFor = millis() - wifiOfflineSince;
  if (offlineFor >= WIFI_RESTART_AFTER_MS) {
    Serial.println("[wifi] Offline for 10 minutes - restarting the board");
    delay(200);
    ESP.restart();  // saved readings survive in flash
  }
  Serial.printf("[wifi] Offline for %lus - reconnecting\n", offlineFor / 1000);
  WiFi.disconnect();
  WiFi.begin(ssid);
}


// ========================
// Modbus CRC
// ========================
uint16_t modbusCRC(const uint8_t *data, int length) {
  uint16_t crc = 0xFFFF;

  for (int i = 0; i < length; i++) {
    crc ^= data[i];

    for (int j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >> 1) ^ 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }

  return crc;
}

// ========================
// Read NPK via RS485
// ========================
bool readNPK(uint16_t &n, uint16_t &p, uint16_t &k) {
  uint8_t request[] = {
    0x01, 0x03, 0x00, 0x1E,
    0x00, 0x03, 0x00, 0x00
  };

  uint16_t crc = modbusCRC(request, 6);
  request[6] = crc & 0xFF;
  request[7] = crc >> 8;

  while (npkSerial.available()) {
    npkSerial.read();
  }

  digitalWrite(NPK_RTS_PIN, HIGH);
  delayMicroseconds(200);

  npkSerial.write(request, sizeof(request));
  npkSerial.flush();

  delayMicroseconds(200);
  digitalWrite(NPK_RTS_PIN, LOW);

  uint8_t response[11];
  int count = 0;

  unsigned long start = millis();

  while (count < 11 && millis() - start < 1000) {
    if (npkSerial.available()) {
      response[count++] = npkSerial.read();
    }
    delay(1);
  }

  if (count != 11) {
    return false;
  }

  if (response[0] != 0x01 ||
      response[1] != 0x03 ||
      response[2] != 0x06) {
    return false;
  }

  uint16_t receivedCRC =
    response[9] | (response[10] << 8);

  if (modbusCRC(response, 9) != receivedCRC) {
    return false;
  }

  n = (response[3] << 8) | response[4];
  p = (response[5] << 8) | response[6];
  k = (response[7] << 8) | response[8];

  return true;
}

// ========================
// Update all sensors
// ========================
void updateSensors() {
  freshSCD30Reading = false;
  Serial.println();
  Serial.println("===== SoilSphere Readings =====");

  // CO2, temperature, humidity
  if (scd30Connected && scd30.dataReady()) {
    if (scd30.read()) {
      freshSCD30Reading = true;
      co2 = scd30.CO2;
      temperature = scd30.temperature;
      humidity = scd30.relative_humidity;
    }
  }

  Serial.print("CO2: ");
  Serial.print(co2, 2);
  Serial.println(" ppm");

  Serial.print("Temperature: ");
  Serial.print(temperature, 2);
  Serial.println(" C");

  Serial.print("Humidity: ");
  Serial.print(humidity, 2);
  Serial.println(" %");

  // Light
  if (vemlConnected) {
    float newLux = veml.readLux();

    if (isfinite(newLux) && newLux >= 0) {
      lux = newLux;
    } else {
      lux = NAN;
    }
  }

  Serial.print("Light: ");
  Serial.print(lux, 2);
  Serial.println(" lux");

  // Oxygen
  if (oxygenConnected) {
    float newOxygen =
      oxygen.getOxygenData(COLLECT_NUMBER);

    if (isfinite(newOxygen) &&
        newOxygen >= 0 &&
        newOxygen <= 25) {
      oxygenLevel = newOxygen;
    } else {
      oxygenLevel = NAN;
    }
  }

  Serial.print("Oxygen: ");
  Serial.print(oxygenLevel, 2);
  Serial.println(" %");

  // ========================
  // Soil moisture (UPDATED)
  // ========================
  moistureRaw = analogRead(MOISTURE_PIN);

  moisturePercent =
    calculateMoisturePercent(moistureRaw);

  Serial.print("Soil Moisture Raw: ");
  Serial.println(moistureRaw);

  Serial.print("Soil Moisture: ");
  Serial.print(moisturePercent, 1);
  Serial.println(" %");

  // NPK with up to 3 attempts
  uint16_t n, p, k;
  bool success = false;

  for (int attempt = 1; attempt <= 3; attempt++) {
    if (readNPK(n, p, k)) {
      success = true;
      break;
    }

    Serial.print("NPK retry ");
    Serial.println(attempt);
    delay(300);
  }

  if (success) {
    nitrogen = n;
    phosphorus = p;
    potassium = k;
    npkValid = true;
  } else {
    npkValid = false;
    nitrogen = -1;
    phosphorus = -1;
    potassium = -1;
  }

  Serial.print("Nitrogen: ");
  if (npkValid) Serial.print(nitrogen);
  else Serial.print("N/A");
  Serial.println(" mg/kg");

  Serial.print("Phosphorus: ");
  if (npkValid) Serial.print(phosphorus);
  else Serial.print("N/A");
  Serial.println(" mg/kg");

  Serial.print("Potassium: ");
  if (npkValid) Serial.print(potassium);
  else Serial.print("N/A");
  Serial.println(" mg/kg");

  Serial.println("===============================");
}

// ========================
// JSON API
// ========================
void handleSensors() {
  String json = "{";

  json += "\"co2\":";
  json += isfinite(co2) ? String(co2, 2) : "null";

  json += ",\"temperature\":";
  json += isfinite(temperature) ? String(temperature, 2) : "null";

  json += ",\"humidity\":";
  json += isfinite(humidity) ? String(humidity, 2) : "null";

  json += ",\"lux\":";
  json += isfinite(lux) ? String(lux, 2) : "null";

  json += ",\"oxygen\":";
  json += isfinite(oxygenLevel) ? String(oxygenLevel, 2) : "null";

  // Moisture raw reading
  json += ",\"moistureRaw\":";
  json += String(moistureRaw);

  // Moisture percentage (NEW)
  json += ",\"moisturePercent\":";
  json += String(moisturePercent, 1);

  json += ",\"pumpRunning\":";
  json += (autoPumpRunning || manualPumpOn) ? "true" : "false";

  json += ",\"nitrogen\":";
  json += npkValid ? String(nitrogen) : "null";

  json += ",\"phosphorus\":";
  json += npkValid ? String(phosphorus) : "null";

  json += ",\"potassium\":";
  json += npkValid ? String(potassium) : "null";

  json += "}";

  server.send(200, "application/json", json);
}

// ========================
// Pump control
// ========================
// The pump is on if either the moisture rule or the app's button wants it on.
void applyPump() {
  digitalWrite(PUMP_PIN, (autoPumpRunning || manualPumpOn) ? HIGH : LOW);
}

// Called after each sensor update (every 3 s).
void checkAutoWatering() {
  bool wantOn = moistureRaw <= MOISTURE_FAULT_RAW &&
                moisturePercent < MOISTURE_THRESHOLD_PERCENT;
  if (wantOn == autoPumpRunning) return;  // no change, nothing to print

  autoPumpRunning = wantOn;
  applyPump();
  if (wantOn) {
    Serial.printf("[pump] moisture %.1f%% below %.0f%% - pump ON\n",
                  moisturePercent, MOISTURE_THRESHOLD_PERCENT);
  } else if (moistureRaw > MOISTURE_FAULT_RAW) {
    Serial.println("[pump] moisture probe reading out of range - pump OFF");
  } else {
    Serial.printf("[pump] moisture %.1f%% reached %.0f%% - pump OFF\n",
                  moisturePercent, MOISTURE_THRESHOLD_PERCENT);
  }
}

// Stops a manual run if the app stops renewing it.
// Separate task so the lease is enforced even while loop() is busy reading sensors.
void manualPumpWatchdogTask(void *param) {
  for (;;) {
    if (manualPumpOn && (long)(millis() - manualLeaseUntil) >= 0) {
      manualPumpOn = false;
      applyPump();
      Serial.println("[pump] manual: no signal from app - released");
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

void sendPumpState(int code) {
  String json = "{\"pumpRunning\":";
  json += (autoPumpRunning || manualPumpOn) ? "true" : "false";
  json += ",\"manual\":";
  json += manualPumpOn ? "true" : "false";
  json += ",\"autoWatering\":";
  json += autoPumpRunning ? "true" : "false";
  json += "}";
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(code, "application/json", json);
}

// POST /pump/on - start (or keep running) the pump for another MANUAL_LEASE_MS.
void handlePumpOn() {
  manualLeaseUntil = millis() + MANUAL_LEASE_MS;
  if (!manualPumpOn) {
    manualPumpOn = true;
    applyPump();
    Serial.println("[pump] manual ON");
  }
  sendPumpState(200);
}

// POST /pump/off - release the button. The pump keeps running only if moisture is below the threshold.
void handlePumpOff() {
  if (manualPumpOn) {
    manualPumpOn = false;
    applyPump();
    Serial.println("[pump] manual OFF");
  }
  sendPumpState(200);
}

// GET /pump - current state.
void handlePumpStatus() {
  sendPumpState(200);
}

// ========================
// Setup
// ========================
void setup() {
  // Pump: hold it off from the very first moment
  digitalWrite(PUMP_PIN, LOW);
  pinMode(PUMP_PIN, OUTPUT);

  Serial.begin(115200);
  delay(2000);

  Serial.println("Starting SoilSphere...");

  // I2C
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(50000);

  // Moisture
  analogReadResolution(12);
  pinMode(MOISTURE_PIN, INPUT);

  // SCD30
  if (scd30.begin()) {
    scd30Connected = true;
    Serial.println("SCD30 connected!");
  } else {
    Serial.println("ERROR: SCD30 not detected!");
  }

  // VEML7700
  if (veml.begin(&Wire)) {
    vemlConnected = true;
    Serial.println("VEML7700 connected!");
  } else {
    Serial.println("ERROR: VEML7700 not detected!");
  }

  // Oxygen
  if (oxygen.begin(OXYGEN_ADDRESS)) {
    oxygenConnected = true;
    Serial.println("O2 sensor connected!");
  } else {
    Serial.println("ERROR: O2 sensor not detected!");
  }

  // NPK RS485
  pinMode(NPK_RTS_PIN, OUTPUT);
  digitalWrite(NPK_RTS_PIN, LOW);

  npkSerial.begin(
    9600,
    SERIAL_8N1,
    NPK_RX_PIN,
    NPK_TX_PIN
  );

  Serial.println("NPK RS485 initialized!");

  // Flash storage for readings saved while offline (formats on first use)
  if (LittleFS.begin(true)) {
    Serial.println(hasPending() ? "[offline] Found saved readings from before the restart"
                                : "Offline storage ready");
  } else {
    Serial.println("ERROR: flash storage unavailable - offline readings will be lost");
  }

  // Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid);
  // UTC clock from the internet, used to timestamp readings. Syncs in the background
  // whenever Wi-Fi is up.
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  Serial.print("Connecting to Wi-Fi");

  unsigned long wifiStart = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - wifiStart < 20000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("Wi-Fi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("Wi-Fi connection failed.");
  }

  server.on("/sensors", HTTP_GET, handleSensors);
  server.on("/pump", HTTP_GET, handlePumpStatus);
  server.on("/pump/on", HTTP_POST, handlePumpOn);
  server.on("/pump/off", HTTP_POST, handlePumpOff);
  server.begin();

  xTaskCreate(manualPumpWatchdogTask, "pumpWatchdog", 2048, NULL, 2, NULL);

  Serial.println("SoilSphere web server started!");

  updateSensors();
  lastSensorUpdate = millis();
  historyWindowStart = millis();
  historyWindowActive = true;
  resetHistoryAverages();
  collectHistorySample();
  Serial.println("[history] Started first 30-second averaging window");
}

// ========================
// Main loop
// ========================
void loop() {
  server.handleClient();
  checkWifi();

  if (millis() - lastSensorUpdate >= sensorInterval) {
    lastSensorUpdate = millis();
    updateSensors();
    checkAutoWatering();
    if (historyWindowActive &&
        millis() - historyWindowStart < HISTORY_WINDOW_MS) {
      collectHistorySample();
    }
  }

  unsigned long now = millis();
  if (historyWindowActive && now - historyWindowStart >= HISTORY_WINDOW_MS) {
    historyWindowActive = false;
    Serial.printf("[history] Window complete (%u sensor updates)\n", historySampleCount);
    uploadHistoryAverages();
  }
  if (!historyWindowActive && now - historyWindowStart >= HISTORY_INTERVAL_MS) {
    historyWindowStart = now;
    resetHistoryAverages();
    historyWindowActive = true;
    Serial.println("[history] Started 30-second averaging window");
  }
}


#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Adafruit_SCD30.h>
#include <Adafruit_VEML7700.h>
#include "DFRobot_OxygenSensor.h"

// ========================
// Wi-Fi
// ========================
const char* ssid = "CMU-DEVICE";

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

// Auto-watering: run the pump for PUMP_RUN_MS whenever moisture drops below the threshold.
const float MOISTURE_THRESHOLD_PERCENT = 30.0f;
const unsigned long PUMP_RUN_MS = 3000;        // run for 3 seconds
// Water takes time to soak down to the probe. Without this wait the next reading
// (3 s later) still looks dry and the pump would keep re-triggering and flood the pot.
const unsigned long PUMP_COOLDOWN_MS = 60000;  // wait 60 s after watering before re-checking
const int DRY_READINGS_REQUIRED = 2;           // ignore a single noisy low reading
const int MAX_WATERINGS_PER_HOUR = 6;          // hard cap if the probe is dry/out of soil
const int MOISTURE_FAULT_RAW = 3500;           // above this, assume the probe is disconnected

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
unsigned long lastWateringEnded = 0;
bool hasWatered = false;
int dryReadingCount = 0;
unsigned long wateringTimes[MAX_WATERINGS_PER_HOUR] = {0};
int wateringIndex = 0;

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
  Serial.println();
  Serial.println("===== SoilSphere Readings =====");

  // CO2, temperature, humidity
  if (scd30Connected && scd30.dataReady()) {
    if (scd30.read()) {
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
void pumpOn() {
  digitalWrite(PUMP_PIN, HIGH);
}

void pumpOff() {
  digitalWrite(PUMP_PIN, LOW);
}

// Auto-watering run as its own task, so it lasts exactly PUMP_RUN_MS even while
// updateSensors() is blocked on slow NPK retries, and the web server keeps working.
void autoWateringTask(void *param) {
  Serial.printf("[pump] auto ON for %lu ms\n", PUMP_RUN_MS);
  pumpOn();
  vTaskDelay(pdMS_TO_TICKS(PUMP_RUN_MS));
  if (!manualPumpOn) pumpOff();
  Serial.println("[pump] auto OFF");
  lastWateringEnded = millis();
  autoPumpRunning = false;
  vTaskDelete(NULL);
}

int wateringsInLastHour() {
  int count = 0;
  for (int i = 0; i < MAX_WATERINGS_PER_HOUR; i++) {
    if (wateringTimes[i] != 0 && millis() - wateringTimes[i] < 3600000UL) count++;
  }
  return count;
}

// Called after each sensor update.
void checkAutoWatering() {
  if (autoPumpRunning || manualPumpOn) return;  // never start while someone is watering by hand

  if (moistureRaw > MOISTURE_FAULT_RAW) {
    dryReadingCount = 0;
    Serial.println("[pump] moisture probe reading out of range - not watering");
    return;
  }

  if (moisturePercent >= MOISTURE_THRESHOLD_PERCENT) {
    dryReadingCount = 0;
    return;
  }

  dryReadingCount++;
  if (dryReadingCount < DRY_READINGS_REQUIRED) return;

  if (hasWatered && millis() - lastWateringEnded < PUMP_COOLDOWN_MS) {
    Serial.println("[pump] dry, but waiting for the last watering to soak in");
    return;
  }

  if (wateringsInLastHour() >= MAX_WATERINGS_PER_HOUR) {
    Serial.println("[pump] hourly watering limit reached - check the probe and the pot");
    return;
  }

  Serial.printf("[pump] moisture %.1f%% < %.0f%% - watering\n",
                moisturePercent, MOISTURE_THRESHOLD_PERCENT);
  autoPumpRunning = true;
  hasWatered = true;
  dryReadingCount = 0;
  wateringTimes[wateringIndex] = millis();
  wateringIndex = (wateringIndex + 1) % MAX_WATERINGS_PER_HOUR;
  xTaskCreate(autoWateringTask, "autoWatering", 4096, NULL, 1, NULL);
}

// Stops a manual run if the app stops renewing it.
// Separate task so the lease is enforced even while loop() is busy reading sensors.
void manualPumpWatchdogTask(void *param) {
  for (;;) {
    if (manualPumpOn && (long)(millis() - manualLeaseUntil) >= 0) {
      manualPumpOn = false;
      if (!autoPumpRunning) pumpOff();
      Serial.println("[pump] manual: no signal from app - stopped");
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
  if (autoPumpRunning) {  // a 3-second auto-watering run owns the pump right now
    sendPumpState(409);
    return;
  }
  manualLeaseUntil = millis() + MANUAL_LEASE_MS;
  if (!manualPumpOn) {
    manualPumpOn = true;
    pumpOn();
    Serial.println("[pump] manual ON");
  }
  sendPumpState(200);
}

// POST /pump/off - stop immediately.
void handlePumpOff() {
  if (manualPumpOn) {
    manualPumpOn = false;
    if (!autoPumpRunning) pumpOff();
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

  // Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid);

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
}

// ========================
// Main loop
// ========================
void loop() {
  server.handleClient();

  if (millis() - lastSensorUpdate >= sensorInterval) {
    lastSensorUpdate = millis();
    updateSensors();
    checkAutoWatering();
  }
}

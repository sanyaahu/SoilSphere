
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

  // Soil moisture (RAW)
  moistureRaw = analogRead(MOISTURE_PIN);

  Serial.print("Soil Moisture Raw: ");
  Serial.println(moistureRaw);

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

  json += ",\"moistureRaw\":";
  json += String(moistureRaw);

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
// Setup
// ========================
void setup() {
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
  server.begin();

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
  }
}

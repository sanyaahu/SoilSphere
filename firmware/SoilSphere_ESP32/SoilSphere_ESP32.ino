
#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Adafruit_SCD30.h>
#include <Adafruit_VEML7700.h>
#include "DFRobot_OxygenSensor.h"

// Wi-Fi
const char* ssid = "CMU-DEVICE";

// Pins
#define SDA_PIN 8
#define SCL_PIN 9
#define MOISTURE_PIN 4

// Oxygen settings
#define OXYGEN_ADDRESS ADDRESS_3
#define COLLECT_NUMBER 10

// Sensors
Adafruit_SCD30 scd30;
Adafruit_VEML7700 veml;
DFRobot_OxygenSensor oxygen;

WebServer server(80);

// Sensor values
float co2 = NAN;
float temperature = NAN;
float humidity = NAN;
float lux = NAN;
float oxygenLevel = NAN;
int moistureRaw = 0;

// Connection status
bool scd30Connected = false;
bool vemlConnected = false;
bool oxygenConnected = false;

// Timing
unsigned long lastSensorUpdate = 0;
const unsigned long sensorInterval = 2000;

// Read all sensors
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
      Serial.print("INVALID oxygen reading: ");
      Serial.println(newOxygen);
    }
  }

  Serial.print("Oxygen: ");
  Serial.print(oxygenLevel, 2);
  Serial.println(" %");

  // Soil moisture - RAW ONLY
  moistureRaw = analogRead(MOISTURE_PIN);

  Serial.print("Soil Moisture Raw: ");
  Serial.println(moistureRaw);

  Serial.println("===============================");
}

// API endpoint
void handleSensors() {
  String json = "{";

  json += "\"co2\":";
  json += isfinite(co2) ? String(co2, 2) : "null";

  json += ",\"temperature\":";
  json += isfinite(temperature)
    ? String(temperature, 2) : "null";

  json += ",\"humidity\":";
  json += isfinite(humidity)
    ? String(humidity, 2) : "null";

  json += ",\"lux\":";
  json += isfinite(lux) ? String(lux, 2) : "null";

  json += ",\"oxygen\":";
  json += isfinite(oxygenLevel)
    ? String(oxygenLevel, 2) : "null";

  json += ",\"moistureRaw\":";
  json += String(moistureRaw);

  json += "}";

  server.send(200, "application/json", json);
}

// Setup
void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println("Starting SoilSphere...");

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(50000);

  analogReadResolution(12);
  pinMode(MOISTURE_PIN, INPUT);

  if (scd30.begin()) {
    scd30Connected = true;
    Serial.println("SCD30 connected!");
  } else {
    Serial.println("ERROR: SCD30 not detected!");
  }

  if (veml.begin(&Wire)) {
    vemlConnected = true;
    Serial.println("VEML7700 connected!");
  } else {
    Serial.println("ERROR: VEML7700 not detected!");
  }

  if (oxygen.begin(OXYGEN_ADDRESS)) {
    oxygenConnected = true;
    Serial.println("O2 sensor connected!");
  } else {
    Serial.println("ERROR: O2 sensor not detected!");
  }

  // Connect Wi-Fi
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

// Main loop
void loop() {
  server.handleClient();

  if (millis() - lastSensorUpdate >= sensorInterval) {
    lastSensorUpdate = millis();
    updateSensors();
  }
}

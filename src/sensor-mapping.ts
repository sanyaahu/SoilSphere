import type { SensorReading } from './data';

function measured(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function mapEsp32Reading(input: unknown, timestamp = new Date().toISOString()): SensorReading | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const sensor = input as Record<string, unknown>;
  const reading: SensorReading = {
    deviceId: 'SoilSphere-ESP32', timestamp,
    nitrogenMgKg: measured(sensor.nitrogen, 0, 2999),
    phosphorusMgKg: measured(sensor.phosphorus, 0, 2999),
    potassiumMgKg: measured(sensor.potassium, 0, 2999),
    moistureRaw: measured(sensor.moistureRaw, 0, 4095), moisturePercent: measured(sensor.moisturePercent, 0, 100),
    temperatureC: measured(sensor.temperature, -40, 100),
    humidityPercent: measured(sensor.humidity, 0, 100),
    lightLux: measured(sensor.lux, 0, 100000),
    co2Ppm: measured(sensor.co2, 0, 10000),
    oxygenPercent: measured(sensor.oxygen, 0, 25), batteryPercent: null,
  };
  return Object.entries(reading).some(([key, value]) => !['deviceId', 'timestamp'].includes(key) && value !== null) ? reading : null;
}

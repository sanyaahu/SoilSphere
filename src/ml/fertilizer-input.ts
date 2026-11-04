import type { SensorReading } from '../data';
import type { ModelInput } from './types';

/** The SCD30 supplies air temperature and relative humidity, not fertilizer CO2 features. */
export function fertilizerSensorInput(reading: SensorReading, soilType: string): ModelInput {
  return {
    nitrogen: reading.nitrogenMgKg,
    phosphorus: reading.phosphorusMgKg,
    potassium: reading.potassiumMgKg,
    moisture: reading.moisturePercent,
    temperature: reading.temperatureC ?? null,
    humidity: reading.humidityPercent ?? null,
    soil_type: soilType,
  };
}

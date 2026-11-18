import type { SensorReading } from '../data';
import type { ModelInput, MoistureCalibration } from './types';

export const healthLabels: Record<string, string> = {
  healthy: 'Healthy', could_be_better: 'Could be better', unhealthy: 'Unhealthy',
};

export const healthExamples: { name: string; input: ModelInput; note: string }[] = [
  { name: 'Moderate conditions', input: { moisture: 55, nitrogen: 125, phosphorus: 175, potassium: 402 }, note: 'Recorded example: 1 tbsp fertilizer, 55% moisture.' },
  { name: 'Dry corner', input: { moisture: 23.5, nitrogen: 5, phosphorus: 9, potassium: 22 }, note: 'Recorded corner example: control fertilizer treatment, dry pot.' },
  { name: 'Waterlogged corner', input: { moisture: 100, nitrogen: 150, phosphorus: 211, potassium: 482 }, note: 'Recorded corner example: control fertilizer treatment, waterlogged pot.' },
  { name: 'Higher nutrient edge', input: { moisture: 56, nitrogen: 277, phosphorus: 387, potassium: 884 }, note: 'Measured NPK from the bottom edge (3 tbsp treatment); 56% moisture is synthetic.' },
  { name: 'Middle edge', input: { moisture: 40, nitrogen: 23, phosphorus: 34, potassium: 78 }, note: 'Recorded top-edge example: control fertilizer treatment, control moisture column.' },
  { name: 'Soil oxygen example', input: { moisture: 82, nitrogen: 222, phosphorus: 311, potassium: 711, oxygen: 20.45 }, note: 'New measured interior example: 1 tbsp fertilizer, 3 tbsp water; oxygen measured within soil.' },
];

export function healthSensorInput(reading: SensorReading, calibration: MoistureCalibration | null, demo: boolean, stale: boolean): ModelInput {
  if (demo) throw new Error('Connect your sensor to compare a live reading. Examples work without a device.');
  if (stale) throw new Error('Connection lost. Refresh your sensor before comparing.');
  if (reading.moistureCalibrationId && (!calibration || calibration.deviceId !== reading.deviceId || reading.moistureCalibrationId !== calibration.id)) {
    throw new Error('The saved moisture calibration does not match this reading. Refresh the sensor or check Device.');
  }
  if (reading.moisturePercent == null) {
    throw new Error('Waiting for a moisture percentage from the device. If it only sends raw ADC readings, calibrate moisture in Device.');
  }
  const input: ModelInput = { moisture: reading.moisturePercent, nitrogen: reading.nitrogenMgKg, phosphorus: reading.phosphorusMgKg, potassium: reading.potassiumMgKg, oxygen: reading.oxygenPercent };
  for (const [feature, value] of Object.entries(input)) {
    if (feature === 'oxygen' && value == null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Waiting for ${feature === 'moisture' ? 'calibrated moisture' : feature}. No example values are substituted.`);
    if (value < 0 || (feature === 'moisture' && value > 100)) throw new Error(feature === 'moisture' ? 'Moisture is outside the calibrated 0-100% scale. Check probe contact and calibration.' : `${feature} must be zero or greater.`);
    if (feature === 'oxygen' && value > 100) throw new Error('Oxygen must be between 0 and 100%.');
  }
  return input;
}

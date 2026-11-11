import type { SensorReading } from '../data';
import type { ModelInput, MoistureCalibration } from './types';

export const healthLabels: Record<string, string> = {
  healthy: 'Healthy', could_be_better: 'Could be better', unhealthy: 'Unhealthy',
};

export const healthExamples: { name: string; input: ModelInput; note: string }[] = [
  { name: 'Moderate conditions', input: { moisture: 55, nitrogen: 125, phosphorus: 175, potassium: 402 }, note: 'Recorded example: 1 tbsp fertilizer, 55% moisture.' },
  { name: 'Dry soil', input: { moisture: 25, nitrogen: 6, phosphorus: 11, potassium: 25 }, note: 'Recorded example: deliberately dry pot, 25% moisture.' },
  { name: 'Waterlogged', input: { moisture: 100, nitrogen: 180, phosphorus: 252, potassium: 576 }, note: 'Recorded example: waterlogged pot, 100% moisture.' },
  { name: 'Higher nutrients', input: { moisture: 56, nitrogen: 277, phosphorus: 387, potassium: 884 }, note: 'Measured NPK from the 3 tbsp treatment; 56% moisture is synthetic.' },
  { name: 'Intermediate conditions', input: { moisture: 65, nitrogen: 93, phosphorus: 131, potassium: 300 }, note: 'Recorded example: control fertilizer treatment, 65% moisture.' },
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
  const input: ModelInput = { moisture: reading.moisturePercent, nitrogen: reading.nitrogenMgKg, phosphorus: reading.phosphorusMgKg, potassium: reading.potassiumMgKg };
  for (const [feature, value] of Object.entries(input)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Waiting for ${feature === 'moisture' ? 'calibrated moisture' : feature}. No example values are substituted.`);
    if (value < 0 || (feature === 'moisture' && value > 100)) throw new Error(feature === 'moisture' ? 'Moisture is outside the calibrated 0-100% scale. Check probe contact and calibration.' : `${feature} must be zero or greater.`);
  }
  return input;
}

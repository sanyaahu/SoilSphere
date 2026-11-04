import type { SensorReading } from '../data';
import type { MoistureCalibration } from './types';

export function parseReference(text: string): number[] {
  if (!text.trim()) throw new Error('Enter at least three settled readings per reference.');
  const parts = text.split(',').map(value => value.trim());
  if (parts.some(value => !value)) throw new Error('Separate actual readings with commas; leave no empty values.');
  const values = parts.map(Number);
  if (values.length < 3 || values.some(value => !Number.isFinite(value) || value < 0 || value > 4095)) throw new Error('Enter at least three raw ADC readings from 0 to 4095 per reference.');
  return values;
}

export function createCalibration(dryText: string, wetText: string, deviceId: string, reference: string): MoistureCalibration {
  const dry = parseReference(dryText), wet = parseReference(wetText);
  if (!deviceId.trim() || !reference.trim()) throw new Error('Describe the device and wet-soil reference.');
  if (!(Math.max(...dry) < Math.min(...wet) || Math.max(...wet) < Math.min(...dry))) throw new Error('Dry and wet ranges overlap. Let the probe settle and repeat.');
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
  };
  return { version: 1, id: `relative-v1-${Date.now()}`, deviceId, dryRaw: median(dry), wetRaw: median(wet), dryReadings: dry, wetReadings: wet, reference: reference.trim() };
}

export function relativeMoisture(raw: number, calibration: MoistureCalibration): number {
  const percent = 100 * (raw - calibration.dryRaw) / (calibration.wetRaw - calibration.dryRaw);
  if (!Number.isFinite(percent)) throw new Error('Invalid moisture calibration.');
  return percent;
}

export function calibratedReading(reading: SensorReading, calibration: MoistureCalibration | null): SensorReading {
  if (!calibration || calibration.deviceId !== reading.deviceId || reading.moistureRaw == null) return reading;
  return { ...reading, moisturePercent: relativeMoisture(reading.moistureRaw, calibration), moistureCalibrationId: calibration.id };
}

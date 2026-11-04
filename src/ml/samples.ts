import type { SensorReading } from '../data';
import type { MoistureCalibration, ModelInput } from './types';

export type SampleDetails = {
  sampleId: string;
  condition: string;
  label: '' | 'healthy' | 'unhealthy';
  labelBasis: string;
  split: 'unassigned' | 'train' | 'test';
};
export type TrainingSample = SampleDetails & {
  id: string;
  reading: SensorReading;
  calibration: MoistureCalibration | null;
};

export function makeSample(reading: SensorReading, details: SampleDetails, calibration: MoistureCalibration | null, live: boolean, stale: boolean): TrainingSample {
  if (!live || stale) throw new Error('Connect the sensor and refresh before saving a real sample. Preview or stale readings cannot be training samples.');
  if (!details.sampleId.trim() || !details.condition.trim()) throw new Error('Enter a pot ID and describe its treatment.');
  if (details.label && !details.labelBasis.trim()) throw new Error('Describe the reference test or assessment supporting this health label.');
  if ([reading.nitrogenMgKg, reading.phosphorusMgKg, reading.potassiumMgKg, reading.moistureRaw].every(value => value == null)) throw new Error('No NPK or moisture measurement is available to save.');
  return { ...details, sampleId: details.sampleId.trim(), condition: details.condition.trim(), labelBasis: details.labelBasis.trim(),
    id: `${reading.deviceId}/${reading.timestamp}/${details.sampleId.trim()}`, reading: { ...reading },
    calibration: calibration?.deviceId === reading.deviceId ? calibration : null };
}

export function sensorModelInput(reading: SensorReading): ModelInput {
  return { temperature: reading.temperatureC, humidity: reading.humidityPercent,
    moisture: reading.moisturePercent, moisture_raw: reading.moistureRaw,
    nitrogen: reading.nitrogenMgKg, phosphorus: reading.phosphorusMgKg, potassium: reading.potassiumMgKg,
    co2: reading.co2Ppm, oxygen: reading.oxygenPercent, light: reading.lightLux };
}

export const sensorUnits: Record<string, string> = {
  nitrogen: 'mg/kg', phosphorus: 'mg/kg', potassium: 'mg/kg', temperature: 'degC', humidity: 'percent',
  moisture_raw: 'raw_adc', co2: 'ppm', oxygen: 'percent', light: 'lux',
};

const sensors = ['temperature', 'humidity', 'moisture', 'nitrogen', 'potassium', 'phosphorus', 'co2', 'oxygen', 'ph', 'ec', 'light', 'moisture_raw'];
export const sampleCsvColumns = ['timestamp', 'sample_id', 'condition', 'label', 'label_basis', 'split', ...sensors, ...sensors.map(sensor => `${sensor}_unit`), 'moisture_calibration_id'];

export function samplesToCsv(samples: TrainingSample[]): string {
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = samples.map(sample => {
    const values = sensorModelInput(sample.reading);
    const row: Record<string, unknown> = {
      timestamp: sample.reading.timestamp, sample_id: sample.sampleId, condition: sample.condition,
      label: sample.label, label_basis: sample.labelBasis, split: sample.split,
      moisture_calibration_id: sample.reading.moistureCalibrationId || '',
    };
    sensors.forEach(sensor => {
      row[sensor] = values[sensor] ?? '';
      row[`${sensor}_unit`] = values[sensor] == null ? '' : sensor === 'moisture'
        ? sample.reading.moistureCalibrationId ? 'relative_percent' : 'percent'
        : sensorUnits[sensor] || '';
    });
    return sampleCsvColumns.map(column => escape(row[column])).join(',');
  });
  return [sampleCsvColumns.join(','), ...rows].join('\r\n') + '\r\n';
}

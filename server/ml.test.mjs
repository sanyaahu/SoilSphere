import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { predictFertilizer } from '../src/ml/inference.ts';
import { calibratedReading, createCalibration, relativeMoisture } from '../src/ml/moisture.ts';
import { makeSample, samplesToCsv } from '../src/ml/samples.ts';
import { mapEsp32Reading } from '../src/sensor-mapping.ts';
import { fertilizerSensorInput } from '../src/ml/fertilizer-input.ts';
import { chooseReadings, normalizeDeviceUrl, SENSOR_TIMEOUT_MS } from '../src/device-connection.ts';

const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const model = load('../src/ml/fertilizer-model.json');
const parity = load('../ml/artifacts/runtime_parity.json');
const sensor = { nitrogen: 37, phosphorus: 0, potassium: 0, moistureRaw: 450, temperature: 26, humidity: 52, co2: 600, oxygen: 20.5, lux: 1000 };
const reading = mapEsp32Reading(sensor, '2026-11-04T12:00:00Z');
const details = { sampleId: 'pot-01', condition: 'reference', label: '', labelBasis: '', split: 'train' };

test('device address accepts the Serial Monitor IP and normalizes the sensor endpoint', () => {
  for (const value of ['172.26.160.8', 'http://172.26.160.8/', 'http://172.26.160.8/sensors']) {
    assert.equal(normalizeDeviceUrl(value), 'http://172.26.160.8');
  }
  for (const value of ['', 'not an address', 'http://name:password@device.local', 'http://device.local/other']) {
    assert.throws(() => normalizeDeviceUrl(value));
  }
  assert.ok(SENSOR_TIMEOUT_MS >= 8000, 'Allow the firmware time to finish NPK retries');
});

test('failed hardware requests report a connection error instead of silently showing demo data', () => {
  const error = new Error('Aborted'); error.name = 'AbortError';
  const result = chooseReadings({ hardware: { status: 'rejected', reason: error }, backend: { status: 'fulfilled', value: null },
    previous: [], demo: [reading], address: 'http://172.26.160.8', mapReading: mapEsp32Reading });
  assert.equal(result.mode, 'demo');
  assert.match(result.connectionError, /8 seconds.*172\.26\.160\.8\/sensors/);
});

test('direct hardware works despite backend failure and never mixes in preview readings', () => {
  const result = chooseReadings({ hardware: { status: 'fulfilled', value: sensor }, backend: { status: 'rejected', reason: new Error('offline') },
    previous: [], demo: [{ ...reading, deviceId: 'demo' }], address: 'http://device.local', mapReading: mapEsp32Reading });
  assert.equal(result.mode, 'live');
  assert.equal(result.readings.length, 1);
  assert.equal(result.readings[0].deviceId, 'SoilSphere-ESP32');
  assert.equal(result.connectionError, undefined);
});

test('disconnected readings and old backend measurements are marked stale', () => {
  const common = { hardware: { status: 'rejected', reason: new Error('offline') }, previous: [reading],
    demo: [], address: 'http://device.local', mapReading: mapEsp32Reading };
  const disconnected = chooseReadings({ ...common, backend: { status: 'fulfilled', value: null } });
  assert.equal(disconnected.stale, true);
  assert.match(disconnected.connectionError, /Cannot read/);
  const backend = chooseReadings({ ...common, backend: { status: 'fulfilled', value: { mode: 'live', readings: [{ ...reading, timestamp: new Date(Date.now() - 60000).toISOString() }] } } });
  assert.equal(backend.stale, true);
  assert.match(backend.connectionError, /30 seconds old/);
});

test('Expo forest agrees with sklearn on all 599 source rows, including class scores', () => {
  assert.equal(parity.length, 599);
  for (const expected of parity) {
    const actual = predictFertilizer(model, expected.input);
    assert.equal(actual.prediction, expected.prediction);
    actual.scores.forEach((score, index) => assert.ok(Math.abs(score - expected.scores[index]) < 1e-10));
  }
});

test('model refuses missing inputs and unknown categories, and flags unseen numeric ranges', () => {
  const input = { ...parity[0].input };
  assert.throws(() => predictFertilizer(model, { ...input, moisture: null }), /Missing measurement/);
  assert.throws(() => predictFertilizer(model, { ...input, soil_type: 'unknown' }), /supported/);
  assert.ok(predictFertilizer(model, { ...input, potassium: 1000 }).warnings.length);
});

test('fertilizer accepts humidity and moisture from 0 through 100 without training-range warnings', () => {
  for (const feature of ['humidity', 'moisture']) {
    for (const value of [0, 10, 50, 90, 100]) {
      const result = predictFertilizer(model, { ...parity[0].input, [feature]: value });
      assert.ok(model.classes.includes(result.prediction));
      assert.equal(result.warnings.some(warning => warning.startsWith(`${feature} `)), false);
    }
    for (const value of [-0.1, 100.1]) {
      assert.throws(() => predictFertilizer(model, { ...parity[0].input, [feature]: value }), /between 0 and 100/);
    }
    const healthResult = predictFertilizer({ ...model, task: 'health' }, { ...parity[0].input, [feature]: 0 });
    assert.ok(healthResult.warnings.some(warning => warning.startsWith(`${feature} `)));
  }
});

test('fertilizer predictions need no crop selection and do not depend on crop labels', () => {
  assert.equal(model.categories.crop_type, undefined);
  assert.deepEqual(Object.keys(model.categories), ['soil_type']);
  for (const expected of parity) {
    assert.equal('crop_type' in expected.input, false);
    const result = predictFertilizer(model, expected.input);
    for (const crop of ['vegetable', 'plant', 'Maize']) {
      assert.deepEqual(predictFertilizer(model, { ...expected.input, crop_type: crop }), result);
    }
  }
});

test('hardware mapping preserves NPK zeroes, raw moisture, temperature and humidity', () => {
  assert.equal(reading.phosphorusMgKg, 0);
  assert.equal(reading.moistureRaw, 450);
  assert.equal(reading.moisturePercent, null);
  assert.equal(reading.temperatureC, 26);
  assert.equal(reading.humidityPercent, 52);
  assert.equal(mapEsp32Reading({ ...sensor, nitrogen: -1 }).nitrogenMgKg, null);
});

test('fertilizer uses SCD30 temperature and humidity but excludes CO2, oxygen and light', () => {
  const measured = mapEsp32Reading({ ...sensor, temperature: 24.3, humidity: 61.2 });
  const input = fertilizerSensorInput({ ...measured, moisturePercent: 38 }, 'Sandy');
  assert.equal(input.temperature, 24.3);
  assert.equal(input.humidity, 61.2);
  assert.deepEqual(Object.keys(input).sort(), [...model.numericFeatures, ...Object.keys(model.categories)].sort());
  assert.equal('co2' in input, false);
  assert.equal('oxygen' in input, false);
  assert.equal('light' in input, false);
  assert.deepEqual(fertilizerSensorInput({ ...measured, moisturePercent: 38, co2Ppm: 9000 }, 'Sandy'), input);
  assert.deepEqual(predictFertilizer(model, input), predictFertilizer(model, { ...input, co2: 9000 }));
});

test('missing SCD30 readings block fertilizer inference instead of using example values', () => {
  const missing = fertilizerSensorInput({ ...reading, moisturePercent: 38, temperatureC: null, humidityPercent: null }, 'Sandy');
  assert.equal(missing.temperature, null);
  assert.equal(missing.humidity, null);
  assert.throws(() => predictFertilizer(model, missing), /Missing measurement: temperature/);
  const zeroHumidity = fertilizerSensorInput({ ...reading, moisturePercent: 38, humidityPercent: 0 }, 'Sandy');
  assert.equal(zeroHumidity.humidity, 0);
});

test('malformed or empty hardware responses cannot become live readings', () => {
  for (const value of [null, [], {}, { moistureRaw: '450' }, { nitrogen: -1 }, { moistureRaw: 5000 }]) {
    assert.equal(mapEsp32Reading(value), null);
  }
});

test('moisture uses measured references in either direction, retains raw data, and matches device', () => {
  const profile = createCalibration('599,600,601', '299,300,301', reading.deviceId, 'software fixture');
  assert.equal(relativeMoisture(450, profile), 50);
  assert.ok(relativeMoisture(100, profile) > 100);
  assert.equal(calibratedReading(reading, profile).moisturePercent, 50);
  assert.equal(calibratedReading(reading, profile).moistureRaw, 450);
  assert.equal(calibratedReading({ ...reading, deviceId: 'other' }, profile).moisturePercent, null);
  const reverse = createCalibration('299,300,301', '599,600,601', reading.deviceId, 'software fixture');
  assert.equal(relativeMoisture(450, reverse), 50);
  assert.throws(() => createCalibration('1,2,3', '2,3,4', reading.deviceId, 'fixture'), /overlap/);
  assert.throws(() => createCalibration('1,,2', '4,5,6', reading.deviceId, 'fixture'), /empty/);
});

test('training samples reject demo data, stale data and health labels without an assessment', () => {
  assert.throws(() => makeSample(reading, details, null, false, false), /Preview or stale/);
  assert.throws(() => makeSample(reading, details, null, true, true), /Preview or stale/);
  assert.throws(() => makeSample(reading, { ...details, label: 'healthy' }, null, true, false), /supporting/);
  const sample = makeSample(reading, details, null, true, false);
  assert.equal(sample.label, '');
  assert.equal(sample.reading.moistureRaw, 450);
});

test('exported samples match Python health-training schema with raw and calibrated moisture', () => {
  const profile = createCalibration('599,600,601', '299,300,301', reading.deviceId, 'software fixture');
  const sample = makeSample(calibratedReading(reading, profile), { ...details, condition: 'wet, "reference"' }, profile, true, false);
  const csv = samplesToCsv([sample]);
  assert.match(csv, /moisture_raw_unit,moisture_calibration_id/);
  assert.match(csv, /"mg\/kg"/);
  assert.match(csv, /"relative_percent"/);
  assert.match(csv, /"raw_adc"/);
  assert.match(csv, /"wet, ""reference"""/);
});

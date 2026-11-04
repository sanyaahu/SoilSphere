import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { predictFertilizer } from '../src/ml/inference.ts';
import { calibratedReading, createCalibration, relativeMoisture } from '../src/ml/moisture.ts';
import { makeSample, samplesToCsv } from '../src/ml/samples.ts';
import { mapEsp32Reading } from '../src/sensor-mapping.ts';

const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const model = load('../src/ml/fertilizer-model.json');
const parity = load('../ml/artifacts/runtime_parity.json');
const sensor = { nitrogen: 37, phosphorus: 0, potassium: 0, moistureRaw: 450, temperature: 26, humidity: 52, co2: 600, oxygen: 20.5, lux: 1000 };
const reading = mapEsp32Reading(sensor, '2026-11-04T12:00:00Z');
const details = { sampleId: 'pot-01', condition: 'reference', label: '', labelBasis: '', split: 'train' };

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

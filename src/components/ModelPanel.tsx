import { useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { display, type SensorReading } from '../data';
import modelData from '../ml/fertilizer-model.json';
import healthData from '../ml/health-model.json';
import { missingInputs, predictFertilizer } from '../ml/inference';
import { makeSample, samplesToCsv, sensorModelInput, sensorUnits } from '../ml/samples';
import type { SampleDetails } from '../ml/samples';
import type { ForestModel, ModelInput } from '../ml/types';
import { useSoilSettings } from '../state/soil-settings';
import { fertilizerSensorInput } from '../ml/fertilizer-input';
import { healthExamples, healthLabels, healthSensorInput } from '../ml/health-input';

const model = modelData as ForestModel;
const example: ModelInput = { temperature: 26, humidity: 52, moisture: 38, nitrogen: 37, potassium: 0, phosphorus: 0, soil_type: 'Sandy' };

export function Choices({ values, selected, onChange }: { values: string[]; selected: string; onChange: (value: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.choices}>
    {values.map(value => <TouchableOpacity key={value} onPress={() => onChange(value)} accessibilityRole="button" accessibilityState={{ selected: value === selected }} style={[s.choice, value === selected && s.chosen]}>
      <Text style={[s.choiceText, value === selected && s.chosenText]}>{value || 'Unlabeled'}</Text>
    </TouchableOpacity>)}
  </ScrollView>;
}

function HealthDemoPanel({ reading, demo, stale }: { reading: SensorReading; demo: boolean; stale: boolean }) {
  const settings = useSoilSettings();
  const [source, setSource] = useState('Examples');
  const [selected, setSelected] = useState(healthExamples[0].name);
  const healthModel = healthData as unknown as ForestModel;
  const example = healthExamples.find(item => item.name === selected)!;
  let input: ModelInput | null = null;
  let issue = '';
  try {
    input = source === 'Examples' ? example.input : healthSensorInput(reading, settings.calibration, demo, stale);
  } catch (error) { issue = error instanceof Error ? error.message : String(error); }
  let result: ReturnType<typeof predictFertilizer> | null = null;
  if (input) {
    try { result = predictFertilizer(healthModel, input); }
    catch (error) { issue = error instanceof Error ? error.message : String(error); }
  }
  return <View style={s.card}>
    <Text style={s.heading}>Soil-condition model</Text>
    <Text style={s.body}>Moisture and NPK combine into Healthy, Could be better, or Unhealthy. These describe our experimental conditions; plant health has not been independently validated.</Text>
    <Choices values={['Examples', 'My sensors']} selected={source} onChange={setSource} />
    {source === 'Examples' ? <>
      <Choices values={healthExamples.map(item => item.name)} selected={selected} onChange={setSelected} />
      <Text style={s.small}>{example.note} This is an example, not your current soil.</Text>
    </> : <>
      <Text style={s.body}>{demo ? 'No live sensor connected.' : stale ? 'Sensor connection needs refreshing.' : `${reading.deviceId} · ${new Date(reading.timestamp).toLocaleString()}`}</Text>
      <Text style={s.small}>Uses your device’s calibrated dry-to-wet scale. Its equivalence to the experiment’s original calibration is unverified.</Text>
    </>}
    {!!issue && <Text style={s.warning} accessibilityLiveRegion="polite">{issue}</Text>}
    {input && <Text style={s.body}>Moisture {display(input.moisture as number, 1)}% · N {display(input.nitrogen as number)} · P {display(input.phosphorus as number)} · K {display(input.potassium as number)} mg/kg</Text>}
    {result && <View style={s.result} accessibilityLiveRegion="polite">
      <Text style={s.kicker}>{source === 'Examples' ? 'EXAMPLE RESULT' : 'EXPERIMENTAL LIVE COMPARISON'}</Text>
      <Text style={s.prediction}>{healthLabels[result.prediction] ?? 'Could be better'}</Text>
      <Text style={s.body}>{result.prediction === 'healthy' ? 'Most similar to the demo’s acceptable conditions.' : result.prediction === 'unhealthy' ? 'Most similar to the demo’s stressed conditions.' : 'Most similar to the demo’s intermediate conditions.'}</Text>
      <Text style={s.small}>Demo target: 40–60% moisture with the 1–2 tbsp experimental treatment. Fertilizer amounts are experiment context, not application advice.</Text>
      {input && (input.moisture as number) < 40 && <Text style={s.warning}>Moisture is below the experiment’s target range.</Text>}
      {input && (input.moisture as number) > 60 && <Text style={s.warning}>Moisture is above the experiment’s target range.</Text>}
      {result.warnings.map(warning => <Text style={s.warning} key={warning}>{warning}</Text>)}
    </View>}
    <Text style={s.small}>26 experimental NPK readings; 16 moisture values were synthetic. Labels follow assumed treatment rules. Real-world accuracy is not established. Results are never saved as training labels automatically.</Text>
  </View>;
}

export function ModelPanel({ reading, demo, stale }: { reading: SensorReading; demo: boolean; stale: boolean }) {
  const settings = useSoilSettings();
  const [source, setSource] = useState('Dataset example');
  const [soil, setSoil] = useState('Sandy');
  const [result, setResult] = useState<ReturnType<typeof predictFertilizer> | null>(null);
  const [notice, setNotice] = useState('');
  const [resultTimestamp, setResultTimestamp] = useState('');
  const [details, setDetails] = useState<SampleDetails>({ sampleId: '', condition: '', label: '', labelBasis: '', split: 'unassigned' });
  const [saving, setSaving] = useState(false);
  const input = source === 'Dataset example' ? example : fertilizerSensorInput(reading, soil);
  const missing = missingInputs(model, input);

  function runModel() {
    try {
      if (source !== 'Dataset example' && (demo || stale)) throw new Error('Connect the device and refresh before using your sensor readings.');
      setResult(predictFertilizer(model, input));
      setResultTimestamp(source === 'Dataset example' ? 'Public-data example' : new Date(reading.timestamp).toLocaleString());
      setNotice('');
    } catch (error) { setResult(null); setNotice(error instanceof Error ? error.message : String(error)); }
  }
  async function saveSample() {
    setSaving(true);
    try {
      await settings.saveSample(makeSample(reading, details, settings.calibration, !demo, stale));
      setNotice(`Saved this actual reading for ${details.sampleId}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  async function exportSamples() {
    try {
      if (!settings.samples.length) throw new Error('Save at least one real sample first.');
      const csv = samplesToCsv(settings.samples);
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = 'sensor_readings.csv'; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        await Share.share({ title: 'SoilSphere sensor readings CSV', message: csv });
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }
  let healthResult = 'Collect independently labeled samples to train your healthy/unhealthy model.';
  if ('trees' in healthData && !healthData.demoOnly && !demo && !stale) {
    try {
      const healthModel = healthData as unknown as ForestModel & { units: Record<string, string>; moistureCalibrationId?: string };
      if (healthModel.moistureCalibrationId && reading.moistureCalibrationId !== healthModel.moistureCalibrationId) throw new Error('Use the moisture calibration used during training.');
      const units = { ...sensorUnits, moisture: reading.moistureCalibrationId ? 'relative_percent' : 'percent' };
      if (Object.entries(healthModel.units).some(([feature, unit]) => units[feature as keyof typeof units] !== unit)) throw new Error('Sensor units differ from health-model training.');
      healthResult = `Pilot classification: ${predictFertilizer(healthModel, sensorModelInput(reading)).prediction}. Based on your locally labeled samples.`;
    } catch (error) { healthResult = error instanceof Error ? error.message : String(error); }
  }
  return <>
    <View style={s.hero}>
      <Text style={s.kicker}>SOILSPHERE ML</Text>
      <Text style={s.title}>Readings, together.</Text>
      <Text style={s.body}>An offline model combines nutrients, moisture, temperature, humidity, and soil type. No crop selection needed.</Text>
    </View>
    <View style={s.card}>
      <Text style={s.heading}>Fertilizer model</Text>
      <Text style={s.body}>Trained on {model.metrics.rows} public examples. This predicts a fertilizer class; it does not classify soil health.</Text>
      <Choices values={['Dataset example', 'My sensors']} selected={source} onChange={value => { setSource(value); setResult(null); }} />
      {source === 'My sensors' ? <>
        <Text style={s.label}>Soil type</Text>
        <Choices values={model.categories.soil_type} selected={soil} onChange={value => { setSoil(value); setResult(null); }} />
        <Text style={s.body}>{demo ? 'No live sensor connected.' : stale ? 'Connection lost. Refresh before predicting.' : `Using ${reading.deviceId}.`}</Text>
        <View style={s.environmentRow}>
          <View style={s.environmentMetric}>
            <Text style={s.small}>Air temperature · SCD30</Text>
            <Text style={s.environmentValue}>{demo ? '—' : display(reading.temperatureC ?? null, 1)} °C</Text>
          </View>
          <View style={s.environmentMetric}>
            <Text style={s.small}>Relative humidity · SCD30</Text>
            <Text style={s.environmentValue}>{demo ? '—' : display(reading.humidityPercent ?? null, 1)} %</Text>
          </View>
        </View>
        <Text style={s.small}>These SCD30 readings supply the model’s temperature and humidity inputs. CO₂ ppm is excluded.</Text>
        {!!missing.length && <Text style={s.warning}>Still needed: {missing.join(', ')}.{missing.includes('moisture') ? ' Calibrate moisture in Device.' : ' Waiting for these measurements.'}</Text>}
        <Text style={s.body}>Sensor NPK uses mg/kg. The public dataset does not document its measurement method; this comparison is experimental.</Text>
      </> : <Text style={s.body}>Public-data example: N 37 · P 0 · K 0 · moisture 38 · 26°C · humidity 52 · Sandy soil. These are not your sensor readings.</Text>}
      <TouchableOpacity style={s.button} onPress={runModel} accessibilityRole="button"><Text style={s.buttonText}>{source === 'Dataset example' ? 'Run model example' : 'Run experimental comparison'}</Text></TouchableOpacity>
      {result && <View style={s.result}>
        <Text style={s.kicker}>{source === 'Dataset example' ? 'DATASET RESULT' : 'EXPERIMENTAL SENSOR RESULT'}</Text>
        <Text style={s.prediction}>{result.prediction}</Text>
        <Text style={s.small}>{resultTimestamp}</Text>
        <Text style={s.body}>Fertilizer class suggestion. Soil health and nutrient excess are not assessed.</Text>
        {result.warnings.map(warning => <Text style={s.warning} key={warning}>{warning}</Text>)}
      </View>}
      <Text style={s.small}>{model.metrics.testAccuracy === null ? 'Unmeasured' : `${(model.metrics.testAccuracy * 100).toFixed(1)}%`} accuracy on {model.metrics.testRows} reserved public examples · {((model.metrics.cvAccuracy ?? 0) * 100).toFixed(1)}% cross-validation average. Sensor accuracy is unverified.</Text>
    </View>
    {healthData.demoOnly ? <HealthDemoPanel reading={reading} demo={demo} stale={stale} /> : <View style={s.card}>
      <Text style={s.heading}>Your soil-health model</Text>
      <Text style={s.body}>{healthResult}</Text>
      <Text style={s.small}>CO₂ and oxygen can be included when training with your own readings.</Text>
    </View>}
    <View style={s.card}>
      <Text style={s.heading}>Save a training sample</Text>
      <Text style={s.body}>{settings.samples.length} actual samples saved on this device. Raw moisture is preserved; calibration can come later.</Text>
      <TextInput style={s.input} value={details.sampleId} onChangeText={value => setDetails(old => ({ ...old, sampleId: value }))} placeholder="Pot ID, e.g. pot_01" accessibilityLabel="Pot ID" autoCapitalize="none" />
      <TextInput style={s.input} value={details.condition} onChangeText={value => setDetails(old => ({ ...old, condition: value }))} placeholder="Treatment / condition" accessibilityLabel="Treatment or condition" />
      <Text style={s.label}>Health label</Text>
      <Choices values={['', 'healthy', 'unhealthy']} selected={details.label} onChange={value => setDetails(old => ({ ...old, label: value as SampleDetails['label'] }))} />
      {details.label !== '' && <TextInput style={s.input} value={details.labelBasis} onChangeText={value => setDetails(old => ({ ...old, labelBasis: value }))} placeholder="Reference test or assessment supporting the label" accessibilityLabel="Health label assessment" multiline />}
      <Text style={s.label}>Keep every reading from this pot in the same group</Text>
      <Choices values={['unassigned', 'train', 'test']} selected={details.split} onChange={value => setDetails(old => ({ ...old, split: value as SampleDetails['split'] }))} />
      <TouchableOpacity style={[s.button, (!settings.ready || saving || demo || stale) && s.disabled]} disabled={!settings.ready || saving || demo || stale} onPress={saveSample} accessibilityRole="button"><Text style={s.buttonText}>{saving ? 'Saving…' : 'Save current sensor reading'}</Text></TouchableOpacity>
      <TouchableOpacity style={s.outline} onPress={exportSamples} accessibilityRole="button"><Text style={s.outlineText}>Export saved samples as CSV</Text></TouchableOpacity>
      <Text style={s.small}>Leave labels empty until assessed. Fertilizer predictions never become health labels automatically.</Text>
    </View>
    {!!notice && <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text>}
    {!!settings.error && <Text style={s.warning}>{settings.error}</Text>}
  </>;
}

export const s = StyleSheet.create({
  hero: { backgroundColor: '#DDECDD', borderRadius: 23, padding: 22, marginBottom: 16 },
  kicker: { color: '#286B49', fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: '#1F3529', fontSize: 26, fontWeight: '800', marginTop: 8 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5EAE3', borderRadius: 21, padding: 18, marginBottom: 14 },
  heading: { color: '#1F3529', fontSize: 18, fontWeight: '800' },
  body: { color: '#607568', fontSize: 13, lineHeight: 19, marginTop: 9 },
  small: { color: '#728078', fontSize: 11, lineHeight: 16, marginTop: 12 },
  label: { color: '#1F3529', fontSize: 12, fontWeight: '700', marginTop: 14 },
  choices: { gap: 7, paddingVertical: 10 },
  choice: { backgroundColor: '#F0F3ED', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12 },
  chosen: { backgroundColor: '#286B49' },
  choiceText: { color: '#496253', fontSize: 12, fontWeight: '600' },
  chosenText: { color: '#fff' },
  button: { backgroundColor: '#286B49', padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 14 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  outline: { borderWidth: 1, borderColor: '#286B49', padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  outlineText: { color: '#286B49', fontSize: 13, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#DCE4DB', backgroundColor: '#FAFBF8', borderRadius: 12, padding: 13, marginTop: 12, color: '#1F3529', minHeight: 46 },
  result: { backgroundColor: '#E5F1E8', padding: 16, borderRadius: 15, marginTop: 16 },
  prediction: { color: '#1F3529', fontSize: 29, fontWeight: '800', marginTop: 8 },
  warning: { color: '#A0601A', fontSize: 12, lineHeight: 18, marginTop: 8 },
  notice: { color: '#286B49', fontSize: 13, lineHeight: 19, marginVertical: 12 },
  environmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  environmentMetric: { flex: 1, minWidth: 120, backgroundColor: '#F0F3ED', borderRadius: 12, paddingHorizontal: 12, paddingBottom: 12 },
  environmentValue: { color: '#1F3529', fontSize: 21, fontWeight: '800', marginTop: 6 },
});

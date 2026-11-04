import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { createCalibration } from '../ml/moisture';
import { useSoilSettings } from '../state/soil-settings';
import { s } from './ModelPanel';

export function MoistureCalibration({ deviceId, live }: { deviceId: string; live: boolean }) {
  const { calibration, ready, saveCalibration } = useSoilSettings();
  const [dry, setDry] = useState('');
  const [wet, setWet] = useState('');
  const [reference, setReference] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      if (!live) throw new Error('Connect your actual device before saving its calibration.');
      const profile = createCalibration(dry, wet, deviceId, reference);
      await saveCalibration(profile);
      setNotice('Calibration saved on this device. Raw readings are kept too.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  return <View style={[s.card, { marginTop: 18 }]}>
    <Text style={s.heading}>Calibrate soil moisture</Text>
    <Text style={s.body}>Record 3–5 settled raw readings in dry soil, then in your chosen wet reference. Keep the same probe, soil, depth, and packing.</Text>
    <Text style={s.body}>0% means your dry reference; 100% means your wet reference. This is relative moisture, not volumetric water content.</Text>
    <TextInput style={s.input} value={dry} onChangeText={setDry} placeholder="Dry raw readings, separated by commas" accessibilityLabel="Dry reference readings" />
    <TextInput style={s.input} value={wet} onChangeText={setWet} placeholder="Wet raw readings, separated by commas" accessibilityLabel="Wet reference readings" />
    <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Describe soil and wetting/drainage procedure" accessibilityLabel="Moisture reference description" multiline />
    <TouchableOpacity style={[s.button, (!ready || saving || !live) && s.disabled]} disabled={!ready || saving || !live} onPress={save} accessibilityRole="button"><Text style={s.buttonText}>{saving ? 'Saving…' : 'Save moisture calibration'}</Text></TouchableOpacity>
    {calibration && <Text style={s.small}>Saved for {calibration.deviceId}: dry {calibration.dryRaw} · wet {calibration.wetRaw}. {calibration.reference}</Text>}
    {!!notice && <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text>}
  </View>;
}

import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSoilSettings } from '../state/soil-settings';
import { s } from './ModelPanel';

export function DeviceConnection({ error }: { error: string | null }) {
  const { deviceUrl, ready, saveDeviceUrl } = useSoilSettings();
  const [address, setAddress] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  async function connect() {
    setSaving(true);
    try {
      await saveDeviceUrl(address ?? deviceUrl);
      setAddress(null);
      setNotice('Address saved. The app will request sensor readings from this device.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  return <View style={s.card}>
    <Text style={s.heading}>Connect your ESP32</Text>
    <Text style={s.body}>Enter the IP address printed after Wi-Fi connects in Arduino Serial Monitor (115200 baud). A USB cable powers the board; phone readings use Wi-Fi.</Text>
    <TextInput style={s.input} value={address ?? deviceUrl} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="ESP32 IP address or http:// address" accessibilityLabel="ESP32 address" />
    <TouchableOpacity style={[s.button, (!ready || saving) && s.disabled]} disabled={!ready || saving} onPress={connect} accessibilityRole="button"><Text style={s.buttonText}>{saving ? 'Saving…' : 'Save ESP32 address'}</Text></TouchableOpacity>
    <Text selectable style={s.small}>Checking: {deviceUrl}/sensors</Text>
    {!!error && <Text style={s.warning} accessibilityLiveRegion="polite">{error}</Text>}
    <Text style={s.small}>Try this URL in your phone’s browser. It should show sensor readings as JSON. If it cannot open, check the IP and whether your Wi-Fi permits phone-to-device communication.</Text>
    {!!notice && <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text>}
  </View>;
}

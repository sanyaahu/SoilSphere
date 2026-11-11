import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSoilSettings } from '../state/soil-settings';

// Talks to firmware/SoilSphere_ESP32/soilsphere_pump_test.ino:
//   POST /pump/on  - run for another 2 s (the firmware's MANUAL_LEASE_MS)
//   POST /pump/off - stop now
// While the button is held we re-send /pump/on every RENEW_MS. If that stops (finger lifted
// and /pump/off lost, Wi-Fi drop, app backgrounded) the firmware stops the pump on its own.
const RENEW_MS = 500;
const REQUEST_TIMEOUT_MS = 3000;

type Status = 'idle' | 'starting' | 'running' | 'error';

async function pumpRequest(deviceUrl: string, action: 'on' | 'off') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${deviceUrl}/pump/${action}`, { method: 'POST', signal: controller.signal });
    if (response.status === 409) throw new Error('Auto-watering is running right now. Try again in a few seconds.');
    if (response.status === 404) throw new Error('This ESP32 has no pump routes. Upload soilsphere_pump_test.ino to it.');
    if (!response.ok) throw new Error(`ESP32 replied with an error (${response.status}).`);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`ESP32 did not respond at ${deviceUrl}. Check the address on the Device tab.`);
    if (e instanceof TypeError) throw new Error(`Cannot reach the ESP32 at ${deviceUrl}. Check that your phone is on the same Wi-Fi.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function PumpControl() {
  const { deviceUrl } = useSoilSettings();
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const holding = useRef(false);
  const renewTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Kept in a ref so the renew timer and unmount cleanup always use the latest saved address.
  const urlRef = useRef(deviceUrl);
  useEffect(() => { urlRef.current = deviceUrl; }, [deviceUrl]);

  function release(showIdle = true) {
    const wasHolding = holding.current;
    holding.current = false;
    if (renewTimer.current) clearInterval(renewTimer.current);
    renewTimer.current = null;
    if (!wasHolding) return;
    void pumpRequest(urlRef.current, 'off').catch(() => undefined);
    // An "on" still in flight could land after the "off"; a second "off" covers that.
    setTimeout(() => void pumpRequest(urlRef.current, 'off').catch(() => undefined), 600);
    if (showIdle) setStatus('idle');
  }

  function press() {
    holding.current = true;
    setStatus('starting');
    setMessage('');
    const renew = () =>
      pumpRequest(urlRef.current, 'on')
        .then(() => { if (holding.current) setStatus('running'); })
        .catch((e: unknown) => {
          if (!holding.current) return;
          release(false);
          setStatus('error');
          setMessage(e instanceof Error ? e.message : String(e));
        });
    void renew();
    renewTimer.current = setInterval(renew, RENEW_MS);
  }

  // Leaving the page mid-press stops the pump.
  useEffect(() => () => {
    if (renewTimer.current) clearInterval(renewTimer.current);
    if (holding.current) void pumpRequest(urlRef.current, 'off').catch(() => undefined);
  }, []);

  const on = status === 'running' || status === 'starting';
  return (
    <View style={p.card}>
      <Text style={p.title}>Water pump</Text>
      <Text style={p.body}>Press and hold to run the pump. Let go to stop.</Text>

      <View style={p.center}>
        <Pressable
          onPressIn={press}
          onPressOut={() => release()}
          style={[p.button, on && p.buttonOn]}
          accessibilityRole="button"
          accessibilityLabel="Hold to run pump"
          accessibilityState={{ busy: status === 'starting' }}
        >
          <Text style={[p.buttonIcon, on && p.textOn]}>{on ? '≋' : '⏻'}</Text>
          <Text style={[p.buttonText, on && p.textOn]}>{on ? 'Pumping…' : 'Hold to pump'}</Text>
        </Pressable>
      </View>

      <Text style={[p.status, status === 'error' && p.error]} accessibilityLiveRegion="polite">
        {status === 'running' ? '● Pump is ON' : status === 'starting' ? 'Starting…' : status === 'error' ? message : '○ Pump is off'}
      </Text>
      <Text style={p.small} selectable>Device: {deviceUrl}</Text>
      <Text style={p.small}>
        Safety: the pump also stops by itself about 2 seconds after the app stops talking to it.
        Needs soilsphere_pump_test.ino on the ESP32; change the address on the Device tab.
      </Text>
    </View>
  );
}

const p = StyleSheet.create({
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5EAE3', borderRadius: 21, padding: 18 },
  title: { color: '#1F3529', fontSize: 18, fontWeight: '800' },
  body: { color: '#607568', fontSize: 13, lineHeight: 19, marginTop: 6 },
  center: { alignItems: 'center', marginVertical: 26 },
  button: { width: 170, height: 170, borderRadius: 85, backgroundColor: '#E5F1E8', borderWidth: 3, borderColor: '#286B49', alignItems: 'center', justifyContent: 'center' },
  buttonOn: { backgroundColor: '#286B49' },
  buttonIcon: { fontSize: 44, color: '#286B49' },
  buttonText: { marginTop: 6, fontSize: 15, fontWeight: '800', color: '#286B49' },
  textOn: { color: '#fff' },
  status: { textAlign: 'center', color: '#1F3529', fontSize: 15, fontWeight: '700' },
  error: { color: '#B84F38', fontSize: 13, fontWeight: '600' },
  small: { color: '#728078', fontSize: 11, lineHeight: 16, marginTop: 10 },
});

import type { ReadingResponse, SensorReading } from './data';

export const DEFAULT_ESP32_URL = 'http://172.26.160.8';
export const SENSOR_TIMEOUT_MS = 8000;

export function normalizeDeviceUrl(input: string): string {
  const text = input.trim();
  if (!text) throw new Error('Enter the ESP32 IP address from Serial Monitor.');
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`); }
  catch { throw new Error('Enter an IP address such as 172.26.160.8, or an http:// device URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || !['', '/', '/sensors', '/sensors/'].includes(url.pathname)) {
    throw new Error('Use only the ESP32 address, optionally ending in /sensors.');
  }
  return url.origin;
}

export function connectionFailure(reason: unknown, address: string): string {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return `ESP32 did not respond within ${SENSOR_TIMEOUT_MS / 1000} seconds at ${address}/sensors. Check its current IP and Wi-Fi connection.`;
  }
  const detail = reason instanceof Error ? reason.message : String(reason);
  return `Cannot read ${address}/sensors. ${detail}. Check the address and open this URL in your phone's browser.`;
}

export function chooseReadings(options: {
  hardware: PromiseSettledResult<unknown>;
  backend: PromiseSettledResult<unknown>;
  previous: SensorReading[];
  demo: SensorReading[];
  address: string;
  mapReading: (input: unknown) => SensorReading | null;
}): ReadingResponse {
  const { hardware, backend, previous, demo, address, mapReading } = options;
  let connectionError: string;
  if (hardware.status === 'fulfilled') {
    const reading = mapReading(hardware.value);
    if (reading) return { mode: 'live', readings: [...previous, reading].slice(-100) };
    connectionError = `ESP32 replied at ${address}/sensors, but no valid measurements were present. Check the sensor firmware and connections.`;
  } else {
    connectionError = connectionFailure(hardware.reason, address);
  }
  if (backend.status === 'fulfilled' && backend.value && typeof backend.value === 'object') {
    const data = backend.value as Partial<ReadingResponse>;
    if (data.mode === 'live' && Array.isArray(data.readings) && data.readings.length) {
      const latest = data.readings.at(-1);
      if (latest && Number.isFinite(Date.parse(latest.timestamp))) {
        const stale = Date.now() - Date.parse(latest.timestamp) > 30000;
        return { mode: 'live', readings: data.readings, stale,
          ...(stale ? { connectionError: 'The backend is reachable, but its last sensor reading is over 30 seconds old. Check the ESP32 connection.' } : {}) };
      }
    }
  }
  if (previous.length) return { mode: 'live', readings: previous, stale: true, connectionError };
  return { mode: 'demo', readings: demo, connectionError };
}

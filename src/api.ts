
import { ChatMessage, demoReadings, ReadingResponse, SensorReading } from './data';
import { mapEsp32Reading } from './sensor-mapping';
import { getInsights } from './recommendations';
import { chooseReadings, DEFAULT_ESP32_URL, normalizeDeviceUrl, SENSOR_TIMEOUT_MS } from './device-connection';
import Constants from 'expo-constants';

// In development the phone loads the app from your laptop's Expo server, so that same address
// is where `npm run api` runs. Using it means a changed Wi-Fi IP doesn't require editing .env.
function devServerApiUrl() {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host && /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? `http://${host}:8787` : undefined;
}
// .env is the fallback for tunnel mode and builds, where the dev server host isn't a LAN IP.
export const API_URL = (devServerApiUrl() || process.env.EXPO_PUBLIC_API_URL)?.replace(/\/$/, '');
const ESP32_URL = process.env.EXPO_PUBLIC_ESP32_URL || DEFAULT_ESP32_URL;
const histories = new Map<string, SensorReading[]>();
const pendingRequests = new Map<string, Promise<ReadingResponse>>();

async function request(url: string, options: RequestInit = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `Request failed (${response.status})`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readDevice(address: string): Promise<ReadingResponse> {
  const [backend, hardware] = await Promise.allSettled([
    API_URL ? request(`${API_URL}/readings`) : Promise.resolve(null),
    request(`${address}/sensors`, {}, SENSOR_TIMEOUT_MS),
  ]);
  const result = chooseReadings({ hardware, backend, previous: histories.get(address) || [],
    demo: demoReadings, address, mapReading: mapEsp32Reading });
  if (result.mode === 'live' && !result.stale) histories.set(address, result.readings);
  return result;
}

export function fetchReadings(deviceUrl = ESP32_URL): Promise<ReadingResponse> {
  const address = normalizeDeviceUrl(deviceUrl);
  const existing = pendingRequests.get(address);
  if (existing) return existing;
  const operation = readDevice(address).finally(() => pendingRequests.delete(address));
  pendingRequests.set(address, operation);
  return operation;
}

export async function askAdvisor(message: string, history: ChatMessage[], readings: SensorReading[]): Promise<string> {
  const reading = readings[readings.length - 1];
  if (API_URL) {
    // Only send history from the same device as the latest reading, so demo samples don't mix into live trends.
    const recent = readings.filter((r) => r.deviceId === reading?.deviceId).slice(-12);
    // Fail fast when the server is unreachable instead of spinning until the long chat timeout.
    try {
      await request(`${API_URL}/health`, {}, 4000);
    } catch {
      throw new Error(`Could not reach the SoilSphere server at ${API_URL}. Make sure \`npm run api\` is running and your phone is on the same Wi-Fi as your laptop.`);
    }
    let data;
    try {
      data = await request(`${API_URL}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, readings: recent }),
      }, 60000); // Claude can take a while to answer
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new Error('The advisor took too long to answer. Try again.');
      if (e instanceof TypeError) throw new Error('Could not reach the SoilSphere server. Is `npm run api` running?');
      throw e; // server-provided message, e.g. a bad API key
    }
    if (typeof data.reply !== 'string') throw new Error('The advisor returned no reply.');
    return data.reply;
  }
  const summary = `Latest NPK estimates: N ${reading.nitrogenMgKg ?? 'unavailable'}, P ${reading.phosphorusMgKg ?? 'unavailable'}, K ${reading.potassiumMgKg ?? 'unavailable'} mg/kg.`;
  return `${summary} ${getInsights([reading])[0].detail}`;
}

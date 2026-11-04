
import { ChatMessage, demoReadings, ReadingResponse, SensorReading } from './data';
import { mapEsp32Reading } from './sensor-mapping';
import { getInsights } from './recommendations';
import { chooseReadings, DEFAULT_ESP32_URL, normalizeDeviceUrl, SENSOR_TIMEOUT_MS } from './device-connection';

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
const ESP32_URL = process.env.EXPO_PUBLIC_ESP32_URL || DEFAULT_ESP32_URL;
const histories = new Map<string, SensorReading[]>();
const pendingRequests = new Map<string, Promise<ReadingResponse>>();

async function request(url: string, options: RequestInit = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
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

export async function askAdvisor(message: string, history: ChatMessage[], reading: SensorReading): Promise<string> {
  if (API_URL) {
    const data = await request(`${API_URL}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, reading }),
    }, 20000);
    if (typeof data.reply !== 'string') throw new Error('The advisor returned no reply.');
    return data.reply;
  }
  const summary = `Latest NPK estimates: N ${reading.nitrogenMgKg ?? 'unavailable'}, P ${reading.phosphorusMgKg ?? 'unavailable'}, K ${reading.potassiumMgKg ?? 'unavailable'} mg/kg.`;
  return `${summary} ${getInsights([reading])[0].detail}`;
}


import { ChatMessage, demoReadings, ReadingResponse, SensorReading } from './data';
import { mapEsp32Reading } from './sensor-mapping';
import { getInsights } from './recommendations';

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
const ESP32_URL = (process.env.EXPO_PUBLIC_ESP32_URL || 'http://172.26.160.8').replace(/\/$/, '');
let liveHistory: SensorReading[] = [];

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

export async function fetchReadings(): Promise<ReadingResponse> {
  const [backend, hardware] = await Promise.allSettled([
    API_URL ? request(`${API_URL}/readings`) : Promise.resolve(null),
    request(`${ESP32_URL}/sensors`),
  ]);
  if (hardware.status === 'fulfilled') {
    const reading = mapEsp32Reading(hardware.value);
    if (reading) {
      liveHistory = [...liveHistory, reading].slice(-100);
      return { mode: 'live', readings: liveHistory };
    }
  }
  if (backend.status === 'fulfilled' && backend.value?.mode === 'live' && Array.isArray(backend.value.readings) && backend.value.readings.length) {
    liveHistory = backend.value.readings;
    return { mode: 'live', readings: liveHistory };
  }
  if (liveHistory.length) return { mode: 'live', readings: liveHistory, stale: true };
  return { mode: 'demo', readings: demoReadings };
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

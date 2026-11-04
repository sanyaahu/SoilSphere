
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
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `Request failed (${response.status})`);
    }
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

export async function askAdvisor(message: string, history: ChatMessage[], readings: SensorReading[]): Promise<string> {
  const reading = readings[readings.length - 1];
  if (API_URL) {
    // Only send history from the same device as the latest reading, so demo samples don't mix into live trends.
    const recent = readings.filter((r) => r.deviceId === reading?.deviceId).slice(-12);
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

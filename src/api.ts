import { ChatMessage, demoReadings, ReadingResponse, SensorReading } from './data';
const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
export async function fetchReadings(): Promise<ReadingResponse> {
  if (!API_URL) return { mode: 'demo', readings: demoReadings };
  const response = await fetch(`${API_URL}/readings`);
  if (!response.ok) throw new Error(`Readings request failed (${response.status})`);
  return response.json() as Promise<ReadingResponse>;
}
export async function askAdvisor(message: string, history: ChatMessage[], reading: SensorReading): Promise<string> {
  if (!API_URL) return 'This is a preview. Connect the local server to ask questions about sensor readings. NPK values are estimates until the probe is validated.';
  const response = await fetch(`${API_URL}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history, reading }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Advisor request failed (${response.status})`);
  return body.reply;
}

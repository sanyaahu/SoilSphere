
import {
  ChatMessage,
  demoReadings,
  ReadingResponse,
  SensorReading,
} from './data';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

const ESP32_URL = 'http://172.26.160.8';

type ESP32Reading = {
  co2: number | null;
  temperature: number | null;
  humidity: number | null;
  lux: number | null;
  oxygen: number | null;
  moistureRaw: number | null;
};

export async function fetchReadings(): Promise<ReadingResponse> {
  let result: ReadingResponse;

  if (!API_URL) {
    result = {
      mode: 'demo',
      readings: demoReadings,
    };
  } else {
    const response = await fetch(`${API_URL}/readings`);

    if (!response.ok) {
      throw new Error(
        `Readings request failed (${response.status})`
      );
    }

    result = (await response.json()) as ReadingResponse;
  }

  // Fetch live readings from ESP32
  try {
    const response = await fetch(`${ESP32_URL}/sensors`);

    if (!response.ok) {
      throw new Error(
        `ESP32 request failed (${response.status})`
      );
    }

    const sensor: ESP32Reading = await response.json();

    const latest = result.readings[result.readings.length - 1];

    if (!latest) return result;

    const liveReading: SensorReading = {
      ...latest,
      deviceId: 'soilsphere-esp32',
      timestamp: new Date().toISOString(),

      // Live CO2
      co2Ppm: sensor.co2,

      // Live light
      lightLux: sensor.lux,

      // Live oxygen
      oxygenPercent: sensor.oxygen,

      // Live raw soil moisture
      moistureRaw: sensor.moistureRaw,

      // No calibrated percentage available yet
      moisturePercent: null,
    };

    return {
      mode: 'live',
      readings: [
        ...result.readings.slice(0, -1),
        liveReading,
      ],
    };
  } catch (error) {
    console.log('ESP32 connection failed:', error);
    return result;
  }
}

export async function askAdvisor(
  message: string,
  history: ChatMessage[],
  reading: SensorReading
): Promise<string> {
  if (!API_URL) {
    return 'This is a preview. Connect the local server to ask questions about sensor readings. NPK values are estimates until the probe is validated.';
  }

  const response = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      history,
      reading,
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error || `Advisor request failed (${response.status})`
    );
  }

  return body.reply;
}


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
};

export async function fetchReadings(): Promise<ReadingResponse> {
  // Get existing readings (demo or backend)
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

  // Fetch live CO2 and lux data from ESP32
  try {
    const response = await fetch(`${ESP32_URL}/sensors`);

    if (!response.ok) {
      throw new Error(
        `ESP32 request failed (${response.status})`
      );
    }

    const sensor: ESP32Reading = await response.json();

    // Get the latest existing reading
    const latest = result.readings[result.readings.length - 1];

    if (!latest) return result;

    // Combine existing fields with live ESP32 measurements
    const liveReading: SensorReading = {
      ...latest,
      deviceId: 'soilsphere-esp32',
      timestamp: new Date().toISOString(),

      // Live CO2 sensor (SCD30)
      co2Ppm: sensor.co2,

      // Live light sensor (VEML7700)
      lightLux: sensor.lux,
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

    // Keep existing readings if ESP32 is unreachable
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


import {
  ChatMessage,
  demoReadings,
  ReadingResponse,
  SensorReading,
} from './data';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

const ESP32_URL = 'http://172.26.160.8';

// All readings returned by the ESP32
type ESP32Reading = {
  co2: number | null;
  temperature: number | null;
  humidity: number | null;
  lux: number | null;
  oxygen: number | null;
  moistureRaw: number | null;
  nitrogen: number | null;
  phosphorus: number | null;
  potassium: number | null;
};

export async function fetchReadings(): Promise<ReadingResponse> {
  let result: ReadingResponse;

  // Get existing backend/demo readings
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

  // Fetch live ESP32 readings
  try {
    const response = await fetch(`${ESP32_URL}/sensors`);

    if (!response.ok) {
      throw new Error(
        `ESP32 request failed (${response.status})`
      );
    }

    const sensor = (await response.json()) as ESP32Reading;

    const liveReading: SensorReading = {
      deviceId: 'SoilSphere-ESP32',
      timestamp: new Date().toISOString(),

      // NPK
      nitrogenMgKg: sensor.nitrogen,
      phosphorusMgKg: sensor.phosphorus,
      potassiumMgKg: sensor.potassium,

      // Moisture (raw, not calibrated yet)
      moisturePercent: null,
      moistureRaw: sensor.moistureRaw,

      // Light
      lightLux: sensor.lux,

      // CO2
      co2Ppm: sensor.co2,

      // Oxygen
      oxygenPercent: sensor.oxygen,

      // Battery monitoring not implemented yet
      batteryPercent: null,
    };

    return {
      mode: 'live',
      readings: [...result.readings, liveReading],
    };
  } catch (error) {
    console.warn('Could not fetch ESP32 readings:', error);
    return result;
  }
}

// Keep the rest of your existing API functions
// (such as sendChatMessage) unchanged.

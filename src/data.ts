
export type SensorReading = {
  deviceId: string;
  timestamp: string;

  nitrogenMgKg: number | null;
  phosphorusMgKg: number | null;
  potassiumMgKg: number | null;

  moisturePercent: number | null;
  moistureRaw?: number | null;

  lightLux: number | null;
  co2Ppm: number | null;
  oxygenPercent: number | null;
  batteryPercent: number | null;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ReadingResponse = {
  mode: 'demo' | 'live';
  readings: SensorReading[];
};

const values = [
  [41, 28, 62, 30, 28000, 620, 20.4, 86],
  [42, 29, 60, 31, 35000, 650, 20.2, 86],
  [40, 31, 61, 33, 42000, 690, 20.1, 85],
  [39, 30, 59, 32, 31000, 680, 20.1, 85],
  [38, 32, 58, 34, 37000, 710, 19.9, 84],
  [38, 32, 58, 34, 39000, 720, 19.8, 84],
];

export const demoReadings: SensorReading[] = values.map(
  (v, i) => ({
    deviceId: 'soilsphere-demo-01',
    timestamp: new Date(
      Date.now() - (5 - i) * 7200000
    ).toISOString(),

    nitrogenMgKg: v[0],
    phosphorusMgKg: v[1],
    potassiumMgKg: v[2],

    moisturePercent: v[3],
    moistureRaw: null,

    lightLux: v[4],
    co2Ppm: v[5],
    oxygenPercent: v[6],
    batteryPercent: v[7],
  })
);

export const display = (
  v: number | null,
  digits = 0
) => v === null ? '—' : v.toFixed(digits);

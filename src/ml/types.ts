export type ForestModel = {
  version: number;
  task: 'fertilizer' | 'health';
  classes: string[];
  numericFeatures: string[];
  categories: Record<string, string[]>;
  ranges: Record<string, { min: number; max: number }>;
  demoOnly?: boolean;
  units?: Record<string, string>;
  moistureCalibrationId?: string;
  trees: { left: number[]; right: number[]; feature: number[]; threshold: number[]; values: number[][] }[];
  metrics: { rows: number; testRows: number; testAccuracy: number | null; cvAccuracy: number | null };
};

export type ModelInput = Record<string, number | string | null | undefined>;

export type MoistureCalibration = {
  version: 1;
  id: string;
  deviceId: string;
  dryRaw: number;
  wetRaw: number;
  dryReadings: number[];
  wetReadings: number[];
  reference: string;
};

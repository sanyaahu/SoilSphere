import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { MoistureCalibration } from '../ml/types';
import type { TrainingSample } from '../ml/samples';
import { DEFAULT_ESP32_URL, normalizeDeviceUrl } from '../device-connection';

type Settings = { calibration: MoistureCalibration | null; samples: TrainingSample[]; deviceUrl: string };
type SoilContext = Settings & {
  ready: boolean;
  error: string | null;
  saveCalibration: (value: MoistureCalibration) => Promise<void>;
  saveSample: (value: TrainingSample) => Promise<void>;
  saveDeviceUrl: (value: string) => Promise<void>;
};
const key = 'soilsphere.capstone.samples.v1';
const defaults: Settings = { calibration: null, samples: [], deviceUrl: process.env.EXPO_PUBLIC_ESP32_URL || DEFAULT_ESP32_URL };
const Context = createContext<SoilContext | null>(null);

export function SoilSettingsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Settings>(defaults);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(state);
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key).then(text => {
      if (!active) return;
      let restored = defaults;
      if (text) {
        const stored = JSON.parse(text) as Settings;
        if (!Array.isArray(stored.samples)) throw new Error('Saved sample data is invalid.');
        restored = { ...defaults, ...stored };
      }
      current.current = restored;
      setState(restored);
      setReady(true);
    }).catch(reason => { if (active) setError(`Could not restore saved data: ${String(reason)}`); });
    return () => { active = false; };
  }, []);

  function commit(change: (old: Settings) => Settings): Promise<void> {
    if (!ready) return Promise.reject(new Error('Saved data is still loading. Please wait.'));
    const operation = queue.current.catch(() => undefined).then(async () => {
      const next = change(current.current);
      await AsyncStorage.setItem(key, JSON.stringify(next));
      current.current = next;
      setState(next);
    });
    queue.current = operation;
    return operation;
  }
  return <Context.Provider value={{ ...state, ready, error,
    saveCalibration: calibration => commit(old => ({ ...old, calibration })),
    saveDeviceUrl: deviceUrl => commit(old => ({ ...old, deviceUrl: normalizeDeviceUrl(deviceUrl) })),
    saveSample: sample => commit(old => {
      if (old.samples.some(existing => existing.id === sample.id)) throw new Error('This reading is already saved for that pot. Refresh before saving again.');
      if (old.samples.some(existing => existing.sampleId === sample.sampleId && existing.split !== sample.split)) throw new Error('Keep this pot in the same train/test group as its earlier samples.');
      return { ...old, samples: [...old.samples, sample] };
    }),
  }}>{children}</Context.Provider>;
}

export function useSoilSettings(): SoilContext {
  const value = useContext(Context);
  if (!value) throw new Error('SoilSettingsProvider is missing.');
  return value;
}

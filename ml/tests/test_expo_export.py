"""Synthetic software fixtures exercise app CSV -> Python -> Expo forest parity."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import joblib
import pandas as pd

APP = Path(__file__).resolve().parents[2]


class ExpoExportTests(unittest.TestCase):
    def test_app_csv_trains_and_exports_a_matching_health_model_in_temporary_files(self):
        shipped_model_before = (APP / "src" / "ml" / "health-model.json").read_bytes()
        script = r"""
import {makeSample,samplesToCsv} from './src/ml/samples.ts';
import {mapEsp32Reading} from './src/sensor-mapping.ts';
const rows=[];
for(const [label,base] of [['healthy',30],['unhealthy',70]]) {
  for(let pot=0;pot<3;pot++) for(let repeat=0;repeat<3;repeat++) {
    const reading=mapEsp32Reading({nitrogen:base+pot,phosphorus:base,potassium:base,moistureRaw:base+repeat},`2026-11-04T12:00:0${repeat}Z`);
    rows.push(makeSample(reading,{sampleId:`${label}-${pot}`,condition:'software fixture only',label,labelBasis:'synthetic software test',split:pot===2?'test':'train'},null,true,false));
  }
}
process.stdout.write(samplesToCsv(rows));
"""
        completed = subprocess.run(["node", "--experimental-strip-types", "--input-type=module", "-e", script], cwd=APP, text=True, capture_output=True, check=True)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / "sensor_readings.csv"
            data.write_text(completed.stdout, encoding="utf-8")
            output = root / "health-model.json"
            subprocess.run([sys.executable, str(APP / "ml" / "train_health.py"), "--data", str(data),
                            "--artifacts", str(root / "artifacts"), "--output-model", str(output)],
                           cwd=APP, text=True, capture_output=True, check=True)
            model = json.loads(output.read_text())
            self.assertEqual(model["task"], "health")
            self.assertEqual(model["units"]["nitrogen"], "mg/kg")
            self.assertEqual(model["units"]["moisture_raw"], "raw_adc")
            bundle = joblib.load(root / "artifacts" / "health_model.joblib")
            frame = pd.read_csv(data)[bundle["features"]]
            expected = bundle["model"].predict_proba(frame).tolist()
            payload = root / "parity.json"
            payload.write_text(json.dumps({"inputs": frame.to_dict(orient="records"), "scores": expected}), encoding="utf-8")
            verify = r"""
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {predictFertilizer} from './src/ml/inference.ts';
const model=JSON.parse(readFileSync(process.argv[1],'utf8'));
const fixture=JSON.parse(readFileSync(process.argv[2],'utf8'));
fixture.inputs.forEach((input,index)=>predictFertilizer(model,input).scores.forEach((score,c)=>assert.ok(Math.abs(score-fixture.scores[index][c])<1e-10)));
"""
            subprocess.run(["node", "--experimental-strip-types", "--input-type=module", "-e", verify, str(output), str(payload)], cwd=APP, text=True, capture_output=True, check=True)
        # A software fixture must never become the model shipped to the user's phone.
        self.assertEqual((APP / "src" / "ml" / "health-model.json").read_bytes(), shipped_model_before)

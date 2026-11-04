"""Export our locally trained sklearn forest for offline Expo inference."""
import csv
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
bundle = joblib.load(ROOT / "artifacts" / "fertilizer_model.joblib")
pipeline = bundle["model"]
classifier = pipeline.named_steps["classifier"]
estimators = classifier.estimators_ if hasattr(classifier, "estimators_") else [classifier]
report = json.loads((ROOT / "artifacts" / "reference_evaluation.json").read_text())
categories = bundle["categories"]
numbers = [feature for feature in bundle["features"] if feature not in categories]
model = {
    "version": 1, "task": "fertilizer", "classes": classifier.classes_.tolist(),
    "numericFeatures": numbers, "categories": categories, "ranges": bundle["ranges"],
    "metrics": {"rows": report["source_rows"], "testRows": report["test_rows"],
                "testAccuracy": report["held_out_test"]["accuracy"],
                "cvAccuracy": report["validation_5_fold_on_training_only"][report["selected_model"]]["accuracy"]["mean"]},
    "trees": []
}
for estimator in estimators:
    tree = estimator.tree_
    model["trees"].append({"left": tree.children_left.tolist(), "right": tree.children_right.tolist(),
                           "feature": tree.feature.tolist(), "threshold": tree.threshold.tolist(),
                           "values": tree.value[:, 0, :].tolist()})
output = ROOT.parent / "src" / "ml" / "fertilizer-model.json"
output.write_text(json.dumps(model, separators=(",", ":"), allow_nan=False), encoding="utf-8")
# All 599 rows provide an independent runtime-parity fixture, not a new accuracy evaluation.
data = pd.read_csv(ROOT / "data" / "Fertilizer Prediction.csv")
data.columns = data.columns.str.strip()
data = data.rename(columns={"Temparature": "temperature", "Humidity": "humidity", "Moisture": "moisture",
    "Nitrogen": "nitrogen", "Potassium": "potassium", "Phosphorous": "phosphorus", "Soil Type": "soil_type", "Crop Type": "crop_type"})
features = numbers + list(categories)
probabilities = pipeline.predict_proba(data[features])
fixture = [{"input": row, "prediction": str(classifier.classes_[int(np.argmax(scores))]), "scores": scores.tolist()}
           for row, scores in zip(data[features].to_dict(orient="records"), probabilities)]
(ROOT / "artifacts" / "runtime_parity.json").write_text(json.dumps(fixture, separators=(",", ":")), encoding="utf-8")
print(f"Exported {len(model['trees'])} trees to {output} ({output.stat().st_size:,} bytes)")

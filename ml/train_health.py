"""Train on exported app samples, then export the health classifier into Expo."""
import argparse
import json
from pathlib import Path

import joblib
from soilsphere.core import train_health

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--data", type=Path, required=True)
parser.add_argument("--features", default="moisture_raw,nitrogen,phosphorus,potassium")
parser.add_argument("--artifacts", type=Path, default=ROOT / "artifacts")
parser.add_argument("--output-model", type=Path, default=ROOT.parent / "src" / "ml" / "health-model.json")
args = parser.parse_args()
features = [value.strip() for value in args.features.split(",")]
try:
    report = train_health(args.data, features, args.artifacts)
    bundle = joblib.load(args.artifacts / "health_model.joblib")
    forest = bundle["model"].named_steps["classifier"]
    model = {"version": 1, "task": "health", "classes": forest.classes_.tolist(),
             "numericFeatures": features, "categories": {}, "ranges": bundle["ranges"],
             "units": bundle["units"], "moistureCalibrationId": bundle.get("moisture_calibration_id"),
             "metrics": {"rows": report["total_rows"], "testRows": sum(report["test_rows_by_class"].values()),
                         "testAccuracy": report["held_out_test"]["accuracy"], "cvAccuracy": None},
             "trees": []}
    for estimator in forest.estimators_:
        tree = estimator.tree_
        model["trees"].append({"left": tree.children_left.tolist(), "right": tree.children_right.tolist(),
                               "feature": tree.feature.tolist(), "threshold": tree.threshold.tolist(),
                               "values": tree.value[:, 0, :].tolist()})
    output = args.output_model
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(model, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Health model exported to {output}. Refresh Expo to load it.")
except (ValueError, FileNotFoundError, KeyError) as error:
    parser.exit(2, f"Cannot train health model: {error}\n")

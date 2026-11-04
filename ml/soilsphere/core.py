"""Reproducible recommendation baseline and independently labeled health training."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.tree import DecisionTreeClassifier, export_text

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "Fertilizer Prediction.csv"
ARTIFACTS = ROOT / "artifacts"
NUMERIC = ["temperature", "humidity", "moisture", "nitrogen", "potassium", "phosphorus"]
CATEGORICAL = ["soil_type", "crop_type"]
SENSORS = NUMERIC + ["co2", "oxygen", "ph", "ec", "light", "moisture_raw"]
METADATA = ["timestamp", "sample_id", "condition", "label", "label_basis", "split"]
LOG_COLUMNS = METADATA + SENSORS + [f"{s}_unit" for s in SENSORS] + ["moisture_calibration_id"]
RENAME = {"Temparature": "temperature", "Humidity": "humidity", "Moisture": "moisture",
          "Nitrogen": "nitrogen", "Potassium": "potassium", "Phosphorous": "phosphorus",
          "Soil Type": "soil_type", "Crop Type": "crop_type", "Fertilizer Name": "fertilizer"}


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def reference_data():
    data = pd.read_csv(SOURCE)
    data.columns = data.columns.str.strip()
    data = data.rename(columns=RENAME)
    if data.isna().any().any() or data.duplicated().any():
        raise ValueError("Reference data contains missing or duplicate rows; review before training.")
    return data


def pipeline(features, estimator):
    numbers = [f for f in features if f not in CATEGORICAL]
    categories = [f for f in features if f in CATEGORICAL]
    transformers = []
    if numbers:
        transformers.append(("numeric", SimpleImputer(strategy="median"), numbers))
    if categories:
        transformers.append(("categories", OneHotEncoder(handle_unknown="error", sparse_output=False), categories))
    return Pipeline([("inputs", ColumnTransformer(transformers, verbose_feature_names_out=False)),
                     ("classifier", estimator)])


def forest():
    return RandomForestClassifier(n_estimators=200, max_depth=6, min_samples_leaf=3,
                                  class_weight="balanced", random_state=42, n_jobs=1)


def metrics(y, predicted):
    labels = sorted(set(y) | set(predicted))
    return {"accuracy": float(accuracy_score(y, predicted)),
            "balanced_accuracy": float(balanced_accuracy_score(y, predicted)),
            "class_order": labels,
            "confusion_matrix": confusion_matrix(y, predicted, labels=labels).tolist(),
            "per_class": classification_report(y, predicted, output_dict=True, zero_division=0)}


def ranges(data, features):
    return {f: {"min": float(data[f].min()), "max": float(data[f].max())}
            for f in features if f not in CATEGORICAL}


def train_reference(output=ARTIFACTS):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    data = reference_data()
    train_ids, test_ids = train_test_split(data.index, test_size=0.2, stratify=data.fertilizer, random_state=42)
    train, test = data.loc[train_ids], data.loc[test_ids]
    features = NUMERIC + ["soil_type"]
    variants = {
        "majority_baseline": (features, DummyClassifier(strategy="most_frequent")),
        "upstream_style_tree": (features, DecisionTreeClassifier(random_state=42)),
        "moisture_only": (["moisture"], forest()),
        "nutrients_only": (["nitrogen", "phosphorus", "potassium"], forest()),
        "sensors_only": (NUMERIC, forest()),
        "combined_with_soil": (features, forest()),
    }
    validation = {}
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    for name, (columns, estimator) in variants.items():
        result = cross_validate(pipeline(columns, estimator), train[columns], train.fertilizer,
                                cv=folds, scoring=["accuracy", "balanced_accuracy"], n_jobs=1)
        validation[name] = {key.removeprefix("test_"): {"mean": float(result[key].mean()),
                            "std": float(result[key].std())}
                            for key in ("test_accuracy", "test_balanced_accuracy")}
    # Choose between the predeclared full-input estimators using training-only CV.
    candidates = ["upstream_style_tree", "combined_with_soil"]
    selected = max(candidates, key=lambda name: validation[name]["balanced_accuracy"]["mean"])
    columns, estimator = variants[selected]
    model = pipeline(columns, estimator).fit(train[columns], train.fertilizer)
    predicted = model.predict(test[columns])
    bundle = {"kind": "fertilizer", "model": model, "features": columns,
              "ranges": ranges(train, columns), "sklearn_version": sklearn.__version__,
              "categories": {f: sorted(train[f].unique().tolist()) for f in CATEGORICAL if f in columns}}
    joblib.dump(bundle, output / "fertilizer_model.joblib")
    results = test.copy()
    results.insert(0, "source_row", test.index)
    results["predicted_fertilizer"] = predicted
    results.to_csv(output / "reference_test_predictions.csv", index=False)
    report = {"task": "fertilizer_classification_not_soil_health", "source_rows": len(data),
              "train_rows": len(train), "test_rows": len(test), "seed": 42,
              "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
              "sklearn_version": sklearn.__version__, "validation_5_fold_on_training_only": validation,
              "selected_model": selected, "held_out_test": metrics(test.fertilizer, predicted),
              "features": columns, "excluded_inputs": ["crop_type"],
              "training_ranges": bundle["ranges"], "categories": bundle["categories"],
              "limitations": ["No healthy/unhealthy, nutrient-excess, or no-fertilizer-needed labels.",
                              "NPK and moisture measurement units/methods are not specified by upstream.",
                              "Random row holdout: no pot/site/time metadata to test independent sites.",
                              "Dataset-only performance does not establish sensor or field accuracy.",
                              "Feature ablations assess predictive value; they do not prove interactions or causality.",
                              "No CO2 or oxygen training features."]}
    save_json(output / "reference_evaluation.json", report)
    # A shallow explanatory model is separate from the selected prediction model.
    tree = pipeline(features, DecisionTreeClassifier(max_depth=3, min_samples_leaf=5, random_state=42))
    tree.fit(train[features], train.fertilizer)
    names = tree.named_steps["inputs"].get_feature_names_out()
    (output / "illustrative_tree.txt").write_text(
        "Illustrative shallow tree, NOT the deployed classifier. Dataset scales; units unspecified.\n\n" +
        export_text(tree.named_steps["classifier"], feature_names=list(names)), encoding="utf-8")
    return report


def load_bundle(path, kind):
    bundle = joblib.load(path)
    if bundle["kind"] != kind:
        raise ValueError(f"Expected a {kind} model.")
    if bundle["sklearn_version"] != sklearn.__version__:
        raise ValueError("Model/library versions differ; retrain with the installed requirements.")
    return bundle


def finite_number(value, name):
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number, not a boolean.")
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"{name} must be a finite number.") from None
    if not math.isfinite(number):
        raise ValueError(f"{name} must be a finite number.")
    return number


def predict(bundle, values):
    row, warnings = {}, []
    for feature in bundle["features"]:
        if feature not in values or values[feature] in (None, ""):
            raise ValueError(f"Missing input: {feature}. Missing sensors are not replaced with invented values.")
        if feature in CATEGORICAL:
            value = values[feature]
            if value not in bundle["categories"][feature]:
                raise ValueError(f"Unknown {feature}: {value}. Choose from {bundle['categories'][feature]}.")
        else:
            value = finite_number(values[feature], feature)
            interval = bundle["ranges"][feature]
            if not interval["min"] <= value <= interval["max"]:
                warnings.append(f"{feature}={value} is outside training range {interval}.")
        row[feature] = value
    frame = pd.DataFrame([row], columns=bundle["features"])
    scores = bundle["model"].predict_proba(frame)[0]
    index = int(np.argmax(scores))
    classes = bundle["model"].classes_
    return {"prediction": str(classes[index]),
            "model_scores_not_calibrated_probabilities": {str(c): float(s) for c, s in zip(classes, scores)},
            "outside_training_range": bool(warnings), "warnings": warnings}


def predict_reference(payload, model_path=ARTIFACTS / "fertilizer_model.joblib"):
    if payload.get("input_source") not in ("reference_example", "sensor"):
        raise ValueError("Specify input_source as reference_example or sensor.")
    if payload["input_source"] == "sensor" and payload.get("dataset_scale_compatibility_confirmed") is not True:
        raise ValueError("Sensor compatibility is unconfirmed. Check measurement methods and units against a reference before enabling dataset_scale_compatibility_confirmed. Upstream does not document NPK units.")
    bundle = load_bundle(model_path, "fertilizer")
    result = predict(bundle, payload.get("readings", {}))
    result.update({"task": "fertilizer_recommendation", "input_source": payload["input_source"],
                   "soil_health": "not_assessed", "nutrient_excess_or_deficiency": "not_assessed",
                   "note": "Dataset-model suggestion; no application rate or verified agronomic prescription."})
    return result


def initialize_log(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", newline="", encoding="utf-8") as stream:
        csv.DictWriter(stream, fieldnames=LOG_COLUMNS).writeheader()


def upgrade_log_schema(path):
    """Preserve older measurements and back up before adding calibration columns."""
    path = Path(path)
    with path.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        headers, rows = reader.fieldnames, list(reader)
    if headers == LOG_COLUMNS:
        return
    additions = {"moisture_raw", "moisture_raw_unit", "moisture_calibration_id"}
    if headers != [f for f in LOG_COLUMNS if f not in additions]:
        raise ValueError("Log schema does not match. Initialize a new log rather than mixing formats.")
    backup = path.with_name(path.name + ".before-calibration-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    shutil.copy2(path, backup)
    with tempfile.NamedTemporaryFile(mode="w", newline="", encoding="utf-8", dir=path.parent, delete=False) as stream:
        writer = csv.DictWriter(stream, fieldnames=LOG_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
        temporary = stream.name
    os.replace(temporary, path)


def log_reading(path, payload):
    path = Path(path)
    if not str(payload.get("sample_id", "")).strip():
        raise ValueError("sample_id is required so separate pots can be reserved for testing.")
    label = payload.get("label", "")
    if label not in ("", "healthy", "unhealthy"):
        raise ValueError("label must be healthy, unhealthy, or empty; treatment is stored separately in condition.")
    if label and not str(payload.get("label_basis", "")).strip():
        raise ValueError("A labeled reading needs label_basis describing the independent assessment.")
    if payload.get("split", "unassigned") not in ("train", "test", "unassigned"):
        raise ValueError("split must be train, test, or unassigned.")
    timestamp = payload.get("timestamp") or datetime.now(timezone.utc).isoformat()
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if parsed.utcoffset() is None:
        raise ValueError("Timestamp must include a timezone, e.g. -05:00 or Z.")
    row = {f: payload.get(f, "") for f in METADATA}
    row["moisture_calibration_id"] = payload.get("moisture_calibration_id", "")
    row.update(timestamp=timestamp, split=payload.get("split", "unassigned"))
    values, units = payload.get("readings", {}), payload.get("units", {})
    if "moisture" in values and units.get("moisture") == "relative_percent" and not row["moisture_calibration_id"]:
        raise ValueError("Relative moisture must include the calibration ID.")
    if not values:
        raise ValueError("At least one sensor reading is required.")
    unknown = set(values) - set(SENSORS)
    if unknown:
        raise ValueError(f"Unrecognized sensor names: {sorted(unknown)}")
    for sensor, value in values.items():
        row[sensor] = finite_number(value, sensor)
        if not isinstance(units.get(sensor), str) or not units[sensor].strip():
            raise ValueError(f"Record the unit for {sensor}, e.g. raw_adc, ppm, or percent.")
        row[f"{sensor}_unit"] = units[sensor].strip()
    if not path.exists():
        initialize_log(path)
    upgrade_log_schema(path)
    with path.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != LOG_COLUMNS:
            raise ValueError("Log schema does not match. Initialize a new log rather than mixing formats.")
        for old in reader:
            if old["sample_id"] == str(payload["sample_id"]) and old["split"] != row["split"]:
                raise ValueError("A sample must stay in the same train/test split. Edit all of its rows together.")
            for sensor in values:
                if old[f"{sensor}_unit"] and old[f"{sensor}_unit"] != row[f"{sensor}_unit"]:
                    raise ValueError(f"Units changed for {sensor}. Convert readings consistently before logging.")
            if (row["moisture_calibration_id"] and old.get("moisture_calibration_id") and
                    row["moisture_calibration_id"] != old["moisture_calibration_id"]):
                raise ValueError("Moisture calibration changed. Use a new log or consistently reprocess preserved raw readings.")
    with path.open("a", newline="", encoding="utf-8") as stream:
        csv.DictWriter(stream, fieldnames=LOG_COLUMNS).writerow(row)
    return {"saved": str(path.resolve()), "sample_id": row["sample_id"], "label": label or "unlabeled",
            "calibration_warnings": payload.get("calibration_warnings", [])}


def health_data(path, features):
    if not features or len(set(features)) != len(features) or set(features) - set(SENSORS):
        raise ValueError(f"Choose unique sensor features from {SENSORS}; sample IDs and treatments cannot be inputs.")
    data = pd.read_csv(path, keep_default_na=False, dtype={f: str for f in METADATA + ["moisture_calibration_id"]})
    required = METADATA + features + [f"{f}_unit" for f in features]
    missing = set(required) - set(data.columns)
    if missing:
        raise ValueError(f"Missing log columns: {sorted(missing)}")
    data = data.copy()
    for field in ["sample_id", "label", "label_basis", "split"]:
        data[field] = data[field].astype(str).str.strip()
    if (data.sample_id == "").any():
        raise ValueError("Every row needs a sample_id.")
    if not set(data.label) <= {"", "healthy", "unhealthy"}:
        raise ValueError("Health labels must be healthy, unhealthy, or empty.")
    # Validate assignments before dropping unlabeled/incomplete rows.
    if (data.groupby("sample_id").split.nunique() > 1).any():
        raise ValueError("Sample leakage: a sample appears in multiple splits.")
    if not set(data.split) <= {"train", "test", "unassigned"}:
        raise ValueError("Unknown split; use train, test, or unassigned.")
    labeled = data[data.label != ""].copy()
    if (labeled.label_basis == "").any():
        raise ValueError("Every labeled row requires an independent label_basis.")
    if (labeled.split == "unassigned").any():
        raise ValueError("Assign every labeled sample to train or test before fitting.")
    for feature in features:
        labeled[feature] = pd.to_numeric(labeled[feature].replace("", np.nan), errors="raise")
    complete = labeled.dropna(subset=features).copy()
    if not np.isfinite(complete[features].to_numpy(dtype=float)).all():
        raise ValueError("Sensor values must be finite.")
    units = {}
    for feature in features:
        found = complete[f"{feature}_unit"].astype(str).str.strip().unique().tolist()
        if len(found) != 1 or not found[0]:
            raise ValueError(f"{feature} needs one consistent, nonempty unit across train and test.")
        units[feature] = found[0]
    if "moisture" in features and units["moisture"] == "relative_percent":
        if "moisture_calibration_id" not in complete:
            raise ValueError("Relative moisture needs its calibration ID.")
        profiles = complete.moisture_calibration_id.astype(str).str.strip().unique().tolist()
        if len(profiles) != 1 or not profiles[0]:
            raise ValueError("Relative moisture must use one recorded calibration across training and testing.")
    train, test = complete[complete.split == "train"], complete[complete.split == "test"]
    for subset, name, minimum in [(train, "train", 2), (test, "test", 1)]:
        if set(subset.label) != {"healthy", "unhealthy"}:
            raise ValueError(f"{name} must contain both healthy and unhealthy labeled samples.")
        for label in ("healthy", "unhealthy"):
            if subset.loc[subset.label == label, "sample_id"].nunique() < minimum:
                raise ValueError(f"{name} needs at least {minimum} separate samples for class {label}; this is a pilot minimum, not a reliability guarantee.")
    return train, test, units, {"total_rows": len(data), "unlabeled_rows": int((data.label == "").sum()),
                              "incomplete_labeled_rows": len(labeled) - len(complete)}


def train_health(path, features, output=ARTIFACTS):
    train, test, units, counts = health_data(path, features)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    model = pipeline(features, forest().set_params(class_weight=None))
    # Each pot receives the same total training weight despite differing logging rates.
    weights = 1 / train.groupby("sample_id").sample_id.transform("size")
    model.fit(train[features], train.label, classifier__sample_weight=weights)
    predicted = model.predict(test[features])
    results = test[METADATA + features].copy()
    results["prediction"] = predicted
    results.to_csv(output / "health_test_predictions.csv", index=False)
    pot_weights = 1 / test.groupby("sample_id").sample_id.transform("size")
    report = {"task": "locally_labeled_soil_health_pilot", "features": features, "units": units, **counts,
              "data_sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
              "train_rows_by_class": {str(k): int(v) for k, v in train.label.value_counts().items()},
              "test_rows_by_class": {str(k): int(v) for k, v in test.label.value_counts().items()},
              "train_samples": sorted(train.sample_id.unique().tolist()),
              "test_samples": sorted(test.sample_id.unique().tolist()),
              "held_out_test": metrics(test.label, predicted),
              "equal_sample_weighted_accuracy": float(accuracy_score(test.label, predicted, sample_weight=pot_weights)),
              "ablation_test_results": {},
              "notes": ["Labels are user-supplied assessments, not generated from fertilizer classes.",
                        "Entire samples are held out. Repeated readings are correlated.",
                        "Do not tune the model using this test report; reserve fresh samples after changes.",
                        "Ablation improvements do not alone prove sensor interactions."]}
    moisture_feature = "moisture" if "moisture" in features else "moisture_raw"
    for name, columns in [("moisture_only", [moisture_feature]),
                          ("nutrients_only", ["nitrogen", "phosphorus", "potassium"])]:
        columns = [f for f in columns if f in features]
        if columns:
            baseline = pipeline(columns, forest().set_params(class_weight=None)).fit(train[columns], train.label, classifier__sample_weight=weights)
            report["ablation_test_results"][name] = {"features": columns, **metrics(test.label, baseline.predict(test[columns]))}
    majority = DummyClassifier(strategy="most_frequent").fit(train[features], train.label, sample_weight=weights)
    report["ablation_test_results"]["majority_baseline"] = metrics(test.label, majority.predict(test[features]))
    bundle = {"kind": "health", "model": model, "features": features, "units": units,
              "ranges": ranges(train, features), "sklearn_version": sklearn.__version__}
    if "moisture" in features and units["moisture"] == "relative_percent":
        bundle["moisture_calibration_id"] = str(train.moisture_calibration_id.iloc[0])
        report["moisture_calibration_id"] = bundle["moisture_calibration_id"]
    joblib.dump(bundle, output / "health_model.joblib")
    save_json(output / "health_evaluation.json", report)
    return report


def predict_health(payload, model_path=ARTIFACTS / "health_model.joblib"):
    bundle = load_bundle(model_path, "health")
    if bundle.get("moisture_calibration_id") and payload.get("moisture_calibration_id") != bundle["moisture_calibration_id"]:
        raise ValueError("Moisture calibration differs from training. Reuse the training calibration or retrain.")
    if any(payload.get("units", {}).get(f) != unit for f, unit in bundle["units"].items()):
        raise ValueError(f"Prediction units must match training units: {bundle['units']}")
    result = predict(bundle, payload.get("readings", {}))
    result["task"] = "locally_labeled_soil_health_pilot"
    result["status"] = "outside_training_range_review" if result["outside_training_range"] else "pilot_prediction"
    return result

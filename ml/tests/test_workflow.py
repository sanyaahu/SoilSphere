"""Checks focus on leakage, false diagnoses, input compatibility, and actual fitting."""
import csv
import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

from soilsphere.core import (LOG_COLUMNS, ROOT, health_data, initialize_log, log_reading,
                             predict_health, predict_reference, reference_data, train_health)
from soilsphere.calibration import (load_profile, make_profile, prepare_reading, relative_moisture, save_profile)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.log = self.root / "readings.csv"

    def payload(self, **changes):
        value = {"sample_id": "001", "condition": "reference", "split": "train",
                 "readings": {"moisture": 42}, "units": {"moisture": "raw_adc"}}
        value.update(changes)
        return value

    def write_fixture(self):
        # Synthetic values exercise software only; no example health dataset is delivered.
        for label, base in [("healthy", 30), ("unhealthy", 70)]:
            for index in range(3):
                for repeat in range(3):
                    log_reading(self.log, self.payload(
                        sample_id=f"{label}-{index}", label=label, label_basis="software test fixture",
                        split="test" if index == 2 else "train",
                        readings={"moisture": base + repeat, "nitrogen": base + index},
                        units={"moisture": "raw_adc", "nitrogen": "test_units"}))

    def test_upstream_columns_are_normalized_without_inventing_health_labels(self):
        data = reference_data()
        self.assertEqual(len(data), 599)
        self.assertIn("humidity", data)
        self.assertNotIn("label", data)
        self.assertNotIn("healthy", set(data.fertilizer))

    def test_sensor_inference_requires_compatibility_before_loading_model(self):
        with self.assertRaisesRegex(ValueError, "compatibility is unconfirmed"):
            predict_reference({"input_source": "sensor", "readings": {}}, self.root / "absent.joblib")

    def test_unlabeled_logging_preserves_real_reading_and_units(self):
        log_reading(self.log, self.payload())
        with self.log.open(newline="", encoding="utf-8") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(rows[0]["sample_id"], "001")
        self.assertEqual(rows[0]["label"], "")
        self.assertEqual(rows[0]["moisture_unit"], "raw_adc")
        self.assertEqual(rows[0]["nitrogen"], "")

    def test_initialize_does_not_overwrite_measurements(self):
        initialize_log(self.log)
        with self.assertRaises(FileExistsError):
            initialize_log(self.log)

    def test_labels_need_an_independent_basis(self):
        with self.assertRaisesRegex(ValueError, "label_basis"):
            log_reading(self.log, self.payload(label="healthy"))

    def test_log_rejects_missing_units_nonfinite_and_unknown_sensors(self):
        for change in [{"units": {}}, {"readings": {"moisture": float("nan")}},
                       {"readings": {"moisture": True}}, {"readings": {"O2": 20.9}}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                log_reading(self.log, self.payload(**change))

    def test_log_rejects_unit_changes_and_sample_leakage(self):
        log_reading(self.log, self.payload())
        for change in [{"units": {"moisture": "percent"}}, {"split": "test"}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                log_reading(self.log, self.payload(**change))

    def test_training_rejects_leakage_even_in_manually_edited_csv(self):
        self.write_fixture()
        data = pd.read_csv(self.log)
        data.loc[0, "split"] = "test"
        data.to_csv(self.log, index=False)
        with self.assertRaisesRegex(ValueError, "leakage"):
            health_data(self.log, ["moisture"])

    def test_training_rejects_treatment_or_identifier_features(self):
        with self.assertRaisesRegex(ValueError, "sensor features"):
            health_data(self.log, ["condition"])

    def test_health_fit_predict_and_unit_check(self):
        self.write_fixture()
        output = self.root / "models"
        report = train_health(self.log, ["moisture", "nitrogen"], output)
        self.assertTrue(set(report["train_samples"]).isdisjoint(report["test_samples"]))
        self.assertEqual(report["total_rows"], 18)
        payload = {"readings": {"moisture": 31, "nitrogen": 31},
                   "units": {"moisture": "raw_adc", "nitrogen": "test_units"}}
        result = predict_health(payload, output / "health_model.joblib")
        self.assertIn(result["prediction"], ("healthy", "unhealthy"))
        payload["units"]["nitrogen"] = "mg/kg"
        with self.assertRaisesRegex(ValueError, "units must match"):
            predict_health(payload, output / "health_model.joblib")

    def test_health_rejects_missing_sensors_and_flags_outside_range(self):
        self.write_fixture()
        train_health(self.log, ["moisture"], self.root)
        model = self.root / "health_model.joblib"
        with self.assertRaisesRegex(ValueError, "Missing input"):
            predict_health({"readings": {}, "units": {"moisture": "raw_adc"}}, model)
        result = predict_health({"readings": {"moisture": 1000}, "units": {"moisture": "raw_adc"}}, model)
        self.assertEqual(result["status"], "outside_training_range_review")

    def test_calibration_handles_both_probe_directions_and_keeps_outside_values(self):
        # These are software fixtures, not suggested calibration readings.
        descending = make_profile([599, 600, 601], [299, 300, 301], "test", "test fixture")
        ascending = make_profile([299, 300, 301], [599, 600, 601], "test", "test fixture")
        for profile in (descending, ascending):
            self.assertEqual(relative_moisture(profile["dry_raw"], profile), 0)
            self.assertEqual(relative_moisture(profile["wet_raw"], profile), 100)
            self.assertEqual(relative_moisture(450, profile), 50)
        self.assertGreater(relative_moisture(100, descending), 100)

    def test_calibration_rejects_noisy_overlapping_and_insufficient_references(self):
        for dry, wet in [([1], [4]), ([1, 2, 3], [2, 3, 4]), ([1, 1, 1], [1, 1, 1])]:
            with self.subTest(dry=dry), self.assertRaises(ValueError):
                make_profile(dry, wet, "test", "fixture")

    def test_raw_moisture_can_be_logged_before_calibration_and_npk_defaults_to_mgkg(self):
        payload = self.payload(readings={"moisture_raw": 450, "nitrogen": 20}, units={})
        prepared = prepare_reading(payload, self.root / "no-profile.json")
        self.assertNotIn("moisture", prepared["readings"])
        self.assertEqual(prepared["units"]["nitrogen"], "mg/kg")
        log_reading(self.log, prepared)

    def test_calibration_preserves_raw_values_and_rejects_unit_conflicts(self):
        path = self.root / "calibration.json"
        profile = make_profile([599, 600, 601], [299, 300, 301], "test", "fixture")
        save_profile(profile, path)
        payload = self.payload(readings={"moisture_raw": 450}, units={"moisture_raw": "raw_sensor_units"})
        prepared = prepare_reading(payload, path)
        self.assertEqual(prepared["readings"], {"moisture_raw": 450, "moisture": 50})
        self.assertEqual(prepared["moisture_calibration_id"], profile["calibration_id"])
        self.assertNotIn("moisture", payload["readings"])
        self.assertEqual(prepare_reading(prepared, path), prepared)
        payload["units"]["moisture_raw"] = "millivolts"
        with self.assertRaisesRegex(ValueError, "Raw moisture unit"):
            prepare_reading(payload, path)

    def test_calibration_profile_cannot_be_silently_edited(self):
        path = self.root / "calibration.json"
        profile = make_profile([599, 600, 601], [299, 300, 301], "test", "fixture")
        save_profile(profile, path)
        profile["dry_raw"] = 650
        path.write_text(json.dumps(profile), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "changed without a new ID"):
            load_profile(path)

    def test_legacy_log_is_backed_up_and_real_values_preserved(self):
        original = [c for c in LOG_COLUMNS if c not in ("moisture_raw", "moisture_raw_unit", "moisture_calibration_id")]
        with self.log.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=original)
            writer.writeheader()
            writer.writerow({"sample_id": "001", "split": "train", "moisture": 42, "moisture_unit": "raw_adc"})
        before = self.log.read_bytes()
        log_reading(self.log, self.payload())
        backups = list(self.root.glob("readings.csv.before-calibration-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), before)
        with self.log.open(newline="", encoding="utf-8") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["sample_id"], "001")
        self.assertEqual(float(rows[0]["moisture"]), 42)

    def test_health_model_rejects_changed_calibration_at_prediction(self):
        self.write_fixture()
        data = pd.read_csv(self.log, keep_default_na=False)
        data["moisture_unit"] = "relative_percent"
        data["moisture_calibration_id"] = "test-calibration-id"
        data.to_csv(self.log, index=False)
        train_health(self.log, ["moisture"], self.root)
        payload = {"readings": {"moisture": 40}, "units": {"moisture": "relative_percent"},
                   "moisture_calibration_id": "different-id"}
        with self.assertRaisesRegex(ValueError, "calibration differs"):
            predict_health(payload, self.root / "health_model.joblib")

    def test_health_training_works_with_raw_moisture_before_calibration(self):
        self.write_fixture()
        data = pd.read_csv(self.log, keep_default_na=False)
        data["moisture_raw"] = data["moisture"]
        data["moisture_raw_unit"] = data["moisture_unit"]
        data["moisture"] = ""
        data["moisture_unit"] = ""
        data.to_csv(self.log, index=False)
        report = train_health(self.log, ["moisture_raw", "nitrogen"], self.root)
        self.assertEqual(report["ablation_test_results"]["moisture_only"]["features"], ["moisture_raw"])
        result = predict_health({"readings": {"moisture_raw": 31, "nitrogen": 31},
                                 "units": {"moisture_raw": "raw_adc", "nitrogen": "test_units"}},
                                self.root / "health_model.joblib")
        self.assertIn(result["prediction"], ("healthy", "unhealthy"))


if __name__ == "__main__":
    unittest.main()

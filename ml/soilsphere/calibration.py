"""Relative moisture calibration from measured dry/wet reference readings."""
import hashlib
import json
import math
import statistics
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_PROFILE = Path(__file__).resolve().parent.parent / "data" / "moisture_calibration.json"


def number(value):
    if isinstance(value, bool):
        raise ValueError("Moisture readings must be finite numbers.")
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError("Moisture readings must be finite numbers.") from None
    if not math.isfinite(result):
        raise ValueError("Moisture readings must be finite numbers.")
    return result


def make_profile(dry_readings, wet_readings, sensor_id, soil, raw_unit="raw_sensor_units"):
    dry, wet = [number(v) for v in dry_readings], [number(v) for v in wet_readings]
    if len(dry) < 3 or len(wet) < 3:
        raise ValueError("Take at least three settled readings for each dry/wet reference.")
    if not all(str(v).strip() for v in (sensor_id, soil, raw_unit)):
        raise ValueError("Record the sensor ID, soil description, and raw unit.")
    if not (max(dry) < min(wet) or max(wet) < min(dry)):
        raise ValueError("Dry/wet reference ranges overlap. Let readings settle and check the setup.")
    profile = {"kind": "relative_moisture_two_reference", "sensor_id": sensor_id.strip(),
               "soil": soil.strip(), "raw_unit": raw_unit.strip(), "output_unit": "relative_percent",
               "dry_raw": statistics.median(dry), "wet_raw": statistics.median(wet),
               "dry_readings": dry, "wet_readings": wet,
               "created_utc": datetime.now(timezone.utc).isoformat(),
               "meaning": "0=dry reference, 100=chosen wet reference; not volumetric water content"}
    profile["calibration_id"] = hashlib.sha256(json.dumps(profile, sort_keys=True).encode()).hexdigest()[:16]
    return profile


def save_profile(profile, path=DEFAULT_PROFILE):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = path.with_name(path.name + ".before-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
        backup.write_bytes(path.read_bytes())
    path.write_text(json.dumps(profile, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def load_profile(path=DEFAULT_PROFILE):
    profile = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if profile.get("kind") != "relative_moisture_two_reference" or profile.get("output_unit") != "relative_percent":
        raise ValueError("Unsupported moisture calibration profile.")
    if number(profile["dry_raw"]) == number(profile["wet_raw"]) or not profile.get("calibration_id"):
        raise ValueError("Invalid moisture calibration endpoints or ID.")
    content = {key: value for key, value in profile.items() if key != "calibration_id"}
    expected = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()[:16]
    if profile["calibration_id"] != expected:
        raise ValueError("Calibration profile changed without a new ID. Create it again from measured references.")
    return profile


def relative_moisture(raw, profile):
    dry, wet, value = number(profile["dry_raw"]), number(profile["wet_raw"]), number(raw)
    if dry == wet:
        raise ValueError("Dry and wet references must differ.")
    percent = 100 * (value - dry) / (wet - dry)
    if not math.isfinite(percent):
        raise ValueError("Calibration result is not finite.")
    return percent


def prepare_reading(payload, profile_path=DEFAULT_PROFILE):
    """Keep raw data and derive relative moisture only when a profile exists."""
    result = deepcopy(payload)
    readings, units = result.setdefault("readings", {}), result.setdefault("units", {})
    for nutrient in ("nitrogen", "phosphorus", "potassium"):
        if nutrient in readings and not units.get(nutrient):
            units[nutrient] = "mg/kg"
    if "moisture_raw" not in readings:
        return result
    units.setdefault("moisture_raw", "raw_sensor_units")
    if not Path(profile_path).exists():
        return result
    profile = load_profile(profile_path)
    if units["moisture_raw"] != profile["raw_unit"]:
        raise ValueError("Raw moisture unit differs from the calibration profile.")
    derived = relative_moisture(readings["moisture_raw"], profile)
    if "moisture" in readings:
        if (units.get("moisture") != "relative_percent" or
                result.get("moisture_calibration_id") != profile["calibration_id"] or
                not math.isclose(number(readings["moisture"]), derived, rel_tol=1e-9, abs_tol=1e-9)):
            raise ValueError("Supplied moisture conflicts with raw reading/current calibration.")
    readings["moisture"] = derived
    units["moisture"] = "relative_percent"
    result["moisture_calibration_id"] = profile["calibration_id"]
    result["calibration_warnings"] = [] if 0 <= derived <= 100 else [
        "Moisture lies outside the dry/wet reference span. Value preserved, not clipped."]
    return result

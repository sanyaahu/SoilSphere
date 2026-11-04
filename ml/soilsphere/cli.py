import argparse
import json
from pathlib import Path

from .core import ARTIFACTS, ROOT, initialize_log, log_reading, predict_health, predict_reference, train_health, train_reference
from .calibration import DEFAULT_PROFILE, make_profile, prepare_reading, save_profile


def main():
    parser = argparse.ArgumentParser(description="SoilSphere capstone: reference fertilizer model and local sensor health model")
    commands = parser.add_subparsers(dest="command", required=True)
    reference = commands.add_parser("train-reference", help="Train and evaluate the upstream fertilizer dataset")
    reference.add_argument("--output", type=Path, default=ARTIFACTS)
    demo = commands.add_parser("demo", help="Run a clearly marked reference-dataset example")
    demo.add_argument("--input", type=Path, default=ROOT / "examples" / "reference_reading.json")
    for name in ("predict-reference", "predict-health"):
        predict = commands.add_parser(name)
        predict.add_argument("--input", required=True, type=Path)
        predict.add_argument("--model", type=Path)
        if name == "predict-health":
            predict.add_argument("--calibration", type=Path, default=DEFAULT_PROFILE)
    init = commands.add_parser("init-log")
    init.add_argument("--output", type=Path, default=ROOT / "data" / "sensor_readings.csv")
    log = commands.add_parser("log")
    log.add_argument("--input", required=True, type=Path)
    log.add_argument("--output", type=Path, default=ROOT / "data" / "sensor_readings.csv")
    log.add_argument("--calibration", type=Path, default=DEFAULT_PROFILE)
    calibration = commands.add_parser("calibrate-moisture", help="Save measured dry/wet references for a relative moisture scale")
    calibration.add_argument("--dry-readings", required=True, help="At least three comma-separated measured readings")
    calibration.add_argument("--wet-readings", required=True)
    calibration.add_argument("--sensor-id", required=True)
    calibration.add_argument("--soil", required=True)
    calibration.add_argument("--raw-unit", default="raw_sensor_units")
    calibration.add_argument("--output", type=Path, default=DEFAULT_PROFILE)
    health = commands.add_parser("train-health")
    health.add_argument("--data", required=True, type=Path)
    health.add_argument("--features", required=True, help="Comma-separated sensor names, e.g. moisture,nitrogen,phosphorus,potassium")
    health.add_argument("--output", type=Path, default=ARTIFACTS)
    args = parser.parse_args()
    try:
        if args.command == "train-reference":
            result = train_reference(args.output)
        elif args.command in ("demo", "predict-reference", "predict-health"):
            payload = json.loads(args.input.read_text(encoding="utf-8-sig"))
            model = getattr(args, "model", None)
            fn = predict_health if args.command == "predict-health" else predict_reference
            if args.command == "predict-health":
                payload = prepare_reading(payload, args.calibration)
            result = fn(payload, model) if model else fn(payload)
            if args.command == "demo":
                result["demo"] = "Bundled dataset example, not a live sensor reading or soil-health result."
        elif args.command == "init-log":
            initialize_log(args.output)
            result = {"created": str(args.output.resolve())}
        elif args.command == "log":
            payload = prepare_reading(json.loads(args.input.read_text(encoding="utf-8-sig")), args.calibration)
            result = log_reading(args.output, payload)
        elif args.command == "calibrate-moisture":
            result = make_profile(args.dry_readings.split(","), args.wet_readings.split(","),
                                  args.sensor_id, args.soil, args.raw_unit)
            save_profile(result, args.output)
        else:
            result = train_health(args.data, [f.strip() for f in args.features.split(",")], args.output)
        print(json.dumps(result, indent=2, allow_nan=False))
    except (ValueError, FileNotFoundError, FileExistsError, KeyError) as error:
        parser.exit(2, f"Cannot complete {args.command}: {error}\n")


if __name__ == "__main__":
    main()

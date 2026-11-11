# SoilSphere phone app

An Expo/React Native frontend for the capstone sensor, with an offline fertilizer model, direct ESP32 readings, moisture calibration, and persistent collection of health-training samples. The model is integrated into this Expo app; no desktop Python window is needed.

## Model, calibration, and data collection

The fertilizer model's temperature (°C) and relative humidity (%) inputs come from the SCD30 CO₂ sensor's `temperature` and `humidity` readings. **Advisor → Fertilizer model → My sensors** shows those measured values explicitly. CO₂ concentration in ppm is not a fertilizer-model feature. Missing temperature or humidity blocks prediction rather than substituting an example reading. This wiring is specific to the fertilizer model; it does not change health-model training or sample export.

Start the existing app with `npm start` and reload it in Expo Go. Open the **Advisor** tab (models are below the current observations) and press **Run model example** to run the bundled 200-tree classifier immediately, without an API key or Python server. The **Dataset example** is explicitly separate from **My sensors**. In the sensor view, choose the soil type; crop selection is no longer required. The retrained model uses NPK, moisture, temperature, humidity, and soil type. The original CSV retains its crop column for provenance, but training and prediction exclude it. Missing measurements are never filled with dataset averages or preview values. The fertilizer dataset does not document how its NPK/moisture values were measured, so sensor comparisons are marked experimental. A fertilizer class is not converted into a healthy/unhealthy label or a fertilizer application rate.

The **Device** tab has moisture calibration. Enter at least three actual settled ADC readings for dry soil and three for your chosen wet-soil reference. Describe the soil and wetting/drainage procedure. The saved scale is relative: dry reference = 0%, wet reference = 100%; it is not volumetric water content. Profiles are tied to the device ID. Raw readings and out-of-span values are preserved. N/P/K are recorded in mg/kg. You can collect and train with raw moisture before calibration is ready.

In **Advisor → Save a training sample**, enter a stable pot ID and treatment. Leave the health label empty until you have an assessment supporting it. Select train/test groups by whole pot, not individual readings. Actual samples and calibration are saved on the phone using AsyncStorage. Demo and stale readings cannot be saved as real samples. **Export saved samples as CSV** downloads the file on web or opens the phone's share sheet with CSV text. Save that text as `sensor_readings.csv` on your computer. You can finish labels, label_basis, and whole-pot train/test assignments in the exported CSV before training; treatment names alone do not establish health.

Files inside this app:

| Item | Location |
| --- | --- |
| Phone's trained fertilizer model | `src/ml/fertilizer-model.json` |
| Public fertilizer dataset (599 rows) | `ml/data/Fertilizer Prediction.csv` |
| Validation and test results | `ml/artifacts/reference_evaluation.json` |
| Python training code | `ml/soilsphere/` |
| Python model and exporter | `ml/artifacts/fertilizer_model.joblib`, `ml/export_model.py` |
| Your collected samples | Phone/browser local storage, then your exported CSV |
| Health model | `src/ml/health-model.json` (experimental three-class demo using partly synthetic moisture data) |

The phone model matches Python predictions and class scores on all 599 source rows. That is a runtime consistency check, not additional evidence of accuracy. Evaluation uses 479 training rows, 5-fold training-only model comparisons, and 120 reserved test rows: the model without crop input scores 86.6% mean validation accuracy and 95.0% test accuracy. The previous crop-dependent version scored 88.3% and 95.8% respectively on the same splits. These are public-dataset fertilizer scores, not soil-health or sensor-validation scores. Removing the crop input does not establish suitability for every plant or soil.

### Experimental soil-condition demo

The Model tab now includes **Soil-condition model** with **Examples** and **My sensors** views. The bundled 200-tree demo uses calibrated moisture and N/P/K in mg/kg and displays **Healthy**, **Could be better**, or **Unhealthy**. Example cases run offline without hardware. Live comparisons require a fresh device reading, complete NPK, and a device-reported moisture percentage (0% is valid) or a saved app calibration. App calibration overrides the firmware percentage when available; raw ADC alone still needs calibration. Missing measurements are never replaced by example values. Values outside calibration bounds block comparison; values outside the training range display warnings.

The data contains 26 measured NPK triples and 10 recorded moisture percentages, plus 16 explicitly synthetic moisture values. Provisional labels encode the user's experimental definitions: dry/waterlogged or 3 tbsp fertilizer is unhealthy; 1-2 tbsp with 40-60% moisture is healthy; remaining intermediate cases could be better. These labels do not establish plant health or recommended fertilizer doses. There are 6 healthy, 14 unhealthy, and 6 could-be-better rows, split into 18 training and 8 demonstration-test pots. No real-world accuracy is claimed. The original experiment's calibration profile is unavailable, so live comparisons remain exploratory even when the current device is calibrated.

Source data and assumptions are preserved in `ml/data/health-demo/`. `ml/artifacts/health_demo_parity.json` verifies phone/Python runtime agreement on all 26 rows. Demo outputs never become labels in saved real training samples automatically. The independent-data trainer below remains a separate binary healthy/unhealthy pipeline; it does not accept synthetic demo labels as validated health evidence.

To train a replacement health model after exporting independently labeled data, set up the optional local Python environment in this app:

```powershell
python -m venv ml/.venv
./ml/.venv/Scripts/python.exe -m pip install -r ml/requirements.txt
./ml/.venv/Scripts/python.exe ml/train_health.py --data ml/data/sensor_readings.csv --features moisture_raw,nitrogen,phosphorus,potassium
```

Add `co2,oxygen,temperature,humidity` to the selected features when those measurements are available. Training requires both labels, at least two training pots per class and one independent test pot per class as a minimal pilot guard. It compares the combined model with moisture-only and nutrient-only versions. A successful run exports the trained health forest into the app; refresh Expo to load it. Health predictions check sensor units and, when used, the calibration ID. Do not tune on the reserved test pots. Soil and crop conditions outside your experiment need separate validation.

To retrain/export the public model:

```powershell
cd ml
./.venv/Scripts/python.exe -m soilsphere train-reference
./.venv/Scripts/python.exe export_model.py
cd ..
```

Attribution: the fertilizer dataset and original approach come from [akhil-b-26/crop-fertilizer-recommendation-ml](https://github.com/akhil-b-26/crop-fertilizer-recommendation-ml), revision `be1112ee7fee8734c6be07b57ffdf6ec3e52eb3e`. Its MIT notice is retained in `ml/UPSTREAM_LICENSE`; measurement units and source provenance are not further established by that repository.

Checks: `npm run test:ml`, `npm run test:api`, `npm run typecheck`, and `npm run lint`. Python training checks: `./ml/.venv/Scripts/python.exe -m unittest discover -s ml/tests -v`.

## Open in VS Code

Open [soilsphere.code-workspace](soilsphere.code-workspace), or run `code soilsphere.code-workspace` from this folder. Use two VS Code terminals:

```powershell
npm install
npm run api
```

```powershell
npm start
```

Scan the Expo QR code with Expo Go to preview the screens. Without configuration, the app uses clearly labeled sample readings. TypeScript can be checked with `npm run typecheck`; the local API contract can be checked with `npm run test:api`.

## Connect the phone to the local API

For a phone connection, open **Device → Connect your ESP32** and enter the IP printed by Arduino Serial Monitor after Wi-Fi connects (115200 baud). The address is saved on the phone and takes priority over `EXPO_PUBLIC_ESP32_URL`. The app requests `/sensors`, waits up to eight seconds to accommodate firmware NPK retries, and shares concurrent requests rather than opening duplicate connections. A failed request is shown with its address and error; preview fallback is not silently presented as live. Existing calibration and saved samples are retained when adding this setting.

To distinguish Wi-Fi/phone access from app issues, open `http://<ESP32-IP>/sensors` in the phone's browser. It should show JSON readings. A USB connection to the computer does not itself provide a network connection from the phone. The phone's Wi-Fi must permit access to the ESP32. The app can show a live partial reading even before NPK is installed; missing nutrient values remain empty and block fertilizer inference until measured.

Set `EXPO_PUBLIC_ESP32_URL` to your ESP32's address (currently `http://172.26.160.8`). It reads `/sensors` directly every three seconds and retains up to 100 live readings for trends. It never appends demo records to live history. When contact is lost, the last measurement is identified as stale and blocked from sample collection. Native Expo Go can read the device on the same reachable network; web previews additionally require the ESP32 to allow browser requests from that origin.

For the optional backend, copy `.env.example` to `.env` and change `EXPO_PUBLIC_API_URL` to `http://<your-computer-LAN-IP>:8787`. The phone and computer must be on the same network. Restart Expo after changing `.env`. Backend and device requests have timeouts, and backend unavailability does not prevent a direct ESP32 request.

## Send sensor measurements

Set a secret in the terminal before starting the API:

```powershell
$env:INGEST_TOKEN='replace-with-a-long-random-token'
npm run api
```

The ESP32 or a bridge sends `POST http://<computer-LAN-IP>:8787/readings` with `Content-Type: application/json`, `X-Ingest-Token: <token>`, and this JSON body:

```json
{
  "deviceId": "bed-01",
  "timestamp": "2026-09-23T12:00:00Z",
  "nitrogenMgKg": 38,
  "phosphorusMgKg": 32,
  "potassiumMgKg": 58,
  "moisturePercent": 34,
  "lightLux": 39000,
  "co2Ppm": 720,
  "oxygenPercent": 19.8,
  "batteryPercent": 84
}
```

Only `deviceId` and `timestamp` are required. Send `null` or omit any sensor field not yet installed. Units are part of the field names. The API validates ranges, timestamps readings, retains the latest 100 measurements in memory, and exposes them through `GET /readings`. The ESP32 firmware will need to map the selected NPK probe's registers and units to this payload. This first integration path uses Wi-Fi; BLE would require a native development build and a separate transport adapter.

## Advisor and recommendations

The Advisor screen has local trend rules that work without an AI key. They flag missing NPK data, a large change between samples, or rising moisture with falling oxygen, and recommend confirming the pattern before acting. These are observation rules, not calibrated nutrient deficiency claims. NPK values are labeled as estimates.

Tap the 💬 button on the Advisor tab to open the chat. The phone sends chat questions to the local server's `POST /chat`. The server grounds answers in its latest reading, and keeps API credentials off the phone. With no provider configured, chat gives a local summary. For OpenAI, set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and optionally `OPENAI_MODEL`. For Claude, set `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and the enabled `ANTHROPIC_MODEL`. See `server/.env.example`. Set these as server environment variables before `npm run api`; do not use `EXPO_PUBLIC_` for secrets.

The local server is a development bridge. Before deployment, move it to a secured host with user authentication, HTTPS, persistent storage, and rate limiting. Pump control is intentionally not exposed until firmware safety limits and an emergency stop are implemented.

# SoilSphere phone app

An Expo/React Native frontend for the capstone sensor. It runs with sample readings now and has a local HTTP path for ESP32 data and an optional OpenAI or Claude advisor.

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

Copy `.env.example` to `.env`. Change `EXPO_PUBLIC_API_URL` to `http://<your-computer-LAN-IP>:8787`. The phone and computer must be on the same network. Restart Expo after changing `.env`. The `Device` screen shows whether data are demo or live. The app refreshes every 30 seconds and supports pull to refresh.

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

The phone sends chat questions to the local server's `POST /chat`. The server grounds answers in its latest reading, and keeps API credentials off the phone. With no provider configured, chat gives a local summary. For OpenAI, set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and optionally `OPENAI_MODEL`. For Claude, set `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and the enabled `ANTHROPIC_MODEL`. See `server/.env.example`. Set these as server environment variables before `npm run api`; do not use `EXPO_PUBLIC_` for secrets.

The local server is a development bridge. Before deployment, move it to a secured host with user authentication, HTTPS, persistent storage, and rate limiting. Pump control is intentionally not exposed until firmware safety limits and an emergency stop are implemented.

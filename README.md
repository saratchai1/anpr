# Suvarnabhumi ANPR + Flight Arrivals (DEMO)

A frontend-only, no-backend concept application combining two ANPR checkpoints and inbound-flight pickup planning for Suvarnabhumi Airport (BKK).

**Status: DEMO / NOT LIVE.** All flight numbers, flight times, ANPR plates, CCTV events and alerts are invented. Nothing here is connected to AOT, operational CCTV, airport security, or a payment/enforcement system.

## Run

Open `index.html` in a modern browser. The prototype has no dependencies, no build step, no login, no backend, no health check, and no API key. It can also be hosted as a static website on Vercel (Framework Preset: Other; project root: `.`).

## Features

- Operations overview with flight arrivals, flight delays and ANPR exceptions.
- BKK arrivals flight board: original scheduled time, revised ETA / actual arrival, delays, status, search and filters.
- Pickup planning: estimated meeting time after immigration/baggage, adjustable driving time and buffer, suggested leave-home time.
- Two ANPR gate checkpoints, travel-time anomalies (>30 minutes), mock CCTV corroboration, three-level review workflow, case export as CSV.
- Scenario controls, mock data, and localStorage persistence for ANPR simulations.

**Important:** Elapsed time between two cameras does **not** establish that a vehicle parked, stopped illegally, or posed a threat. Only independently verified CCTV evidence can substantiate stop-related cases. All alerts require human review; the application never issues actual fines or security actions.

## Future AOT API integration

Flight records go through the single adapter in `src/flight-provider.js`.

The normalized flight object has fields:

```js
{
  id, flightNo, airline, origin, originCode,
  scheduledAt, estimatedAt, actualAt,
  status, belt, terminal, source
}
```

Once AOT supplies endpoint specifications, credentials, legal permissions and update intervals:

1. Create a **server-side** proxy (e.g. Vercel Function `/api/flights`) to call the authorized AOT endpoint. **Do not put AOT API keys in frontend JS or Vercel variables prefixed `VITE_`.**
2. Implement the documented AOT response-to-normalized-object mapping in the proxy, with explicit timezone `Asia/Bangkok`, codeshare handling, cancellations, data freshness, and error handling. Do not guess the schema.
3. Replace `FlightProvider.getArrivals()` demo implementation with a call to the proxy, include a `source` label and last-updated time, and provide an explicit unavailable/stale state.
4. Only change the UI's **DEMO** labeling after verified live data is supplied and the operational deployment is authorized.

Official public reference: https://suvarnabhumi.airportthai.co.th/flight?type=arrivals

## ANPR demo checkpoint coordinates

- Camera 1 (entry): `13.649323184689877, 100.74713256767531`
- Camera 2 (exit): `13.709441941455099, 100.7693773608348`

They are shown as labeled checkpoints only, not proof of a particular road route or any security-sensitive sightline.

## Privacy / safety

Only non-identifying TEST plates are included. Production use requires data protection review, role-based access, audit logging, retention limits and validated camera evidence. Do not treat mock detections or automated scores as factual security findings.

## Repository layout

- `index.html` — document shell
- `styles.css` — responsive presentation dashboard
- `src/flight-provider.js` — normalized demo flight data and future API boundary
- `src/app.js` — UI, interaction, ANPR simulator, case export

# Airport Intelligence — ANPR + BKK Flight DEMO v1.2.0

Frontend-only demonstration. Open `index.html` in a modern browser, or serve this directory with `python3 -m http.server 8080`. Static deployment on Vercel; no build, login, backend, camera credentials or AOT API key needed.

**Everything except the user-supplied camera coordinates and public basemap is simulated.** No real flight feed, GPS tracking, CCTV, dispatch, fine or watchlist connection exists.

## Preserved and restored screens

Overview; Map & Diagrams; Flight Arrivals; Pickup Planner; ANPR Monitoring; Security Exceptions; Cases & Evidence; Analytics; Configuration. Maps remain interactive, with both original camera coordinates, demo layers, collision-separated vehicle markers and an accessible vehicle selector. A blocked Leaflet download shows a schematic fallback without blocking the other screens.

## Review fixes

- `src/store.js` is the shared source of truth for every screen. Versioned validation/migration skips malformed entries and recovers corrupt data. In-memory mode works when localStorage is denied. Storage events and BroadcastChannel synchronize same-origin browser tabs; Web Locks serialize persistent writes where supported. This is **not multi-user, multi-device or server storage**. Without Web Locks, simultaneous writes have only best-effort coordination. Browser data is user-editable and not a secure audit trail.
- Vehicle movement and case lifecycle are separate. A case retains its peak observed severity/score after exit, policy changes or new observations. New → review → dispatched (simulated) → closed; closing and reopening require reasons. Exported DEMO evidence contains observations, policy, timeline and case history, never fabricated camera images.
- Passage/missing-exit alone is at most a time warning. Enforcement requires an observed stop at/above the configurable threshold **and** a recognized demo zone. Security review requires the longer stop threshold in that zone. Risk weights change scores, not evidence gates. A zero-minute stop is not a stop violation. Historical case levels do not silently decrease.
- Case popups open the selected vehicle, not an unfiltered list. All controls are keyboard reachable; native dialogs handle focus and Escape.
- Flight scenarios: on-time, +60/+120 minutes from scheduled arrival, landed, cancelled, restore baseline. Pickup advice updates immediately. The demo seed time persists through reloads; reset restores a fresh set. Times include dates and use Asia/Bangkok.

## AOT integration boundary

`src/flight-provider.js` normalizes `{id, flightNo, airline, origin, originCode, scheduledAt, estimatedAt, actualAt, status, belt, terminal, source, updatedAt}`. When AOT provides authorized access, add a server-side proxy and map the documented schema. Keep keys on the server; do not guess an endpoint, remove DEMO labels before verification, or silently substitute simulated values for failed live data. Add authentication, role controls, retention, audit integrity, rate limiting and stale-data handling before operational use.

## Rules / time interpretation

Default thresholds are **illustrative**: passage >30 minutes; missing exit >=45 minutes; observed stop >=5 minutes; longer stop >=15 minutes. Zones A/B are invented demonstration circles, not approved airport security perimeters. Two ANPR points cannot establish illegal parking, vehicle position between cameras, or hostile intent. The map's dashed line is not a road route. Case closure is an operator decision and not triggered by an exit event.

## Files

- `index.html`, `styles.css`, `spatial.css`, `review-fixes.css` — responsive UI.
- `src/store.js` — validation, rules, persistence, synchronization, cases and policy history.
- `src/flight-provider.js` — simulated arrivals and pickup calculations.
- `src/spatial.js` — retained map, schematic, workflow, analytics.
- `src/app.js` — views, case dialog, scenario controls and exports.

The prior version is retained in Git history at `0293ad8`. The production site is `https://anpr-suvarnabhumi.vercel.app/`; source is `https://github.com/saratchai1/anpr`.

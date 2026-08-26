# Bikepacking Expedition Planner

Waypoint turns two places and a realistic riding profile into a practical multi-day cycling expedition for first-time bikepackers. The planner returns a real cycling route, balanced daily stages, elevation, riding-time estimates, feasibility warnings, a map, and a GPX 1.1 export.

Built for **The WebMCP Challenge**. The human planner remains usable in browsers without WebMCP; supported runtimes also receive the same planning capabilities as structured tools.

Live demo: https://bikepacking-expedition-planner.netlify.app

## MVP capabilities

- Point-to-point trips of 2–7 days
- Start and destination autocomplete, plus map-click coordinates with reverse geocoding
- Road, gravel, touring, and MTB bike choices
- Paved-priority or mixed-surface route intent
- Settlement-aware stage endpoints with a balanced route-point fallback
- Per-stage distance, ascent, descent, and estimated riding time
- Expedition summary, feasibility warnings, and full-route elevation profile
- Metric or Imperial display, with Metric as the default
- IndexedDB restore of the latest successful plan
- Full-route GPX export with elevation when available
- Curated San Francisco → Santa Cruz, Amsterdam → Brussels, and Bandung → Pangandaran examples

## WebMCP tools

When `document.modelContext.registerTool()` is available, Waypoint registers:

- `search_locations(query)`
- `set_trip_parameters(...)`
- `generate_expedition_plan()`
- `get_expedition_plan()`

Tool inputs are validated with the shared contracts. The read-only tools return compact canonical data rather than raw provider payloads or route-point arrays. If a live provider fails for a known curated example, a pipeline-generated cached route may be shown and is visibly marked as cached.

## Stack

- Vue 3, Vite, and TypeScript
- Pinia and Vue Router
- Leaflet and Chart.js
- Tailwind CSS and Zod
- Netlify Standard Functions
- Native `fetch()` provider adapters

Provider roles are deliberately narrow: openrouteservice handles cycling routing and route elevation, GraphHopper handles forward/reverse geocoding, and OpenStreetMap Overpass supplies settlement corridors.

## Local development

Requirements: Node.js `22.13.0` and npm.

Create `.env` with server-side provider credentials:

```dotenv
ORS_API_KEY=your-openrouteservice-key
GRAPHHOPPER_API_KEY=your-graphhopper-key
```

Then run:

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:8888`. Provider credentials are read only by Netlify Functions and must not use `VITE_*` names.

For a localhost-only Docker preview:

```bash
docker compose -f compose.dev.yaml up --build
```

The default URL is `http://127.0.0.1:13240`; override it with `BIKEPACKING_HOST_PORT` if that port is occupied. Docker is a development preview only; production uses Netlify.

## Verification

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run provider:validate` is an on-demand live smoke check for the selected provider stack and should not be used as a normal CI gate.

## Deployment

Netlify uses `npm run build`, publishes `dist`, and loads Functions from `netlify/functions`. Configure `ORS_API_KEY` and `GRAPHHOPPER_API_KEY` as server-side Netlify environment variables. The `/api/*` rewrites are defined in `netlify.toml` before the SPA fallback.

## License

Apache License 2.0.

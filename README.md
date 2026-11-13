# No Mapa

*No mapa* is Portuguese for “on the map”. A route planner for hiking and cycling, rebuilt on a modern stack. Inspired by and partly ported from [nakarte.me](https://nakarte.me) ([source](https://github.com/wladich/nakarte)) by Sergey Orlov.

Live: [alexe.pt/maps](https://alexe.pt/maps/).

## Why

nakarte.me is one of the most convenient route planners around, but it has no routing along roads and trails, let alone routing that respects surface type; it is built on Leaflet 1.0 and Knockout; and some of its data sources no longer work.

## What it does

**Planning**
- Routing along ways with a self-hosted [BRouter](https://github.com/abrensch/brouter) and four profiles: Road, Gravel, MTB, Hike. Road and gravel follow cycle infrastructure by default (calibrated against the Strava heatmap, see [docs/routing-calibration-2026-11-12.md](docs/routing-calibration-2026-11-12.md)).
- Settings: surface (more asphalt / any / more dirt), climbs, a steepness limit; for hiking the hardest path allowed on the SAC scale (T2 to T5-T6), signed routes, forest and water, quiet.
- “May use”: steps, ferries, main roads, unpaved, footpaths; an unticked item is never used.
- Editing on the map: click to add, drag to move, drag the line to insert, double-click to delete, undo and redo, reverse, out and back, back to start, straight segments (Shift+click or B), checkpoints with a type, name and note.
- Where the router snapped a point to the nearest usable way, a thin dashed link joins the marker to the route, so nothing looks like a break.
- A finished route asks for a name; length, ascent, descent and time are shown beside it.

**Reading a route**
- Summary: length, time (bikes: average speed plus climbing; hiking: DIN 33466, as on Alpine trail signs), ascent and descent, surface shares.
- Elevation profile with grade colours on the chart and the map line. The scale follows the route type: ±3 % is flat on a road bike, ±10 % on foot.
- Route timeline in two views: key stretches (climbs, steep pitches, straight legs, long surface runs, checkpoints) or everything.

**Map**
- Base maps: OSM variants (OSM, CyclOSM, OpenTopoMap and others), mapy.com (incl. winter), Google, ESRI, Bing, Yandex; overlays: cycling and hiking routes, mountain passes, GPS traces, Ride with GPS heatmap.
- 2D | 3D: terrain from the open Terrarium tiles, tilt and turn with buttons, a draggable compass, Q/E and Shift+arrows.

**Routes and files**
- Routes are saved in the browser; My routes groups them by type with the creation date. With an account (Google or Authelia) they sync to the server.
- GPX/KML import. An imported track opens as a route: its own line and elevation, surfaces matched from the map, the type taken from the GPX activity.
- GPX export, short links to share, sending to Garmin Connect (beta).

The full list, with the expected behaviour of each case: [docs/use-cases.md](docs/use-cases.md).

## Stack

- Svelte 5, TypeScript, Vite
- MapLibre GL JS (Yandex tiles are reprojected from EPSG:3395 on the fly)
- BRouter with generated profiles (`nk-road`, `nk-gravel`, `nk-mtb`, `nk-hike`) for routing, AWS Terrain Tiles for elevation and 3D
- A small FastAPI backend (maps-api): routing queue and cache, accounts and sync, short links, Garmin

## Development

```bash
npm install
cp .env.example .env   # optional keys: Google Map Tiles, mapy.com
npm run dev            # http://localhost:5173/maps/
npm test               # unit tests
npm run check          # types
```

Layers whose key is missing are hidden.

End-to-end checks of every use case (Python Playwright with Chromium; the dev server must be running):

```bash
python3 tools/e2e/usecases.py              # all; or ids: A1 B4
BASE=https://alexe.pt/maps/ python3 tools/e2e/usecases.py
```

Results go to [docs/use-cases-run.md](docs/use-cases-run.md).

## License

MIT, see [LICENSE](LICENSE). Code ported from nakarte keeps its original MIT copyright notice.

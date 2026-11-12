# Routing calibration against real riding: plan

Goal: tune the bike profiles (road, gravel, MTB) so routes go where cyclists actually ride, not only where the OSM tags look good. "Where people ride" is measured with two signals.

## Signals

1. **Strava global heatmap.** Tiles from strava.com with your account, in your Chrome, on strava.com itself. Rides only, grey style (`sport_Ride/gray`), zoom 14 at @2x (512 px, about 5 m per pixel at 52°N). Brightness = popularity. From these tiles, only the ones along the test corridors are downloaded, a few hundred to about 2000. The download is slow (about 1 tile per second), and the tiles are kept only on this Mac (`~/nakarte-next/calibration/heat/`, not in git, not on the server).
2. **Your own rides.** From Strava through the Strava connector (only your activities, read-only). For each ride, the router builds a route between the same start and end. The result is compared with the actual track.

## Test set

- **About 30 of your rides** (Lisbon, trips). Each is cut into legs of 8–15 km by points on the actual track: a leg checks the choice of way between two points, not the whole trip.
- **8 known cycle routes** across Europe (from routing-cycleways-2026-11-12.md).
- **About 10 urban and suburban legs** in places with both busy roads and parallel paths: Berlin, Munich, Paris, Lisbon, Amsterdam.

The set is split randomly into calibration (70%) and check (30%). Parameters are chosen on the first part and reported on the second, so they do not fit to the particular routes.

## Metrics per route

- **Heat score**: length-weighted mean brightness along the route (sample every 20 m, brightest pixel within 2 px, about 10 m), as a percentile of the brightness in the same tiles.
- **Cold share**: share of the length where the brightness is below the 20th percentile: places almost nobody rides.
- **Match with your ride** (for your own rides): share of the route within 25 m of the actual track, and share of the track covered by the route.
- **Detour**: length relative to the default profile and to the shortest route.
- Infrastructure shares as in the cycleway test: cycle infrastructure, own path, busy roads without infrastructure, unpaved.

**Objective per profile:** maximise heat score + match − 0.5 × cold share, with no route more than 15% longer than the shortest. Unpaved share stays within limits set per profile: road < 5%, gravel and MTB not limited.

## Parameters to search

Profile parameters already available per request, so the grid needs no rebuilds:

- `nk_cycle_pen` (1.5–3);
- `nk_busy_pen` (1–2.5);
- `nk_quiet_cap` and `nk_gravel_cap` (gravel);
- `nk_surf_k`.

The search is a coarse grid of about 50 combinations per profile, then a finer one around the best. About 50 legs × 50 combinations × 3 profiles is about 7500 router requests. A temporary second BRouter does this in roughly 30–60 minutes and leaves the live one alone.

## Output

- `docs/routing-calibration-<date>.md`:
  - chosen values;
  - before and after on the check routes;
  - routes that stay bad, with links that open them in No Mapa next to the heatmap layer.
- The values go into profiles/gen.py; the route cache is reset (`ROUTE_CACHE_VER`).
- The script stays in `tools/calibrate/` to rerun after map updates. Heat tiles are kept, so a rerun only downloads new corridors.

## Not covered

- Heatmap brightness also reflects commuting and racing, not only pleasant riding. Your own rides balance that.
- MTB singletrack popularity is weakly visible in the "Ride" heatmap. MTB uses the `sport_MountainBikeRide` layer, if it is available with your account.

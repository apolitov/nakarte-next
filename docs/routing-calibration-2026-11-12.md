# Routing calibration against the Strava heatmap, 12 Nov 2026

The plan is in routing-calibration-plan.md. This round used only the Strava global heatmap (no personal rides), road and gravel profiles.

## Test set

- 72 random legs of 8–14 km in 24 regions: Lisbon, Sintra, Porto, Madrid, Girona, Mallorca, Provence, Paris, Brussels, Utrecht, Cologne, Berlin, Munich, Innsbruck, Zurich, Vienna, Prague, Milan, Tuscany, Copenhagen, Warsaw, Moscow, Dolomites, Black Forest.
- The 13 legs over 2 km of Vyacheslav's route east of Berlin.
- Each leg was routed with 17 variants, for road and for gravel: 2754 router requests, 75 failed (mountains, water), 1115 different routes.
- Legs were split by id into calibration (70%) and check (30%).

## How routes were scored

- **Heatmap.** Strava global heatmap, grayscale tiles z13 @2x (about 3–4 m per pixel): `sport_Ride` for road, `sport_GravelRide` for gravel. Sampled every 20 m along the route, taking the brightest pixel within 2 px. The tiles were read in a strava.com tab of the owner's browser and kept only in its memory; only the numbers per route left it.
- **Metrics per route:**
  - heat: mean brightness divided by the best variant of the same leg;
  - cold: share of the route below 16 of 255 (almost nobody rides there);
  - detour: length divided by the shortest variant;
  - time: router time, seconds.
- **Score:** heat − 0.5 × cold − 0.5 × detour over 5%.

## Variants

- off: no preference for cycle infrastructure.
- pen P, busy B: ways without cycle infrastructure cost P times more, busy roads (trunk to tertiary) without it B times more again.
- mult M, busy B: cycle infrastructure costs M times less (not below 1), busy roads without it B times more.

## Results (check set; the calibration set ranks the same way)

| Profile, variant | heat | cold | detour | router time p50 / max |
|---|---|---|---|---|
| Road, off | 0.936 | 0.023 | 1.017 | 0.4 / 3.1 s |
| Road, pen 2.0 busy 1.5 (deployed before) | 0.965 | 0.026 | 1.076 | 0.7 / 3.9 s |
| **Road, pen 2.0 busy 1.0** | **0.990** | **0.021** | 1.042 | 0.6 / 3.8 s |
| Road, mult 0.5 busy 1.0 | 0.960 | 0.023 | 1.019 | 0.3 / 2.3 s |
| Gravel, off | 0.880 | 0.107 | 1.017 | 0.4 / 2.2 s |
| Gravel, pen 2.0 busy 1.5 (deployed before) | 0.889 | 0.113 | 1.055 | 0.5 / 3.9 s |
| **Gravel, pen 2.0 busy 1.0** | **0.924** | **0.098** | 1.055 | 0.6 / 3.1 s |
| Gravel, mult 0.5 busy 1.0 | 0.897 | 0.106 | 1.036 | 0.5 / 2.2 s |

## Conclusions

- Following cycle infrastructure brings routes closer to where people ride: heat rises from 0.936 to 0.990 on road and from 0.880 to 0.924 on gravel.
- An extra penalty for busy roads makes routes worse by the heatmap, in every combination. Riders do use main roads, often ones without mapped cycle lanes. The busy-road penalty is now 1.0, which means off; it stays a parameter.
- The cost-penalty form (pen) beats the discount form (mult) on heat. The discount is faster on hard mountain legs: the leg from Passo Giau down took 53 s with pen 2.0 and 15 s with mult 0.6. On the test legs both were fast (p50 under 1 s, max 5 s).
- On Vyacheslav's legs all variants are close (heat 0.98–1.00). With pen 2.0 the gravel route uses more cycle infrastructure: 0.77 against 0.47 with the preference off.

## Deployed

Road and gravel: `nk_cycle=1`, `nk_cycle_pen=2.0`, `nk_busy_pen=1.0`, `nk_cycle_mult=1.0`. MTB and hike unchanged. The route cache was reset (`ROUTE_CACHE_VER=p4`).

## Next round

- Penalty 2.5 and 3.0, and gravel caps (`nk_gravel_cap`, `nk_quiet_cap`) on the same set.
- More mountain legs, to weigh router time against heat.
- `sport_MountainBikeRide` for MTB.
- Raw data on this Mac only: `calibration/routes.json`, `calibration/scores.json` (not in git). Scripts in `tools/calibrate/`: `gen_routes.py` runs inside maps-api against a temporary second BRouter (`brouter-test`) and writes `/data/calib/routes.json`; `score_heatmap.js` runs in a strava.com tab (put the token from `/data/calib/token` in place of `__TOKEN__`); `analyse.py routes.json scores.json` prints the tables. The exchange endpoint (`stacks/maps-api/app/calib.py` and the `/maps/api/calib/*` path in Caddy, vps repo) was removed after this round and its data deleted on the server; restore both from git history (vps commit 8c4f69e) for the next round.

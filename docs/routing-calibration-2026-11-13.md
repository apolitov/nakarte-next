# Routing calibration, round 2, and the surface slider, 13 Nov 2026

Method as in routing-calibration-2026-11-12.md: routes scored by the Strava global heatmap along them. Heatmap layers: `sport_Ride` for road, `sport_GravelRide` for gravel, `sport_MountainBikeRide` for MTB.

## Test set

- The 85 legs of round 1.
- 36 mountain legs in 12 regions: Chamonix, Andorra, Picos de Europa, Sierra Nevada, High Tatras, Julian Alps, Lake Garda, Tramuntana, Krasnaya Polyana, Vosges, Harz, Dolomites east.
- 3510 router requests (281 failed: mountains, water), 1433 different routes, 2166 heatmap tiles.

## Results (check set, 30% of the legs)

| Profile, variant | heat | cold | detour | router time p50 / max |
|---|---|---|---|---|
| Road, off | 0.937 | 0.057 | 1.008 | 0.5 / 3.0 s |
| Road, pen 2.0 (deployed before) | 0.984 | 0.053 | 1.080 | 0.6 / 4.0 s |
| Road, pen 3.0 | 0.994 | 0.052 | 1.122 | 0.7 / 4.5 s |
| **Road, pen 1.5 + discount 0.6** | **0.987** | **0.053** | **1.078** | **0.5 / 3.1 s** |
| Gravel, off | 0.874 | 0.121 | 1.038 | 0.4 / 2.6 s |
| Gravel, pen 2.0, caps 1.1 / 1.3 (deployed) | 0.907 | 0.113 | 1.073 | 0.5 / 2.8 s |
| Gravel, pen 3.0, no gravel cap | 0.934 | 0.102 | 1.111 | 0.6 / 4.0 s |
| MTB, stock | 0.807 | 0.397 | 1.008 | 0.3 / 5.3 s |
| MTB, prefer dirt ×1.5 | 0.782 | 0.413 | 1.039 | 0.3 / 6.2 s |
| **MTB, follow cycle infrastructure (pen 1.6)** | **0.862** | **0.387** | 1.025 | 0.3 / 6.2 s |

On the calibration set the order is the same, except for the gravel variants. There, penalty 2.5–3.0 gives 1–2% more heat than 2.0, the gravel and quiet-road caps change places between the sets, and mountain legs take up to 25 s against 19 s.

## Decisions

- **Road:** penalty 1.5 plus a 0.6 discount for cycle infrastructure (deployed). Same heat as penalty 2.0, a little shorter, faster.
- **Gravel:** unchanged (penalty 2.0, caps 1.1 / 1.3). The gain from a stronger penalty is within noise, it costs length and time, and riders found the road penalty too strong already; asphalt preference is now set by the surface slider.
- **MTB:** following cycle infrastructure matches the MTB heatmap clearly better than the stock profile, and preferring dirt matches it worse. Not changed: MTB was set to route as stock by decision of 12 Nov; this is for the owner to decide.

## Surface slider (gravel profile)

Positions → parameters (lib/brouter.ts, `SURFACE_PARAMS`):

| Position | Parameters |
|---|---|
| Asphalt only | `nk_surface=-1, nk_surf_k=6, nk_cycle_pen=1.2` |
| More asphalt | `nk_surface=-1, nk_cycle_pen=1.4` |
| Any | none |
| More dirt | `nk_surface=1` |
| Trails | `nk_surface=1, nk_surf_k=5, nk_cycle_pen=1` |

Shares of route length by kind of way, gravel profile.

40 lowland and hill legs:

| Position | unpaved | cycle infrastructure | plain road without it | length vs Any |
|---|---|---|---|---|
| Asphalt only | 3% | 48% | 48% | +3% |
| More asphalt | 6% | 53% | 39% | −1% |
| More asphalt with the old penalty 2.0 | 5% | 60% | 33% | +1% |
| Any | 9% | 61% | 30% | 0 |
| More dirt | 29% | 57% | 21% | +4% |
| Trails | 47% | 30% | 26% | +6% |

54 mountain legs and the legs of Vyacheslav's route:

| Position | unpaved | length vs Any |
|---|---|---|
| Asphalt only | 19% | +5% |
| More asphalt | 26% | 0 |
| Any | 38% | 0 |
| More dirt | 49% | −5% |
| Trails | 65% | −4% |

Unpaved share rises monotonically from one end of the slider to the other in both sets. With "More asphalt" the eased penalty removes the detours around short stretches of road without a cycle lane: routes are 2% shorter than with the old penalty on the lowland legs. On the mountain legs the old penalty gave shorter routes (−4%), so the gain is not universal.

## Clean-up

The temporary exchange endpoint was removed again, the data deleted on the server and the test router stopped. Raw data stays on this Mac in `calibration/r2/`.

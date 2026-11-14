# Routing calibration, round 3: how strongly to follow cycle infrastructure, 14 Nov 2026

Question: should "Follow cycleways" pull much harder, "almost a negative cost"? BRouter needs a cost of at least 1 a metre, so a stronger pull means a higher cost of the ways without cycle infrastructure, relative to it.

## Method

- Legs: the 130 calibration legs of rounds 1–2 (24 city and countryside regions, 12 mountain regions, Vyacheslav's legs east of Berlin), 874 routes of 936 (the rest: water, mountains).
- Profiles as deployed on 14 Nov (oneway, cobblestone and boardwalk fixes included). Strength = cost of ordinary ways / cost of cycle infrastructure: Road now 2.5 (penalty 1.5, discount 0.6), Gravel now 2.
- Heat: the Ride with GPS heatmap (z14), as the app's own "Stick to the heatmap", not Strava as in rounds 1–2, so the numbers compare across variants, not with earlier rounds. In city centres it is hot almost everywhere, so most of the difference comes from outside them.
- heat: route heat / best variant of the leg. cold: share of the route nobody rides. detour: length / shortest variant. Cycle infra: our nk_is_cycle (includes sharrows and signed routes); real infra: cycleways, `bicycle=designated`, lanes and tracks only.
- Scripts: `tools/calibrate/cycle_strength.py` (routes, on the server), scoring in the app page.

## Results, city and countryside legs

| Profile, strength | heat | cold | detour | cycle infra | real infra | router time p50 / max |
|---|---|---|---|---|---|---|
| Road, off | 0.899 | 0.019 | 1.004 | 0.37 | 0.25 | 0.5 / 3.2 s |
| **Road, ×2.5 (now)** | 0.946 | 0.018 | 1.066 | 0.61 | 0.44 | 0.6 / 3.8 s |
| Road, ×4 | 0.966 | 0.018 | 1.113 | 0.68 | 0.50 | 0.7 / 5.3 s |
| Road, ×6 | 0.975 | 0.018 | 1.181 | 0.75 | 0.54 | 0.8 / 12.2 s |
| Gravel, off | 0.836 | 0.029 | 1.017 | 0.39 | 0.27 | 0.5 / 2.5 s |
| **Gravel, ×2 (now)** | 0.917 | 0.024 | 1.047 | 0.63 | 0.43 | 0.6 / 2.8 s |
| Gravel, ×4 | 0.948 | 0.024 | 1.101 | 0.70 | 0.48 | 0.6 / 3.6 s |
| Gravel, ×6 | 0.978 | 0.022 | 1.193 | 0.77 | 0.51 | 0.8 / 4.0 s |

With the mountain legs (all legs): Gravel ×6 router time up to 16.7 s.

How often a leg gets much longer than now:

| Variant | legs > 10% longer | legs > 25% longer | p90 | worst |
|---|---|---|---|---|
| Road ×4 | 12 of 115 | 5 | 1.12 | 1.43 (Porto) |
| Road ×6 | 37 of 115 | 18 | 1.32 | 1.57 (Girona) |
| Gravel ×4 | 15 of 103 | 6 | 1.12 | 1.56 (Madrid) |
| Gravel ×6 | 31 of 102 | 21 | 1.53 | 2.81 (High Tatras) |

## Reading

- A stronger pull does follow the heatmap better: Gravel +3% heat at ×4, +6% at ×6; Road +2% and +3%.
- It costs length, unevenly: on average +5–15%, but at ×6 one leg in five gets more than 25% longer and the worst nearly three times longer. Most of the extra infrastructure is not real infrastructure (real infra grows 0.43 → 0.51, all cycle infra 0.63 → 0.77).
- Score of rounds 1–2 (heat − 0.5·cold − 0.5·detour over 5%): Road now 0.916, ×4 0.909, ×6 0.888; Gravel now 0.901, ×4 0.912, ×6 0.889. Gravel ×4 is a little ahead, Road stays.

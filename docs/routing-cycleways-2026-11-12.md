# Cycle infrastructure in routing, 12 Nov 2026

Road and gravel follow cycle infrastructure by default; MTB and hiking route as their stock profiles. The "Follow cycleways" switch in the route settings turns it off (`nk_cycle=0`).

## What counts as cycle infrastructure

- Ways built for bikes: `highway=cycleway`, `bicycle=designated` (shared foot and cycle paths), cycle streets (`bicycle_road`, `cyclestreet`).
- Lanes and tracks along a road: `cycleway`, `cycleway:right`, `cycleway:left`, `cycleway:both` = lane, track, shared_lane and similar.
- Signed cycle routes of any level: international, national, regional, local.

Before this change, ways with `bicycle=designated` were not counted, so most of the main cycle paths in Berlin did not count either. Local signed routes only counted where they overlapped a regional one.

## Costs

Every way without cycle infrastructure costs `nk_cycle_pen` = 2.0 times more. Busy roads (trunk, primary, secondary, tertiary) without infrastructure cost `nk_busy_pen` = 1.5 times more again. Both values can be changed per request: `profile:nk_cycle_pen`, `profile:nk_busy_pen`.

## Test on known cycle routes

Eight routes, start to finish as one leg:

- Elbe: Dresden–Meissen;
- Danube: Melk–Krems;
- Berlin Hbf–Glienicke Bridge;
- Lisbon riverside: Cais do Sodré–Belém;
- Amsterdam–Haarlem;
- Isar: Munich–Wolfratshausen;
- Canal de l'Ourcq: La Villette–Claye-Souilly;
- Copenhagen–Roskilde.

Totals over all 8 routes. The percentages are shares of the route's length on each kind of way.

| Profile, setting | km | On cycle infrastructure | Own cycle path | Busy road without infrastructure |
|---|---|---|---|---|
| Road, off | 203.6 | 57% | 29% | 40% |
| Road, 1.6 | 206.5 | 95% | 61% | 6% |
| **Road, 2.0 / busy 1.5** | 211.9 | **98%** | 56% | **3%** |
| Road, 2.5 / busy 2.0 | 212.4 | 98% | 56% | 2% |
| Gravel, off | 216.0 | 75% | 53% | 7% |
| Gravel, 1.6 | 216.0 | 95% | 63% | 3% |
| **Gravel, 2.0 / busy 1.5** | 217.2 | **96%** | 64% | **3%** |
| Gravel, 2.5 / busy 2.0 | 217.6 | 97% | 65% | 3% |

Road profile, before and after:

- **Danube.** Busy roads made up 94% of the route; now 1%.
- **Lisbon riverside.** Busy roads made up 91%; now 0%.
- **Isar.** Busy roads made up 61%; now 3%.

The cost is a few percent longer routes.

**Known weak spot.** The gravel route Berlin Hbf–Glienicke still has 11% on busy roads, also with stronger penalties: there is no cycle infrastructure through some stretches.

## How it was measured

A temporary second BRouter with the test profiles on the same map data; legs requested from inside maps-api. The script classified every stretch by its OSM tags from BRouter's `messages` table.

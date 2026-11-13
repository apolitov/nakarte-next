# Gaps in road routes east of Berlin, 13 Nov 2026

Area: alexe.pt/maps/#m=12/52.39393/13.70504 (lon 13.53–13.88, lat 52.33–52.46: Müggelsee,
Dahme, Seddinsee, Zeuthen, Erkner). Profile nk-road, live API. 12 random routes of 7 points,
legs of 1.5–5 km, 72 legs; plus the saved 92 km route (gravel, 39 legs) from the planner.
Scripts: the scratchpad of this session (gaps/run.py); not kept.

## What a gap can be, and what was found

| Kind | How checked | Result |
|---|---|---|
| Leg starts or ends away from its point (snapping) | point to first or last route point | median 36 m, p75 78 m, p90 154 m, max 789 m; 120 of 144 ends further than 10 m |
| Two legs do not meet at a shared point | end of leg i to start of leg i+1 | random routes: 0 of 60 over 5 m; the 92 km route: 1 of 38, **41 m** at point 27 (52.36521, 14.03284) |
| Holes inside a leg | consecutive route points further than 500 m apart | 19, all along straight ways with no OSM nodes in between (checked tags: service road, track, path); not holes |
| Failed legs | HTTP errors | 0 of 72 |

The planner draws each leg from where the router put it and leaves the waypoint marker where it
was clicked. Nothing connects them, so every snap and every mismatch shows as a break on the map:
a marker off the line, or two line ends that do not touch.

The 41 m case reproduces with today's router: the same point is matched 41 m away for the leg
that arrives and 4 m away for the leg that leaves (different ways near the point), so the two
legs end and start in different places.

## Detours (not gaps, but they look odd)

29 of 72 legs are more than twice the straight distance (+0.5 km). Compared with gravel and hike:

- 20 go round water (the area is mostly lakes and rivers): walking has to go round too.
- 9 are the road profile avoiding unpaved ways: e.g. 2.2 km by gravel becomes 8.1 km on tarmac
  (52.4162, 13.5847 → 52.4114, 13.6136), 9.1 km becomes 18.2 km (52.3401, 13.7257 → 52.3629, 13.6831).

Points dropped in a forest snap to the nearest way, which for a road bike can be a grass path
(cost 30 000/km) or a very bad track: the route then starts on it.

## Fix options

1. Draw a thin dashed connector from each marker to where its legs start and end, and between two
   legs that do not meet (as brouter-web and komoot show snapped points). Cheap, honest, closes
   every visible break.
2. Also move the marker onto the road after routing (snap the waypoint). Removes most connectors,
   but changes the point the person chose and does not fix the in/out mismatch.
3. Warn when a point is far (> 200 m) from anything the profile can use.

# Use cases of the planner

What people do in No Mapa, grouped by goal. Each case has an id; the end-to-end check with the
same id is in `tools/e2e/usecases.py` (run `python3 tools/e2e/usecases.py` with the dev server
running). Cases marked *manual* are not automated.

Actors: **planner** (anonymous, the main one), **signed-in user** (sync, Garmin), **link
recipient** (opens a shared route).

```
                          ┌───────────────────────────── No Mapa ─────────────────────────────┐
                          │ A Plan   B Configure   C Understand   D See the map   E Manage    │
 planner ───────────────▶ │ draw     type          summary        base, overlays   My routes   │
                          │ edit     surface…      profile        colours          rename      │
                          │ shapes   hike, may use timeline       3D               delete, new │
                          │ name     …             grades         …                …           │
                          │ F Import, export, share      G Help and errors      H Phone        │
 signed-in user ────────▶ │ GPX in/out, track→route, link, Garmin, sync          sheet, taps   │
 link recipient ────────▶ │ open a shared link                                                │
                          └───────────────────────────────────────────────────────────────────┘
```

## A. Plan a route

| Id | Use case | Steps | Expected |
|---|---|---|---|
| A1 | Draw a route | D, click two points on the map | 2 waypoints; route along ways; summary with km, time, ↑↓; profile card |
| A2 | Move a point | drag a waypoint | route recomputed, length changes |
| A3 | Insert a point | drag the line between two points | one more waypoint |
| A4 | Remove points | double-click a waypoint; Backspace | the point goes; Backspace removes the last |
| A5 | Undo and redo | ⌘Z, ⌘⇧Z | previous and next states of the points |
| A6 | Reverse | R or the toolbar button | start and finish swap, length the same |
| A7 | Out and back, back to start | menu next to Reverse | out and back doubles the length; back to start closes the loop |
| A8 | Straight segments | Shift+click; B then click; Esc | straight leg in the summary ("Straight line"); Esc leaves the B mode |
| A9 | Checkpoint | P, click, name it | checkpoint in the timeline |
| A10 | Too long leg | a point more than 100 km away | red message about the 100 km limit |
| A11 | Name a finished route | finish editing (D, Esc, + New) without a name | name dialog with length, ascent, time; Save only with a name; Back to editing |

## B. Configure the routing

| Id | Use case | Steps | Expected |
|---|---|---|---|
| B1 | Route type | Road, Gravel, MTB, Hike | route recomputed with that profile; "Routing for …" while it takes time |
| B2 | Surface, climbs, steepness | Settings | profile parameters in the request; summary line in Settings |
| B3 | Hiking paths and preferences | Hike: paths up to T4, signed routes, forest and water, quiet | SAC_scale_limit, hiking_routes_preference, consider_* in the request |
| B4 | What the route may use | untick Ferries (and others) | nk_allow_ferry=0 in the request; "no ferries" in the summary line |

## C. Understand the route

| Id | Use case | Steps | Expected |
|---|---|---|---|
| C1 | Summary | look at the panel | length, time (hiking: DIN 33466), ascent, descent, surface bar with shares |
| C2 | Elevation profile | hover, click, collapse | header min, max, ↑, ↓; tooltip with km, m, %, surface; collapse and expand |
| C3 | Timeline | Key and All, click a row | Key hides short surface runs, All shows them; the choice is remembered |
| C4 | Grade colours by type | switch Road and Hike | legend scale changes (road ±3 … >15 %, hike ±10 … >45 %) |

## D. See the map

| Id | Use case | Steps | Expected |
|---|---|---|---|
| D1 | Base map and overlays | L, choose a map; overlays | the layer is in the URL (`l=`), tiles load |
| D2 | Line colours | layers: grade, surface, single colour | the route line changes |
| D3 | 3D | 2D \| 3D, T, Q/E, panel, compass | tilt 62°; turn 45° steps; compass click north up; T back to flat |

## E. Manage routes

| Id | Use case | Steps | Expected |
|---|---|---|---|
| E1 | Keep routes | draw, reload the page | the route is back |
| E2 | My routes | open the list | grouped by type with counts; "created <date>"; click opens |
| E3 | Rename | edit the title field | new name in the list |
| E4 | Delete | trash, confirm | gone from the list |
| E5 | Start a new route | + New or the logo | current one saved in the list; empty route |

## F. Import, export, share

| Id | Use case | Steps | Expected |
|---|---|---|---|
| F1 | Import a GPX | Open GPX/KML or drop a file | track in Tracks with its length |
| F2 | Track as a route | click the track | route with the track's line and elevation; type from the activity or name; surfaces from the map; opened again, not copied |
| F3 | Export GPX | Download GPX | a .gpx file with the route's name, points with elevation |
| F4 | Share a link | Copy link; open it elsewhere | short link copied; the recipient sees the same route |
| F5 | Send to Garmin | Garmin | anonymous: asks to log in (*sending itself: manual, needs an account*) |
| F6 | Sign in and sync | account menu | *manual: needs a Google or Authelia account* |

## G. Help and errors

| Id | Use case | Steps | Expected |
|---|---|---|---|
| G1 | Help | ? | shortcuts listed (D, R, B, P, L, F, T, Q/E…); Esc closes |
| G2 | Lists without the map | open the page with a slow base map | My routes shows at once, not "Nothing yet" |

## H. Phone

| Id | Use case | Steps | Expected |
|---|---|---|---|
| H1 | Bottom sheet | tap the handle | sheet opens and closes |
| H2 | Everything tappable | look at the top and right controls | no toolbar, layer, 2D \| 3D, 3D panel or zoom button covers another |
| H3 | Draw on a phone | edit, tap twice | a route appears |

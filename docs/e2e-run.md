# End-to-end run, 2026-11-13 19:18

Against https://alexe.pt/maps/. Suites: base, settings, layers, saving, mobile, consent.

## base (usecases.py), 14 min, 0 failing cells

(no table printed)

```
Draw a route  
A2   pass  phone-small     4.8s  Move a point  
A3   pass  phone-small     5.2s  Insert a point  
A4   pass  phone-small     6.2s  Remove points  
A5   pass  phone-small     5.7s  Undo and redo  
A6   pass  phone-small     4.6s  Reverse  
A7   pass  phone-small     6.5s  Out and back, back to start  
A8   pass  phone-small     4.3s  Straight segments  
A9   pass  phone-small     5.3s  Checkpoint  
A10  pass  phone-small     4.5s  Too long leg  
A11  pass  phone-small     4.2s  Name a finished route  
A12  pass  phone-small     6.7s  Waypoint menu  
B1   pass  phone-small     5.5s  Route type  
B2   pass  phone-small     8.8s  Surface, climbs  
B3   pass  phone-small     9.2s  Hiking paths and preferences  
B4   pass  phone-small     5.8s  What the route may use  
C1   pass  phone-small     5.5s  Summary  
C2   pass  phone-small     5.5s  Elevation profile  
C3   pass  phone-small     7.1s  Timeline views  
C4   pass  phone-small     6.6s  Grade colours by type  
D1   pass  phone-small     3.7s  Base map  
D2   pass  phone-small     3.8s  Line colours  
D3   pass  phone-small     5.7s  3D  
E1   pass  phone-small     4.4s  Keep routes  
E2   pass  phone-small     5.0s  My routes  
E3   pass  phone-small     5.8s  Rename  
E4   pass  phone-small     5.5s  Delete  
E5   pass  phone-small     8.3s  Start a new route  
F1   pass  phone-small     3.0s  Import a GPX  
F2   pass  phone-small     6.5s  Track as a route  
F3   pass  phone-small     5.3s  Export GPX  
F4   pass  phone-small     8.7s  Share a link  
F5   pass  phone-small     5.6s  Send to Garmin  
G1   pass  phone-small     2.5s  Help  
G2   pass  phone-small     8.4s  Lists without the map  
G3   pass  phone-small     3.7s  Cookies and account menu  
G4   pass  phone-small     2.2s  Map controls  
H1   pass  phone-small     2.7s  Bottom sheet  
H2   pass  phone-small     2.6s  Everything tappable  
H3   pass  phone-small     4.0s  Draw on a phone  

156/160 passed, 4 n/a; docs/use-cases-run.md

text or browser has been closed
Task exception was never retrieved
future: <Task finished name='Task-663' coro=<Connection.wrap_api_call() done, defined at /Users/alexe/.local/share/py312-default/lib/python3.12/site-packages/playwright/_impl/_connection.py:544> exception=TargetClosedError(': Target page, context or browser has been closed')>
Traceback (most recent call last):
  File "/Users/alexe/.local/share/py312-default/lib/python3.12/site-packages/playwright/_impl/_connection.py", line 559, in wrap_api_call
    raise rewrite_error(error, f"{parsed_st['apiName']}: {error}") from None
playwright._impl._errors.TargetClosedError: : Target page, context or browser has been closed
Task exception was never retrieved
future: <Task finished name='Task-664' coro=<Connection.wrap_api_call() done, defined at /Users/alexe/.local/share/py312-default/lib/python3.12/site-packages/playwright/_impl/_connection.py:544> exception=TargetClosedError(': Target page, context or browser has been closed')>
Traceback (most recent call last):
  File "/Users/alexe/.local/share/py312-default/lib/python3.12/site-packages/playwright/_impl/_connection.py", line 559, in wrap_api_call
    raise rewrite_error(error, f"{parsed_st['apiName']}: {error}") from None
playwright._impl._errors.TargetClosedError: : Target page, context or browser has been closed
Task exception was never retrieved
future: <Task finished name='Task-665' coro=<Connection.wrap_api_call() done, defined at /Users/alexe/.local/share/py312-default/lib/python3.12/site-packages/playwright/_impl/_connection.py:544> exception=TargetClosedError(': Target page, context or browser has been closed')>
Traceback (most recent call last):
  File "/Users/alexe/.local/share/py312-default/lib/python3.12/site-packages/playwright/_impl/_connection.py", line 559, in wrap_api_call
    raise rewrite_error(error, f"{parsed_st['apiName']}: {error}") from None
playwright._impl._errors.TargetClosedError: : Target page, context or browser has been closed

```

## settings (cases_settings.py), 9 min, 0 failing cells

| Id | Case | desktop | desktop-short | phone | phone-small |
|---|---|---|---|---|---|
| S1 | Surface slider: labels, highlight, params | pass | pass | pass | pass |
| S2 | Climbs slider: labels, params, seek x4 | pass | pass | pass | pass |
| S3 | Big roads slider (bikes only) | pass | pass | pass | pass |
| S4 | Steepness limit | pass | pass | pass | pass |
| S5 | Stick to the heatmap: candidates | pass | pass | pass | pass |
| S6 | Cycleways off, "May use" boxes per type | pass | pass | pass | pass |
| S7 | Hike-only options | pass | pass | pass | pass |
| S8 | (?) notes | pass | pass | pass | pass |
| S9 | Notches under sliders | pass | pass | pass | pass |
| S10 | Settings summary | pass | pass | pass | pass |
| S11 | Layout: timeline height, empty hint | pass | pass | pass | pass |
| S12 | Settings persist after reload | pass | pass | pass | pass |
| S13 | Layout: no overlap, panel scrolls | pass | pass | pass | pass |

## layers (cases_layers.py), 3 min, 0 failing cells

| Id | Case | desktop | desktop-short | phone | phone-small |
|---|---|---|---|---|---|
| L1 | Base map menu | pass | pass | pass | pass |
| L2 | Overlays on and off | flaky | pass | pass | pass |
| L3 | Route line colouring | pass | pass | pass | pass |
| L4 | POIs: radius, categories, counts, badge | pass | pass | pass | pass |
| L5 | POIs in the timeline | pass | pass | pass | pass |
| L6 | Springs API | pass | pass | pass | pass |
| L7 | Photos: zoom hint, markers, sources | pass | pass | pass | pass |
| L8 | Photo viewer | pass | pass | pass | pass |
| L9 | 2D/3D/zoom/locate block | pass | pass | n/a | n/a |
| L10 | Grade legend and line colours | pass | pass | pass | pass |
| L11 | No overlapping controls | pass | pass | pass | pass |

## saving (cases_saving.py), 5 min, 15 failing cells

| Id | Case | desktop | desktop-short | phone | phone-small |
|---|---|---|---|---|---|
| V1 | Route survives a reload | pass | pass | pass | pass |
| V2 | My routes: groups, counts, open | pass | pass | pass | pass |
| V3 | Rename | pass | pass | pass | pass |
| V4 | Delete, inline confirm | pass | pass | pass | pass |
| V5 | + New saves the current route | pass | pass | pass | pass |
| V6 | Name dialog | pass | FAIL | FAIL | FAIL |
| V7 | Waypoint menu | pass | pass | pass | pass |
| V8 | Double click deletes | pass | pass | pass | pass |
| V9 | Drag waypoint adds nothing | pass | pass | pass | pass |
| V10 | Drag line inserts; undo/redo | pass | pass | pass | pass |
| V11 | Copy link, open in a new context | FAIL | FAIL | FAIL | FAIL |
| V12 | Short link with heatmap | FAIL | FAIL | FAIL | FAIL |
| V13 | Missing short link | pass | pass | pass | pass |
| V14 | Paste #s= into an open tab | FAIL | FAIL | FAIL | FAIL |
| V15 | Export GPX | pass | pass | pass | pass |
| V16 | Import GPX, open as a route | pass | pass | pass | pass |
| V17 | Start hint vs panel | pass | pass | pass | pass |

## mobile (cases_mobile.py), 3 min, 0 failing cells

| Id | Case | Viewport | Result | Note |
|---|---|---|---|---|
| M1 | Collapsed sheet: handle, name, controls above | phone 390x664 | pass |  |
| M2 | Sheet handle: tap and drag | phone 390x664 | pass |  |
| M3 | Editing sheet <= 45dvh | phone 390x664 | pass |  |
| M4 | Top controls column, no overlaps | phone 390x664 | pass |  |
| M5 | Map/Overlays/POIs menus share edges | phone 390x664 | pass |  |
| M6 | Tap-draw, summary, waypoint menu, double tap | phone 390x664 | pass |  |
| M7 | Settings sliders and (?) notes in sheet | phone 390x664 | pass |  |
| M8 | Photo viewer fills phone | phone 390x664 | pass |  |
| M9 | Cookie banner on phone | phone 390x664 | pass |  |
| M10 | No hscroll / clipped text (phone) | phone 390x664 | pass |  |
| M11 | Tablet 768: side by side, no hscroll | tablet 768x1024 | pass |  |
| M12 | Laptop 1366: banner beside panel | desk 1440x780 | pass |  |
| M13 | Dark phone: contrast, controls | phone 390x664 | pass |  |
| M14 | Dark laptop: banner beside panel | lap1024 1024x768 | pass |  |
| W-micro | No hscroll micro, empty+route | micro 320x480 | pass |  |
| W-tiny | No hscroll tiny, empty+route | tiny 360x560 | pass |  |
| W-small | No hscroll small, empty+route | small 375x553 | pass |  |
| W-phone | No hscroll phone, empty+route | phone 390x664 | pass |  |
| W-land | No hscroll land, empty+route | land 664x375 | pass |  |
| W-tablet | No hscroll tablet, empty+route | tablet 768x1024 | pass |  |
| W-lap1024 | No hscroll lap1024, empty+route | lap1024 1024x768 | pass |  |
| W-desk | No hscroll desk, empty+route | desk 1440x780 | pass |  |
| S1-short | Controls, menus, no overlap short | short 1366x650 | pass |  |
| S2-short | Cookie banner short | short 1366x650 | pass |  |
| S4-short | Panel scrolls short | short 1366x650 | pass |  |
| S1-lap1280 | Controls, menus, no overlap lap1280 | lap1280 1280x620 | pass |  |
| S2-lap1280 | Cookie banner lap1280 | lap1280 1280x620 | pass |  |
| S4-lap1280 | Panel scrolls lap1280 | lap1280 1280x620 | pass |  |
| S1-land | Controls, menus, no overlap land | land 664x375 | pass |  |
| S2-land | Cookie banner land | land 664x375 | pass |  |
| S4-land | Panel scrolls land | land 664x375 | pass |  |
| S1-phone | Controls, menus, no overlap phone | phone 390x664 | pass |  |
| S2-phone | Cookie banner phone | phone 390x664 | pass |  |
| S4-phone | Panel scrolls phone | phone 390x664 | pass |  |
| S1-small | Controls, menus, no overlap small | small 375x553 | pass |  |
| S2-small | Cookie banner small | small 375x553 | pass |  |
| S4-small | Panel scrolls small | small 375x553 | pass |  |
| S1-tiny | Controls, menus, no overlap tiny | tiny 360x560 | pass |  |
| S2-tiny | Cookie banner tiny | tiny 360x560 | pass |  |
| S4-tiny | Panel scrolls tiny | tiny 360x560 | pass |  |
| S1-micro | Controls, menus, no overlap micro | micro 320x480 | pass |  |
| S2-micro | Cookie banner micro | micro 320x480 | pass |  |
| S4-micro | Panel scrolls micro | micro 320x480 | pass |  |
| S3-short | Profile card vs controls short | short 1366x650 | pass |  |
| S3-lap1280 | Profile card vs controls lap1280 | lap1280 1280x620 | pass |  |
| S3-desk | Profile card vs controls desk | desk 1440x780 | pass |  |
| S1-dark-short | Controls dark short | short 1366x650 | pass |  |

## consent (cases_consent.py), 1 min, 0 failing cells

| Id | Case | desktop | short | phone | phone-small |
|---|---|---|---|---|---|
| K1 | Fresh visit: denied by default, page_view without hash | pass | - | - | - |
| K2 | Banner layout, buttons reachable, Allow click | pass | pass | pass | pass |
| K3 | Account menu legal links and Cookie settings | pass | pass | pass | pass |
| K4 | Allow: granted, cookies, remembered | pass | - | - | - |
| K5 | No cookies: denied, no cookies, remembered | pass | - | - | - |
| K6 | Allow then No via menu removes _ga | pass | - | - | - |
| K7 | Events in dataLayer with app=nomapa | pass | - | - | - |
| K8 | Privacy of events and collect URLs | pass | - | - | - |
| K9 | Terms page and sections | pass | - | - | - |
| K10 | Help #privacy text | pass | - | - | - |
| K11 | Account menu legal links, sheet expanded (phones) | - | - | pass | pass |


## Notes on this run

- **saving V11, V12, V14** (short links): not app failures. All suites run from one address, and by then the day's 25 anonymous short links from it were used up (`usage` table: 25; 15 answers 429). The app fell back to the long link as designed. Rerun these on a new day or with fewer link-creating cases.
- **saving V6** (place-name chips): the along-route limit of 20 lookups per client a minute was shared by four profiles from one address. The limit is now 60 (it could also cut springs on a long route for one person); V6 passes on all four profiles after that.

# End-to-end run, 2026-11-14 16:35

Against https://alexe.pt/maps/. Suites: settings, saving, consent, panel.

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

## saving (cases_saving.py), 5 min, 0 failing cells

| Id | Case | desktop | desktop-short | phone | phone-small |
|---|---|---|---|---|---|
| V1 | Route survives a reload | pass | pass | pass | pass |
| V2 | My routes: groups, counts, open | pass | pass | pass | pass |
| V3 | Rename | pass | pass | pass | pass |
| V4 | Delete, inline confirm | pass | pass | pass | pass |
| V5 | + New saves the current route | pass | pass | pass | pass |
| V6 | Name dialog | pass | pass | pass | pass |
| V7 | Waypoint menu | pass | pass | pass | pass |
| V8 | Double click deletes | pass | pass | pass | pass |
| V9 | Drag waypoint adds nothing | pass | pass | pass | pass |
| V10 | Drag line inserts; undo/redo | pass | pass | pass | pass |
| V11 | Copy link, open in a new context | pass | pass | pass | pass |
| V12 | Short link with heatmap | pass | pass | pass | pass |
| V13 | Missing short link | pass | pass | pass | pass |
| V14 | Paste #s= into an open tab | pass | pass | pass | pass |
| V15 | Export GPX | pass | pass | pass | pass |
| V16 | Import GPX, open as a route | pass | pass | pass | pass |
| V17 | Start hint vs panel | pass | pass | pass | pass |

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

## panel (cases_panel.py), 2 min, 0 failing cells

| Id | Case | desktop | desktop-short | phone | phone-small |
|---|---|---|---|---|---|
| P1 | Start tiles and the Settings line | pass | pass | pass | pass |
| P2 | Settings sentence: a word and its choices | pass | pass | pass | pass |
| P3 | All settings: tabs, change line, Reset, Back | pass | pass | pass | pass |
| P4 | Route menu: rename, copy, delete | pass | pass | pass | pass |
| P5 | Plan a loop: start, find, pick | pass | pass | pass | pass |
| P6 | Name dialog: Discard route | pass | pass | pass | pass |


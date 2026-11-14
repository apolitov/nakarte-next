#!/usr/bin/env python3
"""Metres of cobblestones (surface=sett|cobblestone|unhewn_cobblestone) on random 3-8 km legs around
Lisbon, per profile setting, and how long the legs are. Same legs as wrongway.py.
Usage: python3 cobbles.py <brouter url ending in /brouter or maps-api base>"""
import json, sys, urllib.request
from wrongway import SETTINGS, legs

API = sys.argv[1]
COBBLE = {'sett', 'cobblestone', 'unhewn_cobblestone'}


def main():
    base = API if API.endswith('/brouter') else API + '/route'
    print('| Setting | Legs | Km | Cobbles m | Share |\n|---|---|---|---|---|')
    for k, (prof, extra) in SETTINGS.items():
        n = m = 0
        km = 0.0
        for a, b in legs():
            u = f'{base}?lonlats={a[0]:.6f},{a[1]:.6f}|{b[0]:.6f},{b[1]:.6f}&profile={prof}{extra}&alternativeidx=0&format=geojson'
            try:
                f = json.load(urllib.request.urlopen(u, timeout=60))['features'][0]
            except Exception:
                continue
            msg = f['properties']['messages']
            iT, iD = msg[0].index('WayTags'), msg[0].index('Distance')
            for r in msg[1:]:
                tags = dict(kv.split('=', 1) for kv in r[iT].split() if '=' in kv)
                if tags.get('surface') in COBBLE:
                    m += int(r[iD])
            n += 1
            km += int(f['properties']['track-length']) / 1000
        print(f'| {k} | {n} | {km:.0f} | {m} | {m / 1000 / max(km, 1) * 100:.1f}% |', flush=True)


if __name__ == '__main__':
    main()

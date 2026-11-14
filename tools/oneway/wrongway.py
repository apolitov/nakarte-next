#!/usr/bin/env python3
"""Metres ridden against a oneway on random 3-8 km legs around Lisbon, per profile setting.

Wrong way = BRouter's reversedirection on a oneway (oneway=yes or a roundabout) without a bike
exemption (oneway:bicycle=no, contraflow lanes), or with the way on oneway=-1. Usage:
python3 wrongway.py <brouter url ending in /brouter or maps-api base>"""
import json, random, sys, urllib.request

API = sys.argv[1]
SETTINGS = {'road': ('nk-road', ''), 'road+heat': ('nk-road', '&profile:nk_heat_cap=1.6'), 'gravel': ('nk-gravel', ''),
            'gravel+heat': ('nk-gravel', '&profile:nk_heat_cap=1.6'), 'mtb': ('nk-mtb', '')}
BOX = (-9.25, 38.70, -9.08, 38.80)


def legs(n=40):
    random.seed(7)
    out = []
    while len(out) < n:
        a = (random.uniform(BOX[0], BOX[2]), random.uniform(BOX[1], BOX[3]))
        b = (random.uniform(BOX[0], BOX[2]), random.uniform(BOX[1], BOX[3]))
        km = (((a[0] - b[0]) * 86) ** 2 + ((a[1] - b[1]) * 111) ** 2) ** 0.5
        if 3 < km < 8:
            out.append((a, b))
    return out


def wrong(tags: dict) -> bool:
    if tags.get('oneway:bicycle') == 'no' or str(tags.get('cycleway', '')).startswith('opposite'):
        return False
    rev = tags.get('reversedirection') == 'yes'
    one = tags.get('oneway') in ('yes', 'true', '1') or (tags.get('junction') in ('roundabout', 'circular') and tags.get('oneway') != 'no')
    return (rev and one) or (not rev and tags.get('oneway') == '-1')


def main():
    base = API if API.endswith('/brouter') else API + '/route'
    print('| Setting | Legs | Km | Wrong-way m | Legs with any | of it on cycleways |\n|---|---|---|---|---|---|')
    for k, (prof, extra) in SETTINGS.items():
        n = km = bad = badc = withany = 0
        for a, b in legs():
            u = f'{base}?lonlats={a[0]:.6f},{a[1]:.6f}|{b[0]:.6f},{b[1]:.6f}&profile={prof}{extra}&alternativeidx=0&format=geojson'
            try:
                f = json.load(urllib.request.urlopen(u, timeout=60))['features'][0]
            except Exception:
                continue
            m = f['properties']['messages']
            h = m[0]
            iT, iD = h.index('WayTags'), h.index('Distance')
            w = 0
            for r in m[1:]:
                tags = dict(kv.split('=', 1) for kv in r[iT].split() if '=' in kv)
                if wrong(tags):
                    w += int(r[iD])
                    if tags.get('highway') == 'cycleway':
                        badc += int(r[iD])
            n += 1
            km += int(f['properties']['track-length']) / 1000
            bad += w
            withany += w > 0
        print(f'| {k} | {n} | {km:.0f} | {bad} | {withany} | {badc} |', flush=True)


if __name__ == '__main__':
    main()

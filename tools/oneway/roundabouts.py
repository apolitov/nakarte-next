#!/usr/bin/env python3
"""Do routes go round roundabouts the right way (counterclockwise in Portugal)?

Takes small roundabouts around Lisbon from OpenStreetMap (Overpass), and for each a left turn:
enter from one approach road, leave by the road about 90° clockwise. The legal way is 270°
counterclockwise; a router that ignores the oneway goes 90° clockwise. Prints per profile setting
how many routes went the wrong way. Usage: python3 roundabouts.py [api base] > result.txt"""
import json, math, pathlib, sys, time, urllib.parse, urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else 'https://alexe.pt/maps/api'
BBOX = (38.60, -9.40, 38.95, -8.85)
CASES = pathlib.Path(__file__).with_name('roundabouts.json')  # the sample, kept so runs compare like with like
UA = {'User-Agent': 'nomapa-routing-check/1.0'}
SETTINGS = {
    'road': ('nk-road', ''),
    'road+heat': ('nk-road', '&profile:nk_heat_cap=1.6'),
    'gravel': ('nk-gravel', ''),
    'gravel+heat': ('nk-gravel', '&profile:nk_heat_cap=1.6'),
    'mtb': ('nk-mtb', ''),
}


def xy(lat0, p):  # metres around lat0
    return ((p[0]) * 111320 * math.cos(math.radians(lat0)), p[1] * 110540)


def overpass():
    q = f"""[out:json][timeout:90];
way[junction=roundabout][highway~"^(primary|secondary|tertiary|unclassified|residential)$"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]})->.r;
node(w.r)->.rn;
way(bn.rn)[highway][!junction][!oneway]->.a;
(.r;.a;);
out geom;"""
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode(), headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=120))['elements']


def cases(els):
    rings = [e for e in els if e.get('tags', {}).get('junction') == 'roundabout' and e['nodes'][0] == e['nodes'][-1]]
    roads = [e for e in els if e.get('tags', {}).get('junction') != 'roundabout']
    out = []
    for r in rings:
        pts = [(g['lon'], g['lat']) for g in r['geometry']]
        c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        rad = sum(math.dist(xy(c[1], (p[0] - c[0], p[1] - c[1])), (0, 0)) for p in pts) / len(pts)
        if not 8 < rad < 60:
            continue
        nodes = set(r['nodes'])
        appr = []
        for w in roads:
            for k, nid in enumerate(w['nodes']):
                if nid not in nodes:
                    continue
                step = 1 if k == 0 else -1 if k == len(w['nodes']) - 1 else 0
                if not step:
                    continue
                # walk outward ~40 m
                j, d = k, 0.0
                while 0 <= j + step < len(w['nodes']) and d < 40:
                    a, b = w['geometry'][j], w['geometry'][j + step]
                    d += math.dist(xy(c[1], (a['lon'], a['lat'])), xy(c[1], (b['lon'], b['lat'])))
                    j += step
                g = w['geometry'][j]
                v = xy(c[1], (g['lon'] - c[0], g['lat'] - c[1]))
                if math.hypot(*v) < rad + 20:
                    continue
                appr.append((math.degrees(math.atan2(v[1], v[0])), (g['lon'], g['lat'])))
        appr.sort()
        uniq = []
        for a in appr:
            if all(abs((a[0] - u[0] + 180) % 360 - 180) > 25 for u in uniq):
                uniq.append(a)
        if len(uniq) < 3:
            continue
        # a left turn: the exit 60-120° clockwise of the entry
        for A in uniq:
            Bs = [B for B in uniq if 60 <= (A[0] - B[0]) % 360 <= 120]
            if Bs:
                out.append({'id': r['id'], 'c': c, 'rad': rad, 'a': A[1], 'b': Bs[0][1]})
                break
    return out


def turn(coords, c, rad):
    """signed degrees travelled around the centre while within 1.6 radii; + = counterclockwise"""
    tot, prev = 0.0, None
    for lng, lat, *_ in coords:
        v = xy(c[1], (lng - c[0], lat - c[1]))
        if math.hypot(*v) > rad * 1.6:
            prev = None if prev is None else prev
            continue
        ang = math.atan2(v[1], v[0])
        if prev is not None:
            tot += (ang - prev + math.pi) % (2 * math.pi) - math.pi
        prev = ang
    return math.degrees(tot)


def route(profile, extra, a, b):
    base = API if API.endswith('/brouter') else API + '/route'  # BRouter itself or maps-api
    url = f'{base}?lonlats={a[0]:.6f},{a[1]:.6f}|{b[0]:.6f},{b[1]:.6f}&profile={profile}{extra}&alternativeidx=0&format=geojson'
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))['features'][0]['geometry']['coordinates']
        except Exception:
            time.sleep(2)
    return None


def main():
    if CASES.exists():
        cs = json.loads(CASES.read_text())
    else:
        cs = cases(overpass())
        CASES.write_text(json.dumps(cs))
    print(f'{len(cs)} roundabouts with a left turn', file=sys.stderr)
    res = {k: [0, 0, 0] for k in SETTINGS}  # right way, wrong way, around it
    wrong = {k: [] for k in SETTINGS}
    for c in cs:
        for k, (prof, extra) in SETTINGS.items():
            co = route(prof, extra, c['a'], c['b'])
            if not co:
                continue
            t = turn(co, c['c'], c['rad'])
            i = 0 if t > 150 else 1 if t < -45 else 2
            res[k][i] += 1
            if i == 1:
                wrong[k].append(f"https://www.openstreetmap.org/way/{c['id']}")
    print('| Setting | Right way (ccw) | Wrong way (cw) | Elsewhere |\n|---|---|---|---|')
    for k, (r, w, o) in res.items():
        print(f'| {k} | {r} | {w} | {o} |')
    for k, v in wrong.items():
        if v:
            print(f'\n{k} wrong: ' + ' '.join(v[:8]))


if __name__ == '__main__':
    main()

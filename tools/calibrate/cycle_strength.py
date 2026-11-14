#!/usr/bin/env python3
"""How strongly to follow cycle infrastructure (14 Nov 2026): the calibration legs of rounds 1-2 routed
with the cycle penalty off, as deployed, x4 and x6 (penalty on ways without cycle infrastructure,
relative to them). Runs next to BRouter (proxy-brouter network); writes routes, resampled every 30 m,
with length and share of cycle infrastructure. Heat is scored separately in the app page.
  docker run --rm --network proxy-brouter -v $PWD:/w -w /w python:3.13-slim python cycle_strength.py"""
import json, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

src = open('gen_routes.py').read()
exec(src[:src.index('VARIANTS = {')] + src[src.index('def enc('):src.index('def run(')])
B = 'http://brouter:17777/brouter'
VARIANTS = {
    'nk-road': {'off': {'nk_cycle': 0}, 'x2.5 (now)': {}, 'x4': {'nk_cycle_pen': 2.4}, 'x6': {'nk_cycle_pen': 3.6}},
    'nk-gravel': {'off': {'nk_cycle': 0}, 'x2 (now)': {}, 'x4': {'nk_cycle_pen': 4.0}, 'x6': {'nk_cycle_pen': 6.0}},
}
LANE = re.compile(r'^(lane|track|shared_lane|segregated|both|right|left|opposite_lane|opposite_track)$')
def is_cycle(t):
    return t.get('highway') == 'cycleway' or t.get('bicycle') == 'designated' or any(LANE.match(t.get(k, '')) for k in ('cycleway', 'cycleway:right', 'cycleway:left', 'cycleway:both')) or any(k.startswith('route_bicycle_') for k in t)
def real_infra(t):  # a way of its own or a lane, not a sharrow or a signed route on an ordinary road
    return t.get('highway') == 'cycleway' or t.get('bicycle') == 'designated' or any(re.match(r'^(lane|track|segregated|opposite_lane|opposite_track)$', t.get(k, '')) for k in ('cycleway', 'cycleway:right', 'cycleway:left', 'cycleway:both'))
def run(job):
    leg, prof, v = job
    extra = ''.join(f'&profile:{k}={x}' for k, x in VARIANTS[prof][v].items())
    q = f"lonlats={leg['a'][0]},{leg['a'][1]}|{leg['b'][0]},{leg['b'][1]}&profile={prof}&alternativeidx=0&format=geojson{extra}"
    t0 = time.time()
    try:
        with urllib.request.urlopen(B + '?' + q, timeout=120) as r:
            f = json.load(r)['features'][0]
    except Exception as e:
        return job, None
    m = f['properties']['messages']; h = m[0]; iT, iD = h.index('WayTags'), h.index('Distance')
    tot = cyc = real = 0
    for row in m[1:]:
        t = dict(kv.split('=', 1) for kv in row[iT].split() if '=' in kv); d = int(row[iD])
        tot += d; cyc += d if is_cycle(t) else 0; real += d if real_infra(t) else 0
    pts = resample([c[:2] for c in f['geometry']['coordinates']], 30)
    return job, {'m': int(f['properties']['track-length']), 'cyc': cyc / max(tot, 1), 'real': real / max(tot, 1), 's': round(time.time() - t0, 1), 'poly': enc(pts)}
jobs = [(leg, p, v) for leg in LEGS for p in VARIANTS for v in VARIANTS[p]]
out = []
with ThreadPoolExecutor(3) as ex:
    for n, (job, r) in enumerate(ex.map(run, jobs)):
        if r: out.append({'leg': job[0]['id'], 'mountain': bool(job[0].get('mountain')), 'prof': job[1], 'v': job[2], **r})
        if n % 100 == 0: print(n, len(jobs), flush=True)
json.dump(out, open('cycle_routes.json', 'w'))
print('done', len(out), 'of', len(jobs))

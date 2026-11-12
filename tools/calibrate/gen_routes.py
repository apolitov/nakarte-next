"""Calibration routes: legs x variants on the test router, unique geometries sampled every 20 m."""
import json, math, random, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
B = 'http://brouter-test:17777/brouter'
random.seed(20261112)
REGIONS = {
 'Lisbon': (-9.20, 38.75), 'Sintra': (-9.35, 38.78), 'Porto': (-8.60, 41.17), 'Madrid': (-3.75, 40.45),
 'Girona': (2.82, 41.98), 'Mallorca': (2.85, 39.70), 'Provence': (5.45, 43.53), 'Paris': (2.30, 48.83),
 'Brussels': (4.38, 50.83), 'Utrecht': (5.12, 52.08), 'Cologne': (6.95, 50.93), 'Berlin': (13.40, 52.50),
 'Munich': (11.55, 48.12), 'Innsbruck': (11.40, 47.26), 'Zurich': (8.55, 47.38), 'Vienna': (16.35, 48.20),
 'Prague': (14.42, 50.08), 'Milan': (9.18, 45.47), 'Tuscany': (11.30, 43.35), 'Copenhagen': (12.55, 55.68),
 'Warsaw': (21.00, 52.23), 'Moscow': (37.60, 55.75), 'Dolomites': (12.00, 46.50), 'Black Forest': (8.10, 47.95),
}
def offset(lng, lat, km, brg):
    d = km / 6371; b = math.radians(brg); p1 = math.radians(lat); l1 = math.radians(lng)
    p2 = math.asin(math.sin(p1)*math.cos(d) + math.cos(p1)*math.sin(d)*math.cos(b))
    l2 = l1 + math.atan2(math.sin(b)*math.sin(d)*math.cos(p1), math.cos(d)-math.sin(p1)*math.sin(p2))
    return (round(math.degrees(l2), 5), round(math.degrees(p2), 5))
LEGS = []
for name, (lng, lat) in REGIONS.items():
    for k in range(3):
        a = offset(lng, lat, random.uniform(0, 8), random.uniform(0, 360))
        b = offset(*a, random.uniform(8, 14), random.uniform(0, 360))
        LEGS.append({'id': f'{name}-{k}', 'region': name, 'a': a, 'b': b})
# legs of Vyacheslav's route east of Berlin (as shared), straight leg 2 skipped, legs over 2 km
POLY = urllib.parse.unquote("yf%7D~Haa%7BqAhBi%40tA%7DTnAa_%40xtA%7DqJwKq%7BCfLy%60%40xHyX%60D%7BWlHa%5E%7BP%7DaAi%7BAyeBkn%40e%7BN%60BihAwAa%7DAkOkYoQwOiUgV%7Dn%40mnBqRgGoNeT%7BkAydXpcNekKdd%40%7BTxVuL%60%5BePxUneDkU%7CaDgl%40z%7DAwd%40hdDoaBtgGvkDbuEuAfA~lDj_IuzD%60ga%40mlBpdFsz%40%60%7C%40iu%40%60xB_Ubv%40wn%40jr%40")
def dec(s):
    i = lat = lng = 0; out = []
    def d():
        nonlocal i
        sh = r = 0
        while True:
            c = ord(s[i]) - 63; i += 1; r |= (c & 31) << sh; sh += 5
            if c < 32: break
        return ~(r >> 1) if r & 1 else r >> 1
    while i < len(s):
        lat += d(); lng += d(); out.append((lng / 1e5, lat / 1e5))
    return out
def hav(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1]); dl = math.radians(b[0]-a[0])
    h = math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*6371*math.asin(math.sqrt(h))
vp = dec(POLY)
for i in range(len(vp)-1):
    if i != 2 and hav(vp[i], vp[i+1]) >= 2:
        LEGS.append({'id': f'Vyacheslav-{i}', 'region': 'Berlin east (Vyacheslav)', 'a': vp[i], 'b': vp[i+1]})
VARIANTS = {'off': {'nk_cycle': 0}}
for pen in (1.6, 2.0):
    for busy in (1, 1.5, 2):
        VARIANTS[f'pen{pen}-busy{busy}'] = {'nk_cycle_pen': pen, 'nk_busy_pen': busy}
for mult in (0.8, 0.65, 0.5):
    for busy in (1, 1.5, 2.5):
        VARIANTS[f'mult{mult}-busy{busy}'] = {'nk_cycle_pen': 1, 'nk_cycle_mult': mult, 'nk_busy_pen': busy}
VARIANTS['pen1.3-mult0.65-busy1.5'] = {'nk_cycle_pen': 1.3, 'nk_cycle_mult': 0.65, 'nk_busy_pen': 1.5}
PROFILES = {'road': 't-road', 'gravel': 't-gravel'}
INFRA = ('cycleway', 'cycleway:right', 'cycleway:left', 'cycleway:both')
def cls(t):
    hw = t.get('highway', '')
    ded = hw == 'cycleway' or t.get('bicycle') == 'designated' or t.get('bicycle_road') in ('yes', 'designated')
    lane = any(t.get(k) in ('lane', 'track', 'shared_lane', 'opposite_lane', 'opposite_track', 'segregated', 'both', 'right', 'left') for k in INFRA)
    rte = any(t.get(k) == 'yes' for k in ('route_bicycle_icn', 'route_bicycle_ncn', 'route_bicycle_rcn', 'route_bicycle_lcn'))
    busy = hw in ('trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link') and not (ded or lane)
    unp = t.get('surface') in ('gravel', 'fine_gravel', 'compacted', 'unpaved', 'dirt', 'ground', 'grass', 'sand', 'earth', 'pebblestone') or hw in ('track', 'path')
    return (ded or lane or rte), busy, unp
def enc(pts):
    out = []; pl = pn = 0
    for lng, lat in pts:
        la, ln = round(lat*1e5), round(lng*1e5)
        for v in (la-pl, ln-pn):
            s = ~(v << 1) if v < 0 else v << 1
            while s >= 0x20: out.append(chr((0x20 | (s & 0x1f)) + 63)); s >>= 5
            out.append(chr(s + 63))
        pl, pn = la, ln
    return ''.join(out)
def resample(coords, step=20):
    out = [coords[0]]; carry = 0.0
    for p, q in zip(coords, coords[1:]):
        d = hav(p, q) * 1000
        while carry + d >= step:
            f = (step - carry) / d if d else 0
            p = (p[0] + (q[0]-p[0])*f, p[1] + (q[1]-p[1])*f); d -= step - carry; carry = 0; out.append(p)
        carry += d
    out.append(coords[-1]); return out
def run(job):
    leg, prof, vname = job
    extra = ''.join(f'&profile:{k}={v}' for k, v in VARIANTS[vname].items())
    q = f"lonlats={leg['a'][0]},{leg['a'][1]}|{leg['b'][0]},{leg['b'][1]}&profile={PROFILES[prof]}&alternativeidx=0&format=geojson{extra}"
    t0 = time.time()
    try:
        with urllib.request.urlopen(B + '?' + q, timeout=100) as r: j = json.load(r)
    except Exception as e:
        return job, None, round(time.time()-t0, 2), str(e)[:80]
    ms = round(time.time()-t0, 2)
    f = j['features'][0]; coords = [(c[0], c[1]) for c in f['geometry']['coordinates']]
    m = f['properties']['messages']; h = m[0]; iD = h.index('Distance'); iT = h.index('WayTags')
    T = [0, 0, 0, 0]
    for row in m[1:]:
        d = int(row[iD]); t = dict(kv.split('=', 1) for kv in row[iT].split() if '=' in kv); c = cls(t); T[0] += d
        for k, x in enumerate(c): T[k+1] += d*x
    return job, {'coords': coords, 'm': T[0], 'infra': T[1], 'busy': T[2], 'unp': T[3]}, ms, None
jobs = [(leg, prof, v) for leg in LEGS for prof in PROFILES for v in VARIANTS]
out = {'variants': VARIANTS, 'legs': {}}
errors = 0; t0 = time.time()
with ThreadPoolExecutor(4) as ex:
    for n, (job, r, ms, err) in enumerate(ex.map(run, jobs)):
        leg, prof, v = job
        L = out['legs'].setdefault(f"{leg['id']}|{prof}", {'leg': leg['id'], 'region': leg['region'], 'prof': prof, 'a': leg['a'], 'b': leg['b'], 'geoms': {}, 'runs': {}})
        if r is None:
            errors += 1; L['runs'][v] = {'err': err, 's': ms}; continue
        pts = resample(r['coords']); key = enc(pts)
        g = L['geoms'].setdefault(key, {'m': r['m'], 'infra': r['infra'], 'busy': r['busy'], 'unp': r['unp'], 'n': len(pts)})
        L['runs'][v] = {'g': key, 's': ms}
        if n % 200 == 0:
            print(n, len(jobs), round(time.time()-t0), 's errors', errors, flush=True)
# compact: geometries get ids
for L in out['legs'].values():
    ids = {k: i for i, k in enumerate(L['geoms'])}
    L['geoms'] = [dict(g, poly=k) for k, g in L['geoms'].items()]
    for v in L['runs'].values():
        if 'g' in v: v['g'] = ids[v['g']]
json.dump(out, open('/data/calib/routes.json', 'w'))
print('done', len(jobs), 'jobs', errors, 'errors', round(time.time()-t0), 's', sum(len(L['geoms']) for L in out['legs'].values()), 'geoms', flush=True)

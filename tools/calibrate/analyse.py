"""Ranks routing variants by how well routes follow the Strava heatmap (see docs/routing-calibration-plan.md)."""
import json, statistics as st, sys, zlib
routes = json.load(open(sys.argv[1])); scores = json.load(open(sys.argv[2]))
COLD = 1  # histogram bins below this (value < 16 of 255) count as "nobody rides here"
def split(leg):  # stable 70/30 split by leg id
    return 'check' if zlib.crc32(leg.encode()) % 10 < 3 else 'calib'
rows = {}
for key, L in routes['legs'].items():
    sc = scores.get(key)
    if not sc: continue
    ok = {v: r for v, r in L['runs'].items() if 'g' in r}
    if len(ok) < len(routes['variants']) * 0.8: continue
    means = [sc[r['g']]['mean'] for r in ok.values()]
    lens = [L['geoms'][r['g']]['m'] for r in ok.values()]
    best, short = max(means) or 1, min(lens)
    for v, r in ok.items():
        g, s = L['geoms'][r['g']], sc[r['g']]
        rows.setdefault((L['prof'], v, split(L['leg'])), []).append({
            'heat': s['mean'] / best, 'cold': sum(s['h'][:COLD]) / s['n'], 'detour': g['m'] / short,
            'infra': g['infra'] / g['m'], 'busy': g['busy'] / g['m'], 'unp': g['unp'] / g['m'], 's': r['s'], 'leg': L['leg']})
def agg(xs, k): return st.mean(x[k] for x in xs)
for prof in ('road', 'gravel'):
    print(f'\n== {prof}: mean over legs (heat = route heat / best variant of that leg; cold = share of the route nobody rides)')
    print(f'{"variant":26} {"set":6} {"legs":>4} {"heat":>5} {"cold":>5} {"detour":>6} {"infra":>5} {"busy":>5} {"unpaved":>7} {"t p50":>6} {"t max":>6} score')
    res = []
    for (p, v, sp), xs in rows.items():
        if p != prof: continue
        score = agg(xs, 'heat') - 0.5 * agg(xs, 'cold') - 0.5 * max(0, agg(xs, 'detour') - 1.05)
        res.append((sp, -score, v, xs, score))
    for sp, _, v, xs, score in sorted(res):
        ts = sorted(x['s'] for x in xs)
        print(f'{v:26} {sp:6} {len(xs):4} {agg(xs,"heat"):5.3f} {agg(xs,"cold"):5.3f} {agg(xs,"detour"):6.3f} {agg(xs,"infra"):5.2f} {agg(xs,"busy"):5.2f} {agg(xs,"unp"):7.2f} {ts[len(ts)//2]:6.1f} {ts[-1]:6.1f} {score:.3f}')

#!/usr/bin/env python3
"""Loop generator prototype: "a loop of L km from here".
Candidates: the start plus 2 or 3 via points on a polygon of perimeter L / road factor, in 8 directions;
legs routed by BRouter (plain, alternative 0); a second round rescales the best directions by the
length they actually got. Scored by length match and repeated stretches here; heat in the app page.
  python3 proto.py > loops.json"""
import json, math, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

API = 'https://alexe.pt/maps/api/route'
UA = {'User-Agent': 'nomapa-loops-proto'}
STARTS = {'Lisbon Alameda': (-9.1335, 38.7369), 'Sintra': (-9.3817, 38.7976), 'Povoa de Santa Iria': (-9.064, 38.861),
          'Setubal': (-8.893, 38.524), 'Evora': (-7.909, 38.571), 'Porto Boavista': (-8.630, 41.158),
          'Mafra countryside': (-9.33, 38.94), 'Alentejo Montemor': (-8.214, 38.648)}
FACTOR = 1.3  # road length / straight polygon perimeter, first guess


def off(p, km, brg):
    b = math.radians(brg)
    return (p[0] + km * math.sin(b) / (111.32 * math.cos(math.radians(p[1]))), p[1] + km * math.cos(b) / 110.57)


def shape(start, per_km, brg, n):
    """start + n via points: a regular (n+1)-gon with the start as a vertex, facing brg"""
    k = n + 1
    side = per_km / k
    pts, p, h = [start], start, brg - 180 / k * (k - 2) / 2 + 0  # walk the polygon: turn 360/k each side
    h = brg - (180 - 360 / k) / 2 if k > 2 else brg
    for i in range(n):
        p = off(p, side, h)
        pts.append(p)
        h += 360 / k
    return pts + [start]


def leg(a, b, prof):
    u = f'{API}?lonlats={a[0]:.6f},{a[1]:.6f}|{b[0]:.6f},{b[1]:.6f}&profile={prof}&alternativeidx=0&format=geojson'
    for _ in range(3):
        try:
            f = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=90))['features'][0]
            return [c[:2] for c in f['geometry']['coordinates']], int(f['properties']['track-length'])
        except Exception:
            time.sleep(1)
    return None


def loop(start, per_km, brg, n, prof):
    pts = shape(start, per_km, brg, n)
    with ThreadPoolExecutor(3) as ex:
        legs = list(ex.map(lambda ab: leg(ab[0], ab[1], prof), zip(pts, pts[1:])))
    if any(l is None for l in legs):
        return None
    coords = [c for l, _ in legs for c in l]
    return {'brg': brg, 'n': n, 'per': per_km, 'via': pts[1:-1], 'm': sum(m for _, m in legs), 'coords': coords}


def resample(c, step=30):
    out = [c[0]]; carry = 0.0
    for a, b in zip(c, c[1:]):
        d = math.hypot((b[0] - a[0]) * 111320 * math.cos(math.radians(a[1])), (b[1] - a[1]) * 110570)
        while carry + d >= step and d > 0:
            f = (step - carry) / d
            a = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f); d -= step - carry; carry = 0; out.append(a)
        carry += d
    return out


def repeated(c):
    """share of the loop that runs over a stretch already ridden (within 25 m, not the neighbouring samples)"""
    s = resample(c)
    cell = {}
    rep = 0
    for i, p in enumerate(s):
        x, y = p[0] * 111320 * math.cos(math.radians(p[1])), p[1] * 110570
        key = (int(x // 25), int(y // 25))
        hit = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in cell.get((key[0] + dx, key[1] + dy), ()):
                    if i - j > 15:
                        hit = True; break
        rep += hit
        cell.setdefault(key, []).append(i)
    return rep / max(len(s), 1)


def main():
    prof = 'nk-gravel'
    out = []
    for name, start in STARTS.items():
        for L in (30, 60):
            t0 = time.time(); calls = 0
            cands = []
            for brg in range(0, 360, 45):
                n = 2 if L <= 40 else 3
                r = loop(start, L / FACTOR, brg, n, prof); calls += n + 1
                if r: cands.append(r)
            # round 2: rescale each direction by the length it got, keep the 4 closest after that
            r2 = []
            for c in sorted(cands, key=lambda c: abs(c['m'] / 1000 - L))[:5]:
                per = c['per'] * L / (c['m'] / 1000)
                r = loop(start, per, c['brg'], c['n'], prof); calls += c['n'] + 1
                if r: r2.append(r)
            for c in cands + r2:
                c['rep'] = repeated(c['coords'])
            good = [c for c in cands + r2 if abs(c['m'] / 1000 - L) / L <= 0.15]
            secs = time.time() - t0
            print(f"{name:22} {L} km: {len(cands)} first, {len(good)} within 15%, best len {min((abs(c['m']/1000-L) for c in cands+r2), default=0):.1f} km off, "
                  f"repeat median {sorted(c['rep'] for c in good)[len(good)//2] if good else -1:.2f}, {calls} legs, {secs:.0f} s", file=sys.stderr, flush=True)
            out.append({'start': name, 'L': L, 'cands': [{k: v for k, v in c.items()} for c in cands + r2], 'calls': calls, 's': secs})
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Load test of maps-api and BRouter, run inside the proxy-maps Docker network on the VPS:

  docker run --rm --network proxy-maps -v "$PWD/loadtest.py:/t.py:ro" python:3.13-slim python /t.py

Clients are told apart by X-Forwarded-For (maps-api limits 3 legs at once per client), so one
machine can load the router like many people. External services are not loaded: place names are
asked only for a point already in our cache. Prints one table row per scenario."""
import json
import random
import statistics
import threading
import time
import urllib.error
import urllib.request

API = 'http://maps-api:8000/api'
# Lisbon area: legs of 15-40 km between random points, so the route cache does not answer
BOX = (-9.45, 38.65, -8.95, 39.0)


def call(path: str, ip: str, timeout=130) -> tuple[int, float]:
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(urllib.request.Request(API + path, headers={'X-Forwarded-For': ip}), timeout=timeout) as r:
            r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:
        code = 0
    return code, time.perf_counter() - t0


def cold_leg() -> str:
    while True:
        a = (random.uniform(BOX[0], BOX[2]), random.uniform(BOX[1], BOX[3]))
        b = (random.uniform(BOX[0], BOX[2]), random.uniform(BOX[1], BOX[3]))
        km = ((a[0] - b[0]) * 86) ** 2 + ((a[1] - b[1]) * 111) ** 2
        if 15 ** 2 < km < 40 ** 2:
            break
    prof = random.choice(['nk-gravel', 'nk-road', 'nk-gravel', 'nk-mtb'])
    return f'/route?lonlats={a[0]:.5f},{a[1]:.5f}|{b[0]:.5f},{b[1]:.5f}&profile={prof}&alternativeidx=0&format=geojson'


def run(name: str, make_path, clients: int, seconds: float, ips: int | None = None):
    """clients threads loop for `seconds`; each thread is its own client address unless ips limits them"""
    res: list[tuple[int, float]] = []
    lock = threading.Lock()
    stop = time.time() + seconds

    def worker(i):
        ip = f'198.18.{(i % (ips or clients)) // 250}.{(i % (ips or clients)) % 250 + 1}'
        while time.time() < stop:
            r = call(make_path(), ip)
            with lock:
                res.append(r)

    t0 = time.time()
    th = [threading.Thread(target=worker, args=(i,)) for i in range(clients)]
    [t.start() for t in th]
    [t.join() for t in th]
    wall = time.time() - t0
    ok = [d for c, d in res if c == 200]
    codes: dict[int, int] = {}
    for c, _ in res:
        codes[c] = codes.get(c, 0) + 1
    q = lambda p: sorted(ok)[min(len(ok) - 1, int(len(ok) * p))] if ok else float('nan')
    print(f'| {name} | {clients} | {len(res)} | {len(ok) / wall:.1f}/s | {q(0.5):.2f} s | {q(0.95):.2f} s | '
          f'{", ".join(f"{k}:{v}" for k, v in sorted(codes.items()) if k != 200) or "—"} |', flush=True)
    return res


def main():
    import sys

    random.seed(14 if 'router' in sys.argv[1:] else 13)  # a rerun must not hit the route cache
    print('| Scenario | Clients | Requests | OK per second | p50 | p95 | Not OK |')
    print('|---|---|---|---|---|---|---|', flush=True)
    only_router = 'router' in sys.argv[1:]  # quick rerun of the router part only
    for c in ((12, 24) if only_router else (3, 6, 12, 24)):
        run(f'router, cold 15-40 km legs', cold_leg, c, 45)
        time.sleep(5)
    if only_router:
        return
    # the same leg again and again: the route cache answers
    hot = cold_leg()
    call(hot, '198.19.0.1')
    run('router, cached leg', lambda: hot, 50, 20)
    # one client sending many legs at once: its own line of 3, the rest wait
    run('router, one client 30 legs at once', cold_leg, 30, 30, ips=1)
    run('who am I (/api/me)', lambda: '/me', 40, 15)
    # a short link and a place name that are already stored
    sid = None
    try:
        body = json.dumps({'kind': 'route', 'id': 'loadtest', 'name': 'load test', 'profile': 'nk-gravel',
                           'waypoints': [{'lng': -9.14, 'lat': 38.72}, {'lng': -9.2, 'lat': 38.75}]}).encode()
        with urllib.request.urlopen(urllib.request.Request(API + '/share', data=body, headers={'X-Forwarded-For': '198.19.0.2', 'Content-Type': 'application/json'}), timeout=10) as r:
            sid = json.load(r)['id']
    except Exception as e:
        print('share failed', e)
    if sid:
        run('open a short link', lambda: f'/s/{sid}', 40, 15)
    call('/place/38.800/-9.390', '198.19.0.3')
    run('place name, cached', lambda: '/place/38.800/-9.390', 20, 15)


if __name__ == '__main__':
    main()

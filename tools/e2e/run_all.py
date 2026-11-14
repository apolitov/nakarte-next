#!/usr/bin/env python3
"""Runs every end-to-end suite against one address on all screen profiles and writes one report.

  BASE=https://alexe.pt/maps/ python3 tools/e2e/run_all.py          # all suites
  python3 tools/e2e/run_all.py settings saving                      # some of them

Suites: base (usecases.py, docs/use-cases.md), settings, layers, saving, mobile (sizes incl.
tiny phones and landscape), consent (cookies, analytics privacy, legal pages), panel (start tiles, settings sentence, route menu, loop planner). Profiles come from
usecases.PROFILES: desktop 1440x780, desktop-short 1366x650, phone 390x664, phone-small 375x553.
Writes docs/e2e-run.md; screenshots of failures go to /tmp/nk-e2e-<suite>."""
import os, pathlib, re, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
SUITES = {'base': 'usecases.py', 'settings': 'cases_settings.py', 'layers': 'cases_layers.py',
          'saving': 'cases_saving.py', 'mobile': 'cases_mobile.py', 'consent': 'cases_consent.py', 'panel': 'cases_panel.py'}
BASE = os.environ.get('BASE', 'https://alexe.pt/maps/')

pick = [a for a in sys.argv[1:] if a in SUITES] or list(SUITES)
out = [f'# End-to-end run, {time.strftime("%Y-%m-%d %H:%M")}', '', f'Against {BASE}. Suites: {", ".join(pick)}.', '']
total_fail = 0
for name in pick:
    t0 = time.time()
    env = dict(os.environ, BASE=BASE, VIEWPORT=os.environ.get('VIEWPORT', 'all'), OUT=f'/tmp/nk-e2e-{name}',
               REPORT=f'/tmp/nk-e2e-{name}/report.md')
    pathlib.Path(env['REPORT']).unlink(missing_ok=True)  # a stale report must not stand in for a crashed run
    r = subprocess.run([sys.executable, '-u', str(ROOT / 'tools/e2e' / SUITES[name])], cwd=ROOT, env=env, capture_output=True, text=True)
    table = [l for l in r.stdout.splitlines() if l.startswith('|')]
    if not table and os.path.exists(env['REPORT']):  # base prints plain lines; its table is in the report file
        table = [l for l in open(env['REPORT'], encoding='utf-8').read().splitlines() if l.startswith('|')]
    fails = sum(l.count('FAIL') + l.count('ERROR') for l in table) if table else 1  # a crashed suite is a failure
    total_fail += fails
    out += [f'## {name} ({SUITES[name]}), {round((time.time() - t0) / 60)} min, {fails} failing cells', ''] + (table or ['(no table printed)', '', '```', r.stdout[-2000:], r.stderr[-2000:], '```']) + ['']
    print(f'{name}: {fails} failing cells, {round(time.time() - t0)} s', flush=True)
(ROOT / 'docs/e2e-run.md').write_text('\n'.join(out) + '\n')
print(f'total failing cells: {total_fail}; docs/e2e-run.md')
sys.exit(1 if total_fail else 0)

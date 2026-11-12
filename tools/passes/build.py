"""Builds public/data/passes.geojson: mountain passes from OpenStreetMap and the
FSTR catalogue (tssr.ru, public Google Sheet), merged where they are the same pass.

Usage:
  uv run --with pandas --with odfpy python -I build.py <overpass.json> <fstr.ods> <out.geojson>

Inputs:
  overpass.json  [out:json] answer for
                 node["mountain_pass"="yes"]; node["natural"="saddle"]["rtsa_scale"];
  fstr.ods       https://docs.google.com/spreadsheets/d/1azG7VCU_zvEotb45JGnAJd5J4QI4JOM5_RojHwPyxgg/export?format=ods
"""
import json
import math
import re
import sys

import pandas as pd

CAT_ORDER = ['нк', '1А', '1Б', '2А', '2Б', '3А', '3Б']


def norm_cat(v: str | None) -> str | None:
    """'1a', '1Б*', 'н/к', 'nc', '2A-2Б' -> one of CAT_ORDER (the first of a range), or None."""
    if not v:
        return None
    s = str(v).strip().lower().replace('a', 'а').replace('b', 'б').replace('*', '')
    if s in ('nc', 'н/к', 'нк', 'n/c', 'н.к.', 'н/к*'):
        return 'нк'
    m = re.match(r'([123])\s*([аб])', s)
    if not m:
        return None
    return f'{m.group(1)}{m.group(2).upper()}'


COORD = re.compile(
    r'([NSСЮ])\s*(\d{1,2}(?:[.,]\d+)?)\s*°?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*[\'’′]?)?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*["”″])?'
    r'[\s,;]*'
    r'([EWВЗ])\s*(\d{1,3}(?:[.,]\d+)?)\s*°?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*[\'’′]?)?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*["”″])?',
    re.I,
)


def parse_coord(s) -> tuple[float, float] | None:
    """'N 49°52.759’ E 85°33.309’' (also D°M'S" and decimal degrees) -> (lat, lon)."""
    if not isinstance(s, str):
        return None
    m = COORD.search(s.replace('\n', ' '))
    if not m:
        return None
    f = lambda x: float(x.replace(',', '.')) if x else 0.0
    lat = f(m.group(2)) + f(m.group(3)) / 60 + f(m.group(4)) / 3600
    lon = f(m.group(6)) + f(m.group(7)) / 60 + f(m.group(8)) / 3600
    if m.group(1).upper() in ('S', 'Ю'):
        lat = -lat
    if m.group(5).upper() in ('W', 'З'):
        lon = -lon
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def txt(v) -> str | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = str(v).strip()
    return s or None


def num(v) -> int | None:
    s = txt(v)
    if not s:
        return None
    m = re.search(r'\d{3,4}', s.replace(' ', ''))
    return int(m.group()) if m else None


def read_fstr(path: str) -> list[dict]:
    out = []
    sheets = pd.read_excel(path, engine='odf', sheet_name=None, header=None)
    for sheet, df in sheets.items():
        if df.shape[1] < 9 or sheet.startswith(('DO NOT', '-')):
            continue
        head = [str(c).lower() for c in df.iloc[0].tolist()]
        if not any('координат' in h for h in head):
            continue
        col = lambda *keys: next((i for i, h in enumerate(head) if all(k in h for k in keys)), None)
        c_num, c_name, c_alt = 0, col('назван') or 1, col('друг')
        c_ele, c_cat, c_char = col('высот'), col('кат'), col('характ')
        c_conn, c_info = col('соедин'), col('дополн')
        c_exact = next((i for i, h in enumerate(head) if 'координат' in h and 'прибл' not in h), None)
        c_appr = col('прибл')
        c_first = col('руковод')
        region = [sheet]
        for row in df.iloc[1:].itertuples(index=False):
            r = list(row)
            number = txt(r[c_num])
            name = txt(r[c_name]) if c_name is not None else None
            rest = [txt(x) for i, x in enumerate(r) if i not in (c_num,)]
            if number and not any(rest):
                # region heading: "3.1. Мультинский узел"
                title = re.sub(r'^[\d.\s]+', '', number).strip()
                depth = number.strip().rstrip('.').count('.')
                region = region[: depth + 1] + [title] if depth else [sheet, title]
                continue
            exact = parse_coord(r[c_exact]) if c_exact is not None else None
            appr = parse_coord(r[c_appr]) if c_appr is not None else None
            pos = exact or appr
            if not pos or not (name or number):
                continue
            out.append(
                {
                    'lat': pos[0],
                    'lon': pos[1],
                    'approx': exact is None,
                    'name': name,
                    'alt': txt(r[c_alt]) if c_alt is not None else None,
                    'ele': num(r[c_ele]) if c_ele is not None else None,
                    'cat': norm_cat(txt(r[c_cat]) if c_cat is not None else None),
                    'cat_raw': txt(r[c_cat]) if c_cat is not None else None,
                    'kind': txt(r[c_char]) if c_char is not None else None,
                    'connects': txt(r[c_conn]) if c_conn is not None else None,
                    'first': txt(r[c_first]) if c_first is not None else None,
                    'info': txt(r[c_info]) if c_info is not None else None,
                    'region': ' / '.join(x for x in region if x),
                    'fstr_no': number,
                }
            )
    return out


def read_osm(path: str) -> list[dict]:
    out = []
    for e in json.load(open(path, encoding='utf-8'))['elements']:
        t = e.get('tags', {})
        out.append(
            {
                'lat': e['lat'],
                'lon': e['lon'],
                'osm': e['id'],
                'name': t.get('name:ru') or t.get('name'),
                'name_local': t.get('name') if t.get('name:ru') and t.get('name') != t.get('name:ru') else None,
                'name_en': t.get('name:en'),
                'ele': num(t.get('ele')),
                'cat': norm_cat(t.get('rtsa_scale')),
                'sac': t.get('sac_scale'),
                'wikipedia': t.get('wikipedia'),
                'westra': t.get('westra_ref'),
            }
        )
    return out


def dist_m(a, b) -> float:
    dlat = math.radians(b['lat'] - a['lat'])
    dlon = math.radians(b['lon'] - a['lon']) * math.cos(math.radians((a['lat'] + b['lat']) / 2))
    return 6371000 * math.hypot(dlat, dlon)


def simple(s: str | None) -> str:
    return re.sub(r'[^a-zа-я0-9]', '', (s or '').lower().replace('ё', 'е').replace('пер.', '').replace('перевал', ''))


def merge(osm: list[dict], fstr: list[dict]) -> list[dict]:
    """FSTR passes join the nearest OSM pass within 300 m (600 m with a matching name or
    height within 40 m); otherwise they stay as separate points."""
    grid: dict[tuple[int, int], list[int]] = {}
    for i, p in enumerate(osm):
        grid.setdefault((int(p['lat'] * 100), int(p['lon'] * 100)), []).append(i)
    used: set[int] = set()
    merged = [dict(p, src=['osm']) for p in osm]
    extra = []
    for f in fstr:
        gy, gx = int(f['lat'] * 100), int(f['lon'] * 100)
        best, bd = None, 1e9
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for i in grid.get((gy + dy, gx + dx), []):
                    if i in used:
                        continue
                    d = dist_m(f, osm[i])
                    same_name = simple(f['name']) and simple(f['name']) in (simple(osm[i]['name']), simple(osm[i].get('name_local')))
                    near_ele = f['ele'] and osm[i]['ele'] and abs(f['ele'] - osm[i]['ele']) <= 40
                    limit = 600 if (same_name or near_ele) else 300
                    if d <= limit and d < bd:
                        best, bd = i, d
        if best is None:
            extra.append(dict(f, src=['fstr']))
            continue
        used.add(best)
        m = merged[best]
        m['src'] = ['osm', 'fstr']
        for k in ('alt', 'kind', 'connects', 'first', 'info', 'region', 'fstr_no', 'cat_raw', 'approx'):
            m[k] = f.get(k)
        m['name'] = m['name'] or f['name']
        m['ele'] = m['ele'] or f['ele']
        # FSTR is the reference catalogue for categories
        m['cat'] = f['cat'] or m['cat']
    return merged + extra


KEYS = {  # short keys keep the file small
    'name': 'n', 'name_local': 'nl', 'name_en': 'ne', 'alt': 'a', 'ele': 'e', 'cat': 'c', 'cat_raw': 'cr',
    'kind': 'k', 'connects': 'cn', 'first': 'f', 'info': 'i', 'region': 'r', 'fstr_no': 'fn', 'osm': 'o',
    'sac': 's', 'wikipedia': 'w', 'westra': 'wr', 'approx': 'ap', 'src': 'src',
}


def to_geojson(passes: list[dict]) -> dict:
    feats = []
    for p in passes:
        props = {KEYS[k]: v for k, v in p.items() if k in KEYS and v not in (None, '', False, [])}
        # rank: 0 = categorised, 1 = named, 2 = unnamed; the map shows ranks progressively by zoom
        props['rk'] = 0 if p.get('cat') and p['cat'] != 'нк' else 1 if p.get('name') else 2
        feats.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(p['lon'], 5), round(p['lat'], 5)]}, 'properties': props})
    return {'type': 'FeatureCollection', 'features': feats}


def main():
    osm_path, fstr_path, out_path = sys.argv[1:4]
    osm = read_osm(osm_path)
    fstr = read_fstr(fstr_path)
    passes = merge(osm, fstr)
    gj = to_geojson(passes)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(gj, f, ensure_ascii=False, separators=(',', ':'))
    both = sum(1 for p in passes if p['src'] == ['osm', 'fstr'])
    cats = sum(1 for p in passes if p.get('cat') and p['cat'] != 'нк')
    print(f'osm {len(osm)}, fstr {len(fstr)}, merged {both}, total {len(passes)}, with category {cats}')


if __name__ == '__main__':
    main()

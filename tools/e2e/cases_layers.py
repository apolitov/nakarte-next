#!/usr/bin/env python3
"""End-to-end checks of map layers, overlays, POIs, photos and the map controls block.

  python3 tools/e2e/cases_layers.py                 # every case on all three screen profiles
  python3 tools/e2e/cases_layers.py L1 L4           # only these cases
  VIEWPORT=phone python3 tools/e2e/cases_layers.py  # a profile name or comma list
Env: BASE (default https://alexe.pt/maps/), OUT (failure screenshots, default /tmp/nk-e2e-layers).
Profiles come from usecases.PROFILES (desktop, desktop-short, phone, phone-small).
One route near Sintra per case; external load stays small (one route, one zoom-in for photos).
A failing case is run once more (errors up to twice more); passing on a retry is reported as flaky.
"""
import asyncio, io, json, os, pathlib, re, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import usecases as U
from usecases import open_app, check, Fail, settle, finish_with_name, pick
from playwright.async_api import async_playwright, Page

BASE = os.environ.get('BASE', 'https://alexe.pt/maps/')
U.BASE = BASE
OUT = pathlib.Path(os.environ.get('OUT', '/tmp/nk-e2e-layers'))
OUT.mkdir(parents=True, exist_ok=True)

PROF = U.PROFILES
PTS = {  # ~5 km hilly route near Sintra, fractions of the map canvas
    'desk': [(0.2, 0.4), (0.5, 0.25), (0.8, 0.45)],
    'short': [(0.2, 0.35), (0.5, 0.2), (0.8, 0.4)],
    'phone': [(0.2, 0.25), (0.7, 0.45), (0.3, 0.7)],
}


def pts_for(name):
    return PTS['phone'] if U.is_phone(name) else PTS['short' if 'short' in name else 'desk']


class NA(Exception):
    pass


# ---------- helpers ----------
async def new_ctx(browser, name):
    ctx = await browser.new_context(locale='en-US', accept_downloads=True, **PROF[name])
    await ctx.route(re.compile(r'googletagmanager|google-analytics'), lambda r: r.abort())
    await ctx.add_init_script("try{localStorage.setItem('nm-consent','denied')}catch(e){}")
    ctx.reqs, ctx.resps, ctx.prof, ctx.mobile = [], [], name, U.is_phone(name)  # type: ignore[attr-defined]
    ctx.on('request', lambda r: ctx.reqs.append(r.url))
    ctx.on('response', lambda r: ctx.resps.append((r.url, r.status)))
    return ctx


def start_hash(ctx):
    return ('m=13' if ctx.mobile else 'm=14') + '/38.80/-9.39&l=Co'


def mob(pg):
    return pg.context.mobile


def hash_l(pg):
    h = pg.url.split('#', 1)[1] if '#' in pg.url else ''
    m = re.search(r'(?:^|&)l=([^&]*)', h)
    return [x for x in m.group(1).split('/') if x] if m else []


def zoom_of(pg):
    h = pg.url.split('#', 1)[1] if '#' in pg.url else ''
    m = re.search(r'(?:^|&)m=(\d+)', h)
    return int(m.group(1)) if m else -1


async def until(fn, timeout=10, step=0.25, msg='timeout'):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = fn()
        if asyncio.iscoroutine(r):
            r = await r
        if r:
            return r
        await asyncio.sleep(step)
    raise Fail(msg)


async def _zero(coro):
    return (await coro) == 0


async def tap(pg, loc):
    if mob(pg):
        await loc.tap()
    else:
        await loc.click()
    await pg.wait_for_timeout(250)


async def zoom(pg, d):
    """One zoom step with the button, or with the keyboard where the buttons are hidden (touch screens)."""
    await menu_close(pg)  # a click on the zoom buttons closes the menu anyway
    b = pg.locator('[aria-label="Zoom in"]' if d > 0 else '[aria-label="Zoom out"]')
    ok = await b.first.is_visible() and await b.first.evaluate(
        "e => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === e || e.contains(t) }")
    if ok:
        await tap(pg, b)
    else:
        await pg.evaluate("document.querySelector('.maplibregl-canvas').focus()")
        await pg.keyboard.press('=' if d > 0 else '-')
    await pg.wait_for_timeout(1100)


BTN = {'base': '.layersbtn[aria-label="Map"]', 'over': '.layersbtn[aria-label="Overlays"]', 'poi': '.layersbtn.poibtn'}


async def menu_open(pg, which):
    b = pg.locator(BTN[which])
    if await b.get_attribute('aria-expanded') != 'true':
        await tap(pg, b)
    await pg.wait_for_selector('.lpop', timeout=5000)


async def menu_close(pg):
    if await pg.locator('.lpop').count():
        await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(250)


async def row(pg, text):
    return pg.locator('.lpop label', has_text=text).first


async def tick(pg, text):
    await tap(pg, await row(pg, text))


async def sheet(pg, want):
    if not mob(pg):
        return
    g = pg.locator('.grab')
    if (await g.get_attribute('aria-expanded') == 'true') != want:
        await tap(pg, g)
        await pg.wait_for_timeout(500)


async def route_ready(pg, timeout=90):
    async def ok():
        t = (await pg.locator('.sum').text_content() or '') if await pg.locator('.sum').count() else ''
        return bool(re.search(r'\d\s*km', t)) and 'computing' not in t and not await pg.locator('.busy').count()
    good = 0
    t0 = time.time()
    while time.time() - t0 < timeout:
        good = good + 1 if await ok() else 0
        if good >= 4:
            return
        await pg.wait_for_timeout(300)
    raise Fail('route was not computed')


async def route_km(pg):
    t = (await pg.locator('.sum').text_content() or '').replace('\n', ' ')
    m = re.search(r'([\d.]+)\s*km', t)
    check(m, f'no length in the summary: {t[:80]!r}')
    return float(m.group(1))


async def tap_map(pg, fx, fy):
    x, y = await U.canvas_xy(pg, fx, fy)
    if mob(pg):
        await pg.touchscreen.tap(x, y)
    else:
        await pg.mouse.click(x, y)
    await pg.wait_for_timeout(450)


async def make_route(pg, name='L'):
    await U.ensure_editing(pg)
    for fx, fy in pts_for(pg.context.prof):
        await tap_map(pg, fx, fy)
    await settle(pg)
    await route_ready(pg)
    await finish_with_name(pg, name)
    await sheet(pg, False)
    check(await route_km(pg) > 2, 'route shorter than 2 km')


async def app(ctx, hash_=None):
    pg = await open_app(ctx, hash_ or start_hash(ctx))
    return pg


async def counts(pg):
    """{category title: text of its count} from the open POI menu."""
    return await pg.evaluate("""() => Object.fromEntries([...document.querySelectorAll('#nk-pois .row')]
      .filter(r => r.querySelector('.n')).map(r => [r.querySelector('.nm').textContent.trim(), r.querySelector('.n').textContent.trim()]))""")


async def stable_counts(pg, timeout=90):
    prev, same, t0 = None, 0, time.time()
    while time.time() - t0 < timeout:
        c = await counts(pg)
        busy = any(v == '…' for v in c.values())
        same = same + 1 if (c == prev and not busy) else 0
        prev = c
        if same >= 4:
            return c
        await pg.wait_for_timeout(800)
    raise Fail(f'counts never settled: {prev}')


def total(c, names):
    return sum(int(c.get(n) or 0) for n in names)


async def shot(pg):
    await menu_close(pg)
    await pg.mouse.move(2, 2)
    await pg.wait_for_timeout(700)
    from PIL import Image
    import numpy as np
    png = await pg.locator('.maplibregl-canvas').screenshot()
    return np.asarray(Image.open(io.BytesIO(png)).convert('RGB')).astype(int)


async def set_colour(pg, label):
    await menu_open(pg, 'over')
    await tick(pg, label)
    return await shot(pg)


def diff_mask(a, b, thr=40):
    import numpy as np
    return np.abs(a - b).max(axis=2) > thr


# ---------- L1 base map menu ----------
async def L1(ctx):
    pg = await app(ctx)
    await tap(pg, pg.locator(BTN['base']))
    await pg.wait_for_selector('.lpop')
    check(await pg.get_attribute(BTN['base'], 'aria-expanded') == 'true', 'aria-expanded not true')
    groups = await pg.locator('.lpop h4').all_inner_texts()
    check(len(groups) >= 3 and any('openstreetmap' in g.lower() for g in groups), f'groups: {groups}')
    check(await pg.locator('.lpop input[type=radio][name=nk-base]').count() >= 5, 'too few base maps')
    check(await pg.locator('.lpop input[value=Co]').is_checked(), 'current map (CyclOSM) not checked')
    for label, lid, pat in [('ESRI satellite', 'E', 'arcgisonline.com'), ('OpenTopoMap', 'Otm', 'opentopomap.org')]:
        n = len(pg.context.reqs)
        await tick(pg, label)
        await until(lambda: hash_l(pg)[:1] == [lid], 8, msg=f'hash l= is {hash_l(pg)}, expected {lid} first')
        await until(lambda: any(pat in u for u in pg.context.reqs[n:]), 10, msg=f'no tile requests to {pat}')
        check(await pg.locator(f'.lpop input[value={lid}]').is_checked(), f'{label} radio not checked')
    # closing: Esc, then the close button, then the button again (toggle)
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(250)
    check(await pg.locator('.lpop').count() == 0, 'Esc did not close the menu')
    await menu_open(pg, 'base')
    await tap(pg, pg.locator('.lpop .x[aria-label="Close"]'))
    check(await pg.locator('.lpop').count() == 0, 'close button did not close the menu')
    await menu_open(pg, 'base')
    await tap(pg, pg.locator(BTN['base']))
    check(await pg.locator('.lpop').count() == 0, 'second press of the button did not close the menu')
    # one menu at a time
    await menu_open(pg, 'base')
    await tap(pg, pg.locator(BTN['over']))
    check(await pg.locator('.lpop').count() == 1 and await pg.locator('.lpop h3').inner_text() == 'Overlays', 'overlays menu did not replace the map menu')
    await tap(pg, pg.locator(BTN['poi']))
    check(await pg.locator('.lpop').count() == 1 and await pg.locator('#nk-pois').count() == 1 and await pg.locator('#nk-layers').count() == 0,
          'POIs menu did not replace the overlays menu')
    exp = [await pg.get_attribute(BTN[k], 'aria-expanded') for k in BTN]
    check(exp == ['false', 'false', 'true'], f'aria-expanded of the three buttons: {exp}')
    # a click on the map closes an unpinned menu (on a phone the sheet covers most of the map)
    pt = await pg.evaluate("""() => { const c = document.querySelector('.maplibregl-canvas').getBoundingClientRect();
      for (let y = c.top + 80; y < c.bottom - 20; y += 20) for (let x = c.left + 10; x < c.right - 10; x += 20) {
        const e = document.elementFromPoint(x, y); if (e && e.closest('.maplibregl-canvas') && !e.closest('.lpop,.tbw,.layersbtns,.orbit,.profwrap,.side,.maplibregl-ctrl')) return [x, y]; } return null }""")
    if pt is None:
        raise NA('no free map area beside the menu sheet to click on (rest passed)')
    if mob(pg):
        await pg.touchscreen.tap(*pt)
    else:
        await pg.mouse.click(*pt)
    await pg.wait_for_timeout(400)
    check(await pg.locator('.lpop').count() == 0, 'a click on the map did not close the menu')


# ---------- L2 overlays ----------
OVER = [('Cycling routes', 'Wc', 'waymarkedtrails.org/cycling'), ('Heatmap (Ride with GPS)', 'Hr', 'heatmap.ridewithgps.com'),
        ('Hiking routes', 'Wh', 'waymarkedtrails.org/hiking'), ('Mountain passes', 'P', None),
        ('GPS traces (OSM)', 'H', 'gps.tile.openstreetmap.org')]


async def L2(ctx):
    pg = await app(ctx)
    await menu_open(pg, 'over')
    groups = [g.lower() for g in await pg.locator('.lpop h4').all_inner_texts()]
    check(groups[:3] == ['cycling', 'hiking', 'all activities'] or set(groups) >= {'cycling', 'hiking', 'all activities'}, f'groups: {groups}')
    for label, oid, pat in OVER:
        n = len(pg.context.reqs)
        await tick(pg, label)
        await until(lambda: oid in hash_l(pg), 8, msg=f'{label}: hash l= is {hash_l(pg)}')
        check(await pg.locator(f'.lpop input[value={oid}]').is_checked(), f'{label}: not checked')
        if pat:
            try:
                await until(lambda: any(pat in u for u in pg.context.reqs[n:]), 8, msg='')
            except Fail:  # nudge the map once: a new zoom needs new tiles
                await menu_close(pg)
                await zoom(pg, 1)
                await menu_open(pg, 'over')
                await until(lambda: any(pat in u for u in pg.context.reqs[n:]), 15, msg=f'{label}: no requests to {pat}, even after a zoom step')
        else:
            await pg.wait_for_timeout(1500)
    check(hash_l(pg)[0] == 'Co' and len(hash_l(pg)) == 6, f'hash after all on: {hash_l(pg)}')
    for label, oid, pat in OVER:
        await tick(pg, label)
        await until(lambda: oid not in hash_l(pg), 8, msg=f'{label}: still in hash {hash_l(pg)}')
    check(hash_l(pg) == ['Co'], f'hash after all off: {hash_l(pg)}')
    # a removed overlay stops asking for tiles: zoom in and watch
    await menu_open(pg, 'over')
    await tick(pg, 'Cycling routes')
    await until(lambda: 'Wc' in hash_l(pg), 5)
    await tick(pg, 'Cycling routes')
    await menu_close(pg)
    n = len(pg.context.reqs)
    await zoom(pg, 1)
    await pg.wait_for_timeout(1500)
    stray = [u for u in pg.context.reqs[n:] if 'waymarkedtrails.org/cycling' in u]
    check(not stray, f'{len(stray)} cycling tile requests after the overlay was removed')


# ---------- L3 route colouring ----------
async def L3(ctx):
    pg = await app(ctx)
    await make_route(pg)
    await menu_open(pg, 'over')
    check(await pg.locator('.lpop input[name=nk-color][value=grade]').is_checked(), 'default colouring is not grade')
    labels = await pg.locator('.lpop h4').all_inner_texts()
    check(any('colouring' in x.lower() for x in labels), f'no colouring group: {labels}')
    plain = await set_colour(pg, 'Single colour')
    surf = await set_colour(pg, 'Surface only')
    grade = await set_colour(pg, 'Grade and surface')
    import numpy as np
    for a, b, nm in [(grade, plain, 'grade vs single'), (surf, plain, 'surface vs single'), (grade, surf, 'grade vs surface')]:
        n = int(diff_mask(a, b).sum())
        check(n > 300, f'{nm}: the line looks the same ({n} px differ)')
    m = diff_mask(grade, plain)
    px = plain[m]
    blue = (np.abs(px - np.array([0x2a, 0x6d, 0xf4])).max(axis=1) < 40).mean()
    check(blue > 0.6, f'single colour: only {blue:.0%} of the line pixels are the plain colour')
    n_grade = len({tuple(c) for c in (grade[m] // 48)})
    n_plain = len({tuple(c) for c in (px // 48)})
    check(n_grade > n_plain, f'grade line has no more colours ({n_grade}) than single colour ({n_plain})')


# ---------- L4 POIs ----------
async def L4(ctx):
    pg = await app(ctx)
    await make_route(pg)
    await menu_open(pg, 'poi')
    r = pg.locator('.lpop .seg button[role=radio]')
    check(await r.all_inner_texts() == ['100 m', '300 m', '1 km'], f'radii: {await r.all_inner_texts()}')
    check(await pg.locator('.seg button[aria-checked=true]').inner_text() == '300 m', 'default radius is not 300 m')
    badge = pg.locator('.poibtn .cnt')
    check(await badge.inner_text() == '2', f'default badge: {await badge.inner_text()}')
    wanted = ['Cafes and restaurants', 'Shops', 'Sights', 'Viewpoints']
    for w in wanted:
        await tick(pg, w)
    check(await badge.inner_text() == '6', f'badge after four more: {await badge.inner_text()}')
    c = await stable_counts(pg)
    check(all(re.fullmatch(r'\d+', c.get(w, '')) for w in wanted + ['Bike repair']), f'counts not numbers: {c}')
    n300 = total(c, wanted)
    check(n300 > 0, f'no POIs of the four categories within 300 m of a 5 km route in Sintra: {c}')
    await until(lambda: pg.locator('.poi-mk').count(), 10, msg='no POI markers on the map')
    check(await pg.locator('.poi-mk').count() > 0, 'no markers')
    res = {}
    for lab, rad in [('100 m', 100), ('1 km', 1000)]:
        await tap(pg, pg.locator('.seg button[role=radio]', has_text=lab))
        check(await pg.locator('.seg button[aria-checked=true]').inner_text() == lab, f'{lab} not selected')
        await pg.wait_for_timeout(2500)
        res[rad] = total(await stable_counts(pg), wanted)
    check(res[100] <= n300 <= res[1000], f'counts by radius 100/300/1000: {res[100]}/{n300}/{res[1000]}')
    check(res[1000] > res[100], f'radius changes nothing: {res}')
    await tap(pg, pg.locator('.seg button[role=radio]', has_text='300 m'))
    await stable_counts(pg)
    await tick(pg, 'Cafes and restaurants')
    check(await badge.inner_text() == '5', f'badge after one off: {await badge.inner_text()}')
    await pg.wait_for_timeout(500)
    check(await pg.locator('.poi-mk[aria-label^="Cafes and restaurants"]').count() == 0, 'cafe markers still on the map')
    check(await pg.locator('.poi-mk').count() > 0, 'other markers vanished too')


# ---------- L5 POIs in the timeline ----------
async def L5(ctx):
    pg = await app(ctx)
    await make_route(pg)
    await menu_open(pg, 'poi')
    for w in ['Cafes and restaurants', 'Sights', 'Viewpoints']:
        await tick(pg, w)
    await stable_counts(pg)
    check(await pg.locator('.lpop .tl input').is_checked(), '"Show in the timeline" is not on by default')
    await sheet(pg, True) if mob(pg) else None
    allb = pg.locator('.tl .vw button', has_text='All')
    await allb.click()
    await pg.wait_for_timeout(400)

    async def poi_rows():
        more = pg.locator('.tl .more')
        if await more.count() and 'less' not in (await more.first.inner_text()).lower():
            await more.first.click()
            await pg.wait_for_timeout(300)
        return await pg.locator('.tl .eico.poi').count()
    on = await poi_rows()
    check(on > 0, 'no POI rows in the timeline with the option on')
    await sheet(pg, False)
    await menu_open(pg, 'poi')
    await tick(pg, 'Show in the timeline')
    await pg.wait_for_timeout(600)
    off = await poi_rows()
    check(off == 0, f'{off} POI rows remain with the option off')
    await menu_open(pg, 'poi')
    await tick(pg, 'Show in the timeline')
    await pg.wait_for_timeout(600)
    check(await poi_rows() == on, 'POI rows did not return')
    txt = await pg.locator('.tl .eico.poi + .tx').first.inner_text()
    check(txt.strip(), 'POI row without a label')


# ---------- L6 springs ----------
async def L6(ctx):
    pg = await app(ctx)
    await make_route(pg)
    await menu_open(pg, 'poi')
    check(await (await row(pg, 'Water and springs')).locator('input').is_checked(), 'water is not on by default')
    pat = re.compile(r'/maps/api/springs/\d+/\d+')
    await until(lambda: any(pat.search(u) for u in pg.context.reqs), 40, msg='no request to /maps/api/springs/')
    url = next(u for u in pg.context.reqs if pat.search(u))
    await until(lambda: any(u == url for u, _ in pg.context.resps), 130, msg='no response from springs')
    st = [s for u, s in pg.context.resps if u == url][0]
    check(st == 200, f'springs answered {st} for {url}')
    body = await pg.evaluate("async (u) => { const r = await fetch(u); return await r.json() }", url)
    check(isinstance(body, list), f'springs body is not a list: {str(body)[:80]}')
    c = await stable_counts(pg, 130)
    check(re.fullmatch(r'\d+', c.get('Water and springs', '')), f'water count: {c}')


# ---------- L7 photos on the map ----------
async def photos_on(pg):
    await menu_open(pg, 'poi')
    await tick(pg, 'Street photos')
    await pg.wait_for_selector('.srcs')


async def L7(ctx):
    pg = await app(ctx)
    await make_route(pg)
    await photos_on(pg)
    names = await pg.locator('.srcs .sub span').all_inner_texts()
    check(names == ['Wikimedia Commons', 'Mapillary', 'Panoramax'], f'sources: {names}')
    check(await pg.locator('.srcs input:checked').count() == 3, 'sources are not all on by default')
    z = zoom_of(pg)
    check(z >= 13, f'start zoom {z}')
    check(await pg.locator('.lpop .src', has_text='zoom in to see them').count() == 0, 'zoom hint shown at z>=13')
    await until(lambda: pg.locator('.ph-mk').count(), 75, msg='no photo markers at z>=13 near the route')
    check(any('commons.wikimedia.org' in u for u in pg.context.reqs), 'no Commons requests')
    check(any('/api/photos' in u for u in pg.context.reqs), 'no /api/photos request (Mapillary and Panoramax)')
    # zoom out below 13: the hint appears
    for _ in range(4):
        if zoom_of(pg) < 13:
            break
        await zoom(pg, -1)
    check(zoom_of(pg) < 13, f'could not zoom out below 13, at {zoom_of(pg)}')
    await menu_open(pg, 'poi')
    await until(lambda: pg.locator('.lpop .src', has_text='zoom in to see them').count(), 5, msg=f'no zoom hint at z={zoom_of(pg)}')
    await zoom(pg, 1)
    await menu_open(pg, 'poi')
    await until(lambda: _zero(pg.locator('.lpop .src', has_text='zoom in to see them').count()), 5, msg=f'zoom hint stays at z={zoom_of(pg)}')
    # sources: leave only Commons, then add Panoramax; the choice is remembered
    for nm in ['Mapillary', 'Panoramax']:
        await tap(pg, pg.locator('.srcs .sub', has_text=nm))
    saved = json.loads(await pg.evaluate("localStorage.getItem('nk-poi-photoSrc')"))
    check(saved == ['commons'], f'saved sources {saved}')
    check(await pg.locator('.srcs input:checked').count() == 1, 'checkbox states')
    await tap(pg, pg.locator('.srcs .sub', has_text='Panoramax'))
    saved = json.loads(await pg.evaluate("localStorage.getItem('nk-poi-photoSrc')"))
    check(saved == ['commons', 'panoramax'], f'saved sources {saved}')
    # photos off: markers go
    await tick(pg, 'Street photos')
    await pg.wait_for_timeout(800)
    check(await pg.locator('.ph-mk').count() == 0, 'photo markers remain after switching photos off')
    check(await pg.locator('.srcs').count() == 0, 'source list remains')


# ---------- L8 photo viewer ----------
async def L8(ctx):
    pg = await app(ctx)
    await make_route(pg)
    await photos_on(pg)
    await until(lambda: pg.locator('.ph-mk').count(), 75, msg='no photo markers')
    await pg.wait_for_timeout(2500)  # more pieces may arrive
    await menu_close(pg)
    for attempt in range(6):
        if await pg.locator('.pv').count():
            break
        pos = await pg.evaluate("""() => { const c = document.querySelector('.maplibregl-canvas').getBoundingClientRect();
          for (const e of document.querySelectorAll('.ph-mk')) { const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
            if (x > c.left && x < c.right && y > c.top + 70 && y < c.bottom - 30) { const t = document.elementFromPoint(x, y); if (t === e || e.contains(t)) return [x, y]; } } return null }""")
        check(pos, 'no photo marker is clickable on screen')
        if mob(pg):
            await pg.touchscreen.tap(*pos)
        else:
            await pg.mouse.click(*pos)
        await pg.wait_for_timeout(1500)
    check(await pg.locator('.pv').count() == 1, 'the viewer did not open after clicking photo markers')
    await until(lambda: pg.evaluate("(() => { const i = document.querySelector('.pv img'); return !!i && i.complete && i.naturalWidth > 0 })()"), 30, msg='photo did not load')
    box = await pg.locator('.pv img').bounding_box()
    check(box['width'] > 100 and box['height'] > 60, f'photo box {box}')
    from PIL import Image
    import numpy as np
    a = np.asarray(Image.open(io.BytesIO(await pg.locator('.pv img').screenshot())).convert('L')).astype(float)
    check(a.mean() > 20 and a.std() > 8, f'photo looks black or flat (mean {a.mean():.0f}, std {a.std():.0f})')
    cap = await pg.locator('.pv .cap').inner_text()
    check(re.search(r'km\s*\d', cap) and re.search(r'Wikimedia Commons|Mapillary|Panoramax', cap), f'caption: {cap!r}')
    m = re.search(r'(\d+) / (\d+)', cap)
    check(m, f'no counter in caption {cap!r}')
    n = int(m.group(2))

    async def cur():
        return int(re.search(r'(\d+) / ', await pg.locator('.pv .cap').inner_text()).group(1))
    if n < 2:
        check(await pg.locator('.pv .nav').count() == 0, 'nav buttons with a single photo')
    else:
        i0 = await cur()
        await tap(pg, pg.locator('.pv .nav.next'))
        check(await cur() == i0 % n + 1, 'next button')
        await tap(pg, pg.locator('.pv .nav.prev'))
        check(await cur() == i0, 'prev button')
        await pg.keyboard.press('ArrowRight')
        check(await cur() == i0 % n + 1, 'ArrowRight')
        await pg.keyboard.press('ArrowLeft')
        check(await cur() == i0, 'ArrowLeft')
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(300)
    check(await pg.locator('.pv').count() == 0, 'Esc did not close the viewer')
    if n < 2:
        raise NA(f'only {n} photo near the route: next/prev not exercised (the rest passed)')


# ---------- L9 2D/3D/zoom/locate ----------
async def boxes(pg):
    out = {}
    for k, sel in [('dim', '.orbit .dim'), ('d2', '.dim button >> nth=0'), ('d3', '.dim button >> nth=1'), ('zin', '[aria-label="Zoom in"]'),
                   ('zout', '[aria-label="Zoom out"]'), ('loc', '.orbit .loc'), ('orbit', '.orbit')]:
        l = pg.locator(sel).first
        out[k] = await l.bounding_box() if await l.is_visible() else None
    return out


def same(a, b, tol=1.5):
    return all(abs(a[k] - b[k]) <= tol for k in ('x', 'y', 'width', 'height'))


async def L9(ctx):
    pg = await app(ctx)
    b0 = await boxes(pg)
    check(b0['loc'] is not None, 'no "Find my location" button')
    check(b0['zout'] is None or b0['loc']['y'] > b0['zout']['y'], 'location button is not below zoom out')
    vp = pg.viewport_size
    check(b0['loc']['y'] + b0['loc']['height'] <= vp['height'] and b0['orbit']['x'] + b0['orbit']['width'] <= vp['width'], 'block leaves the screen')
    z = zoom_of(pg)
    no_zoom_btn = b0['zin'] is None
    await zoom(pg, 1)
    check(zoom_of(pg) == z + 1, f'zoom in: {z} -> {zoom_of(pg)}')
    await zoom(pg, -1)
    check(zoom_of(pg) == z, f'zoom out: back to {zoom_of(pg)}, expected {z}')
    # locate: headless has no permission; the label must be one of the sensible ones
    lab0 = await pg.locator('.orbit .loc').get_attribute('aria-label')
    check(lab0 == 'Find my location', f'initial label {lab0!r}')
    await tap(pg, pg.locator('.orbit .loc'))
    await pg.wait_for_timeout(1500)
    lab = await pg.locator('.orbit .loc').get_attribute('aria-label')
    st = await pg.locator('.orbit .loc').get_attribute('data-state')
    check(lab in ('Find my location', 'Location access is blocked in the browser', 'Stop following my location'), f'label {lab!r} (state {st})')
    check(st in ('OFF', 'WAITING_ACTIVE', 'ACTIVE_LOCK', 'BACKGROUND', 'ACTIVE_ERROR', 'BACKGROUND_ERROR', 'denied'), f'state {st}')
    # 3D
    check(await pg.locator('.orbit .compass').count() == 0, 'rotate/tilt rows in 2D')
    await tap(pg, pg.locator('.dim button', has_text='3D'))
    await until(lambda: pg.locator('.orbit .compass').count(), 8, msg='no rotate/tilt rows in 3D')
    await pg.wait_for_timeout(1500)
    for lbl in ['Turn left (Q)', 'Turn right (E)', 'Tilt more (Shift+↑)', 'Tilt less (Shift+↓)']:
        check(await pg.locator(f'.orbit [aria-label="{lbl}"]').count() == 1, f'missing {lbl}')
    b3 = await boxes(pg)
    for k in ('dim', 'd2', 'd3', 'zin', 'zout', 'loc'):
        if b0[k] is None:
            continue
        check(b3[k] is not None and same(b0[k], b3[k]), f'{k} moved in 3D: {b0[k]} -> {b3[k]}')
    check(b3['orbit']['height'] > b0['orbit']['height'] + 40, 'the block did not grow in 3D')
    check(b3['orbit']['y'] >= 0, 'block grew off the screen')
    rows_hidden = not await pg.locator('.orbit [aria-label="Tilt less (Shift+↓)"]').is_visible()
    if not rows_hidden:
        deg = lambda: pg.locator('.orbit .deg').inner_text()
        d1 = int((await deg()).rstrip('°'))
        check(d1 > 30, f'tilt after switching to 3D: {d1}')
        await tap(pg, pg.locator('.orbit [aria-label="Tilt less (Shift+↓)"]'))
        await pg.wait_for_timeout(700)
        d2 = int((await deg()).rstrip('°'))
        check(d2 < d1, f'tilt less: {d1} -> {d2}')
        await tap(pg, pg.locator('.orbit [aria-label="Turn right (E)"]'))
        await pg.wait_for_timeout(700)
        check(same(b0['d3'], (await boxes(pg))['d3']), '3D button moved after turning')
    await tap(pg, pg.locator('.dim button', has_text='2D'))
    await until(lambda: _zero(pg.locator('.orbit .compass').count()), 5, msg='rotate/tilt rows stay in 2D')
    await pg.wait_for_timeout(1000)
    b2 = await boxes(pg)
    for k in ('dim', 'zin', 'zout', 'loc', 'orbit'):
        if b0[k] is None:
            continue
        check(b2[k] is not None and same(b0[k], b2[k]), f'{k} not back in place in 2D: {b0[k]} -> {b2[k]}')
    if rows_hidden:
        raise NA('tilt/turn rows are hidden on this screen height, so tilt and turn were not exercised (rest passed)')
    if no_zoom_btn:
        raise NA('zoom +/- buttons are hidden on this touch profile; zoom was checked with the keyboard (rest passed)')


# ---------- L10 grade legend and line colours ----------
BIKE_CHIPS = ['↓ >10%', '↓ 1-10%', '↑ 1-3%', '↑ 3-6%', '↑ 6-10%', '↑ 10-14%', '↑ 14-18%', '↑ >18%']
HIKE_CHIPS = ['↓ >30%', '↓ 10-30%', '↑ 10-20%', '↑ 20-30%', '↑ 30-45%', '↑ >45%']


async def chips(pg):
    return [x.strip() for x in await pg.locator('.prof .leg .lg').all_text_contents()]


async def L10(ctx):
    pg = await app(ctx)
    await make_route(pg)
    check(await pg.locator('.seg, [role=radiogroup]').count() >= 0, '')
    await sheet(pg, True) if mob(pg) else None
    await until(lambda: pg.locator('.prof .leg .lg').count(), 8, msg='no legend under the profile')
    c = await chips(pg)
    miss = [x for x in BIKE_CHIPS if x not in c]
    check(not miss, f'bike legend lacks {miss}; has {c}')
    check(any('flat' in x for x in c), f'no flat chip: {c}')
    await sheet(pg, False)
    # the map line on a hilly route has several colours
    plain = await set_colour(pg, 'Single colour')
    grade = await set_colour(pg, 'Grade and surface')
    import numpy as np
    m = diff_mask(grade, plain)
    px = grade[m]
    sat = px.max(axis=1) - px.min(axis=1)
    px = px[sat > 60]
    keys, cnt = np.unique(px // 48, axis=0, return_counts=True)
    colours = int((cnt >= 40).sum())
    check(colours >= 3, f'the line has only {colours} distinct colours on a hilly route ({len(px)} px)')
    # hiking: another scale
    await sheet(pg, True) if mob(pg) else None
    await pick(pg, 'Hike')
    await settle(pg)
    await route_ready(pg)
    await pg.wait_for_timeout(800)
    c = await chips(pg)
    miss = [x for x in HIKE_CHIPS if x not in c]
    check(not miss, f'hike legend lacks {miss}; has {c}')
    check('↑ >18%' not in c and '↑ 14-18%' not in c, f'hike legend still shows bike chips: {c}')


# ---------- L11 no overlapping controls ----------
RECTS = """() => { const q = { tbar: '.tbar', layers: '.layersbtns', orbit: '.orbit', prof: '.profwrap', pop: '.lpop', side: '.side' };
  const out = {}; for (const [k, s] of Object.entries(q)) { const e = document.querySelector(s); if (!e) continue; const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out[k] = [r.left, r.top, r.right, r.bottom]; } return out }"""
COVER = """() => [...document.querySelectorAll('.tb,.layersbtn,.dim button,.orbit button,.maplibregl-ctrl button')]
  .filter(b => { const r = b.getBoundingClientRect(); if (!r.width) return false;
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(e === b || b.contains(e)) })
  .map(b => b.getAttribute('aria-label') || b.textContent.trim())"""


def inter(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 2 and h > 2 else 0


async def overlaps(pg, tag, skip=()):
    r = await pg.evaluate(RECTS)
    vp = pg.viewport_size
    bad = []
    ks = [k for k in r if k not in skip]
    for i, a in enumerate(ks):
        for b in ks[i + 1:]:
            if {a, b} == {'side', 'tbar'} or {a, b} == {'side', 'pop'}:
                continue
            if mob(pg) is False and 'side' in (a, b):
                continue
            if inter(r[a], r[b]):
                bad.append(f'{a}x{b} {[round(v) for v in r[a]]} {[round(v) for v in r[b]]}')
    if 'pop' in r and r['pop'][3] > vp['height'] + 1:
        bad.append(f'menu goes below the screen: bottom {r["pop"][3]:.0f} > {vp["height"]}')
    for k, v in r.items():
        if v[2] > vp['width'] + 1 or v[0] < -1:
            bad.append(f'{k} leaves the screen horizontally {v}')
    return [f'{tag}: {x}' for x in bad]


async def L11(ctx):
    pg = await app(ctx)
    await make_route(pg)
    bad = []
    bad += await overlaps(pg, 'no menu', skip=('side',) if not mob(pg) else ())
    cov = await pg.evaluate(COVER)
    bad += [f'no menu: covered {cov}'] if cov else []
    for which in ['base', 'over', 'poi']:
        await menu_open(pg, which)
        await pg.wait_for_timeout(300)
        bad += await overlaps(pg, f'{which} menu')
        await menu_close(pg)
    await tap(pg, pg.locator('.dim button', has_text='3D'))
    await until(lambda: pg.locator('.orbit .compass').count(), 8, msg='3D')
    await pg.wait_for_timeout(1500)
    bad += await overlaps(pg, '3D')
    cov = await pg.evaluate(COVER)
    bad += [f'3D: covered {cov}'] if cov else []
    await menu_open(pg, 'poi')
    await pg.wait_for_timeout(300)
    bad += await overlaps(pg, '3D + POIs menu')
    check(not bad, '; '.join(bad))


CASES = {
    'L1': ('Base map menu', L1), 'L2': ('Overlays on and off', L2), 'L3': ('Route line colouring', L3),
    'L4': ('POIs: radius, categories, counts, badge', L4), 'L5': ('POIs in the timeline', L5), 'L6': ('Springs API', L6),
    'L7': ('Photos: zoom hint, markers, sources', L7), 'L8': ('Photo viewer', L8), 'L9': ('2D/3D/zoom/locate block', L9),
    'L10': ('Grade legend and line colours', L10), 'L11': ('No overlapping controls', L11),
}


async def run_one(browser, cid, prof):
    title, fn = CASES[cid]
    attempts = 0
    notes = []
    while True:
        attempts += 1
        ctx = await new_ctx(browser, prof)
        try:
            await asyncio.wait_for(fn(ctx), timeout=300)
            res, note = ('pass' if attempts == 1 else 'flaky', '; '.join(notes))
            await ctx.close()
            return res, note
        except NA as e:
            await ctx.close()
            return 'n/a', str(e)
        except Fail as e:
            kind, msg, limit = 'FAIL', str(e), 3
        except Exception as e:
            kind, msg, limit = 'ERROR', f'{type(e).__name__}: {(str(e).splitlines() or [''])[0][:160]}', 3
        for i, pg in enumerate(ctx.pages):
            try:
                await pg.screenshot(path=str(OUT / f'{cid}-{prof}-{attempts}-{i}.png'))
            except Exception:
                pass
        await ctx.close()
        notes.append(f'try {attempts}: {msg[:300]}')
        if attempts >= limit:
            return kind, notes[-1] if attempts == 1 else ' | '.join(notes[-2:])


async def main(only):
    want = os.environ.get('VIEWPORT', 'all')
    profs = list(PROF) if want == 'all' else [p.strip() for p in want.split(',')]
    ids = [c for c in CASES if not only or c in only]
    results = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

        async def lane(prof):
            for cid in ids:
                t0 = time.time()
                res = await run_one(browser, cid, prof)
                results[(cid, prof)] = res
                print(f'{cid:4} {prof:8} {res[0]:6} {time.time() - t0:5.0f}s {res[1][:200]}', flush=True)
        await asyncio.gather(*(lane(pr) for pr in profs))
        await browser.close()
    lines = [f'Against {BASE}', '', '| Id | Case | ' + ' | '.join(profs) + ' |', '|---|---|' + '---|' * len(profs)]
    for cid in ids:
        lines.append(f'| {cid} | {CASES[cid][0]} | ' + ' | '.join(results[(cid, pr)][0] for pr in profs) + ' |')
    lines += ['', 'Notes:']
    for cid in ids:
        for pr in profs:
            r = results[(cid, pr)]
            if r[0] != 'pass':
                lines.append(f'- {cid} {pr} {r[0]}: {r[1]}')
    txt = '\n'.join(lines)
    print('\n' + txt)
    (OUT / 'results.md').write_text(txt + '\n')


if __name__ == '__main__':
    asyncio.run(main(set(sys.argv[1:])))

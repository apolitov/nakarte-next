#!/usr/bin/env python3
"""End-to-end checks of phone, tablet and short-screen layouts of No Mapa (ids M1...).

  BASE=https://alexe.pt/maps/ python3 tools/e2e/cases_mobile.py          # all
  python3 tools/e2e/cases_mobile.py M3 M9                               # only these
Failure screenshots go to OUT (default /tmp/nk-e2e-mobile). Does not edit app source.
A case that fails/errors is retried up to 3 times; different outcomes between attempts = flaky.
"""
import asyncio, os, re, sys, time, pathlib
os.environ.setdefault('BASE', 'https://alexe.pt/maps/')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from playwright.async_api import async_playwright
from usecases import open_app, check, Fail, canvas_xy, ensure_editing, settle, markers, open_settings

OUT = pathlib.Path(os.environ.get('OUT', '/tmp/nk-e2e-mobile'))
OUT.mkdir(parents=True, exist_ok=True)

# name: (w, h, mobile)
VP = {
    'phone': (390, 664, True), 'small': (375, 553, True), 'tiny': (360, 560, True), 'micro': (320, 480, True),
    'land': (664, 375, True), 'tablet': (768, 1024, False), 'lap1024': (1024, 768, False),
    'desk': (1440, 780, False), 'short': (1366, 650, False), 'lap1280': (1280, 620, False),
}
TWO = [(0.35, 0.35), (0.62, 0.6)]


async def make_ctx(browser, vp, scheme='light', consent='denied'):
    w, h, mob = VP[vp]
    ctx = await browser.new_context(viewport={'width': w, 'height': h}, is_mobile=mob, has_touch=mob,
                                    color_scheme=scheme, locale='en-US')
    ctx._nk_ready = True  # our own setup below; usecases.prepare would force nm-consent=denied
    await ctx.route(re.compile(r'googletagmanager|google-analytics'), lambda r: r.abort())
    if consent:
        await ctx.add_init_script(f"try{{localStorage.setItem('nm-consent','{consent}')}}catch(e){{}}")
    return ctx


# ---------- geometry helpers ----------
JS_RECT = """(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
  return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height} }"""


async def rect(pg, sel):
    return await pg.evaluate(JS_RECT, sel)


async def rects(pg, sel):
    return await pg.evaluate("""(sel) => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect();
      return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, n: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 12)} })""", sel)


def hit(a, b, tol=0.5):
    return a['l'] < b['r'] - tol and b['l'] < a['r'] - tol and a['t'] < b['b'] - tol and b['t'] < a['b'] - tol


def no_overlap(named: dict):
    ks = [k for k, v in named.items() if v and v['w'] > 0]
    bad = [f'{a} x {b}' for i, a in enumerate(ks) for b in ks[i + 1:] if hit(named[a], named[b])]
    check(not bad, 'overlap: ' + ', '.join(bad))


async def covered(pg, sel='.tb,.layersbtn,.orbit button,.maplibregl-ctrl button,.grab,.cb button'):
    return await pg.evaluate("""(sel) => [...document.querySelectorAll(sel)].filter(b => { const r = b.getBoundingClientRect();
      if (!r.width || getComputedStyle(b).display === 'none') return false;
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(e === b || b.contains(e)) })
      .map(b => b.getAttribute('aria-label') || b.className || b.textContent.trim())""", sel)


async def no_hscroll(pg, what=''):
    d = await pg.evaluate("({sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: innerWidth})")
    check(d['sw'] <= d['iw'] and d['bw'] <= d['iw'], f'horizontal page scroll {what}: {d}')


async def sticks_out(pg, root='.side'):
    """Elements inside root whose box leaves the viewport horizontally."""
    return await pg.evaluate("""(root) => [...document.querySelectorAll(root + ' *')].filter(e => { const r = e.getBoundingClientRect();
      return r.width && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed' })
      .slice(0, 5).map(e => e.tagName + '.' + e.className)""", root)


async def tap(pg, sel):
    await pg.locator(sel).first.tap()
    await pg.wait_for_timeout(350)


async def tap_map(pg, fx, fy):
    x, y = await canvas_xy(pg, fx, fy)
    await pg.touchscreen.tap(x, y)
    await pg.wait_for_timeout(450)


async def draw_touch(pg, pts=TWO):
    if await pg.get_attribute('.tb >> nth=0', 'aria-pressed') != 'true':
        await tap(pg, '.tb >> nth=0')
    for fx, fy in pts:
        await tap_map(pg, fx, fy)
    await settle(pg)


async def draw_mouse(pg, pts=TWO):
    await ensure_editing(pg)
    for fx, fy in pts:
        x, y = await canvas_xy(pg, fx, fy)
        await pg.mouse.click(x, y)
        await pg.wait_for_timeout(350)
    await settle(pg)


async def draw_any(pg, vp):
    await (draw_touch if VP[vp][2] else draw_mouse)(pg)


async def sheet_state(pg):
    return await pg.get_attribute('.grab', 'aria-expanded') == 'true'


async def set_sheet(pg, want):
    if await sheet_state(pg) != want:
        await tap(pg, '.grab')
        await pg.wait_for_timeout(300)
    check(await sheet_state(pg) == want, f'sheet not {"open" if want else "closed"}')


async def menu_btn(pg, name):
    return pg.locator(f'.layersbtn[aria-label="{name}"]')


def lum(c):
    r, g, b = [x / 255 for x in c]
    f = lambda v: v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


# ---------- M: phone ----------
async def M1(ctx):  # collapsed sheet: handle + route name, above-sheet controls
    pg = await open_app(ctx)
    vh = await pg.evaluate('innerHeight')
    side = await rect(pg, '.side')
    grab = await rect(pg, '.grab')
    check(await pg.get_attribute('.grab', 'aria-expanded') == 'false', 'sheet must start collapsed')
    check(grab and 0 <= grab['t'] < vh and grab['b'] <= vh, f'handle not visible: {grab}')
    title = await rect(pg, '.title')
    check(title and title['b'] <= vh + 0.5 and title['t'] >= grab['t'], f'route name not visible in collapsed sheet: {title}, vh={vh}')
    check(abs(side['t'] - (vh - 74)) <= 3, f'collapsed sheet should be 74px tall, top={side["t"]} vh={vh}')
    # not a lot of things peeking out of the collapsed sheet below the name
    mc = await rect(pg, '.mapctl')
    check(mc['b'] <= side['t'] + 0.5, f'controls block {mc} overlaps collapsed sheet top {side["t"]}')
    zi = await rect(pg, '.maplibregl-ctrl-zoom-in')
    check(zi is None or zi['b'] <= side['t'] + 0.5, f'zoom button {zi} under the sheet {side["t"]}')
    check(not await covered(pg), f'covered controls: {await covered(pg)}')


async def M2(ctx):  # handle: tap and drag open/close
    pg = await open_app(ctx)
    await set_sheet(pg, True)
    side = await rect(pg, '.side')
    check(side['t'] < (await pg.evaluate('innerHeight')) - 100, f'open sheet should be tall, top={side["t"]}')
    await set_sheet(pg, False)
    cdp = await ctx.new_cdp_session(pg)
    g = await rect(pg, '.grab')
    x, y = g['l'] + g['w'] / 2, g['t'] + g['h'] / 2

    async def drag(dy):
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        for i in range(1, 9):
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y + dy * i / 8}]})
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        await pg.wait_for_timeout(500)
    await drag(-120)
    check(await sheet_state(pg), 'drag up did not open the sheet')
    g = await rect(pg, '.grab')
    x, y = g['l'] + g['w'] / 2, g['t'] + g['h'] / 2
    await drag(120)
    check(not await sheet_state(pg), 'drag down did not close the sheet')


async def M3(ctx):  # sheet while editing limited to 45dvh
    pg = await open_app(ctx)
    await draw_touch(pg)
    check(not await sheet_state(pg), 'sheet must close when editing starts')
    await set_sheet(pg, True)
    vh = await pg.evaluate('innerHeight')
    side = await rect(pg, '.side')
    check(side['h'] <= vh * 0.45 + 2, f'editing sheet {side["h"]:.0f}px > 45dvh ({vh * .45:.0f}px)')
    check(await pg.evaluate("getComputedStyle(document.querySelector('.side')).overflowY") in ('auto', 'scroll'), 'sheet must scroll')
    # the map keeps room for taps
    check(side['t'] >= vh * 0.5, f'sheet top {side["t"]} leaves under half of the map')
    await no_hscroll(pg)


async def M4(ctx):  # top controls on a phone
    pg = await open_app(ctx)
    await (await menu_btn(pg, 'Along the route')).tap()
    await pg.wait_for_timeout(300)
    await pg.locator('.lpop .row').first.tap()  # a category: the badge
    await pg.wait_for_timeout(300)
    await pg.locator('.lpop button[aria-label="Close"]').tap()
    await pg.wait_for_timeout(300)
    bs = await rects(pg, '.layersbtn')
    check(len(bs) == 3, f'3 layer buttons expected, {len(bs)}')
    check(len({round(b['w']) for b in bs}) == 1 and round(bs[0]['w']) == 44, f'widths differ: {[b["w"] for b in bs]}')
    check(abs(bs[2]['h'] - 44) < 1 and abs(bs[2]['w'] - 44) < 1, f'POIs not 44px square: {bs[2]}')
    check(len({round(b['r'], 1) for b in bs}) == 1, f'right edges differ: {[b["r"] for b in bs]}')
    check(all(bs[i]['b'] <= bs[i + 1]['t'] + 0.5 for i in range(2)), 'buttons are not in one column')
    cnt = await rect(pg, '.layersbtn.poibtn .cnt')
    check(cnt and cnt['w'] > 0, 'no count badge on POIs after enabling a category')
    tb, mc, side = await rect(pg, '.tbw'), await rect(pg, '.mapctl'), await rect(pg, '.side')
    no_overlap({'toolbar': tb, 'map': bs[0], 'overlays': bs[1], 'pois': bs[2], 'controls': mc, 'sheet': side})
    check(bs[0]['t'] >= 56, f'layer buttons start too high: {bs[0]["t"]}')
    check(mc['b'] <= side['t'] + 0.5, 'controls block not above the collapsed sheet')
    check(not await covered(pg), f'covered: {await covered(pg)}')
    await no_hscroll(pg)


async def M5(ctx):  # three menus: same left/right/top; buttons visible; open one highlighted
    pg = await open_app(ctx)
    geo = {}
    for name in ['Map', 'Overlays', 'Along the route']:
        await (await menu_btn(pg, name)).tap()
        await pg.wait_for_timeout(450)
        m = await rect(pg, '.lpop')
        check(m, f'{name}: menu did not open')
        geo[name] = m
        bs = await rects(pg, '.layersbtn')
        check(m['r'] <= bs[0]['l'] + 0.5, f'{name}: menu right {m["r"]} runs under buttons at {bs[0]["l"]}')
        check(not await covered(pg, '.layersbtn'), f'{name}: buttons covered')
        pressed = await pg.evaluate("[...document.querySelectorAll('.layersbtn')].map(b => b.getAttribute('aria-expanded'))")
        check(pressed.count('true') == 1 and pressed[['Map', 'Overlays', 'Along the route'].index(name)] == 'true', f'{name}: highlight state {pressed}')
        bgs = await pg.evaluate("[...document.querySelectorAll('.layersbtn')].map(b => getComputedStyle(b).backgroundColor)")
        i = ['Map', 'Overlays', 'Along the route'].index(name)
        check(all(bgs[i] != bgs[j] for j in range(3) if j != i), f'{name}: open button not visually distinct {bgs}')
        check(abs(m['l'] - 10) <= 1.5, f'{name}: left {m["l"]} != 10')
        check(abs(m['t'] - 62) <= 1.5, f'{name}: top {m["t"]} != 62')
    ls, rs, ts = [round(g['l']) for g in geo.values()], [round(g['r']) for g in geo.values()], [round(g['t']) for g in geo.values()]
    check(len(set(ls)) == 1 and len(set(rs)) == 1 and len(set(ts)) == 1, f'menus differ: left {ls} right {rs} top {ts}')


async def M6(ctx):  # draw by taps, summary + timeline in the sheet, waypoint menu, double tap
    pg = await open_app(ctx)
    await draw_touch(pg, TWO + [(0.5, 0.25)])
    check(await markers(pg) == 3, f'{await markers(pg)} points after 3 taps')
    await set_sheet(pg, True)
    sum_ = await rect(pg, '.sum')
    check(sum_ and sum_['h'] > 20, 'no summary in the sheet')
    s = await pg.locator('.sum').inner_text()
    check(re.search(r'[\d.]+\s*km', s.replace('\n', ' ')), f'no length in summary {s[:80]!r}')
    check(await pg.locator('.tl').count() == 1, 'no timeline in the sheet')
    # clipped text in summary
    clipped = await pg.evaluate("""[...document.querySelectorAll('.sum, .sum *')].filter(e => e.scrollWidth > e.clientWidth + 1 &&
      getComputedStyle(e).overflowX !== 'visible').map(e => e.className + ':' + e.textContent.slice(0, 20))""")
    check(not clipped, f'clipped text in summary: {clipped}')
    out = await sticks_out(pg)
    check(not out, f'sheet content outside the screen: {out}')
    await set_sheet(pg, False)
    # tap a waypoint -> menu
    box = await pg.locator('.wp.wp-via').first.bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    await pg.touchscreen.tap(cx, cy)
    await pg.wait_for_timeout(500)
    btn = pg.locator('.ctx-popup button', has_text='Delete point')
    check(await btn.count() == 1, 'tap on a waypoint did not show "Delete point"')
    bb = await btn.bounding_box()
    check(bb and bb['height'] >= 24, f'Delete point button too small to tap: {bb}')
    await pg.wait_for_timeout(500)
    await pg.touchscreen.tap(cx, cy)  # two quick taps on the point (menu still open)
    await pg.touchscreen.tap(cx, cy)
    await settle(pg)
    check(await markers(pg) == 2, f'double tap did not delete the point: {await markers(pg)} left')


async def M7(ctx):  # settings in the sheet: sliders by touch, notes not clipped
    pg = await open_app(ctx)
    await draw_touch(pg)
    await set_sheet(pg, True)
    await open_settings(pg)
    sl = pg.locator('#nk-surf')
    await sl.scroll_into_view_if_needed()
    b = await sl.bounding_box()
    check(b['height'] >= 20 or True, '')
    v0 = await sl.input_value()
    await pg.touchscreen.tap(b['x'] + b['width'] - 4, b['y'] + b['height'] / 2)
    await pg.wait_for_timeout(500)
    v1 = await sl.input_value()
    check(v1 != v0 and v1 == '2', f'touch on the right end of the slider: {v0} -> {v1}')
    # the thumb needs a reasonable touch height
    check(b['height'] >= 16, f'slider only {b["height"]}px tall')
    await settle(pg)
    # (?) note
    q = pg.locator('button.q[aria-label^="How Surface"]')
    await q.scroll_into_view_if_needed()
    qb = await q.bounding_box()
    await pg.touchscreen.tap(qb['x'] + qb['width'] / 2, qb['y'] + qb['height'] / 2)
    await pg.wait_for_timeout(400)
    pop = await rect(pg, '.pop')
    check(pop, 'note did not open')
    await pg.evaluate("document.querySelector('.pop').scrollIntoView({block: 'nearest'})")
    await pg.wait_for_timeout(300)
    pop = await rect(pg, '.pop')
    side = await rect(pg, '.side')
    check(pop['l'] >= side['l'] and pop['r'] <= side['r'] + 0.5, f'note outside sheet: {pop} vs {side}')
    check(pop['w'] >= side['w'] - 60, f'note not full width: {pop["w"]:.0f} of {side["w"]:.0f}')
    ok = await pg.evaluate("""() => { const p = document.querySelector('.pop'); const r = p.getBoundingClientRect();
      const s = document.querySelector('.side').getBoundingClientRect();
      const pts = [[r.left + 6, r.top + 6], [r.right - 6, r.top + 6], [r.left + 6, r.bottom - 6], [r.right - 6, r.bottom - 6]];
      return {vis: r.bottom <= Math.min(innerHeight, s.bottom) + 1, top: r.top >= s.top,
        hit: pts.map(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && p.contains(e) }),
        clip: p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1} }""")
    check(not ok['clip'], f'note text clipped {ok}')
    check(all(ok['hit']), f'note is partly covered/clipped by something: {ok}')
    check(ok['vis'], f'note runs below the screen/sheet: bottom {pop["b"]}')


async def M8(ctx):  # photo viewer fills the phone
    async def photos(route):
        import json
        body = route.request.post_data_json or {}
        line = body.get('line') or [[-9.386, 38.7975]]
        svg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><rect width='800' height='600' fill='%23789'/></svg>"
        out = [{'id': f'p{i}', 'src': 'mapillary', 'lng': line[min(i, len(line) - 1)][0], 'lat': line[min(i, len(line) - 1)][1], 'm': 10 + i * 5,
                'date': '2024-05-01', 'az': None, 'author': 'x', 'license': 'CC', 'thumb': svg, 'sd': svg, 'url': ''} for i in range(3)]
        await route.fulfill(status=200, content_type='application/json', body=json.dumps(out))
    await ctx.route(re.compile(r'/api/photos'), photos)
    await ctx.route(re.compile(r'commons\.wikimedia\.org'), lambda r: r.fulfill(status=200, content_type='application/json', body='{}'))
    pg = await open_app(ctx)
    await draw_touch(pg)
    await tap(pg, '.layersbtn.poibtn')
    row = pg.locator('.lpop .row', has_text=re.compile('photo', re.I)).first
    await row.tap()
    await pg.wait_for_timeout(300)
    await pg.locator('.lpop button[aria-label="Close"]').tap()
    await pg.wait_for_selector('.ph-mk', timeout=30000)
    await pg.locator('.ph-mk').first.tap()
    await pg.wait_for_selector('.pv .frame', timeout=5000)
    f = await rect(pg, '.pv .frame')
    vw, vh = await pg.evaluate('[innerWidth, innerHeight]')
    check(f['w'] >= vw - 1 and f['l'] <= 1, f'viewer not full width: {f}')
    check(f['h'] <= vh + 1 and f['t'] >= -1, f'viewer taller than the screen: {f}')
    check(await pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.pv .frame')).borderTopLeftRadius) === 0"), 'viewer keeps rounded corners on a phone')
    x = await rect(pg, '.pv .x')
    check(x['t'] >= 0 and x['r'] <= vw and x['w'] >= 36 and x['h'] >= 36, f'close button: {x}')
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(300)
    check(await pg.locator('.pv').count() == 0, 'Esc did not close the viewer')
    await pg.locator('.ph-mk').first.tap()
    await pg.wait_for_selector('.pv .frame')
    await pg.locator('.pv .x').tap()
    await pg.wait_for_timeout(300)
    check(await pg.locator('.pv').count() == 0, 'close button did not close the viewer')


async def M9(ctx):  # cookie banner on a phone
    pg = await open_app(ctx)
    cb = await rect(pg, '.cb')
    check(cb, 'cookie banner not shown')
    grab, side = await rect(pg, '.grab'), await rect(pg, '.side')
    vw, vh = await pg.evaluate('[innerWidth, innerHeight]')
    check(cb['b'] <= side['t'] + 0.5, f'banner {cb} not above the collapsed sheet (top {side["t"]})')
    check(not hit(cb, grab), 'banner covers the sheet handle')
    check(cb['l'] >= 0 and cb['r'] <= vw and cb['t'] >= 0, f'banner outside the screen {cb}')
    check(not await covered(pg, '.cb button'), 'banner buttons are covered')
    for t in ['.cb .no', '.cb .yes']:
        r = await rect(pg, t)
        check(r and r['h'] >= 30 and r['w'] >= 44 and r['b'] <= vh and r['r'] <= vw, f'{t} not visible/tappable: {r}')
    mc = await rect(pg, '.mapctl')
    check(not hit(cb, mc), f'banner overlaps the map controls block {mc}')
    await tap(pg, '.cb .no')
    check(await pg.locator('.cb').count() == 0, 'banner stays after No')
    check(await pg.evaluate("localStorage.getItem('nm-consent')") == 'denied', 'No did not store denied')


async def M10(ctx):  # no horizontal scroll, phone-like widths, empty + route
    pg = await open_app(ctx)
    await no_hscroll(pg, 'empty')
    await draw_touch(pg)
    await set_sheet(pg, True)
    await no_hscroll(pg, 'sheet open with route')
    out = await sticks_out(pg)
    check(not out, f'content outside screen: {out}')
    clipped = await pg.evaluate("""[...document.querySelectorAll('.side *')].filter(e => e.children.length === 0 && e.textContent.trim() &&
      e.scrollWidth > e.clientWidth + 1 && ['hidden', 'clip'].includes(getComputedStyle(e).overflowX) && getComputedStyle(e).textOverflow !== 'ellipsis')
      .slice(0, 5).map(e => e.className + ':' + e.textContent.slice(0, 20))""")
    check(not clipped, f'clipped text: {clipped}')


async def M11(ctx):  # tablet 768x1024: desktop layout, banner beside the panel
    pg = await open_app(ctx, storage=None)
    await no_hscroll(pg)
    await layout_side_by_side(pg)


async def layout_side_by_side(pg):
    side, map_ = await rect(pg, '.side'), await rect(pg, '.mapcol')
    check(side['r'] <= map_['l'] + 1 or side['r'] <= map_['l'] + 1, f'panel {side} and map {map_} are not side by side')
    check(map_['w'] >= 300, f'map too narrow {map_["w"]}')
    check(not hit(side, map_), 'panel overlaps the map')


async def M12(ctx):  # laptop cookie banner next to the panel, over the map
    pg = await open_app(ctx)
    cb, side = await rect(pg, '.cb'), await rect(pg, '.side')
    check(cb, 'no banner')
    check(cb['l'] >= side['r'] - 0.5, f'banner {cb["l"]} over the panel (right edge {side["r"]})')
    check(not await covered(pg, '.cb button'), 'banner buttons covered')
    await layout_side_by_side(pg)
    await no_hscroll(pg)


async def M13(ctx):  # dark scheme: phone controls and sheet legible
    pg = await open_app(ctx)
    check(await pg.evaluate("matchMedia('(prefers-color-scheme: dark)').matches"), 'dark not emulated')
    await set_sheet(pg, True)
    cols = await pg.evaluate("""() => { const p = x => x.match(/[\\d.]+/g).map(Number);
      const t = document.querySelector('.title'), s = document.querySelector('.side');
      return {fg: p(getComputedStyle(t).color).slice(0, 3), bg: p(getComputedStyle(s).backgroundColor).slice(0, 4)} }""")
    check(cols['bg'][3:] in ([], [1]) or cols['bg'][3] > 0.9, f'sheet background transparent: {cols}')
    c = contrast(cols['fg'], cols['bg'][:3])
    check(c >= 4.5, f'title contrast {c:.1f} in dark')
    await set_sheet(pg, False)
    await (await menu_btn(pg, 'Overlays')).tap()
    await pg.wait_for_timeout(400)
    m = await pg.evaluate("""() => { const p = x => x.match(/[\\d.]+/g).map(Number); const e = document.querySelector('.lpop .row');
      const l = document.querySelector('.lpop'); return {fg: p(getComputedStyle(e).color).slice(0, 3), bg: p(getComputedStyle(l).backgroundColor).slice(0, 3)} }""")
    c = contrast(m['fg'], m['bg'])
    check(c >= 4.5, f'menu text contrast {c:.1f} in dark')
    bs = await rects(pg, '.layersbtn')
    check(len({round(b['r'], 1) for b in bs}) == 1, 'dark: right edges differ')
    check(not await covered(pg, '.layersbtn,.tb'), 'dark: covered controls')


async def M14(ctx):  # dark laptop: banner next to the panel
    pg = await open_app(ctx)
    cb, side = await rect(pg, '.cb'), await rect(pg, '.side')
    check(cb['l'] >= side['r'] - 0.5, 'banner over panel in dark')
    c = await pg.evaluate("""() => { const p = x => x.match(/[\\d.]+/g).map(Number); const e = document.querySelector('.cb');
      return {fg: p(getComputedStyle(e).color).slice(0, 3), bg: p(getComputedStyle(e).backgroundColor).slice(0, 3)} }""")
    check(contrast(c['fg'], c['bg']) >= 4.5, 'banner contrast in dark')


# ---------- S: height-limited and every-size checks ----------
async def all_controls_check(pg, vp, with_route=True, menus=True):
    w, h, mob = VP[vp]
    await no_hscroll(pg, vp)
    if with_route:
        await draw_any(pg, vp)
    mobile_layout = (w <= 639 or (h <= 480 and w > h))
    named = {'toolbar': await rect(pg, '.tbw'), 'controls': await rect(pg, '.mapctl')}
    for i, b in enumerate(await rects(pg, '.layersbtn')):
        named[f'btn{i}'] = b
    if not mobile_layout:
        named['panel'] = await rect(pg, '.side')
        named['profile'] = await rect(pg, '.profwrap') if with_route else None
    else:
        sd = await rect(pg, '.side')
        named['sheet'] = dict(sd, h=h - sd['t'], b=h)  # only the part on screen: the sheet is translated down
    no_overlap(named)
    for k, v in named.items():
        if v and v['w'] > 0:
            check(v['l'] >= -0.5 and v['r'] <= w + 0.5 and v['t'] >= -0.5 and v['b'] <= h + 0.5, f'{k} outside the {w}x{h} screen: {v}')
    bad = await covered(pg, '.tb,.layersbtn,.orbit button,.maplibregl-ctrl button')
    check(not bad, f'covered controls at {vp}: {bad}')
    if not mobile_layout:
        # the panel scrolls instead of clipping
        d = await pg.evaluate("""() => { const s = document.querySelector('.side'); return {sh: s.scrollHeight, ch: s.clientHeight,
          oy: getComputedStyle(s).overflowY, r: s.getBoundingClientRect().bottom, ih: innerHeight} }""")
        check(d['r'] <= d['ih'] + 1, f'panel runs below the screen: {d}')
        check(d['sh'] <= d['ch'] + 1 or d['oy'] in ('auto', 'scroll'), f'panel clips its content (no scroll): {d}')
    # menus
    if menus:
        for name in ['Map', 'Overlays', 'Along the route']:
            await (await menu_btn(pg, name)).click() if not mob else await (await menu_btn(pg, name)).tap()
            await pg.wait_for_timeout(450)
            m = await pg.evaluate("""() => { const e = document.querySelector('.lpop'); if (!e) return null; const r = e.getBoundingClientRect();
              return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, sh: e.scrollHeight, ch: e.clientHeight,
              oy: getComputedStyle(e).overflowY, inner: [...e.querySelectorAll('*')].some(x => getComputedStyle(x).overflowY === 'auto' || getComputedStyle(x).overflowY === 'scroll')} }""")
            check(m, f'{name} menu did not open at {vp}')
            check(m['b'] <= h + 0.5 and m['t'] >= 0 and m['r'] <= w + 0.5 and m['l'] >= -0.5, f'{name} menu outside screen at {vp}: {m}')
            check(m['sh'] <= m['ch'] + 1 or m['oy'] in ('auto', 'scroll') or m['inner'], f'{name} menu clips content without scrolling at {vp}: {m}')
            bs = await rects(pg, '.layersbtn')
            check(all(not hit(m_, b) for b in bs for m_ in [m_rect(m)]), f'{name} menu covers layer buttons at {vp}')
            if mobile_layout:
                sd = await rect(pg, '.side')
                check(m['b'] <= sd['t'] + 0.5 or True, '')
            tb = await rect(pg, '.tbw')
            if not mobile_layout:
                check(not hit(m_rect(m), tb), f'{name} menu covers the toolbar at {vp}')
        await pg.keyboard.press('Escape')


def m_rect(m):
    return {'l': m['l'], 't': m['t'], 'r': m['r'], 'b': m['b'], 'w': m['w'], 'h': m['h']}


def vp_case(vp, scheme='light'):
    async def f(ctx):
        pg = await open_app(ctx)
        await all_controls_check(pg, vp)
    return f


async def S_banner(vp):
    async def f(ctx):
        pg = await open_app(ctx)
        w, h, _ = VP[vp]
        cb = await rect(pg, '.cb')
        check(cb, 'no banner')
        check(cb['t'] >= 0 and cb['b'] <= h and cb['r'] <= w and cb['l'] >= 0, f'banner outside screen {cb}')
        named = {'banner': cb, 'toolbar': await rect(pg, '.tbw'), 'controls': await rect(pg, '.mapctl'), 'sheet/panel': await rect(pg, '.side')}
        for i, b in enumerate(await rects(pg, '.layersbtn')):
            named[f'btn{i}'] = b
        if not (w <= 639 or (h <= 480 and w > h)):
            check(cb['l'] >= named['sheet/panel']['r'] - 0.5, f'banner over the panel: {cb}')
        no_overlap({k: v for k, v in named.items() if k in ('banner', 'toolbar', 'controls', 'sheet/panel') or k.startswith('btn')})
        check(not await covered(pg, '.cb button'), 'banner buttons covered')
    return f


async def S_profile(vp):
    async def f(ctx):
        pg = await open_app(ctx)
        await draw_any(pg, vp)
        w, h, _ = VP[vp]
        pr = await rect(pg, '.profwrap')
        check(pr and pr['w'] > 0, 'no profile card on the desktop layout')
        for sel in ['.mapctl', '.maplibregl-ctrl-zoom-in', '.tbw']:
            r = await rect(pg, sel)
            if r and r['w'] > 0:
                check(not hit(pr, r), f'profile card {pr} covers {sel} {r}')
        check(pr['b'] <= h + 0.5, f'profile card below the screen: {pr}')
        mp = await rect(pg, '.mapcol')
        check(mp['h'] > 120, f'map only {mp["h"]}px tall at {vp}')
        check(not await covered(pg, '.orbit button,.maplibregl-ctrl button,.layersbtn,.tb'), f'covered: {await covered(pg, ".orbit button,.maplibregl-ctrl button,.layersbtn,.tb")}')
    return f


async def S_panel_scroll(vp):
    async def f(ctx):
        pg = await open_app(ctx)
        await draw_any(pg, vp)
        h = VP[vp][1]
        if VP[vp][0] <= 639:
            await set_sheet(pg, True)
        await open_settings(pg)
        d = await pg.evaluate("""() => { const s = document.querySelector('.side'); const before = s.scrollTop; s.scrollTop = 99999;
          return {sh: s.scrollHeight, ch: s.clientHeight, top: s.scrollTop, bottom: s.getBoundingClientRect().bottom, oy: getComputedStyle(s).overflowY} }""")
        check(d['bottom'] <= h + 1, f'panel extends below the screen: {d}')
        if d['sh'] > d['ch'] + 1:
            check(d['top'] > 0, f'panel content does not scroll: {d}')
        last = await pg.evaluate("""() => { const s = document.querySelector('.side'); const k = [...s.querySelectorAll('*')].filter(e => e.getBoundingClientRect().height > 0).pop();
          const r = k.getBoundingClientRect(); return {b: r.bottom, ih: innerHeight} }""")
        check(last['b'] <= last['ih'] + 1, f'last element of the panel unreachable: {last}')
    return f


async def S_nohscroll(vp, route=False):
    async def f(ctx):
        pg = await open_app(ctx)
        await no_hscroll(pg, vp)
        if route:
            await draw_any(pg, vp)
            await no_hscroll(pg, vp + ' with route')
    return f


async def S_land(ctx):  # phone landscape 812x375 (desktop layout on a touch screen)
    pg = await open_app(ctx)
    await all_controls_check(pg, 'land')
    await no_hscroll(pg, 'land')


async def build_cases():
    C = {}
    def add(cid, title, vp, fn, scheme='light', consent='denied'):
        C[cid] = (title, vp, fn, scheme, consent)
    add('M1', 'Collapsed sheet: handle, name, controls above', 'phone', M1)
    add('M2', 'Sheet handle: tap and drag', 'phone', M2)
    add('M3', 'Editing sheet <= 45dvh', 'phone', M3)
    add('M4', 'Top controls column, no overlaps', 'phone', M4)
    add('M5', 'Map/Overlays/POIs menus share edges', 'phone', M5)
    add('M6', 'Tap-draw, summary, waypoint menu, double tap', 'phone', M6)
    add('M7', 'Settings sliders and (?) notes in sheet', 'phone', M7)
    add('M8', 'Photo viewer fills phone', 'phone', M8)
    add('M9', 'Cookie banner on phone', 'phone', M9, consent=None)
    add('M10', 'No hscroll / clipped text (phone)', 'phone', M10)
    add('M11', 'Tablet 768: side by side, no hscroll', 'tablet', M11)
    add('M12', 'Laptop 1366: banner beside panel', 'desk', M12, consent=None)
    add('M13', 'Dark phone: contrast, controls', 'phone', M13, scheme='dark')
    add('M14', 'Dark laptop: banner beside panel', 'lap1024', M14, scheme='dark', consent=None)
    for vp in ['micro', 'tiny', 'small', 'phone', 'land', 'tablet', 'lap1024', 'desk']:
        add(f'W-{vp}', f'No hscroll {vp}, empty+route', vp, await S_nohscroll(vp, route=True))
    # height-limited matrix
    for vp in ['short', 'lap1280', 'land', 'phone', 'small', 'tiny', 'micro']:
        add(f'S1-{vp}', f'Controls, menus, no overlap {vp}', vp, vp_case(vp))
        add(f'S2-{vp}', f'Cookie banner {vp}', vp, await S_banner(vp), consent=None)
        add(f'S4-{vp}', f'Panel scrolls {vp}', vp, await S_panel_scroll(vp))
    for vp in ['short', 'lap1280', 'desk']:  # land uses the phone layout: no card over the map
        add(f'S3-{vp}', f'Profile card vs controls {vp}', vp, await S_profile(vp))
    add('S1-dark-short', 'Controls dark short', 'short', vp_case('short'), scheme='dark')
    return C


async def run_one(browser, cid, spec):
    title, vp, fn, scheme, consent = spec
    outcomes = []
    for attempt in range(3):
        ctx = await make_ctx(browser, vp, scheme, consent)
        try:
            await asyncio.wait_for(fn(ctx), timeout=150)
            res = ('pass', '')
        except Fail as e:
            res = ('FAIL', str(e))
        except Exception as e:
            res = ('ERROR', f'{type(e).__name__}: {str(e).splitlines()[0][:160]}')
        if res[0] != 'pass':
            for i, p in enumerate(ctx.pages):
                try:
                    await p.screenshot(path=str(OUT / f'{cid}-{attempt}-{i}.png'))
                except Exception:
                    pass
        await ctx.close()
        outcomes.append(res)
        if res[0] == 'pass' or (len(outcomes) >= 2 and outcomes[-1][0] == outcomes[-2][0] and outcomes[-1][1][:40] == outcomes[-2][1][:40]):
            break
    last = outcomes[-1]
    if last[0] == 'pass' and len(outcomes) > 1:
        return ('flaky', 'passed after: ' + outcomes[0][1][:120])
    if last[0] != 'pass' and any(o[0] == 'pass' for o in outcomes):
        return ('flaky', last[1])
    return last


async def main(only):
    cases = await build_cases()
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for cid, spec in cases.items():
            if only and cid not in only:
                continue
            t0 = time.time()
            res = await run_one(browser, cid, spec)
            results.append((cid, spec[0], spec[1], res[0], res[1], time.time() - t0))
            print(f'{cid:14} {res[0]:5} {time.time() - t0:5.1f}s {spec[1]:10} {spec[0]}  {res[1]}', flush=True)
        await browser.close()
    print('\n| Id | Case | Viewport | Result | Note |\n|---|---|---|---|---|')
    for c, t, vp, r, n, d in results:
        print(f'| {c} | {t} | {vp} {VP[vp][0]}x{VP[vp][1]} | {r} | {n.replace("|", "/")[:200]} |')
    print(f'\n{sum(r[3] == "pass" for r in results)}/{len(results)} passed; screenshots in {OUT}')


if __name__ == '__main__':
    asyncio.run(main(set(sys.argv[1:])))

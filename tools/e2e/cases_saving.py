#!/usr/bin/env python3
"""End-to-end checks of saving, sharing and editing routes (cases V1..V17).

  python3 tools/e2e/cases_saving.py            # all cases, all four screen profiles
  python3 tools/e2e/cases_saving.py V6 V11     # only these cases
  VIEWPORT=phone python3 tools/e2e/cases_saving.py     # a name, comma list or all
Env: BASE (default https://alexe.pt/maps/), OUT (default /tmp/nk-e2e-saving).

Profiles come from usecases.PROFILES (desktop, desktop-short, phone, phone-small).
Short links store a snapshot on the server (25 a day per address): the plain link and the
heatmap link are made once, on the first profile run, and reused by the others (2 in total).
Needs Python Playwright with Chromium. Analytics requests are blocked, consent is 'denied'.
"""
import asyncio, os, re, sys, time, pathlib, contextvars

os.environ.setdefault('BASE', 'https://alexe.pt/maps/')
os.environ.setdefault('OUT', '/tmp/nk-e2e-saving')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from playwright.async_api import async_playwright, Page, BrowserContext
from usecases import open_app, check, Fail, BASE, PROFILES  # noqa: E402

OUT = pathlib.Path(os.environ['OUT'])
OUT.mkdir(parents=True, exist_ok=True)
HASH = 'm=14/38.80/-9.39&l=Co'  # near Sintra

PROF: contextvars.ContextVar = contextvars.ContextVar('prof')
SHARED: dict = {}  # links and files reused across profiles
NO_NEW_LINKS = bool(os.environ.get('NO_NEW_LINKS'))  # server budget used up: V12 makes the only link, V11/V14 reuse it
NA: dict = {}  # (case, profile) -> reason


def phone() -> bool:
    return PROFILES[PROF.get()['name']].get('is_mobile', False)


async def new_ctx(browser) -> BrowserContext:
    kw = dict(PROFILES[PROF.get()['name']])
    ctx = await browser.new_context(accept_downloads=True, permissions=['clipboard-read', 'clipboard-write'], **kw)
    await ctx.route(re.compile(r'googletagmanager|google-analytics'), lambda r: r.abort())
    await ctx.add_init_script("try{localStorage.setItem('nm-consent','denied')}catch(e){}")
    return ctx


# ---------- helpers ----------
async def center(loc):
    b = await loc.bounding_box()
    check(b, 'element has no box')
    return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2


async def tap_at(pg: Page, x, y):
    if phone():
        await pg.touchscreen.tap(x, y)
    else:
        await pg.mouse.click(x, y)


async def tap(pg: Page, loc):
    x, y = await center(loc)
    await tap_at(pg, x, y)


async def canvas_xy(pg: Page, fx, fy):
    b = await pg.locator('.maplibregl-canvas').bounding_box()
    return b['x'] + b['width'] * fx, b['y'] + b['height'] * fy


async def open_sheet(pg: Page):
    """Phone: the panel lives in a bottom sheet."""
    if phone():
        g = pg.locator('.grab')
        if await g.get_attribute('aria-expanded') != 'true':
            await g.tap()
            await pg.wait_for_timeout(600)


async def reach(pg: Page, loc, what):
    """The element is inside the viewport and nothing covers its centre."""
    await loc.scroll_into_view_if_needed()
    await pg.wait_for_timeout(150)
    b = await loc.bounding_box()
    vp = pg.viewport_size
    check(b and b['x'] >= -1 and b['y'] >= -1 and b['x'] + b['width'] <= vp['width'] + 1 and b['y'] + b['height'] <= vp['height'] + 1,
          f'{what} is clipped by the viewport: {b} in {vp}')
    hit = await loc.evaluate("e=>{const r=e.getBoundingClientRect();const x=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return x===e||e.contains(x)}")
    check(hit, f'{what} is covered by another element')


async def editing(pg: Page) -> bool:
    return await pg.get_attribute('.tb >> nth=0', 'aria-pressed') == 'true'


async def ensure_editing(pg: Page):
    if not await editing(pg):
        await pg.locator('.tb').first.tap() if phone() else await pg.click('.tb >> nth=0')
        await pg.wait_for_timeout(300)


async def stop_editing(pg: Page):
    if await editing(pg):
        await pg.locator('.tb').first.tap() if phone() else await pg.click('.tb >> nth=0')
        await pg.wait_for_timeout(300)


async def settle(pg: Page, timeout=90):
    t0 = time.time()
    quiet = 0
    while time.time() - t0 < timeout:
        busy = await pg.locator('.busy').count()
        legs = await pg.evaluate("document.querySelector('.sum')?.innerText.includes('computing') ?? false")
        quiet = quiet + 1 if not busy and not legs else 0
        if quiet >= 4:
            return
        await pg.wait_for_timeout(250)
    raise Fail('routing did not finish')


async def click_map(pg: Page, fx, fy, shift=False):
    """Adds a point. A POI marker under the click swallows it: then nudges the click aside."""
    before = await markers(pg)
    x0, y0 = await canvas_xy(pg, fx, fy)
    for dx, dy in ((0, 0), (28, 0), (-28, 0), (0, 28), (0, -28), (28, 28), (-28, -28)):
        if shift and not phone():
            await pg.keyboard.down('Shift')
        await tap_at(pg, x0 + dx, y0 + dy)
        if shift and not phone():
            await pg.keyboard.up('Shift')
        await pg.wait_for_timeout(450)
        if await markers(pg) > before:
            return
    raise Fail(f'a click at {fx},{fy} added no point (not even nudged)')


async def draw(pg: Page, pts, straight=False):
    """Clicks points on the map; `straight` = Shift+click (straight legs, no router). Phone: always routed."""
    await ensure_editing(pg)
    for fx, fy in pts:
        await click_map(pg, fx, fy, shift=straight)
    await settle(pg)


async def markers(pg: Page) -> int:
    return await pg.locator('.wp').count()


async def km(pg: Page) -> float:
    t = (await pg.locator('.sum').inner_text()).replace('\n', ' ')
    m = re.search(r'([\d.]+)\s*km', t)
    check(m, f'no length in the summary: {t[:80]!r}')
    return float(m.group(1))


async def finish_with_name(pg: Page, name: str):
    await stop_editing(pg)
    await pg.wait_for_selector('dialog.named[open]', timeout=5000)
    await pg.fill('#nk-name', name)
    await pg.keyboard.press('Enter')
    await pg.wait_for_timeout(500)


async def open_settings(pg: Page):
    await open_sheet(pg)
    s = pg.locator('button', has_text=re.compile(r'^Settings'))
    if await s.get_attribute('aria-expanded') != 'true':
        await s.click()
    await pg.wait_for_timeout(250)


async def open_mine(pg: Page):
    await open_sheet(pg)
    s = pg.locator('button', has_text=re.compile(r'^My routes'))
    if await s.count() and await s.get_attribute('aria-expanded') != 'true':
        await s.click()
    await pg.wait_for_timeout(250)


async def pick(pg: Page, text: str):
    await open_sheet(pg)
    await pg.locator('label, button', has_text=re.compile(rf'^\s*{re.escape(text)}\s*$')).first.click()
    await pg.wait_for_timeout(300)


async def new_route(pg: Page):
    await open_sheet(pg)
    await pg.locator('.newb').first.click()
    await pg.wait_for_timeout(400)


async def marker_loc(pg: Page, cls: str):
    return pg.locator(f'.wp.{cls}').first


async def dbl(pg: Page, loc):
    if phone():
        x, y = await center(loc)
        cdp = await pg.context.new_cdp_session(pg)
        pt = [{'x': x, 'y': y}]
        for _ in range(2):  # two taps back to back, as a finger does (under 350 ms)
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pt})
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    else:
        await loc.dblclick()
    await pg.wait_for_timeout(500)


async def drag(pg: Page, x, y, dx, dy):
    await pg.mouse.move(x, y)
    await pg.mouse.down()
    await pg.mouse.move(x + dx / 2, y + dy / 2, steps=6)
    await pg.mouse.move(x + dx, y + dy, steps=6)
    await pg.mouse.up()
    await pg.wait_for_timeout(600)


TWO = [(0.42, 0.28), (0.6, 0.42)]  # around the map centre: the same place on every screen size
THREE = [(0.38, 0.4), (0.5, 0.25), (0.62, 0.4)]
ELSEWHERE = [(0.4, 0.42), (0.6, 0.28)]


async def other_page(browser, hash_) -> Page:
    c = await new_ctx(browser)
    return await open_app(c, hash_)


async def make_link(pg: Page, ctx, name, click=True):
    """Draws and names a routed route; copies its short link when `click` (this makes one on the server)."""
    await draw(pg, TWO)
    await finish_with_name(pg, name)
    one = await km(pg)
    await open_sheet(pg)
    btn = pg.locator('button:has-text("Copy link")')
    await reach(pg, btn, 'Copy link')
    if not click:
        return None, one
    await btn.click()
    await pg.wait_for_timeout(2500)
    url = await pg.evaluate('navigator.clipboard.readText()')
    check(re.search(r'#s=\w+', url), f'no short link copied: {url!r}')
    return url, one


# ---------- cases ----------
async def V1(ctx):
    """Route survives a reload."""
    pg = await open_app(ctx, HASH)
    await draw(pg, TWO)
    await finish_with_name(pg, 'V1 kept')
    one = await km(pg)
    await pg.reload()
    await pg.wait_for_selector('.wp', timeout=30000)
    await settle(pg)
    check(await markers(pg) == 2, f'{await markers(pg)} points after reload')
    check(abs(await km(pg) - one) < 0.05, 'length differs after reload')
    check(await pg.input_value('.title') == 'V1 kept', 'name lost')


async def V2(ctx):
    """My routes groups by type with counts; open a saved route."""
    pg = await open_app(ctx, HASH)
    await draw(pg, TWO)
    await finish_with_name(pg, 'V2 gravel')
    await new_route(pg)
    await pick(pg, 'Hike')
    await draw(pg, ELSEWHERE)
    await finish_with_name(pg, 'V2 hike')
    await new_route(pg)
    await open_mine(pg)
    mine = (await pg.locator('.mine').inner_text()).replace('\n', ' ')
    check(re.search(r'Gravel\s+1', mine) and re.search(r'Hike\s+1', mine), f'groups: {mine[:200]!r}')
    check('V2 gravel' in mine and 'V2 hike' in mine, f'names: {mine[:200]!r}')
    for nm in ('V2 gravel', 'V2 hike'):
        await reach(pg, pg.locator('.mine .name', has_text=nm), f'list item {nm}')
    await reach(pg, pg.locator('.mine .newr').first, '+ New route button')
    await pg.locator('.mine .name', has_text='V2 gravel').click()
    await pg.wait_for_timeout(800)
    await settle(pg)
    check(await pg.input_value('.title') == 'V2 gravel', 'route not opened')
    check(await markers(pg) == 2, 'points of the opened route missing')


async def V3(ctx):
    """Rename."""
    pg = await open_app(ctx, HASH)
    await draw(pg, TWO)
    await finish_with_name(pg, 'V3 old')
    await open_sheet(pg)
    await pg.fill('.title', 'V3 renamed')
    await pg.keyboard.press('Enter')
    await pg.wait_for_timeout(1000)
    await open_mine(pg)
    check('V3 renamed' in await pg.locator('.mine').inner_text(), 'new name not in the list')
    await pg.reload()
    await pg.wait_for_selector('.title')
    await pg.wait_for_timeout(1500)
    await open_mine(pg)
    txt = await pg.locator('.side').inner_text()
    check('V3 renamed' in txt and 'V3 old' not in txt, 'rename not persisted')


async def V4(ctx):
    """Delete with an inline confirm."""
    pg = await open_app(ctx, HASH)
    await draw(pg, TWO)
    await finish_with_name(pg, 'V4 doomed')
    await open_mine(pg)
    await pg.click('.mine [aria-label*="V4 doomed"]')
    q = pg.locator('text=Delete “V4 doomed”?')
    check(await q.count() >= 1, 'no inline confirmation')
    await pg.locator('.mine button', has_text=re.compile(r'^\s*Cancel\s*$')).first.click()
    await pg.wait_for_timeout(300)
    check('V4 doomed' in await pg.locator('.mine').inner_text(), 'Cancel deleted the route')
    await pg.click('.mine [aria-label*="V4 doomed"]')
    await reach(pg, pg.locator('.mine button', has_text=re.compile(r'^\s*Delete\s*$')).first, 'confirm Delete button')
    await pg.locator('.mine button', has_text=re.compile(r'^\s*Delete\s*$')).first.click()
    await pg.wait_for_timeout(600)
    check('V4 doomed' not in await pg.locator('.side').inner_text(), 'route still listed')
    await pg.reload()
    await pg.wait_for_timeout(2000)
    check(await markers(pg) == 0 and 'V4 doomed' not in await pg.locator('.side').inner_text(), 'route came back after reload')


async def V5(ctx):
    """+ New saves the current route (asks for a name when it has none)."""
    pg = await open_app(ctx, HASH)
    await draw(pg, TWO)
    await finish_with_name(pg, 'V5 first')
    await new_route(pg)
    check(await markers(pg) == 0, 'New did not clear the map')
    await draw(pg, ELSEWHERE)
    await stop_editing(pg)  # asks for a name
    await pg.wait_for_selector('dialog.named[open]', timeout=5000)
    await pg.click('text=Back to editing')
    check(await editing(pg), 'Back to editing did not resume editing')
    await new_route(pg)  # unnamed: the dialog must come first, then the new route
    await pg.wait_for_selector('dialog.named[open]', timeout=5000)
    await pg.fill('#nk-name', 'V5 second')
    await pg.keyboard.press('Enter')
    await pg.wait_for_timeout(800)
    check(await markers(pg) == 0, 'New did not run after naming')
    await open_mine(pg)
    mine = await pg.locator('.mine').inner_text()
    check('V5 first' in mine and 'V5 second' in mine, f'list: {mine[:200]!r}')


async def V6(ctx):
    """Name dialog on finishing: suggestions, required name, back to editing; fits the screen."""
    pg = await open_app(ctx, HASH)
    await draw(pg, TWO)
    await stop_editing(pg)
    await pg.wait_for_selector('dialog.named[open]', timeout=5000)
    dlg = pg.locator('dialog.named')
    await pg.wait_for_timeout(300)
    for loc, what in ((dlg, 'dialog'), (pg.locator('dialog.named .pri'), 'Save'), (pg.locator('dialog.named .sec'), 'Back to editing'),
                      (pg.locator('#nk-name'), 'name field')):
        await reach(pg, loc, what)
    facts = await pg.locator('dialog.named .facts').inner_text()
    check('km' in facts and '↑' in facts, f'facts: {facts!r}')
    try:
        await pg.wait_for_selector('dialog.named .sug', timeout=25000)
    except Exception:
        raise Fail('no place-name suggestion chips within 25 s')
    chips = await pg.locator('dialog.named .sug').all_inner_texts()
    check(chips and all(c.strip() for c in chips), f'chips: {chips}')
    await reach(pg, pg.locator('dialog.named .sug').last, 'last chip')
    check(await pg.get_attribute('dialog.named .pri', 'aria-disabled') == 'true', 'Save looks enabled with an empty name')
    await pg.click('dialog.named .pri', force=True)
    check(await pg.locator('dialog.named[open]').count() == 1, 'Save with an empty name closed the dialog')
    await pg.keyboard.press('Escape')
    check(await pg.locator('dialog.named[open]').count() == 1, 'Esc closed the required dialog')
    await pg.locator('dialog.named .sug').first.click()
    check(await pg.input_value('#nk-name') == chips[0].strip(), 'chip did not fill the name')
    await pg.click('dialog.named .sec')
    await pg.wait_for_timeout(300)
    check(await pg.locator('dialog.named[open]').count() == 0 and await editing(pg), 'Back to editing')
    await stop_editing(pg)
    await pg.wait_for_selector('dialog.named[open]')
    await pg.wait_for_selector('dialog.named .sug', timeout=25000)
    first = (await pg.locator('dialog.named .sug').first.inner_text()).strip()
    await pg.locator('dialog.named .sug').first.click()
    await pg.click('dialog.named .pri')
    await pg.wait_for_timeout(500)
    check(await pg.locator('dialog.named[open]').count() == 0, 'dialog stayed open after Save')
    check(await pg.input_value('.title') == first, f'title {await pg.input_value(".title")!r} != chip {first!r}')


async def menu_texts(pg, what='?'):
    try:
        await pg.wait_for_selector('.maplibregl-popup .ctx button', timeout=3000)
    except Exception:
        raise Fail(f'no waypoint menu after a tap/click on: {what}')
    await pg.wait_for_timeout(1000)  # a human is slower than two taps 100 ms apart
    return [t.strip() for t in await pg.locator('.maplibregl-popup .ctx button').all_inner_texts()]


async def close_menu(pg):
    """On a phone the open menu can cover the next point (seen: the start menu hides a via point): close it first."""
    await pg.evaluate("document.querySelectorAll('.maplibregl-popup').forEach(e => e.remove())")
    await pg.wait_for_timeout(150)


async def V7(ctx):
    """Waypoint menu: Delete point; Continue the route from here on an end point."""
    pg = await open_app(ctx, HASH)
    await draw(pg, THREE, straight=True)
    check(await markers(pg) == 3, 'three points expected')
    await tap(pg, await marker_loc(pg, 'wp-start'))
    m = await menu_texts(pg, 'start')
    check('Delete point' in m and 'Continue the route from here' in m, f'start menu: {m}')
    await close_menu(pg)
    await tap(pg, await marker_loc(pg, 'wp-via'))
    m = await menu_texts(pg, 'via')
    check(m == ['Delete point'], f'via menu: {m}')
    await close_menu(pg)
    await tap(pg, await marker_loc(pg, 'wp-end'))
    m = await menu_texts(pg, 'end')
    check('Delete point' in m, f'end menu: {m}')
    # continue from the start: then the other end offers to go back
    await close_menu(pg)
    await tap(pg, await marker_loc(pg, 'wp-start'))
    cont = pg.locator('.maplibregl-popup .ctx button', has_text='Continue the route from here')
    await (cont.tap() if phone() else cont.click())
    await pg.wait_for_timeout(1200)
    check(await pg.locator('.wp-start.wp-active').count() == 1, 'start is not the active end after Continue')
    await close_menu(pg)
    await tap(pg, await marker_loc(pg, 'wp-end'))
    m = await menu_texts(pg, 'end after Continue')
    check('Continue the route from here' in m, f'end menu after switching: {m}')
    await close_menu(pg)
    await tap(pg, await marker_loc(pg, 'wp-via'))
    await menu_texts(pg, 'via before delete')
    dp = pg.locator('.maplibregl-popup .ctx button', has_text='Delete point')
    await (dp.tap() if phone() else dp.click())
    await pg.wait_for_timeout(600)
    check(await markers(pg) == 2, f'Delete point left {await markers(pg)} points')


async def V8(ctx):
    """Double click (double tap) deletes a point; undo brings it back."""
    pg = await open_app(ctx, HASH)
    await draw(pg, THREE, straight=True)
    await dbl(pg, await marker_loc(pg, 'wp-via'))
    check(await markers(pg) == 2, f'double click left {await markers(pg)} points')
    await pg.keyboard.press('Control+z')
    await pg.wait_for_timeout(500)
    check(await markers(pg) == 3, 'undo did not restore the point')


async def box(loc):
    b = await loc.bounding_box()
    return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2


async def V9(ctx):
    """Dragging a waypoint that lies on the line moves it and adds nothing."""
    pg = await open_app(ctx, HASH)
    await draw(pg, THREE, straight=True)
    for cls, (dx, dy) in (('wp-via', (30, 60)), ('wp-end', (-40, 40)), ('wp-start', (30, 30))):
        before = await markers(pg)
        loc = await marker_loc(pg, cls)
        x, y = await box(loc)
        await drag(pg, x, y, dx, dy)
        await pg.wait_for_timeout(500)
        after = await markers(pg)
        check(after == before, f'dragging {cls}: {before} -> {after} points')
        x2, y2 = await box(await marker_loc(pg, cls))
        check(abs(x2 - x - dx) < 6 and abs(y2 - y - dy) < 6, f'{cls} did not follow the drag: moved {x2 - x:.0f},{y2 - y:.0f}')


async def on_line(pg, a, b):
    """A point of the drawn line (the cursor turns to 'grab' over it), the closest to the middle between a and b."""
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    best = None
    x0, x1, y0, y1 = min(a[0], b[0]) - 20, max(a[0], b[0]) + 20, min(a[1], b[1]) - 20, max(a[1], b[1]) + 20
    x = x0
    while x <= x1:
        y = y0
        while y <= y1:
            if min(((x - a[0]) ** 2 + (y - a[1]) ** 2) ** .5, ((x - b[0]) ** 2 + (y - b[1]) ** 2) ** .5) > 32:
                await pg.mouse.move(x, y)
                if await pg.evaluate("document.querySelector('.maplibregl-canvas').style.cursor") == 'grab':
                    d = (x - mid[0]) ** 2 + (y - mid[1]) ** 2
                    if best is None or d < best[0]:
                        best = (d, x, y)
            y += 8
        x += 8
    check(best, 'could not find the route line between the points')
    return best[1], best[2]


async def V10(ctx):
    """Dragging the line between points inserts one; undo and redo."""
    pg = await open_app(ctx, HASH)
    await draw(pg, TWO, straight=True)
    a, b = await box(await marker_loc(pg, 'wp-start')), await box(await marker_loc(pg, 'wp-end'))
    mx, my = await on_line(pg, a, b)
    await drag(pg, mx, my, 30, -50)
    await settle(pg)
    check(await markers(pg) == 3, f'expected 3 points after dragging the line, got {await markers(pg)}')
    await pg.keyboard.press('Control+z')
    await pg.wait_for_timeout(500)
    check(await markers(pg) == 2, 'undo of the insert')
    await pg.keyboard.press('Control+Shift+z')
    await pg.wait_for_timeout(500)
    check(await markers(pg) == 3, 'redo of the insert')


async def recipient(browser, link_hash, expect_km, heat=False):
    c = await new_ctx(browser)
    p2 = await open_app(c, link_hash)
    await p2.wait_for_selector('.wp', timeout=30000)
    await settle(p2)
    await p2.wait_for_timeout(1500)
    check(await markers(p2) == 2, f'recipient sees {await markers(p2)} points')
    check(abs(await km(p2) - expect_km) < 0.05, f'recipient km {await km(p2)} != {expect_km}')
    check(not p2.route_urls, f'{len(p2.route_urls)} /api/route requests on opening the link: {p2.route_urls[:1]}')
    return p2


async def V11(ctx):
    """Copy link: short link; a new context shows the same route without routing requests."""
    pg = await open_app(ctx, HASH)
    if 'plain' in SHARED or (NO_NEW_LINKS and 'heat' in SHARED):
        _, one = await make_link(pg, ctx, 'V11 shared', click=False)
        url, ref = SHARED.get('plain') or SHARED['heat']
        one = ref
    else:
        url, one = await make_link(pg, ctx, 'V11 shared')
        SHARED['plain'] = (url, one)
    p2 = await recipient(ctx.browser, url.split('#', 1)[1], one)
    await p2.context.close()


async def V12(ctx):
    """Short link with 'Stick to the heatmap': stored legs are reused, option restored."""
    pg = await open_app(ctx, HASH)
    await open_settings(pg)
    sw = pg.locator('label.sw', has_text='Stick to the heatmap')
    await sw.click()
    check(await sw.locator('input').is_checked(), 'heatmap switch did not turn on')
    if 'heat' in SHARED:
        _, one = await make_link(pg, ctx, 'V12 heat', click=False)
        url, ref = SHARED['heat']
        one = ref
    else:
        url, one = await make_link(pg, ctx, 'V12 heat')
        SHARED['heat'] = (url, one)
    p2 = await recipient(ctx.browser, url.split('#', 1)[1], one)
    await open_settings(p2)
    check(await p2.locator('label.sw', has_text='Stick to the heatmap').locator('input').is_checked(), 'heatmap option not restored for the recipient')
    await p2.context.close()


async def V13(ctx):
    """A short link that does not exist."""
    pg = await ctx.new_page()
    await pg.goto(BASE + '#s=zzzzzzzz')
    try:
        await pg.get_by_text('This link leads nowhere').wait_for(timeout=25000)
    except Exception:
        raise Fail('no "This link leads nowhere" toast; page text: ' + (await pg.locator('body').inner_text())[:150].replace('\n', ' '))
    await pg.wait_for_timeout(1500)
    check(await markers(pg) == 0, 'a route appeared for a missing link')


async def V14(ctx):
    """Pasting a #s= link into an open tab (hash change) reloads and opens the route."""
    if NO_NEW_LINKS and 'plain' not in SHARED and 'heat' in SHARED:
        SHARED['plain'] = SHARED['heat']
    if 'plain' not in SHARED:
        pg0 = await open_app(ctx, HASH)
        url, one = await make_link(pg0, ctx, 'V14 shared')
        SHARED['plain'] = (url, one)
        ctx = await new_ctx(ctx.browser)
    url, one = SHARED['plain']
    pg = await open_app(ctx, HASH)
    check(await markers(pg) == 0, 'tab not empty before the paste')
    await pg.evaluate('h => { location.hash = h }', url.split('#', 1)[1])
    await pg.wait_for_selector('.wp', timeout=40000)
    await settle(pg)
    check(await markers(pg) == 2 and abs(await km(pg) - one) < 0.05, f'opened {await markers(pg)} points, {await km(pg)} km (expected {one})')


async def make_gpx(ctx, name):
    pg = await open_app(ctx, HASH)
    await draw(pg, TWO)
    await finish_with_name(pg, name)
    await open_sheet(pg)
    btn = pg.locator('button.garmin', has_text='Download GPX')
    await reach(pg, btn, 'Download GPX button')
    async with pg.expect_download() as d:
        await btn.click()
    dl = await d.value
    path = OUT / f'{name.replace(" ", "_")}-{PROF.get()["name"]}.gpx'
    await dl.save_as(str(path))
    return dl.suggested_filename, path, await km(pg)


async def V15(ctx):
    """Export GPX: name, trkpt with ele."""
    fname, path, one = await make_gpx(ctx, 'V15 export')
    text = open(path, encoding='utf-8').read()
    check(fname.lower().endswith('.gpx') and 'v15' in fname.lower(), f'file name {fname!r}')
    check('V15 export' in text, 'route name not in the GPX')
    n = text.count('<trkpt')
    check(n > 5 and text.count('<ele>') >= n * 0.9, f'{n} trkpt, {text.count("<ele>")} ele')
    SHARED[('gpx', PROF.get()['name'])] = (path, one)


async def V16(ctx):
    """Import the exported GPX: a track appears with a length; click opens it as a route."""
    key = ('gpx', PROF.get()['name'])
    if key not in SHARED:
        _, path, one = await make_gpx(ctx, 'V16 export')
        SHARED[key] = (path, one)
        ctx = await new_ctx(ctx.browser)
    path, one = SHARED[key]
    pg = await open_app(ctx, HASH)
    await open_mine(pg)
    await pg.set_input_files('input[type=file]', str(path))
    await pg.wait_for_selector('.mine .trk', timeout=30000)
    await open_sheet(pg)
    tl = await pg.locator('.mine .trk').inner_text()
    m = re.search(r'([\d.,]+)\s*km', tl)
    check(m and float(m.group(1).replace(',', '.')) > 0.2, f'no track length: {tl!r}')
    await reach(pg, pg.locator('.mine .trk .name'), 'track item')
    await pg.locator('.mine .trk .name').click()
    await pg.wait_for_selector('.wp', timeout=90000)
    await settle(pg)
    check(await markers(pg) >= 2, 'no route points after opening the track')
    k = await km(pg)
    check(0.7 * one < k < 1.3 * one, f'opened route {k} km vs exported {one} km')


async def V17(ctx):
    """Empty panel: the start hint does not overlap the settings or the routes list."""
    pg = await open_app(ctx, HASH)
    await ensure_editing(pg)
    await open_settings(pg)
    await pg.wait_for_timeout(400)

    async def overlaps(label):
        hint = pg.locator('.ehint')
        if not await hint.count():
            return
        h = await hint.bounding_box()
        for sel in ('.side', '.mine', '.browse'):
            loc = pg.locator(sel).first
            if not await loc.count() or not await loc.is_visible():
                continue
            b = await loc.bounding_box()
            ix = min(h['x'] + h['width'], b['x'] + b['width']) - max(h['x'], b['x'])
            iy = min(h['y'] + h['height'], b['y'] + b['height']) - max(h['y'], b['y'])
            check(not (ix > 2 and iy > 2), f'{label}: start hint {h} overlaps {sel} {b}')

    await overlaps('with Settings open')
    # and with a list of saved routes
    await pg.close()
    pg = await open_app(ctx, HASH)
    await draw(pg, TWO)
    await finish_with_name(pg, 'V17 listed')
    await new_route(pg)
    await ensure_editing(pg)
    await open_mine(pg)
    await pg.wait_for_timeout(400)
    await overlaps('with the routes list open')
    await open_sheet(pg)
    await reach(pg, pg.locator('.mine .name', has_text='V17 listed'), 'saved route in the list')


CASES = {
    'V1': ('Route survives a reload', V1), 'V2': ('My routes: groups, counts, open', V2), 'V3': ('Rename', V3),
    'V4': ('Delete, inline confirm', V4), 'V5': ('+ New saves the current route', V5), 'V6': ('Name dialog', V6),
    'V7': ('Waypoint menu', V7), 'V8': ('Double click deletes', V8), 'V9': ('Drag waypoint adds nothing', V9),
    'V10': ('Drag line inserts; undo/redo', V10), 'V11': ('Copy link, open in a new context', V11),
    'V12': ('Short link with heatmap', V12), 'V13': ('Missing short link', V13), 'V14': ('Paste #s= into an open tab', V14),
    'V15': ('Export GPX', V15), 'V16': ('Import GPX, open as a route', V16), 'V17': ('Start hint vs panel', V17),
}


async def run_profile(browser, name, ids):
    PROF.set({'name': name})
    res = {}
    for cid in ids:
        title, fn = CASES[cid]
        if (cid, name) in NA:
            res[cid] = ('n/a', NA[(cid, name)], 0)
            print(f'{name:13} {cid:4} n/a', flush=True)
            continue
        ctx = await new_ctx(browser)
        t0 = time.time()
        out = ('pass', '')
        for attempt in (1, 2, 3):
            try:
                await asyncio.wait_for(fn(ctx), timeout=240)
                out = ('pass' if attempt == 1 else f'pass (try {attempt})', '')
                break
            except Fail as e:
                out = ('FAIL', str(e))
            except Exception as e:
                out = ('ERROR', f'{type(e).__name__}: {str(e).splitlines()[0][:160]}')
            if cid in ('V11', 'V12') and 'plain' in SHARED:
                pass
            if out[0] == 'FAIL' and attempt == 1 and cid not in ('V13',):
                pass  # real verdicts are not retried; only broken steps are
            if out[0] == 'FAIL':
                break
            for i, pg in enumerate(ctx.pages):
                try:
                    await pg.screenshot(path=str(OUT / f'{cid}-{name}-try{attempt}-{i}.png'))
                except Exception:
                    pass
            await ctx.close()
            ctx = await new_ctx(browser)
        if out[0] in ('FAIL', 'ERROR'):
            for i, pg in enumerate(ctx.pages):
                try:
                    await pg.screenshot(path=str(OUT / f'{cid}-{name}-{i}.png'))
                except Exception:
                    pass
        await ctx.close()
        res[cid] = (out[0], out[1], time.time() - t0)
        print(f'{name:13} {cid:4} {out[0]:8} {time.time() - t0:5.1f}s {out[1][:200]}', flush=True)
    return res


async def main(only):
    names = [n for n in (lambda v: ','.join(PROFILES) if v == 'all' else v)(os.environ.get('VIEWPORT', 'all')).split(',') if n in PROFILES]
    ids = [c for c in CASES if not only or c in only]
    if NO_NEW_LINKS and 'V12' in ids:
        ids.remove('V12'); ids.insert(0, 'V12')
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        results = {}
        first = await asyncio.create_task(run_profile(browser, names[0], ids))  # makes the short links
        results[names[0]] = first
        rest = await asyncio.gather(*[asyncio.create_task(run_profile(browser, n, ids)) for n in names[1:]])
        results.update(dict(zip(names[1:], rest)))
        await browser.close()
    lines = [f'Against {BASE}', '', '| Id | Case | ' + ' | '.join(names) + ' |', '|---|---|' + '---|' * len(names)]
    for cid in ids:
        lines.append(f'| {cid} | {CASES[cid][0]} | ' + ' | '.join(results[n][cid][0] for n in names) + ' |')
    lines += ['', 'Details of non-passes:']
    for n in names:
        for cid in ids:
            r = results[n][cid]
            if not r[0].startswith('pass'):
                lines.append(f'- {cid} [{n}] {r[0]}: {r[1]}')
    txt = '\n'.join(lines)
    (OUT / 'results.md').write_text(txt + '\n')
    print('\n' + txt)


if __name__ == '__main__':
    asyncio.run(main(set(sys.argv[1:])))

#!/usr/bin/env python3
"""End-to-end checks of the use cases in docs/use-cases.md (same ids).

Run against the dev server (BASE overrides the address):
  python3 tools/e2e/usecases.py                 # http://localhost:5173/maps/
  python3 tools/e2e/usecases.py A1 B4           # only these cases
Needs Python Playwright with Chromium. Routing goes to the real router (through the dev
proxy or the live API). F4 stores one short link on the server.
Writes docs/use-cases-run.md with the results; screenshots of failures go to OUT.
"""
import asyncio, os, re, sys, time, json, pathlib, traceback
from playwright.async_api import async_playwright, Page, BrowserContext

BASE = os.environ.get('BASE', 'http://localhost:5173/maps/')
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(os.environ.get('OUT', '/tmp/nk-e2e'))
GPX = os.environ.get('GPX', str(pathlib.Path.home() / 'Downloads/Morning_Hike.gpx'))
SINTRA = 'm=15/38.7975/-9.3860&l=Co'
OUT.mkdir(parents=True, exist_ok=True)


# Visible viewport sizes (browser chrome already subtracted). Shared by all suites.
PROFILES = {
    'desktop': dict(viewport={'width': 1440, 'height': 780}),
    'desktop-short': dict(viewport={'width': 1366, 'height': 650}),
    'phone': dict(viewport={'width': 390, 'height': 664}, is_mobile=True, has_touch=True),
    'phone-small': dict(viewport={'width': 375, 'height': 553}, is_mobile=True, has_touch=True),
}
VIEWPORT = os.environ.get('VIEWPORT', 'all')  # a profile name, a comma list, or 'all'


def is_phone(profile: str) -> bool:
    return PROFILES[profile].get('is_mobile', False)


async def new_context(browser, profile='desktop', **kw) -> BrowserContext:
    ctx = await browser.new_context(accept_downloads=True, **PROFILES[profile], **kw)
    ctx._nk_profile = profile  # type: ignore[attr-defined]
    return ctx


def profile_of(ctx) -> str:
    return getattr(ctx, '_nk_profile', 'desktop')


class Fail(Exception):
    pass


class NA(Exception):
    """The case does not apply to this profile (the reason is the message)."""


def check(cond, msg):
    if not cond:
        raise Fail(msg)


# ---------- helpers ----------
async def prepare(ctx: BrowserContext):
    """Cookies answered ('denied') and analytics blocked, once per context."""
    if getattr(ctx, '_nk_ready', False):
        return
    ctx._nk_ready = True  # type: ignore[attr-defined]
    await ctx.add_init_script("try { if (!localStorage.getItem('nm-consent')) localStorage.setItem('nm-consent', 'denied') } catch (e) {}")
    await ctx.route(re.compile(r'googletagmanager|google-analytics'), lambda r: r.abort())


async def open_app(ctx: BrowserContext, hash_=SINTRA, storage: dict | None = None) -> Page:
    await prepare(ctx)
    pg = await ctx.new_page()
    pg.route_urls = []  # type: ignore[attr-defined]
    pg.on('request', lambda r: '/api/route?' in r.url and pg.route_urls.append(r.url))  # type: ignore[attr-defined]
    await pg.goto(BASE + '#' + hash_)
    if storage:
        await pg.evaluate('(s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v) }', storage)
        await pg.reload()
    await pg.wait_for_selector('.maplibregl-canvas')
    await pg.wait_for_function("document.querySelector('.maplibregl-canvas')?.width > 0")
    await pg.wait_for_timeout(1500)
    return pg


async def phone_ctx(pg: Page) -> bool:
    return bool(await pg.evaluate("matchMedia('(pointer: coarse)').matches"))


async def sheet(pg: Page, open_: bool):
    """Phone bottom sheet: opens/closes it through its handle. No-op where there is no sheet."""
    g = pg.locator('.grab')
    if not await g.count() or not await g.is_visible():
        return
    if (await g.get_attribute('aria-expanded') == 'true') != open_:
        await g.click()
        await pg.wait_for_timeout(600)


async def side(pg: Page):
    await sheet(pg, True)


async def mapview(pg: Page):
    await sheet(pg, False)


async def canvas_xy(pg: Page, fx: float, fy: float):
    b = await pg.locator('.maplibregl-canvas').bounding_box()
    return b['x'] + b['width'] * fx, b['y'] + b['height'] * fy


async def editing(pg: Page) -> bool:
    return await pg.get_attribute('.tb >> nth=0', 'aria-pressed') == 'true'


async def ensure_editing(pg: Page):
    await mapview(pg)
    if not await editing(pg):
        await pg.click('.tb >> nth=0')


async def settle(pg: Page, timeout=60):
    """Waits until no leg is being routed (the pill is gone and the summary is there)."""
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
    await mapview(pg)
    x, y = await canvas_xy(pg, fx, fy)
    if shift:
        await pg.keyboard.down('Shift')
    if await phone_ctx(pg) and not shift:
        await pg.touchscreen.tap(x, y)
    else:
        await pg.mouse.click(x, y)
    if shift:
        await pg.keyboard.up('Shift')
    await pg.wait_for_timeout(350)


async def draw(pg: Page, pts, shift_last=False):
    await ensure_editing(pg)
    for i, (fx, fy) in enumerate(pts):
        await click_map(pg, fx, fy, shift=shift_last and i == len(pts) - 1)
    await settle(pg)


async def markers(pg: Page) -> int:
    return await pg.locator('.wp').count()


async def km(pg: Page) -> float:
    t = await pg.locator('.sum').inner_text()
    m = re.search(r'([\d.]+)\s*km', t.replace('\n', ' '))
    check(m, f'no length in the summary: {t[:80]!r}')
    return float(m.group(1))


async def marker_xy(pg: Page, cls: str):
    b = await pg.locator(f'.wp.{cls}').first.bounding_box()
    return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2


async def finish_with_name(pg: Page, name: str):
    """Turns editing off and names the route in the dialog."""
    await mapview(pg)
    await pg.keyboard.press('Escape')
    await pg.wait_for_selector('dialog.named[open]', timeout=5000)
    await pg.fill('#nk-name', name)
    await pg.keyboard.press('Enter')
    await pg.wait_for_timeout(300)


async def open_settings(pg: Page):
    """All settings, a view of the panel: from the settings sentence, or the Settings line of the empty panel."""
    await side(pg)
    if await pg.locator('.pview').count():
        return
    s = pg.locator('.ss .all')
    await (s if await s.count() else pg.locator('button.setl')).first.click()
    await pg.wait_for_timeout(250)


async def close_settings(pg: Page):
    """Back from All settings to the route."""
    if await pg.locator('.pview').count():
        await side(pg)
        await pg.locator('.pview .back').click()
        await pg.wait_for_timeout(200)


async def settings_summary(pg: Page) -> str:
    """What differs from the route type's defaults, as All settings says it under its title."""
    await open_settings(pg)
    return (await pg.locator('.pvs').inner_text()).strip()


async def open_mine(pg: Page):
    await side(pg)
    s = pg.locator('button', has_text=re.compile(r'^My routes'))
    if await s.count() and await s.get_attribute('aria-expanded') != 'true':
        await s.click()
    await pg.wait_for_timeout(200)


async def pick(pg: Page, text: str):
    """Clicks a segmented option or a labelled control by its exact text."""
    await side(pg)
    await pg.locator('label, button', has_text=re.compile(rf'^\s*{re.escape(text)}\s*$')).first.click()
    await pg.wait_for_timeout(300)


async def slide(pg: Page, id_: str, key: str, times=1):
    """Moves a settings slider with the keyboard (works the same on every profile)."""
    await open_settings(pg)
    await pg.focus('#' + id_)
    for _ in range(times):
        await pg.keyboard.press(key)
    await pg.wait_for_timeout(300)


async def drag(pg: Page, a, b, steps=8):
    """Drags from a to b (pixels); finger drag on a phone, mouse elsewhere."""
    await mapview(pg)
    await pg.mouse.move(*a)
    await pg.mouse.down()
    await pg.mouse.move(*b, steps=steps)
    await pg.mouse.up()


def routed_with(pg: Page, needle: str) -> bool:
    return any(needle in u for u in pg.route_urls)  # type: ignore[attr-defined]


TWO = [(0.35, 0.35), (0.62, 0.6)]

# ---------- A. Plan ----------
async def A1(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    check(await markers(pg) == 2, 'two waypoints expected')
    check(await km(pg) > 0.2, 'route length')
    s = await pg.locator('.sum').inner_text()
    check('↑' in s and '↓' in s and re.search(r'\d+\s*min|h', s), f'summary incomplete: {s[:120]!r}')
    check(await pg.locator('.prof canvas').count() == 1, 'no elevation profile')


async def A2(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    n0 = len(pg.route_urls)  # type: ignore[attr-defined]
    x, y = await marker_xy(pg, 'wp-end')
    await drag(pg, (x, y), (x - 90, y - 60))  # up and left: the profile card covers the lower map
    await settle(pg)
    x2, y2 = await marker_xy(pg, 'wp-end')
    check(abs(x2 - x) > 40 or abs(y2 - y) > 40, f'the point did not move: {(x, y)} -> {(x2, y2)}')
    check(len(pg.route_urls) > n0, 'the leg was not re-routed after the drag')  # type: ignore[attr-defined]
    check(await markers(pg) == 2, f'dragging a waypoint added a point: {await markers(pg)} points')


async def A3(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO, shift_last=True)  # a straight leg: its middle is on the line
    a, b = await marker_xy(pg, 'wp-start'), await marker_xy(pg, 'wp-end')
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    await drag(pg, (mx, my), (mx + 40, my - 50))
    await settle(pg)
    check(await markers(pg) == 3, f'expected 3 points after dragging the line, got {await markers(pg)}')


async def A4(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO + [(0.5, 0.25)])
    check(await markers(pg) == 3, 'three points')
    via = pg.locator('.wp.wp-via').first
    await mapview(pg)
    await via.dblclick()
    await pg.wait_for_timeout(500)
    if await pg.locator('.ctx').count():
        await pg.keyboard.press('Escape')  # a single-click menu opened first; it must not stay
    await settle(pg)
    check(await markers(pg) == 2, 'double-click did not delete the point')
    await pg.keyboard.press('Backspace')
    await settle(pg)
    check(await markers(pg) == 1, 'Backspace did not remove the last point')


async def A5(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO + [(0.5, 0.25)])
    await pg.keyboard.press('Control+z')
    await settle(pg)
    check(await markers(pg) == 2, 'undo')
    await pg.keyboard.press('Control+Shift+z')
    await settle(pg)
    check(await markers(pg) == 3, 'redo')


async def A6(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    before = await km(pg)
    s, e = await marker_xy(pg, 'wp-start'), await marker_xy(pg, 'wp-end')
    await pg.keyboard.press('Escape')  # editing off (names the route)
    if await pg.locator('dialog.named[open]').count():
        await pg.fill('#nk-name', 'A6')
        await pg.keyboard.press('Enter')
    await pg.keyboard.press('r')
    await settle(pg)
    s2 = await marker_xy(pg, 'wp-start')
    check(abs(s2[0] - e[0]) < 3 and abs(s2[1] - e[1]) < 3, 'start did not move to the former finish')
    check(abs(await km(pg) - before) < 0.3, 'length changed a lot after reversing')


async def A7(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    one = await km(pg)
    await pg.click('[aria-label="More: out and back, back to start"]')
    await pg.click('role=menuitem >> text=Out and back')
    await settle(pg)
    two = await km(pg)
    check(1.7 * one < two < 2.3 * one, f'out and back: {one} -> {two}')
    await pg.keyboard.press('Control+z')
    await settle(pg)
    await pg.click('[aria-label="More: out and back, back to start"]')
    await pg.click('role=menuitem >> text=Back to start')
    await settle(pg)
    s, e = await marker_xy(pg, 'wp-start'), await marker_xy(pg, 'wp-end')
    check(abs(s[0] - e[0]) < 3 and abs(s[1] - e[1]) < 3, 'back to start: the finish is not at the start')


async def A8(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO, shift_last=True)
    check('Straight line' in await pg.locator('.sum').inner_text(), 'Shift+click did not make a straight leg')
    await pg.keyboard.press('b')
    check(await pg.get_attribute('[aria-label="Draw straight lines"]', 'aria-pressed') == 'true', 'B did not turn on straight lines')
    await pg.keyboard.press('Escape')
    check(await pg.get_attribute('[aria-label="Draw straight lines"]', 'aria-pressed') == 'false', 'Esc did not leave straight lines')


async def A9(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await pg.keyboard.press('p')
    await click_map(pg, 0.5, 0.5)
    await pg.wait_for_selector('.cp-popup input', timeout=5000)
    await pg.fill('.cp-popup input', 'Fountain')
    await pg.keyboard.press('Enter')
    await pg.wait_for_timeout(500)
    await side(pg)
    tl = pg.locator('.vw button', has_text='All')
    if await tl.count():
        await tl.click()
    more = pg.locator('.tl .more')  # a short screen folds the tail of the list
    if await more.count():
        await more.click()
        await pg.wait_for_timeout(300)
    check('Fountain' in await pg.locator('.tl').inner_text(), 'checkpoint not in the timeline')


async def A10(ctx):
    pg = await open_app(ctx, 'm=7/39.6/-8.8&l=Co')
    await ensure_editing(pg)
    await click_map(pg, 0.45, 0.85)  # around Lisbon
    await click_map(pg, 0.5, 0.2)    # around Porto
    await pg.wait_for_timeout(1500)
    check('100 km' in await pg.locator('.side').inner_text(), 'no message about the 100 km limit')


async def A11(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await pg.keyboard.press('d')
    await pg.wait_for_selector('dialog.named[open]', timeout=5000)
    facts = await pg.locator('dialog.named .facts').inner_text()
    check('km' in facts and '↑' in facts, f'facts missing: {facts!r}')
    check(await pg.get_attribute('dialog.named .pri', 'aria-disabled') == 'true', 'Save is enabled with an empty name')
    await pg.keyboard.press('Escape')
    check(await pg.locator('dialog.named[open]').count() == 1, 'Esc closed the required dialog')
    await pg.click('text=Back to editing')
    check(await editing(pg), 'Back to editing did not turn editing on')
    await finish_with_name(pg, 'Sintra A11')
    check(await pg.input_value('.title') == 'Sintra A11', 'name not applied')
    check(not await editing(pg), 'still editing after naming')


async def A12(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO + [(0.5, 0.25)])
    await mapview(pg)
    await pg.locator('.wp.wp-via').first.click()
    await pg.wait_for_selector('.ctx', timeout=3000)
    txt = await pg.locator('.ctx').inner_text()
    check('Delete point' in txt and 'Continue the route from here' not in txt, f'middle point menu: {txt!r}')
    await pg.locator('.ctx >> text=Delete point').click()
    await settle(pg)
    check(await markers(pg) == 2, 'Delete point did not remove the point')
    await pg.locator('.wp.wp-start').first.click()
    await pg.wait_for_selector('.ctx', timeout=3000)
    txt = await pg.locator('.ctx').inner_text()
    check('Delete point' in txt and 'Continue the route from here' in txt, f'start point menu: {txt!r}')
    await pg.locator('.ctx >> text=Continue the route from here').click()
    await pg.wait_for_timeout(500)
    await click_map(pg, 0.3, 0.25)
    await settle(pg)
    check(await markers(pg) == 3, f'continuing did not add a point: {await markers(pg)}')


# ---------- B. Configure ----------
async def B1(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await pick(pg, 'Hike')
    await settle(pg)
    check(routed_with(pg, 'profile=nk-hike'), 'no hiking request')
    check(await km(pg) > 0, 'no route after switching')


async def B2(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await open_settings(pg)
    out = lambda id_: pg.locator(f'output[for={id_}]')
    check('default' in await out('nk-surf').inner_text() and 'on' not in (await out('nk-surf').get_attribute('class') or '').split(), 'default position not shown as "<Type> default"')
    check('Gravel defaults' in await settings_summary(pg), 'summary does not say "Gravel defaults"')
    await slide(pg, 'nk-surf', 'ArrowRight')
    await settle(pg)
    check(routed_with(pg, 'profile:nk_surface=1'), 'surface parameter not sent')
    check('on' in (await out('nk-surf').get_attribute('class') or '').split(), 'a changed slider is not highlighted (output.on)')
    await slide(pg, 'nk-climbs', 'ArrowLeft')
    await settle(pg)
    check(routed_with(pg, 'profile:nk_uphillcost=120'), 'climbs parameter not sent')
    await slide(pg, 'nk-big', 'ArrowLeft')
    await settle(pg)
    check(routed_with(pg, 'profile:nk_big='), 'big roads parameter not sent')
    summ = await settings_summary(pg)
    check('more dirt' in summ and 'fewer climbs' in summ and 'big roads' in summ, f'settings summary: {summ!r}')
    await pick(pg, 'Hike')
    check('Big roads' not in await pg.locator('.side').inner_text(), 'Big roads offered for hiking')


async def B3(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await pick(pg, 'Hike')
    await settle(pg)
    await open_settings(pg)
    await pick(pg, 'T4')
    await settle(pg)
    for title in ('Signed hiking routes', 'Forest and water', 'Quiet'):
        await pg.locator('label.sw', has_text=title).click()
        await settle(pg)
    for p in ('SAC_scale_limit=4', 'hiking_routes_preference=1', 'consider_forest=1', 'consider_noise=1'):
        check(routed_with(pg, 'profile:' + p), f'{p} not sent')


async def B4(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await open_settings(pg)
    await pg.locator('.allow label', has_text='Ferries').click()
    await settle(pg)
    check(routed_with(pg, 'profile:nk_allow_ferry=0'), 'nk_allow_ferry=0 not sent')
    summ = await settings_summary(pg)
    check('no ferries' in summ, f'summary: {summ!r}')
    await pick(pg, 'Hike')
    check('Unpaved' not in await pg.locator('.allow').inner_text(), 'Unpaved offered for hiking')


# ---------- C. Understand ----------
async def C1(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    s = await pg.locator('.sum').inner_text()
    check(re.search(r'\d+%', s), f'no surface shares: {s!r}')
    await pick(pg, 'Hike')
    await settle(pg)
    s = await pg.locator('.sum').inner_text()
    check(re.search(r'~\s*(\d+\s*h|\d+\s*min)', s), f'no time estimate for hiking: {s[:60]!r}')  # the model changed: no exact minutes


async def C2(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    head = await pg.locator('.prof .ph').inner_text()
    check(all(k in head for k in ('min', 'max', '↑', '↓')), f'profile header: {head!r}')
    await side(pg)
    await pg.locator('.prof canvas').scroll_into_view_if_needed()
    await pg.wait_for_timeout(300)
    b = await pg.locator('.prof canvas').bounding_box()
    if await phone_ctx(pg):  # no hover on a touch screen: the tooltip follows a finger resting/moving on the chart
        cdp = await pg.context.new_cdp_session(pg)
        x, y = b['x'] + b['width'] * 0.5, b['y'] + b['height'] * 0.4
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        for i in range(5):
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + 8 * i, 'y': y}]})
            await pg.wait_for_timeout(50)
    else:
        await pg.mouse.move(b['x'] + b['width'] * 0.5, b['y'] + b['height'] * 0.4)
    await pg.wait_for_timeout(300)
    check(await pg.locator('.prof .tip').count() == 1 and 'km' in await pg.locator('.prof .tip').inner_text(), 'no tooltip on hover')
    if await phone_ctx(pg):
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    await side(pg)
    await pg.click('.prof .pcol')
    check(await pg.locator('.prof canvas').count() == 0, 'collapse')
    await side(pg)
    await pg.click('.prof .pcol')
    check(await pg.locator('.prof canvas').count() == 1, 'expand')


async def C3(ctx):
    pg = await open_app(ctx, 'm=14/38.7975/-9.3860&l=Co')
    await draw(pg, [(0.25, 0.3), (0.5, 0.65), (0.75, 0.35)])
    rows = lambda: pg.locator('.tl .ev').count()
    await side(pg)
    await pg.click('.vw button:has-text("Key")')
    await pg.wait_for_timeout(600)
    key = await rows()
    await pg.click('.vw button:has-text("All")')
    await pg.wait_for_timeout(600)
    allr = await rows()
    print('   C3 rows', key, allr) if os.environ.get('DEBUG') else None
    # All may fold its extra rows into "N more" when the screen is short; then it is not shorter by intent
    folded = await pg.locator('.tl .more').count()
    check(allr >= key or folded, f'All ({allr}) shows fewer rows than Key ({key}) and folds nothing')
    await pg.reload()
    await side(pg)
    await pg.wait_for_selector('.vw')
    check(await pg.get_attribute('.vw button:has-text("All")', 'aria-pressed') == 'true', 'view not remembered')


async def C4(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await pick(pg, 'Road')
    await settle(pg)
    leg = await pg.locator('.prof .leg').inner_text()
    for chip in ('↓ >10%', '↓ 1-10%', 'flat', '↑ 1-3%', '↑ 3-6%', '↑ 6-10%', '↑ 10-14%', '↑ 14-18%', '↑ >18%'):
        check(chip in leg, f'bike grade chip {chip!r} missing: {leg[:120]!r}')
    await pick(pg, 'Hike')
    await settle(pg)
    leg = await pg.locator('.prof .leg').inner_text()
    check('↑ >45%' in leg and '↓ >30%' in leg, f'hiking scale: {leg[:120]!r}')


# ---------- D. Map ----------
async def D1(ctx):
    pg = await open_app(ctx)
    await pg.keyboard.press('l')
    await pg.wait_for_selector('.lpop')
    radios = pg.locator('.lpop input[type=radio]:not([name="nk-color"])')
    n = await radios.count()
    check(n > 3, 'base maps not listed')
    await radios.nth(2).check()
    await pg.wait_for_timeout(1500)
    h = await pg.evaluate('location.hash')
    check('l=Co' not in h, f'base map not in the URL: {h}')


async def D2(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await pg.click('[aria-label="Overlays"]')  # line colours live with the overlays
    await pg.locator('.lpop label', has_text='Single colour').click()
    check(await pg.locator('.lpop input[value=plain]').is_checked(), 'colour mode not chosen')


async def D3(ctx):
    pg = await open_app(ctx, storage={'nk-3d': '0'})
    await pg.click('.dim button:has-text("3D")')
    phone = is_phone(profile_of(ctx))
    # phones hide the tilt buttons and the pitch readout on purpose (two-finger tilt): wait for the compass
    await pg.wait_for_selector('.orbit .compass')
    await pg.wait_for_timeout(1200)
    # the pitch readout goes with the tilt row on phones and wherever the block must shrink to fit
    if await pg.locator('.orbit .deg').is_visible():
        try:  # the tilt is animated
            await pg.wait_for_function("document.querySelector('.orbit .deg')?.textContent.trim().startsWith('6')", timeout=5000)
        except Exception:
            raise Fail(f'not tilted: {await pg.locator(".orbit .deg").inner_text()!r}')
    compass = "document.querySelector('.compass svg')?.getAttribute('style') ?? ''"
    await pg.keyboard.press('e')
    try:  # the turn is animated; a software renderer can be slow
        await pg.wait_for_function(f"({compass}).includes('-45deg')", timeout=4000)
    except Exception:
        raise Fail(f'E did not turn 45 degrees: {await pg.evaluate(compass)}')
    try:
        await pg.click('.compass', timeout=4000)
    except Exception as e:
        raise Fail(f'the compass cannot be clicked (covered?): {str(e).splitlines()[-1][:120]}')
    try:
        await pg.wait_for_function(f"({compass}).includes('rotate(0deg)')", timeout=4000)
    except Exception:
        raise Fail(f'compass click did not turn north up: {await pg.evaluate(compass)}')
    await pg.keyboard.press('t')
    await pg.wait_for_timeout(800)
    check(await pg.locator('.orbit .deg').count() == 0 and await pg.get_attribute('.dim button:has-text("2D")', 'aria-pressed') == 'true', 'T did not go back to 2D')


# ---------- E. Manage ----------
async def E1(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await finish_with_name(pg, 'E1 kept')
    await pg.reload()
    await pg.wait_for_selector('.wp', timeout=20000)
    check(await markers(pg) == 2, 'route not back after reload')


async def E2(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await finish_with_name(pg, 'E2 listed')
    await open_mine(pg)
    mine = await pg.locator('.mine').inner_text()
    check(re.search(r'Gravel\s+1', mine) and 'created' in mine and 'E2 listed' in mine, f'list: {mine[:160]!r}')


async def E3(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await finish_with_name(pg, 'E3 old')
    await side(pg)
    await pg.fill('.title', 'E3 renamed')
    await pg.keyboard.press('Enter')
    await pg.wait_for_timeout(900)  # autosave runs 0.5 s after a change
    await open_mine(pg)
    check('E3 renamed' in await pg.locator('.mine').inner_text(), 'new name not in the list')


async def E4(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await finish_with_name(pg, 'E4 doomed')
    await open_mine(pg)
    await side(pg)
    await pg.click('.mine [aria-label*="E4 doomed"]')
    await pg.click('.mine button:has-text("Delete")')
    await pg.wait_for_timeout(300)
    check('E4 doomed' not in await pg.locator('.side').inner_text(), 'route still listed')


async def E5(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await finish_with_name(pg, 'E5 first')
    await side(pg)
    await pg.click('.newb')
    check(await markers(pg) == 0 and await pg.get_attribute('.title', 'placeholder') == 'New route', 'not a new route')
    # elsewhere than the first one: right after New the old line may still be drawn there,
    # and a click on a route line does not add a point
    await draw(pg, [(0.3, 0.75), (0.75, 0.3)])
    await side(pg)
    await pg.click('.logobtn' if await pg.locator('.logobtn').first.is_visible() else '.newb')  # unnamed: asks for a name first (no logo on a phone)
    await pg.wait_for_selector('dialog.named[open]', timeout=5000)
    await pg.fill('#nk-name', 'E5 second')
    await pg.keyboard.press('Enter')
    await pg.wait_for_timeout(500)
    await open_mine(pg)
    mine = await pg.locator('.mine').inner_text()
    check('E5 first' in mine and 'E5 second' in mine and await markers(pg) == 0, f'list: {mine[:160]!r}')


# ---------- F. Import, export, share ----------
async def F1(ctx):
    pg = await open_app(ctx)
    await pg.set_input_files('input[type=file]', GPX)
    await side(pg)
    await pg.wait_for_selector('.mine .trk', timeout=60000)
    check('km' in await pg.locator('.mine .trk').inner_text(), 'no track length')


async def F2(ctx):
    pg = await open_app(ctx, 'm=12/47.15/10.49&l=Co')
    await pg.set_input_files('input[type=file]', GPX)
    await side(pg)
    await pg.wait_for_selector('.mine .trk .name', timeout=60000)
    await side(pg)
    await pg.click('.mine .trk .name')
    await pg.wait_for_selector('.prof', timeout=90000)
    await settle(pg)
    kind = await pg.evaluate("[...document.querySelectorAll('input[name=kind]')].find(i=>i.checked)?.closest('label')?.textContent?.trim()")
    check(kind == 'Hike', f'type {kind}, expected Hike')
    s = await pg.locator('.sum').inner_text()
    up = int(re.search(r'↑\s*(\d+)', s).group(1))
    check(600 < up < 800 and 10 < await km(pg) < 13, f'not the track: {s[:100]!r}')
    check(re.search(r'Trail\s*\d+%', s.replace('\n', ' ')), 'no surfaces from the map')
    await open_mine(pg)
    n = await pg.locator('.mine .item:not(.trk)').count()
    await side(pg)
    await pg.click('.mine .trk .name')
    await pg.wait_for_timeout(1500)
    check(await pg.locator('.mine .item:not(.trk)').count() == n, 'a second copy was made')


async def F3(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await pg.keyboard.press('Escape')
    await pg.wait_for_selector('dialog.named[open]')
    await pg.fill('#nk-name', 'F3 export')
    await pg.keyboard.press('Enter')
    await pg.wait_for_timeout(800)
    await side(pg)
    async with pg.expect_download(timeout=20000) as d:
        await pg.click('.garmin')  # Download GPX
    path = await (await d.value).path()
    text = open(path, encoding='utf-8').read()
    check('<gpx' in text and 'F3 export' in text and '<ele>' in text and text.count('<trkpt') > 5, 'GPX content')


async def F4(ctx):
    pg = await open_app(ctx)
    await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    await draw(pg, TWO)
    await finish_with_name(pg, 'F4 shared')
    one = await km(pg)
    await side(pg)
    await pg.click('button:has-text("Copy link")')
    await pg.wait_for_timeout(2500)
    url = await pg.evaluate('navigator.clipboard.readText()')
    check('#s=' in url or '&r=' in url, f'no link copied: {url!r}')
    other = await ctx.browser.new_context(viewport={'width': 1280, 'height': 800})
    await prepare(other)
    p2 = await other.new_page()
    await p2.goto(BASE + '#' + url.split('#', 1)[1])  # the link's state, on the server under test
    await p2.wait_for_selector('.wp', timeout=30000)
    await settle(p2)
    check(abs(await km(p2) - one) < 0.15, 'recipient sees another route')
    await other.close()


async def F5(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await finish_with_name(pg, 'F5')
    await side(pg)
    await pg.click('button:has-text("Garmin")')
    await pg.wait_for_timeout(800)
    check('log' in (await pg.locator('dialog.garmin').inner_text()).lower(), 'Garmin dialog does not ask to log in')


# ---------- G. Help ----------
async def G1(ctx):
    pg = await open_app(ctx)
    await pg.keyboard.press('?')
    await pg.wait_for_selector('dialog.help[open]')
    txt = await pg.locator('dialog.help').inner_text()
    check('Flat or 3D map' in txt and 'Turn the 3D map' in txt, 'shortcut list incomplete')
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(300)
    check(await pg.locator('dialog.help[open]').count() == 0, 'Esc did not close help')


async def G2(ctx):
    pg = await open_app(ctx)
    await draw(pg, TWO)
    await finish_with_name(pg, 'G2 early')
    await side(pg)
    await pg.click('.newb')
    # base map tiles that never answer: the map does not finish loading
    await ctx.route(re.compile(r'tile-cyclosm|tile\.openstreetmap'), lambda route: None)
    await pg.reload()
    await pg.wait_for_timeout(2500)
    await open_mine(pg)
    check('G2 early' in await pg.locator('.side').inner_text(), 'list waits for the map')
    await ctx.unroute_all(behavior='ignoreErrors')


async def G3(ctx):
    """Cookie banner (needs a fresh context without the pre-set answer) and the account menu links."""
    await ctx.route(re.compile(r'googletagmanager|google-analytics'), lambda r: r.abort())
    pg = await ctx.new_page()
    await pg.goto(BASE + '#' + SINTRA)
    await pg.wait_for_selector('.maplibregl-canvas')
    await pg.wait_for_selector('.cb', timeout=10000)
    txt = await pg.locator('.cb').inner_text()
    check('Allow' in txt and 'No cookies' in txt, f'banner buttons: {txt[:80]!r}')
    box = await pg.locator('.cb').bounding_box()
    vp = pg.viewport_size
    check(box['x'] >= 0 and box['x'] + box['width'] <= vp['width'] + 1 and box['y'] + box['height'] <= vp['height'] + 1, f'banner outside the screen: {box}')
    await pg.click('.cb button:has-text("No cookies")')
    await pg.wait_for_timeout(500)
    check(await pg.locator('.cb').count() == 0, 'banner stays after the answer')
    check(await pg.evaluate("localStorage.getItem('nm-consent')") == 'denied', 'answer not stored')
    await pg.reload()
    await pg.wait_for_selector('.maplibregl-canvas')
    await pg.wait_for_timeout(1500)
    check(await pg.locator('.cb').count() == 0, 'banner returns after reload')
    await side(pg)
    await pg.click('button.user')
    menu = await pg.locator('body').inner_text()
    for link in ('Terms of use', 'Privacy', 'Cookie settings'):
        check(await pg.get_by_text(link, exact=True).count() >= 1, f'account menu has no "{link}"')


async def G4(ctx):
    """Map controls: one block with 2D/3D, zoom and Find my location at the bottom."""
    pg = await open_app(ctx)
    await mapview(pg)
    names = await pg.evaluate("[...document.querySelectorAll('.orbit button')].map(b => b.getAttribute('aria-label') || b.textContent.trim())")
    check(names[-1] == 'Find my location', f'Find my location is not last: {names}')
    for n in ('2D', '3D', 'Zoom in', 'Zoom out'):
        check(n in names, f'{n} missing from the control block: {names}')
    box = await pg.locator('.orbit').bounding_box()
    vp = pg.viewport_size
    check(box['x'] + box['width'] > vp['width'] * 0.6, f'control block is not on the right: {box}')


# ---------- H. Phone ----------
async def phone(browser):
    return await new_context(browser, 'phone')


async def H1(ctx):
    pg = await open_app(ctx)
    g = pg.locator('.grab')
    before = await g.get_attribute('aria-expanded')
    await g.tap()
    await pg.wait_for_timeout(500)
    check(await g.get_attribute('aria-expanded') != before, 'sheet did not toggle')


async def H2(ctx):
    pg = await open_app(ctx, storage={'nk-3d': '1'})
    await pg.wait_for_selector('.orbit .compass')
    bad = await pg.evaluate("""[...document.querySelectorAll('.tb,.layersbtn,.dim button,.orbit button,.maplibregl-ctrl button')]
      .filter(b => { const r = b.getBoundingClientRect(); if (!r.width) return false;
        const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(e === b || b.contains(e)) })
      .map(b => b.getAttribute('aria-label') || b.textContent.trim())""")
    check(not bad, f'covered: {bad}')


async def H3(ctx):
    if not is_phone(profile_of(ctx)):
        raise NA('touch gestures need a phone profile')
    pg = await open_app(ctx)
    await pg.locator('.tb').first.tap()  # editing on
    for fx, fy in [(0.3, 0.3), (0.7, 0.5)]:
        x, y = await canvas_xy(pg, fx, fy)
        await pg.touchscreen.tap(x, y)
        await pg.wait_for_timeout(500)
    await settle(pg)
    check(await markers(pg) == 2, f'{await markers(pg)} points after two taps')


CASES = {
    'A1': 'Draw a route', 'A2': 'Move a point', 'A3': 'Insert a point', 'A4': 'Remove points', 'A5': 'Undo and redo',
    'A6': 'Reverse', 'A7': 'Out and back, back to start', 'A8': 'Straight segments', 'A9': 'Checkpoint',
    'A10': 'Too long leg', 'A11': 'Name a finished route', 'A12': 'Waypoint menu',
    'B1': 'Route type', 'B2': 'Surface, climbs', 'B3': 'Hiking paths and preferences', 'B4': 'What the route may use',
    'C1': 'Summary', 'C2': 'Elevation profile', 'C3': 'Timeline views', 'C4': 'Grade colours by type',
    'D1': 'Base map', 'D2': 'Line colours', 'D3': '3D',
    'E1': 'Keep routes', 'E2': 'My routes', 'E3': 'Rename', 'E4': 'Delete', 'E5': 'Start a new route',
    'F1': 'Import a GPX', 'F2': 'Track as a route', 'F3': 'Export GPX', 'F4': 'Share a link', 'F5': 'Send to Garmin',
    'G1': 'Help', 'G2': 'Lists without the map', 'G3': 'Cookies and account menu', 'G4': 'Map controls',
    'H1': 'Bottom sheet', 'H2': 'Everything tappable', 'H3': 'Draw on a phone',
}
PHONE_ONLY = {'H1'}  # the bottom sheet exists only on phones


async def main(only):
    names = list(PROFILES) if VIEWPORT == 'all' else [v.strip() for v in VIEWPORT.split(',')]
    results = {}  # (case, profile) -> (res, note, dt)
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for prof in names:
            for cid, title in CASES.items():
                if only and cid not in only:
                    continue
                if cid in PHONE_ONLY and not is_phone(prof):
                    results[cid, prof] = ('n/a', 'phone-only case', 0)
                    print(f'{cid:4} n/a   {prof:13} phone-only case', flush=True)
                    continue
                ctx = await new_context(browser, prof)
                t0 = time.time()
                try:
                    await asyncio.wait_for(globals()[cid](ctx), timeout=180)
                    res = ('pass', '')
                except NA as e:
                    res = ('n/a', str(e))
                except Fail as e:
                    res = ('FAIL', str(e))
                except Exception as e:  # a broken step, not a verdict about the app
                    res = ('ERROR', f'{type(e).__name__}: {str(e).splitlines()[0][:160]}')
                if res[0] in ('FAIL', 'ERROR'):
                    for i, pg in enumerate(ctx.pages):
                        await pg.screenshot(path=str(OUT / f'{cid}-{prof}-{i}.png'))
                await ctx.close()
                dt = time.time() - t0
                results[cid, prof] = (*res, dt)
                print(f'{cid:4} {res[0]:5} {prof:13} {dt:5.1f}s  {title}  {res[1]}', flush=True)
        await browser.close()
    lines = [f'# Use case run, {time.strftime("%Y-%m-%d %H:%M")}', '',
             f'Against {BASE}. Profiles: ' + ', '.join(f'{n} {PROFILES[n]["viewport"]["width"]}x{PROFILES[n]["viewport"]["height"]}' for n in names)
             + '. Cases: docs/use-cases.md; script: tools/e2e/usecases.py.', '',
             '| Id | Use case | ' + ' | '.join(names) + ' |', '|---|---|' + '---|' * len(names)]
    for cid, title in CASES.items():
        cells = []
        for n in names:
            r = results.get((cid, n))
            cells.append('' if not r else r[0] if r[0] == 'pass' else f'{r[0]}: {r[1]}'.replace('|', '/'))
        if any(cells):
            lines.append(f'| {cid} | {title} | ' + ' | '.join(cells) + ' |')
    pathlib.Path(os.environ.get('REPORT', ROOT / 'docs/use-cases-run.md')).write_text('\n'.join(lines) + '\n')
    allr = [r for r in results.values()]
    print(f'\n{sum(r[0] == "pass" for r in allr)}/{len(allr)} passed, {sum(r[0] == "n/a" for r in allr)} n/a; docs/use-cases-run.md')


if __name__ == '__main__':
    asyncio.run(main(set(sys.argv[1:])))

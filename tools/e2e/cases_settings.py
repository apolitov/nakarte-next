#!/usr/bin/env python3
"""End-to-end checks of the route SETTINGS panel (surface, climbs, big roads, steepness, heatmap,
cycleways, "May use", hiking options, (?) notes, notches, summary, layout, persistence).

  BASE=https://alexe.pt/maps/ python3 tools/e2e/cases_settings.py          # all cases
  python3 tools/e2e/cases_settings.py S1 S5                                # only these

Expectations come from src/lib/brouter.ts (optionsToParams, fetchLeg), src/App.svelte (optSummary)
and src/ui/RouteSettings.svelte. A case that disagrees with the code is a FAIL (app bug), a broken
step is an ERROR. Failures are screenshotted to OUT. Needs Python Playwright with Chromium.
"""
import asyncio, os, re, sys, time, pathlib
from urllib.parse import urlsplit, unquote
from playwright.async_api import async_playwright, Page, BrowserContext, Locator

os.environ.setdefault('BASE', 'https://alexe.pt/maps/')
os.environ.setdefault('OUT', '/tmp/nk-e2e-settings')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import usecases as U  # noqa: E402
from usecases import Fail, check, settle  # noqa: E402

OUT = pathlib.Path(os.environ['OUT'])
OUT.mkdir(parents=True, exist_ok=True)
HASH = 'm=14/38.80/-9.39'
PTS = [(0.30, 0.30), (0.70, 0.65)]  # ~3-4 km apart at z14
# screen profiles: name -> (width, height, phone)
VIEWPORTS = {n: (c['viewport']['width'], c['viewport']['height'], bool(c.get('is_mobile'))) for n, c in U.PROFILES.items()}
CUR = {'vp': 'desktop'}
_orig_click = Locator.click


def mobile() -> bool:
    return VIEWPORTS[CUR['vp']][2]


async def _tap_click(self, **kw):
    return await self.tap(**{k: v for k, v in kw.items() if k in ('timeout', 'force', 'position', 'trial')})


# ---------- helpers ----------
async def new_ctx(browser) -> BrowserContext:
    w, h, ph = VIEWPORTS[CUR['vp']]
    ctx = await browser.new_context(viewport={'width': w, 'height': h}, **(dict(is_mobile=True, has_touch=True) if ph else {}))
    await ctx.route(re.compile(r'googletagmanager|google-analytics'), lambda r: r.abort())
    await ctx.add_init_script("try{localStorage.setItem('nm-consent','denied')}catch(e){}")
    return ctx


def prm(url: str) -> dict:
    """profile parameters of a router request, plus _alt (alternativeidx)"""
    d = {}
    for kv in urlsplit(url).query.split('&'):
        k, _, v = unquote(kv).partition('=')
        if k.startswith('profile:'):
            d[k[8:]] = v
        elif k == 'alternativeidx':
            d['_alt'] = v
    return d


async def sheet(pg: Page):
    """Phone: the settings live in the bottom sheet; opens it by its handle."""
    if mobile():
        g = pg.locator('.grab')
        if await g.get_attribute('aria-expanded') != 'true':
            await g.tap()
            await pg.wait_for_timeout(500)


async def open_settings(pg: Page):
    await sheet(pg)
    await U.open_settings(pg)


async def draw(pg: Page, pts):
    if not mobile():
        return await U.draw(pg, pts)
    await U.ensure_editing(pg)
    for fx, fy in [(0.3, 0.2), (0.7, 0.45)]:
        x, y = await U.canvas_xy(pg, fx, fy)
        await pg.touchscreen.tap(x, y)
        await pg.wait_for_timeout(500)
    await settle(pg)


async def start(ctx, profile: str | None = None, route=True) -> Page:
    pg = await U.open_app(ctx, HASH.replace('14/', '13/') if mobile() else HASH)
    if profile:
        await pick_profile(pg, profile)
    if route:
        await draw(pg, PTS)
        check(await pg.locator('.wp').count() == 2, 'two waypoints expected')
    return pg


async def pick_profile(pg: Page, name: str):
    n0 = len(pg.route_urls)
    cur = await pg.locator('[role=radiogroup][aria-label="Route type"] input:checked + span').inner_text()
    if cur.strip() == name:
        return
    await sheet(pg)
    await pg.locator('[role=radiogroup][aria-label="Route type"] label', has_text=re.compile(rf'^\s*{name}\s*$')).click()
    await pg.wait_for_timeout(400)
    if pg.route_urls[n0:] or await pg.locator('.wp').count():
        await settle(pg)


async def change(pg: Page, action, expect=True, timeout=25):
    """Runs the action, waits for the router requests it causes and for routing to finish."""
    n0 = len(pg.route_urls)
    await action()
    t0 = time.time()
    while expect and len(pg.route_urls) == n0 and time.time() - t0 < timeout:
        await pg.wait_for_timeout(200)
    if expect:
        check(len(pg.route_urls) > n0, 'no router request after the change')
    else:
        await pg.wait_for_timeout(800)
    await settle(pg)
    return pg.route_urls[n0:]


async def set_range(pg: Page, id_: str, v, commit=True):
    await pg.evaluate("([id,v])=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))}", [id_, str(v)])
    if commit:
        await pg.evaluate("(id)=>document.getElementById(id).dispatchEvent(new Event('change',{bubbles:true}))", id_)


async def out(pg: Page, id_: str):
    o = pg.locator(f'output[for={id_}]')
    cls = (await o.get_attribute('class')) or ''
    return (await o.inner_text()).strip(), bool(re.search(r'\bon\b', cls))


async def summary(pg: Page) -> str:
    return (await pg.locator('.fh', has_text=re.compile(r'^\s*Settings')).locator('.fs').inner_text()).strip()


def has(d: dict, **kv):
    for k, v in kv.items():
        check(d.get(k) == str(v), f'{k}: expected {v}, got {d.get(k)} in {d}')


def lacks(d: dict, *keys):
    for k in keys:
        check(k not in d, f'{k} must not be sent, got {d}')


async def switch(pg: Page, text: str):
    await pg.locator('label.sw', has_text=text).click()


async def cyc(pg: Page, text: str):
    """Cycleways control: Ignore / Prefer / Stick to"""
    await pg.get_by_role('radiogroup', name='Cycleways').locator('label', has_text=text).click()


def cyc_on(pg: Page, text: str):
    return pg.get_by_role('radiogroup', name='Cycleways').locator('label', has_text=text).locator('input').is_checked()


async def allow_box(pg: Page, text: str):
    return pg.locator('ul.allow label', has_text=re.compile(rf'^\s*{text}'))


# ---------- cases ----------
async def S1(ctx):
    pg = await start(ctx, 'Gravel')
    await open_settings(pg)
    labels = {-2: 'Asphalt only', -1: 'Mostly asphalt', 0: 'Gravel default', 1: 'Mostly dirt', 2: 'Trails'}
    # labels and highlighting at every position (input event only)
    for v, lab in labels.items():
        await set_range(pg, 'nk-surf', v, commit=False)
        text, on = await out(pg, 'nk-surf')
        check(text == lab, f'position {v}: label {text!r}, expected {lab!r}')
        check(on == (v != 0), f'position {v}: highlighted={on}')
    await set_range(pg, 'nk-surf', 0, commit=False)
    # params of each non-default position (new params each time, so no cache)
    exp = {
        1: dict(nk_surface=1),
        2: dict(nk_surface=1, nk_surf_k=5, nk_cycle_pen=1),
        -1: dict(nk_surface=-1, nk_cycle_pen=1.4),
        -2: dict(nk_surface=-1, nk_surf_k=6, nk_cycle_pen=1.2),
    }
    for v, e in exp.items():
        reqs = await change(pg, lambda: set_range(pg, 'nk-surf', v))
        d = prm(reqs[-1])
        has(d, **e)
        for k in ('nk_surface', 'nk_surf_k', 'nk_cycle_pen'):
            if k not in e:
                lacks(d, k)
        text, on = await out(pg, 'nk-surf')
        check(text == labels[v] and on, f'after change {v}: {text!r} on={on}')
    # back to default: grey, no surface params in any new request
    reqs = await change(pg, lambda: set_range(pg, 'nk-surf', 0), expect=False)
    for u in reqs:
        lacks(prm(u), 'nk_surface', 'nk_surf_k')
    text, on = await out(pg, 'nk-surf')
    check(text == 'Gravel default' and not on, f'default: {text!r} on={on}')


async def S2(ctx):
    pg = await start(ctx, 'Gravel')
    await open_settings(pg)
    labels = {0: 'Avoid climbs', 1: 'Fewer climbs', 2: 'Gravel default', 3: 'Climbs welcome', 4: 'Seek climbs'}
    for v, lab in labels.items():
        await set_range(pg, 'nk-climbs', v, commit=False)
        text, on = await out(pg, 'nk-climbs')
        check(text == lab, f'position {v}: label {text!r}, expected {lab!r}')
        check(on == (v != 2), f'position {v}: highlighted={on}')
    tip = await pg.locator('output[for=nk-climbs]').get_attribute('title')
    check(tip and 'Pogačar' in tip, f'seek label tooltip: {tip!r}')
    await set_range(pg, 'nk-climbs', 2, commit=False)
    exp = {0: dict(nk_uphillcost=300, nk_uphillcutoff=1), 1: dict(nk_uphillcost=120, nk_uphillcutoff=1.5), 3: dict(nk_uphillcost=0)}
    for v, e in exp.items():
        reqs = await change(pg, lambda: set_range(pg, 'nk-climbs', v))
        d = prm(reqs[-1])
        has(d, **e)
        if 'nk_uphillcutoff' not in e:
            lacks(d, 'nk_uphillcutoff')
        lacks(d, 'nk_seek')
    reqs = await change(pg, lambda: set_range(pg, 'nk-climbs', 4))
    alts = sorted(prm(u)['_alt'] for u in reqs)
    check(alts == ['0', '1', '2', '3'], f'seek must request 4 alternatives, got {alts}')
    for u in reqs:
        has(prm(u), nk_uphillcost=0)
        lacks(prm(u), 'nk_seek')
    text, on = await out(pg, 'nk-climbs')
    check(text == 'Seek climbs' and on, f'seek: {text!r} on={on}')
    reqs = await change(pg, lambda: set_range(pg, 'nk-climbs', 2), expect=False)
    for u in reqs:
        lacks(prm(u), 'nk_uphillcost')
    text, on = await out(pg, 'nk-climbs')
    check(text == 'Gravel default' and not on, f'default: {text!r} on={on}')


async def S3(ctx):
    pg = await start(ctx, 'Road')
    await open_settings(pg)
    labels = {0: 'Avoid big roads', 1: 'Fewer big roads', 2: 'Road default', 3: 'Big roads OK'}
    for v, lab in labels.items():
        await set_range(pg, 'nk-big', v, commit=False)
        text, on = await out(pg, 'nk-big')
        check(text == lab, f'position {v}: label {text!r}, expected {lab!r}')
        check(on == (v != 2), f'position {v}: highlighted={on}')
    await set_range(pg, 'nk-big', 2, commit=False)
    for v, k in {0: '4', 1: '2', 3: '0.3'}.items():
        reqs = await change(pg, lambda: set_range(pg, 'nk-big', v))
        has(prm(reqs[-1]), nk_big=k)
    reqs = await change(pg, lambda: set_range(pg, 'nk-big', 2), expect=False)
    for u in reqs:
        lacks(prm(u), 'nk_big')
    # not offered for walking
    await pick_profile(pg, 'Hike')
    await open_settings(pg)
    check(await pg.locator('#nk-big').count() == 0, 'Big roads slider must be hidden for Hike')
    check(await pg.locator('#nk-surf').count() == 1, 'Surface slider stays for Hike')
    await pick_profile(pg, 'MTB')
    await open_settings(pg)
    check(await pg.locator('#nk-big').count() == 1, 'Big roads slider expected for MTB')


async def S4(ctx):
    pg = await start(ctx, 'Gravel')
    await open_settings(pg)
    text, on = await out(pg, 'nk-steep')
    check(text == 'No limit' and not on, f'initial: {text!r} on={on}')
    await set_range(pg, 'nk-steep', 8, commit=False)
    text, on = await out(pg, 'nk-steep')
    check(text == '8%' and on, f'8%: {text!r} on={on}')
    await set_range(pg, 'nk-steep', 0, commit=False)
    reqs = await change(pg, lambda: set_range(pg, 'nk-steep', 8))
    has(prm(reqs[-1]), nk_uphillcutoff=8, nk_uphillcost=600)
    check(await pg.locator('#nk-climbs').is_disabled(), 'Climbs slider must be disabled while a limit is set')
    s = await summary(pg)
    check('up to 8%' in s, f'summary: {s!r}')
    reqs = await change(pg, lambda: set_range(pg, 'nk-steep', 0), expect=False)
    for u in reqs:
        lacks(prm(u), 'nk_uphillcutoff')
    text, on = await out(pg, 'nk-steep')
    check(text == 'No limit' and not on, f'reset: {text!r} on={on}')
    check(not await pg.locator('#nk-climbs').is_disabled(), 'Climbs slider must be enabled again')


async def S5(ctx):
    pg = await start(ctx, 'Gravel')
    await open_settings(pg)
    reqs = await change(pg, lambda: switch(pg, 'Stick to the heatmap'))
    ds = [prm(u) for u in reqs]
    check(len(ds) == 4, f'heatmap: 4 candidates expected, got {len(ds)}')
    plain = sorted(d['_alt'] for d in ds if 'nk_heat_cap' not in d)
    capped = sorted(d['_alt'] for d in ds if d.get('nk_heat_cap') == '1.6')
    check(plain == ['0', '1'], f'plain candidates {plain}')
    check(capped == ['0', '1'], f'capped (nk_heat_cap=1.6) candidates {capped}')
    for d in ds:
        lacks(d, 'nk_heat')
    check('heatmap' in await summary(pg), f'summary: {await summary(pg)!r}')
    # together with "Seek climbs": 4 plain alternatives + 2 capped
    reqs = await change(pg, lambda: set_range(pg, 'nk-climbs', 4))
    ds = [prm(u) for u in reqs]
    plain = sorted(d['_alt'] for d in ds if 'nk_heat_cap' not in d)
    capped = sorted(d['_alt'] for d in ds if d.get('nk_heat_cap') == '1.6')
    check(plain == ['0', '1', '2', '3'] and capped == ['0', '1'], f'heat+seek: plain {plain}, capped {capped}')
    await switch(pg, 'Stick to the heatmap')
    await settle(pg)
    check('heatmap' not in await summary(pg), 'heatmap still in the summary after switching it off')


async def S6(ctx):
    pg = await start(ctx, 'Gravel')
    await open_settings(pg)
    check(await cyc_on(pg, 'Prefer'), 'cycleways expected on Prefer by default')
    # Stick to: nk_cycle=2 and "cycleways only" in the summary
    d = prm((await change(pg, lambda: cyc(pg, 'Stick to')))[-1])
    has(d, nk_cycle=2)
    check('cycleways only' in await summary(pg), f'summary: {await summary(pg)!r}')
    await change(pg, lambda: cyc(pg, 'Prefer'), expect=False)
    # surface -1 sends nk_cycle_pen; cycleways off must replace it with nk_cycle=0
    await change(pg, lambda: set_range(pg, 'nk-surf', -1))
    reqs = await change(pg, lambda: cyc(pg, 'Ignore'))
    d = prm(reqs[-1])
    has(d, nk_cycle=0, nk_surface=-1)
    lacks(d, 'nk_cycle_pen')
    check('cycleways off' in await summary(pg), f'summary: {await summary(pg)!r}')
    await change(pg, lambda: set_range(pg, 'nk-surf', 0), expect=False)
    # "May use": gravel offers four
    names = ['Steps', 'Ferries', 'Main roads', 'Footpaths']
    check(await pg.locator('ul.allow li').count() == 4, f'gravel: 4 "May use" boxes, got {await pg.locator("ul.allow li").count()}')
    check(await pg.locator('ul.allow label', has_text=re.compile(r'^\s*Unpaved')).count() == 0, 'Unpaved is road-only')
    keys = dict(zip(names, ['steps', 'ferry', 'busy', 'paths']))
    seen = {}
    for nm in names:
        box = await allow_box(pg, nm)
        check(await box.locator('input').is_checked(), f'{nm} expected ticked by default')
        reqs = await change(pg, lambda: box.click())
        seen[keys[nm]] = '0'
        d = prm(reqs[-1])
        has(d, **{f'nk_allow_{k}': v for k, v in seen.items()})
    s = await summary(pg)
    check(s.count('no ') >= 1 and 'steps' in s and 'ferries' in s, f'summary: {s!r}')
    # tick one again: its restriction disappears
    box = await allow_box(pg, 'Steps')
    reqs = await change(pg, lambda: box.click())
    lacks(prm(reqs[-1]), 'nk_allow_steps')
    # which switches and boxes each type offers
    for prof, boxes, want in [('Road', 5, True), ('MTB', 3, False), ('Hike', 3, False)]:
        await pick_profile(pg, prof)
        await open_settings(pg)
        n = await pg.locator('ul.allow li').count()
        check(n == boxes, f'{prof}: {boxes} "May use" boxes expected, got {n}')
        c = await pg.get_by_role('radiogroup', name='Cycleways').count()
        check(bool(c) == want, f'{prof}: cycleways control present={bool(c)}, expected {want}')
        h = await pg.locator('label.sw', has_text='Stick to the heatmap').count()
        check(bool(h) == want, f'{prof}: heatmap switch present={bool(h)}, expected {want}')


async def S7(ctx):
    pg = await start(ctx, 'Hike')
    await open_settings(pg)
    check(await pg.locator('#nk-big').count() == 0, 'no Big roads slider for Hike')
    seg = pg.locator('[role=radiogroup][aria-label="Paths up to"] label')
    check([x.strip() for x in await seg.all_inner_texts()] == ['T2', 'T3', 'T4', 'T5–T6'], f'SAC steps: {await seg.all_inner_texts()}')
    check(await pg.locator('[role=radiogroup][aria-label="Paths up to"] input:checked + span').inner_text() == 'T3', 'T3 is the default')
    hint0 = await pg.locator('p.hint').inner_text()
    check('Default' in hint0, f'T3 hint: {hint0!r}')
    for txt, v in [('T2', '2'), ('T4', '4'), ('T5–T6', '6')]:
        reqs = await change(pg, lambda: seg.filter(has_text=re.compile(rf'^\s*{txt}\s*$')).click())
        has(prm(reqs[-1]), SAC_scale_limit=v)
        h = await pg.locator('p.hint').inner_text()
        check(h != hint0, f'hint did not change for {txt}')
        hint0 = h
    check('paths up to T6' in await summary(pg), f'summary: {await summary(pg)!r}')
    reqs = await change(pg, lambda: seg.filter(has_text=re.compile(r'^\s*T3\s*$')).click(), expect=False)
    for u in reqs:
        lacks(prm(u), 'SAC_scale_limit')
    reqs = await change(pg, lambda: switch(pg, 'Signed hiking routes'))
    has(prm(reqs[-1]), hiking_routes_preference=1)
    reqs = await change(pg, lambda: switch(pg, 'Forest and water'))
    has(prm(reqs[-1]), hiking_routes_preference=1, consider_forest=1, consider_river=1)
    reqs = await change(pg, lambda: switch(pg, 'Quiet'))
    has(prm(reqs[-1]), consider_noise=1, consider_town=1, consider_forest=1, consider_river=1)
    s = await summary(pg)
    for w in ('signed routes', 'forest and water', 'quiet'):
        check(w in s, f'summary lacks {w!r}: {s!r}')
    reqs = await change(pg, lambda: switch(pg, 'Quiet'), expect=False)  # same options as before: cached
    for u in reqs:
        lacks(prm(u), 'consider_noise', 'consider_town')
    check(not await pg.locator('label.sw', has_text='Quiet').locator('input').is_checked(), 'Quiet still on')
    check('quiet' not in await summary(pg), f'summary: {await summary(pg)!r}')


async def S8(ctx):
    pg = await start(ctx, None, route=False)
    await open_settings(pg)
    q = {n: pg.get_by_role('button', name=f'How {n} works') for n in ('Surface', 'Climbs', 'Big roads')}
    pop = pg.locator('.pop')
    bold = {'Surface': ['Mostly asphalt or Mostly dirt', 'Asphalt only or Trails'],
            'Climbs': ['Avoid climbs', 'Fewer climbs', 'Climbs welcome', 'Seek climbs'],
            'Big roads': ['Avoid big roads', 'Fewer big roads', 'Big roads OK']}
    for n, b in q.items():
        check(await b.count() == 1, f'(?) button for {n} missing')
    for n, b in q.items():
        await b.click()
        check(await pop.count() == 1 and await b.get_attribute('aria-expanded') == 'true', f'{n}: note did not open')
        lines = await pop.locator('.ln').count()
        bolds = [x.strip() for x in await pop.locator('.ln b').all_inner_texts()]
        check(bolds == bold[n], f'{n}: bold step names {bolds}, expected {bold[n]}')
        check(lines > len(bolds) >= 1, f'{n}: {lines} lines, {len(bolds)} bold')
        first_b = await pop.locator('.ln').first.locator('b').count()
        check(first_b == 0, f'{n}: the first line must not have a bold step')
        w = await pop.locator('.ln b').first.evaluate('e=>getComputedStyle(e).fontWeight')
        check(int(w) >= 600, f'{n}: bold weight {w}')
        bb, side = await pop.bounding_box(), await pg.locator('aside.side').bounding_box()
        check(bb['x'] >= side['x'] - 1 and bb['x'] + bb['width'] <= side['x'] + side['width'] + 1, f'{n}: note sticks out of the panel {bb} vs {side}')
        # one at a time: opening the next closes this one
        # a note opens over the rows below it, so the next (?) is clicked for real only when it is
        # above; for Surface the others are covered and get a click event instead
        order = ['Surface', 'Climbs', 'Big roads']
        i = order.index(n)
        nxt = order[i - 1] if i else 'Big roads'
        if i:
            await q[nxt].click()
        else:
            await q[nxt].dispatch_event('click')
        check(await pop.count() == 1, f'{n}->{nxt}: {await pop.count()} notes open at once')
        check(await b.get_attribute('aria-expanded') == 'false', f'{n}: still expanded after opening {nxt}')
        await pg.keyboard.press('Escape')
        check(await pop.count() == 0, f'{nxt}: Esc did not close the note')
    # click again toggles
    await q['Surface'].click()
    await q['Surface'].click()
    check(await pop.count() == 0, 'second click on (?) must close the note')
    # outside click closes
    await q['Climbs'].click()
    check(await pop.count() == 1, 'note did not open')
    if mobile():
        await pg.touchscreen.tap(190, 60)
    else:
        await pg.mouse.click(5, 400)
    await pg.wait_for_timeout(200)
    check(await pop.count() == 0, 'outside click did not close the note')
    await q['Big roads'].click()
    await pg.locator('aside.side .fh', has_text=re.compile(r'^\s*Settings')).locator('.fl').click()  # fold header, outside the box
    await pg.wait_for_timeout(200)
    check(await pop.count() == 0, 'note stayed after clicking elsewhere in the panel')


async def S9(ctx):
    pg = await start(ctx, 'Gravel', route=False)
    await open_settings(pg)
    exp = {'nk-surf': 5, 'nk-climbs': 5, 'nk-big': 4}
    for id_, n in exp.items():
        tk = pg.locator(f'#{id_} + .tk')
        check(await tk.count() == 1, f'{id_}: no notch row after the slider')
        ticks = tk.locator('i')
        check(await ticks.count() == n, f'{id_}: {await ticks.count()} notches, expected {n} positions')
        check(int(await pg.locator(f'#{id_}').get_attribute('max')) - int(await pg.locator(f'#{id_}').get_attribute('min')) + 1 == n, f'{id_}: positions differ from notches')
        dark = await tk.locator('i.d').count()
        check(dark == 1, f'{id_}: {dark} default notches')
        idx = await ticks.evaluate_all('els=>els.findIndex(e=>e.classList.contains("d"))')
        check(idx == 2, f'{id_}: default notch at {idx}, expected 2 (the middle position)')
        styles = await ticks.evaluate_all('els=>els.map(e=>{const s=getComputedStyle(e);return [parseFloat(s.height),s.backgroundColor]})')
        check(styles[2][0] > styles[0][0], f'{id_}: default notch not taller {styles}')
        check(styles[2][1] != styles[0][1], f'{id_}: default notch colour equals the others {styles}')
        m = re.findall(r'[\d.]+', styles[0][1])
        mm = re.findall(r'[\d.]+', styles[2][1])
        a0 = float(m[3]) if len(m) > 3 else 1
        a2 = float(mm[3]) if len(mm) > 3 else 1
        check(a2 > a0, f'{id_}: default notch must be more opaque: {styles}')
    await pick_profile(pg, 'Hike')
    await open_settings(pg)
    check(await pg.locator('.tk').count() == 2, f'Hike: 2 notch rows expected, got {await pg.locator(".tk").count()}')


async def S10(ctx):
    pg = await start(ctx, None, route=False)
    # nothing changed: "<Type> defaults" for every type (also with Settings closed)
    for prof in ('Gravel', 'Road', 'MTB', 'Hike'):
        await pick_profile(pg, prof)
        s = await summary(pg)
        check(s == f'{prof} defaults', f'{prof}: summary {s!r}')
    await pick_profile(pg, 'Gravel')
    await draw(pg, PTS)
    await open_settings(pg)
    await change(pg, lambda: set_range(pg, 'nk-surf', -1))
    check(await summary(pg) == 'more asphalt', f'summary: {await summary(pg)!r}')
    await change(pg, lambda: set_range(pg, 'nk-climbs', 0))
    await change(pg, lambda: set_range(pg, 'nk-big', 0))
    await change(pg, lambda: cyc(pg, 'Ignore'))
    box = await allow_box(pg, 'Steps')
    await change(pg, lambda: box.click())
    exp = 'more asphalt · avoid climbs · no big roads · cycleways off · no steps'
    s = await summary(pg)
    check(s == exp, f'summary {s!r}, expected {exp!r}')
    for forbid in ('default', 'Gravel'):
        check(forbid not in s, f'summary still mentions {forbid!r}')
    # collapsed: the same text stays in the fold header
    await pg.locator('.fh', has_text=re.compile(r'^\s*Settings')).click()
    await pg.wait_for_timeout(200)
    check(await pg.locator('#nk-surf').count() == 0, 'Settings did not collapse')
    check(await summary(pg) == exp, f'collapsed summary: {await summary(pg)!r}')
    # all changes undone: back to defaults
    await open_settings(pg)
    await change(pg, lambda: set_range(pg, 'nk-surf', 0), expect=False)
    await change(pg, lambda: set_range(pg, 'nk-climbs', 2), expect=False)
    await change(pg, lambda: set_range(pg, 'nk-big', 2), expect=False)
    await change(pg, lambda: cyc(pg, 'Prefer'), expect=False)
    box = await allow_box(pg, 'Steps')
    await change(pg, lambda: box.click(), expect=False)
    check(await summary(pg) == 'Gravel defaults', f'after reset: {await summary(pg)!r}')


async def S11(ctx):
    pg = await start(ctx, 'Gravel')
    await open_settings(pg)
    tl = pg.locator('section.tl')
    check(await tl.count() == 1, 'no timeline for the route')
    h = (await tl.bounding_box())['height']
    need = 200 if CUR['vp'] == 'desktop' else 150
    check(h >= need, f'timeline squeezed to {h:.0f}px with Settings open (need {need}, viewport {CUR["vp"]})')
    # it must be usable: its first row is reachable by scrolling the panel
    await tl.scroll_into_view_if_needed()
    row = pg.locator('section.tl ul li').first
    check(await row.count() == 1, 'timeline has no rows')
    if not mobile():
        side = await pg.locator('aside.side').bounding_box()
        bb = await tl.bounding_box()
        check(bb['y'] + bb['height'] <= side['y'] + side['height'] + 1, 'timeline spills out of the panel')
    # empty state: save a route, start a new one, open Settings: hint and list must not overlap
    await U.finish_with_name(pg, 'E2E layout')
    await pg.wait_for_timeout(500)
    await pg.locator('.newb').first.click()
    await pg.wait_for_selector('.empty', timeout=10000)
    await open_settings(pg)
    await pg.wait_for_timeout(300)
    check(await pg.locator('.browse').count() == 1, 'routes list missing in the empty state')
    e = await pg.locator('.empty').bounding_box()
    b = await pg.locator('.browse').bounding_box()
    f = await pg.locator('.fold').first.bounding_box()
    check(e['height'] > 10, f'empty hint has no height: {e}')
    check(e['y'] + e['height'] <= b['y'] + 1 or b['y'] + b['height'] <= e['y'], f'hint overlaps the routes list: hint {e}, list {b}')
    check(e['y'] + e['height'] <= f['y'] + 1 or f['y'] + f['height'] <= e['y'], f'hint overlaps Settings: hint {e}, fold {f}')


LAYOUT_JS = """() => {
  const a = document.querySelector('aside.side');
  const kids = [...a.children].filter(e => { const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return s.display !== 'none' && !['absolute', 'fixed', 'sticky'].includes(s.position) && r.height > 0 && r.width > 0; });
  const name = e => e.className || e.tagName;
  const over = [];
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
    const p = kids[i].getBoundingClientRect(), q = kids[j].getBoundingClientRect();
    const w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
    if (w > 2 && h > 2) over.push(name(kids[i]) + ' x ' + name(kids[j]) + ' (' + Math.round(w) + 'x' + Math.round(h) + ')');
  }
  const sc = [a, ...a.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
  const last = kids[kids.length - 1];
  return { over, overflow: a.scrollHeight - a.clientHeight, scrollers: sc.map(name), hidden: getComputedStyle(a).overflowY,
           kids: kids.map(name), innerH: innerHeight, asideBottom: a.getBoundingClientRect().bottom };
}"""


async def S13(ctx):
    """Whole panel with Settings open: nothing overlaps, content taller than the screen scrolls, the last button is reachable."""
    pg = await start(ctx, 'Gravel')
    await open_settings(pg)
    for step in ('route', 'hike'):
        if step == 'hike':
            await pick_profile(pg, 'Hike')
            await open_settings(pg)
        r = await pg.evaluate(LAYOUT_JS)
        check(not r['over'], f'{step}: overlapping blocks in the panel: {r["over"]}')
        if r['overflow'] > 2 or r['scrollers']:
            check(r['scrollers'], f'{step}: content is {r["overflow"]}px taller than the panel and nothing scrolls (overflow-y {r["hidden"]})')
        # the last block (route actions) can be brought into view and ends inside the screen
        await pg.evaluate("() => { const a = document.querySelector('aside.side'); const l = [...a.querySelectorAll('.acts button')].pop(); l && l.scrollIntoView({block: 'end'}); }")
        await pg.wait_for_timeout(300)
        b = await pg.evaluate("() => { const l = [...document.querySelectorAll('aside.side .acts button')].filter(e => e.getBoundingClientRect().height).pop(); if (!l) return null; const r = l.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { bottom: r.bottom, h: innerHeight, covered: !(e === l || l.contains(e)), t: l.textContent.trim() }; }")
        check(b is not None, f'{step}: no route action buttons')
        check(b['bottom'] <= b['h'] + 1, f'{step}: last button "{b["t"]}" ends at {b["bottom"]:.0f}px, below the screen ({b["h"]}px)')
        check(not b['covered'], f'{step}: last button "{b["t"]}" is covered by another element')
    # settings controls reachable: the last one scrolls into view and is not covered
    await pg.evaluate("() => document.getElementById('nk-steep').scrollIntoView({block: 'center'})")
    cv = await pg.evaluate("() => { const e = document.getElementById('nk-steep'); const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(t === e || e.contains(t)); }")
    check(not cv, 'steepness slider is covered by another element')


async def S12(ctx):
    pg = await start(ctx, 'Gravel')
    await open_settings(pg)
    await change(pg, lambda: set_range(pg, 'nk-surf', -1))
    await change(pg, lambda: set_range(pg, 'nk-climbs', 1))
    await change(pg, lambda: set_range(pg, 'nk-big', 3))
    await change(pg, lambda: set_range(pg, 'nk-steep', 0), expect=False)
    await change(pg, lambda: cyc(pg, 'Stick to'))
    box = await allow_box(pg, 'Ferries')
    await change(pg, lambda: box.click())
    before = await summary(pg)
    await U.finish_with_name(pg, 'E2E settings')
    await pg.wait_for_timeout(1000)
    await pg.reload()
    await pg.wait_for_selector('.maplibregl-canvas')
    await pg.wait_for_timeout(2500)
    if await pg.locator('.wp').count() < 2:
        raise Fail(f'the route did not come back after reload (waypoints: {await pg.locator(".wp").count()}), url {pg.url}')
    await settle(pg)
    after = await summary(pg)
    check(after == before, f'summary after reload {after!r}, before {before!r}')
    await open_settings(pg)
    for id_, lab in [('nk-surf', 'Mostly asphalt'), ('nk-climbs', 'Fewer climbs'), ('nk-big', 'Big roads OK')]:
        text, on = await out(pg, id_)
        check(text == lab and on, f'{id_} after reload: {text!r} on={on}, expected {lab!r}')
    check(await cyc_on(pg, 'Stick to'), 'cycleways not on Stick to after reload')
    check(not await (await allow_box(pg, 'Ferries')).locator('input').is_checked(), 'Ferries box is ticked again after reload')
    check(await (await allow_box(pg, 'Steps')).locator('input').is_checked(), 'Steps box must stay ticked')
    # routing after reload uses the restored options
    n0 = len(pg.route_urls)
    await set_range(pg, 'nk-steep', 6)
    t0 = time.time()
    while len(pg.route_urls) == n0 and time.time() - t0 < 25:
        await pg.wait_for_timeout(200)
    check(len(pg.route_urls) > n0, 'no request after changing a setting on the restored route')
    d = prm(pg.route_urls[-1])
    has(d, nk_cycle=2, nk_surface=-1, nk_big=0.3, nk_allow_ferry=0, nk_uphillcutoff=6)


CASES = [
    ('S1', 'Surface slider: labels, highlight, params', S1),
    ('S2', 'Climbs slider: labels, params, seek x4', S2),
    ('S3', 'Big roads slider (bikes only)', S3),
    ('S4', 'Steepness limit', S4),
    ('S5', 'Stick to the heatmap: candidates', S5),
    ('S6', 'Cycleways off, "May use" boxes per type', S6),
    ('S7', 'Hike-only options', S7),
    ('S8', '(?) notes', S8),
    ('S9', 'Notches under sliders', S9),
    ('S10', 'Settings summary', S10),
    ('S11', 'Layout: timeline height, empty hint', S11),
    ('S12', 'Settings persist after reload', S12),
    ('S13', 'Layout: no overlap, panel scrolls', S13),
]


async def main(only, vps):
    results = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for vp in vps:
            CUR['vp'] = vp
            Locator.click = _tap_click if mobile() else _orig_click
            for cid, title, fn in CASES:
                if only and cid not in only:
                    continue
                t0 = time.time()
                res = ('', '')
                for attempts in (1, 2, 3):
                    ctx = await new_ctx(browser)
                    try:
                        await asyncio.wait_for(fn(ctx), timeout=240)
                        res = ('pass', '')
                    except Fail as e:
                        res = ('FAIL', str(e))
                    except Exception as e:
                        res = ('ERROR', f'{type(e).__name__}: {str(e).splitlines()[0][:200]}')
                    if res[0] != 'pass':
                        for i, pg in enumerate(ctx.pages):
                            await pg.screenshot(path=str(OUT / f'{cid}-{vp}-try{attempts}-{i}.png'))
                    await ctx.close()
                    if res[0] == 'pass':
                        break
                if res[0] == 'pass' and attempts > 1:
                    res = ('flaky', f'passed on attempt {attempts}')
                results[(cid, vp)] = (res[0], res[1], time.time() - t0)
                print(f'{cid:4} {vp:7} {res[0]:5} {time.time()-t0:5.1f}s  {title}  {res[1]}', flush=True)
        await browser.close()
    Locator.click = _orig_click
    ids = [c for c, _, _ in CASES if not only or c in only]
    lines = [f'# Settings e2e, {time.strftime("%Y-%m-%d %H:%M")}', '', f'Against {U.BASE}', '',
             '| Id | Case | ' + ' | '.join(vps) + ' |', '|---|---|' + '---|' * len(vps)]
    for c, t, _ in CASES:
        if c in ids:
            lines.append(f'| {c} | {t} | ' + ' | '.join(results[(c, v)][0] for v in vps) + ' |')
    lines += ['', 'Notes', '']
    for (c, v), (r, n, d) in results.items():
        if n:
            lines.append(f'- {c} {v} {r}: {n}')
    (OUT / 'results.md').write_text('\n'.join(lines) + '\n')
    print('\n' + '\n'.join(lines))


if __name__ == '__main__':
    args = sys.argv[1:]
    vps = [a.split('=', 1)[1] for a in args if a.startswith('--vp=')]
    vps = vps[0].split(',') if vps else (list(VIEWPORTS) if os.environ.get('VIEWPORT', 'all') == 'all' else os.environ['VIEWPORT'].split(','))
    asyncio.run(main({a for a in args if not a.startswith('--')}, vps))

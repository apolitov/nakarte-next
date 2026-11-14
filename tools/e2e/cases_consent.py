#!/usr/bin/env python3
"""End-to-end checks of cookie consent, analytics events and legal pages (docs/analytics-plan.md).

  python3 tools/e2e/cases_consent.py                 # all cases, all three screen profiles
  python3 tools/e2e/cases_consent.py K2 K7           # only these cases
  VIEWPORT=phone python3 tools/e2e/cases_consent.py  # desktop | short | phone | phone-small | comma list
Env: BASE (default https://alexe.pt/maps/), OUT (failure screenshots, default /tmp/nk-e2e-consent).
UI cases (K2, K3) run on every profile (desktop 1440x780, short 1366x650, phone 390x664, phone-small 375x553); data cases (K1, K4-K10) on desktop only.
No GA hit leaves the browser: google-analytics.com and /g/collect are aborted; the requests are
recorded before the abort and read back from there and from window.dataLayer.
"""
import asyncio, os, re, sys, time, pathlib
from urllib.parse import urlparse, parse_qs, unquote

os.environ.setdefault('BASE', 'https://alexe.pt/maps/')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from playwright.async_api import async_playwright, Page, BrowserContext  # noqa: E402
import usecases as U  # noqa: E402
from usecases import check, Fail  # noqa: E402


async def open_app(ctx: BrowserContext, hash_='m=14/38.80/-9.39', storage: dict | None = None) -> Page:
    """Own copy: usecases.open_app pre-answers the cookie question and blocks gtag, which these cases must not."""
    pg = await ctx.new_page()
    await pg.goto(BASE + '#' + hash_)
    if storage:
        await pg.evaluate('(s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v) }', storage)
        await pg.reload()
    await pg.wait_for_selector('.maplibregl-canvas')
    await pg.wait_for_function("document.querySelector('.maplibregl-canvas')?.width > 0")
    await pg.wait_for_timeout(1500)
    return pg


BASE = U.BASE
ORIGIN = '{0.scheme}://{0.netloc}'.format(urlparse(BASE))
PAGE_URL = ORIGIN + urlparse(BASE).path  # what GA may see: no hash
OUT = pathlib.Path(os.environ.get('OUT', '/tmp/nk-e2e-consent'))
OUT.mkdir(parents=True, exist_ok=True)
HASH = 'm=14/38.80/-9.39'
COORD = re.compile(r'(?<![\d.])-?\d{1,2}\.\d{4,}')
SECRET_NAME = 'Secret Loop priv@example.com'
PROFILES = {
    # visible viewport sizes, browser chrome already subtracted
    'desktop': dict(viewport={'width': 1440, 'height': 780}),
    'short': dict(viewport={'width': 1366, 'height': 650}),
    'phone': dict(viewport={'width': 390, 'height': 664}, is_mobile=True, has_touch=True),
    'phone-small': dict(viewport={'width': 375, 'height': 553}, is_mobile=True, has_touch=True),
}


# ---------- helpers ----------
async def new_ctx(browser, prof='desktop', clipboard=False):
    ctx = await browser.new_context(accept_downloads=True, **PROFILES[prof])
    await ctx.route(re.compile(r'google-analytics\.com|/g/collect'), lambda r: r.abort())
    ctx.collects = []  # type: ignore[attr-defined]
    ctx.on('request', lambda r: re.search(r'google-analytics\.com|/g/collect', r.url) and ctx.collects.append(r.url))  # type: ignore[attr-defined]
    if clipboard:
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=ORIGIN)
    return ctx


async def layer(pg: Page) -> list:
    return await pg.evaluate("Array.from(window.dataLayer || []).map(x => Array.from(x))")


async def events(pg: Page) -> list:
    return [(x[1], x[2] if len(x) > 2 else {}) for x in await layer(pg) if x and x[0] == 'event']


async def consent_calls(pg: Page, kind: str) -> list:
    return [x[2] for x in await layer(pg) if len(x) > 2 and x[0] == 'consent' and x[1] == kind]


async def ga_cookies(ctx) -> list:
    return [c['name'] for c in await ctx.cookies() if c['name'].startswith('_ga')]


async def wait_for(fn, timeout=8, step=0.3):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = await fn()
        if v:
            return v
        await asyncio.sleep(step)
    return await fn()


def q(url):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query, keep_blank_values=True).items()}


async def stored(pg: Page):
    return await pg.evaluate("localStorage.getItem('nm-consent')")


def box_in_view(b, vw, vh):
    return b and b['x'] >= -0.5 and b['y'] >= -0.5 and b['x'] + b['width'] <= vw + 0.5 and b['y'] + b['height'] <= vh + 0.5


def overlap(a, b):
    return min(a['x'] + a['width'], b['x'] + b['width']) - max(a['x'], b['x']) > 1 and \
        min(a['y'] + a['height'], b['y'] + b['height']) - max(a['y'], b['y']) > 1


WARN: list = []


async def reachable(pg: Page, loc, what, strict=True):
    """Fully inside the viewport and the topmost thing at its centre (strict=False: only the centre, clipping is a warning)."""
    vp = pg.viewport_size
    b = await loc.bounding_box()
    if not strict:
        check(b and 0 <= b['x'] + b['width'] / 2 <= vp['width'] and 0 <= b['y'] + b['height'] / 2 <= vp['height'], f'{what} centre outside the viewport {vp}: {b}')
        if not box_in_view(b, vp['width'], vp['height']):
            WARN.append(f'{what} clipped by the viewport {vp}: {b}')
    else:
        check(box_in_view(b, vp['width'], vp['height']), f'{what} not fully in the viewport {vp}: {b}')
    top = await loc.evaluate("(e) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === e || e.contains(t) }")
    check(top, f'{what} is covered by another element')


# ---------- K1-K6 consent ----------
async def K1(ctx, prof):
    """Fresh visit: banner, consent default denied, no cookies, cookieless page_view."""
    pg = await open_app(ctx, HASH)
    check(await pg.locator('.cb').count() == 1, 'banner not shown on a fresh visit')
    d = await consent_calls(pg, 'default')
    check(d, 'no consent default in dataLayer')
    check(d[0].get('analytics_storage') == 'denied', f'analytics_storage default: {d[0]}')
    for k in ('ad_storage', 'ad_user_data', 'ad_personalization'):
        check(d[0].get(k) == 'denied', f'{k} default not denied: {d[0]}')
    check(await stored(pg) is None, 'nm-consent set before any answer')
    check(not await ga_cookies(ctx), f'_ga cookies before consent: {await ga_cookies(ctx)}')

    async def pv():
        return [u for u in ctx.collects if q(u).get('en') == 'page_view']
    hits = await wait_for(pv, 10)
    check(hits, f'no page_view collect recorded; collects={ctx.collects[:3]}')
    p = q(hits[0])
    check(p.get('gcs') == 'G100', f'page_view gcs={p.get("gcs")!r}, expected G100 (analytics and ads denied)')
    check('dl' in p and '#' not in p['dl'] and '#' not in unquote(hits[0].split('dl=')[1].split('&')[0]), f'dl has a hash or is missing: {p.get("dl")!r}')
    check(p['dl'] == PAGE_URL, f'dl={p["dl"]!r}, expected {PAGE_URL}')
    check(not await ga_cookies(ctx), '_ga cookies after the cookieless ping')


async def banner_geometry(pg: Page, prof):
    vp = pg.viewport_size
    cb = pg.locator('.cb')
    await cb.wait_for(state='visible', timeout=5000)
    bb = await cb.bounding_box()
    check(box_in_view(bb, vp['width'], vp['height']), f'banner not fully visible in {vp}: {bb}')
    for sel, name in (('.cb .no', 'No cookies'), ('.cb .yes', 'Allow')):
        await reachable(pg, pg.locator(sel), f'button {name}')
    for sel, tail in (('.cb a >> nth=0', 'help/#privacy'), ('.cb a >> nth=1', 'terms/')):
        check((await pg.get_attribute(sel, 'href')).endswith(tail), f'banner link {sel} href')
    if prof.startswith('phone'):
        g = pg.locator('.grab')
        check(await g.count() and await g.is_visible(), 'sheet handle .grab not visible on the phone')
        gb = await g.bounding_box()
        check(not overlap(bb, gb), f'banner covers the sheet handle: banner={bb} handle={gb}')
        await reachable(pg, g, 'sheet handle')
    else:
        s = pg.locator('.side').first
        sb = await s.bounding_box()
        check(not overlap(bb, sb), f'banner covers the side panel: banner={bb} panel={sb}')


async def K2(ctx, prof):
    """Banner layout on this screen profile, then Allow with a real click."""
    pg = await open_app(ctx, HASH)
    await banner_geometry(pg, prof)
    await pg.click('.cb .yes')
    await pg.wait_for_timeout(300)
    check(await pg.locator('.cb').count() == 0, 'banner stays after Allow (click reached the button)')


async def K3(ctx, prof, expand=False):
    """Account menu: Terms, Privacy, Cookie settings reachable and pointing to the right pages.
    On a phone the sheet is collapsed at first (K3) or expanded by the user first (K11)."""
    pg = await open_app(ctx, HASH, {'nm-consent': 'denied'})
    if expand:
        await pg.locator('.grab').click()
        await pg.wait_for_timeout(700)
    u = pg.locator('button.user').first
    await reachable(pg, u, 'account button', strict=False)
    await u.click()
    await pg.wait_for_timeout(400)  # on a phone the sheet slides up first (0.22 s)
    await pg.wait_for_selector('.pop .legal', timeout=3000)
    links = pg.locator('.pop .legal a')
    check(await links.count() == 2, f'{await links.count()} legal links, expected 2')
    names = [(await links.nth(i).inner_text()).strip() for i in range(2)]
    check(names == ['Terms of use', 'Privacy'], f'legal link labels: {names}')
    hrefs = [await links.nth(i).get_attribute('href') for i in range(2)]
    check(hrefs[0].rstrip('/').endswith('/terms') or hrefs[0].endswith('terms/'), f'Terms href {hrefs[0]}')
    check(hrefs[1].endswith('help/#privacy'), f'Privacy href {hrefs[1]}')
    for i, n in enumerate(names):
        await reachable(pg, links.nth(i), f'link {n}')
    cs = pg.locator('.pop .legal button')
    check((await cs.inner_text()).strip() == 'Cookie settings', 'Cookie settings button label')
    await reachable(pg, cs, 'Cookie settings')
    await cs.click()
    await pg.wait_for_selector('.cb', timeout=3000)
    await banner_geometry(pg, prof)
    for h in hrefs:
        r = await ctx.request.get(urlparse(BASE)._replace(path=urlparse(BASE).path, fragment='').geturl().rstrip('/') + '/' + h.split('maps/')[-1].split('#')[0])
        check(r.status == 200, f'{h} -> HTTP {r.status}')


async def K4(ctx, prof):
    """Allow: banner closes, nm-consent=granted, update granted (ads denied), _ga cookies, remembered."""
    pg = await open_app(ctx, HASH)
    await pg.click('.cb .yes')
    await pg.wait_for_timeout(500)
    check(await pg.locator('.cb').count() == 0, 'banner still open')
    check(await stored(pg) == 'granted', f'nm-consent={await stored(pg)!r}')
    u = await consent_calls(pg, 'update')
    check(u and u[-1].get('analytics_storage') == 'granted', f'consent update: {u}')
    for k in ('ad_storage', 'ad_user_data', 'ad_personalization'):
        check(u[-1].get(k) == 'denied', f'{k} not denied after Allow: {u[-1]}')
    ck = await wait_for(lambda: ga_cookies(ctx), 8)
    check(ck, '_ga cookies did not appear after Allow')
    await pg.reload()
    await pg.wait_for_selector('.maplibregl-canvas')
    await pg.wait_for_timeout(1500)
    check(await pg.locator('.cb').count() == 0, 'banner back after reload')
    d = await consent_calls(pg, 'default')
    check(d and d[0].get('analytics_storage') == 'granted', f'default after reload: {d}')


async def K5(ctx, prof):
    """No cookies: nm-consent=denied, no _ga, remembered."""
    pg = await open_app(ctx, HASH)
    await pg.click('.cb .no')
    await pg.wait_for_timeout(1500)
    check(await pg.locator('.cb').count() == 0, 'banner still open')
    check(await stored(pg) == 'denied', f'nm-consent={await stored(pg)!r}')
    u = await consent_calls(pg, 'update')
    check(u and u[-1].get('analytics_storage') == 'denied', f'consent update: {u}')
    check(not await ga_cookies(ctx), f'_ga cookies after No: {await ga_cookies(ctx)}')
    await pg.reload()
    await pg.wait_for_timeout(1500)
    check(await pg.locator('.cb').count() == 0, 'banner back after reload')
    check(not await ga_cookies(ctx), '_ga cookies after reload with denied')


async def K6(ctx, prof):
    """Allow, then No cookies through the account menu: the _ga cookies are removed."""
    pg = await open_app(ctx, HASH)
    await pg.click('.cb .yes')
    check(await wait_for(lambda: ga_cookies(ctx), 8), '_ga cookies did not appear after Allow')
    await pg.click('button.user')
    await pg.click('.pop .legal button')
    await pg.wait_for_selector('.cb', timeout=3000)
    await pg.click('.cb .no')
    await pg.wait_for_timeout(1500)
    check(await stored(pg) == 'denied', f'nm-consent={await stored(pg)!r}')
    left = await ga_cookies(ctx)
    check(not left, f'_ga cookies left after No: {left}')
    u = await consent_calls(pg, 'update')
    check(u[-1].get('analytics_storage') == 'denied', f'last consent update: {u[-1]}')


async def K11(ctx, prof):
    await K3(ctx, prof, expand=True)


# ---------- K7-K8 events and privacy ----------
SC: dict = {}


async def scenario(ctx):
    pg = await open_app(ctx, HASH, {'nm-consent': 'denied'})
    await pg.locator('.tb >> nth=0').click()  # edit_start
    await pg.wait_for_timeout(300)
    await U.draw(pg, U.TWO)
    await pg.wait_for_timeout(500)
    await U.open_settings(pg)
    await pg.locator('.q').first.click()  # explain_open
    await pg.locator('.q').first.click()  # closes it again (Escape would end editing)
    await pg.focus('#nk-surf')
    await pg.keyboard.press('ArrowRight')  # setting_change surface
    await pg.wait_for_timeout(400)
    await U.pick(pg, 'Road')  # profile_change
    await U.settle(pg)
    await pg.click('button[aria-label="Map"]')  # layer_change
    await pg.locator('#nk-layers input[name=nk-base]:not(:checked)').first.click()
    await pg.wait_for_timeout(500)
    await pg.click('button[aria-label="Overlays"]')  # overlay_toggle
    await pg.locator('#nk-layers input[type=checkbox]').first.click()
    await pg.wait_for_timeout(500)
    await pg.click('button.poibtn')  # poi_toggle
    await pg.locator('#nk-pois input[type=checkbox]').first.click()
    await pg.wait_for_timeout(500)
    await pg.click('button[aria-label="Reverse route"]')  # route_tool reverse
    await U.settle(pg)
    await U.close_settings(pg)  # back from All settings: the route actions are in the main view
    await U.finish_with_name(pg, SECRET_NAME)  # route_named
    async with pg.expect_download(timeout=15000) as dlw:
        await pg.click('button:has-text("Download GPX")')  # gpx_download
    await dlw.value
    await pg.click('button:has-text("Copy link")')  # link_copy
    await pg.wait_for_timeout(3000)
    SC.clear()
    SC.update(events=await events(pg), layer=await layer(pg), collects=list(ctx.collects))


def ev(evs, name):
    return [p for n, p in evs if n == name]


async def K7(ctx, prof):
    """Events reach dataLayer with the parameters of docs/analytics-plan.md; all carry app=nomapa."""
    await scenario(ctx)
    evs = SC['events']
    names = [n for n, _ in evs]
    missing, wrong = [], []
    want = {
        'edit_start': lambda p: True,
        'route_built': lambda p: p.get('profile') and p.get('points') == '2',
        'setting_change': lambda p: p.get('name') == 'surface' and 'value' in p,
        'layer_change': lambda p: p.get('id'),
        'overlay_toggle': lambda p: p.get('id') and p.get('on') in (True, False),
        'poi_toggle': lambda p: p.get('id') and p.get('on') in (True, False),
        'profile_change': lambda p: 'road' in str(p.get('profile')),
        'link_copy': lambda p: p.get('kind') in ('short', 'long') and p.get('profile'),
        'gpx_download': lambda p: p.get('profile') and isinstance(p.get('km'), (int, float)),
        'explain_open': lambda p: p.get('name'),
        'route_tool': lambda p: p.get('tool') == 'reverse',
    }
    for n, f in want.items():
        got = ev(evs, n)
        if not got:
            missing.append(n)
        elif not any(f(p) for p in got):
            wrong.append(f'{n}: {got}')
    check(not missing, f'events missing: {missing}; seen: {names}')
    check(not wrong, f'unexpected parameters: {wrong}')
    bad = [(n, p) for n, p in evs if p.get('app') != 'nomapa']
    check(not bad, f'events without app=nomapa: {bad}')
    order = [names.index(x) for x in ('edit_start', 'route_built')]
    check(order[0] < order[1], 'route_built before edit_start')


async def K8(ctx, prof):
    """Privacy: no coordinates, hash, route name or email in events or collect URLs; page_location without hash."""
    if not SC:
        await scenario(ctx)
    problems = []
    for n, p in SC['events']:
        for k, v in p.items():
            s = str(v)
            if COORD.search(s) or '#' in s or '@' in s or 'Secret' in s:
                problems.append(f'event {n}.{k}={s!r}')
    layer_s = repr([x for x in SC['layer'] if x and x[0] != 'js'])
    for pat, what in ((COORD, 'coordinates'), (re.compile(r'#[msr]='), 'map hash'), (re.compile('Secret|priv@|example\\.com'), 'route name/email')):
        m = pat.search(layer_s)
        if m:
            problems.append(f'dataLayer contains {what}: ...{layer_s[max(0, m.start() - 40):m.end() + 40]}')
    check(SC['collects'], 'no collect requests recorded')
    for u in SC['collects']:
        pr = q(u)
        scan = {k: v for k, v in pr.items() if k in ('dl', 'dr', 'dt', 'dp') or k.startswith(('ep.', 'epn.', 'up.', 'en'))}
        for k, v in scan.items():
            if COORD.search(v) or re.search(r'[#]|@|Secret', v):
                problems.append(f'collect {pr.get("en")} {k}={v!r}')
        full = unquote(u)
        if re.search(r'#[msr]=|%23[msr]%3D|priv@|Secret', u + full):
            problems.append(f'collect URL has hash/name/email: {full[:200]}')
        if 'dl' in pr and pr['dl'] != PAGE_URL:
            problems.append(f'dl={pr["dl"]!r} (expected {PAGE_URL})')
    pl = [x[1] for x in SC['layer'] if len(x) > 1 and x[0] == 'set' and isinstance(x[1], dict) and 'page_location' in x[1]]
    check(pl and all(d['page_location'] == PAGE_URL for d in pl), f'dataLayer page_location: {pl}')
    (OUT / 'K8-collects.txt').write_text('\n'.join(unquote(u) for u in SC['collects']))
    check(not problems, 'PRIVACY: ' + ' | '.join(sorted(set(x[:230] for x in problems))[:6]))


# ---------- K9-K10 legal pages ----------
async def K9(ctx, prof):
    pg = await ctx.new_page()
    r = await pg.goto(BASE + 'terms/')
    check(r.status == 200, f'terms/ -> HTTP {r.status}')
    txt = await pg.inner_text('body')
    for s in ('Free and as is', 'Routes are suggestions', 'Your data and its loss', 'Limitation of liability', 'Law and contact'):
        check(s in txt, f'terms section missing: {s}')
    r2 = await ctx.request.get(BASE + 'terms')
    check(r2.status == 200, f'terms (no slash) -> HTTP {r2.status}')


async def K10(ctx, prof):
    pg = await ctx.new_page()
    r = await pg.goto(BASE + 'help/#privacy')
    check(r.status == 200, f'help/ -> HTTP {r.status}')
    t = await pg.inner_text('#privacy')  # h2 only; take text of the section until the footer
    body = await pg.evaluate("""() => { const h = document.getElementById('privacy'); let s = h.innerText;
      for (let e = h.nextElementSibling; e; e = e.nextElementSibling) s += '\\n' + e.innerText; return s }""")
    for s in ('Analytics', '_ga', 'Cookie settings'):
        check(s in body, f'help #privacy does not mention {s!r}')
    top = await pg.evaluate("document.getElementById('privacy').getBoundingClientRect().top")
    check(-5 < top < 300, f'#privacy not scrolled into view, top={top}')


CASES = {
    'K1': ('Fresh visit: denied by default, page_view without hash', K1, False),
    'K2': ('Banner layout, buttons reachable, Allow click', K2, True),
    'K3': ('Account menu legal links and Cookie settings', K3, True),
    'K4': ('Allow: granted, cookies, remembered', K4, False),
    'K5': ('No cookies: denied, no cookies, remembered', K5, False),
    'K6': ('Allow then No via menu removes _ga', K6, False),
    'K7': ('Events in dataLayer with app=nomapa', K7, False),
    'K8': ('Privacy of events and collect URLs', K8, False),
    'K9': ('Terms page and sections', K9, False),
    'K10': ('Help #privacy text', K10, False),
    'K11': ('Account menu legal links, sheet expanded (phones)', K11, ['phone', 'phone-small']),
}


async def run_one(browser, cid, prof, attempts=3):
    title, fn, _ = CASES[cid]
    outcomes = []
    for a in range(attempts):
        ctx = await new_ctx(browser, prof, clipboard=(cid == 'K7'))
        try:
            await asyncio.wait_for(fn(ctx, prof), timeout=150)
            outcomes.append(('pass', ''))
        except Fail as e:
            outcomes.append(('FAIL', str(e)))
        except Exception as e:
            outcomes.append(('ERROR', f'{type(e).__name__}: {str(e).splitlines()[0][:160]}'))
        if outcomes[-1][0] != 'pass':
            for i, pg in enumerate(ctx.pages):
                try:
                    await pg.screenshot(path=str(OUT / f'{cid}-{prof}-{a}-{i}.png'))
                except Exception:
                    pass
        await ctx.close()
        if outcomes[-1][0] == 'pass':
            break
        if outcomes[-1][0] == 'FAIL' and a == 1 and outcomes[0][1] == outcomes[1][1]:
            break  # the same failure twice: deterministic
    bad = [o for o in outcomes if o[0] != 'pass']
    if not bad:
        return 'pass', ''
    if len(bad) < len(outcomes):
        return 'FLAKY', f'{len(bad)}/{len(outcomes)} failed: {bad[0][1]}'
    return bad[-1]


async def main(only):
    want = os.environ.get('VIEWPORT', 'all')
    profs = list(PROFILES) if want == 'all' else [p for p in want.split(',') if p in PROFILES]
    SC.clear()
    res = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for cid, (title, fn, ui) in CASES.items():
            if only and cid not in only:
                continue
            for prof in ([p_ for p_ in profs if p_ in ui] if isinstance(ui, list) else profs if ui else ['desktop']):
                t0 = time.time()
                r = await run_one(browser, cid, prof)
                res[(cid, prof)] = r
                print(f'{cid:4} {prof:8} {r[0]:5} {time.time() - t0:5.1f}s  {title}  {r[1]}', flush=True)
        await browser.close()
    print(f'\nAgainst {BASE}\n')
    print('| Id | Case | ' + ' | '.join(profs) + ' |')
    print('|---|---|' + '---|' * len(profs))
    for cid, (title, _, ui) in CASES.items():
        if only and cid not in only:
            continue
        cells = [res[(cid, pr)][0] if (cid, pr) in res else '-' for pr in profs]
        print(f'| {cid} | {title} | ' + ' | '.join(cells) + ' |')
    for w in sorted(set(WARN)):
        print('WARN', w)
    notes = [(k, v) for k, v in res.items() if v[0] != 'pass']
    for (cid, prof), (st, msg) in notes:
        print(f'\n{cid} {prof} {st}: {msg}')


if __name__ == '__main__':
    asyncio.run(main(set(sys.argv[1:])))

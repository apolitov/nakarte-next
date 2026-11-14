#!/usr/bin/env python3
"""End-to-end checks of the route panel (design of 14 Nov 2026, public/design/f1-panel-states.html):
start tiles, settings as a sentence, All settings, the route menu, the loop planner, Discard route.

  python3 tools/e2e/cases_panel.py             # all cases, all screen profiles
  python3 tools/e2e/cases_panel.py P5          # only these cases
  VIEWPORT=phone python3 tools/e2e/cases_panel.py
Env: BASE (default https://alexe.pt/maps/), OUT (failure screenshots, default /tmp/nk-e2e-panel).
"""
import asyncio, os, re, sys, time, pathlib, traceback

os.environ.setdefault('BASE', 'https://alexe.pt/maps/')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from playwright.async_api import async_playwright, Page, BrowserContext  # noqa: E402
import usecases as U  # noqa: E402
from usecases import check, Fail, PROFILES  # noqa: E402

OUT = pathlib.Path(os.environ.get('OUT', '/tmp/nk-e2e-panel'))
OUT.mkdir(parents=True, exist_ok=True)


async def with_route(ctx: BrowserContext) -> Page:
    pg = await U.open_app(ctx)
    await U.draw(pg, U.TWO)
    await U.side(pg)
    return pg


async def P1(ctx):
    """Empty panel: three start tiles; Draw turns editing on; Open GPX asks for a file; the Settings line opens All settings."""
    pg = await U.open_app(ctx)
    await U.side(pg)
    tiles = pg.locator('.starts .start')
    check(await tiles.count() == 3, f'{await tiles.count()} start tiles')
    texts = [t.strip() for t in await tiles.all_inner_texts()]
    check(texts == ['Draw a route', 'Plan a loop', 'Open GPX'], f'tiles: {texts}')
    check(await pg.locator('.ss').count() == 0, 'the settings sentence shows before there is a route')
    async with pg.expect_file_chooser(timeout=5000):
        await tiles.nth(2).click()
    await pg.locator('button.setl').click()
    await pg.wait_for_timeout(250)
    check(await pg.locator('.pview #nk-surf').count() == 1, 'the Settings line did not open All settings')
    await U.close_settings(pg)
    await tiles.nth(0).click()
    await pg.wait_for_timeout(300)
    check(await U.editing(pg), 'Draw a route did not turn editing on')


async def P2(ctx):
    """The sentence: a word opens its choices, a choice routes with it and the word changes; Escape closes."""
    pg = await with_route(ctx)
    s = pg.locator('.ss p')
    check('usual climbs' in await s.inner_text(), f'sentence: {await s.inner_text()!r}')
    w = pg.locator('.ss .tok', has_text='usual climbs')
    check('def' in (await w.get_attribute('class') or ''), 'a default word is not shown as default')
    await w.click()
    pop = pg.locator('.ss .pop')
    check(await pop.count() == 1, 'no choices opened')
    labels = [x.strip().split('\n')[0] for x in await pop.locator('button').all_inner_texts()]
    check(len(labels) == 5 and 'fewer climbs' in labels, f'choices: {labels}')
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(150)
    check(await pop.count() == 0, 'Escape did not close the choices')
    n0 = len(pg.route_urls)
    await w.click()
    await pop.locator('button', has_text='fewer climbs').click()
    await U.settle(pg)
    check(any('nk_uphillcost=120' in u for u in pg.route_urls[n0:]), 'the choice was not routed with')
    t = await s.inner_text()
    check('fewer climbs' in t, f'sentence after the choice: {t!r}')
    w2 = pg.locator('.ss .tok', has_text='fewer climbs')
    check('def' not in (await w2.get_attribute('class') or ''), 'a changed word is still shown as default')


async def P3(ctx):
    """All settings: opens from the sentence, has the type tabs and the change line, Reset clears, Back returns."""
    pg = await with_route(ctx)
    await pg.locator('.ss .all').click()
    await pg.wait_for_timeout(250)
    check(await pg.locator('.pview #nk-surf').count() == 1, 'All settings did not open')
    check(await pg.locator('.pview [role=radiogroup][aria-label="Route type"]').count() == 1, 'no route type tabs in All settings')
    check((await pg.locator('.pvs').inner_text()).strip() == 'Gravel defaults', f'change line: {await pg.locator(".pvs").inner_text()!r}')
    await pg.locator('.pview label.sw', has_text='Avoid cobblestones').click()
    await U.settle(pg)
    check('no cobbles' in await pg.locator('.pvs').inner_text(), 'change line did not follow the switch')
    await pg.locator('.pview .reset').click()
    await U.settle(pg)
    check((await pg.locator('.pvs').inner_text()).strip() == 'Gravel defaults', 'Reset did not clear the change')
    await pg.locator('.pview .back').click()
    await pg.wait_for_timeout(250)
    check(await pg.locator('.pview').count() == 0 and await pg.locator('.ss').count() == 1, 'Back did not return to the route')


async def P4(ctx):
    """Route menu: Rename focuses the name, Make a copy opens a copy, Delete asks with the full text and deletes."""
    pg = await with_route(ctx)
    await U.finish_with_name(pg, 'P4 route')
    await U.side(pg)
    await pg.locator('button.dotsb').click()
    items = [x.strip() for x in await pg.locator('.rmenu button').all_inner_texts()]
    check(items == ['Rename', 'Make a copy', 'Delete…'], f'menu: {items}')
    await pg.locator('.rmenu button', has_text='Rename').click()
    check(await pg.evaluate("document.activeElement?.classList.contains('title')"), 'Rename did not focus the name')
    await pg.keyboard.press('Escape')
    await pg.locator('button.dotsb').click()
    await pg.locator('.rmenu button', has_text='Make a copy').click()
    await pg.wait_for_timeout(500)
    check('copy' in (await pg.input_value('.title')).lower(), f'copy name: {await pg.input_value(".title")!r}')
    await pg.locator('button.dotsb').click()
    await pg.locator('.rmenu button', has_text='Delete').click()
    txt = await pg.locator('.ic p').inner_text()
    check('can’t be undone' in txt and 'P4 route' in txt, f'confirmation: {txt!r}')
    box = await pg.locator('.ic').bounding_box()
    check(box and box['height'] >= 60, f'confirmation squeezed: {box}')
    await pg.locator('.ic .yes').click()
    await pg.wait_for_timeout(400)
    check(await U.markers(pg) == 0, 'the route was not deleted')


async def P5(ctx):
    """Plan a loop: asks for the start first; Pick on the map sets a marker; Find gives loops near the length; picking one opens it."""
    pg = await U.open_app(ctx)
    await U.side(pg)
    await pg.locator('.starts .start', has_text='Plan a loop').click()
    await pg.wait_for_timeout(300)
    lp = pg.locator('section.loop')
    check(await lp.locator('.q').count() == 1, 'no "where does the ride start" question')
    check(await lp.locator('.form .go').is_disabled(), 'Find loops is enabled before the start is set')
    await lp.locator('button.sec', has_text='Pick on the map').click()
    await pg.wait_for_timeout(400)
    check(await pg.locator('.pickhint').count() == 1, 'no hint to tap the map')
    await U.click_map(pg, 0.5, 0.45)
    await pg.wait_for_timeout(500)
    check(await pg.locator('.loopstart').count() == 1, 'no start marker')
    await U.side(pg)
    check(await lp.locator('.from').count() == 1, 'start not shown in the panel')
    await lp.locator('.form .go').click()
    t0 = time.time()
    while time.time() - t0 < 120 and not await lp.locator('.cand').count() and not await lp.locator('.err').count():
        await pg.wait_for_timeout(1000)
    n = await lp.locator('.cand').count()
    check(n >= 1, f'no loops found: {await lp.inner_text()!r}')
    kms = [float(re.search(r'([\d.]+) km', x).group(1)) for x in await lp.locator('.cand').all_inner_texts()]
    check(all(20 <= k <= 40 for k in kms), f'loops far from 30 km: {kms}')
    await lp.locator('.cand').first.click()
    await U.settle(pg, 90)
    check(await pg.locator('section.loop').count() == 0, 'planner still open after picking')
    check(await U.markers(pg) >= 3, f'picked loop has {await U.markers(pg)} points')
    check(await pg.locator('.loopstart').count() == 0, 'start marker left on the map')


async def P6(ctx):
    """Name dialog: Discard route asks once more, then the route is gone."""
    pg = await U.open_app(ctx)
    await U.draw(pg, U.TWO)
    await U.mapview(pg)
    await pg.keyboard.press('Escape')
    await pg.wait_for_selector('dialog.named[open]', timeout=5000)
    d = pg.locator('dialog.named .disc')
    check(await d.count() == 1, 'no Discard route button')
    await d.click()
    check('for good' in (await d.inner_text()), 'Discard did not ask once more')
    check(await pg.locator('dialog.named[open]').count() == 1, 'dialog closed on the first click')
    await d.click()
    await pg.wait_for_timeout(400)
    check(await pg.locator('dialog.named[open]').count() == 0, 'dialog still open')
    check(await U.markers(pg) == 0, 'route still there after Discard')


CASES = {
    'P1': ('Start tiles and the Settings line', P1),
    'P2': ('Settings sentence: a word and its choices', P2),
    'P3': ('All settings: tabs, change line, Reset, Back', P3),
    'P4': ('Route menu: rename, copy, delete', P4),
    'P5': ('Plan a loop: start, find, pick', P5),
    'P6': ('Name dialog: Discard route', P6),
}


async def run_one(browser, cid, prof, attempts=2):
    title, fn = CASES[cid]
    notes = []
    for a in range(attempts):
        ctx = await U.new_context(browser, prof)
        try:
            await asyncio.wait_for(fn(ctx), timeout=240)
            await ctx.close()
            return ('pass' if a == 0 else 'flaky', '; '.join(notes))
        except Fail as e:
            notes.append(f'try {a + 1}: {e}')
        except Exception as e:
            notes.append(f'try {a + 1}: {type(e).__name__}: {str(e).splitlines()[0][:160]}')
        for i, pg in enumerate(ctx.pages):
            try:
                await pg.screenshot(path=str(OUT / f'{cid}-{prof}-{a}-{i}.png'))
            except Exception:
                pass
        await ctx.close()
    return ('FAIL', '; '.join(notes))


async def main(only):
    want = os.environ.get('VIEWPORT', 'all')
    profs = list(PROFILES) if want == 'all' else [p for p in want.split(',') if p in PROFILES]
    res = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for cid, (title, _) in CASES.items():
            if only and cid not in only:
                continue
            for prof in profs:
                t0 = time.time()
                r = await run_one(browser, cid, prof)
                res[(cid, prof)] = r
                print(f'{cid:4} {prof:13} {r[0]:5} {time.time() - t0:5.1f}s  {title}  {r[1]}', flush=True)
        await browser.close()
    print(f'\nAgainst {U.BASE}\n')
    print('| Id | Case | ' + ' | '.join(profs) + ' |')
    print('|---|---|' + '---|' * len(profs))
    for cid, (title, _) in CASES.items():
        if only and cid not in only:
            continue
        print(f'| {cid} | {title} | ' + ' | '.join(res[(cid, pr)][0] if (cid, pr) in res else '-' for pr in profs) + ' |')
    for (cid, pr), (st, note) in res.items():
        if st != 'pass' and note:
            print(f'- {cid} {pr} {st}: {note}')


if __name__ == '__main__':
    asyncio.run(main(set(sys.argv[1:])))

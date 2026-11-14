<script lang="ts">
  // All my routes on one screen: totals at the top, then a table to sort, search, open and delete.
  // Statistics come from the legs stored with each route (lib/routeStats.ts), no router calls.
  import type { RouteDoc } from '../lib/store';
  import { t, LOCALE } from '../lib/i18n';
  import { PROFILES, normalizeProfile } from '../lib/brouter';
  import { routeStats } from '../lib/routeStats';
  import { formatDuration } from '../lib/eta';
  import { segColor, SEG_SHORT, dec } from '../lib/timeline';
  import { track } from '../lib/analytics';
  import Icon from './Icon.svelte';

  let {
    open = $bindable(false),
    routes,
    currentId,
    onopen,
    ondelete,
  }: {
    open: boolean;
    routes: RouteDoc[];
    currentId: string;
    onopen: (r: RouteDoc) => void;
    ondelete: (rs: RouteDoc[]) => void;
  } = $props();

  let dlg: HTMLDialogElement;
  $effect(() => {
    if (open && !dlg.open) {
      dlg.showModal();
      track('routes_screen', { n: routes.length });
    } else if (!open && dlg.open) dlg.close();
  });

  type Col = 'name' | 'type' | 'km' | 'up' | 'time' | 'made' | 'garmin';
  let sort = $state<Col>('made');
  let desc = $state(true);
  let q = $state('');
  let only = $state<string | null>(null);
  let picked = $state<Set<string>>(new Set());
  let confirming = $state(false);

  const made = (r: RouteDoc) => r.created ?? r.updated;
  const typeOf = (r: RouteDoc) => normalizeProfile(r.profile ?? '');
  const title = (id: string) => PROFILES.find((p) => p.id === id)?.title ?? id;
  const rows = $derived(routes.map((r) => ({ r, s: routeStats(r), type: typeOf(r) })));
  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((x) => (!only || x.type === only) && (!needle || x.r.name.toLowerCase().includes(needle)));
    const key: Record<Col, (x: (typeof rows)[number]) => number | string> = {
      name: (x) => x.r.name.toLowerCase(),
      type: (x) => PROFILES.findIndex((p) => p.id === x.type),
      km: (x) => x.s.km,
      up: (x) => x.s.ascent,
      time: (x) => x.s.minutes,
      made: (x) => made(x.r),
      garmin: (x) => x.r.garmin?.at ?? 0,
    };
    const k = key[sort];
    return [...list].sort((a, b) => {
      const va = k(a), vb = k(b);
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return desc ? -c : c;
    });
  });
  const totals = $derived({
    n: rows.length,
    km: rows.reduce((s, x) => s + x.s.km, 0),
    up: rows.reduce((s, x) => s + x.s.ascent, 0),
    garmin: rows.filter((x) => x.r.garmin).length,
    types: PROFILES.map((p) => ({ id: p.id, title: p.title, n: rows.filter((x) => x.type === p.id).length })).filter((x) => x.n),
  });

  function by(c: Col) {
    if (sort === c) desc = !desc;
    else {
      sort = c;
      desc = c !== 'name' && c !== 'type';
    }
  }
  const thisYear = new Date().getFullYear();
  const date = (ms?: number) =>
    ms ? new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', ...(new Date(ms).getFullYear() !== thisYear ? { year: 'numeric' } : {}) }) : '';
  const km = (v: number) => (v >= 100 ? String(Math.round(v)) : dec(v));
  function pick(id: string, on: boolean) {
    const s = new Set(picked);
    if (on) s.add(id);
    else s.delete(id);
    picked = s;
    confirming = false;
  }
  const allPicked = $derived(shown.length > 0 && shown.every((x) => picked.has(x.r.id)));
  function pickAll(on: boolean) {
    picked = on ? new Set(shown.map((x) => x.r.id)) : new Set();
    confirming = false;
  }
  function remove() {
    ondelete(routes.filter((r) => picked.has(r.id)));
    picked = new Set();
    confirming = false;
  }
  function openRow(r: RouteDoc) {
    open = false;
    onopen(r);
  }
</script>

{#snippet th(c: Col, label: string, num = false)}
  <th scope="col" class:num aria-sort={sort === c ? (desc ? 'descending' : 'ascending') : 'none'}>
    <button onclick={() => by(c)}>{label}{#if sort === c}<span aria-hidden="true">{desc ? ' ↓' : ' ↑'}</span>{/if}</button>
  </th>
{/snippet}

<dialog bind:this={dlg} class="rs" aria-label={t('rs.title')} onclose={() => (open = false)}>
  <div class="in">
    <header>
      <h2>{t('rs.title')}</h2>
      <button class="x" aria-label={t('lay.close')} onclick={() => (open = false)}><Icon name="close" size={18} /></button>
    </header>

    <div class="tiles">
      <div class="tile"><b class="num">{totals.n}</b><span>{t('rs.routes')}</span></div>
      <div class="tile"><b class="num">{Math.round(totals.km).toLocaleString(LOCALE)}</b><span>{t('rs.km')}</span></div>
      <div class="tile"><b class="num">{Math.round(totals.up).toLocaleString(LOCALE)}</b><span>{t('rs.up')}</span></div>
      <div class="tile"><b class="num">{totals.garmin}</b><span>{t('rs.sentGarmin')}</span></div>
    </div>

    <div class="bar">
      <input type="search" placeholder={t('rs.search')} aria-label={t('rs.search')} bind:value={q} />
      <div class="chips" role="group" aria-label={t('rs.type')}>
        <button class="chip" class:on={!only} aria-pressed={!only} onclick={() => (only = null)}>{t('rs.all')} <span>{totals.n}</span></button>
        {#each totals.types as ty (ty.id)}
          <button class="chip" class:on={only === ty.id} aria-pressed={only === ty.id} onclick={() => (only = only === ty.id ? null : ty.id)}>{ty.title} <span>{ty.n}</span></button>
        {/each}
      </div>
    </div>

    {#if picked.size}
      <div class="sel" role="status">
        <span>{t('rs.picked', { n: picked.size })}</span>
        {#if confirming}
          <span class="ask">{t('rs.confirm', { n: picked.size })}</span>
          <button class="danger" onclick={remove}>{t('ic.delete')}</button>
          <button onclick={() => (confirming = false)}>{t('rs.cancel')}</button>
        {:else}
          <button class="danger" onclick={() => (confirming = true)}><Icon name="trash" size={15} /> {t('rs.delete')}</button>
          <button onclick={() => pickAll(false)}>{t('rs.clear')}</button>
        {/if}
      </div>
    {/if}

    <div class="tbl">
      {#if shown.length}
        <table>
          <thead>
            <tr>
              <th class="ck"><input type="checkbox" aria-label={t('rs.pickAll')} checked={allPicked} onchange={(e) => pickAll(e.currentTarget.checked)} /></th>
              {@render th('name', t('rs.cName'))}
              {@render th('type', t('rs.cType'))}
              {@render th('km', t('unit.km'), true)}
              {@render th('up', '↑ ' + t('unit.m'), true)}
              <th scope="col" class="surf">{t('rs.cSurface')}</th>
              {@render th('time', t('rs.cTime'), true)}
              {@render th('made', t('rs.cMade'))}
              {@render th('garmin', 'Garmin')}
            </tr>
          </thead>
          <tbody>
            {#each shown as x (x.r.id)}
              <tr class:current={x.r.id === currentId} class:picked={picked.has(x.r.id)}>
                <td class="ck"><input type="checkbox" aria-label={t('rs.pick', { name: x.r.name })} checked={picked.has(x.r.id)} onchange={(e) => pick(x.r.id, e.currentTarget.checked)} /></td>
                <td class="nm"><button onclick={() => openRow(x.r)} data-tip={t('mine.open')}>{x.r.name}</button></td>
                <td class="ty" data-l={t('rs.cType')}>{title(x.type)}</td>
                <td class="num" data-l={t('unit.km')}>{km(x.s.km)}{#if !x.s.full}<span class="soft" title={t('rs.straightKm')}>*</span>{/if}</td>
                <td class="num" data-l={'↑ ' + t('unit.m')}>{x.s.full ? Math.round(x.s.ascent) : '—'}</td>
                <td class="surf" data-l={t('rs.cSurface')}>
                  {#if x.s.surface.length}
                    <span class="sb" role="img" aria-label={x.s.surface.map((s) => `${SEG_SHORT[s.cls]} ${Math.round(s.share * 100)}%`).join(', ')}
                      title={x.s.surface.map((s) => `${SEG_SHORT[s.cls]} ${Math.round(s.share * 100)}%`).join(', ')}>
                      {#each x.s.surface as s (s.cls)}<i style="flex:{s.share};background:{segColor(s.cls)}"></i>{/each}
                    </span>
                  {:else}<span class="soft">—</span>{/if}
                </td>
                <td class="num" data-l={t('rs.cTime')}>{x.s.full ? formatDuration(x.s.minutes) : '—'}</td>
                <td data-l={t('rs.cMade')}>{date(made(x.r))}</td>
                <td class="gm" data-l="Garmin">
                  {#if x.r.garmin}<span class="ok" title={x.r.garmin.device ?? 'Garmin Connect'}>✓ {date(x.r.garmin.at)}</span>
                  {:else if x.r.gpxAt}<span class="soft">GPX {date(x.r.gpxAt)}</span>
                  {:else}<span class="soft">—</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">{routes.length ? t('rs.none') : t('mine.empty')}</p>
      {/if}
    </div>
    {#if rows.some((x) => !x.s.full)}<p class="note">{t('rs.note')}</p>{/if}
  </div>
</dialog>

<style>
  .rs {
    border: 0;
    padding: 0;
    width: min(1100px, calc(100% - 32px));
    height: min(860px, calc(100% - 48px));
    max-width: none;
    max-height: none;
    background: var(--paper);
    color: var(--ink);
    border-radius: 18px;
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.35);
  }
  .rs::backdrop {
    background: rgb(10 10 10 / 0.35);
  }
  .in {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 12px 18px 14px;
    box-sizing: border-box;
    gap: 12px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .x {
    border: 0;
    background: none;
    color: var(--ink);
    width: 36px;
    height: 36px;
    border-radius: 10px;
    cursor: pointer;
  }
  .x:hover {
    background: var(--tint);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .tile {
    background: var(--tint);
    border-radius: 12px;
    padding: 10px 12px;
    display: grid;
    gap: 2px;
  }
  .tile b {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.03em;
  }
  .tile span {
    font-size: 12px;
    color: var(--soft);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  input[type='search'] {
    flex: 0 1 260px;
    min-width: 0;
    font: inherit;
    font-size: 14px;
    padding: 7px 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    font: inherit;
    font-size: 13px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    border-radius: 999px;
    padding: 5px 11px;
    cursor: pointer;
  }
  .chip span {
    color: var(--soft);
    margin-left: 2px;
  }
  .chip.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper);
  }
  .chip.on span {
    color: inherit;
    opacity: 0.7;
  }
  .sel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    background: var(--tint);
    border-radius: 10px;
    padding: 6px 10px;
  }
  .sel button {
    font: inherit;
    font-size: 13px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    border-radius: 8px;
    padding: 4px 10px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .sel .danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  }
  .sel .ask {
    font-weight: 600;
  }
  .tbl {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--line);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  thead th {
    position: sticky;
    top: 0;
    background: var(--paper);
    z-index: 1;
    text-align: left;
    font-weight: 500;
    color: var(--soft);
    font-size: 12px;
    padding: 0;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  thead th button {
    font: inherit;
    color: inherit;
    border: 0;
    background: none;
    padding: 8px 8px;
    cursor: pointer;
    width: 100%;
    text-align: inherit;
  }
  thead th[aria-sort='ascending'] button,
  thead th[aria-sort='descending'] button {
    color: var(--ink);
    font-weight: 600;
  }
  thead th.surf {
    padding: 8px;
  }
  th.num,
  td.num {
    text-align: right;
  }
  td {
    padding: 7px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .ck {
    width: 28px;
    padding-left: 4px;
    padding-right: 0;
  }
  thead th.ck {
    padding: 8px 0 8px 4px;
  }
  td.nm {
    white-space: normal;
    width: 34%;
  }
  td.nm button {
    font: inherit;
    font-weight: 500;
    color: var(--ink);
    border: 0;
    background: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
  }
  td.nm button:hover {
    text-decoration: underline;
  }
  tr.current td.nm button::after {
    content: ' •';
    color: #e2b400;
  }
  tr.picked td {
    background: var(--tint);
  }
  .sb {
    display: flex;
    gap: 1px;
    width: 120px;
    height: 8px;
  }
  .sb i {
    display: block;
    height: 100%;
    min-width: 2px;
    border-radius: 1px;
  }
  .ok {
    color: #2e8b57;
  }
  .soft {
    color: var(--soft);
  }
  .empty,
  .note {
    color: var(--soft);
    font-size: 12.5px;
    margin: 12px 4px 0;
  }
  .note {
    margin: 0;
  }

  /* phones: full screen, rows as cards */
  @media (max-width: 639px) {
    .rs {
      width: 100%;
      height: 100%;
      border-radius: 0;
      margin: 0;
    }
    .in {
      padding: 10px 12px;
    }
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    input[type='search'] {
      flex: 1 1 100%;
    }
    thead tr {
      display: flex;
      flex-wrap: wrap;
      gap: 0 2px;
    }
    thead th.surf {
      display: none;
    }
    thead th {
      position: static;
      border: 0;
    }
    thead th button {
      padding: 6px 6px;
    }
    thead {
      position: sticky;
      top: 0;
      background: var(--paper);
      z-index: 1;
      border-bottom: 1px solid var(--line);
      display: block;
    }
    table,
    tbody {
      display: block;
    }
    tbody tr {
      display: grid;
      grid-template-columns: 28px repeat(3, minmax(0, 1fr));
      gap: 2px 6px;
      padding: 8px 0;
      border-bottom: 1px solid var(--line);
    }
    td {
      border: 0;
      padding: 0;
      text-align: left !important;
      font-size: 13px;
    }
    td[data-l]::before {
      content: attr(data-l);
      display: block;
      font-size: 10.5px;
      color: var(--soft);
    }
    td.ck {
      grid-column: 1;
      grid-row: 1 / span 4;
      padding-top: 2px;
    }
    td.nm {
      grid-column: 2 / -1;
      width: auto;
    }
    td.surf {
      grid-column: 2 / -1;
    }
    .sb {
      width: 100%;
    }
  }
</style>

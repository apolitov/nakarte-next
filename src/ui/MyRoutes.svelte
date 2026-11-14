<script lang="ts">
  import type { RouteDoc } from '../lib/store';
  import type { Track } from '../lib/gpx';
  import { haversine } from '../lib/profile';
  import { dec } from '../lib/timeline';
  import { t, LOCALE } from '../lib/i18n';
  import { PROFILES, normalizeProfile } from '../lib/brouter';
  import Icon from './Icon.svelte';
  import InlineConfirm from './InlineConfirm.svelte';

  let {
    routes,
    tracks,
    currentId,
    placing,
    onopen,
    ondelete,
    onnew,
    onopenfile,
    onopentrack,
    onzoomtrack,
    onexporttrack,
    onremovetrack,
    onplace,
    onall,
  }: {
    routes: RouteDoc[];
    tracks: Track[];
    currentId: string;
    placing: string | null;
    onopen: (r: RouteDoc) => void;
    ondelete: (r: RouteDoc) => void;
    onnew: () => void;
    onopenfile: () => void;
    onopentrack: (t: Track) => void;
    onzoomtrack: (t: Track) => void;
    onexporttrack: (t: Track) => void;
    onremovetrack: (t: Track) => void;
    onplace: (trackId: string) => void;
    onall?: () => void;
  } = $props();

  /** id of the route or track whose deletion is being confirmed */
  let ask = $state<string | null>(null);
  const thisYear = new Date().getFullYear();
  const date = (ms: number) =>
    ms ? new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', ...(new Date(ms).getFullYear() !== thisYear ? { year: 'numeric' } : {}) }) : '';
  const made = (r: RouteDoc) => r.created ?? r.updated;
  /** routes by type (Road, Gravel, MTB, Hike), the newest first in each */
  const groups = $derived(
    PROFILES.map((p) => ({
      id: p.id,
      title: p.title,
      items: routes.filter((r) => normalizeProfile(r.profile ?? '') === p.id).sort((a, b) => made(b) - made(a)),
    })).filter((g) => g.items.length),
  );
  function trackKm(tr: Track) {
    let m = 0;
    for (const l of tr.lines)
      for (let i = 1; i < l.length; i++)
        m += haversine({ lng: l[i - 1][0], lat: l[i - 1][1], ele: null }, { lng: l[i][0], lat: l[i][1], ele: null });
    return `${dec(m / 1000)} ${t('unit.km')}`;
  }
</script>

<div class="mine">
  {#if onall && routes.length > 1}
    <button class="allr" onclick={onall} data-tip={t('mine.allTip')}><Icon name="fit" size={14} />{t('mine.all')} <span>{routes.length}</span></button>
  {/if}
  {#each groups as g (g.id)}
    <h3>{g.title} <span class="cnt">{g.items.length}</span></h3>
    <ul class="list">
      {#each g.items as r (r.id)}
        <li class="item" class:current={r.id === currentId}>
          <i class="dot route"></i>
          <button class="name" onclick={() => onopen(r)} data-tip={t('mine.open')}>
            <b data-open={t('mine.opened')}>{r.name}</b><small>{t('mine.created', { date: date(made(r)) })} · {t('mine.points', { n: r.waypoints.length })}</small>
          </button>
          <button class="ib" aria-expanded={ask === r.id} aria-label={t('mine.deleteNamed', { name: r.name })} data-tip={t('mine.delete')} onclick={() => (ask = ask === r.id ? null : r.id)}><Icon name="trash" size={16} /></button>
        </li>
        {#if ask === r.id}
          <li><InlineConfirm text={t('mine.confirmDelete', { name: r.name })} action={t('ic.delete')}
            onconfirm={() => { ask = null; ondelete(r); }} oncancel={() => (ask = null)} /></li>
        {/if}
      {/each}
    </ul>
  {/each}
  {#if tracks.length}
    <h3>{t('mine.tracks')} <span class="cnt">{tracks.length}</span></h3>
    <ul class="list">
      {#each tracks as tr (tr.id)}
        <li class="item trk">
          <i class="dot track"></i>
          <button class="name" onclick={() => onopentrack(tr)} data-tip={t('mine.openTrack')}>
            <b>{tr.name}</b><small>{trackKm(tr)}{tr.points.length ? ` · ${t('mine.cps', { n: tr.points.length })}` : ''}</small>
          </button>
          <span class="tacts">
            <button class="ib txt" class:on={placing === tr.id} aria-pressed={placing === tr.id} data-tip={t('mine.addCpTip')}
              onclick={() => onplace(tr.id)}>{t('mine.addCp')}</button>
            <button class="ib txt" data-tip={t('mine.gpxTip')} onclick={() => onexporttrack(tr)}>GPX</button>
            <button class="ib" aria-expanded={ask === tr.id} aria-label={t('mine.deleteTrack', { name: tr.name })} data-tip={t('mine.delete')} onclick={() => (ask = ask === tr.id ? null : tr.id)}><Icon name="trash" size={16} /></button>
          </span>
        </li>
        {#if ask === tr.id}
          <li><InlineConfirm text={t('mine.confirmDeleteTrack', { name: tr.name })} action={t('ic.delete')}
            onconfirm={() => { ask = null; onremovetrack(tr); }} oncancel={() => (ask = null)} /></li>
        {/if}
      {/each}
    </ul>
  {/if}
  {#if !routes.length && !tracks.length}
    <p class="empty">{t('mine.empty')}</p>
  {/if}
  <div class="newrow">
    <button class="newr" onclick={onnew}><Icon name="plus" size={16} />{t('mine.new')}</button>
    <button class="newr" onclick={onopenfile}><Icon name="file" size={16} />{t('mine.openFile')}</button>
  </div>
</div>

<style>
  .allr {
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    border-radius: 999px;
    padding: 4px 10px;
    margin: 4px 0 2px;
    cursor: pointer;
  }
  .allr span {
    color: var(--soft);
  }
  .allr:hover {
    background: var(--tint);
  }
  h3 {
    margin: 8px 0 2px;
    font-size: 12px;
    font-weight: 600;
    color: var(--soft);
  }
  h3 .cnt {
    font-weight: 500;
    opacity: 0.7;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .item {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 2px 0 2px 2px;
    border-radius: 8px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .dot.route {
    background: var(--ink);
  }
  .dot.track {
    background: #e0218a;
  }
  .name {
    min-width: 0;
    text-align: left;
    padding: 4px 4px;
    border-radius: 8px;
  }
  .name:hover {
    background: var(--tint2);
  }
  .name b {
    display: block;
    font-weight: 600;
    font-size: 13px;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .current .name b::after {
    content: ' · ' attr(data-open);
    font-weight: 400;
    color: var(--soft);
  }
  .name small {
    color: var(--soft);
    font-size: 12px;
  }
  .tacts {
    display: flex;
    gap: 2px;
  }
  .trk .tacts {
    grid-column: 2 / -1;
    margin-top: -4px;
  }
  .ib {
    min-width: 30px;
    height: 30px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    color: var(--soft);
  }
  .ib:hover {
    background: var(--tint2);
    color: var(--ink);
  }
  .ib.txt {
    padding: 0 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--ink);
  }
  .ib.on {
    background: var(--marker);
    color: var(--marker-ink);
  }
  .empty {
    margin: 6px 0;
    font-size: 12.5px;
    color: var(--soft);
  }
  .newrow {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 8px;
  }
  .newr {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 34px;
    border: 1px dashed var(--soft);
    border-radius: 10px;
    font-weight: 600;
    font-size: 12.5px;
  }
  .newr:hover {
    background: var(--tint2);
  }
</style>

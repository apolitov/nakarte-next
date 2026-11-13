<script lang="ts">
  import { t } from '../lib/i18n';
  import type { Profile } from '../lib/profile';
  import { SURFACE_DASH } from '../lib/profile';
  import { kindSvg } from '../lib/checkpointKinds';
  import { limitEvents, rails, dec, STRAIGHT_COLOR, type SegClass, type TimelineEvent } from '../lib/timeline';
  import Icon from './Icon.svelte';

  let {
    events,
    profile,
    classes,
    activeD = null,
    pinnedId = null,
    mobile = false,
    routeType = 'nk-road',
    onhover,
    onpick,
  }: {
    events: TimelineEvent[];
    profile: Profile;
    classes: SegClass[];
    activeD?: number | null;
    pinnedId?: string | null;
    mobile?: boolean;
    routeType?: string;
    onhover: (e: TimelineEvent | null) => void;
    onpick: (e: TimelineEvent) => void;
  } = $props();

  const ROW = 28;
  let boxH = $state(0);
  let expanded = $state(false);

  // two views: key (start, finish, checkpoints, climbs, straight legs, long surface runs) and all
  const VIEW_KEY = 'nk-tl-view';
  let view = $state<'key' | 'all'>('key');
  try {
    if (localStorage.getItem(VIEW_KEY) === 'all') view = 'all';
  } catch {
    /* no storage */
  }
  function setView(v: 'key' | 'all') {
    view = v;
    expanded = false;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* no storage */
    }
  }
  /** a surface run is a key stretch when it is a sizeable part of the route */
  const keyEvents = $derived(
    events.filter((e) => e.kind !== 'surface' || (e.d2 ?? e.d) - e.d >= Math.max(1000, profile.length * 0.15)),
  );
  const pool = $derived(view === 'key' ? keyEvents : events);
  let list: HTMLUListElement | undefined = $state();

  const capacity = $derived(mobile ? 12 : Math.floor(boxH / ROW));
  const shown = $derived.by(() => {
    if (expanded || pool.length <= capacity) return pool;
    // too little room even for start, finish and the "more" row: only that row
    if (capacity < 3) return [];
    return limitEvents(pool, capacity - 1);
  });
  const hidden = $derived(pool.length - shown.length);
  const railList = $derived(rails(shown, profile, classes, routeType));

  /** Row of the stretch that contains the hovered distance. */
  const activeRow = $derived.by(() => {
    if (activeD == null) return -1;
    let cur = -1;
    shown.forEach((e, n) => {
      if (e.d <= activeD + 1) cur = n;
    });
    return cur;
  });

  $effect(() => {
    // keep the active row visible when the list scrolls
    const n = activeRow;
    if (n < 0 || !list || list.scrollHeight <= list.clientHeight + 2) return;
    const li = list.children[n] as HTMLElement | undefined;
    if (!li) return;
    if (li.offsetTop < list.scrollTop || li.offsetTop + ROW > list.scrollTop + list.clientHeight)
      list.scrollTop = li.offsetTop - list.clientHeight / 2;
  });

  function mask(c: SegClass): string {
    const d = c === 'straight' ? [2, 2] : c === 'unknown' ? [1, 0] : SURFACE_DASH[c];
    if (d[1] === 0) return '';
    const on = Math.max(2, d[0] * 4), off = Math.max(3, d[1] * 4);
    const g = `repeating-linear-gradient(180deg,#000 0 ${on}px,transparent ${on}px ${on + off}px)`;
    return `-webkit-mask:${g};mask:${g};`;
  }
  const kmText = (m: number) => dec(m / 1000);
</script>

<section class="tl" class:mobile aria-label={t('tl.title')}>
  <h2>{t('tl.title')}
    <span class="vw" role="group" aria-label={t('tl.view')}>
      <button aria-pressed={view === 'key'} data-tip={t('tl.keyTip')} onclick={() => setView('key')}>{t('tl.key')}</button>
      <button aria-pressed={view === 'all'} data-tip={t('tl.allTip')} onclick={() => setView('all')}>{t('tl.all')}</button>
    </span>
  </h2>
  <div class="box" bind:clientHeight={boxH}>
    <ul class="evs" class:scroll={expanded} bind:this={list} onpointerleave={() => onhover(null)}>
      {#each shown as e, n (e.id)}
        {@const r = railList[n]}
        <li>
          <button class="ev" class:on={n === activeRow && pinnedId !== e.id} class:pin={pinnedId === e.id}
            aria-pressed={pinnedId === e.id} onpointerenter={() => onhover(e)} onfocus={() => onhover(e)}
            onblur={() => queueMicrotask(() => onhover(null))} onclick={() => onpick(e)}>
            {#if r}
              <span class="rail" class:flat={r.flat} style="--c:{r.color};{mask(r.surface)}"></span>
            {:else}<span></span>{/if}
            {#if e.kind === 'start'}
              <span class="eico start"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="#fff" /></svg></span>
            {:else if e.kind === 'end'}
              <span class="eico end"><svg width="10" height="10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="1.5" fill="#fff" /></svg></span>
            {:else if e.kind === 'checkpoint'}
              <span class="eico cp">{@html kindSvg(e.cpKind ?? 'generic', 12)}</span>
            {:else if e.kind === 'climb'}
              <span class="eico climb"><Icon name="climb" size={14} stroke={2.4} /></span>
            {:else if e.kind === 'poi'}
              <span class="eico poi" aria-hidden="true">{e.icon}</span>
            {:else}
              {@const c = e.surface ?? 'unknown'}
              {@const d = c === 'straight' ? [2, 2] : c === 'unknown' ? [1, 0] : SURFACE_DASH[c]}
              <span class="eico"><svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3"
                stroke={c === 'straight' ? STRAIGHT_COLOR : 'currentColor'} stroke-width="3"
                stroke-dasharray={d[1] === 0 ? 'none' : d.map((v) => v * 3.5).join(' ')} /></svg></span>
            {/if}
            <span class="tx">{e.label}</span>
            <span class="km num">{kmText(e.d)}</span>
          </button>
        </li>
      {/each}
      {#if hidden > 0}
        <li><button class="more" onclick={() => (expanded = true)}>{shown.length ? t('tl.more', { n: hidden }) : t('tl.cramped', { n: hidden })}</button></li>
      {:else if expanded && pool.length > capacity}
        <li><button class="more" onclick={() => (expanded = false)}>{t('tl.less')}</button></li>
      {/if}
    </ul>
  </div>
</section>

<style>
  .tl {
    display: flex;
    flex-direction: column;
    /* the heading and one line stay visible; nothing spills under the buttons below */
    min-height: 56px;
    overflow: hidden;
    flex: 1;
  }
  .vw {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--tint);
  }
  .vw button {
    padding: 2px 8px;
    border-radius: 6px;
    font: 600 11.5px/1.4 var(--sans);
    color: var(--soft);
  }
  .vw button[aria-pressed='true'] {
    background: var(--paper);
    color: var(--ink);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  }
  h2 {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--soft);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  h2 {
    white-space: nowrap;
  }
  h2 span {
    font-weight: 400;
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .box {
    position: relative;
    flex: 1;
    min-height: 28px;
  }
  .evs {
    position: absolute;
    inset: 0;
    list-style: none;
    margin: 0 -6px;
    padding: 0 6px 0 0;
    overflow: hidden;
  }
  .evs.scroll {
    overflow: auto;
    scrollbar-width: thin;
  }
  .mobile {
    flex: none;
  }
  .mobile .box {
    min-height: 0;
  }
  .mobile .evs {
    position: static;
  }
  .ev {
    display: grid;
    grid-template-columns: 14px 20px minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 28px;
    padding: 0 6px 0 2px;
    border-radius: 8px;
    text-align: left;
  }
  .ev:hover,
  .ev.on {
    background: var(--tint);
  }
  .ev.on .tx {
    font-weight: 600;
  }
  .ev.pin {
    background: var(--marker);
    color: var(--marker-ink);
  }
  .ev.pin .km {
    color: var(--marker-ink);
  }
  .rail {
    align-self: stretch;
    justify-self: center;
    width: 4px;
    margin-bottom: -14px;
    margin-top: 14px;
    background: var(--c, #999);
  }
  .rail.flat {
    box-shadow: inset 0 0 0 1px #26262b;
  }
  .eico {
    position: relative;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
  }
  .eico.start {
    background: #16a34a;
  }
  .eico.end {
    background: #dc2626;
  }
  .eico.cp {
    background: var(--paper);
    color: var(--ink);
    border: 1.5px solid var(--ink);
    border-radius: 6px;
  }
  .tx {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .km {
    font-size: 11.5px;
    color: var(--soft);
  }
  .more {
    width: 100%;
    height: 28px;
    padding: 0 8px 0 42px;
    border-radius: 8px;
    text-align: left;
    font-size: 13px;
    font-weight: 600;
    color: var(--soft);
  }
  .more:hover {
    background: var(--tint);
    color: var(--ink);
  }
  .eico.poi {
    background: none;
    font-size: 13px;
  }
</style>

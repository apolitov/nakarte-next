<script lang="ts">
  // The loop planner, a mode of the panel: first where the ride starts (my location or a point
  // on the map), then distance and direction, then the three loops found (lib/loops.ts).
  import { t } from '../lib/i18n';
  import { dec } from '../lib/timeline';
  import type { LoopCandidate } from '../lib/loops';
  import Icon from './Icon.svelte';
  import Segmented from './Segmented.svelte';

  let {
    km = $bindable(30),
    bearing = $bindable<number | null>(null),
    typeTitle,
    summary,
    busy,
    progress,
    error,
    candidates,
    active,
    colors,
    start,
    startName,
    picking,
    onfind,
    onpick,
    onhover,
    onlocate,
    onpickmap,
    onclose,
  }: {
    km: number;
    bearing: number | null;
    typeTitle: string;
    summary: string;
    busy: boolean;
    progress: [number, number];
    error: string;
    candidates: LoopCandidate[];
    active: number | null;
    colors: string[];
    start: { lng: number; lat: number } | null;
    startName: string;
    picking: boolean;
    onfind: () => void;
    onpick: (i: number) => void;
    onhover: (i: number | null) => void;
    onlocate: () => void;
    onpickmap: () => void;
    onclose: () => void;
  } = $props();

  const DIRS = [
    ['any', t('loop.any')],
    ['0', 'N'],
    ['90', 'E'],
    ['180', 'S'],
    ['270', 'W'],
  ] as const;
  const dir = $derived(bearing == null ? 'any' : String(bearing));
</script>

<section class="loop" aria-label={t('loop.title')}>
  <button class="back" onclick={onclose}><Icon name="chevron" size={14} stroke={2.4} />{t('loop.back')}</button>
  <h2>{t('loop.title')}</h2>

  {#if !start}
    <p class="q">{t('loop.where')}</p>
    <button class="go" onclick={onlocate}><Icon name="locate" size={16} />{t('loop.locate')}</button>
    <button class="sec" class:on={picking} aria-pressed={picking} onclick={onpickmap}>{t('loop.pickMap')}</button>
    <p class="hint">{t('loop.pickHelp')}</p>
  {:else}
    <p class="from">{startName ? t('loop.fromPlace', { place: startName }) : t('loop.fromMarker')} ·
      <button class="lnk" onclick={onpickmap}>{t('loop.changeStart')}</button> ·
      <button class="lnk" onclick={onlocate}>{t('loop.locate')}</button></p>
  {/if}

  <div class="form" class:off={!start}>
    <div class="lbl"><label for="nk-loop-km">{t('loop.distance')}</label><output for="nk-loop-km" class="num">{km} {t('unit.km')}</output></div>
    <input id="nk-loop-km" type="range" min="10" max="150" step="5" bind:value={km} disabled={busy || !start} />
    <div class="lbl">{t('loop.direction')}</div>
    <Segmented name="loopdir" label={t('loop.direction')} value={dir} items={DIRS} disabled={busy || !start}
      onchange={(v) => (bearing = v === 'any' ? null : Number(v))} />
    <p class="hint">{typeTitle} · {summary}</p>
    <button class="go" onclick={onfind} disabled={busy || !start}>
      {#if busy}
        {t('loop.finding')} <span class="num">{progress[0]}/{progress[1]}</span>
      {:else}
        <Icon name="loop" size={16} />{candidates.length ? t('loop.findAgain') : t('loop.find')}
      {/if}
    </button>
    {#if busy}<div class="pb" aria-hidden="true"><i style="width:{progress[1] ? (100 * progress[0]) / progress[1] : 0}%"></i></div>{/if}
  </div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}

  {#if candidates.length && !busy}
    <ul class="cands">
      {#each candidates as c, i (i)}
        <li>
          <button class="cand" class:on={active === i} onclick={() => onpick(i)}
            onmouseenter={() => onhover(i)} onmouseleave={() => onhover(null)} onfocus={() => onhover(i)} onblur={() => onhover(null)}>
            <i class="sw" style="background:{colors[i]}"></i>
            <span class="main"><b class="num">{dec(c.km)} {t('unit.km')}</b> <span class="num">↑{Math.round(c.ascent)} {t('unit.m')}</span></span>
            <span class="sub">{t('loop.heat', { p: Math.round(c.heat * 100) })} · {c.repeat >= 0.05 ? t('loop.repeat', { p: Math.round(c.repeat * 100) }) : t('loop.noRepeat')}</span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="hint">{t('loop.pickHint')}</p>
  {/if}
</section>

<style>
  .loop {
    display: grid;
    gap: 6px;
    flex: none;
  }
  .back {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font: 500 13px/1.2 var(--sans);
    color: var(--soft);
    padding: 4px 6px 4px 0;
  }
  .back :global(svg) {
    transform: rotate(90deg);
  }
  .back:hover {
    color: var(--ink);
  }
  h2 {
    margin: 0 0 2px;
    font-size: 18px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .q {
    margin: 2px 0 2px;
    font-size: 14px;
  }
  .from {
    margin: 0;
    font-size: 13px;
    color: var(--soft);
    line-height: 1.5;
  }
  .lnk {
    font: inherit;
    color: var(--ink);
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .form {
    display: grid;
    gap: 4px;
  }
  .form.off {
    opacity: 0.45;
  }
  .lbl {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 8px 0 2px;
    font-size: 13.5px;
    font-weight: 500;
  }
  input[type='range'] {
    width: 100%;
  }
  .go,
  .sec {
    height: 40px;
    border-radius: 12px;
    font: 600 14px/1 var(--sans);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
  }
  .go {
    margin-top: 6px;
    background: var(--ink);
    color: var(--paper);
  }
  .go:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .sec {
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font-weight: 500;
  }
  .sec.on {
    border-color: var(--ink);
    background: var(--marker);
  }
  .pb {
    height: 3px;
    background: var(--tint);
    border-radius: 2px;
    overflow: hidden;
  }
  .pb i {
    display: block;
    height: 100%;
    background: var(--marker);
    transition: width 0.3s;
  }
  .err {
    color: var(--danger);
    font-size: 12.5px;
    margin: 4px 0 0;
  }
  .hint {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--soft);
    line-height: 1.45;
  }
  .cands {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .cand {
    width: 100%;
    display: grid;
    grid-template-columns: 12px 1fr;
    column-gap: 8px;
    align-items: center;
    text-align: left;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    border-radius: 12px;
    padding: 8px 10px;
    font: inherit;
    cursor: pointer;
  }
  .cand:hover,
  .cand.on {
    border-color: var(--ink);
  }
  .sw {
    grid-row: span 2;
    width: 12px;
    height: 12px;
    border-radius: 4px;
  }
  .main {
    font-size: 14px;
  }
  .main b {
    font-weight: 600;
  }
  .main span {
    color: var(--soft);
    margin-left: 6px;
  }
  .sub {
    font-size: 12px;
    color: var(--soft);
  }
</style>

<script lang="ts">
  // The loop generator's card: distance, direction, then the three loops found (lib/loops.ts).
  // The start is the map centre, marked by a crosshair while the card is open.
  import { t } from '../lib/i18n';
  import { dec } from '../lib/timeline';
  import type { LoopCandidate } from '../lib/loops';
  import Icon from './Icon.svelte';
  import Segmented from './Segmented.svelte';

  let {
    km = $bindable(30),
    height = $bindable(0),
    bearing = $bindable<number | null>(null),
    typeTitle,
    busy,
    progress,
    error,
    candidates,
    active,
    colors,
    mobile = false,
    onfind,
    onpick,
    onhover,
    onlocate,
    onclose,
  }: {
    km: number;
    height?: number;
    bearing: number | null;
    typeTitle: string;
    busy: boolean;
    progress: [number, number];
    error: string;
    candidates: LoopCandidate[];
    active: number | null;
    colors: string[];
    mobile?: boolean;
    onfind: () => void;
    onpick: (i: number) => void;
    onhover: (i: number | null) => void;
    onlocate: () => void;
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
  // phone: once loops are found the form folds into one line, so the map shows them
  let changing = $state(false);
  const folded = $derived(mobile && candidates.length > 0 && !busy && !changing);
  $effect(() => {
    if (busy) changing = false;
  });
</script>

<section class="loop" class:mobile aria-label={t('loop.title')} bind:offsetHeight={height}>
  <header>
    <h2>{t('loop.title')}</h2>
    <button class="x" aria-label={t('lay.close')} onclick={onclose}><Icon name="close" size={18} /></button>
  </header>
  {#if folded}
    <p class="from">{km} {t('unit.km')} · {DIRS.find(([v]) => v === dir)?.[1]} · {typeTitle}
      <button class="loc" onclick={() => (changing = true)}>{t('loop.change')}</button></p>
  {:else}
  <p class="from">{t('loop.from', { type: typeTitle })}
    <button class="loc" onclick={onlocate} data-tip={t('loop.locateTip')}><Icon name="locate" size={14} />{t('loop.locate')}</button></p>

  <div class="lbl"><label for="nk-loop-km">{t('loop.distance')}</label><output for="nk-loop-km" class="num">{km} {t('unit.km')}</output></div>
  <input id="nk-loop-km" type="range" min="10" max="150" step="5" bind:value={km} disabled={busy} />

  <div class="lbl">{t('loop.direction')}</div>
  <Segmented name="loopdir" label={t('loop.direction')} value={dir} items={DIRS} disabled={busy}
    onchange={(v) => (bearing = v === 'any' ? null : Number(v))} />

  <button class="go" onclick={onfind} disabled={busy}>
    {#if busy}
      {t('loop.finding')} <span class="num">{progress[0]}/{progress[1]}</span>
    {:else}
      <Icon name="loop" size={16} />{candidates.length ? t('loop.again') : t('loop.find')}
    {/if}
  </button>
  {#if busy}<div class="pb" aria-hidden="true"><i style="width:{progress[1] ? (100 * progress[0]) / progress[1] : 0}%"></i></div>{/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  {/if}

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
    {#if !folded}<p class="hint">{t('loop.pickHint')}</p>{/if}
  {/if}
</section>

<style>
  .loop {
    position: absolute;
    z-index: 5;
    top: 64px;
    left: 12px;
    width: 300px;
    max-height: calc(100% - 140px);
    overflow: auto;
    background: var(--paper);
    color: var(--ink);
    border-radius: 16px;
    box-shadow: var(--shadow);
    padding: 8px 14px 12px;
    box-sizing: border-box;
  }
  .loop.mobile {
    top: auto;
    left: 10px;
    right: 64px;
    bottom: 86px;
    width: auto;
    max-height: calc(100% - 160px);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
  }
  .x {
    border: 0;
    background: none;
    color: var(--ink);
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
  }
  .x:hover {
    background: var(--tint);
  }
  .from {
    margin: 2px 0 6px;
    font-size: 12.5px;
    color: var(--soft);
    line-height: 1.5;
  }
  .loc {
    font: inherit;
    font-size: 12.5px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: none;
    color: var(--ink);
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    padding: 0;
    cursor: pointer;
  }
  .lbl {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 10px 0 5px;
    font-size: 13.5px;
    font-weight: 500;
  }
  input[type='range'] {
    width: 100%;
  }
  .go {
    margin-top: 12px;
    width: 100%;
    height: 40px;
    border: 0;
    border-radius: 12px;
    background: var(--ink);
    color: var(--paper);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
  }
  .go:disabled {
    opacity: 0.75;
    cursor: progress;
  }
  .pb {
    height: 3px;
    background: var(--tint);
    border-radius: 2px;
    margin-top: 6px;
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
    margin: 8px 0 0;
  }
  .cands {
    list-style: none;
    margin: 10px 0 0;
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
  .hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--soft);
  }
</style>

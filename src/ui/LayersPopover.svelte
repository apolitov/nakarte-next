<script lang="ts">
  // Compact dropdowns at the top right, as in nakarte: one for the base map, one for
  // overlays. Overlays are grouped by activity, the current profile's activity first.
  import { t } from '../lib/i18n';
  import { LAYERS, type LayerDef } from '../lib/layers';
  import type { ColorMode } from '../lib/routeEditor';
  import Icon from './Icon.svelte';

  let {
    mode,
    profile,
    base,
    overlays,
    colorMode,
    pinned,
    canPin = true,
    onpin,
    onbase,
    onoverlay,
    oncolormode,
    onclose,
  }: {
    mode: 'base' | 'over';
    profile: string;
    base: string;
    overlays: string[];
    colorMode: ColorMode;
    pinned: boolean;
    canPin?: boolean;
    onpin: () => void;
    onbase: (id: string) => void;
    onoverlay: (id: string) => void;
    oncolormode: (m: ColorMode) => void;
    onclose: () => void;
  } = $props();

  const groups = Object.entries(
    LAYERS.filter((l) => l.kind === 'base').reduce<Record<string, LayerDef[]>>((acc, l) => ((acc[l.group] ??= []).push(l), acc), {}),
  );
  const ACT: Record<string, string> = { bike: t('lay.actBike'), hike: t('lay.actHike'), all: t('lay.actAll') };
  const overGroups = $derived.by(() => {
    const mine = profile === 'nk-hike' ? 'hike' : 'bike';
    const order = [mine, mine === 'bike' ? 'hike' : 'bike', 'all'];
    return order
      .map((a) => [ACT[a], LAYERS.filter((l) => l.kind === 'overlay' && (l.activity ?? 'all') === a)] as const)
      .filter(([, items]) => items.length);
  });
  const MODES: [ColorMode, string][] = [
    ['grade', t('lay.colorGrade')],
    ['surface', t('lay.colorSurface')],
    ['plain', t('lay.colorPlain')],
  ];
</script>

<div class="lpop" class:over={mode === 'over'} id="nk-layers" role="dialog" aria-label={mode === 'base' ? t('lay.base') : t('lay.overlays')}>
  <div class="top">
    <h3>{mode === 'base' ? t('lay.base') : t('lay.overlays')}</h3>
    {#if canPin}<button class="x" aria-pressed={pinned} aria-label={t('lay.pin')} title={t('lay.pin')} onclick={onpin}><Icon name="pin" size={16} /></button>{/if}
    <button class="x" aria-label={t('lay.close')} onclick={onclose}><Icon name="close" size={16} /></button>
  </div>
  {#if mode === 'base'}
    {#each groups as [group, items] (group)}
      <h4>{group}</h4>
      {#each items as l (l.id)}
        <label class="row"><input type="radio" name="nk-base" value={l.id} checked={base === l.id} onchange={() => onbase(l.id)} /><span>{l.title}</span></label>
      {/each}
    {/each}
  {:else}
    {#each overGroups as [group, items] (group)}
      <h4>{group}</h4>
      {#each items as l (l.id)}
        <label class="row"><input type="checkbox" value={l.id} checked={overlays.includes(l.id)} onchange={() => onoverlay(l.id)} /><span>{l.title}</span></label>
      {/each}
    {/each}
    <h4>{t('lay.coloring')}</h4>
    {#each MODES as [m, label] (m)}
      <label class="row"><input type="radio" name="nk-color" value={m} checked={colorMode === m} onchange={() => oncolormode(m)} /><span>{label}</span></label>
    {/each}
  {/if}
</div>

<style>
  .lpop {
    position: absolute;
    top: 64px;
    right: 0;
    z-index: 5;
    width: 220px;
    /* stops above the zoom and location buttons in the bottom right corner */
    max-height: calc(100% - 200px - var(--prof-h, 0px));
    overflow: auto;
    background: var(--paper);
    /* one column glued to the right edge of the screen */
    border-radius: 12px 0 0 12px;
    box-shadow: var(--shadow);
    padding: 6px 6px 8px;
    font-size: 13px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 0 2px 8px;
  }
  h3 {
    margin: 0;
    flex: 1;
    font-size: 13px;
    font-weight: 650;
  }
  .x {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    color: var(--soft);
  }
  .x:hover {
    background: var(--tint);
    color: var(--ink);
  }
  .x[aria-pressed='true'] {
    background: var(--marker);
    color: var(--marker-ink);
  }
  h4 {
    margin: 8px 8px 2px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--soft);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 2px 8px;
    border-radius: 7px;
    cursor: pointer;
  }
  .row:hover {
    background: var(--tint);
  }
  .row input {
    margin: 0;
    accent-color: var(--ink);
    cursor: pointer;
  }
  .row:has(input:checked) span {
    font-weight: 600;
  }
  .row:has(input:focus-visible) {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  @media (max-width: 639px) {
    .lpop {
      /* one sheet for every menu: from the left margin to the column of buttons, which stays
         visible and shows which menu is open; level with the first button */
      top: 62px;
      left: 10px;
      right: 64px;
      width: auto;
      max-height: calc(100% - 150px);
      border-radius: 14px;
    }
    .row {
      min-height: 36px;
    }
  }
</style>

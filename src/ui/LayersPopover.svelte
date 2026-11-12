<script lang="ts">
  import { t } from '../lib/i18n';
  import { LAYERS, type LayerDef } from '../lib/layers';
  import type { ColorMode } from '../lib/routeEditor';
  import Icon from './Icon.svelte';

  let {
    base,
    overlays,
    colorMode,
    pinned,
    onpin,
    onbase,
    onoverlay,
    oncolormode,
    onclose,
  }: {
    base: string;
    overlays: string[];
    colorMode: ColorMode;
    pinned: boolean;
    onpin: () => void;
    onbase: (id: string) => void;
    onoverlay: (id: string) => void;
    oncolormode: (m: ColorMode) => void;
    onclose: () => void;
  } = $props();

  const groups = Object.entries(
    LAYERS.filter((l) => l.kind === 'base').reduce<Record<string, LayerDef[]>>((acc, l) => ((acc[l.group] ??= []).push(l), acc), {}),
  );
  const over = LAYERS.filter((l) => l.kind === 'overlay');
  const MODES: [ColorMode, string][] = [
    ['grade', t('lay.colorGrade')],
    ['surface', t('lay.colorSurface')],
    ['plain', t('lay.colorPlain')],
  ];
</script>

<div class="lpop" id="nk-layers" role="dialog" aria-label={t('lay.title')}>
  <div class="top">
    <h3>{t('lay.title')}</h3>
    <div class="btns">
      <button class="x" aria-pressed={pinned} aria-label={pinned ? t('lay.unpin') : t('lay.pin')} title={pinned ? t('lay.unpin') : t('lay.pin')} onclick={onpin}><Icon name="pin" size={18} /></button>
      <button class="x" aria-label={t('lay.close')} onclick={onclose}><Icon name="close" size={18} /></button>
    </div>
  </div>
  {#if over.length}
    <div class="grp">
      <h4>{t('lay.overlays')}</h4>
      <div class="items">
        {#each over as l (l.id)}
          <label class="it"><input type="checkbox" value={l.id} checked={overlays.includes(l.id)} onchange={() => onoverlay(l.id)} /><span>{l.title}</span></label>
        {/each}
      </div>
    </div>
  {/if}
  {#each groups as [group, items] (group)}
    <div class="grp">
      <h4>{group}</h4>
      <div class="items">
        {#each items as l (l.id)}
          <label class="it"><input type="radio" name="nk-base" value={l.id} checked={base === l.id} onchange={() => onbase(l.id)} /><span>{l.title}</span></label>
        {/each}
      </div>
    </div>
  {/each}
  <div class="grp">
    <h4>{t('lay.coloring')}</h4>
    <div class="items">
      {#each MODES as [m, label] (m)}
        <label class="it"><input type="radio" name="nk-color" value={m} checked={colorMode === m} onchange={() => oncolormode(m)} /><span>{label}</span></label>
      {/each}
    </div>
  </div>
</div>

<style>
  .lpop {
    position: absolute;
    top: 64px;
    right: 12px;
    z-index: 5;
    width: min(400px, calc(100% - 24px));
    /* stops above the zoom and location buttons in the bottom right corner */
    max-height: calc(100% - 200px - var(--prof-h, 0px));
    overflow: auto;
    background: var(--paper);
    border-radius: 16px;
    box-shadow: var(--shadow);
    padding: 10px 16px 4px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 650;
  }
  .x {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    color: var(--soft);
  }
  .btns {
    display: flex;
    gap: 2px;
  }
  .x[aria-pressed='true'] {
    background: var(--marker);
    color: var(--marker-ink);
  }
  .x:hover {
    background: var(--tint);
    color: var(--ink);
  }
  .grp {
    margin: 0 0 12px;
  }
  h4 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--soft);
  }
  .items {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .it {
    position: relative;
  }
  .it input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .it span {
    display: flex;
    align-items: center;
    min-height: 32px;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--tint);
    font-size: 13.5px;
  }
  .it input:checked + span {
    background: var(--marker);
    color: var(--marker-ink);
    font-weight: 600;
  }
  .it input:focus-visible + span {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .it:hover input:not(:checked) + span {
    background: var(--tint2);
  }
  @media (max-width: 639px) {
    .lpop {
      top: 60px;
      right: 10px;
      max-height: calc(100% - 70px);
    }
  }
</style>

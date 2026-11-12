<script lang="ts">
  import { t } from '../lib/i18n';
  import type { RouteOptions } from '../lib/brouter';
  import Segmented from './Segmented.svelte';

  let {
    options,
    hike = false,
    onchange,
  }: { options: RouteOptions; hike?: boolean; onchange: (patch: Partial<RouteOptions>) => void } = $props();

  // the slider shows the value while dragging; the route is rebuilt on release
  let grade = $state(0);
  $effect(() => {
    grade = options.maxGrade;
  });
</script>

<div class="lbl">{t('set.surface')}</div>
<Segmented name="surf" label={t('set.surface')} value={options.surface}
  items={[[-1, t('set.surfPaved')], [0, t('set.surfAny')], [1, t('set.surfDirt')]] as const}
  onchange={(v) => onchange({ surface: v })} />
<div class="lbl">{t('set.climbs')}</div>
<Segmented name="climbs" label={t('set.climbs')} value={options.climbs} disabled={options.maxGrade > 0}
  items={[['less', t('set.climbsLess')], ['normal', t('set.climbsNormal')], ['any', t('set.climbsAny')]] as const}
  onchange={(v) => onchange({ climbs: v })} />
<div class="lbl"><label for="nk-steep">{t('set.maxGrade')}</label><output for="nk-steep" class="num">{grade ? `${grade}%` : t('set.noLimit')}</output></div>
<input id="nk-steep" type="range" min="0" max="20" step="1" value={options.maxGrade}
  oninput={(e) => (grade = Number(e.currentTarget.value))}
  onchange={(e) => onchange({ maxGrade: Number(e.currentTarget.value) })} />

{#if !hike}
  <label class="sw">
    <input type="checkbox" role="switch" checked={options.cycleways} onchange={(e) => onchange({ cycleways: e.currentTarget.checked })} />
    <span class="tr" aria-hidden="true"></span>
    <span class="t">{t('set.cycleways')}<small>{t('set.cyclewaysHint')}</small></span>
  </label>
{/if}

<style>
  .sw {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-top: 12px;
    cursor: pointer;
    position: relative;
  }
  .sw input {
    position: absolute;
    opacity: 0;
    width: 36px;
    height: 22px;
    margin: 0;
    cursor: pointer;
  }
  .tr {
    flex: none;
    width: 36px;
    height: 22px;
    border-radius: 999px;
    background: var(--line);
    box-shadow: inset 0 0 0 1px var(--soft);
    position: relative;
    transition: background-color 0.12s;
  }
  .tr::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--paper);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    transition: transform 0.12s;
  }
  .sw input:checked + .tr {
    background: var(--marker);
    box-shadow: inset 0 0 0 1px var(--marker-ink);
  }
  .sw input:checked + .tr::after {
    transform: translateX(14px);
    background: var(--marker-ink);
  }
  .sw input:focus-visible + .tr {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .t {
    font-size: 13px;
    font-weight: 500;
    line-height: 1.3;
  }
  .t small {
    display: block;
    font-weight: 400;
    font-size: 12px;
    color: var(--soft);
  }
  .lbl {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 10px 0 5px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--soft);
  }
  output {
    color: var(--marker-ink);
    font-weight: 600;
    background: var(--marker);
    padding: 0 6px;
    border-radius: 4px;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--ink);
    height: 22px;
    margin: 0;
  }
  :global(.fb) {
    --seg-bg: var(--tint2);
    --seg-hover: var(--line);
  }
</style>

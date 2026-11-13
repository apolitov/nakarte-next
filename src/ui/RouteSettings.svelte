<script lang="ts">
  import { t } from '../lib/i18n';
  import { SAC_STEPS, ALLOW_KEYS, ALLOW_FOR, type RouteOptions, type AllowKey, type Surface, type Climbs, CLIMB_STEPS } from '../lib/brouter';
  import Segmented from './Segmented.svelte';

  let {
    options,
    hike = false,
    cycle = true,
    profile = '',
    onchange,
  }: { options: RouteOptions; hike?: boolean; cycle?: boolean; profile?: string; onchange: (patch: Partial<RouteOptions>) => void } = $props();

  const ALLOW_TEXT: Record<AllowKey, [string, string]> = {
    steps: [t('set.allowSteps'), t('set.allowStepsHint')],
    ferry: [t('set.allowFerry'), t('set.allowFerryHint')],
    busy: [t('set.allowBusy'), t('set.allowBusyHint')],
    unpaved: [t('set.allowUnpaved'), t('set.allowUnpavedHint')],
    paths: [t('set.allowPaths'), t('set.allowPathsHint')],
  };
  const allowKeys = $derived(ALLOW_KEYS.filter((k) => ALLOW_FOR[k].includes(profile)));

  const SAC_TEXT: Record<number, [string, string]> = {
    2: [t('set.sac2'), t('set.sacHint2')],
    3: [t('set.sac3'), t('set.sacHint3')],
    4: [t('set.sac4'), t('set.sacHint4')],
    6: [t('set.sac6'), t('set.sacHint6')],
  };

  // the slider shows the value while dragging; the route is rebuilt on release
  const SURF_LABEL: Record<Surface, string> = {
    [-2]: t('set.surfOnlyAsphalt'),
    [-1]: t('set.surfPaved'),
    0: t('set.surfAny'),
    1: t('set.surfDirt'),
    2: t('set.surfTrails'),
  };
  const CLIMB_LABEL: Record<Climbs, string> = {
    avoid: t('set.climbsAvoid'),
    less: t('set.climbsLess'),
    normal: t('set.climbsNormal'),
    any: t('set.climbsAny'),
    seek: t('set.climbsSeek'),
  };
  let climb = $state<Climbs>('normal');
  $effect(() => {
    climb = options.climbs;
  });
  let surf = $state<Surface>(0);
  $effect(() => {
    surf = options.surface;
  });
  let grade = $state(0);
  $effect(() => {
    grade = options.maxGrade;
  });
</script>

<div class="lbl"><label for="nk-surf">{t('set.surface')}</label><output for="nk-surf">{SURF_LABEL[surf]}</output></div>
<input id="nk-surf" class="surf" type="range" min="-2" max="2" step="1" value={options.surface}
  aria-valuetext={SURF_LABEL[surf]}
  oninput={(e) => (surf = Number(e.currentTarget.value) as Surface)}
  onchange={(e) => onchange({ surface: Number(e.currentTarget.value) as Surface })} />
<div class="ends"><span>{t('set.surfAsphalt')}</span><span>{t('set.surfTrails')}</span></div>
<div class="lbl"><label for="nk-climbs">{t('set.climbs')}</label>
  <output for="nk-climbs" title={climb === 'seek' ? t('set.climbsSeekTip') : undefined}>{CLIMB_LABEL[climb]}</output></div>
<input id="nk-climbs" class="surf" type="range" min="0" max="4" step="1" value={CLIMB_STEPS.indexOf(options.climbs)}
  disabled={options.maxGrade > 0} aria-valuetext={CLIMB_LABEL[climb]}
  oninput={(e) => (climb = CLIMB_STEPS[Number(e.currentTarget.value)])}
  onchange={(e) => onchange({ climbs: CLIMB_STEPS[Number(e.currentTarget.value)] })} />
<div class="ends"><span>{t('set.climbsAvoidEnd')}</span><span title={t('set.climbsSeekTip')}>{t('set.climbsSeekEnd')}</span></div>
<div class="lbl"><label for="nk-steep">{t('set.maxGrade')}</label><output for="nk-steep" class="num">{grade ? `${grade}%` : t('set.noLimit')}</output></div>
<input id="nk-steep" type="range" min="0" max="20" step="1" value={options.maxGrade}
  oninput={(e) => (grade = Number(e.currentTarget.value))}
  onchange={(e) => onchange({ maxGrade: Number(e.currentTarget.value) })} />

{#if hike}
  <!-- hiking: how hard a path may be (OSM sac_scale), and what the walk should prefer -->
  <div class="lbl">{t('set.sac')}</div>
  <Segmented name="sac" label={t('set.sac')} value={options.sac}
    items={SAC_STEPS.map((v) => [v, SAC_TEXT[v][0]] as const)}
    onchange={(v) => onchange({ sac: v })} />
  <p class="hint">{SAC_TEXT[options.sac]?.[1] ?? ''}</p>
  {#each [['trails', 'set.trails', 'set.trailsHint'], ['nature', 'set.nature', 'set.natureHint'], ['quiet', 'set.quiet', 'set.quietHint']] as const as [key, title, hint] (key)}
    <label class="sw">
      <input type="checkbox" role="switch" checked={options[key]} onchange={(e) => onchange({ [key]: e.currentTarget.checked })} />
      <span class="tr" aria-hidden="true"></span>
      <span class="t">{t(title)}<small>{t(hint)}</small></span>
    </label>
  {/each}
{/if}

{#if allowKeys.length}
  <!-- what the route may use at all: unticked = never, even if the way round is long -->
  <div class="lbl">{t('set.allowed')}</div>
  <ul class="allow">
    {#each allowKeys as k (k)}
      <li>
        <label>
          <input type="checkbox" checked={options.allow[k]} onchange={(e) => onchange({ allow: { ...options.allow, [k]: e.currentTarget.checked } })} />
          <span>{ALLOW_TEXT[k][0]}<small>{ALLOW_TEXT[k][1]}</small></span>
        </label>
      </li>
    {/each}
  </ul>
{/if}

{#if cycle}
  <!-- road and gravel only: MTB and hiking route as their stock profiles -->
  <label class="sw">
    <input type="checkbox" role="switch" checked={options.cycleways} onchange={(e) => onchange({ cycleways: e.currentTarget.checked })} />
    <span class="tr" aria-hidden="true"></span>
    <span class="t">{t('set.cycleways')}<small>{t('set.cyclewaysHint')}</small></span>
  </label>
{/if}

<style>
  .allow {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .allow label {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
    font-size: 13.5px;
  }
  .allow input {
    margin: 2px 0 0;
    width: 16px;
    height: 16px;
    accent-color: var(--ink);
    flex: none;
  }
  .allow small {
    display: block;
    font-size: 12px;
    color: var(--soft);
  }
  .hint {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--soft);
  }
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
  .surf {
    width: 100%;
  }
  .ends {
    display: flex;
    justify-content: space-between;
    margin-top: -2px;
    font-size: 11px;
    color: var(--soft);
  }
</style>

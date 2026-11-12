<script lang="ts">
  import { t } from '../lib/i18n';
  import { GRADE_CLASSES, SURFACE_DASH, type Profile } from '../lib/profile';
  import { SEG_ORDER, SEG_SHORT, STRAIGHT_COLOR, dec, type SegClass } from '../lib/timeline';
  import ElevationProfile from './ElevationProfile.svelte';
  import Icon from './Icon.svelte';

  let {
    open = $bindable(true),
    profile,
    classes,
    marks,
    maxGrade,
    hoverIdx,
    band,
    mobile = false,
    onhover,
    onpick,
  }: {
    open?: boolean;
    profile: Profile;
    classes: SegClass[];
    marks: { d: number; kind: string; name: string }[];
    maxGrade: number;
    hoverIdx: number | null;
    band: [number, number] | null;
    mobile?: boolean;
    onhover: (i: number | null) => void;
    onpick: (i: number) => void;
  } = $props();

  /** Climbing stretches steeper than the limit. */
  const steep = $derived.by(() => {
    if (!maxGrade) return { count: 0, length: 0 };
    const { dist, grade } = profile;
    let count = 0, length = 0, inside = false;
    for (let i = 1; i < dist.length; i++) {
      const over = (grade[i] ?? 0) > maxGrade;
      if (over) {
        length += dist[i] - dist[i - 1];
        if (!inside) count++;
      }
      inside = over;
    }
    return { count, length };
  });
  const present = $derived(SEG_ORDER.filter((c) => classes.slice(1).includes(c)));
  const plural = (n: number) => (n === 1 ? t('prof.stretch1') : t('prof.stretchN'));
  const dash = (c: SegClass) => (c === 'straight' ? [2, 2] : c === 'unknown' ? [1, 0] : SURFACE_DASH[c]);
</script>

<section class="prof" class:shut={!open} class:mobile aria-label={t('prof.title')}>
  <div class="ph">
    <h2>{t('prof.title')}</h2>
    <div class="lim">
      {#if maxGrade}
        {t('prof.steep', { g: maxGrade })}
        {steep.count ? t('prof.steepSome', { n: steep.count, stretches: plural(steep.count), km: dec(steep.length / 1000) }) : t('prof.steepNone')}
      {:else if profile.maxEle != null}
        <span class="num">{t('prof.range', { lo: Math.round(profile.minEle ?? 0), hi: Math.round(profile.maxEle) })}</span>
      {/if}
    </div>
    <button class="pcol" aria-expanded={open} aria-label={open ? t('prof.collapse') : t('prof.expand')}
      data-tip={open ? t('prof.collapse') : t('prof.expand')} onclick={() => (open = !open)}>
      <Icon name="chevron" size={18} stroke={2.4} />
    </button>
  </div>
  {#if open}
    <ElevationProfile {profile} {classes} {marks} {maxGrade} {hoverIdx} {band} height={mobile ? 140 : 150} {onhover} {onpick} />
    <div class="leg">
      {#each GRADE_CLASSES as g, i (g.min)}
        <span class="lg"><i style="background:{g.color}{i === 2 ? ';box-shadow:inset 0 0 0 1.5px #26262b' : ''}"></i>{g.title}</span>
      {/each}
      <span class="sp"></span>
      {#each present as c (c)}
        {@const d = dash(c)}
        <span class="lg"><svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="24" y2="4"
          stroke={c === 'straight' ? STRAIGHT_COLOR : c === 'unknown' ? 'var(--line)' : 'currentColor'} stroke-width="3"
          stroke-dasharray={d[1] === 0 ? 'none' : d.map((v) => v * 3.5).join(' ')} /></svg>{SEG_SHORT[c]}</span>
      {/each}
      {#if maxGrade}
        <span class="lg"><svg width="14" height="12" aria-hidden="true"><rect width="14" height="12" rx="2" fill="#e4e2dc" /><path
          d="M-1 8L8-1M-1 13L13-1M5 13L15 3" stroke="#141414" stroke-opacity=".6" stroke-width="1.4" /></svg>{t('prof.overLimit')}</span>
      {/if}
    </div>
  {/if}
</section>

<style>
  .prof {
    background: var(--paper);
    border-radius: 16px;
    box-shadow: var(--shadow);
    padding: 6px 14px 10px;
  }
  .prof.shut {
    padding-bottom: 6px;
  }
  .prof.mobile {
    box-shadow: none;
    background: var(--tint);
    padding: 6px 10px 8px;
    flex: none;
  }
  .ph {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
  }
  h2 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 650;
    white-space: nowrap;
  }
  .lim {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: var(--soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lim .num {
    font-weight: 500;
    color: var(--ink);
  }
  .pcol {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .pcol:hover {
    background: var(--tint);
  }
  .pcol :global(svg) {
    transition: transform 0.15s;
  }
  .shut .pcol :global(svg) {
    transform: rotate(180deg);
  }
  .leg {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 14px;
    padding-top: 6px;
    font-size: 12px;
    color: var(--soft);
    line-height: 1.4;
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .lg i {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    display: inline-block;
  }
  .lg svg {
    color: var(--ink);
  }
  .sp {
    width: 100%;
    height: 0;
  }
</style>

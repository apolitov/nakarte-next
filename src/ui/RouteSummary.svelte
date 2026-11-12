<script lang="ts">
  import { t } from '../lib/i18n';
  import type { Profile } from '../lib/profile';
  import { SURFACE_DASH } from '../lib/profile';
  import { estimateMinutes, formatDuration, AVG_SPEED } from '../lib/eta';
  import { surfaceShares, SEG_SHORT, STRAIGHT_COLOR, dec, type SegClass } from '../lib/timeline';
  import { PROFILES } from '../lib/brouter';

  let {
    profile,
    profileId,
    classes,
    loading = false,
    error = '',
  }: { profile: Profile; profileId: string; classes: SegClass[]; loading?: boolean; error?: string } = $props();

  const km = $derived(profile.length / 1000);
  const minutes = $derived(estimateMinutes(profile.length, profile.ascent, profileId));
  const typeTitle = $derived(PROFILES.find((p) => p.id === profileId)?.title ?? '');
  const shares = $derived(surfaceShares(profile.dist, classes));

  function dash(c: SegClass): number[] | null {
    if (c === 'straight') return [2, 2];
    if (c === 'unknown') return null;
    const d = SURFACE_DASH[c];
    return d[1] === 0 ? null : d;
  }
  function barStyle(c: SegClass) {
    const col = c === 'straight' ? STRAIGHT_COLOR : c === 'unknown' ? 'var(--line)' : 'var(--ink)';
    const d = dash(c);
    if (!d) return `background:${col}`;
    const f = 3;
    return `background:repeating-linear-gradient(90deg,${col} 0 ${d[0] * f}px,transparent ${d[0] * f}px ${(d[0] + d[1]) * f}px)`;
  }
  const pct = (s: number) => Math.max(1, Math.round(s * 100));
</script>

<section class="sum" aria-label={t('sum.label')}>
  <div class="row1">
    <div class="big num">{km ? dec(km) : '0'}<small>{t('unit.km')}</small></div>
    <div class="st num" data-tip={t('sum.etaTip', { type: typeTitle.toLowerCase(), speed: String(AVG_SPEED[profileId] ?? 18) })}>
      {#if loading}<span class="soft">{t('sum.computing')}</span>{:else}<em>~</em>{formatDuration(minutes)}{/if}
    </div>
  </div>
  <div class="row2">
    <div class="st num"><em>↑</em>{Math.round(profile.ascent)} {t('unit.m')}</div>
    <div class="st num"><em>↓</em>{Math.round(profile.descent)} {t('unit.m')}</div>
  </div>
  {#if error}<div class="err" role="alert">{t('route.error', { error })}</div>{/if}
  {#if shares.length}
    <div class="cov" role="img" aria-label={t('sum.surface', { list: shares.map((s) => `${SEG_SHORT[s.cls]} ${pct(s.share)}%`).join(', ') })}>
      {#each shares as s (s.cls)}<i style="flex:{s.m};{barStyle(s.cls)}"></i>{/each}
    </div>
    <div class="covl">
      {#each shares as s (s.cls)}
        {@const d = dash(s.cls)}
        <span data-tip={SEG_SHORT[s.cls]}>
          <svg width="12" height="6" aria-hidden="true"><line x1="0" y1="3" x2="12" y2="3"
            stroke={s.cls === 'straight' ? STRAIGHT_COLOR : s.cls === 'unknown' ? 'var(--soft)' : 'currentColor'} stroke-width="3"
            stroke-dasharray={d ? d.map((v) => v * 3).join(' ') : 'none'} /></svg>
          <b class="num">{pct(s.share)}%</b><span class="sr">{SEG_SHORT[s.cls]}</span>
        </span>
      {/each}
    </div>
  {/if}
</section>

<style>
  .sum {
    display: grid;
    gap: 7px;
    flex: none;
  }
  .row1 {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .row2 {
    display: flex;
    gap: 16px;
  }
  .big {
    font-weight: 600;
    font-size: 32px;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .big small {
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0;
    color: var(--soft);
    margin-left: 3px;
  }
  .st {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
  }
  .st em {
    font-style: normal;
    color: var(--soft);
    font-size: 12px;
    margin-right: 2px;
  }
  .soft {
    color: var(--soft);
    font-size: 12.5px;
  }
  .err {
    color: var(--danger);
    font-size: 12.5px;
  }
  .cov {
    display: flex;
    height: 8px;
    gap: 2px;
  }
  .cov i {
    display: block;
    height: 100%;
    min-width: 3px;
    border-radius: 1px;
  }
  .covl {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    font-size: 12px;
    color: var(--soft);
  }
  .covl > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ink);
  }
  .covl b {
    font-weight: 500;
    font-size: 11.5px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>

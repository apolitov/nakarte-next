<script lang="ts">
  import { FERRY_COLOR } from '../lib/profile';
  import { t } from '../lib/i18n';
  import type { Profile } from '../lib/profile';
  import { routeMinutes, formatDuration, BIKES } from '../lib/eta';
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
  const minutes = $derived(routeMinutes(profile, profileId));
  const typeTitle = $derived(PROFILES.find((p) => p.id === profileId)?.title ?? '');
  const shares = $derived(surfaceShares(profile.dist, classes));

  // colours instead of dash patterns: a dashed bar this thin cannot be read
  const SURF_COLOR: Record<SegClass, string> = {
    paved: 'var(--ink)',
    compact: '#7d8b99',
    unpaved: '#c99a1e',
    ground: '#9a5a2c',
    path: '#4e8a3a',
    ferry: FERRY_COLOR,
    straight: STRAIGHT_COLOR,
    unknown: 'var(--line)',
  } as Record<SegClass, string>;
  const color = (c: SegClass) => SURF_COLOR[c] ?? 'var(--line)';
  const pct = (s: number) => Math.max(1, Math.round(s * 100));
</script>

<section class="sum" aria-label={t('sum.label')}>
  <div class="row1">
    <div class="big num">{km ? dec(km) : '0'}<small>{t('unit.km')}</small></div>
    <div class="st num">
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
      {#each shares as s (s.cls)}<i style="flex:{s.m};background:{color(s.cls)}"></i>{/each}
    </div>
    <div class="covl">
      {#each shares as s (s.cls)}
        <span><i class="sw" style="background:{color(s.cls)}"></i>{SEG_SHORT[s.cls]} <b class="num">{pct(s.share)}%</b></span>
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
    height: 10px;
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
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex: none;
  }
  .covl b {
    font-weight: 500;
    font-size: 11.5px;
  }
</style>

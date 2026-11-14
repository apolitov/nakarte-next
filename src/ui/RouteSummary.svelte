<script lang="ts">
  import { t } from '../lib/i18n';
  import type { Profile } from '../lib/profile';
  import { routeMinutes, formatDuration, BIKES } from '../lib/eta';
  import { surfaceShares, surfaceDetails, segColor, SEG_SHORT, dec, type SegClass } from '../lib/timeline';
  import { track } from '../lib/analytics';
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

  const color = segColor;
  const pct = (s: number) => Math.max(1, Math.round(s * 100));

  // the OSM tags behind each surface class, on request
  let details = $state(false);
  const rows = $derived(details ? surfaceDetails(profile.dist, classes, profile.osm) : []);
  const kmText = (m: number) =>
    m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} ${t('unit.m')}` : `${dec(m / 1000, m < 10000 ? 1 : 0)} ${t('unit.km')}`;
  const pctText = (s: number) => (s < 0.005 ? '<1' : String(Math.round(s * 100)));
  const wiki = (tag: string) =>
    tag === 'route=ferry' ? 'https://wiki.openstreetmap.org/wiki/Tag:route%3Dferry' : `https://wiki.openstreetmap.org/wiki/Tag:surface%3D${encodeURIComponent(tag)}`;
  function toggle() {
    details = !details;
    if (details) track('surface_details');
  }
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
      <button class="more" aria-expanded={details} data-tip={t('sum.detailsTip')} onclick={toggle}>{t('sum.details')} <span aria-hidden="true">{details ? '▴' : '▾'}</span></button>
    </div>
    {#if details}
      <table class="det">
        {#each rows as d (d.cls)}
          <tbody>
            <tr class="cl">
              <th scope="rowgroup"><i class="sw" style="background:{color(d.cls)}"></i>{SEG_SHORT[d.cls]}</th>
              <td class="num">{kmText(d.m)}</td><td class="num">{pctText(d.share)}%</td>
            </tr>
            {#each d.items as it (it.tag)}
              <tr>
                <th scope="row" class="tag">
                  {#if d.cls === 'straight'}<span class="soft">{t('sum.handDrawn')}</span>
                  {:else if !it.tag}<span class="soft">{t('sum.noWay')}</span>
                  {:else if it.tag.startsWith('~')}<span class="soft">{t('sum.untagged', { hw: it.tag.slice(1) })}</span>
                  {:else}<a href={wiki(it.tag)} target="_blank" rel="noopener">{it.tag}</a>{/if}
                </th>
                <td class="num">{kmText(it.m)}</td><td class="num">{pctText(it.share)}%</td>
              </tr>
            {/each}
          </tbody>
        {/each}
      </table>
    {/if}
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
  .more {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    font-size: 12px;
    color: var(--soft);
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .more:hover {
    color: var(--ink);
  }
  .det {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .det th {
    text-align: left;
    font-weight: 400;
    padding: 2px 0;
  }
  .det td {
    text-align: right;
    padding: 2px 0 2px 10px;
    white-space: nowrap;
    color: var(--soft);
  }
  .det tr.cl th {
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: 600;
    padding-top: 6px;
  }
  .det tr.cl td {
    padding-top: 6px;
    color: var(--ink);
  }
  .det .tag {
    padding-left: 15px;
    overflow-wrap: anywhere;
  }
  .det .tag a {
    color: var(--ink);
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 11.5px;
    text-decoration: none;
  }
  .det .tag a:hover {
    text-decoration: underline;
  }
  .covl b {
    font-weight: 500;
    font-size: 11.5px;
  }
</style>

<script lang="ts">
  // POIs dropdown at the top right: categories along the route with their counts,
  // the distance from the route, and whether they also go into the timeline.
  import { t } from '../lib/i18n';
  import { CATS, catTitle, PHOTO_SOURCES, type PoiCat, type PhotoSource } from '../lib/along';
  import Icon from './Icon.svelte';

  let {
    enabled,
    counts,
    radius,
    inTimeline,
    loading = false,
    photoZoomHint = false,
    photoSrc = PHOTO_SOURCES,
    onphotosrc,
    error = '',
    pinned,
    canPin = true,
    ontoggle,
    onradius,
    ontimeline,
    onpin,
    onclose,
  }: {
    enabled: PoiCat[];
    counts: Partial<Record<PoiCat, number>>;
    radius: number;
    inTimeline: boolean;
    loading?: boolean;
    photoZoomHint?: boolean;
    photoSrc?: PhotoSource[];
    onphotosrc: (s: PhotoSource) => void;
    error?: string;
    pinned: boolean;
    canPin?: boolean;
    ontoggle: (c: PoiCat) => void;
    onradius: (r: number) => void;
    ontimeline: (on: boolean) => void;
    onpin: () => void;
    onclose: () => void;
  } = $props();

  const GROUPS = [
    ['way', t('poi.groupWay')],
    ['see', t('poi.groupSee')],
    ['photo', t('poi.groupPhotos')],
  ] as const;
  const RADII = [100, 300, 1000];
  const SRC_NAME: Record<PhotoSource, string> = { commons: 'Wikimedia Commons', mapillary: 'Mapillary', panoramax: 'Panoramax' };
  const rlabel = (r: number) => (r < 1000 ? `${r} m` : `${r / 1000} km`);
</script>

<div class="lpop" id="nk-pois" role="dialog" aria-label={t('poi.title')}>
  <div class="top">
    <h3>{t('poi.title')}</h3>
    {#if canPin}<button class="x" aria-pressed={pinned} aria-label={t('lay.pin')} title={t('lay.pin')} onclick={onpin}><Icon name="pin" size={16} /></button>{/if}
    <button class="x" aria-label={t('lay.close')} onclick={onclose}><Icon name="close" size={16} /></button>
  </div>
  <div class="seg" role="radiogroup" aria-label={t('poi.radius')}>
    {#each RADII as r (r)}
      <button role="radio" aria-checked={radius === r} onclick={() => onradius(r)}>{rlabel(r)}</button>
    {/each}
  </div>
  {#each GROUPS as [g, title] (g)}
    <h4>{title}</h4>
    {#each CATS.filter((c) => c.group === g) as c (c.id)}
      <label class="row">
        <input type="checkbox" checked={enabled.includes(c.id)} onchange={() => ontoggle(c.id)} />
        <span class="ic" aria-hidden="true">{c.icon}</span>
        <span class="nm">{catTitle(c.id)}</span>
        <span class="n num">{counts[c.id] ?? (loading ? '…' : '')}</span>
      </label>
      {#if c.id === 'photos' && enabled.includes('photos')}
        <div class="srcs" role="group" aria-label={t('poi.photoSources')}>
          {#each PHOTO_SOURCES as x (x)}
            <label class="sub"><input type="checkbox" checked={photoSrc.includes(x)} onchange={() => onphotosrc(x)} /><span>{SRC_NAME[x]}</span></label>
          {/each}
        </div>
      {/if}
    {/each}
  {/each}
  {#if photoZoomHint}<p class="src">{t('poi.photosZoom')}</p>{/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <label class="row tl">
    <input type="checkbox" checked={inTimeline} onchange={(e) => ontimeline(e.currentTarget.checked)} />
    <span class="nm">{t('poi.inTimeline')}</span>
  </label>
  <p class="src">{t('poi.sources')}</p>
</div>

<style>
  .lpop {
    position: absolute;
    top: 64px;
    right: 0;
    z-index: 5;
    width: 240px;
    max-height: calc(100% - 200px - var(--prof-h, 0px));
    overflow: auto;
    background: var(--paper);
    border-radius: 12px 0 0 12px;
    box-shadow: var(--shadow);
    padding: 6px 6px 8px;
    font-size: 13px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 0 4px 8px;
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
  .seg {
    display: flex;
    gap: 4px;
    padding: 2px 8px 4px;
  }
  .seg button {
    flex: 1;
    min-height: 26px;
    border-radius: 7px;
    background: var(--tint);
    font-size: 12px;
  }
  .seg button[aria-checked='true'] {
    background: var(--ink);
    color: var(--paper);
    font-weight: 600;
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
  .ic {
    width: 18px;
    text-align: center;
  }
  .nm {
    flex: 1;
  }
  .n {
    color: var(--soft);
    font-size: 12px;
  }
  .tl {
    margin-top: 6px;
    border-top: 1px solid var(--line);
    border-radius: 0;
    padding-top: 6px;
  }
  .err {
    margin: 6px 8px 0;
    color: var(--danger);
    font-size: 12px;
  }
  .src {
    margin: 6px 8px 0;
    font-size: 11px;
    color: var(--soft);
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
  .srcs {
    display: grid;
    padding: 0 8px 4px 34px;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    font-size: 12px;
    color: var(--soft);
    cursor: pointer;
  }
  .sub input {
    margin: 0;
    accent-color: var(--ink);
  }
</style>

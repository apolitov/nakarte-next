<script lang="ts">
  // Photos along the route, large, over the map: arrows, buttons or a swipe go to the previous
  // and next photo along the route; Esc or a click outside closes it.
  import { t } from '../lib/i18n';
  import type { Photo } from '../lib/along';
  import Icon from './Icon.svelte';

  let {
    photos,
    index = $bindable(0),
    onclose,
    onshow,
  }: { photos: Photo[]; index?: number; onclose: () => void; onshow?: (p: Photo) => void } = $props();

  const p = $derived(photos[Math.max(0, Math.min(index, photos.length - 1))]);
  const SRC: Record<string, string> = { commons: 'Wikimedia Commons', mapillary: 'Mapillary', panoramax: 'Panoramax' };
  function go(d: number) {
    if (!photos.length) return;
    index = (index + d + photos.length) % photos.length;
  }
  $effect(() => {
    if (p) onshow?.(p);
  });
  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    box?.focus();
  });
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  let x0: number | null = null;
</script>

{#if p}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="pv" role="dialog" aria-modal="true" aria-label={t('poi.photo')} tabindex="-1" bind:this={box} onkeydown={key}
    onclick={(e) => e.target === e.currentTarget && onclose()}>
    <div class="frame">
      <button class="x" aria-label={t('lay.close')} onclick={onclose}><Icon name="close" size={20} /></button>
      <div class="img" role="presentation"
        onpointerdown={(e) => (x0 = e.clientX)}
        onpointerup={(e) => {
          if (x0 != null && Math.abs(e.clientX - x0) > 40) go(e.clientX < x0 ? 1 : -1);
          x0 = null;
        }}>
        <!-- a large version that fails to load falls back to the thumbnail -->
        {#key p.id}<img src={p.sd || p.thumb} alt="" onerror={(e) => { const i = e.currentTarget as HTMLImageElement; if (i.src !== p.thumb) i.src = p.thumb; }} />{/key}
        {#if photos.length > 1}
          <button class="nav prev" aria-label={t('pv.prev')} onclick={() => go(-1)}>‹</button>
          <button class="nav next" aria-label={t('pv.next')} onclick={() => go(1)}>›</button>
        {/if}
      </div>
      <div class="cap">
        <b class="num">{t('poi.atKm', { km: (p.m / 1000).toFixed(1) })}{p.date ? ` · ${p.date}` : ''}</b>
        <span class="num">{index + 1} / {photos.length}</span>
        <small>© {p.author || '?'}{p.license ? `, ${p.license}` : ''} · <a href={p.url} target="_blank" rel="noopener">{SRC[p.src] ?? p.src} ↗</a></small>
      </div>
    </div>
  </div>
{/if}

<style>
  .pv {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: rgb(10 10 10 / 0.72);
    outline: none;
  }
  .frame {
    position: relative;
    width: min(1100px, 94vw);
    max-height: 92vh;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    border-radius: 16px;
    overflow: hidden;
    background: var(--paper);
    box-shadow: var(--shadow);
  }
  .img {
    position: relative;
    display: grid;
    place-items: center;
    background: #111;
    min-height: 240px;
    touch-action: pan-y;
  }
  img {
    display: block;
    max-width: 100%;
    max-height: calc(92vh - 70px);
    object-fit: contain;
  }
  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 64px;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.85);
    color: #141414;
    font-size: 30px;
    line-height: 1;
  }
  .prev {
    left: 10px;
  }
  .next {
    right: 10px;
  }
  .x {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.85);
    color: #141414;
  }
  .cap {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 12px;
    padding: 10px 14px 12px;
    font-size: 13px;
  }
  .cap small {
    grid-column: 1 / -1;
    color: var(--soft);
  }
  .cap span {
    color: var(--soft);
  }
  @media (max-width: 639px) {
    .frame {
      width: 100vw;
      max-height: 100dvh;
      border-radius: 0;
    }
    img {
      max-height: calc(100dvh - 90px);
    }
  }
</style>

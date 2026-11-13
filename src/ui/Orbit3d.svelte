<script lang="ts">
  // The map controls in the bottom right corner, one block for 2D and 3D: the 2D | 3D switch
  // and zoom always; in 3D the block grows upwards with turning, a compass that shows north
  // (click: north up; drag: left/right turns, up/down tilts) and tilt, so the switch and zoom
  // stay where they were. At the bottom: find my location (MapLibre's GeolocateControl does the
  // work, its own button is hidden; this one shows its state).
  import type { Map as MlMap, GeolocateControl } from 'maplibre-gl';
  import { t } from '../lib/i18n';

  let { map, three, onset3d, geo = null }: { map: MlMap; three: boolean; onset3d: (on: boolean) => void; geo?: GeolocateControl | null } = $props();

  // the control's own states: OFF, WAITING_ACTIVE, ACTIVE_LOCK (follows), BACKGROUND (the map was
  // moved away, still tracking), ACTIVE_ERROR / BACKGROUND_ERROR; 'denied' when the browser refuses
  let geoState = $state('OFF');
  const canLocate = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  $effect(() => {
    if (!geo) return;
    const g = geo as unknown as { _watchState?: string; on: GeolocateControl['on']; off: GeolocateControl['off'] };
    const read = () => setTimeout(() => (geoState = g._watchState ?? 'OFF'), 0);
    const err = (e: { code?: number }) => {
      if (e?.code === 1) setTimeout(() => (geoState = 'denied'), 0);
      else read();
    };
    const evs = ['geolocate', 'trackuserlocationstart', 'trackuserlocationend', 'outofmaxbounds'] as const;
    for (const ev of evs) g.on(ev, read);
    g.on('error', err);
    return () => {
      for (const ev of evs) g.off(ev, read);
      g.off('error', err);
    };
  });
  function locate() {
    if (!geo || geoState === 'denied') return;
    geo.trigger();
    geoState = (geo as unknown as { _watchState?: string })._watchState ?? 'OFF';
  }
  const geoTip = $derived(
    geoState === 'denied' ? t('orbit.locateDenied') : geoState === 'ACTIVE_LOCK' ? t('orbit.locateStop') : t('orbit.locate'),
  );

  let bearing = $state(0);
  let pitch = $state(0);
  $effect(() => {
    const upd = () => {
      bearing = map.getBearing();
      pitch = map.getPitch();
    };
    upd();
    map.on('rotate', upd);
    map.on('pitch', upd);
    return () => {
      map.off('rotate', upd);
      map.off('pitch', upd);
    };
  });

  const MAX_PITCH = 80;
  export function turn(deg: number) {
    map.easeTo({ bearing: map.getBearing() + deg, duration: 450 });
  }
  function tilt(deg: number) {
    map.easeTo({ pitch: Math.max(0, Math.min(MAX_PITCH, map.getPitch() + deg)), duration: 350 });
  }

  // compass: a click turns north up, a drag orbits
  let drag: { x: number; y: number; b: number; p: number; moved: boolean } | null = null;
  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, b: map.getBearing(), p: map.getPitch(), moved: false };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    map.jumpTo({ bearing: drag.b - dx * 0.6, pitch: Math.max(0, Math.min(MAX_PITCH, drag.p - dy * 0.4)) });
  }
  function up() {
    if (drag && !drag.moved) map.easeTo({ bearing: 0, duration: 500 });
    drag = null;
  }
</script>

<div class="orbit" role="group" aria-label={t('orbit.title')}>
  {#if three}
    <button class="ob sm" data-tip={t('orbit.left')} aria-label={t('orbit.left')} onclick={() => turn(-45)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v4h4" /></svg>
    </button>
    <button class="ob sm compass" data-tip={t('orbit.compass')} aria-label={t('orbit.north')}
      onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => (drag = null)}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="transform: rotate({-bearing}deg)">
        <path d="M13 3 17 13H9Z" fill="#d1242f" />
        <path d="M13 23 9 13h8Z" fill="currentColor" opacity=".55" />
      </svg>
    </button>
    <button class="ob sm" data-tip={t('orbit.right')} aria-label={t('orbit.right')} onclick={() => turn(45)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4h-4" /></svg>
    </button>
    <span class="sep"></span>
    <button class="ob sm" data-tip={t('orbit.tiltMore')} aria-label={t('orbit.tiltMore')} aria-disabled={pitch >= MAX_PITCH - 0.5} onclick={() => tilt(15)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 19h18L15 7H9Z" /><path d="M12 3v3" /></svg>
    </button>
    <span class="deg num" aria-label={t('orbit.pitch', { d: Math.round(pitch) })}>{Math.round(pitch)}°</span>
    <button class="ob sm" data-tip={t('orbit.tiltLess')} aria-label={t('orbit.tiltLess')} aria-disabled={pitch <= 0.5} onclick={() => tilt(-15)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="9" width="18" height="6" rx="1" /></svg>
    </button>
    <span class="sep"></span>
  {/if}
  <div class="dim" role="group" aria-label={t('map.dim')}>
    <button aria-pressed={!three} data-tip={t('map.2dTip')} onclick={() => onset3d(false)}>2D</button>
    <button aria-pressed={three} data-tip={t('map.3dTip')} onclick={() => onset3d(true)}>3D</button>
  </div>
  <span class="sep"></span>
  <button class="ob" data-tip={t('orbit.zoomIn')} aria-label={t('orbit.zoomIn')} onclick={() => map.zoomIn()}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
  </button>
  <button class="ob" data-tip={t('orbit.zoomOut')} aria-label={t('orbit.zoomOut')} onclick={() => map.zoomOut()}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
  </button>
  {#if geo && canLocate}
    <span class="sep"></span>
    <button class="ob loc" data-state={geoState} data-tip={geoTip} aria-label={geoTip}
      aria-pressed={geoState === 'ACTIVE_LOCK' || geoState === 'BACKGROUND'} aria-disabled={geoState === 'denied'} onclick={locate}>
      <!-- an arrow like the usual "my location" sign; filled while the map follows you -->
      <svg width="18" height="18" viewBox="0 0 24 24" fill={geoState === 'ACTIVE_LOCK' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 4 4 11l7 2 2 7z" /></svg>
    </button>
  {/if}
</div>

<style>
  .orbit {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    backdrop-filter: blur(10px);
    box-shadow: var(--shadow);
    color: var(--ink);
  }
  .ob {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 10px;
  }
  /* the 3D rows are lower, so the grown block still fits above the elevation profile */
  .ob.sm {
    height: 32px;
  }
  .ob:hover {
    background: var(--tint);
  }
  .ob[aria-disabled='true'] {
    opacity: 0.35;
  }
  .compass {
    cursor: grab;
    touch-action: none;
  }
  .compass:active {
    cursor: grabbing;
  }
  .compass svg {
    transition: transform 0.08s linear;
  }
  .sep {
    width: 24px;
    height: 1px;
    margin: 3px 0;
    background: var(--line);
  }
  .dim {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dim button {
    width: 40px;
    height: 32px;
    border-radius: 10px;
    font: 700 13px/1 var(--sans);
    color: var(--soft);
  }
  .dim button:hover {
    background: var(--tint);
  }
  .dim button[aria-pressed='true'] {
    background: var(--marker);
    color: var(--marker-ink);
  }
  /* location: blue while it follows you, outlined blue when the map was moved away,
     pulsing while waiting for a fix, red after an error */
  .loc[data-state='ACTIVE_LOCK'],
  .loc[data-state='BACKGROUND'] {
    color: #1a73e8;
  }
  .loc[data-state='WAITING_ACTIVE'] svg {
    animation: locpulse 1s ease-in-out infinite;
  }
  .loc[data-state='ACTIVE_ERROR'],
  .loc[data-state='BACKGROUND_ERROR'] {
    color: var(--danger);
  }
  @keyframes locpulse {
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .loc[data-state='WAITING_ACTIVE'] svg {
      animation: none;
      opacity: 0.5;
    }
  }
  .deg {
    font-size: 11px;
    color: var(--soft);
  }
  @media (max-width: 639px) {
    .ob {
      width: 44px;
      height: 40px;
    }
  }
</style>

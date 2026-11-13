<script lang="ts">
  // 3D camera without holding a mouse button: steps to turn and tilt, a compass that
  // shows north (click: north up; drag: left/right turns, up/down tilts).
  import type { Map as MlMap } from 'maplibre-gl';
  import { t } from '../lib/i18n';

  let { map }: { map: MlMap } = $props();

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
  <button class="ob" data-tip={t('orbit.left')} aria-label={t('orbit.left')} onclick={() => turn(-45)}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v4h4" /></svg>
  </button>
  <button class="ob compass" data-tip={t('orbit.compass')} aria-label={t('orbit.north')}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => (drag = null)}>
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="transform: rotate({-bearing}deg)">
      <path d="M13 3 17 13H9Z" fill="#d1242f" />
      <path d="M13 23 9 13h8Z" fill="currentColor" opacity=".55" />
    </svg>
  </button>
  <button class="ob" data-tip={t('orbit.right')} aria-label={t('orbit.right')} onclick={() => turn(45)}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4h-4" /></svg>
  </button>
  <span class="sep"></span>
  <button class="ob" data-tip={t('orbit.tiltMore')} aria-label={t('orbit.tiltMore')} aria-disabled={pitch >= MAX_PITCH - 0.5} onclick={() => tilt(15)}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 19h18L15 7H9Z" /><path d="M12 3v3" /></svg>
  </button>
  <span class="deg num" aria-label={t('orbit.pitch', { d: Math.round(pitch) })}>{Math.round(pitch)}°</span>
  <button class="ob" data-tip={t('orbit.tiltLess')} aria-label={t('orbit.tiltLess')} aria-disabled={pitch <= 0.5} onclick={() => tilt(-15)}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="9" width="18" height="6" rx="1" /></svg>
  </button>
  <!-- zoom lives here in 3D: the standard zoom buttons are hidden so the two blocks never overlap -->
  <span class="sep"></span>
  <button class="ob" data-tip={t('orbit.zoomIn')} aria-label={t('orbit.zoomIn')} onclick={() => map.zoomIn()}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
  </button>
  <button class="ob" data-tip={t('orbit.zoomOut')} aria-label={t('orbit.zoomOut')} onclick={() => map.zoomOut()}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
  </button>
</div>

<style>
  .orbit {
    position: absolute;
    right: 12px;
    /* under the layer buttons, as far as possible from the location button at the bottom */
    top: 68px;
    z-index: 4;
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
  .deg {
    font-size: 11px;
    color: var(--soft);
  }
  @media (max-width: 639px) {
    /* below the layer buttons and the 2D | 3D switch, clear of the zoom buttons */
    .orbit {
      right: 10px;
      top: 250px;
      transform: none;
    }
    .ob {
      width: 44px;
      height: 40px;
    }
  }
</style>

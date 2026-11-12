<script lang="ts">
  // One tooltip for every element with data-tip (and optional data-keys:
  // space-separated keycaps). Shown on hover and on keyboard focus.
  let text = $state('');
  let keys = $state<string[]>([]);
  let shown = $state(false);
  let x = $state(0);
  let y = $state(0);
  let el: HTMLDivElement;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function show(t: HTMLElement) {
    const d = t.dataset;
    if (!d.tip) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      text = d.tip!;
      keys = d.keys ? d.keys.split(' ') : [];
      shown = true;
      requestAnimationFrame(() => {
        if (!el || !t.isConnected) return;
        const r = t.getBoundingClientRect();
        const w = el.offsetWidth, h = el.offsetHeight;
        x = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2));
        y = r.bottom + 8 + h > innerHeight - 6 ? r.top - h - 8 : r.bottom + 8;
      });
    }, d.keys ? 150 : 350);
  }
  function hide() {
    clearTimeout(timer);
    shown = false;
  }
  const target = (e: Event) => (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;

  $effect(() => {
    const over = (e: Event) => {
      const t = target(e);
      if (t) show(t);
    };
    const out = (e: Event) => target(e) && hide();
    const focus = (e: Event) => {
      const t = target(e);
      if (t && t.matches(':focus-visible')) show(t);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    // focusout also fires while Svelte removes a focused element: hide after that
    const blur = () => queueMicrotask(hide);
    document.addEventListener('focusout', blur);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
    };
  });
</script>

<div class="kt" bind:this={el} hidden={!shown} style="left:{x}px;top:{y}px" role="tooltip">
  <span>{text}</span>
  {#each keys as k, i (i)}<kbd>{k}</kbd>{/each}
</div>

<style>
  .kt {
    position: fixed;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 10px;
    border-radius: 9px;
    background: var(--tipbg);
    color: var(--tipink);
    font-size: 12.5px;
    pointer-events: none;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
    white-space: nowrap;
  }
  .kt[hidden] {
    display: none;
  }
  .kt span {
    margin-right: 2px;
  }
  .kt kbd {
    background: rgb(128 128 128 / 0.3);
    border-color: rgb(128 128 128 / 0.45);
    color: inherit;
    height: 19px;
  }
  @media (hover: none) {
    .kt {
      display: none !important;
    }
  }
</style>

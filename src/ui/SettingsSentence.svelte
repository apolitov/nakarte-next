<script lang="ts">
  // Route settings as one sentence (lib/settingsSentence.ts): a word opens its choices; the rare
  // ones and "All settings" open the full list.
  import { t } from '../lib/i18n';
  import { sentence, type Word } from '../lib/settingsSentence';
  import type { ProfileId, RouteOptions } from '../lib/brouter';

  let {
    options,
    profile,
    onchange,
    onall,
  }: { options: RouteOptions; profile: ProfileId; onchange: (patch: Partial<RouteOptions>) => void; onall: () => void } = $props();

  const s = $derived(sentence(options, profile));
  let open = $state<string | null>(null);
  let box: HTMLDivElement | undefined = $state();

  function toggle(w: Word) {
    if (!w.choices) return onall();
    open = open === w.id ? null : w.id;
  }
  function choose(w: Word, i: number) {
    onchange(w.choices![i].patch);
    open = null;
  }
  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box?.contains(e.target as Node) && (open = null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), (open = null));
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc, true);
    return () => {
      removeEventListener('pointerdown', away, true);
      removeEventListener('keydown', esc, true);
    };
  });
</script>

<div class="ss" bind:this={box}>
  <div class="k"><span>{t('set.title')}</span><button class="all" onclick={onall}>{t('ss.all')}</button></div>
  <p>
    {s.start}
    {#each s.words as w (w.id)}{w.before}<span class="wrap"><button class="tok" class:def={w.def} class:open={open === w.id}
        aria-haspopup={w.choices ? 'listbox' : undefined} aria-expanded={w.choices ? open === w.id : undefined}
        onclick={() => toggle(w)}>{w.label}</button>{#if open === w.id && w.choices}<span class="pop" role="listbox" aria-label={w.label}>
          {#each w.choices as c, i (i)}
            <button role="option" aria-selected={c.on(options)} class:sel={c.on(options)} onclick={() => choose(w, i)}>
              <span>{c.label}</span>{#if c.def}<small>{t('ss.default')}</small>{/if}
            </button>
          {/each}
        </span>{/if}</span>{/each}.
  </p>
</div>

<style>
  .ss {
    padding: 8px 12px 10px;
    background: var(--tint);
    border-radius: 12px;
  }
  .k {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 12px;
    color: var(--soft);
  }
  .all {
    font: inherit;
    font-size: 12.5px;
    color: var(--ink);
    background: none;
    border: 0;
    padding: 0;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  p {
    margin: 2px 0 0;
    font-size: 14px;
    line-height: 2;
  }
  .wrap {
    position: relative;
    white-space: nowrap;
  }
  .tok {
    font: inherit;
    font-weight: 600;
    color: var(--ink);
    background: none;
    border: 0;
    padding: 0 1px;
    border-bottom: 1.5px dashed #b8901a;
    cursor: pointer;
    line-height: 1.4;
  }
  .tok.def {
    font-weight: 400;
    color: var(--soft);
    border-bottom-color: var(--line);
  }
  .tok:hover,
  .tok.open {
    background: color-mix(in srgb, var(--marker) 35%, transparent);
    border-radius: 4px;
  }
  .pop {
    position: absolute;
    z-index: 6;
    left: 0;
    top: calc(100% + 4px);
    min-width: 200px;
    display: grid;
    background: var(--paper);
    border-radius: 12px;
    box-shadow: var(--shadow);
    padding: 5px;
    white-space: normal;
  }
  .pop button {
    font: inherit;
    font-size: 13.5px;
    line-height: 1.3;
    text-align: left;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    background: none;
    border: 0;
    color: var(--ink);
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
  }
  .pop button:hover {
    background: var(--tint);
  }
  .pop .sel {
    font-weight: 600;
  }
  .pop .sel::after {
    content: '✓';
  }
  .pop small {
    color: var(--soft);
    font-size: 11.5px;
    font-weight: 400;
  }
</style>

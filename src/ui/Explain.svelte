<script lang="ts" module>
  // one explanation open at a time across the page
  let openId = $state<string | null>(null);
</script>

<script lang="ts">
  // A small (?) next to a figure; a tap opens a short note on how the figure was worked out.
  import { t } from '../lib/i18n';

  let { label, text }: { label: string; text: string } = $props();
  const id = `ex-${Math.random().toString(36).slice(2, 8)}`;
  const open = $derived(openId === id);
  let box: HTMLSpanElement | undefined = $state();

  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box?.contains(e.target as Node)) openId = null;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openId = null;
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
    };
  });
</script>

<span class="ex" bind:this={box}>
  <button type="button" class="q" aria-expanded={open} aria-controls={id} aria-label={t('ex.how', { what: label })}
    onclick={(e) => {
      e.stopPropagation();
      openId = open ? null : id;
    }}>?</button>
  {#if open}
    <span class="pop" id={id} role="note">{text}</span>
  {/if}
</span>

<style>
  /* the note opens under the whole row it sits in (the row is the positioned parent),
     so it never runs off a narrow panel */
  .ex {
    display: inline-flex;
    vertical-align: middle;
  }
  .q {
    width: 16px;
    height: 16px;
    margin-left: 4px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font: 600 10.5px/1 var(--sans);
    color: var(--soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--soft) 60%, transparent);
    background: none;
    cursor: pointer;
    letter-spacing: 0;
  }
  /* a bigger target on touch screens without a bigger circle */
  .q::before {
    content: '';
    position: absolute;
    inset: -8px;
  }
  .q:hover,
  .q[aria-expanded='true'] {
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--ink);
  }
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 20;
    font-family: var(--sans);
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--ink);
    color: var(--paper);
    font-size: 12px;
    font-weight: 400;
    line-height: 1.45;
    letter-spacing: 0;
    white-space: normal;
    text-align: left;
    box-shadow: var(--shadow);
  }
</style>

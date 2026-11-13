<script lang="ts">
  import { t } from '../lib/i18n';
  import Icon from './Icon.svelte';

  interface Shortcut {
    title: string;
    keys: string[];
    alt?: string[];
  }
  let { open = $bindable(false), shortcuts }: { open: boolean; shortcuts: Shortcut[] } = $props();
  let dlg: HTMLDialogElement;

  $effect(() => {
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  });
</script>

<dialog bind:this={dlg} class="help" aria-label={t('help.title')} onclose={() => (open = false)}
  onclick={(e) => e.target === dlg && (open = false)}>
  <div class="in">
    <header>
      <h3>{t('help.title')}</h3>
      <button class="x" aria-label={t('lay.close')} onclick={() => (open = false)}><Icon name="close" size={18} /></button>
    </header>
    <div class="grid">
      {#each shortcuts as s (s.title)}
        <div>
          <span>{s.title}</span>
          <span class="ks">
            {#each s.keys as k, i (i)}<kbd>{k}</kbd>{/each}
            {#if s.alt}<span class="or">{t('help.or')}</span>{#each s.alt as k, i (i)}<kbd>{k}</kbd>{/each}{/if}
          </span>
        </div>
      {/each}
    </div>
    <p class="note">{t('help.note')}</p>
    <p class="note"><a href="{import.meta.env.BASE_URL}help/" target="_blank" rel="noopener">{t('help.guide')}</a></p>
  </div>
</dialog>

<style>
  .help {
    border: 0;
    padding: 0;
    width: min(560px, calc(100% - 24px));
    max-height: 80vh;
    background: var(--paper);
    color: var(--ink);
    border-radius: 18px;
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.35);
    margin-top: 12vh;
  }
  .help::backdrop {
    background: rgb(10 10 10 / 0.35);
  }
  .in {
    padding: 8px 12px 12px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h3 {
    margin: 8px 12px;
    font-size: 15px;
  }
  .x {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    color: var(--soft);
  }
  .x:hover {
    background: var(--tint);
    color: var(--ink);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 18px;
    padding: 0 12px;
  }
  .grid div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    border-bottom: 1px solid var(--line);
    font-size: 13.5px;
  }
  .ks {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .or {
    font-size: 12px;
    color: var(--soft);
    margin: 0 2px;
  }
  .ks {
    align-items: center;
  }
  .note {
    margin: 12px 12px 4px;
    font-size: 12.5px;
    color: var(--soft);
  }
  @media (max-width: 639px), (max-height: 480px) and (orientation: landscape) {
    .grid {
      grid-template-columns: 1fr;
    }
    .help {
      margin-top: 6vh;
    }
  }
</style>

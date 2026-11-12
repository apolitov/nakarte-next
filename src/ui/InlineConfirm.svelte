<script lang="ts">
  // Confirmation inside the panel instead of a modal: slides open under the control
  // that asked for it and pushes the controls below down.
  import { slide } from 'svelte/transition';
  import { t } from '../lib/i18n';

  let {
    text,
    action,
    onconfirm,
    oncancel,
  }: { text: string; action: string; onconfirm: () => void; oncancel: () => void } = $props();
  let yes: HTMLButtonElement | undefined = $state();
  $effect(() => {
    yes?.focus();
  });
</script>

<div class="ic" role="alertdialog" tabindex="-1" aria-label={text} transition:slide={{ duration: 160 }}
  onkeydown={(e) => e.key === 'Escape' && (e.stopPropagation(), oncancel())}>
  <p>{text}</p>
  <div class="b">
    <button class="no" onclick={oncancel}>{t('ic.cancel')}</button>
    <button class="yes" bind:this={yes} onclick={onconfirm}>{action}</button>
  </div>
</div>

<style>
  .ic {
    margin: 4px 0 6px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--tint);
    font-size: 12.5px;
    overflow: hidden;
  }
  p {
    margin: 0 0 6px;
    line-height: 1.4;
  }
  .b {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  button {
    min-height: 30px;
    padding: 0 12px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 12.5px;
  }
  .no:hover {
    background: var(--tint2);
  }
  .yes {
    background: var(--danger);
    color: #fff;
  }
</style>

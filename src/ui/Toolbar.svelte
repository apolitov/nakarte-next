<script lang="ts">
  import { t } from '../lib/i18n';
  import Icon from './Icon.svelte';
  import { MOD } from './icons';

  let {
    editing,
    canUndo,
    canRedo,
    hasRoute,
    canLoop,
    straightOn,
    placing,
    layersOpen,
    onedit,
    onundo,
    onredo,
    onreverse,
    onoutback,
    onbacktostart,
    onstraight,
    oncheckpoint,
    onlayers,
    onfit,
    onhelp,
    onloopgen,
  }: {
    editing: boolean;
    canUndo: boolean;
    canRedo: boolean;
    hasRoute: boolean;
    canLoop: boolean;
    straightOn: boolean;
    placing: boolean;
    layersOpen: boolean;
    onedit: () => void;
    onundo: () => void;
    onredo: () => void;
    onreverse: () => void;
    onoutback: () => void;
    onbacktostart: () => void;
    onstraight: () => void;
    oncheckpoint: () => void;
    onlayers: () => void;
    onfit: () => void;
    onhelp: () => void;
    /** the loop generator ("a loop of N km from here") */
    onloopgen?: () => void;
  } = $props();

  let menuOpen = $state(false);
  let menuRoot: HTMLDivElement;
  $effect(() => {
    if (!menuOpen) return;
    const down = (e: PointerEvent) => !menuRoot.contains(e.target as Node) && (menuOpen = false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && ((menuOpen = false), e.stopPropagation());
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key, true);
    };
  });
  const k = (key: string, shift = false) => `${MOD}${shift ? ' ⇧' : ''} ${key}`;
</script>

<div class="tbw" bind:this={menuRoot}>
<div class="tbar" role="toolbar" aria-label={t('tb.label')}>
  <button class="tb" aria-pressed={editing} aria-label={t('tb.edit')} data-tip={editing ? t('tb.editDone') : t('tb.edit')} data-keys="D" onclick={onedit}>
    <Icon name="edit" />
  </button>
  <button class="tb" aria-disabled={!canUndo} aria-label={t('tb.undo')} data-tip={t('tb.undo')} data-keys={k('Z')} onclick={onundo}><Icon name="undo" /></button>
  <button class="tb" aria-disabled={!canRedo} aria-label={t('tb.redo')} data-tip={t('tb.redo')} data-keys={k('Z', true)} onclick={onredo}><Icon name="redo" /></button>
  <div class="split">
    <button class="tb" aria-disabled={!canLoop} aria-label={t('tb.reverse')} data-tip={t('tb.reverse')} data-keys="R" onclick={onreverse}>
      <Icon name="reverse" />
    </button>
    <button class="tb narrow" aria-label={t('tb.more')} aria-haspopup="menu" aria-expanded={menuOpen}
      data-tip={t('tb.moreTip')} onclick={() => (menuOpen = !menuOpen)}><Icon name="chevron" size={14} stroke={2.4} /></button>
  </div>
  <i class="tsep"></i>
  <button class="tb" aria-pressed={straightOn} aria-label={t('tb.straight')}
    data-tip={straightOn ? t('tb.roads') : t('tb.straight')} data-keys="B" onclick={onstraight}><Icon name="straight" /></button>
  <button class="tb" aria-pressed={placing} aria-label={t('tb.checkpoint')} data-tip={t('tb.checkpointTip')} data-keys="P" onclick={oncheckpoint}>
    <Icon name="checkpoint" />
  </button>
  <i class="tsep"></i>
  <button class="tb" aria-disabled={!hasRoute} aria-label={t('tb.fit')} data-tip={t('tb.fitTip')} data-keys="F" onclick={onfit}><Icon name="fit" /></button>
  <i class="tsep"></i>
  <button class="tb" aria-label={t('tb.help')} data-tip={t('tb.help')} data-keys="?" onclick={onhelp}><Icon name="help" /></button>
</div>
    {#if menuOpen}
      <div class="menu" role="menu">
        <button role="menuitem" disabled={!canLoop} onclick={() => { menuOpen = false; onreverse(); }}>
          <Icon name="reverse" size={18} /><span>{t('tb.reverseShort')}</span><kbd>R</kbd>
        </button>
        <button role="menuitem" disabled={!canLoop} onclick={() => { menuOpen = false; onoutback(); }}>
          <Icon name="outback" size={18} /><span>{t('tb.outBack')}</span>
        </button>
        <button role="menuitem" disabled={!canLoop} onclick={() => { menuOpen = false; onbacktostart(); }}>
          <Icon name="loop" size={18} /><span>{t('tb.backToStart')}</span>
        </button>
        {#if onloopgen}
          <button role="menuitem" onclick={() => { menuOpen = false; onloopgen(); }}>
            <Icon name="locate" size={18} /><span>{t('tb.loopGen')}</span>
          </button>
        {/if}
      </div>
    {/if}
</div>

<style>
  .tbw {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 4;
    max-width: calc(100% - 124px); /* room for the two layer buttons */
  }
  .tbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    width: max-content;
    max-width: 100%;
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    backdrop-filter: blur(10px);
    border-radius: 14px;
    box-shadow: var(--shadow);
  }
  .tb {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .tb.narrow {
    width: 20px;
    margin-left: -2px;
    color: var(--soft);
  }
  .tb:hover {
    background: var(--tint);
  }
  .tb[aria-pressed='true'],
  .tb[aria-expanded='true'] {
    background: var(--marker);
    color: var(--marker-ink);
  }
  .tb[aria-disabled='true'] {
    opacity: 0.4;
    cursor: default;
  }
  .tb[aria-disabled='true']:hover {
    background: none;
  }
  .tsep {
    width: 1px;
    height: 22px;
    background: var(--line);
    margin: 0 4px;
    flex: none;
  }
  .split {
    display: flex;
  }
  .menu {
    position: absolute;
    top: 54px;
    left: 112px;
    z-index: 10;
    min-width: 230px;
    padding: 6px;
    border-radius: 14px;
    background: var(--paper);
    box-shadow: var(--shadow);
    border: 1px solid var(--line);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 38px;
    padding: 6px 10px;
    border-radius: 9px;
    text-align: left;
    font-size: 14px;
  }
  .menu button span {
    flex: 1;
  }
  .menu button:hover:not(:disabled) {
    background: var(--tint);
  }
  .menu button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  @media (max-width: 639px), (max-height: 480px) and (orientation: landscape) {
    /* the layer buttons sit below the toolbar on a phone: the whole width is the toolbar's */
    .tbw {
      top: 10px;
      left: 10px;
      max-width: calc(100% - 20px);
    }
    .tbar {
      overflow-x: auto;
      scrollbar-width: none;
      max-width: 100%;
    }
    .tb {
      width: 36px;
      height: 38px;
    }
    .tsep {
      margin: 0 2px;
    }
    .menu {
      left: 0;
    }
  }
  /* 320-360 px phones: all nine buttons fit without scrolling (31 px still beats the 24 px
     minimum touch target) */
  @media (max-width: 360px) {
    .tb {
      width: 31px;
    }
    .tsep {
      margin: 0 1px;
    }
  }
</style>

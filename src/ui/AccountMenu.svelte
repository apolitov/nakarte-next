<script lang="ts">
  import { t } from '../lib/i18n';
  import type { User } from '../lib/account';
  import Icon from './Icon.svelte';

  let {
    user,
    syncState,
    onlogin,
    onlogout,
    onsync,
  }: {
    user: User | null;
    syncState: '' | 'sync' | 'ok' | 'error';
    onlogin: () => void;
    onlogout: () => void;
    onsync: () => void;
  } = $props();

  let open = $state(false);
  let root: HTMLDivElement;

  const initials = $derived(
    (user?.name || user?.user || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join(''),
  );
  const status = $derived(
    syncState === 'sync' ? t('acc.syncing') : syncState === 'error' ? t('acc.syncError') : t('acc.synced'),
  );
  const tip = $derived(user ? `${user.name} · ${status}` : t('acc.login'));

  export function close() {
    open = false;
  }
  export function isOpen() {
    return open;
  }

  $effect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !root.contains(e.target as Node) && (open = false);
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  });
</script>

<div class="acc" bind:this={root}>
  <button class="user" class:busy={syncState === 'sync'} class:err={syncState === 'error'} aria-label={t('acc.label', { status: tip })}
    aria-expanded={open} aria-haspopup="true" data-tip={open ? undefined : tip} onclick={() => (open = !open)}>
    {#if user}
      <span class="ava">{initials || '?'}</span><i class="sdot"></i>
    {:else}
      <span class="ava anon"><Icon name="user" size={16} /></span>
    {/if}
  </button>
  {#if open}
    <div class="pop" role="dialog" aria-label={t('acc.dialog')}>
      {#if user}
        <b>{user.name}</b>
        <span class="st" class:err={syncState === 'error'}><i class="sdot2"></i>{status}</span>
        <div class="btns">
          <button class="pbtn" onclick={() => { onsync(); }}>{t('acc.sync')}</button>
          <button class="pbtn" onclick={onlogout}>{t('acc.logout')}</button>
        </div>
      {:else}
        <span class="st">{t('acc.local')}</span>
        <div class="btns"><button class="pbtn" onclick={onlogin}>{t('acc.login')}</button></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .acc {
    position: relative;
  }
  .user {
    position: relative;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
  }
  .user:hover {
    background: var(--tint);
  }
  .ava {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--ink);
    color: var(--paper);
    display: grid;
    place-items: center;
    font-weight: 600;
    font-size: 11px;
  }
  .ava.anon {
    background: var(--tint2);
    color: var(--ink);
  }
  .sdot {
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--ok);
    border: 2px solid var(--paper);
  }
  .busy .sdot {
    background: var(--marker);
    box-shadow: 0 0 0 1px var(--ink);
  }
  .err .sdot {
    background: var(--danger);
  }
  .pop {
    position: absolute;
    right: 0;
    top: 42px;
    z-index: 20;
    width: 240px;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--paper);
    box-shadow: var(--shadow);
    display: grid;
    gap: 6px;
    border: 1px solid var(--line);
  }
  .pop b {
    font-size: 14px;
  }
  .st {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--soft);
  }
  .sdot2 {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
    flex: none;
  }
  .st.err .sdot2 {
    background: var(--danger);
  }
  .btns {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .pbtn {
    flex: 1;
    min-height: 32px;
    border-radius: 9px;
    background: var(--tint);
    font-weight: 500;
    font-size: 13px;
  }
  .pbtn:hover {
    background: var(--tint2);
  }
</style>

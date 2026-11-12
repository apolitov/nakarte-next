<script lang="ts">
  import { t } from '../lib/i18n';
  import type { User } from '../lib/account';
  import Icon from './Icon.svelte';

  let {
    user,
    syncState,
    onlogin,
    onloginAlt,
    onlogout,
    ondelete,
    onsync,
  }: {
    user: User | null;
    syncState: '' | 'sync' | 'ok' | 'error';
    onlogin: () => void;
    onloginAlt: () => void;
    onlogout: () => void;
    ondelete: () => void;
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
        <button class="danger" onclick={ondelete}>{t('acc.delete')}</button>
      {:else}
        <span class="st">{t('acc.local')}</span>
        <button class="google" onclick={onlogin}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          {t('acc.google')}
        </button>
        <button class="alt" onclick={onloginAlt}>{t('acc.alt')}</button>
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
  .google {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    min-height: 40px;
    margin-top: 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    font-weight: 600;
  }
  .google:hover {
    background: var(--tint);
  }
  .alt,
  .danger {
    margin-top: 8px;
    font-size: 12.5px;
    color: var(--soft);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .danger:hover {
    color: #c0262d;
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

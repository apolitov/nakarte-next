<script lang="ts">
  import { t } from '../lib/i18n';
  // Send to Garmin (beta): connect a Garmin account once, then send routes as courses.
  // The Garmin password goes to our server once for the login and is not stored there.
  let { open = $bindable(false), loggedIn, getRoute, onlogin }: {
    open: boolean;
    loggedIn: boolean;
    getRoute: () => { name: string; gpx: string; profile: string } | null;
    onlogin: () => void;
  } = $props();

  const API = `${import.meta.env.BASE_URL}api/garmin`;
  type Status = { enabled: boolean; connected: boolean; device: string | null };
  let status = $state<Status | null>(null);
  let step = $state<'idle' | 'login' | 'mfa' | 'sending' | 'done'>('idle');
  let email = $state('');
  let password = $state('');
  let code = $state('');
  let error = $state('');
  let result = $state<{ url: string | null; device: string | null } | null>(null);
  let devices = $state<{ id: number; name: string; chosen: boolean }[]>([]);
  /** device id, or 0 = only save in Garmin Connect */
  let deviceId = $state<number>(0);

  async function loadDevices() {
    try {
      devices = await call('/devices');
      deviceId = (devices.find((d) => d.chosen) ?? devices[0])?.id ?? 0;
    } catch {
      devices = [];
    }
  }
  let dlg: HTMLDialogElement;

  async function call(path: string, init?: RequestInit) {
    const r = await fetch(`${API}${path}`, { redirect: 'manual', credentials: 'same-origin', ...init });
    if (r.type === 'opaqueredirect' || r.status === 401 && path === '/status') throw new Error(t('g.needNaCarta'));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || t('g.errorN', { n: r.status }));
    return j;
  }
  const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

  $effect(() => {
    if (open) {
      dlg?.showModal();
      error = '';
      result = null;
      step = 'idle';
      if (loggedIn)
        call('/status').then(
          (s) => {
            status = s;
            if (s.connected) loadDevices();
          },
          (e) => (error = e.message),
        );
    } else dlg?.close();
  });

  async function connect(e: Event) {
    e.preventDefault();
    error = '';
    step = 'login';
    try {
      const r = await call('/login', json({ email, password }));
      password = '';
      if (r.mfa) step = 'mfa';
      else {
        status = { enabled: true, connected: true, device: r.device };
        step = 'idle';
        loadDevices();
      }
    } catch (err) {
      error = (err as Error).message;
      step = 'idle';
    }
  }

  async function sendMfa(e: Event) {
    e.preventDefault();
    error = '';
    try {
      const r = await call('/mfa', json({ code }));
      status = { enabled: true, connected: true, device: r.device };
      step = 'idle';
      code = '';
      loadDevices();
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function send() {
    const r = getRoute();
    if (!r) return;
    error = '';
    step = 'sending';
    try {
      result = await call('/send', json({ ...r, to_device: deviceId > 0, device_id: deviceId || null }));
      step = 'done';
    } catch (err) {
      error = (err as Error).message;
      step = 'idle';
    }
  }

  async function disconnect() {
    await call('', { method: 'DELETE' }).catch(() => {});
    status = status && { ...status, connected: false, device: null };
  }
</script>

<dialog bind:this={dlg} class="garmin" onclose={() => (open = false)}>
  <header>
    <b>{t('g.title')}</b> <span class="beta">{t('act.beta')}</span>
    <button class="x" onclick={() => (open = false)} aria-label={t('g.close')}>×</button>
  </header>

  {#if !loggedIn}
    <p>{t('g.needLogin')}</p>
    <button class="primary" onclick={onlogin}>{t('g.login')}</button>
  {:else if !status}
    <p class="muted">{t('g.checking')}</p>
  {:else if !status.enabled}
    <p>{t('g.disabled')}</p>
  {:else if step === 'mfa'}
    <form onsubmit={sendMfa}>
      <p>{t('g.mfa')}</p>
      <input bind:value={code} inputmode="numeric" autocomplete="one-time-code" placeholder={t('g.code')} required />
      <button class="primary" type="submit">{t('g.confirm')}</button>
    </form>
  {:else if !status.connected}
    <form onsubmit={connect}>
      <p>
        {t('g.connectText')}
      </p>
      <input bind:value={email} type="email" autocomplete="username" placeholder={t('g.email')} required />
      <input bind:value={password} type="password" autocomplete="current-password" placeholder={t('g.password')} required />
      <button class="primary" type="submit" disabled={step === 'login'}>{step === 'login' ? t('g.connecting') : t('g.connect')}</button>
    </form>
  {:else if step === 'done' && result}
    <p>
      {t('g.sent')}{result.device ? t('g.sentDevice', { device: result.device }) : ''}. {t('g.sync')}
    </p>
    {#if result.url}<a href={result.url} target="_blank" rel="noopener">{t('g.open')}</a>{/if}
    <p class="muted">{t('g.cpNote')}</p>
  {:else}
    <p>{t('g.connected')}</p>
    <label class="dev">
      {t('g.where')}
      <select bind:value={deviceId}>
        {#each devices as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
        <option value={0}>{t('g.onlySave')}</option>
      </select>
    </label>
    <button class="primary" onclick={send} disabled={step === 'sending'}>{step === 'sending' ? t('g.sending') : t('g.send')}</button>
    <button class="link" onclick={disconnect}>{t('g.disconnect')}</button>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
</dialog>

<style>
  .garmin {
    border: 0;
    border-radius: 18px;
    padding: 16px 18px;
    width: min(380px, calc(100vw - 32px));
    background: var(--paper);
    color: var(--ink);
    box-shadow: 0 10px 40px rgb(0 0 0 / 0.3);
  }
  .garmin::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .beta {
    font: 600 10.5px/1 var(--mono);
    padding: 3px 6px;
    border-radius: 999px;
    background: var(--tint2);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .x {
    margin-left: auto;
    border: 0;
    background: none;
    color: inherit;
    font-size: 20px;
    cursor: pointer;
  }
  .dev {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--soft);
    margin-bottom: 12px;
  }
  .dev select {
    font: inherit;
    font-size: 14px;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px 10px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  input {
    font: inherit;
    color: inherit;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 9px 10px;
  }
  button.primary {
    font: inherit;
    font-weight: 600;
    border: 0;
    box-shadow: inset 0 0 0 1.5px var(--ink);
    background: none;
    color: inherit;
    border-radius: 10px;
    min-height: 40px;
    padding: 8px 14px;
    cursor: pointer;
  }
  button.primary:hover {
    background: var(--tint);
  }
  button.link {
    font: inherit;
    border: 0;
    background: none;
    color: var(--soft);
    text-decoration: underline;
    cursor: pointer;
    margin-left: 8px;
  }
  p {
    margin: 0 0 10px;
    line-height: 1.4;
  }
  .muted {
    color: var(--soft);
    font-size: 13px;
  }
  .error {
    color: var(--danger);
    margin-top: 10px;
  }
</style>

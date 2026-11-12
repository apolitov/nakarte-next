<script lang="ts">
  // «Отправить в Garmin» (beta): connect a Garmin account once, then send routes as courses.
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
  let dlg: HTMLDialogElement;

  async function call(path: string, init?: RequestInit) {
    const r = await fetch(`${API}${path}`, { redirect: 'manual', credentials: 'same-origin', ...init });
    if (r.type === 'opaqueredirect' || r.status === 401 && path === '/status') throw new Error('Нужно войти в Na Carta');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `Ошибка ${r.status}`);
    return j;
  }
  const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

  $effect(() => {
    if (open) {
      dlg?.showModal();
      error = '';
      result = null;
      step = 'idle';
      if (loggedIn) call('/status').then((s) => (status = s), (e) => (error = e.message));
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
      result = await call('/send', json({ ...r, to_device: true }));
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
    <b>Отправить в Garmin</b> <span class="beta">бета</span>
    <button class="x" onclick={() => (open = false)} aria-label="Закрыть">×</button>
  </header>

  {#if !loggedIn}
    <p>Отправка в Garmin доступна после входа в Na Carta.</p>
    <button class="primary" onclick={onlogin}>Войти</button>
  {:else if !status}
    <p class="muted">Проверяю подключение…</p>
  {:else if !status.enabled}
    <p>Отправка в Garmin пока не настроена на сервере.</p>
  {:else if step === 'mfa'}
    <form onsubmit={sendMfa}>
      <p>Garmin прислал код подтверждения (почта или приложение). Введите его:</p>
      <input bind:value={code} inputmode="numeric" autocomplete="one-time-code" placeholder="Код" required />
      <button class="primary" type="submit">Подтвердить</button>
    </form>
  {:else if !status.connected}
    <form onsubmit={connect}>
      <p>
        Подключите аккаунт Garmin Connect один раз. Пароль используется только для входа и не сохраняется,
        на сервере хранится зашифрованный токен. Это неофициальный способ: Garmin может его сломать.
      </p>
      <input bind:value={email} type="email" autocomplete="username" placeholder="Почта Garmin" required />
      <input bind:value={password} type="password" autocomplete="current-password" placeholder="Пароль Garmin" required />
      <button class="primary" type="submit" disabled={step === 'login'}>{step === 'login' ? 'Подключаю…' : 'Подключить'}</button>
    </form>
  {:else if step === 'done' && result}
    <p>
      Курс сохранён в Garmin Connect{result.device ? ` и поставлен в очередь на ${result.device}` : ''}. Синхронизируйте
      устройство, чтобы он появился.
    </p>
    {#if result.url}<a href={result.url} target="_blank" rel="noopener">Открыть в Garmin Connect</a>{/if}
    <p class="muted">Чекпоинты пока уходят только в файл FIT.</p>
  {:else}
    <p>Аккаунт подключён{status.device ? `, устройство: ${status.device}` : ''}.</p>
    <button class="primary" onclick={send} disabled={step === 'sending'}>{step === 'sending' ? 'Отправляю…' : 'Отправить маршрут'}</button>
    <button class="link" onclick={disconnect}>Отключить Garmin</button>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
</dialog>

<style>
  .garmin {
    border: 0;
    border-radius: 12px;
    padding: 16px 18px;
    width: min(380px, calc(100vw - 32px));
    background: var(--bg);
    color: var(--fg);
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
    font-size: 11px;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 1px 7px;
    color: var(--muted);
  }
  .x {
    margin-left: auto;
    border: 0;
    background: none;
    color: inherit;
    font-size: 20px;
    cursor: pointer;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  input {
    font: inherit;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
  }
  button.primary {
    font: inherit;
    border: 1.5px solid var(--fg);
    background: none;
    color: inherit;
    border-radius: 8px;
    padding: 8px 12px;
    cursor: pointer;
  }
  button.link {
    font: inherit;
    border: 0;
    background: none;
    color: var(--muted);
    text-decoration: underline;
    cursor: pointer;
    margin-left: 8px;
  }
  p {
    margin: 0 0 10px;
    line-height: 1.4;
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
  }
  .error {
    color: #d1242f;
    margin-top: 10px;
  }
</style>

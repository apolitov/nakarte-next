<script lang="ts">
  // Asked once a route is finished (editing turned off, or before GPX, link or Garmin)
  // while it has no name of its own: a route list of "Route 12 km, 12 Nov" is useless.
  // The name is required; the only other way out is back to editing.
  import { t } from '../lib/i18n';
  import { dec } from '../lib/timeline';
  import { estimateMinutes, formatDuration } from '../lib/eta';
  import type { Profile } from '../lib/profile';

  let {
    open = $bindable(false),
    profile,
    profileId,
    typeTitle,
    suggestion,
    onsave,
    onback,
  }: {
    open: boolean;
    profile: Profile;
    profileId: string;
    typeTitle: string;
    suggestion: string;
    onsave: (name: string) => void;
    onback: () => void;
  } = $props();

  let dlg: HTMLDialogElement;
  let input: HTMLInputElement | undefined = $state();
  let name = $state('');
  const ok = $derived(name.trim().length > 0);

  $effect(() => {
    if (open) {
      name = '';
      dlg?.showModal();
      queueMicrotask(() => input?.focus());
    } else dlg?.close();
  });

  function save(e?: Event) {
    e?.preventDefault();
    if (!ok) return input?.focus();
    open = false;
    onsave(name.trim());
  }
  function back() {
    open = false;
    onback();
  }
</script>

<!-- Esc does not dismiss: the name is required (back to editing is the explicit way out) -->
<dialog class="named" bind:this={dlg} aria-labelledby="nk-name-h" oncancel={(e) => e.preventDefault()}>
  <form onsubmit={save}>
    <div class="main">
      <h2 id="nk-name-h">{t('name.title')}</h2>
      <p class="soft">{t('name.why')}</p>
      <label for="nk-name" class="lbl">{t('name.label')}</label>
      <input id="nk-name" bind:this={input} bind:value={name} placeholder={suggestion} maxlength="120" autocomplete="off" spellcheck="false" />
      <div class="btns">
        <button type="submit" class="pri" aria-disabled={!ok}>{t('name.save')}</button>
        <button type="button" class="sec" onclick={back}>{t('name.back')}</button>
      </div>
    </div>
    <aside class="facts" aria-label={t('name.facts')}>
      <div class="ty">{typeTitle}</div>
      <dl>
        <dt>{t('name.length')}</dt><dd class="num">{dec(profile.length / 1000)} {t('unit.km')}</dd>
        <dt>{t('name.up')}</dt><dd class="num">↑ {Math.round(profile.ascent)} {t('unit.m')}</dd>
        <dt>{t('name.down')}</dt><dd class="num">↓ {Math.round(profile.descent)} {t('unit.m')}</dd>
        <dt>{t('name.time')}</dt><dd class="num">~{formatDuration(estimateMinutes(profile.length, profile.ascent, profileId, profile.descent))}</dd>
      </dl>
    </aside>
  </form>
</dialog>

<style>
  .named {
    border: 0;
    border-radius: 18px;
    padding: 0;
    width: min(560px, calc(100vw - 32px));
    background: var(--paper);
    color: var(--ink);
    box-shadow: 0 10px 40px rgb(0 0 0 / 0.3);
  }
  .named::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 170px;
  }
  .main {
    padding: 18px 20px;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 17px;
    font-weight: 650;
  }
  .soft {
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--soft);
  }
  .lbl {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--soft);
    margin-bottom: 4px;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    height: 40px;
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: 600 15px/1 var(--sans);
  }
  input:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  .btns {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }
  .pri,
  .sec {
    height: 38px;
    padding: 0 16px;
    border-radius: 10px;
    font: 600 14px/1 var(--sans);
    cursor: pointer;
  }
  .pri {
    background: var(--marker);
    color: var(--marker-ink);
    box-shadow: inset 0 0 0 1.5px var(--marker-ink);
  }
  .pri[aria-disabled='true'] {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .sec {
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .sec:hover {
    background: var(--tint);
  }
  .facts {
    padding: 18px 16px;
    background: var(--tint);
    border-radius: 0 18px 18px 0;
  }
  .ty {
    font-size: 12px;
    font-weight: 600;
    color: var(--soft);
    margin-bottom: 8px;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 10px;
    font-size: 13px;
  }
  dt {
    color: var(--soft);
  }
  dd {
    margin: 0;
    text-align: right;
    font-weight: 500;
  }
  @media (max-width: 520px) {
    form {
      grid-template-columns: 1fr;
    }
    .facts {
      order: -1;
      border-radius: 18px 18px 0 0;
      padding: 14px 20px 10px;
    }
    dl {
      grid-template-columns: repeat(4, auto);
      justify-content: space-between;
    }
    dt {
      display: none;
    }
  }
</style>

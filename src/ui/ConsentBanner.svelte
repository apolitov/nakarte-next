<script lang="ts">
  // Asks once whether Google Analytics may set cookies. Until the answer, and after "No",
  // analytics runs without cookies (Consent Mode "denied"). Reopened from the account menu.
  import { t } from '../lib/i18n';
  import { setConsent, type Consent } from '../lib/analytics';

  let { onclose }: { onclose: () => void } = $props();
  const BASE = import.meta.env.BASE_URL;
  function pick(c: Consent) {
    setConsent(c);
    onclose();
  }
</script>

<div class="cb" role="dialog" aria-live="polite" aria-label={t('consent.title')}>
  <p>
    <b>{t('consent.title')}</b>
    {t('consent.text')}
    <a href="{BASE}help/#privacy" target="_blank" rel="noopener">{t('consent.privacy')}</a> ·
    <a href="{BASE}terms/" target="_blank" rel="noopener">{t('consent.terms')}</a>
  </p>
  <div class="b">
    <button class="no" onclick={() => pick('denied')}>{t('consent.no')}</button>
    <button class="yes" onclick={() => pick('granted')}>{t('consent.yes')}</button>
  </div>
</div>

<style>
  .cb {
    position: fixed;
    z-index: 40;
    /* over the map, next to the side panel (290 px, 280 px on narrower screens), not over it */
    left: 306px;
    bottom: 16px;
    width: min(420px, calc(100vw - 322px));
    display: grid;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 14px;
    background: var(--paper);
    color: var(--ink);
    box-shadow: var(--shadow);
    font-size: 13px;
    line-height: 1.45;
  }
  p {
    margin: 0;
  }
  b {
    display: block;
    margin-bottom: 2px;
    font-size: 14px;
  }
  a {
    color: inherit;
    text-underline-offset: 2px;
  }
  .b {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  button {
    height: 34px;
    padding: 0 14px;
    border-radius: 10px;
    font: 600 13px/1 var(--sans);
  }
  /* both answers are equally easy to give: same size, neither is hidden */
  .no {
    background: var(--tint);
    color: var(--ink);
  }
  .yes {
    background: var(--ink);
    color: var(--paper);
  }
  @media (max-width: 639px) {
    /* above the collapsed bottom sheet */
    .cb {
      left: 10px;
      right: 10px;
      width: auto;
      bottom: calc(74px + env(safe-area-inset-bottom));
    }
  }
</style>

// Google Analytics 4 for the planner (docs/analytics-plan.md). The same property as alexe.pt;
// every event carries app=nomapa. Consent Mode starts as "denied": no cookies, Google gets
// cookieless pings only. Cookies are allowed only after "Allow" in the banner; the choice is
// kept in this browser and can be changed from the account menu.
// Never sent: coordinates, place or route names, email, ids of routes or links.

const GA_ID = 'G-HDTV62D1ZM';
const KEY = 'nm-consent';
export type Consent = 'granted' | 'denied';

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

export function storedConsent(): Consent | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

const consentState = (c: Consent | null) => {
  const a = c === 'granted' ? 'granted' : 'denied';
  // advertising stays off in every case
  return { analytics_storage: a, ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
};

let started = false;
/** Loads gtag once, with the consent stored in this browser (denied when there is none). */
export function initAnalytics() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    // gtag needs the arguments object itself
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('consent', 'default', consentState(storedConsent()));
  window.gtag('js', new Date());
  // the address without its hash for every event, automatic page views included: the hash holds
  // the map position and, in long links, the route's points
  window.gtag('set', { page_location: location.origin + location.pathname, app: 'nomapa' });
  window.gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.append(s);
}

export function setConsent(c: Consent) {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* private mode: asked again next time */
  }
  window.gtag?.('consent', 'update', consentState(c));
  // a "no" after a "yes": Google does not remove its cookies itself
  if (c === 'denied') dropGaCookies();
  track('consent', { value: c });
}

type Param = string | number | boolean;
/** One user action. Parameters must be plain values that say nothing about places or people. */
export function track(name: string, params: Record<string, Param | undefined> = {}) {
  if (!window.gtag) return;
  const clean: Record<string, Param> = { app: 'nomapa' };
  for (const [k, v] of Object.entries(params)) if (v !== undefined) clean[k] = v;
  window.gtag('event', name, clean);
}

/** Route length rounded to 5 km and point counts in buckets: enough to compare, nothing to locate. */
export const kmBucket = (m: number) => Math.round(m / 5000) * 5;
export const pointsBucket = (n: number) => (n <= 2 ? '2' : n <= 5 ? '3-5' : n <= 10 ? '6-10' : '11+');

function dropGaCookies() {
  const host = location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  for (const name of document.cookie.split(';').map((x) => x.trim().split('=')[0]))
    if (name.startsWith('_ga'))
      for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
}

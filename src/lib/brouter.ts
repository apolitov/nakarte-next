// BRouter client. One request per leg (pair of neighbouring waypoints), so
// dragging a point recalculates only the two legs around it.
import type { Position } from 'geojson';
import { straightWithElevation } from './dem';
import { t } from './i18n';

export const PROFILES = [
  { id: 'nk-road', title: t('profile.road') },
  { id: 'nk-gravel', title: t('profile.gravel') },
  { id: 'nk-mtb', title: t('profile.mtb') },
  { id: 'nk-hike', title: t('profile.hike') },
] as const;

/** Profiles of the first version, kept so old routes and links still open. */
const LEGACY: Record<string, string> = {
  trekking: 'nk-gravel',
  'nk-touring': 'nk-gravel',
  fastbike: 'nk-road',
  gravel: 'nk-gravel',
  mtb: 'nk-mtb',
  'hiking-mountain': 'nk-hike',
  shortest: 'nk-gravel',
};
export const normalizeProfile = (p: string): ProfileId =>
  (PROFILES.some((x) => x.id === p) ? p : LEGACY[p] ?? 'nk-gravel') as ProfileId;

export type Surface = -1 | 0 | 1;
export type Climbs = 'less' | 'normal' | 'any';
export interface RouteOptions {
  surface: Surface;
  climbs: Climbs;
  /** max comfortable grade, %; 0 = no limit */
  maxGrade: number;
  /** prefer cycleways, cycle lanes and signed cycle routes (on by default in the bike profiles) */
  cycleways: boolean;
}
export const DEFAULT_OPTIONS: RouteOptions = { surface: 0, climbs: 'normal', maxGrade: 0, cycleways: true };

/** Options → BRouter profile parameters of the nk-* profiles (see vps/stacks/brouter/profiles/gen.py). */
export function optionsToParams(o: RouteOptions): Record<string, number> {
  const p: Record<string, number> = {};
  if (o.surface) p.nk_surface = o.surface;
  // the bike profiles follow cycle infrastructure by default; only turning it off is sent
  if (!o.cycleways) p.nk_cycle = 0;
  if (o.maxGrade > 0) {
    // climbing above the limit costs a lot; below it, as the climbs option says
    p.nk_uphillcutoff = o.maxGrade;
    p.nk_uphillcost = 600;
  } else if (o.climbs === 'less') {
    p.nk_uphillcost = 120;
    p.nk_uphillcutoff = 1.5;
  } else if (o.climbs === 'any') {
    p.nk_uphillcost = 0;
  }
  return p;
}

export function paramsToOptions(p: Record<string, string | number | boolean> = {}): RouteOptions {
  const n = (k: string) => (p[k] == null ? undefined : Number(p[k]));
  const cost = n('nk_uphillcost');
  const cutoff = n('nk_uphillcutoff');
  return {
    surface: (Math.sign(n('nk_surface') ?? 0) as Surface),
    cycleways: n('nk_cycle') !== 0,
    maxGrade: cost != null && cost >= 600 && cutoff ? cutoff : 0,
    climbs: cost == null ? 'normal' : cost === 0 ? 'any' : cost >= 600 ? 'normal' : 'less',
  };
}

export type ProfileId = (typeof PROFILES)[number]['id'] | 'straight';

const API = `${import.meta.env.BASE_URL}api/route`;

export interface LegPoint {
  lng: number;
  lat: number;
  ele: number | null;
}

/** A stretch of a leg with the same OSM way tags. `from`/`to` are point indexes. */
export interface WaySpan {
  from: number;
  to: number;
  highway?: string;
  surface?: string;
  tracktype?: string;
}

export interface Leg {
  points: LegPoint[];
  spans: WaySpan[];
}

function parseTags(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of s.split(' ')) {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

/** Parses BRouter's geojson answer: coordinates with elevation and the `messages` table with way tags. */
export function parseBrouter(json: any): Leg {
  const f = json?.features?.[0];
  if (!f) throw new Error(t('err.brouterEmpty'));
  const coords: Position[] = f.geometry.coordinates;
  const points = coords.map(([lng, lat, ele]) => ({ lng, lat, ele: ele ?? null }));
  fillElevation(points);

  const spans: WaySpan[] = [];
  const msgs: string[][] | undefined = f.properties?.messages;
  if (msgs && msgs.length > 1) {
    const head = msgs[0];
    const iLon = head.indexOf('Longitude');
    const iLat = head.indexOf('Latitude');
    const iTags = head.indexOf('WayTags');
    // Each message row ends a stretch with the given tags; locate its end point in the geometry.
    let from = 0;
    let cursor = 0;
    for (const row of msgs.slice(1)) {
      const lng = Number(row[iLon]) / 1e6;
      const lat = Number(row[iLat]) / 1e6;
      let to = -1;
      for (let i = cursor; i < points.length; i++) {
        if (Math.abs(points[i].lng - lng) < 2e-6 && Math.abs(points[i].lat - lat) < 2e-6) {
          to = i;
          break;
        }
      }
      if (to < 0) continue;
      const tags = parseTags(row[iTags] ?? '');
      spans.push({ from, to, highway: tags.highway, surface: tags.surface, tracktype: tags.tracktype });
      from = to;
      cursor = to;
    }
    if (from < points.length - 1) spans.push({ from, to: points.length - 1 });
  }
  return { points, spans };
}

/** BRouter omits elevation for some points (e.g. at the ends); interpolate from neighbours. */
export function fillElevation(points: LegPoint[]) {
  const known = points.map((p, i) => (p.ele != null ? i : -1)).filter((i) => i >= 0);
  if (!known.length) return;
  let k = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i].ele != null) continue;
    while (k < known.length - 1 && known[k + 1] < i) k++;
    const a = known[k] < i ? known[k] : null;
    const b = known.find((j) => j > i) ?? null;
    if (a == null) points[i].ele = points[b!].ele;
    else if (b == null) points[i].ele = points[a].ele;
    else points[i].ele = points[a].ele! + ((points[b].ele! - points[a].ele!) * (i - a)) / (b - a);
  }
}

const cache = new Map<string, Promise<Leg>>();

/**
 * One leg from the router. Under load BRouter cancels the oldest running requests
 * ("killed by thread-priority-watchdog"): such a leg is retried after a short pause.
 * A leg that does not finish in the router's 60 s gets a hint to add a point.
 */
/** Router legs are limited on the server too (maps-api): long legs are the expensive case. */
export const MAX_LEG_KM = 100;

function straightKm(a: LngLat, b: LngLat) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The server lets one client run 3 legs at once; a route with many legs waits here instead of being refused. */
const MAX_PARALLEL = 3;
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((res) => waiting.push(res));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function requestLeg(url: string, attempt = 0): Promise<Leg> {
  const r = await fetch(url);
  const text = await r.text();
  if (r.ok) return parseBrouter(JSON.parse(text));
  // the server queues legs and limits each client: wait as long as it asks and try again
  if ((r.status === 429 || r.status === 503) && attempt < 12) {
    const after = Math.min(10, Number(r.headers.get('Retry-After')) || 2);
    await new Promise((res) => setTimeout(res, after * 1000 + Math.random() * 500));
    return requestLeg(url, attempt + 1);
  }
  if (r.status === 429 || r.status === 503) throw new Error(t('route.busy'));
  const msg = text.trim().split('\n')[0];
  if (/killed/i.test(msg) && attempt < 3) {
    await new Promise((res) => setTimeout(res, 400 + Math.random() * 600 * (attempt + 1)));
    return requestLeg(url, attempt + 1);
  }
  if (/timeout|too long/i.test(msg)) throw new Error(t('route.legTooLong', { max: MAX_LEG_KM }));
  throw new Error(msg || `BRouter ${r.status}`);
}

type LngLat = { lng: number; lat: number };

export type Params = Record<string, string | number | boolean>;

export function fetchLeg(a: LngLat, b: LngLat, profile: ProfileId, params: Params = {}): Promise<Leg> {
  if (profile === 'straight') {
    // elevation from terrain tiles; if they fail, the line still works without it
    return straightWithElevation(a, b).then(
      (points) => ({ points, spans: [] }),
      () => ({ points: [a, b].map((p) => ({ lng: p.lng, lat: p.lat, ele: null })), spans: [] }),
    );
  }
  const extra = paramString(params);
  const km = straightKm(a, b);
  if (km > MAX_LEG_KM) return Promise.reject(new Error(t('route.legTooLong', { max: MAX_LEG_KM })));
  const key = legKey(a, b, profile, extra);
  let p = cache.get(key);
  if (!p) {
    const url = `${API}?lonlats=${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}&profile=${profile}${extra}&alternativeidx=0&format=geojson`;
    p = slot(() => requestLeg(url));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

// profile parameters go as profile:<name>=<value>; booleans as 1/0
function paramString(params: Params) {
  return Object.entries(params)
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([k, v]) => `&profile:${encodeURIComponent(k)}=${typeof v === 'boolean' ? (v ? 1 : 0) : encodeURIComponent(String(v))}`)
    .join('');
}

function legKey(a: LngLat, b: LngLat, profile: ProfileId, extra: string) {
  return `${profile}|${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}${extra}`;
}

/** A leg computed earlier and stored with the route: later requests for it are answered without the router. */
export function seedLeg(a: LngLat, b: LngLat, profile: ProfileId, params: Params, leg: Leg) {
  if (profile !== 'straight') cache.set(legKey(a, b, profile, paramString(params)), Promise.resolve(leg));
}

/** Compact form of a leg for storage: [lng, lat, ele] with 6 and 1 decimals. */
export type StoredLeg = { p: [number, number, number | null][]; s: WaySpan[] };
export function packLeg(l: Leg): StoredLeg {
  return {
    p: l.points.map((q) => [Math.round(q.lng * 1e6) / 1e6, Math.round(q.lat * 1e6) / 1e6, q.ele == null ? null : Math.round(q.ele * 10) / 10]),
    s: l.spans,
  };
}
export function unpackLeg(l: StoredLeg): Leg {
  return { points: l.p.map(([lng, lat, ele]) => ({ lng, lat, ele })), spans: l.s ?? [] };
}

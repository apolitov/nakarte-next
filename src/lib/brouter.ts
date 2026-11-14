// BRouter client. One request per leg (pair of neighbouring waypoints), so
// dragging a point recalculates only the two legs around it.
import type { Position } from 'geojson';
import { straightWithElevation } from './dem';
import { t } from './i18n';
import { heatAlong } from './rwheat';

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

/** -2 asphalt only, -1 more asphalt, 0 any, 1 more dirt, 2 trails (a slider in the settings) */
export type Surface = -2 | -1 | 0 | 1 | 2;
/**
 * Slider position → profile parameters. Towards asphalt the cycle-infrastructure penalty is
 * eased: otherwise a short stretch of road without a cycle lane loses to a detour on gravel.
 * Towards trails it is off, since cycle paths are mostly paved. Tuned in docs/routing-*.md.
 */
export const SURFACE_PARAMS: Record<Surface, Record<string, number>> = {
  [-2]: { nk_surface: -1, nk_surf_k: 6, nk_cycle_pen: 1.2 },
  [-1]: { nk_surface: -1, nk_cycle_pen: 1.4 },
  0: {},
  1: { nk_surface: 1 },
  2: { nk_surface: 1, nk_surf_k: 5, nk_cycle_pen: 1 },
};
/** a slider from "avoid climbs" to "seek climbs" */
export type Climbs = 'avoid' | 'less' | 'normal' | 'any' | 'seek';
export const CLIMB_STEPS: Climbs[] = ['avoid', 'less', 'normal', 'any', 'seek'];
/** a slider from "avoid big roads" to "big roads are fine" */
export type BigRoads = 'avoid' | 'less' | 'normal' | 'any';
export const BIG_STEPS: BigRoads[] = ['avoid', 'less', 'normal', 'any'];
/** nk_big per step (gen.py): trunk and primary cost this many times more, secondary and tertiary less */
const BIG_K: Record<BigRoads, number> = { avoid: 4, less: 2, normal: 1, any: 0.3 };
export interface RouteOptions {
  surface: Surface;
  climbs: Climbs;
  /** big roads: trunk, primary and, less so, secondary and tertiary */
  bigRoads: BigRoads;
  /** max comfortable grade, %; 0 = no limit */
  maxGrade: number;
  /** prefer cycleways, cycle lanes and signed cycle routes (on by default in the bike profiles) */
  cycleways: boolean;
  /** with cycleways: stick to real cycle infrastructure (paths, lanes, tracks; not sharrows or signed routes), x4 (nk_cycle=2) */
  cycleStrict: boolean;
  /** of the router's alternatives, take the one more people ride (Ride with GPS heatmap) */
  heat: boolean;
  /** bikes: avoid sett and cobblestones (nk_cobble); off by default, old town centres are often cobbled */
  cobbles: boolean;
  /** hiking: hardest path allowed on the SAC scale (T2…T6); 3 is the profile default */
  sac: number;
  /** hiking: keep to signed hiking routes */
  trails: boolean;
  /** hiking: through forest and along water */
  nature: boolean;
  /** hiking: away from busy roads and towns */
  quiet: boolean;
  /** what the route may use at all (false: never); see ALLOW_FOR for which types offer what */
  allow: Record<AllowKey, boolean>;
}
export type AllowKey = 'steps' | 'ferry' | 'busy' | 'unpaved' | 'paths';
export const ALLOW_KEYS: AllowKey[] = ['steps', 'ferry', 'busy', 'unpaved', 'paths'];
/** which route types offer which restriction (nk_allow_* in the profiles, gen.py) */
export const ALLOW_FOR: Record<AllowKey, string[]> = {
  steps: ['nk-road', 'nk-gravel', 'nk-mtb', 'nk-hike'],
  ferry: ['nk-road', 'nk-gravel', 'nk-mtb', 'nk-hike'],
  busy: ['nk-road', 'nk-gravel', 'nk-mtb', 'nk-hike'],
  unpaved: ['nk-road'],
  paths: ['nk-road', 'nk-gravel'],
};
const ALLOW_ALL: Record<AllowKey, boolean> = { steps: true, ferry: true, busy: true, unpaved: true, paths: true };
export const DEFAULT_OPTIONS: RouteOptions = { surface: 0, climbs: 'normal', bigRoads: 'normal', maxGrade: 0, cycleways: true, cycleStrict: false, heat: false, cobbles: false, sac: 3, trails: false, nature: false, quiet: false, allow: { ...ALLOW_ALL } };
/** SAC difficulty steps offered for hiking (OSM sac_scale: T1 hiking … T6 difficult alpine) */
export const SAC_STEPS = [2, 3, 4, 6] as const;

/** Options → BRouter profile parameters of the nk-* profiles (see vps/stacks/brouter/profiles/gen.py). */
export function optionsToParams(o: RouteOptions): Record<string, number> {
  const p: Record<string, number> = {};
  Object.assign(p, SURFACE_PARAMS[o.surface] ?? {});
  // the bike profiles follow cycle infrastructure by default; only turning it off is sent
  if (!o.cycleways) {
    p.nk_cycle = 0;
    delete p.nk_cycle_pen;
  } else if (o.cycleStrict) p.nk_cycle = 2;
  if (o.maxGrade > 0) {
    // climbing above the limit costs a lot; below it, as the climbs option says
    p.nk_uphillcutoff = o.maxGrade;
    p.nk_uphillcost = 600;
  } else if (o.climbs === 'avoid') {
    p.nk_uphillcost = 300;
    p.nk_uphillcutoff = 1;
  } else if (o.climbs === 'seek') {
    // not a profile parameter: fetchLeg asks for the router's alternatives and keeps the hilliest
    p.nk_uphillcost = 0;
    p.nk_seek = 1;
  } else if (o.climbs === 'less') {
    p.nk_uphillcost = 120;
    p.nk_uphillcutoff = 1.5;
  } else if (o.climbs === 'any') {
    p.nk_uphillcost = 0;
  }
  if (o.bigRoads && o.bigRoads !== 'normal') p.nk_big = BIG_K[o.bigRoads];
  // not a profile parameter either: fetchLeg picks among alternatives by the heatmap
  if (o.heat) p.nk_heat = 1;
  if (o.cobbles) p.nk_cobble = 1;
  // hiking only (variables of the stock hiking-mountain profile); defaults are not sent
  if (o.sac !== 3) p.SAC_scale_limit = o.sac;
  if (o.trails) p.hiking_routes_preference = 1;
  if (o.nature) {
    p.consider_forest = 1;
    p.consider_river = 1;
  }
  if (o.quiet) {
    p.consider_noise = 1;
    p.consider_town = 1;
  }
  // only restrictions are sent: everything is allowed by default
  for (const k of ALLOW_KEYS) if (o.allow?.[k] === false) p[`nk_allow_${k}`] = 0;
  return p;
}

function surfaceOf(dir: number, k?: number): Surface {
  if (dir < 0) return k != null && k >= 4 ? -2 : -1;
  if (dir > 0) return k != null && k >= 4 ? 2 : 1;
  return 0;
}

export function paramsToOptions(p: Record<string, string | number | boolean> = {}): RouteOptions {
  const n = (k: string) => (p[k] == null ? undefined : Number(p[k]));
  const cost = n('nk_uphillcost');
  const cutoff = n('nk_uphillcutoff');
  return {
    surface: surfaceOf(n('nk_surface') ?? 0, n('nk_surf_k')),
    cycleways: n('nk_cycle') !== 0,
    cycleStrict: n('nk_cycle') === 2,
    heat: n('nk_heat') === 1,
    cobbles: n('nk_cobble') === 1,
    maxGrade: cost != null && cost >= 600 && cutoff ? cutoff : 0,
    bigRoads: (BIG_STEPS.find((k) => BIG_K[k] === (n('nk_big') ?? 1)) ?? 'normal'),
    climbs: n('nk_seek') === 1 ? 'seek' : cost == null ? 'normal' : cost === 0 ? 'any' : cost >= 600 ? 'normal' : cost >= 250 ? 'avoid' : 'less',
    sac: n('SAC_scale_limit') ?? 3,
    trails: (n('hiking_routes_preference') ?? 0) >= 1,
    nature: n('consider_forest') === 1,
    quiet: n('consider_noise') === 1,
    allow: Object.fromEntries(ALLOW_KEYS.map((k) => [k, n(`nk_allow_${k}`) !== 0])) as Record<AllowKey, boolean>,
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
  /** 'ferry' on a boat crossing (route=ferry, no highway tag) */
  route?: string;
  /** cycle infrastructure: a cycleway, a way designated for bikes, a lane or a signed cycle route */
  cycle?: true;
}

export interface Leg {
  points: LegPoint[];
  spans: WaySpan[];
}

const LANE = /^(lane|track|shared_lane|segregated|both|right|left|opposite_lane|opposite_track)$/;
/** the profiles' nk_is_cycle (gen.py), from BRouter's way tags */
function isCycle(t: Record<string, string>): boolean {
  return t.highway === 'cycleway' || t.bicycle === 'designated' || LANE.test(t.cycleway ?? '') || LANE.test(t['cycleway:right'] ?? '') ||
    LANE.test(t['cycleway:left'] ?? '') || LANE.test(t['cycleway:both'] ?? '') || Object.keys(t).some((k) => k.startsWith('route_bicycle_'));
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
      spans.push({ from, to, highway: tags.highway, surface: tags.surface, tracktype: tags.tracktype, ...(tags.route === 'ferry' ? { route: 'ferry' } : {}), ...(isCycle(tags) ? { cycle: true as const } : {}) });
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

/** cost cap of paved roads for the heatmap candidates; 1.3 and 1.6 tested alike, 1.6 uses fewer main roads (docs/routing.md) */
const HEAT_CAP = 1.6;

export function fetchLeg(a: LngLat, b: LngLat, profile: ProfileId, params: Params = {}): Promise<Leg> {
  if (profile === 'straight') {
    // elevation from terrain tiles; if they fail, the line still works without it
    return straightWithElevation(a, b).then(
      (points) => ({ points, spans: [] }),
      () => ({ points: [a, b].map((p) => ({ lng: p.lng, lat: p.lat, ele: null })), spans: [] }),
    );
  }
  const { nk_seek: seek, nk_heat: heat, ...sent } = params;
  const extra = paramString(sent);
  const km = straightKm(a, b);
  if (km > MAX_LEG_KM) return Promise.reject(new Error(t('route.legTooLong', { max: MAX_LEG_KM })));
  const key = cacheKey(a, b, profile, params);
  let p = cache.get(key);
  if (!p) {
    const url = (alt: number) => `${API}?lonlats=${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}&profile=${profile}${extra}&alternativeidx=${alt}&format=geojson`;
    // Stick to the heatmap: the router's road classes would keep it off busy roads people ride
    // a lot, so half of the candidates come with every paved road capped at HEAT_CAP (gen.py,
    // nk_heat_cap) and the hottest of all wins; the first plain one stays the reference
    const capped = (alt: number) => url(alt).replace('&alternativeidx', `&profile:nk_heat_cap=${HEAT_CAP}&alternativeidx`);
    const urls = heat ? [url(0), url(1), ...(seek ? [url(2), url(3)] : []), capped(0), capped(1)] : seek ? [0, 1, 2, 3].map(url) : [url(0)];
    // with cycleways followed (the default in road and gravel), ties go to the variant with more cycle infrastructure
    const preferCycle = (profile === 'nk-road' || profile === 'nk-gravel') && Number(sent.nk_cycle ?? 1) !== 0;
    p = seek || heat ? pickAlternative(urls.map((u) => slot(() => requestLeg(u))), !!seek, !!heat, preferCycle) : slot(() => requestLeg(urls[0]));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Ascent of a leg in metres, ignoring wiggles under 3 m (DEM noise). */
export function legAscent(points: LegPoint[]): number {
  let up = 0, ref: number | null = null;
  for (const q of points) {
    if (q.ele == null) continue;
    if (ref == null) ref = q.ele;
    else if (q.ele - ref >= 3) (up += q.ele - ref), (ref = q.ele);
    else if (ref - q.ele >= 3) ref = q.ele;
  }
  return up;
}

/**
 * "Seek climbs" and "Stick to heatmap": of the router's alternatives (up to four per leg), the
 * one that climbs most and/or that more people ride (Ride with GPS heatmap), among those at most
 * 30% longer than the first. With both, each counts relative to the first alternative.
 */
async function pickAlternative(alts: Promise<Leg>[], seek: boolean, heat: boolean, preferCycle = false): Promise<Leg> {
  const got = await Promise.allSettled(alts);
  const legs = got.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!legs.length) throw (got[0] as PromiseRejectedResult).reason;
  const len = (l: Leg) => l.points.reduce((s, q, i) => (i ? s + straightKm(l.points[i - 1], q) : 0), 0);
  const base = len(legs[0]);
  const ok = legs.filter((l) => len(l) <= base * 1.3);
  const up = ok.map((l) => legAscent(l.points));
  const hot = heat ? await Promise.all(ok.map((l) => heatAlong(l.points).catch(() => 0))) : ok.map(() => 0);
  const score = (i: number) => (seek ? up[i] / Math.max(1, up[0]) : 0) + (heat ? hot[i] / Math.max(0.01, hot[0]) : 0);
  // within 3% of the top score the scores are noise (in a city centre the heatmap is hot almost
  // everywhere). Of those, the one with the largest share of cycle infrastructure wins (cycleways
  // followed), else the shortest. Before, the first to lead by 3% kept the lead: a detour through
  // Baixa beat the riverside past Praça do Comercio; "shortest" alone then took a promenade over
  // the cycleway in Parque das Nacoes (14.11.2026).
  const top = Math.max(...ok.map((_, i) => score(i)));
  const near = ok.map((l, i) => ({ l, i, km: len(l), cyc: preferCycle ? cycleShare(l) : 0 })).filter((x) => score(x.i) >= top / 1.03);
  return near.reduce((a, x) => (x.cyc > a.cyc + 0.005 || (Math.abs(x.cyc - a.cyc) <= 0.005 && x.km < a.km) ? x : a)).l;
}

/** share of the leg's length on cycle infrastructure (WaySpan.cycle) */
export function cycleShare(l: Leg): number {
  let all = 0, cyc = 0;
  for (const s of l.spans)
    for (let i = s.from + 1; i <= s.to && i < l.points.length; i++) {
      const d = straightKm(l.points[i - 1], l.points[i]);
      all += d;
      if (s.cycle) cyc += d;
    }
  return all ? cyc / all : 0;
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

/**
 * Cache key of a leg. Seek climbs and the heatmap are not profile parameters: they choose among
 * the router's options, so they are part of the key apart from the parameters sent.
 */
function cacheKey(a: LngLat, b: LngLat, profile: ProfileId, params: Params) {
  const { nk_seek: seek, nk_heat: heat, ...sent } = params;
  return legKey(a, b, profile, paramString(sent)) + (seek ? '|seek' : '') + (heat ? `|heat${HEAT_CAP}` : '');
}

/** A leg computed earlier and stored with the route: later requests for it are answered without the router. */
export function seedLeg(a: LngLat, b: LngLat, profile: ProfileId, params: Params, leg: Leg) {
  if (profile !== 'straight') cache.set(cacheKey(a, b, profile, params), Promise.resolve(leg));
}

/**
 * Version of the routing rules the stored legs were computed with. Legs of an older version are
 * routed again on open (the waypoints stay). Bump together with ROUTE_CACHE_VER in maps-api when the
 * nk-* profiles change the lines (w1: 14.11.2026, oneway penalty no longer cut by the cost caps; w2: cobblestone penalty; w3: the penalty only with "Avoid cobblestones"; w4: heatmap ties go to the shortest; w5: to the most cycle infrastructure; w6: wood and designated paths capped like cycleways).
 */
export const ROUTING_VER = 'w6';

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

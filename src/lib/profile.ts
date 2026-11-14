// Elevation profile maths: cumulative distance, smoothed grade, ascent/descent,
// and colour scales for grade and surface.
import type { LegPoint, WaySpan } from './brouter';
import { t } from './i18n';

const R = 6371008.8;
export function haversine(a: LegPoint, b: LegPoint): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface Profile {
  dist: number[]; // m, cumulative
  ele: (number | null)[];
  grade: (number | null)[]; // %, of the stretch ending at this point
  surface: SurfaceClass[];
  /** OSM tag behind the surface of each segment: the surface value, 'route=ferry', '~highway[ tracktype]' when
   *  the way has no surface tag (the class is guessed from the way type), '' with no way data */
  osm: string[];
  length: number;
  ascent: number;
  descent: number;
  minEle: number | null;
  maxEle: number | null;
}

export type SurfaceClass = 'paved' | 'compact' | 'unpaved' | 'ground' | 'path' | 'ferry' | 'unknown';

const PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'chipseal']);
const COMPACT = new Set(['compacted', 'fine_gravel', 'sett', 'cobblestone', 'unhewn_cobblestone', 'metal', 'wood']);
const UNPAVED = new Set(['gravel', 'unpaved', 'pebblestone', 'rock', 'shells']);
const GROUND = new Set(['ground', 'dirt', 'earth', 'grass', 'mud', 'sand', 'grass_paver', 'woodchips', 'clay']);

export function surfaceClass(s: Pick<WaySpan, 'surface' | 'highway' | 'tracktype' | 'route'>): SurfaceClass {
  if (s.route === 'ferry') return 'ferry';
  const v = s.surface;
  if (v) {
    if (PAVED.has(v)) return 'paved';
    if (COMPACT.has(v)) return 'compact';
    if (UNPAVED.has(v)) return 'unpaved';
    if (GROUND.has(v)) return 'ground';
  }
  // No surface tag: guess from the way type.
  const h = s.highway;
  if (!h) return 'unknown';
  if (h === 'track') return s.tracktype === 'grade1' ? 'paved' : s.tracktype === 'grade2' ? 'compact' : 'unpaved';
  if (h === 'path' || h === 'footway' || h === 'bridleway' || h === 'steps') return 'path';
  if (/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|cycleway)/.test(h)) return 'paved';
  return 'unknown';
}

/** boat crossings: blue on the line, the strips and the profile */
export const FERRY_COLOR = '#2f7fc1';

export const SURFACE_STYLE: Record<SurfaceClass, { color: string; title: string }> = {
  paved: { color: '#5b6b7a', title: t('surfLong.paved') },
  compact: { color: '#c9a227', title: t('surfLong.compact') },
  unpaved: { color: '#d4772c', title: t('surfLong.unpaved') },
  ground: { color: '#8c5a2b', title: t('surfLong.ground') },
  path: { color: '#3d9a46', title: t('surfLong.path') },
  ferry: { color: FERRY_COLOR, title: t('surfLong.ferry') },
  unknown: { color: '#b3b3b8', title: t('surfLong.unknown') },
};

/**
 * Grade colours. Bikes: a gradient in 1% steps, from blue descents through green flat to
 * yellow, orange, red and black at 18% and steeper. Steps of 1% keep the route line a set of
 * runs of equal colour (MapLibre's own line-gradient cannot be dashed, and dashes show the
 * surface). Walking keeps classes on its wider scale: 6% is a climb on a bike and nothing on
 * foot, where a mountain path is 20-30%.
 */
type GradeClass = { min: number; color: string; title: string; flat?: boolean };
const up = (a: number, b?: number) => (b == null ? `↑ >${a}%` : `↑ ${a}-${b}%`);
const down = (a: number, b?: number) => (b == null ? `↓ >${a}%` : `↓ ${a}-${b}%`);

/** gradient stops for bikes: [grade %, colour] */
export const BIKE_RAMP: [number, string][] = [
  [-12, '#08519c'],
  [-6, '#4a98cf'],
  [-1, '#9fd3c7'],
  [0, '#4fae63'],
  [2, '#c8dc6a'],
  [4, '#fdd049'],
  [7, '#fd8d3c'],
  [11, '#d73027'],
  [15, '#7a0a10'],
  [18, '#141414'],
];
const RAMP_MIN = BIKE_RAMP[0][0], RAMP_MAX = BIKE_RAMP[BIKE_RAMP.length - 1][0];
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
/** colour of every whole percent from RAMP_MIN to RAMP_MAX */
const BIKE_TABLE: string[] = [];
for (let g = RAMP_MIN; g <= RAMP_MAX; g++) {
  let k = 1;
  while (k < BIKE_RAMP.length - 1 && g > BIKE_RAMP[k][0]) k++;
  const [a, ca] = BIKE_RAMP[k - 1], [b, cb] = BIKE_RAMP[k];
  const t = Math.max(0, Math.min(1, (g - a) / (b - a)));
  const x = hex(ca), y = hex(cb);
  BIKE_TABLE.push(toHex(x.map((v, i) => v + (y[i] - v) * t)));
}
/** a bike grade colour: the gradient in 1% steps */
export function bikeGradeColor(g: number): string {
  const r = Math.max(RAMP_MIN, Math.min(RAMP_MAX, Math.round(g)));
  return BIKE_TABLE[r - RAMP_MIN];
}
/** CSS linear-gradient of the bike scale, for the legend */
export function bikeRampCss(): string {
  const span = RAMP_MAX - RAMP_MIN;
  return `linear-gradient(90deg, ${BIKE_TABLE.map((c, i) => `${c} ${((i / span) * 100).toFixed(1)}%`).join(', ')})`;
}
export const BIKE_RAMP_RANGE = [RAMP_MIN, RAMP_MAX] as const;

const HIKE: GradeClass[] = [
  { min: -Infinity, color: '#2c7fb8', title: down(30) },
  { min: -30, color: '#7fcdbb', title: down(10, 30) },
  { min: -10, color: '#4fae63', title: '', flat: true },
  { min: 10, color: '#fee08b', title: up(10, 20) },
  { min: 20, color: '#fdae61', title: up(20, 30) },
  { min: 30, color: '#d73027', title: up(30, 45) },
  { min: 45, color: '#7f0000', title: up(45) },
];

/** Legend chips for bikes: the line runs in 1% steps, the legend names a few ranges, each
 *  shown in the gradient's colour at its middle. */
const BIKE_LEGEND: GradeClass[] = [
  { min: -Infinity, color: bikeGradeColor(-12), title: down(10) },
  { min: -10, color: bikeGradeColor(-5), title: down(1, 10) },
  { min: -1, color: bikeGradeColor(0), title: '', flat: true },
  { min: 1, color: bikeGradeColor(2), title: up(1, 3) },
  { min: 3, color: bikeGradeColor(5), title: up(3, 6) },
  { min: 6, color: bikeGradeColor(8), title: up(6, 10) },
  { min: 10, color: bikeGradeColor(12), title: up(10, 14) },
  { min: 14, color: bikeGradeColor(16), title: up(14, 18) },
  { min: 18, color: bikeGradeColor(18), title: up(18) },
];

/** Legend classes: walking's own scale, or the bike chips. */
export function gradeClasses(routeType = 'nk-hike'): GradeClass[] {
  const c = isGradient(routeType) ? BIKE_LEGEND : HIKE;
  for (const k of c) if (k.flat) k.title = t('grade.flat');
  return c;
}
export const isGradient = (routeType = 'nk-road') => routeType !== 'nk-hike';
/** what counts as flat: ±1% on a bike, ±10% on foot */
export const flatLimit = (routeType = 'nk-road') => (isGradient(routeType) ? 1 : 10);

export function gradeColor(g: number | null, routeType = 'nk-road'): string {
  if (g == null) return SURFACE_STYLE.unknown.color;
  if (isGradient(routeType)) return bikeGradeColor(g);
  let c = HIKE[0].color;
  for (const k of HIKE) if (g >= k.min) c = k.color;
  return c;
}
/** Dash pattern per surface, in line widths (MapLibre) — the profile strip reuses it. */
export const SURFACE_DASH: Record<SurfaceClass, number[]> = {
  paved: [1, 0],
  compact: [4, 1.5],
  unpaved: [2, 1.5],
  ground: [1, 1.2],
  path: [0.3, 1.2],
  ferry: [1.5, 1.5],
  unknown: [1, 0],
};

/** Builds the profile. Grade is measured over a window of `win` metres to suppress DEM noise. */
export function buildProfile(points: LegPoint[], spans: WaySpan[] = [], win = 100): Profile {
  const n = points.length;
  const dist = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) dist[i] = dist[i - 1] + haversine(points[i - 1], points[i]);
  const ele = points.map((p) => p.ele);

  const grade: (number | null)[] = new Array(n).fill(null);
  let j = 0;
  for (let i = 1; i < n; i++) {
    while (j < i && dist[i] - dist[j + 1] >= win / 2) j++;
    // centre the window: from j (≥ win/2 behind) to k (≥ win/2 ahead)
    let k = i;
    while (k < n - 1 && dist[k] - dist[i] < win / 2) k++;
    const e0 = ele[j], e1 = ele[k];
    const d = dist[k] - dist[j];
    grade[i] = e0 != null && e1 != null && d > 5 ? ((e1 - e0) / d) * 100 : null;
  }
  grade[0] = grade[1] ?? null;

  // Ascent/descent with hysteresis (like BRouter's "filtered ascend").
  const H = 5;
  let ascent = 0, descent = 0, ref: number | null = null;
  let minEle: number | null = null, maxEle: number | null = null;
  for (const e of ele) {
    if (e == null) continue;
    minEle = minEle == null ? e : Math.min(minEle, e);
    maxEle = maxEle == null ? e : Math.max(maxEle, e);
    if (ref == null) ref = e;
    else if (e - ref >= H) { ascent += e - ref; ref = e; }
    else if (ref - e >= H) { descent += ref - e; ref = e; }
  }

  const surface: SurfaceClass[] = new Array(n).fill('unknown');
  const osm: string[] = new Array(n).fill('');
  for (const s of spans) {
    // legs stored before the route tag was kept: a long stretch with no way tags at all is a ferry
    // (BRouter routes only on highways and ferry lines)
    const bare = !s.highway && !s.surface && !s.tracktype && !s.route && s.to < n && dist[s.to] - dist[s.from] > 300;
    const c = bare ? 'ferry' : surfaceClass(s);
    const tag = c === 'ferry' ? 'route=ferry' : s.surface ? s.surface : s.highway ? `~${s.highway}${s.highway === 'track' && s.tracktype ? ' ' + s.tracktype : ''}` : '';
    for (let i = s.from + 1; i <= s.to && i < n; i++) { surface[i] = c; osm[i] = tag; }
  }
  if (n > 1) { surface[0] = surface[1]; osm[0] = osm[1]; }
  // on a boat the terrain model gives sea level and shore noise: no grade there
  for (let i = 0; i < n; i++) if (surface[i] === 'ferry') grade[i] = null;

  if (surface.includes('ferry')) {
    // climbing counts only on land: restart the hysteresis after each crossing
    ascent = 0; descent = 0; ref = null;
    for (let i = 0; i < n; i++) {
      const e = ele[i];
      if (surface[i] === 'ferry') { ref = null; continue; }
      if (e == null) continue;
      if (ref == null) ref = e;
      else if (e - ref >= H) { ascent += e - ref; ref = e; }
      else if (ref - e >= H) { descent += ref - e; ref = e; }
    }
  }
  return { dist, ele, grade, surface, osm, length: dist[n - 1] ?? 0, ascent, descent, minEle, maxEle };
}

export function formatKm(m: number) {
  return m < 1000 ? `${Math.round(m)} ${t('unit.m')}` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} ${t('unit.km')}`;
}

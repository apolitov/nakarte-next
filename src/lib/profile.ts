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
  length: number;
  ascent: number;
  descent: number;
  minEle: number | null;
  maxEle: number | null;
}

export type SurfaceClass = 'paved' | 'compact' | 'unpaved' | 'ground' | 'path' | 'unknown';

const PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'chipseal']);
const COMPACT = new Set(['compacted', 'fine_gravel', 'sett', 'cobblestone', 'unhewn_cobblestone', 'metal', 'wood']);
const UNPAVED = new Set(['gravel', 'unpaved', 'pebblestone', 'rock', 'shells']);
const GROUND = new Set(['ground', 'dirt', 'earth', 'grass', 'mud', 'sand', 'grass_paver', 'woodchips', 'clay']);

export function surfaceClass(s: Pick<WaySpan, 'surface' | 'highway' | 'tracktype'>): SurfaceClass {
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

export const SURFACE_STYLE: Record<SurfaceClass, { color: string; title: string }> = {
  paved: { color: '#5b6b7a', title: t('surfLong.paved') },
  compact: { color: '#c9a227', title: t('surfLong.compact') },
  unpaved: { color: '#d4772c', title: t('surfLong.unpaved') },
  ground: { color: '#8c5a2b', title: t('surfLong.ground') },
  path: { color: '#3d9a46', title: t('surfLong.path') },
  unknown: { color: '#b3b3b8', title: t('surfLong.unknown') },
};

/**
 * Grade classes: descents blue, flat green, climbs yellow to red, walls black.
 * Bikes share one scale, fine where riding feels it (1-3% is already a light climb) and coarse
 * above 10%, where everything is hard; beyond 18% black. Walking keeps its own wider scale:
 * 6% is a climb on a bike and nothing on foot, where a mountain path is 20-30%.
 */
type GradeClass = { min: number; color: string; title: string; flat?: boolean };
const up = (a: number, b?: number) => (b == null ? `↑ >${a}%` : `↑ ${a}-${b}%`);
const down = (a: number, b?: number) => (b == null ? `↓ >${a}%` : `↓ ${a}-${b}%`);
const BIKE: GradeClass[] = [
  // descents in two classes only: finer ones made the profile noisy
  { min: -Infinity, color: '#08519c', title: down(10) },
  { min: -10, color: '#7fb8dc', title: down(1, 10) },
  { min: -1, color: '#4fae63', title: '', flat: true }, // green: grey read as "no data" on flat routes
  { min: 1, color: '#f2e394', title: up(1, 3) },
  { min: 3, color: '#fdd049', title: up(3, 5) },
  { min: 5, color: '#fdae61', title: up(5, 7) },
  { min: 7, color: '#f46d43', title: up(7, 10) },
  { min: 10, color: '#d73027', title: up(10, 14) },
  { min: 14, color: '#8e0b12', title: up(14, 18) },
  { min: 18, color: '#141414', title: up(18) },
];
const HIKE: GradeClass[] = [
  { min: -Infinity, color: '#2c7fb8', title: down(30) },
  { min: -30, color: '#7fcdbb', title: down(10, 30) },
  { min: -10, color: '#4fae63', title: '', flat: true },
  { min: 10, color: '#fee08b', title: up(10, 20) },
  { min: 20, color: '#fdae61', title: up(20, 30) },
  { min: 30, color: '#d73027', title: up(30, 45) },
  { min: 45, color: '#7f0000', title: up(45) },
];

export function gradeClasses(routeType = 'nk-road'): GradeClass[] {
  const c = routeType === 'nk-hike' ? HIKE : BIKE;
  for (const k of c) if (k.flat) k.title = t('grade.flat');
  return c;
}
/** The road scale (the strictest one). */
export const GRADE_CLASSES = gradeClasses('nk-road');

export function gradeColor(g: number | null, routeType = 'nk-road'): string {
  if (g == null) return SURFACE_STYLE.unknown.color;
  const cls = gradeClasses(routeType);
  let c = cls[0].color;
  for (const k of cls) if (g >= k.min) c = k.color;
  return c;
}

/** Dash pattern per surface, in line widths (MapLibre) — the profile strip reuses it. */
export const SURFACE_DASH: Record<SurfaceClass, number[]> = {
  paved: [1, 0],
  compact: [4, 1.5],
  unpaved: [2, 1.5],
  ground: [1, 1.2],
  path: [0.3, 1.2],
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
  for (const s of spans) {
    const c = surfaceClass(s);
    for (let i = s.from + 1; i <= s.to && i < n; i++) surface[i] = c;
  }
  if (n > 1) surface[0] = surface[1];

  return { dist, ele, grade, surface, length: dist[n - 1] ?? 0, ascent, descent, minEle, maxEle };
}

export function formatKm(m: number) {
  return m < 1000 ? `${Math.round(m)} ${t('unit.m')}` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} ${t('unit.km')}`;
}

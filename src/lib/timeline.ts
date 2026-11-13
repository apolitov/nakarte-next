// Route timeline: notable places along the route computed from its geometry
// and profile: start, finish, checkpoints, climbs, straight legs and surface
// changes. Also the surface shares for the summary.
import { gradeColor, gradeClasses, type Profile, type SurfaceClass } from './profile';
import { kindOf } from './checkpointKinds';
import { t } from './i18n';

export type SegClass = SurfaceClass | 'straight';

export const SEG_ORDER: SegClass[] = ['paved', 'compact', 'unpaved', 'ground', 'path', 'straight', 'unknown'];
export const SEG_SHORT: Record<SegClass, string> = {
  paved: t('surf.paved'),
  compact: t('surf.compact'),
  unpaved: t('surf.unpaved'),
  ground: t('surf.ground'),
  path: t('surf.path'),
  straight: t('surf.straight'),
  unknown: t('surf.unknown'),
};
/** Dash pattern for straight legs (the rest come from SURFACE_DASH). */
export const STRAIGHT_COLOR = '#6b7280';

export interface TLPoint {
  lng: number;
  lat: number;
  straight?: boolean;
  leg?: number;
}

export type EventKind = 'start' | 'end' | 'checkpoint' | 'climb' | 'straight' | 'surface';

export interface TimelineEvent {
  id: string;
  kind: EventKind;
  /** point index and distance (m) */
  i: number;
  d: number;
  /** end of a stretch (climb, straight leg, surface run) */
  i2?: number;
  d2?: number;
  label: string;
  cpId?: string;
  cpKind?: string;
  surface?: SegClass;
  /** lower is more important */
  priority: number;
  /** size within the priority (gain, length): bigger is kept longer */
  weight: number;
}

export interface Rail {
  color: string;
  surface: SegClass;
  flat: boolean;
}

/** Decimal for display: 2.9 */
export const dec = (v: number, digits = 1) => v.toFixed(digits).replace('-', '−');
export const km1 = (m: number) => dec(m / 1000);

/** Class of every segment (i-1 → i), stored at point i. */
export function segmentClasses(points: TLPoint[], surface: SurfaceClass[]): SegClass[] {
  return points.map((p, i) => (p.straight ? 'straight' : (surface[i] ?? 'unknown')));
}

/** Metres per class, in display order, without empty ones. */
export function surfaceShares(dist: number[], cls: SegClass[]): { cls: SegClass; m: number; share: number }[] {
  const acc = new Map<SegClass, number>();
  for (let i = 1; i < dist.length; i++) acc.set(cls[i], (acc.get(cls[i]) ?? 0) + dist[i] - dist[i - 1]);
  const total = dist.at(-1) ?? 0;
  if (!total) return [];
  return SEG_ORDER.filter((c) => (acc.get(c) ?? 0) > 0).map((c) => ({ cls: c, m: acc.get(c)!, share: acc.get(c)! / total }));
}

/** Nearest route point to a location and the distance to it in metres. */
export function nearestPoint(points: TLPoint[], lng: number, lat: number): { i: number; m: number } {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = -1, bd = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = ((points[i].lng - lng) * k) ** 2 + (points[i].lat - lat) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, m: Math.sqrt(bd) * 111_320 };
}

export interface Climb {
  a: number;
  b: number;
  gain: number;
  len: number;
}

/**
 * Minimum gain of a climb, relative to the route: 10% of its relief (5th to 95th
 * percentile of elevation), between 10 and 80 m. On a flat route a 15 m hill is
 * worth showing; on a mountain route it would be noise.
 */
export function climbThreshold(ele: (number | null)[]): number {
  const e = ele.filter((v): v is number => v != null).sort((a, b) => a - b);
  if (!e.length) return 30;
  const q = (f: number) => e[Math.min(e.length - 1, Math.floor(f * e.length))];
  return Math.min(80, Math.max(10, 0.1 * (q(0.95) - q(0.05))));
}

/**
 * Climbs: continuous stretches gaining at least `minGain` m (relative to the route,
 * see climbThreshold) at an average of at least `minGrade` %. Short dips inside a
 * climb are tolerated, and climbs close to each other are merged.
 */
export function findClimbs(p: Pick<Profile, 'dist' | 'ele' | 'grade'>, minGain = climbThreshold(p.ele), minGrade = 3): Climb[] {
  const { dist, ele, grade } = p;
  const n = dist.length;
  const e = (i: number) => ele[i] ?? NaN;
  const minIn = (a: number, b: number) => {
    let m = Infinity;
    for (let i = a; i <= b; i++) m = Math.min(m, e(i));
    return m;
  };

  // rising runs
  const runs: { a: number; b: number }[] = [];
  let a = -1;
  for (let i = 1; i < n; i++) {
    const g = grade[i];
    if (g != null && g >= 1.5) {
      if (a < 0) a = i - 1;
    } else if (a >= 0) {
      runs.push({ a, b: i - 1 });
      a = -1;
    }
  }
  if (a >= 0) runs.push({ a, b: n - 1 });

  // glue runs split by short flat bits or small dips
  const glued: { a: number; b: number }[] = [];
  for (const r of runs) {
    const last = glued.at(-1);
    if (last && dist[r.a] - dist[last.b] <= 300 && minIn(last.b, r.a) >= e(last.b) - 10) last.b = r.b;
    else glued.push({ ...r });
  }

  const measure = (a: number, b: number): Climb => {
    let top = a;
    for (let i = a; i <= b; i++) if (e(i) > e(top)) top = i;
    let low = a;
    for (let i = a; i <= top; i++) if (e(i) < e(low)) low = i;
    return { a: low, b: top, gain: e(top) - e(low), len: dist[top] - dist[low] };
  };
  const ok = (c: Climb) => c.len > 0 && c.gain >= minGain && (c.gain / c.len) * 100 >= minGrade;

  const out: Climb[] = [];
  for (const r of glued) {
    const c = measure(r.a, r.b);
    if (!ok(c)) continue;
    const prev = out.at(-1);
    if (prev && dist[c.a] - dist[prev.b] <= 500 && e(prev.b) - minIn(prev.b, c.a) <= 20) {
      const m = measure(prev.a, c.b);
      if (ok(m)) {
        out[out.length - 1] = m;
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

/**
 * Steep pitches outside climbs: at least `minGain` m at `minGrade` % or more (grade over
 * 100 m), e.g. a short wall on a flat route. Inside a climb its own max grade covers them.
 */
export function findSteep(p: Pick<Profile, 'dist' | 'ele' | 'grade'>, climbs: Climb[], minGain = 10, minGrade = 8): Climb[] {
  const { dist, ele, grade } = p;
  const e = (i: number) => ele[i] ?? NaN;
  const out: Climb[] = [];
  let a = -1;
  // the grade is averaged over ±50 m, so a short wall shows lower: look for it at 3/4 of the
  // threshold and measure the real gain from the last low point to the top
  const close = (b: number) => {
    b = Math.min(dist.length - 1, b + 2);
    let low = a, top = a;
    for (let i = a; i <= b; i++) if (e(i) > e(top)) top = i;
    for (let i = a; i <= top; i++) if (e(i) <= e(low)) low = i;
    const c = { a: low, b: top, gain: e(top) - e(low), len: dist[top] - dist[low] };
    const inside = climbs.some((k) => c.a < k.b && c.b > k.a);
    if (!inside && c.len > 0 && c.gain >= minGain && (c.gain / c.len) * 100 >= minGrade) out.push(c);
  };
  for (let i = 1; i < dist.length; i++) {
    const g = grade[i];
    if (g != null && g >= minGrade * 0.75) {
      if (a < 0) a = Math.max(0, i - 2);
    } else if (a >= 0) {
      close(i - 1);
      a = -1;
    }
  }
  if (a >= 0) close(dist.length - 1);
  return out;
}

/** Runs of equal class over segments; `a`/`b` are point indexes. */
function classRuns(cls: SegClass[]): { cls: SegClass; a: number; b: number }[] {
  const runs: { cls: SegClass; a: number; b: number }[] = [];
  for (let i = 1; i < cls.length; i++) {
    const last = runs.at(-1);
    if (last && last.cls === cls[i]) last.b = i;
    else runs.push({ cls: cls[i], a: i - 1, b: i });
  }
  return runs;
}

/** Surface runs of at least `minLen` m; shorter bits, straight legs and unknown surface join the run before. */
export function surfaceRuns(dist: number[], cls: SegClass[], minLen = 300) {
  const sig: { cls: SegClass; a: number; b: number }[] = [];
  let lead = -1; // start of bits before the first significant run
  for (const r of classRuns(cls)) {
    const len = dist[r.b] - dist[r.a];
    const weak = r.cls === 'straight' || r.cls === 'unknown' || len < minLen;
    const last = sig.at(-1);
    if (weak) {
      if (last) last.b = r.b;
      else if (lead < 0) lead = r.a;
      continue;
    }
    if (last && last.cls === r.cls) last.b = r.b;
    else sig.push({ ...r, a: !last && lead >= 0 ? lead : r.a });
  }
  return sig;
}

export interface TimelineInput {
  points: TLPoint[];
  profile: Pick<Profile, 'dist' | 'ele' | 'grade' | 'surface' | 'length'>;
  checkpoints: { id: string; lng: number; lat: number; kind: string; name: string }[];
}

export function buildTimeline({ points, profile, checkpoints }: TimelineInput): TimelineEvent[] {
  const { dist } = profile;
  const n = points.length;
  if (n < 2) return [];
  const cls = segmentClasses(points, profile.surface);
  const ev: TimelineEvent[] = [];

  ev.push({ id: 'start', kind: 'start', i: 0, d: 0, label: t('tl.start'), priority: 0, weight: 0 });

  for (const c of checkpoints) {
    const near = nearestPoint(points, c.lng, c.lat);
    if (near.i < 0 || near.m > 500) continue;
    ev.push({
      id: `cp:${c.id}`,
      kind: 'checkpoint',
      i: near.i,
      d: dist[near.i],
      label: c.name || kindOf(c.kind).title,
      cpId: c.id,
      cpKind: c.kind,
      priority: 1,
      weight: 0,
    });
  }

  const climbs = findClimbs(profile);
  for (const c of findSteep(profile, climbs)) {
    ev.push({
      id: `steep:${c.a}`,
      kind: 'climb',
      i: c.a,
      i2: c.b,
      d: dist[c.a],
      d2: dist[c.b],
      label: t('tl.steep', { m: Math.round(c.len), g: Math.round((c.gain / c.len) * 100), gain: Math.round(c.gain) }),
      priority: 1,
      weight: c.gain,
    });
  }
  for (const c of climbs) {
    const avg = Math.round((c.gain / c.len) * 100);
    ev.push({
      id: `climb:${c.a}`,
      kind: 'climb',
      i: c.a,
      i2: c.b,
      d: dist[c.a],
      d2: dist[c.b],
      label: t('tl.climb', { km: km1(c.len), g: avg, gain: Math.round(c.gain) }),
      priority: 1,
      weight: c.gain,
    });
  }

  for (const r of classRuns(cls)) {
    if (r.cls !== 'straight') continue;
    const len = dist[r.b] - dist[r.a];
    ev.push({
      id: `straight:${r.a}`,
      kind: 'straight',
      i: r.a,
      i2: r.b,
      d: dist[r.a],
      d2: dist[r.b],
      label: t('tl.straight', { km: km1(len) }),
      surface: 'straight',
      priority: 2,
      weight: len,
    });
  }

  const runs = surfaceRuns(dist, cls);
  runs.forEach((r, k) => {
    if (k === 0 && r.cls === 'paved') return; // starting on asphalt is the usual case
    const len = dist[r.b] - dist[r.a];
    ev.push({
      id: `surf:${r.a}`,
      kind: 'surface',
      i: r.a,
      i2: r.b,
      d: dist[r.a],
      d2: dist[r.b],
      label: t('tl.surface', { surface: SEG_SHORT[r.cls], km: km1(len) }),
      surface: r.cls,
      priority: 3,
      weight: len,
    });
  });

  ev.push({ id: 'end', kind: 'end', i: n - 1, d: profile.length, label: t('tl.finish'), priority: 0, weight: 0 });

  const order: Record<EventKind, number> = { start: 0, checkpoint: 1, climb: 2, straight: 3, surface: 4, end: 9 };
  return ev.sort((x, y) => x.d - y.d || order[x.kind] - order[y.kind]);
}

/** Keeps at most `max` events, dropping the least important first; order is kept. */
export function limitEvents(events: TimelineEvent[], max: number): TimelineEvent[] {
  if (events.length <= max) return events;
  const drop = new Set(
    [...events]
      .filter((e) => e.priority > 0)
      .sort((a, b) => b.priority - a.priority || a.weight - b.weight)
      .slice(0, events.length - Math.max(max, 2))
      .map((e) => e.id),
  );
  return events.filter((e) => !drop.has(e.id));
}

/** Rail for the stretch from each event to the next one: average grade colour and the main surface. */
export function rails(events: TimelineEvent[], profile: Pick<Profile, 'dist' | 'ele'>, cls: SegClass[], routeType = 'nk-road'): (Rail | null)[] {
  const gc = gradeClasses(routeType);
  const { dist, ele } = profile;
  return events.map((e, k) => {
    const next = events[k + 1];
    if (!next) return null;
    let a = e.i, b = next.i;
    if (b <= a) b = Math.min(dist.length - 1, a + 1);
    const e0 = ele[a], e1 = ele[b];
    const len = dist[b] - dist[a];
    const g = e0 != null && e1 != null && len > 0 ? ((e1 - e0) / len) * 100 : null;
    const acc = new Map<SegClass, number>();
    for (let i = a + 1; i <= b; i++) acc.set(cls[i], (acc.get(cls[i]) ?? 0) + dist[i] - dist[i - 1]);
    let surface: SegClass = cls[b] ?? 'unknown';
    let best = -1;
    for (const [c, m] of acc) if (m > best) { best = m; surface = c; }
    const flat = g != null && g >= gc[2].min && g < gc[3].min;
    return { color: surface === 'straight' ? STRAIGHT_COLOR : gradeColor(g, routeType), surface, flat };
  });
}

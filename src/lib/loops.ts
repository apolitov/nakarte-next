// "A loop of L km from here": the loop generator (prototype measured in tools/loops/proto.py).
// Candidates are the start plus 2 or 3 via points on a polygon around it, in several directions;
// each leg is an ordinary router request (plain: no heatmap or climb variants, one request a leg).
// A second round rescales the directions that came out closest by the length they actually got.
// Ranked by the heatmap along the loop, stretches ridden twice and how close the length is;
// the three best that differ from each other are offered.
import { fetchLeg, type Leg, type LegPoint, type Params, type ProfileId } from './brouter';
import { heatAlong } from './rwheat';
import { haversine } from './profile';

export type LngLat = { lng: number; lat: number };

export interface LoopCandidate {
  /** start, via points, start */
  waypoints: LngLat[];
  legs: Leg[];
  points: LegPoint[];
  km: number;
  ascent: number;
  /** share of the loop on stretches it already rode (0…1) */
  repeat: number;
  /** mean heatmap along the loop (0…1) */
  heat: number;
  score: number;
}

export interface LoopRequest {
  start: LngLat;
  km: number;
  profile: ProfileId;
  /** the route options without the variant pickers (heatmap, seek climbs) */
  params: Params;
  /** compass bearing to head towards; null for any */
  bearing: number | null;
  onprogress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** road length / straight polygon perimeter, first guess (prototype: 1.2–1.5) */
const FACTOR = 1.3;
/** a candidate within this share of the asked length counts as a hit */
const TOLERANCE = 0.12;

function offset(p: LngLat, km: number, brg: number): LngLat {
  const b = (brg * Math.PI) / 180;
  return { lng: p.lng + (km * Math.sin(b)) / (111.32 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat + (km * Math.cos(b)) / 110.57 };
}

/** start + n via points: a regular (n+1)-gon with the start as a vertex, its far side towards brg */
export function loopShape(start: LngLat, perimeterKm: number, brg: number, n: number): LngLat[] {
  const k = n + 1;
  const side = perimeterKm / k;
  const pts = [start];
  let p = start;
  let h = brg - (180 - 360 / k) / 2;
  for (let i = 0; i < n; i++) {
    p = offset(p, side, h);
    pts.push(p);
    h += 360 / k;
  }
  return [...pts, start];
}

function resample(pts: LngLat[], step = 30): LngLat[] {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let d = haversine({ ...a, ele: null }, { ...b, ele: null });
    while (carry + d >= step && d > 0) {
      const f = (step - carry) / d;
      a = { lng: a.lng + (b.lng - a.lng) * f, lat: a.lat + (b.lat - a.lat) * f };
      d -= step - carry;
      carry = 0;
      out.push(a);
    }
    carry += d;
  }
  return out;
}

/** share of a line that runs within 25 m of a stretch it rode earlier (out and back, a spur ridden twice) */
export function repeatShare(points: LngLat[]): number {
  const s = resample(points);
  const cells = new Map<string, number[]>();
  let rep = 0;
  s.forEach((p, i) => {
    const x = Math.floor((p.lng * 111320 * Math.cos((p.lat * Math.PI) / 180)) / 25);
    const y = Math.floor((p.lat * 110570) / 25);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++)
      for (let dy = -1; dy <= 1 && !hit; dy++) hit = (cells.get(`${x + dx},${y + dy}`) ?? []).some((j) => i - j > 15);
    if (hit) rep++;
    const k = `${x},${y}`;
    cells.set(k, [...(cells.get(k) ?? []), i]);
  });
  return s.length ? rep / s.length : 0;
}

/** how much of b runs along a (both resampled), for telling candidates apart */
function overlap(a: LngLat[], b: LngLat[]): number {
  const cells = new Set(resample(a).map((p) => `${Math.floor((p.lng * 111320 * Math.cos((p.lat * Math.PI) / 180)) / 40)},${Math.floor((p.lat * 110570) / 40)}`));
  const rb = resample(b);
  let n = 0;
  for (const p of rb) {
    const x = Math.floor((p.lng * 111320 * Math.cos((p.lat * Math.PI) / 180)) / 40), y = Math.floor((p.lat * 110570) / 40);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) hit = cells.has(`${x + dx},${y + dy}`);
    if (hit) n++;
  }
  return rb.length ? n / rb.length : 0;
}

function ascentOf(points: LegPoint[]): number {
  let up = 0, ref: number | null = null;
  for (const q of points) {
    if (q.ele == null) continue;
    if (ref == null) ref = q.ele;
    else if (q.ele - ref >= 5) (up += q.ele - ref), (ref = q.ele);
    else if (ref - q.ele >= 5) ref = q.ele;
  }
  return up;
}

type Raw = { brg: number; n: number; per: number; waypoints: LngLat[]; legs: Leg[]; points: LegPoint[]; km: number };

/** Finds up to `count` different loops of about req.km from req.start, best first. */
export async function findLoops(req: LoopRequest, count = 3): Promise<LoopCandidate[]> {
  const n = req.km <= 40 ? 2 : 3;
  // any direction: 8 headings; one direction: it and 30° to each side, with 2 and 3 via points
  const shapes: { brg: number; n: number }[] =
    req.bearing == null
      ? Array.from({ length: 8 }, (_, i) => ({ brg: i * 45, n }))
      : [-30, 0, 30].flatMap((d) => [{ brg: req.bearing! + d, n: 2 }, { brg: req.bearing! + d, n: 3 }]);
  const legsPerShape = (s: { n: number }) => s.n + 1;
  let total = shapes.reduce((s, x) => s + legsPerShape(x), 0) + 5 * (n + 1);
  let done = 0;
  const tick = () => req.onprogress?.(++done, total);

  async function build(brg: number, nn: number, per: number): Promise<Raw | null> {
    const wps = loopShape(req.start, per, brg, nn);
    try {
      const legs = await Promise.all(
        wps.slice(1).map((b, i) => {
          if (req.signal?.aborted) throw new DOMException('aborted', 'AbortError');
          return fetchLeg(wps[i], b, req.profile, req.params).finally(tick);
        }),
      );
      const points: LegPoint[] = [];
      legs.forEach((l, i) => points.push(...(i ? l.points.slice(1) : l.points)));
      let m = 0;
      for (let i = 1; i < points.length; i++) m += haversine(points[i - 1], points[i]);
      return { brg, n: nn, per, waypoints: wps, legs, points, km: m / 1000 };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      return null; // water, no roads: this direction is skipped
    }
  }

  const first = (await Promise.all(shapes.map((s) => build(s.brg, s.n, req.km / FACTOR)))).filter((x): x is Raw => !!x);
  // round 2: rescale the five closest by the length they got
  const closest = [...first].sort((a, b) => Math.abs(a.km - req.km) - Math.abs(b.km - req.km)).slice(0, 5);
  total = done + closest.reduce((s, x) => s + x.n + 1, 0);
  const second = (
    await Promise.all(closest.map((c) => (Math.abs(c.km - req.km) / req.km <= 0.04 ? Promise.resolve(null) : build(c.brg, c.n, (c.per * req.km) / Math.max(c.km, 1)))))
  ).filter((x): x is Raw => !!x);
  req.onprogress?.(total, total);

  let all = [...first, ...second];
  const hits = all.filter((c) => Math.abs(c.km - req.km) / req.km <= TOLERANCE);
  if (hits.length) all = hits;
  const scored: LoopCandidate[] = await Promise.all(
    all.map(async (c) => {
      const repeat = repeatShare(c.points);
      const heat = await heatAlong(c.points).catch(() => 0);
      const miss = Math.abs(c.km - req.km) / req.km;
      return { waypoints: c.waypoints, legs: c.legs, points: c.points, km: c.km, ascent: ascentOf(c.points), repeat, heat, score: heat - 1.2 * repeat - 0.8 * miss };
    }),
  );
  scored.sort((a, b) => b.score - a.score);
  // the best ones that are not the same loop again
  const out: LoopCandidate[] = [];
  for (const c of scored) {
    if (out.every((o) => overlap(o.points, c.points) < 0.6)) out.push(c);
    if (out.length === count) break;
  }
  return out;
}

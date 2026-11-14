// Statistics of a saved route from its stored legs, for the routes screen: no router calls.
import { unpackLeg, normalizeProfile, type LegPoint, type WaySpan } from './brouter';
import { buildProfile, haversine } from './profile';
import { routeMinutes } from './eta';
import { surfaceShares, type SegClass } from './timeline';
import type { RouteDoc } from './store';

export interface RouteStats {
  km: number;
  ascent: number;
  minutes: number;
  surface: { cls: SegClass; share: number }[];
  /** false: no stored legs (an old or unfinished route); km is then along the waypoints */
  full: boolean;
}

const memo = new Map<string, RouteStats>();

export function routeStats(r: RouteDoc): RouteStats {
  const key = `${r.id}|${r.updated}`;
  const hit = memo.get(key);
  if (hit) return hit;
  let out: RouteStats;
  const legs = r.legs && r.legs.length === r.waypoints.length - 1 ? r.legs : null;
  if (legs) {
    const points: LegPoint[] = [];
    const spans: WaySpan[] = [];
    const straight: boolean[] = [];
    legs.forEach((sl, i) => {
      const l = unpackLeg(sl);
      const off = points.length ? points.length - 1 : 0;
      const pts = points.length ? l.points.slice(1) : l.points;
      for (const s of l.spans) spans.push({ ...s, from: s.from + off, to: s.to + off });
      points.push(...pts);
      for (let k = 0; k < pts.length; k++) straight.push(!!r.waypoints[i].straight);
    });
    const p = buildProfile(points, spans);
    const cls = p.surface.map((c, i) => (straight[i] ? 'straight' : c)) as SegClass[];
    out = {
      km: p.length / 1000,
      ascent: p.ascent,
      minutes: routeMinutes(p, normalizeProfile(r.profile ?? '')),
      surface: surfaceShares(p.dist, cls).map(({ cls, share }) => ({ cls, share })),
      full: true,
    };
  } else {
    let m = 0;
    for (let i = 1; i < r.waypoints.length; i++) m += haversine({ ...r.waypoints[i - 1], ele: null }, { ...r.waypoints[i], ele: null });
    out = { km: m / 1000, ascent: 0, minutes: 0, surface: [], full: false };
  }
  memo.set(key, out);
  return out;
}

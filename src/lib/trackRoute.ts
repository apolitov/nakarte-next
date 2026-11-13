// An imported track opened as a route: the route keeps the track's own geometry and
// elevation (GPX elevation is usually barometric and better than any terrain model),
// split into legs of about a kilometre so it can be edited piece by piece. Surfaces
// are not in a GPX: each leg is also routed with the matching profile and every track
// point takes the way tags of the nearest routed point, if it lies within MATCH_M.
// Where the walker left the router's ways (a path the profile forbids, open ground),
// the surface stays unknown.
import type { Position } from 'geojson';
import { fetchLeg, packLeg, type LegPoint, type Leg, type Params, type ProfileId, type WaySpan } from './brouter';
import { elevationAt } from './dem';
import { haversine } from './profile';

const MIN_GAP_M = 5; // points closer than this are dropped (a watch at a stop records many)
const MATCH_M = 30;

/** Route type for a GPX `<type>` (Strava, Garmin and Komoot write these). */
export function profileForActivity(type: string | undefined, fallback: ProfileId): ProfileId {
  const s = (type ?? '').toLowerCase();
  if (/hik|walk|trek|run|trail|mountaineer|snowshoe/.test(s)) return 'nk-hike';
  if (/mountain_?bik|mtb|e_?mountain/.test(s)) return 'nk-mtb';
  if (/gravel/.test(s)) return 'nk-gravel';
  if (/road|cycl|bik|ride/.test(s)) return 'nk-road';
  return fallback;
}

/** All lines of the track as one thinned line of points. */
export function trackPoints(lines: Position[][]): LegPoint[] {
  const out: LegPoint[] = [];
  for (const line of lines)
    for (const c of line) {
      const p = { lng: c[0], lat: c[1], ele: c.length > 2 && Number.isFinite(c[2]) ? c[2] : null };
      if (out.length && haversine(out[out.length - 1], p) < MIN_GAP_M) continue;
      out.push(p);
    }
  const last = lines.at(-1)?.at(-1);
  if (last && out.length > 1) {
    const end = { lng: last[0], lat: last[1], ele: last.length > 2 && Number.isFinite(last[2]) ? last[2] : null };
    if (haversine(out[out.length - 1], end) > 0) out.push(end);
  }
  return out;
}

/** Indexes where legs start: about every `step` metres, the last point closes the route. */
export function splitIndexes(pts: LegPoint[], step: number): number[] {
  const idx = [0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += haversine(pts[i - 1], pts[i]);
    if (acc >= step && i < pts.length - 1) {
      idx.push(i);
      acc = 0;
    }
  }
  if (pts.length > 1) {
    // a short tail joins the previous leg
    const lastStart = idx[idx.length - 1];
    let tail = 0;
    for (let i = lastStart + 1; i < pts.length; i++) tail += haversine(pts[i - 1], pts[i]);
    if (idx.length > 1 && tail < step / 3) idx.pop();
    idx.push(pts.length - 1);
  }
  return idx;
}

/** Way tags of the routed leg moved onto the track points near it. */
export function transferSpans(track: LegPoint[], routed: Leg): WaySpan[] {
  const tagsAt: (WaySpan | null)[] = new Array(routed.points.length).fill(null);
  for (const s of routed.spans) for (let i = s.from; i <= s.to && i < tagsAt.length; i++) tagsAt[i] = s;
  const own = track.map((p) => {
    let best = Infinity, bi = -1;
    for (let j = 0; j < routed.points.length; j++) {
      const d = haversine(p, routed.points[j]);
      if (d < best) { best = d; bi = j; }
    }
    return best <= MATCH_M && bi >= 0 ? tagsAt[bi] : null;
  });
  const key = (s: WaySpan | null) => (s ? `${s.highway ?? ''}|${s.surface ?? ''}|${s.tracktype ?? ''}` : '');
  const spans: WaySpan[] = [];
  let from = 0;
  for (let i = 1; i <= own.length; i++) {
    if (i < own.length && key(own[i]) === key(own[from])) continue;
    const s = own[from];
    if (s) spans.push({ from, to: i - 1, highway: s.highway, surface: s.surface, tracktype: s.tracktype });
    from = i;
  }
  return spans;
}

export interface TrackRoute {
  waypoints: { lng: number; lat: number }[];
  legs: ReturnType<typeof packLeg>[];
  /** share of the length with a known surface, 0..1 */
  matched: number;
}

/** Builds route waypoints and legs from a track; asks the router once per leg for surfaces. */
export async function trackToRoute(lines: Position[][], profile: ProfileId, params: Params): Promise<TrackRoute> {
  const pts = trackPoints(lines);
  if (pts.length < 2) throw new Error('track too short');
  // fill missing elevation from the terrain tiles
  const missing = pts.filter((p) => p.ele == null);
  if (missing.length) {
    const eles = await Promise.all(missing.map((p) => elevationAt(p.lng, p.lat)));
    missing.forEach((p, i) => (p.ele = eles[i]));
  }
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += haversine(pts[i - 1], pts[i]);
  // about a kilometre per leg, at most ~60 legs (and so markers) on a long track
  const step = Math.max(1000, total / 60);
  const idx = splitIndexes(pts, step);
  let known = 0;
  const legs = await Promise.all(
    idx.slice(0, -1).map(async (a, k) => {
      const seg = pts.slice(a, idx[k + 1] + 1);
      let spans: WaySpan[] = [];
      try {
        spans = transferSpans(seg, await fetchLeg(seg[0], seg[seg.length - 1], profile, params));
      } catch {
        /* no router answer: this leg simply has no surfaces */
      }
      for (const s of spans) for (let i = s.from + 1; i <= s.to; i++) known += haversine(seg[i - 1], seg[i]);
      return packLeg({ points: seg, spans });
    }),
  );
  return {
    waypoints: idx.map((i) => ({ lng: pts[i].lng, lat: pts[i].lat })),
    legs,
    matched: total ? known / total : 0,
  };
}

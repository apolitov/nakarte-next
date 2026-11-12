// BRouter client. One request per leg (pair of neighbouring waypoints), so
// dragging a point recalculates only the two legs around it.
import type { Position } from 'geojson';

export const PROFILES = [
  { id: 'trekking', title: 'Велотуризм' },
  { id: 'gravel', title: 'Гравел' },
  { id: 'fastbike', title: 'Шоссе' },
  { id: 'mtb', title: 'МТБ' },
  { id: 'hiking-mountain', title: 'Пешком' },
  { id: 'shortest', title: 'Кратчайший' },
  { id: 'straight', title: 'По прямой' },
] as const;
export type ProfileId = (typeof PROFILES)[number]['id'];

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
  if (!f) throw new Error('пустой ответ BRouter');
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

type LngLat = { lng: number; lat: number };

export function fetchLeg(a: LngLat, b: LngLat, profile: ProfileId): Promise<Leg> {
  if (profile === 'straight') {
    return Promise.resolve({ points: [a, b].map((p) => ({ lng: p.lng, lat: p.lat, ele: null })), spans: [] });
  }
  const key = `${profile}|${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}`;
  let p = cache.get(key);
  if (!p) {
    const url = `${API}?lonlats=${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}&profile=${profile}&alternativeidx=0&format=geojson`;
    p = fetch(url).then(async (r) => {
      const text = await r.text();
      if (!r.ok) throw new Error(text.trim().split('\n')[0] || `BRouter ${r.status}`);
      return parseBrouter(JSON.parse(text));
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

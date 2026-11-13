import { gpx, kml } from '@tmcw/togeojson';
import { CHECKPOINT_KINDS, kindOf } from './checkpoints';
import type { Feature, FeatureCollection, LineString, MultiLineString, Point, Position } from 'geojson';
import { t } from './i18n';

export interface Track {
  id: string;
  name: string;
  lines: Position[][];
  points: { id?: string; name: string; coord: Position; kind?: string; note?: string }[];
  /** GPX <type>: hiking, cycling… (picks the route type when the track is opened as a route) */
  activity?: string;
  /** the route made from this track, opened again instead of making a copy */
  routeId?: string;
}

let seq = 0;
const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export function parseTrackFile(name: string, text: string): Track {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(t('err.notXml', { name }));
  const fc = (/\.kml$/i.test(name) ? kml(doc) : gpx(doc)) as FeatureCollection;
  const lines: Position[][] = [];
  const points: Track['points'] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') lines.push((g as LineString).coordinates);
    else if (g.type === 'MultiLineString') lines.push(...(g as MultiLineString).coordinates);
    else if (g.type === 'Point')
      points.push({
        name: String(f.properties?.name ?? ''),
        coord: (g as Point).coordinates,
        kind: kindFromSym(String(f.properties?.sym ?? f.properties?.type ?? '')),
        note: f.properties?.desc ? String(f.properties.desc) : undefined,
      });
  }
  if (!lines.length && !points.length) throw new Error(t('err.noTracks', { name }));
  const title = String(fc.features[0]?.properties?.name ?? '') || name.replace(/\.(gpx|kml)$/i, '');
  const activity = fc.features.find((f) => f.geometry?.type !== 'Point')?.properties?.type;
  return { id: newId(), name: title, lines, points, activity: activity ? String(activity) : undefined };
}

const esc = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

function kindFromSym(sym: string): string {
  if (!sym) return 'generic';
  const k = CHECKPOINT_KINDS.find((k) => k.id === sym || k.gpx.toLowerCase() === sym.toLowerCase());
  return k?.id ?? 'generic';
}

const pt = (tag: string, [lng, lat, ele]: Position, inner = '') =>
  `<${tag} lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}">${ele != null ? `<ele>${ele.toFixed(1)}</ele>` : ''}${inner}</${tag}>`;

export function toGpx(t: Track): string {
  const wpts = t.points
    .map((p) => {
      const k = kindOf(p.kind ?? 'generic');
      const inner =
        `<name>${esc(p.name || k.title)}</name>` +
        (p.note ? `<desc>${esc(p.note)}</desc>` : '') +
        `<sym>${esc(k.gpx)}</sym><type>${esc(k.id)}</type>`;
      return pt('wpt', p.coord, inner);
    })
    .join('\n');
  const segs = t.lines.map((l) => `<trkseg>${l.map((c) => pt('trkpt', c)).join('')}</trkseg>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="nakarte-next" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${esc(t.name)}</name></metadata>
${wpts}
<trk><name>${esc(t.name)}</name>
${segs}
</trk>
</gpx>
`;
}

export function trackToGeoJSON(tracks: Track[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks.flatMap((t): Feature[] => [
      ...t.lines.map((coordinates) => ({
        type: 'Feature' as const,
        properties: { track: t.id },
        geometry: { type: 'LineString' as const, coordinates },
      })),
      ...t.points.map((p) => ({
        type: 'Feature' as const,
        properties: { track: t.id, name: p.name },
        geometry: { type: 'Point' as const, coordinates: p.coord },
      })),
    ]),
  };
}

export function bboxOf(t: Track): [number, number, number, number] | null {
  const all = [...t.lines.flat(), ...t.points.map((p) => p.coord)];
  if (!all.length) return null;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const [x, y] of all) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  return [w, s, e, n];
}

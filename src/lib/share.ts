// A route in the URL: waypoints as an encoded polyline (precision 1e-5, ~1 m),
// plus profile, straight legs and profile parameters. The road geometry is
// recalculated by the router on the receiving side.
//   r=<profile>!<polyline>!<straight leg indexes>!<k:v,k:v>  ('!' never occurs in a polyline)
import type { RouteDoc } from './store';

const P = 1e5;

export function encodePolyline(pts: { lng: number; lat: number }[]): string {
  let out = '';
  let plat = 0, plng = 0;
  const enc = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    while (s >= 0x20) {
      out += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    out += String.fromCharCode(s + 63);
  };
  for (const p of pts) {
    const lat = Math.round(p.lat * P), lng = Math.round(p.lng * P);
    enc(lat - plat);
    enc(lng - plng);
    plat = lat;
    plng = lng;
  }
  return out;
}

export function decodePolyline(s: string): { lng: number; lat: number }[] {
  const out: { lng: number; lat: number }[] = [];
  let i = 0, lat = 0, lng = 0;
  const dec = () => {
    let shift = 0, result = 0, b: number;
    do {
      if (i >= s.length) throw new Error('bad polyline');
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += dec();
    lng += dec();
    out.push({ lat: lat / P, lng: lng / P });
  }
  return out;
}

export function routeToParam(doc: Pick<RouteDoc, 'profile' | 'waypoints' | 'params'>): string {
  const straight = doc.waypoints.flatMap((w, i) => (w.straight ? [i] : [])).join(',');
  const params = Object.entries(doc.params ?? {})
    .map(([k, v]) => `${k}:${typeof v === 'boolean' ? (v ? 1 : 0) : v}`)
    .join(',');
  // polyline chars are URL-safe except a few; encodeURIComponent keeps them intact
  return [doc.profile, encodePolyline(doc.waypoints), straight, params].join('!').replace(/!+$/, '');
}

export function paramToRoute(v: string): Pick<RouteDoc, 'profile' | 'waypoints' | 'params'> | null {
  try {
    const [profile, poly, straight = '', params = ''] = v.split('!');
    const waypoints: RouteDoc['waypoints'] = decodePolyline(poly);
    if (waypoints.length < 1 || waypoints.some((w) => Math.abs(w.lat) > 90 || Math.abs(w.lng) > 180)) return null;
    for (const i of straight.split(',').filter(Boolean).map(Number)) if (waypoints[i]) waypoints[i].straight = true;
    const p: RouteDoc['params'] = {};
    for (const kv of params.split(',').filter(Boolean)) {
      const [k, val] = kv.split(':');
      if (k) p[k] = isNaN(Number(val)) ? val : Number(val);
    }
    return { profile: profile || 'nk-gravel', waypoints, params: p };
  } catch {
    return null;
  }
}

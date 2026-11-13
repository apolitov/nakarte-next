// Name suggestions for a finished route from the places it passes: "Sintra → Cascais" for a
// route between two places, "Sintra loop via Colares" for a loop (via its farthest point).
// Place names come from maps-api (/api/place, Nominatim with a shared cache).
import { t } from './i18n';

const API = `${import.meta.env.BASE_URL}api`;
type Pt = { lng: number; lat: number };

const places = new Map<string, Promise<string>>();
function placeAt(p: Pt): Promise<string> {
  const key = `${p.lat.toFixed(3)}/${p.lng.toFixed(3)}`;
  let v = places.get(key);
  if (!v) {
    v = fetch(`${API}/place/${key}`, { signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? r.json() : { place: '' }))
      .then((j: { place?: string }) => j.place ?? '')
      .catch(() => '');
    places.set(key, v);
  }
  return v;
}

const metres = (a: Pt, b: Pt) => Math.hypot((b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 111320;

/** Up to three names, best first; empty when no place could be named. */
export async function suggestNames(points: Pt[], km: number, typeTitle: string): Promise<string[]> {
  if (points.length < 2) return [];
  const a = points[0], b = points[points.length - 1];
  const loop = metres(a, b) < Math.max(1000, km * 1000 * 0.05);
  let far = b;
  if (loop) {
    let best = 0;
    for (const p of points) {
      const d = metres(a, p);
      if (d > best) (best = d), (far = p);
    }
  }
  const [from, to] = await Promise.all([placeAt(a), placeAt(far)]);
  if (!from && !to) return [];
  const base = loop
    ? to && to !== from ? t('name.sugLoopVia', { a: from || to, b: to }) : t('name.sugLoop', { a: from || to })
    : from && to && from !== to ? `${from} → ${to}` : t('name.sugAround', { a: from || to });
  const kmText = km.toFixed(km < 10 ? 1 : 0);
  return [base, `${base}, ${kmText} ${t('unit.km')} ${typeTitle.toLowerCase()}`];
}

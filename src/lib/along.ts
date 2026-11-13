// Things along the route: points of interest from OpenStreetMap and street-level photos
// (Panoramax), fetched from maps-api (/api/pois, /api/photos) for a simplified route line.
import * as maplibregl from 'maplibre-gl';
import { t } from './i18n';
import { nearestPoint } from './timeline';

const API = `${import.meta.env.BASE_URL}api`;

export type PoiCat = 'water' | 'repair' | 'food' | 'toilets' | 'shelter' | 'camp' | 'view' | 'photos';

export interface CatDef {
  id: PoiCat;
  icon: string;
  color: string;
  group: 'way' | 'see';
  /** on by default */
  def: boolean;
}

export const CATS: CatDef[] = [
  { id: 'water', icon: '💧', color: '#378add', group: 'way', def: true },
  { id: 'repair', icon: '🔧', color: '#d85a30', group: 'way', def: true },
  { id: 'food', icon: '🍴', color: '#ba7517', group: 'way', def: false },
  { id: 'toilets', icon: '🚻', color: '#6b7280', group: 'way', def: false },
  { id: 'shelter', icon: '🛖', color: '#3b6d11', group: 'way', def: true },
  { id: 'camp', icon: '⛺', color: '#3b6d11', group: 'way', def: false },
  { id: 'view', icon: '👁', color: '#7f77dd', group: 'see', def: false },
  { id: 'photos', icon: '📷', color: '#7f77dd', group: 'see', def: false },
];
export const catDef = (id: string) => CATS.find((c) => c.id === id) ?? CATS[0];
export const catTitle = (id: PoiCat) => t(`poi.${id}` as `poi.${PoiCat}`);

export interface Poi {
  id: string;
  cat: Exclude<PoiCat, 'photos'>;
  lng: number;
  lat: number;
  kind: string;
  tags: Record<string, string>;
  /** distance along the route, m, and the nearest route point */
  m: number;
  i: number;
}

export interface Photo {
  id: string;
  src: 'panoramax' | 'mapillary';
  lng: number;
  lat: number;
  m: number;
  date: string;
  az: number | null;
  author: string;
  license: string;
  thumb: string;
  sd: string;
  url: string;
}

type Pt = { lng: number; lat: number };

/** Douglas–Peucker in metres; tolerance grows until the line fits in `max` points. */
export function simplify(points: Pt[], max = 380): [number, number][] {
  if (points.length <= 2) return points.map((p) => [p.lng, p.lat]);
  const k = Math.cos((points[0].lat * Math.PI) / 180) * 111320;
  const xy = points.map((p) => [p.lng * k, p.lat * 111320]);
  const dist = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    const u = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
  };
  for (let tol = 15; ; tol *= 1.6) {
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let bi = -1, bd = tol;
      for (let i = a + 1; i < b; i++) {
        const d = dist(xy[i], xy[a], xy[b]);
        if (d > bd) (bd = d), (bi = i);
      }
      if (bi > 0) {
        keep[bi] = 1;
        stack.push([a, bi], [bi, b]);
      }
    }
    const out = points.filter((_, i) => keep[i]).map((p) => [p.lng, p.lat] as [number, number]);
    if (out.length <= max) return out;
  }
}

async function post<T>(path: string, line: [number, number][]): Promise<T> {
  const r = await fetch(`${API}${path}`, { method: 'POST', body: JSON.stringify({ line }), headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/** Points of interest within `radius` m of the route, with their distance along it. */
export async function fetchPois(points: Pt[], dist: number[], radius: number): Promise<Poi[]> {
  const raw = await post<Omit<Poi, 'm' | 'i'>[]>(`/pois?radius=${radius}`, simplify(points));
  return raw
    .map((p) => {
      const i = nearestPoint(points, p.lng, p.lat).i;
      return { ...p, i, m: dist[i] ?? 0 };
    })
    .sort((a, b) => a.m - b.m);
}

export async function fetchPhotos(points: Pt[]): Promise<Photo[]> {
  return post<Photo[]>('/photos', simplify(points));
}

/** Photos grouped by stretches of `step` m along the route, for the list in the panel. */
export function photoGroups(photos: Photo[], step = 2000) {
  const groups = new Map<number, Photo[]>();
  for (const p of photos) {
    const k = Math.floor(p.m / step);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  return [...groups.entries()].map(([k, items]) => ({ from: k * step, to: (k + 1) * step, items }));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const km = (m: number) => (m / 1000).toFixed(1);

/**
 * Draws points of interest and photos as DOM markers. Photos close to each other on screen
 * are grouped into one marker with a count; clicking a group zooms in until it splits.
 */
export class AlongLayer {
  private markers: maplibregl.Marker[] = [];
  private popup: maplibregl.Popup | null = null;
  private pois: Poi[] = [];
  private photos: Photo[] = [];
  private onMove = () => this.render();

  constructor(private map: maplibregl.Map) {
    map.on('moveend', this.onMove);
  }

  set(pois: Poi[], photos: Photo[]) {
    this.pois = pois;
    this.photos = photos;
    this.render();
  }

  destroy() {
    this.map.off('moveend', this.onMove);
    this.clear();
    this.popup?.remove();
  }

  private clear() {
    for (const m of this.markers) m.remove();
    this.markers = [];
  }

  private add(el: HTMLElement, lng: number, lat: number) {
    this.markers.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(this.map));
  }

  private render() {
    this.clear();
    for (const p of this.pois) {
      const c = catDef(p.cat);
      const el = document.createElement('button');
      el.className = 'poi-mk';
      el.style.setProperty('--c', c.color);
      el.textContent = c.icon;
      el.setAttribute('aria-label', `${catTitle(p.cat)}${p.tags.name ? `: ${p.tags.name}` : ''}`);
      el.onclick = (e) => {
        e.stopPropagation();
        this.showPoi(p);
      };
      this.add(el, p.lng, p.lat);
    }
    // greedy grouping of photos by screen distance
    const R = 44;
    const left = this.photos.map((p) => ({ p, at: this.map.project([p.lng, p.lat]) }));
    const used = new Uint8Array(left.length);
    for (let i = 0; i < left.length; i++) {
      if (used[i]) continue;
      const group = [left[i]];
      used[i] = 1;
      for (let j = i + 1; j < left.length; j++) {
        if (!used[j] && Math.hypot(left[j].at.x - left[i].at.x, left[j].at.y - left[i].at.y) < R) {
          used[j] = 1;
          group.push(left[j]);
        }
      }
      const items = group.map((g) => g.p);
      const newest = items.reduce((a, b) => (b.date > a.date ? b : a));
      const el = document.createElement('button');
      el.className = 'ph-mk';
      el.style.backgroundImage = `url("${newest.thumb}")`;
      el.setAttribute('aria-label', items.length > 1 ? t('poi.photosN', { n: items.length }) : t('poi.photo'));
      if (items.length > 1) {
        const b = document.createElement('span');
        b.textContent = String(items.length);
        el.append(b);
      }
      el.onclick = (e) => {
        e.stopPropagation();
        if (items.length === 1 || this.map.getZoom() >= 18) return this.showPhoto(newest);
        const bounds = new maplibregl.LngLatBounds();
        for (const it of items) bounds.extend([it.lng, it.lat]);
        this.map.fitBounds(bounds, { padding: 120, maxZoom: 18, duration: 500 });
      };
      const at = this.map.unproject([group.reduce((s, g) => s + g.at.x, 0) / group.length, group.reduce((s, g) => s + g.at.y, 0) / group.length]);
      this.add(el, at.lng, at.lat);
    }
  }

  private open(lng: number, lat: number, html: string) {
    this.popup?.remove();
    this.popup = new maplibregl.Popup({ className: 'along-popup', maxWidth: '300px', offset: 14 }).setLngLat([lng, lat]).setHTML(html).addTo(this.map);
  }

  showPoi(p: Poi) {
    const c = catDef(p.cat);
    const extra = [p.tags.opening_hours && `🕑 ${esc(p.tags.opening_hours)}`, p.tags.fee === 'yes' && t('poi.fee'), p.tags.ele && `${esc(p.tags.ele)} m`]
      .filter(Boolean)
      .join(' · ');
    const osm = `https://www.openstreetmap.org/${({ n: 'node', w: 'way', r: 'relation' } as Record<string, string>)[p.id[0]]}/${p.id.slice(1)}`;
    this.open(p.lng, p.lat, `<div class="ap"><b>${c.icon} ${esc(p.tags.name || catTitle(p.cat))}</b>
      <span>${esc(catTitle(p.cat))} · ${t('poi.atKm', { km: km(p.m) })}</span>${extra ? `<span>${extra}</span>` : ''}
      <a href="${osm}" target="_blank" rel="noopener">OpenStreetMap ↗</a></div>`);
  }

  showPhoto(p: Photo) {
    this.map.easeTo({ center: [p.lng, p.lat], duration: 300 });
    this.open(p.lng, p.lat, `<div class="ap ph"><a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.sd || p.thumb)}" alt="" loading="lazy"></a>
      <span>${t('poi.atKm', { km: km(p.m) })}${p.date ? ` · ${esc(p.date)}` : ''}</span>
      <small>© ${esc(p.author || 'Panoramax')}${p.license ? `, ${esc(p.license)}` : ''} · <a href="${esc(p.url)}" target="_blank" rel="noopener">Panoramax ↗</a></small></div>`);
  }
}

// Things along the route: points of interest from OpenStreetMap and street-level photos.
// Points come from OpenFreeMap vector tiles (OpenMapTiles schema, layer "poi" at z14), read in
// the browser along the route corridor: no server storage and no keys. Photos come from
// Panoramax through maps-api (/api/photos).
import * as maplibregl from 'maplibre-gl';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { t } from './i18n';
import { nearestPoint } from './timeline';

const API = `${import.meta.env.BASE_URL}api`;

export type PoiCat = 'eat' | 'fuel' | 'shop' | 'water' | 'beach' | 'repair' | 'sight' | 'view' | 'photos';

export interface CatDef {
  id: PoiCat;
  icon: string;
  color: string;
  group: 'way' | 'see' | 'photo';
  /** on by default */
  def: boolean;
}

export const CATS: CatDef[] = [
  { id: 'eat', icon: '🍴', color: '#ba7517', group: 'way', def: false },
  { id: 'fuel', icon: '⛽', color: '#6b7280', group: 'way', def: false },
  { id: 'shop', icon: '🛒', color: '#378add', group: 'way', def: false },
  { id: 'water', icon: '💧', color: '#1d9e75', group: 'way', def: true },
  { id: 'beach', icon: '🏖', color: '#d4a017', group: 'way', def: false },
  { id: 'repair', icon: '🔧', color: '#d85a30', group: 'way', def: true },
  { id: 'sight', icon: '🏛', color: '#993556', group: 'see', def: false },
  { id: 'view', icon: '👁', color: '#7f77dd', group: 'see', def: false },
  { id: 'photos', icon: '📷', color: '#7f77dd', group: 'photo', def: false },
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
  src: 'commons' | 'panoramax' | 'mapillary';
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

// ---- points of interest from OpenFreeMap tiles ----

const OFM = 'https://tiles.openfreemap.org/planet';
const Z = 14;
let tileUrl: Promise<string> | null = null;
/** The tile URL carries the data version; read it once from the TileJSON. */
function tileTemplate(): Promise<string> {
  tileUrl ??= fetch(OFM)
    .then((r) => r.json())
    .then((j) => j.tiles[0] as string)
    .catch((e) => {
      tileUrl = null;
      throw e;
    });
  return tileUrl;
}

/** OpenMapTiles poi class / subclass → our category. */
function categoryOf(cls: string, sub: string): Exclude<PoiCat, 'photos'> | null {
  if (sub === 'drinking_water' || sub === 'water_point' || sub === 'spring') return 'water';
  if (cls === 'bicycle' || sub === 'bicycle_repair_station') return 'repair';
  if (sub === 'fuel') return 'fuel';
  if (cls === 'grocery' || sub === 'convenience' || sub === 'general' || sub === 'kiosk') return 'shop';
  if (['cafe', 'restaurant', 'fast_food', 'bakery', 'ice_cream', 'beer', 'bar'].includes(cls)) return 'eat';
  if (sub === 'viewpoint') return 'view';
  // sights: attractions, museums, castles, monuments, ruins; street art and memorial plaques left out
  if (['museum', 'castle', 'monument'].includes(cls) || sub === 'ruins' || sub === 'archaeological_site' || (cls === 'attraction' && sub !== 'artwork')) return 'sight';
  return null;
}

const tileCache = new Map<string, Promise<Omit<Poi, 'm' | 'i'>[]>>();
function tilePois(x: number, y: number): Promise<Omit<Poi, 'm' | 'i'>[]> {
  const key = `${x}/${y}`;
  let p = tileCache.get(key);
  if (!p) {
    p = tileTemplate()
      .then((tpl) => fetch(tpl.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y))))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`tiles: ${r.status}`))))
      .then((buf) => {
        const vt = new VectorTile(new PbfReader(buf));
        const layer = vt.layers.poi;
        const out: Omit<Poi, 'm' | 'i'>[] = [];
        // beaches are sand areas in landcover, not points: one marker at the middle of each
        const lc = vt.layers.landcover;
        for (let k = 0; lc && k < lc.length; k++) {
          const f = lc.feature(k);
          if (f.properties.subclass !== 'beach') continue;
          const g = f.toGeoJSON(x, y, Z).geometry;
          const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
          if (!ring?.length) continue;
          const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
          out.push({ id: `${x}/${y}/b${k}`, cat: 'beach', lng: c[0], lat: c[1], kind: 'beach', tags: {} });
        }
        for (let k = 0; layer && k < layer.length; k++) {
          const f = layer.feature(k);
          const pr = f.properties as Record<string, string | number>;
          const cat = categoryOf(String(pr.class ?? ''), String(pr.subclass ?? ''));
          if (!cat) continue;
          const g = f.toGeoJSON(x, y, Z).geometry;
          const c = g.type === 'Point' ? g.coordinates : g.type === 'MultiPoint' ? g.coordinates[0] : null;
          if (!c) continue;
          const name = String(pr['name:latin'] ?? pr.name ?? '');
          out.push({ id: `${x}/${y}/${f.id ?? k}`, cat, lng: c[0], lat: c[1], kind: String(pr.subclass ?? pr.class), tags: name ? { name } : {} });
        }
        return out;
      });
    p.catch(() => tileCache.delete(key));
    tileCache.set(key, p);
  }
  return p;
}

/** z14 tiles that a corridor of `radius` m around the route touches. */
function corridorTiles(points: Pt[], radius: number): [number, number][] {
  const n = 2 ** Z, keys = new Set<string>();
  const tx = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const line = simplify(points, 2000);
  for (let s = 0; s < line.length; s++) {
    const [lng, lat] = line[s];
    const next = line[s + 1] ?? line[s];
    // sample every ~200 m along the segment, each sample with its corridor box
    const steps = Math.max(1, Math.ceil(Math.hypot((next[0] - lng) * Math.cos((lat * Math.PI) / 180), next[1] - lat) * 111320 / 200));
    for (let k = 0; k <= steps; k++) {
      const a = lng + ((next[0] - lng) * k) / steps, b = lat + ((next[1] - lat) * k) / steps;
      const dLat = radius / 111320, dLng = dLat / Math.cos((b * Math.PI) / 180);
      for (let X = tx(a - dLng); X <= tx(a + dLng); X++) for (let Y = ty(b + dLat); Y <= ty(b - dLat); Y++) keys.add(`${X}/${Y}`);
    }
  }
  return [...keys].map((k) => k.split('/').map(Number) as [number, number]);
}

/** Springs are not in the OpenMapTiles schema: ask Overpass for them, briefly; skipped if it is busy. */
async function springs(points: Pt[], radius: number): Promise<Omit<Poi, 'm' | 'i'>[]> {
  const line = simplify(points, 150).map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');
  const q = `[out:json][timeout:15];node(around:${radius},${line})[natural=spring];out 200;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.elements ?? []).map((e: { id: number; lon: number; lat: number; tags?: Record<string, string> }) => ({
      id: `n${e.id}`, cat: 'water' as const, lng: e.lon, lat: e.lat, kind: 'spring', tags: e.tags?.name ? { name: e.tags.name } : {},
    }));
  } catch {
    return [];
  }
}

/** Points of interest within `radius` m of the route, with their distance along it. */
export async function fetchPois(points: Pt[], radius: number, withSprings = false): Promise<Poi[]> {
  const tiles = corridorTiles(points, radius);
  const spring = withSprings ? springs(points, radius) : Promise.resolve([]);
  const lists: Omit<Poi, 'm' | 'i'>[][] = [];
  for (let k = 0; k < tiles.length; k += 6) lists.push(...(await Promise.all(tiles.slice(k, k + 6).map(([x, y]) => tilePois(x, y)))));
  lists.push(await spring);
  // distance along the route, from its own points
  const cum = [0];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k], kx = Math.cos((a.lat * Math.PI) / 180);
    cum.push(cum[k - 1] + Math.hypot((b.lng - a.lng) * kx, b.lat - a.lat) * 111320);
  }
  const seen = new Set<string>(), out: Poi[] = [];
  for (const p of lists.flat()) {
    const key = `${p.cat}|${p.lng.toFixed(5)}|${p.lat.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const near = nearestPoint(points, p.lng, p.lat);
    if (near.i < 0 || near.m > radius) continue;
    out.push({ ...p, i: near.i, m: cum[near.i] });
  }
  return out.sort((a, b) => a.m - b.m);
}

// ---- photos: Wikimedia Commons from the browser, Mapillary and Panoramax street views through maps-api ----

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const NEAR = 100; // m from the route
const SKIP = /orthofoto|orthophoto|luftbild|aerial|\bmap\b|karte|plan\b|\.(svg|pdf|tiff?)$/i;

/** Distance along the route of every point (m). */
function cumulative(points: Pt[]): number[] {
  const cum = [0];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k], kx = Math.cos((a.lat * Math.PI) / 180);
    cum.push(cum[k - 1] + Math.hypot((b.lng - a.lng) * kx, b.lat - a.lat) * 111320);
  }
  return cum;
}

export const PHOTO_MIN_ZOOM = 13;
const PIECE = 2000; // m of route per request batch

const strip = (h = '') => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** Commons files near one circle; distances along the whole route. */
async function commonsAround(c: Pt, radius: number, route: Pt[], cum: number[]): Promise<Photo[]> {
  const q = new URLSearchParams({
    action: 'query', generator: 'geosearch', ggscoord: `${c.lat.toFixed(5)}|${c.lng.toFixed(5)}`, ggsradius: String(Math.round(radius)),
    ggsnamespace: '6', ggslimit: '50', prop: 'imageinfo|coordinates', iiprop: 'url|extmetadata|mime', iiurlwidth: '320',
    iiextmetadatafilter: 'LicenseShortName|Artist|DateTimeOriginal', format: 'json', origin: '*',
  });
  const r = await fetch(`${COMMONS}?${q}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) return [];
  const pages = Object.values((await r.json()).query?.pages ?? {}) as {
    pageid: number; title: string; coordinates?: { lat: number; lon: number }[];
    imageinfo?: { thumburl?: string; descriptionurl: string; mime: string; extmetadata?: Record<string, { value: string }> }[];
  }[];
  const out: Photo[] = [];
  for (const pg of pages) {
    const ii = pg.imageinfo?.[0], co = pg.coordinates?.[0];
    if (!ii?.thumburl || !co || !/^image\/(jpeg|png|webp)/.test(ii.mime) || SKIP.test(pg.title)) continue;
    const near = nearestPoint(route, co.lon, co.lat);
    if (near.i < 0 || near.m > NEAR) continue;
    const m = ii.extmetadata ?? {};
    out.push({
      id: `c${pg.pageid}`, src: 'commons', lng: co.lon, lat: co.lat, m: cum[near.i], az: null,
      date: strip(m.DateTimeOriginal?.value).slice(0, 10), author: strip(m.Artist?.value).slice(0, 80), license: strip(m.LicenseShortName?.value),
      thumb: ii.thumburl, sd: ii.thumburl.replace(/\/\d+px-/, '/800px-'), url: ii.descriptionurl,
    });
  }
  return out;
}

/**
 * Photos are loaded only for what is on screen, from zoom PHOTO_MIN_ZOOM: the route is cut into
 * 2 km pieces and each piece is asked once (Commons from the browser in up to 9 circles, Mapillary
 * and Panoramax through maps-api in one call). A whole long route at once would mean hundreds of
 * requests and get the browser rate-limited.
 */
export class PhotoLoader {
  private cum: number[];
  private pieces: { a: number; b: number; w: number; s: number; e: number; n: number }[] = [];
  private done = new Map<number, Photo[]>();
  private busy = new Set<number>();

  constructor(private route: Pt[]) {
    this.cum = cumulative(route);
    let a = 0;
    for (let k = 1; k < route.length; k++) {
      if (this.cum[k] - this.cum[a] >= PIECE || k === route.length - 1) {
        const pts = route.slice(a, k + 1);
        const pad = 0.0015;
        this.pieces.push({
          a, b: k,
          w: Math.min(...pts.map((p) => p.lng)) - pad, e: Math.max(...pts.map((p) => p.lng)) + pad,
          s: Math.min(...pts.map((p) => p.lat)) - pad, n: Math.max(...pts.map((p) => p.lat)) + pad,
        });
        a = k;
      }
    }
  }

  /** Everything loaded so far, one photo per author within ~40 m. */
  get photos(): Photo[] {
    const all = new Map<string, Photo>();
    for (const list of this.done.values()) for (const p of list) all.set(p.id, p);
    const out: Photo[] = [];
    for (const p of [...all.values()].sort((a, b) => a.m - b.m)) {
      if (out.some((q) => q.src === p.src && q.author && q.author === p.author && Math.abs(q.m - p.m) < 40)) continue;
      out.push(p);
    }
    return out;
  }

  get loadedPieces() {
    return this.done.size;
  }

  /** Loads the pieces inside the given bounds (at most `max` per call); true when something new came. */
  async loadVisible(b: { w: number; s: number; e: number; n: number }, max = 4): Promise<boolean> {
    const todo = this.pieces
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => !this.done.has(i) && !this.busy.has(i) && p.w < b.e && p.e > b.w && p.s < b.n && p.n > b.s)
      .slice(0, max);
    if (!todo.length) return false;
    for (const { i } of todo) this.busy.add(i);
    await Promise.all(todo.map(({ p, i }) => this.loadPiece(p.a, p.b).then((list) => this.done.set(i, list)).finally(() => this.busy.delete(i))));
    return true;
  }

  private async loadPiece(a: number, b: number): Promise<Photo[]> {
    const pts = this.route.slice(a, b + 1);
    const centres: Pt[] = [];
    for (let d = this.cum[a], k = a; d <= this.cum[b]; d += 250) {
      while (k < b && this.cum[k + 1] < d) k++;
      centres.push(this.route[k]);
    }
    const commons: Photo[] = [];
    // two at a time: Commons answers 429 to bursts from one address
    for (let k = 0; k < centres.length; k += 2) {
      const got = await Promise.all(centres.slice(k, k + 2).map((c) => commonsAround(c, 125 + NEAR, this.route, this.cum).catch(() => [] as Photo[])));
      commons.push(...got.flat());
    }
    const street = await post<Photo[]>('/photos', simplify(pts)).catch(() => [] as Photo[]);
    return [...commons, ...street.map((p) => ({ ...p, m: p.m + this.cum[a] }))];
  }
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
    // points of one category close together on screen become one marker with a count
    const byCat = new Map<string, { p: Poi; at: maplibregl.Point }[]>();
    for (const p of this.pois) {
      if (!byCat.has(p.cat)) byCat.set(p.cat, []);
      byCat.get(p.cat)!.push({ p, at: this.map.project([p.lng, p.lat]) });
    }
    for (const [cat, list] of byCat) {
      const c = catDef(cat);
      const used = new Uint8Array(list.length);
      for (let i = 0; i < list.length; i++) {
        if (used[i]) continue;
        used[i] = 1;
        const group = [list[i]];
        for (let j = i + 1; j < list.length; j++) {
          if (!used[j] && Math.hypot(list[j].at.x - list[i].at.x, list[j].at.y - list[i].at.y) < 30) {
            used[j] = 1;
            group.push(list[j]);
          }
        }
        const el = document.createElement('button');
        el.className = 'poi-mk';
        el.style.setProperty('--c', c.color);
        el.textContent = c.icon;
        const one = group[0].p;
        el.setAttribute('aria-label', group.length > 1 ? `${catTitle(one.cat)}: ${group.length}` : `${catTitle(one.cat)}${one.tags.name ? `: ${one.tags.name}` : ''}`);
        if (group.length > 1) {
          const b = document.createElement('span');
          b.textContent = String(group.length);
          el.append(b);
        }
        el.onclick = (e) => {
          e.stopPropagation();
          if (group.length === 1 || this.map.getZoom() >= 18) return this.showPoi(one);
          const bounds = new maplibregl.LngLatBounds();
          for (const g of group) bounds.extend([g.p.lng, g.p.lat]);
          this.map.fitBounds(bounds, { padding: 120, maxZoom: 18, duration: 500 });
        };
        // mean of the members' coordinates: unprojecting a screen point is off in 3D (pitch and terrain)
        this.add(el, group.reduce((a, g) => a + g.p.lng, 0) / group.length, group.reduce((a, g) => a + g.p.lat, 0) / group.length);
      }
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
      this.add(el, items.reduce((a, it) => a + it.lng, 0) / items.length, items.reduce((a, it) => a + it.lat, 0) / items.length);
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
    const osm = `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(6)}&mlon=${p.lng.toFixed(6)}#map=19/${p.lat.toFixed(6)}/${p.lng.toFixed(6)}`;
    this.open(p.lng, p.lat, `<div class="ap"><b>${c.icon} ${esc(p.tags.name || catTitle(p.cat))}</b>
      <span>${esc(catTitle(p.cat))} · ${t('poi.atKm', { km: km(p.m) })}</span>${extra ? `<span>${extra}</span>` : ''}
      <a href="${osm}" target="_blank" rel="noopener">OpenStreetMap ↗</a></div>`);
  }

  showPhoto(p: Photo) {
    this.map.easeTo({ center: [p.lng, p.lat], duration: 300 });
    this.open(p.lng, p.lat, `<div class="ap ph"><a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.sd || p.thumb)}" alt="" loading="lazy"></a>
      <span>${t('poi.atKm', { km: km(p.m) })}${p.date ? ` · ${esc(p.date)}` : ''}</span>
      <small>© ${esc(p.author || '?')}${p.license ? `, ${esc(p.license)}` : ''} · <a href="${esc(p.url)}" target="_blank" rel="noopener">${({ commons: 'Wikimedia Commons', panoramax: 'Panoramax', mapillary: 'Mapillary' } as Record<string, string>)[p.src]} ↗</a></small></div>`);
  }
}

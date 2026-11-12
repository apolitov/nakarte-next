// Elevation from open terrain tiles (AWS Terrain Tiles, Terrarium encoding),
// for parts of a route that do not come from the router: straight legs and
// imported tracks without elevation. z12 is ~30 m per pixel at mid latitudes.
import type { LegPoint } from './brouter';
import { haversine } from './profile';

const Z = 12;
const URL_T = (x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
const tiles = new Map<string, Promise<ImageData | null>>();

function tile(x: number, y: number): Promise<ImageData | null> {
  const key = `${x}/${y}`;
  let p = tiles.get(key);
  if (!p) {
    p = fetch(URL_T(x, y))
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then(createImageBitmap)
      .then((bmp) => {
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      })
      .catch(() => null);
    tiles.set(key, p);
  }
  return p;
}

function pixel(lng: number, lat: number) {
  const n = 2 ** Z;
  const x = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { tx: Math.floor(x), ty: Math.floor(y), fx: x - Math.floor(x), fy: y - Math.floor(y) };
}

const decode = (d: Uint8ClampedArray, i: number) => d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;

export async function elevationAt(lng: number, lat: number): Promise<number | null> {
  const { tx, ty, fx, fy } = pixel(lng, lat);
  const img = await tile(tx, ty);
  if (!img) return null;
  // bilinear between the 4 neighbouring pixels
  const W = img.width;
  const px = Math.min(W - 1.001, fx * W - 0.5), py = Math.min(W - 1.001, fy * W - 0.5);
  const x0 = Math.max(0, Math.floor(px)), y0 = Math.max(0, Math.floor(py));
  const ax = Math.max(0, px - x0), ay = Math.max(0, py - y0);
  const at = (x: number, y: number) => decode(img.data, (y * W + x) * 4);
  const top = at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax;
  const bot = at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax;
  return top * (1 - ay) + bot * ay;
}

/** Densifies a straight line every `step` metres and samples elevation along it. */
export async function straightWithElevation(a: { lng: number; lat: number }, b: { lng: number; lat: number }, step = 30): Promise<LegPoint[]> {
  const d = haversine({ ...a, ele: null }, { ...b, ele: null });
  // at most 2000 samples: a long straight leg would otherwise pull thousands of terrain tiles
  const n = Math.min(2000, Math.max(1, Math.ceil(d / step)));
  const pts = Array.from({ length: n + 1 }, (_, i) => ({ lng: a.lng + ((b.lng - a.lng) * i) / n, lat: a.lat + ((b.lat - a.lat) * i) / n }));
  const eles = await Promise.all(pts.map((p) => elevationAt(p.lng, p.lat)));
  return pts.map((p, i) => ({ ...p, ele: eles[i] }));
}

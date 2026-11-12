// Yandex raster tiles are in EPSG:3395 (Mercator on the WGS84 ellipsoid),
// MapLibre works in EPSG:3857 (spherical Mercator). Longitudes match, latitudes
// do not: at 55°N the difference is ~20 km. We rebuild every 3857 tile from
// one or two Yandex tiles, drawing it row by row at the right latitude.
import * as maplibregl from 'maplibre-gl';

const E = 0.0818191908426; // WGS84 first eccentricity

/** Latitude (radians) of a global 3857 pixel row; `size` is world size in px. */
export function lat3857(yPx: number, size: number): number {
  const n = Math.PI * (1 - (2 * yPx) / size);
  return Math.atan(Math.sinh(n));
}

/** Global 3395 pixel row of a latitude (radians); `size` is world size in px. */
export function y3395(lat: number, size: number): number {
  const s = Math.sin(lat);
  const m = Math.log(Math.tan(Math.PI / 4 + lat / 2) * Math.pow((1 - E * s) / (1 + E * s), E / 2));
  return (size / 2) * (1 - m / Math.PI);
}

const URLS: Record<string, string> = {
  map: 'https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale={s}&lang=ru_RU',
  sat: 'https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}',
};

async function loadTile(kind: string, z: number, x: number, y: number, scale: number, signal: AbortSignal) {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  const url = URLS[kind]
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{z}', String(z))
    .replace('{s}', String(scale));
  const r = await fetch(url, { signal });
  if (!r.ok) return null;
  return createImageBitmap(await r.blob());
}

/** Registers the `yandex://{kind}/{z}/{x}/{y}` protocol. Idempotent. */
let registered = false;
export function registerYandexProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('yandex', async (params, abort) => {
    const m = params.url.match(/^yandex:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)/);
    if (!m) throw new Error(`bad yandex url ${params.url}`);
    const [, kind, zs, xs, ys] = m;
    const z = +zs, x = +xs, y = +ys;
    const scale = kind === 'map' && devicePixelRatio > 1 ? 2 : 1;
    const T = 256; // logical tile size used for the math
    const world = T * 2 ** z;

    // Which 3395 rows does this 3857 tile cover?
    const top = y3395(lat3857(y * T, world), world);
    const bottom = y3395(lat3857((y + 1) * T, world), world);
    const firstTile = Math.floor(top / T);
    const lastTile = Math.floor((bottom - 1e-6) / T);

    const tiles = await Promise.all(
      Array.from({ length: lastTile - firstTile + 1 }, (_, i) =>
        loadTile(kind, z, x, firstTile + i, scale, abort.signal),
      ),
    );

    const P = tiles.find(Boolean)?.width ?? T; // real pixel size (256 or 512)
    const k = P / T;
    const canvas = new OffscreenCanvas(P, P);
    const ctx = canvas.getContext('2d')!;
    for (let row = 0; row < P; row++) {
      const src = y3395(lat3857(y * T + (row + 0.5) / k, world), world) * k;
      const ti = Math.floor(src / P) - firstTile;
      const img = tiles[ti];
      if (!img) continue;
      const sy = Math.min(P - 1, Math.max(0, Math.floor(src - (firstTile + ti) * P)));
      ctx.drawImage(img, 0, sy, P, 1, 0, row, P, 1);
    }
    const blob = await canvas.convertToBlob({ type: kind === 'sat' ? 'image/jpeg' : 'image/png' });
    return { data: await blob.arrayBuffer() };
  });
}

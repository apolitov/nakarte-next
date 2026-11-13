// Ride with GPS global heatmap. Its tiles go from yellow (few rides) to red (many), which
// clashes with the grade colours of the route line, so the overlay is repainted in violet.
// The same tiles also give "how much people ride here" for the Stick-to-heatmap routing.
import * as maplibregl from 'maplibre-gl';

const SRC = 'https://heatmap.ridewithgps.com/normalized/{z}/{x}/{y}.png';
const LOW = [196, 178, 250]; // light violet: few rides
const HIGH = [76, 22, 168]; // deep violet: many

/** 0…1 from a source pixel: yellow (green 192) is little riding, red (green 0) is a lot. */
export const intensity = (g: number, a: number) => (a === 0 ? 0 : 1 - Math.min(g, 192) / 192);

async function pixels(z: number, x: number, y: number, signal?: AbortSignal): Promise<ImageData | null> {
  const r = await fetch(SRC.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), { signal });
  if (!r.ok) return null;
  const bmp = await createImageBitmap(await r.blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true })!;
  c.drawImage(bmp, 0, 0);
  return c.getImageData(0, 0, bmp.width, bmp.height);
}

let registered = false;
/** Registers the `rwheat://{z}/{x}/{y}` protocol: Ride with GPS tiles repainted. Idempotent. */
export function registerRwHeatProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('rwheat', async (params, abort) => {
    const m = params.url.match(/^rwheat:\/\/(\d+)\/(\d+)\/(\d+)/);
    if (!m) throw new Error(`bad rwheat url ${params.url}`);
    const img = await pixels(+m[1], +m[2], +m[3], abort.signal);
    if (!img) throw new Error('heatmap tile missing');
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (!a) continue;
      const t = intensity(d[i + 1], a);
      d[i] = LOW[0] + (HIGH[0] - LOW[0]) * t;
      d[i + 1] = LOW[1] + (HIGH[1] - LOW[1]) * t;
      d[i + 2] = LOW[2] + (HIGH[2] - LOW[2]) * t;
      d[i + 3] = a * (0.6 + 0.4 * t);
    }
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d')!.putImageData(img, 0, 0);
    return { data: await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
}

// ---- heat along a line, for Stick to heatmap ----

const Z = 14;
const tiles = new Map<string, Promise<ImageData | null>>();
function tile(x: number, y: number) {
  const k = `${x}/${y}`;
  let p = tiles.get(k);
  if (!p) {
    p = pixels(Z, x, y).catch(() => null);
    tiles.set(k, p);
  }
  return p;
}

/** Mean heat (0…1) along a line, sampled every 30 m, brightest pixel within 1 px (~10 m). */
export async function heatAlong(points: { lng: number; lat: number }[]): Promise<number> {
  const n = 2 ** Z;
  const samples: { x: number; y: number }[] = [];
  let next = 0, run = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    run += Math.hypot((b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 111320;
    while (next <= run) {
      const r = (b.lat * Math.PI) / 180;
      samples.push({ x: ((b.lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n });
      next += 30;
    }
  }
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) {
    const img = await tile(Math.floor(s.x), Math.floor(s.y));
    if (!img) continue;
    const W = img.width, px = Math.floor((s.x % 1) * W), py = Math.floor((s.y % 1) * W);
    let best = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const X = Math.min(W - 1, Math.max(0, px + dx)), Y = Math.min(W - 1, Math.max(0, py + dy));
        const o = (Y * W + X) * 4;
        const a = img.data[o + 3];
        if (a) best = Math.max(best, 0.25 + 0.75 * intensity(img.data[o + 1], a));
      }
    sum += best;
  }
  return sum / samples.length;
}

// OSM public GPS traces. The source tiles colour each line by its direction,
// which turns busy areas into a rainbow. We repaint every line one colour and
// keep only its alpha, so the layer reads as a density map under the route.
import * as maplibregl from 'maplibre-gl';

const SRC = 'https://gps.tile.openstreetmap.org/lines/{z}/{x}/{y}.png';
const RGB = [52, 92, 246]; // blue, apart from the grade and surface colours of the route
const OPACITY = 0.8;

let registered = false;
/** Registers the `gpsheat://{z}/{x}/{y}` protocol. Idempotent. */
export function registerGpsHeatProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('gpsheat', async (params, abort) => {
    const m = params.url.match(/^gpsheat:\/\/(\d+)\/(\d+)\/(\d+)/);
    if (!m) throw new Error(`bad gpsheat url ${params.url}`);
    const url = SRC.replace('{z}', m[1]).replace('{x}', m[2]).replace('{y}', m[3]);
    const r = await fetch(url, { signal: abort.signal });
    if (!r.ok) throw new Error(`gps tile ${r.status}`);
    const bmp = await createImageBitmap(await r.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = RGB[0];
      d[i + 1] = RGB[1];
      d[i + 2] = RGB[2];
      d[i + 3] = d[i + 3] * OPACITY;
    }
    ctx.putImageData(img, 0, 0);
    return { data: await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
}

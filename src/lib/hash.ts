// Map state in the URL hash, in nakarte's format where it overlaps:
//   #m=<zoom>/<lat>/<lng>&l=<base>/<overlay>/<overlay>
export interface HashState {
  zoom: number;
  lat: number;
  lng: number;
  layers: string[];
}

export function parseHash(hash: string): Partial<HashState> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Partial<HashState> = {};
  const m = params.get('m')?.split('/').map(Number);
  if (m && m.length === 3 && m.every(Number.isFinite)) {
    const [zoom, lat, lng] = m;
    if (zoom >= 0 && zoom <= 22 && Math.abs(lat) <= 85 && Math.abs(lng) <= 180) {
      Object.assign(out, { zoom, lat, lng });
    }
  }
  const l = params.get('l');
  if (l) out.layers = l.split('/').filter(Boolean);
  return out;
}

export function formatHash(s: HashState): string {
  const p = Math.max(0, Math.ceil(Math.log10(2 ** s.zoom)) + 1);
  return `#m=${Math.round(s.zoom)}/${s.lat.toFixed(p)}/${s.lng.toFixed(p)}&l=${s.layers.join('/')}`;
}

// Runs in a strava.com tab: samples the Strava global heatmap (grayscale tiles, z13 @2x) along
// the calibration routes and posts per-route histograms back to maps-api. Tiles stay in memory only.
window.__cal = { stage: 'start', done: 0, total: 0, err: 0 };
(async () => {
  const API = 'https://alexe.pt/maps/api/calib', TOKEN = '__TOKEN__';
  const SPORT = { road: 'sport_Ride', gravel: 'sport_GravelRide' };
  const Z = 13, TS = 1024, R = 2;
  const data = await (await fetch(`${API}/routes?token=${TOKEN}`)).json();
  const dec = (s) => { let i = 0, lat = 0, lng = 0; const out = [];
    const d = () => { let sh = 0, r = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); return r & 1 ? ~(r >> 1) : r >> 1; };
    while (i < s.length) { lat += d(); lng += d(); out.push([lng / 1e5, lat / 1e5]); } return out; };
  const byTile = new Map(); // "sport/x/y" -> [[geom, idx, px, py]]
  const geoms = [];
  for (const [key, L] of Object.entries(data.legs)) {
    L.geoms.forEach((g, gi) => {
      const pts = dec(g.poly); const rec = { key, gi, vals: new Uint8Array(pts.length) }; geoms.push(rec);
      pts.forEach(([lng, lat], idx) => {
        const n = 2 ** Z, x = (lng + 180) / 360 * n, r = lat * Math.PI / 180, y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
        const tk = `${SPORT[L.prof]}/${Math.floor(x)}/${Math.floor(y)}`;
        if (!byTile.has(tk)) byTile.set(tk, []);
        byTile.get(tk).push([rec, idx, Math.floor((x % 1) * TS), Math.floor((y % 1) * TS)]);
      });
    });
  }
  const tiles = [...byTile.keys()]; window.__cal.total = tiles.length; window.__cal.stage = 'tiles';
  const one = async (tk) => {
    const [sport, x, y] = tk.split('/');
    let px = null;
    try {
      const r = await fetch(`https://content-a.strava.com/identified/globalheat/${sport}/grayscale/${Z}/${x}/${y}@2x.png?v=19`, { credentials: 'include' });
      if (r.ok) { const b = await createImageBitmap(await r.blob()); const c = new OffscreenCanvas(TS, TS).getContext('2d', { willReadFrequently: true });
        c.drawImage(b, 0, 0, TS, TS); px = c.getImageData(0, 0, TS, TS).data; }
      else if (r.status !== 404) window.__cal.err++;
    } catch { window.__cal.err++; }
    for (const [rec, idx, cx, cy] of byTile.get(tk)) {
      let m = 0;
      if (px) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const xx = Math.min(TS - 1, Math.max(0, cx + dx)), yy = Math.min(TS - 1, Math.max(0, cy + dy));
        const v = px[(yy * TS + xx) * 4]; if (v > m) m = v; }
      rec.vals[idx] = m;
    }
    window.__cal.done++;
  };
  let next = 0; const worker = async () => { while (next < tiles.length) { const tk = tiles[next++]; await one(tk); await new Promise(r => setTimeout(r, 150)); } };
  await Promise.all([worker(), worker(), worker()]);
  window.__cal.stage = 'post';
  const out = {};
  for (const g of geoms) { const h = new Array(16).fill(0); let s = 0;
    for (const v of g.vals) { h[v >> 4]++; s += v; }
    (out[g.key] ??= [])[g.gi] = { n: g.vals.length, mean: s / g.vals.length, h }; }
  const r = await fetch(`${API}/scores?token=${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(out) });
  window.__cal.stage = 'done ' + r.status;
})().catch(e => { window.__cal.stage = 'failed ' + e.message; });
'started'

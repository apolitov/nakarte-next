// Google Map Tiles API: a session token per map type, cached until it expires.
// https://developers.google.com/maps/documentation/tile/session_tokens
const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

export type GoogleMapType = 'roadmap' | 'satellite' | 'terrain' | 'hybrid';

const SESSION_BODY: Record<GoogleMapType, object> = {
  roadmap: { mapType: 'roadmap' },
  satellite: { mapType: 'satellite' },
  terrain: { mapType: 'terrain', layerTypes: ['layerRoadmap'] },
  hybrid: { mapType: 'satellite', layerTypes: ['layerRoadmap'] },
};

export const googleAvailable = Boolean(KEY);

function storageGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function storageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export async function googleTileUrl(type: GoogleMapType): Promise<string> {
  if (!KEY) throw new Error('VITE_GOOGLE_MAPS_KEY is not set');
  const cacheKey = `google-session-${type}`;
  const cached = storageGet(cacheKey);
  if (cached) {
    const { session, expiry } = JSON.parse(cached);
    if (Number(expiry) * 1000 > Date.now() + 3600_000) return url(session);
  }
  const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...SESSION_BODY[type], language: 'ru-RU', region: 'PT', scale: 'scaleFactor2x', highDpi: true }),
  });
  if (!r.ok) throw new Error(`Google createSession: ${r.status}`);
  const { session, expiry } = await r.json();
  storageSet(cacheKey, JSON.stringify({ session, expiry }));
  return url(session);
}

function url(session: string) {
  return `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${KEY}`;
}

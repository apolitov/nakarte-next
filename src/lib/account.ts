// Login through Authelia and sync of routes/tracks with the server (maps-api).
// The map works without login; logged-in users get their documents on every device.
import { store, type Doc } from './store';

const API = `${import.meta.env.BASE_URL}api`;
const SYNC_KEY = 'nk-last-sync';

export interface User {
  user: string;
  name: string;
  groups: string[];
}

/** null when not logged in (Authelia answers 401/403 or redirects to its portal). */
export async function whoami(): Promise<User | null> {
  try {
    const r = await fetch(`${API}/me`, { redirect: 'manual', headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!r.ok || r.type === 'opaqueredirect') return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Sign in with Google, then back to the same map view. */
export function login() {
  const to = `${import.meta.env.BASE_URL}${location.hash}`;
  location.href = `${API}/auth/google/start?to=${encodeURIComponent(to)}`;
}

/** Alternative: an alexe.pt account (Authelia). */
export function loginAuthelia() {
  location.href = `${API}/login/authelia`;
}

export async function logout() {
  await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  location.reload();
}

/** Deletes the account and everything stored for it on the server. */
export async function deleteAccount() {
  const r = await fetch(`${API}/account`, { method: 'DELETE', credentials: 'same-origin' });
  if (!r.ok) throw new Error(`delete account: ${r.status}`);
  try {
    localStorage.removeItem('nk-last-sync');
  } catch {
    /* ignore */
  }
  location.reload();
}

async function api(path: string, init?: RequestInit) {
  const r = await fetch(`${API}${path}`, { redirect: 'manual', credentials: 'same-origin', ...init });
  if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) throw new Error('auth');
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r;
}

export const remote = {
  put: (d: Doc) => api(`/docs/${encodeURIComponent(d.id)}`, { method: 'PUT', body: JSON.stringify(d), headers: { 'Content-Type': 'application/json' } }),
  delete: (id: string) => api(`/docs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

function lastSync() {
  try {
    return Number(localStorage.getItem(SYNC_KEY) ?? 0);
  } catch {
    return 0;
  }
}
function setLastSync(t: number) {
  try {
    localStorage.setItem(SYNC_KEY, String(t));
  } catch {
    /* ignore */
  }
}

/**
 * Two-way sync: newer `updated` wins. Remote deletions remove local copies.
 * Returns true when local data changed (the app should reload its lists).
 */
export async function sync(): Promise<boolean> {
  const since = lastSync();
  const started = Date.now();
  const list: { id: string; updated: number; deleted: boolean }[] = await (await api(`/docs?since=0`)).json();
  const remoteById = new Map(list.map((d) => [d.id, d]));
  const local = await store.all();
  const localById = new Map(local.map((d) => [d.id, d]));
  let changed = false;

  // remote → local
  for (const r of list) {
    const l = localById.get(r.id);
    if (r.deleted) {
      // deleted elsewhere after our last sync, and not edited here since
      if (l && r.updated > since && l.updated <= r.updated) {
        await store.delete(r.id);
        changed = true;
      }
      continue;
    }
    if (!l || r.updated > l.updated) {
      const doc: Doc = await (await api(`/docs/${encodeURIComponent(r.id)}`)).json();
      await store.put(doc);
      changed = true;
    }
  }
  // local → remote
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (r?.deleted && r.updated >= l.updated) continue;
    if (!r || l.updated > r.updated) await remote.put(l);
  }
  setLastSync(started);
  return changed;
}

/** Short link: a full snapshot of the document on the server. */
export async function shareShort(d: Doc): Promise<string> {
  const { id } = await (await api('/share', { method: 'POST', body: JSON.stringify(d), headers: { 'Content-Type': 'application/json' } })).json();
  return `${location.origin}${import.meta.env.BASE_URL}#s=${id}`;
}

export async function loadShort(id: string): Promise<Doc | null> {
  try {
    const r = await fetch(`${API}/s/${encodeURIComponent(id)}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

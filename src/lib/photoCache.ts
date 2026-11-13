// Browser cache of photo lists along routes, in its own IndexedDB database (routes and tracks
// live in lib/store.ts). Keys are map cells or route pieces; each entry has its own expiry.
// Reads are asynchronous and only for what is on screen, so the cache does not slow the page.

const DB = 'nomapa-cache';
const STORE = 'photos';
const MAX_ENTRIES = 20000;

interface Entry {
  key: string;
  /** expiry, ms since epoch */
  exp: number;
  /** last use, for clean-up beyond MAX_ENTRIES */
  used: number;
  items: unknown[];
}

let dbp: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((resolve) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('used', 'used');
      r.onsuccess = () => {
        resolve(r.result);
        prune(r.result);
      };
      r.onerror = () => resolve(null); // private mode and the like: work without a cache
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

/** Drops expired entries and, beyond MAX_ENTRIES, the least recently used ones. */
function prune(db: IDBDatabase) {
  const tx = db.transaction(STORE, 'readwrite');
  const st = tx.objectStore(STORE);
  const now = Date.now();
  st.openCursor().onsuccess = (e) => {
    const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!c) return;
    if ((c.value as Entry).exp < now) c.delete();
    c.continue();
  };
  st.count().onsuccess = (e) => {
    let extra = (e.target as IDBRequest<number>).result - MAX_ENTRIES;
    if (extra <= 0) return;
    st.index('used').openCursor().onsuccess = (ev) => {
      const c = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!c || extra-- <= 0) return;
      c.delete();
      c.continue();
    };
  };
}

export async function cacheGet<T>(key: string): Promise<T[] | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    const r = st.get(key);
    r.onsuccess = () => {
      const e = r.result as Entry | undefined;
      if (!e || e.exp < Date.now()) return resolve(null);
      e.used = Date.now();
      st.put(e);
      resolve(e.items as T[]);
    };
    r.onerror = () => resolve(null);
  });
}

export async function cachePut(key: string, items: unknown[], ttlMs: number): Promise<void> {
  const db = await open();
  if (!db) return;
  const now = Date.now();
  db.transaction(STORE, 'readwrite').objectStore(STORE).put({ key, exp: now + ttlMs, used: now, items } satisfies Entry);
}

export const DAY = 86_400_000;

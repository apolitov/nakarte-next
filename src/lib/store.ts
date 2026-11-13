// Local persistence in IndexedDB: routes and tracks survive reloads; large
// tracks would not fit into localStorage's ~5 MB.
import type { Position } from 'geojson';

export interface Checkpoint {
  id: string;
  lng: number;
  lat: number;
  kind: string;
  name: string;
  note?: string;
}

export interface RouteDoc {
  id: string;
  kind: 'route';
  name: string;
  profile: string;
  params?: Record<string, string | number | boolean>;
  /** `straight` marks the leg that starts at this waypoint. */
  waypoints: { lng: number; lat: number; straight?: boolean }[];
  checkpoints: Checkpoint[];
  /** Computed legs, so an opened route shows at once without asking the router again. */
  legs?: import('./brouter').StoredLeg[];
  /** first saved; older routes have only `updated` */
  created?: number;
  updated: number;
}

export interface TrackDoc {
  id: string;
  kind: 'track';
  name: string;
  lines: Position[][];
  checkpoints: Checkpoint[];
  color?: string;
  visible?: boolean;
  activity?: string;
  routeId?: string;
  updated: number;
}

export type Doc = RouteDoc | TrackDoc;

const DB = 'nakarte-next';
const STORE = 'docs';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const store = {
  all: () => tx<Doc[]>('readonly', (s) => s.getAll() as IDBRequest<Doc[]>).catch(() => [] as Doc[]),
  put: (d: Doc) => tx('readwrite', (s) => s.put($snapshot(d))).catch(() => undefined),
  delete: (id: string) => tx('readwrite', (s) => s.delete(id)).catch(() => undefined),
};

/** Svelte proxies cannot be structured-cloned into IndexedDB. */
function $snapshot<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Route being edited: waypoints, per-leg mode (road or straight), routing
// profile, legs between waypoints, undo/redo.
import { track, pointsBucket } from './analytics';
import { fetchLeg, seedLeg, packLeg, unpackLeg, type StoredLeg, normalizeProfile, optionsToParams, paramsToOptions, type Leg, type LegPoint, type ProfileId, type RouteOptions } from './brouter';
import { buildProfile, type Profile } from './profile';
import { newId, type Checkpoint, type RouteDoc } from './store';
import { t, LOCALE } from './i18n';

export interface Waypoint {
  id: number;
  lng: number;
  lat: number;
  /** The leg from this waypoint to the next one is a straight line. */
  straight?: boolean;
}

type LegState = { status: 'loading' } | { status: 'ok'; leg: Leg } | { status: 'error'; error: string };
type Snapshot = { waypoints: Omit<Waypoint, 'id'>[]; checkpoints: Checkpoint[] };

let nextId = 1;
const HISTORY = 200;

export class RouteState {
  docId = $state(newId('r'));
  /** when the route was first made (0: not saved yet) */
  created = 0;
  name = $state('');
  waypoints = $state<Waypoint[]>([]);
  checkpoints = $state<Checkpoint[]>([]);
  profile = $state<ProfileId>('nk-gravel');
  params = $state<Record<string, string | number | boolean>>({});
  legs = $state<LegState[]>([]);
  /** Bumped on every change, so effects can react without deep tracking. */
  version = $state(0);
  /** Next click adds a point at the start instead of the end. */
  prepend = $state(false);

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  canUndo = $state(false);
  canRedo = $state(false);

  /** Full geometry: legs glued together (shared endpoints dropped). */
  points = $derived.by(() => {
    const out: (LegPoint & { leg: number; straight: boolean })[] = [];
    this.legs.forEach((l, i) => {
      if (l.status !== 'ok') return;
      const straight = !!this.waypoints[i]?.straight;
      const pts = out.length ? l.leg.points.slice(1) : l.leg.points;
      for (const p of pts) out.push({ ...p, leg: i, straight });
    });
    return out;
  });

  profileData: Profile = $derived.by(() => {
    const spans = [];
    let offset = 0;
    for (const l of this.legs) {
      if (l.status !== 'ok') continue;
      for (const s of l.leg.spans) spans.push({ ...s, from: s.from + offset, to: s.to + offset });
      offset += l.leg.points.length - 1;
    }
    return buildProfile(this.points, spans);
  });

  loading = $derived(this.legs.some((l) => l.status === 'loading'));
  error = $derived(this.legs.find((l) => l.status === 'error') as { error: string } | undefined);

  // ---- persistence ----

  toDoc(): RouteDoc {
    return {
      id: this.docId,
      kind: 'route',
      name: this.name || this.autoName(),
      autoName: this.name ? undefined : true,
      profile: this.profile,
      params: { ...this.params },
      waypoints: this.waypoints.map(({ lng, lat, straight }) => (straight ? { lng, lat, straight } : { lng, lat })),
      checkpoints: this.checkpoints.map((c) => ({ ...c })),
      legs: this.legs.length && this.legs.every((l) => l.status === 'ok')
        ? this.legs.map((l) => packLeg((l as { leg: Leg }).leg))
        : undefined,
      created: this.created || (this.created = Date.now()),
      updated: Date.now(),
    };
  }

  load(doc: RouteDoc) {
    this.docId = doc.id;
    this.created = doc.created ?? doc.updated ?? 0;
    // a made-up name stays a placeholder: the route still gets asked for a real one
    // (older routes carry no mark: a name of the "Route 12 km, 13 Nov" pattern counts as made up)
    this.name = doc.autoName || /^Route [\d.]+ km, /.test(doc.name) ? '' : doc.name;
    this.profile = normalizeProfile(doc.profile ?? '');
    this.params = { ...(doc.params ?? {}) };
    this.checkpoints = doc.checkpoints ?? [];
    this.undoStack = [];
    this.redoStack = [];
    this.syncHistoryFlags();
    this.rebuild(doc.waypoints, doc.legs);
  }

  /** Starts a new empty route. */
  reset() {
    this.load({ id: newId('r'), kind: 'route', name: '', profile: this.profile, params: this.params, waypoints: [], checkpoints: [], updated: 0 });
  }

  autoName() {
    const km = this.profileData.length / 1000;
    const d = new Date().toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
    return km > 0 ? t('route.autoName', { km: km.toFixed(km < 10 ? 1 : 0), date: d }) : t('route.autoNameEmpty', { date: d });
  }

  // ---- history ----

  private snapshot(): Snapshot {
    return {
      waypoints: this.waypoints.map(({ lng, lat, straight }) => ({ lng, lat, straight })),
      checkpoints: this.checkpoints.map((c) => ({ ...c })),
    };
  }

  /** Call before every user edit. */
  private record() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.syncHistoryFlags();
  }

  private syncHistoryFlags() {
    this.canUndo = this.undoStack.length > 0;
    this.canRedo = this.redoStack.length > 0;
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }

  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }

  private restore(s: Snapshot) {
    this.checkpoints = s.checkpoints;
    this.syncHistoryFlags();
    this.rebuild(s.waypoints); // legs come from the request cache, so this is instant
  }

  // ---- legs ----

  private rebuild(pts: Omit<Waypoint, 'id'>[], stored?: StoredLeg[]) {
    this.waypoints = pts.map((p) => ({ id: nextId++, lng: p.lng, lat: p.lat, straight: p.straight || undefined }));
    this.legs = [];
    // legs saved with the route are put into the request cache: no router calls on open
    if (stored?.length === this.waypoints.length - 1) {
      stored.forEach((sl, i) => {
        const a = this.waypoints[i];
        try {
          seedLeg(a, this.waypoints[i + 1], a.straight ? 'straight' : this.profile, this.params, unpackLeg(sl));
          if (a.straight) this.legs[i] = { status: 'ok', leg: unpackLeg(sl) };
        } catch {
          /* a broken stored leg is simply computed again */
        }
      });
    }
    for (let i = 1; i < this.waypoints.length; i++) if (!this.legs[i - 1]) this.loadLeg(i - 1);
    this.changed();
  }

  private changed() {
    this.version++;
  }

  private pending = new Map<string, number>();
  private seq = 0;

  private loadLeg(i: number) {
    const a = this.waypoints[i], b = this.waypoints[i + 1];
    if (!a || !b) return;
    const key = `${a.id}-${b.id}`;
    const token = ++this.seq;
    this.pending.set(key, token);
    this.legs[i] = { status: 'loading' };
    const t0 = performance.now();
    const routed = !a.straight;
    fetchLeg(a, b, a.straight ? 'straight' : this.profile, this.params).then(
      (leg) => {
        if (routed) legDone(this.profile, this.waypoints.length, performance.now() - t0);
        this.resolveLeg(key, token, { status: 'ok', leg });
      },
      (e) => {
        if (routed) legFailed((e as Error).message);
        this.resolveLeg(key, token, { status: 'error', error: (e as Error).message });
      },
    );
  }

  /** Answers arrive out of order: apply only the latest request for this pair of points. */
  private resolveLeg(key: string, token: number, st: LegState) {
    if (this.pending.get(key) !== token) return;
    this.pending.delete(key);
    const [ida, idb] = key.split('-').map(Number);
    const i = this.waypoints.findIndex((w) => w.id === ida);
    if (i < 0 || this.waypoints[i + 1]?.id !== idb) return;
    this.legs[i] = st;
    this.version++;
  }

  // ---- edits ----

  /** Drawing mode: new legs are straight lines instead of following roads. */
  drawStraight = $state(false);

  add(lng: number, lat: number, straightOnce = false) {
    this.record();
    const straight = this.drawStraight || straightOnce || undefined;
    if (this.prepend && this.waypoints.length) {
      this.waypoints.unshift({ id: nextId++, lng, lat, straight });
      this.legs.unshift({ status: 'loading' });
      this.loadLeg(0);
    } else {
      const n = this.waypoints.length;
      if (n) this.waypoints[n - 1] = { ...this.waypoints[n - 1], straight };
      this.waypoints.push({ id: nextId++, lng, lat });
      if (this.waypoints.length > 1) {
        this.legs.push({ status: 'loading' });
        this.loadLeg(this.waypoints.length - 2);
      }
    }
    this.changed();
  }

  insert(index: number, lng: number, lat: number) {
    this.record();
    // the new point inherits the leg mode of the leg it splits
    const straight = this.waypoints[index - 1]?.straight;
    this.waypoints.splice(index, 0, { id: nextId++, lng, lat, straight });
    this.legs.splice(index - 1, 1, { status: 'loading' }, { status: 'loading' });
    this.loadLeg(index - 1);
    this.loadLeg(index);
    this.changed();
  }

  move(id: number, lng: number, lat: number) {
    const i = this.waypoints.findIndex((w) => w.id === id);
    if (i < 0) return;
    this.record();
    this.waypoints[i] = { ...this.waypoints[i], lng, lat };
    if (i > 0) this.loadLeg(i - 1);
    if (i < this.waypoints.length - 1) this.loadLeg(i);
    this.changed();
  }

  remove(id: number) {
    const i = this.waypoints.findIndex((w) => w.id === id);
    if (i < 0) return;
    this.record();
    this.waypoints.splice(i, 1);
    if (this.waypoints.length < 2) this.legs = [];
    else if (i === 0) this.legs.splice(0, 1);
    else if (i === this.waypoints.length) this.legs.splice(i - 1, 1);
    else {
      this.legs.splice(i - 1, 2, { status: 'loading' });
      this.loadLeg(i - 1);
    }
    this.changed();
  }

  /** Removes the point added last (at the end, or at the start in prepend mode). */
  removeLast() {
    const w = this.prepend ? this.waypoints[0] : this.waypoints.at(-1);
    if (w) this.remove(w.id);
  }

  setLegStraight(leg: number, straight: boolean) {
    const w = this.waypoints[leg];
    if (!w || !!w.straight === straight) return;
    this.record();
    this.waypoints[leg] = { ...w, straight: straight || undefined };
    this.loadLeg(leg);
    this.changed();
  }

  reverse() {
    this.record();
    const w = this.waypoints;
    // leg i (w[i]→w[i+1]) becomes leg n-2-i, whose start point is w[i+1]
    const rev = w
      .map((p, i) => ({ lng: p.lng, lat: p.lat, straight: i > 0 ? w[i - 1].straight : undefined }))
      .reverse();
    this.rebuild(rev);
  }

  /** Goes back to the start along the same way: out-and-back. */
  outAndBack() {
    if (this.waypoints.length < 2) return;
    this.record();
    const w = this.waypoints;
    const back = w.slice(0, -1).reverse().map((p, k) => {
      const i = w.length - 2 - k; // original index; return leg ends at w[i]
      return { lng: p.lng, lat: p.lat, straight: i > 0 ? w[i - 1].straight : undefined, src: i };
    });
    const pts = [
      ...w.map((p, i) => ({ lng: p.lng, lat: p.lat, straight: i === w.length - 1 ? w[w.length - 2].straight : p.straight })),
      ...back.map(({ lng, lat, straight }) => ({ lng, lat, straight })),
    ];
    this.rebuild(pts);
  }

  /** Closes the loop: adds the start as the last point. */
  backToStart() {
    const s = this.waypoints[0];
    if (!s || this.waypoints.length < 2) return;
    this.add(s.lng, s.lat);
  }

  clear() {
    this.record();
    this.checkpoints = [];
    this.rebuild([]);
  }

  // ---- checkpoints ----

  addCheckpoint(lng: number, lat: number, kind = 'generic'): string {
    this.record();
    const id = newId('c');
    this.checkpoints = [...this.checkpoints, { id, lng, lat, kind, name: '' }];
    this.changed();
    return id;
  }

  updateCheckpoint(id: string, patch: Partial<Checkpoint>) {
    const i = this.checkpoints.findIndex((c) => c.id === id);
    if (i < 0) return;
    const cur = this.checkpoints[i] as unknown as Record<string, unknown>;
    if (Object.entries(patch).every(([k, v]) => cur[k] === v)) return; // nothing changed: no history entry
    this.record();
    this.checkpoints[i] = { ...this.checkpoints[i], ...patch, id };
    this.changed();
  }

  removeCheckpoint(id: string) {
    this.record();
    this.checkpoints = this.checkpoints.filter((c) => c.id !== id);
    this.changed();
  }

  setProfile(p: ProfileId) {
    this.profile = p;
    this.rebuild(this.snapshot().waypoints);
  }

  options = $derived(paramsToOptions(this.params));

  setOptions(o: RouteOptions) {
    this.setParams(optionsToParams(o));
  }

  rename(name: string) {
    this.name = name.trim();
    this.changed();
  }

  setParams(params: Record<string, string | number | boolean>) {
    this.params = params;
    this.rebuild(this.snapshot().waypoints);
  }
}

// ---- analytics (docs/analytics-plan.md): the first computed route of a session, failures, slow legs
let builtOnce = false;
function legDone(profile: string, points: number, ms: number) {
  if (!builtOnce) {
    builtOnce = true;
    track('route_built', { profile, points: pointsBucket(points) });
  }
  if (ms > 5000) track('route_slow', { profile, s: Math.round(ms / 1000) });
}
function legFailed(msg: string) {
  const kind = /no track|not found/i.test(msg) ? 'no_track' : /too long|limit/i.test(msg) ? 'leg_too_long' : /busy|429|503/i.test(msg) ? 'busy' : 'network';
  track('route_error', { kind });
}

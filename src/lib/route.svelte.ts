// Route being edited: waypoints, routing profile, legs between waypoints.
import { fetchLeg, type Leg, type LegPoint, type ProfileId } from './brouter';
import { buildProfile, type Profile } from './profile';

export interface Waypoint {
  id: number;
  lng: number;
  lat: number;
}

type LegState = { status: 'loading' } | { status: 'ok'; leg: Leg } | { status: 'error'; error: string };

let nextId = 1;
const STORAGE = 'nk-route';

export class RouteState {
  waypoints = $state<Waypoint[]>([]);
  profile = $state<ProfileId>('trekking');
  legs = $state<LegState[]>([]);
  /** Bumped on every change, so effects can react without deep tracking. */
  version = $state(0);

  /** Full geometry: legs glued together (shared endpoints dropped). */
  points = $derived.by(() => {
    const out: (LegPoint & { leg: number })[] = [];
    this.legs.forEach((l, i) => {
      if (l.status !== 'ok') return;
      const pts = out.length ? l.leg.points.slice(1) : l.leg.points;
      for (const p of pts) out.push({ ...p, leg: i });
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

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
      if (saved?.waypoints?.length) {
        this.profile = saved.profile ?? 'trekking';
        this.setWaypoints(saved.waypoints);
      }
    } catch {
      /* no storage */
    }
  }

  private save() {
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({ profile: this.profile, waypoints: this.waypoints.map(({ lng, lat }) => ({ lng, lat })) }),
      );
    } catch {
      /* no storage */
    }
  }

  setWaypoints(pts: { lng: number; lat: number }[]) {
    this.waypoints = pts.map((p) => ({ id: nextId++, lng: p.lng, lat: p.lat }));
    this.legs = [];
    for (let i = 1; i < this.waypoints.length; i++) this.loadLeg(i - 1);
    this.changed();
  }

  private changed() {
    this.version++;
    this.save();
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
    fetchLeg(a, b, this.profile).then(
      (leg) => this.resolveLeg(key, token, { status: 'ok', leg }),
      (e) => this.resolveLeg(key, token, { status: 'error', error: (e as Error).message }),
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

  add(lng: number, lat: number) {
    this.waypoints.push({ id: nextId++, lng, lat });
    if (this.waypoints.length > 1) {
      this.legs.push({ status: 'loading' });
      this.loadLeg(this.waypoints.length - 2);
    }
    this.changed();
  }

  insert(index: number, lng: number, lat: number) {
    this.waypoints.splice(index, 0, { id: nextId++, lng, lat });
    this.legs.splice(index - 1, 1, { status: 'loading' }, { status: 'loading' });
    this.loadLeg(index - 1);
    this.loadLeg(index);
    this.changed();
  }

  move(id: number, lng: number, lat: number) {
    const i = this.waypoints.findIndex((w) => w.id === id);
    if (i < 0) return;
    this.waypoints[i] = { id, lng, lat };
    if (i > 0) this.loadLeg(i - 1);
    if (i < this.waypoints.length - 1) this.loadLeg(i);
    this.changed();
  }

  remove(id: number) {
    const i = this.waypoints.findIndex((w) => w.id === id);
    if (i < 0) return;
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

  reverse() {
    this.setWaypoints([...this.waypoints].reverse());
  }

  clear() {
    this.waypoints = [];
    this.legs = [];
    this.changed();
  }

  setProfile(p: ProfileId) {
    this.profile = p;
    this.setWaypoints(this.waypoints);
  }
}

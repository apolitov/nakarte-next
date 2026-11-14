// Moving time along a route, summed over its pieces with the grade and surface of each.
// Breaks and stops are not included. Every number below comes from a published source
// (docs/routing.md, section 7); none is fitted to anyone's own rides.
//
// Bikes: the power equation of Martin et al. 1998 (validated, R² 0.97), as BRouter's kinematic
// model uses it: the speed at which the rider's power covers rolling resistance, air drag and
// gravity, eta·P = v·(m·g·(sinθ + Crr·cosθ) + ½·ρ·CdA·v²), capped downhill. Power, mass, drag
// and speed caps are the ones of BRouter's stock profiles; rolling resistance by surface from
// measurements (Martin/Kyle, Steyn & Warnich 2014, Karrasch) and Zwift's table where none exist.
// Walking: Tobler's hiking function, v = 6·exp(−3.5·|g + 0.05|) km/h, as BRouter uses it.
import { t } from './i18n';
import type { Profile, SurfaceClass } from './profile';

interface Bike {
  /** rider and bike, kg */
  mass: number;
  /** drag area, m² (BRouter's S_C_x = ½·ρ·CdA) */
  cda: number;
  /** rider's power, W */
  power: number;
  /** rolling resistance by surface */
  crr: Record<SurfaceClass, number>;
  /** top speed on tarmac, km/h; on other surfaces scaled by SURF_CAP */
  vmax: number;
}

const RHO = 1.2;
/** BRouter's S_C_x is ½·ρ·CdA */
const cdaOf = (scx: number) => (2 * scx) / RHO;

export const BIKES: Record<string, Bike> = {
  // BRouter fastbike.brf: 90 kg, S_C_x 0.225, max 45 km/h; power 150 W as in gravel.brf
  // (fastbike's own 100 W made road bikes slower than gravel bikes); road tyres per surface
  'nk-road': {
    mass: 90, cda: cdaOf(0.225), power: 150, vmax: 45,
    crr: { paved: 0.004, compact: 0.012, unpaved: 0.012, ground: 0.016, path: 0.025, ferry: 0.004, unknown: 0.004 },
  },
  // BRouter gravel.brf: 150 W, 90 kg, S_C_x 0.300, C_r 0.005, max 35 km/h; gravel tyres
  'nk-gravel': {
    mass: 90, cda: cdaOf(0.3), power: 150, vmax: 35,
    crr: { paved: 0.005, compact: 0.006, unpaved: 0.009, ground: 0.012, path: 0.02, ferry: 0.005, unknown: 0.005 },
  },
  // BRouter mtb.brf sets nothing, so its defaults: 100 W, 90 kg, S_C_x 0.225, max 45 km/h
  'nk-mtb': {
    mass: 90, cda: cdaOf(0.225), power: 100, vmax: 45,
    crr: { paved: 0.005, compact: 0.006, unpaved: 0.009, ground: 0.01, path: 0.02, ferry: 0.005, unknown: 0.006 },
  },
};
/**
 * Downhill speed caps off tarmac: GraphHopper's surface speeds relative to its tarmac speed
 * (bike profile: compacted 14, gravel 12, ground 10, grass 8 of 18 km/h).
 */
const SURF_CAP: Record<SurfaceClass, number> = { paved: 1, compact: 14 / 18, unpaved: 12 / 18, ground: 10 / 18, path: 8 / 18, ferry: 1, unknown: 1 };
/** drivetrain efficiency (Martin et al. 1998) */
const ETA = 0.977;
const G = 9.81;
/** a boat crossing: about 20 km/h under way (Tagus ferries), waiting at the pier not counted */
const FERRY_MS = 20 / 3.6;
/** pushing the bike: GraphHopper's walking speed for bikes, 4 km/h */
const V_MIN = 4 / 3.6;

/** Steady speed (m/s) on a grade (fraction) and surface. */
export function bikeSpeed(b: Bike, grade: number, surf: SurfaceClass, pace = 1): number {
  const th = Math.atan(grade);
  const f0 = b.mass * G * (Math.sin(th) + b.crr[surf] * Math.cos(th));
  const k = 0.5 * RHO * b.cda;
  const p = ETA * b.power * pace;
  const need = (v: number) => v * (f0 + k * v * v) - p;
  const cap = (b.vmax * SURF_CAP[surf]) / 3.6;
  if (need(cap) <= 0) return cap;
  let lo = 0, hi = cap;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (need(m) > 0) hi = m;
    else lo = m;
  }
  return Math.max(V_MIN, lo);
}

/** Tobler's walking speed, km/h, on a grade (fraction). */
export function walkSpeed(grade: number, pace = 1): number {
  return 6 * Math.exp(-3.5 * Math.abs(grade + 0.05)) * pace;
}

/** Moving time in minutes. `pace` scales the rider's power or the walking speed. */
export function routeMinutes(p: Pick<Profile, 'dist' | 'grade' | 'surface'>, profileId: string, pace = 1): number {
  const n = p.dist.length;
  const bike = BIKES[profileId] ?? (profileId === 'nk-hike' ? null : BIKES['nk-gravel']);
  let s = 0;
  for (let i = 1; i < n; i++) {
    const d = p.dist[i] - p.dist[i - 1];
    if (d <= 0) continue;
    if (p.surface[i] === 'ferry') { s += d / FERRY_MS; continue; }
    const g = (p.grade[i] ?? 0) / 100;
    s += bike ? d / bikeSpeed(bike, g, p.surface[i] ?? 'unknown', pace) : d / ((walkSpeed(g, pace) * 1000) / 3600);
  }
  return s / 60;
}

export function formatDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return t('time.min', { m });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? t('time.hmin', { h, m: String(r).padStart(2, '0') }) : t('time.h', { h });
}

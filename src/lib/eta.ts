// Moving time along a route, summed over its pieces with the grade and surface of each
// (breaks are not included). docs/routing.md explains the model and where its numbers come from.
//
// Bikes: the speed at which the rider's power balances rolling resistance (by surface), air
// drag and gravity: eta·P = v·(m·g·(sinθ + Crr·cosθ) + ½·ρ·CdA·v²). Downhill the rider pedals
// less (none from −4%) and the speed is capped by surface. The result is slowed by a fixed
// share for junctions, bends and starts, calibrated on real rides.
// Walking: Tobler's hiking function, v = 6·exp(−3.5·|g + 0.05|) km/h, fastest on a gentle
// descent and slow on steep ones both ways; trail signs (DIN 33466) overestimate long descents.
import { t } from './i18n';
import type { Profile, SurfaceClass } from './profile';

interface Bike {
  /** rider and bike, kg */
  mass: number;
  /** drag area, m² */
  cda: number;
  /** sustained power on the flat, W */
  power: number;
  /** rolling resistance by surface */
  crr: Record<SurfaceClass, number>;
  /** downhill speed cap by surface, km/h */
  vmax: Record<SurfaceClass, number>;
}

const CRR_TOURING: Record<SurfaceClass, number> = { paved: 0.006, compact: 0.011, unpaved: 0.018, ground: 0.025, path: 0.035, unknown: 0.011 };
export const BIKES: Record<string, Bike> = {
  'nk-road': {
    mass: 83, cda: 0.32, power: 150,
    crr: { paved: 0.005, compact: 0.014, unpaved: 0.025, ground: 0.035, path: 0.05, unknown: 0.006 },
    vmax: { paved: 50, compact: 30, unpaved: 22, ground: 18, path: 12, unknown: 45 },
  },
  'nk-gravel': {
    mass: 86, cda: 0.38, power: 118, crr: CRR_TOURING,
    vmax: { paved: 45, compact: 38, unpaved: 32, ground: 26, path: 18, unknown: 35 },
  },
  'nk-mtb': {
    mass: 90, cda: 0.45, power: 130,
    crr: { paved: 0.009, compact: 0.012, unpaved: 0.016, ground: 0.02, path: 0.026, unknown: 0.014 },
    vmax: { paved: 40, compact: 35, unpaved: 30, ground: 26, path: 20, unknown: 30 },
  },
};
/** junctions, bends, starts and wind: moving averages are this much below the steady speed */
const BIKE_REAL = 1.2;
const G = 9.81, RHO = 1.2, ETA = 0.97;
/** never slower than walking the bike, m/s */
const V_MIN = 1.2;

/** Steady speed (m/s) on a grade (fraction) and surface. */
export function bikeSpeed(b: Bike, grade: number, surf: SurfaceClass, pace = 1): number {
  // a descent is never slower than the flat on the same surface
  if (grade < 0) return Math.max(steady(b, grade, surf, pace), steady(b, 0, surf, pace));
  return steady(b, grade, surf, pace);
}

function steady(b: Bike, grade: number, surf: SurfaceClass, pace: number): number {
  // uphill riders push harder than on the flat (up to +30% from 6%); downhill they ease off
  // and stop pedalling at −4%
  const p = b.power * pace * (grade >= 0 ? 1 + Math.min(0.3, grade * 5) : Math.max(0, 1 + grade / 0.04));
  const th = Math.atan(grade);
  const f0 = b.mass * G * (Math.sin(th) + b.crr[surf] * Math.cos(th));
  const k = 0.5 * RHO * b.cda;
  const need = (v: number) => v * (f0 + k * v * v) - ETA * p;
  const cap = b.vmax[surf] / 3.6;
  // power needed grows with speed wherever the bike is not already rolling on its own
  if (need(cap) <= 0) return cap;
  let lo = 0, hi = cap;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (need(m) > 0) hi = m;
    else lo = m;
  }
  return Math.max(V_MIN, lo);
}

/** Tobler's walking speed (km/h) on a grade (fraction); slower off good paths. */
export function walkSpeed(grade: number, surf: SurfaceClass, pace = 1): number {
  const terrain = surf === 'path' ? 0.95 : surf === 'ground' ? 0.97 : 1;
  return 6 * Math.exp(-3.5 * Math.abs(grade + 0.05)) * HIKE_PACE * terrain * pace;
}
/** Tobler is for fit walkers on trails; 0.9 matched a measured 12.8 km mountain hike */
const HIKE_PACE = 0.9;

/** Moving time in minutes. `pace` scales the rider's power or the walking speed. */
export function routeMinutes(p: Pick<Profile, 'dist' | 'grade' | 'surface'>, profileId: string, pace = 1): number {
  const n = p.dist.length;
  const bike = BIKES[profileId] ?? (profileId === 'nk-hike' ? null : BIKES['nk-gravel']);
  let s = 0;
  for (let i = 1; i < n; i++) {
    const d = p.dist[i] - p.dist[i - 1];
    if (d <= 0) continue;
    const g = (p.grade[i] ?? 0) / 100;
    const surf = p.surface[i] ?? 'unknown';
    s += bike ? (d / bikeSpeed(bike, g, surf, pace)) * BIKE_REAL : d / ((walkSpeed(g, surf, pace) * 1000) / 3600);
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

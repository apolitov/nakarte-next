// FIT course file (what Garmin devices load as a course): track with elevation
// and distance, plus checkpoints as course points. Encoded with the official
// Garmin FIT SDK.
import { Encoder, Profile } from '@garmin/fitsdk';
import { haversine } from './profile';

export interface CourseInput {
  name: string;
  sport: 'cycling' | 'hiking';
  points: { lng: number; lat: number; ele: number | null }[];
  checkpoints: { lng: number; lat: number; kind: string; name: string }[];
  /** assumed speed for timestamps, m/s (devices need them for virtual partner) */
  speed?: number;
}

const COURSE_POINT: Record<string, string> = {
  water: 'water',
  food: 'food',
  shop: 'store',
  camp: 'campsite',
  view: 'overlook',
  danger: 'danger',
  summit: 'summit',
  generic: 'generic',
};

const semicircles = (deg: number) => Math.round((deg * 2 ** 31) / 180);

export function encodeCourse(c: CourseInput): Uint8Array {
  if (c.points.length < 2) throw new Error('в курсе меньше двух точек');
  const speed = c.speed ?? (c.sport === 'cycling' ? 5.5 : 1.2);
  const start = new Date();
  const dist: number[] = [0];
  for (let i = 1; i < c.points.length; i++) dist.push(dist[i - 1] + haversine(c.points[i - 1], c.points[i]));
  const total = dist.at(-1)!;
  const at = (d: number) => new Date(start.getTime() + (d / speed) * 1000);
  const name = c.name.slice(0, 15) || 'Route'; // Edge shows ~15 chars

  const enc = new Encoder();
  // the SDK's typings list too few fields per message; the encoder itself takes all profile fields
  const e = { onMesg: (num: number, mesg: Record<string, unknown>) => enc.onMesg(num as never, mesg as never) };
  const M = Profile.MesgNum;
  e.onMesg(M.FILE_ID, { type: 'course', manufacturer: 'development', product: 0, timeCreated: start, serialNumber: 1 });
  e.onMesg(M.COURSE, { name, sport: c.sport });
  e.onMesg(M.LAP, {
    timestamp: at(total),
    startTime: start,
    startPositionLat: semicircles(c.points[0].lat),
    startPositionLong: semicircles(c.points[0].lng),
    endPositionLat: semicircles(c.points.at(-1)!.lat),
    endPositionLong: semicircles(c.points.at(-1)!.lng),
    totalElapsedTime: total / speed,
    totalTimerTime: total / speed,
    totalDistance: total,
  });
  e.onMesg(M.EVENT, { timestamp: start, event: 'timer', eventType: 'start', eventGroup: 0 });
  c.points.forEach((p, i) => {
    const rec: Record<string, unknown> = {
      timestamp: at(dist[i]),
      positionLat: semicircles(p.lat),
      positionLong: semicircles(p.lng),
      distance: dist[i],
    };
    if (p.ele != null) rec.altitude = p.ele;
    e.onMesg(M.RECORD, rec);
  });
  // course points sit on the nearest track point, sorted by distance
  const cps = c.checkpoints
    .map((cp) => {
      let best = 0, bd = Infinity;
      c.points.forEach((p, i) => {
        const d = (p.lat - cp.lat) ** 2 + ((p.lng - cp.lng) * Math.cos((cp.lat * Math.PI) / 180)) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      return { cp, i: best };
    })
    .sort((a, b) => a.i - b.i);
  for (const { cp, i } of cps) {
    const p = c.points[i];
    e.onMesg(M.COURSE_POINT, {
      timestamp: at(dist[i]),
      positionLat: semicircles(p.lat),
      positionLong: semicircles(p.lng),
      distance: dist[i],
      type: COURSE_POINT[cp.kind] ?? 'generic',
      name: (cp.name || cp.kind).slice(0, 15),
    });
  }
  e.onMesg(M.EVENT, { timestamp: at(total), event: 'timer', eventType: 'stopAll', eventGroup: 0 });
  return enc.close();
}

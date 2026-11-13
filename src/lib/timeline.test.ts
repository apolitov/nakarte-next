import { describe, expect, it } from 'vitest';
import { buildProfile } from './profile';
import { buildTimeline, climbThreshold, findClimbs, findSteep, limitEvents, nearestPoint, rails, segmentClasses, surfaceRuns, surfaceShares } from './timeline';
import { routeMinutes, formatDuration } from './eta';

/** Straight line due north, a point every 50 m, with the given elevation function. */
function line(n: number, ele: (d: number) => number) {
  const step = 50 / 111_320;
  return Array.from({ length: n }, (_, i) => ({ lng: -9.4, lat: 38.7 + i * step, ele: ele(i * 50) }));
}

describe('climbs', () => {
  it('finds one 5% climb in the middle', () => {
    // flat 2 km, climb 2 km at 5%, flat 2 km
    const pts = line(121, (d) => (d < 2000 ? 100 : d < 4000 ? 100 + (d - 2000) * 0.05 : 200));
    const c = findClimbs(buildProfile(pts));
    expect(c).toHaveLength(1);
    expect(c[0].gain).toBeCloseTo(100, 0);
    expect(c[0].len).toBeGreaterThan(1800);
    expect(c[0].len).toBeLessThan(2200);
  });

  it('ignores small bumps and gentle rises', () => {
    const bumps = line(121, (d) => 100 + 10 * Math.sin(d / 300));
    expect(findClimbs(buildProfile(bumps))).toHaveLength(0);
    const gentle = line(121, (d) => 100 + d * 0.02); // 2% for 6 km: 120 m, too gentle
    expect(findClimbs(buildProfile(gentle))).toHaveLength(0);
  });

  it('merges two climbs split by a short flat bit', () => {
    const pts = line(121, (d) => {
      if (d < 1000) return 100;
      if (d < 2000) return 100 + (d - 1000) * 0.06;
      if (d < 2300) return 160;
      if (d < 3300) return 160 + (d - 2300) * 0.06;
      return 220;
    });
    const c = findClimbs(buildProfile(pts));
    expect(c).toHaveLength(1);
    expect(c[0].gain).toBeCloseTo(120, 0);
  });
});

describe('climbs relative to the route', () => {
  it('a 20 m hill counts on a flat route, not in the mountains', () => {
    // flat at 40 m with one 20 m hill at 6% (330 m long)
    const flat = line(161, (d) => (d < 3000 ? 40 : d < 3330 ? 40 + (d - 3000) * 0.06 : d < 4000 ? 60 : 40 + Math.max(0, 60 - 40 - (d - 4000) * 0.06)));
    expect(climbThreshold(buildProfile(flat).ele)).toBe(10);
    expect(findClimbs(buildProfile(flat))).toHaveLength(1);
    // the same hill on a route with 1200 m of relief: threshold 80 m, no climb
    const mountain = line(161, (d) => (d < 3000 ? 40 : d < 3330 ? 40 + (d - 3000) * 0.06 : d < 4000 ? 60 : 60 + (d - 4000) * 0.3));
    expect(climbThreshold(buildProfile(mountain).ele)).toBe(80);
    expect(findClimbs(buildProfile(mountain)).some((c) => c.gain < 30)).toBe(false);
  });

  it('marks a short steep wall outside climbs', () => {
    // flat with a 15 m wall at 12% (125 m), threshold would be 10 m but the wall is short
    const pts = line(121, (d) => (d < 2000 ? 50 : d < 2125 ? 50 + (d - 2000) * 0.12 : 65));
    const p = buildProfile(pts);
    const steep = findSteep(p, []);
    expect(steep).toHaveLength(1);
    expect(steep[0].gain).toBeGreaterThanOrEqual(14);
  });
});

describe('timeline', () => {
  const pts = line(121, (d) => (d < 2000 ? 100 : d < 4000 ? 100 + (d - 2000) * 0.05 : 200));
  const prof = buildProfile(pts, [
    { from: 0, to: 40, surface: 'asphalt' },
    { from: 40, to: 80, surface: 'gravel' },
    { from: 80, to: 120, surface: 'asphalt' },
  ]);
  const points = pts.map((p, i) => ({ ...p, straight: i > 100 && i <= 110 }));

  it('has start, finish, a climb, a checkpoint, surface changes and a straight leg', () => {
    const ev = buildTimeline({
      points,
      profile: prof,
      checkpoints: [
        { id: 'w', lng: -9.4, lat: pts[30].lat, kind: 'water', name: '' },
        { id: 'far', lng: -9.3, lat: pts[30].lat, kind: 'food', name: 'Far away' },
      ],
    });
    const kinds = ev.map((e) => e.kind);
    expect(kinds[0]).toBe('start');
    expect(kinds.at(-1)).toBe('end');
    expect(kinds).toContain('climb');
    expect(kinds).toContain('straight');
    expect(ev.filter((e) => e.kind === 'checkpoint').map((e) => e.label)).toEqual(['Water']);
    expect(ev.find((e) => e.kind === 'climb')!.label).toMatch(/^↑ Climb 2\.\d km, 5%, \+100 m$/);
    expect(ev.filter((e) => e.kind === 'surface').map((e) => e.label.split(',')[0])).toEqual(['Gravel', 'Asphalt']);
    // sorted by distance
    for (let k = 1; k < ev.length; k++) expect(ev[k].d).toBeGreaterThanOrEqual(ev[k - 1].d);
    const r = rails(ev, prof, segmentClasses(points, prof.surface));
    expect(r.at(-1)).toBeNull();
    expect(r[0]).not.toBeNull();
  });

  it('limits events keeping start, finish and the important ones', () => {
    const ev = buildTimeline({ points, profile: prof, checkpoints: [] });
    const few = limitEvents(ev, 3);
    expect(few.map((e) => e.kind)).toEqual(['start', 'climb', 'end']);
  });

  it('computes surface shares and runs', () => {
    const cls = segmentClasses(points, prof.surface);
    const sh = surfaceShares(prof.dist, cls);
    expect(sh.map((s) => s.cls)).toEqual(['paved', 'unpaved', 'straight']);
    expect(sh.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 5);
    expect(surfaceRuns(prof.dist, cls).map((r) => r.cls)).toEqual(['paved', 'unpaved', 'paved']);
  });

  it('finds the nearest point', () => {
    const n = nearestPoint(points, -9.4, pts[7].lat + 1e-6);
    expect(n.i).toBe(7);
    expect(n.m).toBeLessThan(1);
  });
});

describe('eta', () => {
  const flat = (km: number, grade: number, surf: string) => {
    const n = km * 10 + 1;
    return { dist: Array.from({ length: n }, (_, i) => i * 100), grade: Array(n).fill(grade), surface: Array(n).fill(surf) } as never;
  };
  it('rides by grade and surface', () => {
    // 10 km flat: about 25 km/h on a road bike on tarmac, 19 on gravel on compacted ways
    expect(routeMinutes(flat(10, 0, 'paved'), 'nk-road')).toBeCloseTo(24, 0);
    expect(routeMinutes(flat(10, 0, 'compact'), 'nk-gravel')).toBeCloseTo(32, 0);
    // rougher is slower, uphill much slower, downhill faster
    expect(routeMinutes(flat(10, 0, 'path'), 'nk-gravel')).toBeGreaterThan(routeMinutes(flat(10, 0, 'compact'), 'nk-gravel'));
    expect(routeMinutes(flat(10, 6, 'paved'), 'nk-road')).toBeGreaterThan(55);
    expect(routeMinutes(flat(10, -6, 'paved'), 'nk-road')).toBeLessThan(20);
  });
  it('walks by Tobler', () => {
    // fastest at -5%, slower on the flat, slow on steep descents
    const t = (g: number) => routeMinutes(flat(4, g, 'unknown'), 'nk-hike');
    expect(t(-5)).toBeLessThan(t(0));
    expect(t(-25)).toBeGreaterThan(t(0));
    expect(t(0) / 60).toBeCloseTo(4 / 4.31, 1);
  });
  it('formats', () => {
    expect(formatDuration(191)).toBe('3 h 11 min');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 h');
  });
});

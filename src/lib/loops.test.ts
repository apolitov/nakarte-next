import { describe, expect, it } from 'vitest';
import { loopShape, repeatShare } from './loops';
import { haversine } from './profile';

const km = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => haversine({ ...a, ele: null }, { ...b, ele: null }) / 1000;

describe('loops', () => {
  it('a shape starts and ends at the start, with the asked perimeter', () => {
    const s = { lng: -9.14, lat: 38.72 };
    for (const n of [2, 3]) {
      const p = loopShape(s, 24, 90, n);
      expect(p.length).toBe(n + 2);
      expect(p[0]).toEqual(s);
      expect(p.at(-1)).toEqual(s);
      const per = p.slice(1).reduce((t, q, i) => t + km(p[i], q), 0);
      expect(per).toBeGreaterThan(23.5);
      expect(per).toBeLessThan(24.5);
    }
  });
  it('the far side of the shape lies towards the bearing', () => {
    const s = { lng: -9.14, lat: 38.72 };
    const east = loopShape(s, 20, 90, 2);
    expect(Math.max(...east.map((p) => p.lng))).toBeGreaterThan(s.lng + 0.05);
    const north = loopShape(s, 20, 0, 3);
    expect(Math.max(...north.map((p) => p.lat))).toBeGreaterThan(s.lat + 0.04);
  });
  it('out and back repeats about half the line, a ring does not repeat', () => {
    const line = Array.from({ length: 51 }, (_, i) => ({ lng: -9.14 + i * 0.001, lat: 38.72 }));
    expect(repeatShare([...line, ...[...line].reverse()])).toBeGreaterThan(0.4);
    const ring = Array.from({ length: 200 }, (_, i) => ({ lng: -9.14 + 0.02 * Math.cos((i / 199) * 2 * Math.PI), lat: 38.72 + 0.015 * Math.sin((i / 199) * 2 * Math.PI) }));
    expect(repeatShare(ring)).toBeLessThan(0.05);
  });
});

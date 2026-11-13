import { describe, expect, it } from 'vitest';
import { photoGroups, simplify, type Photo } from './along';

describe('along the route', () => {
  it('simplifies a long line to at most the given number of points, keeping the ends', () => {
    // 2000 points on a wavy line, ~20 km
    const pts = Array.from({ length: 2000 }, (_, i) => ({ lng: -9 + i * 0.0001, lat: 38.7 + Math.sin(i / 30) * 0.002 }));
    const s = simplify(pts, 380);
    expect(s.length).toBeLessThanOrEqual(380);
    expect(s.length).toBeGreaterThan(20);
    expect(s[0]).toEqual([pts[0].lng, pts[0].lat]);
    expect(s.at(-1)).toEqual([pts.at(-1)!.lng, pts.at(-1)!.lat]);
  });

  it('groups photos by 2 km stretches', () => {
    const ph = (m: number) => ({ id: String(m), m }) as Photo;
    const g = photoGroups([ph(100), ph(1900), ph(2100), ph(9000)]);
    expect(g.map((x) => [x.from, x.items.length])).toEqual([[0, 2], [2000, 1], [8000, 1]]);
  });
});

import { describe, expect, it } from 'vitest';
import { profileForActivity, splitIndexes, trackPoints, transferSpans } from './trackRoute';
import { haversine } from './profile';

// a straight line north from Lisbon, a point every ~11 m
const line = (n: number, lat0 = 38.7, ele = 100) => Array.from({ length: n }, (_, i) => [-9.1, lat0 + i * 0.0001, ele + i]);

describe('track as a route', () => {
  it('picks the route type from the GPX activity', () => {
    expect(profileForActivity('hiking', 'nk-gravel')).toBe('nk-hike');
    expect(profileForActivity('Walk', 'nk-gravel')).toBe('nk-hike');
    expect(profileForActivity('mountain_biking', 'nk-road')).toBe('nk-mtb');
    expect(profileForActivity('cycling', 'nk-hike')).toBe('nk-road');
    expect(profileForActivity(undefined, 'nk-gravel')).toBe('nk-gravel');
    expect(profileForActivity('Morning Hike', 'nk-gravel')).toBe('nk-hike');
    expect(profileForActivity('Afternoon Ride', 'nk-hike')).toBe('nk-road');
  });

  it('joins the lines and drops points recorded in one place', () => {
    const stop = [[-9.1, 38.7, 100], [-9.1, 38.700001, 100], [-9.1, 38.700002, 100]];
    const pts = trackPoints([stop, line(10, 38.7001)]);
    expect(pts[0].ele).toBe(100);
    for (let i = 1; i < pts.length; i++) expect(haversine(pts[i - 1], pts[i])).toBeGreaterThanOrEqual(5);
    expect(pts.at(-1)!.lat).toBeCloseTo(38.7001 + 9 * 0.0001);
  });

  it('splits into legs of about the step, a short tail joins the last leg', () => {
    const pts = trackPoints([line(300)]); // ~3.3 km
    const idx = splitIndexes(pts, 1000);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(pts.length - 1);
    expect(idx.length).toBe(4); // 1 km, 1 km, 1.3 km
  });

  it('moves way tags of the routed leg onto nearby track points only', () => {
    const track = trackPoints([line(20)]);
    // routed: the first half along the track, then 100 m off to the east
    const routed = {
      points: track.map((p, i) => (i < 10 ? p : { ...p, lng: p.lng + 0.0013 })),
      spans: [{ from: 0, to: 19, highway: 'path', surface: 'gravel' }],
    };
    const spans = transferSpans(track, routed);
    // points 10 and 11 are still within 30 m of routed point 9 (11 and 22 m), the rest are not
    expect(spans).toEqual([{ from: 0, to: 11, highway: 'path', surface: 'gravel', tracktype: undefined }]);
  });
});

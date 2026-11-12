import { describe, expect, it } from 'vitest';
import { parseBrouter } from './brouter';
import { buildProfile, surfaceClass } from './profile';
import fixture from './__fixtures__/brouter-lisbon.json';

describe('BRouter answer', () => {
  const leg = parseBrouter(fixture);
  it('keeps every point with elevation', () => {
    expect(leg.points.length).toBe(fixture.features[0].geometry.coordinates.length);
    expect(leg.points.every((p) => p.ele != null)).toBe(true);
  });
  it('covers the whole leg with way spans', () => {
    expect(leg.spans[0].from).toBe(0);
    expect(leg.spans.at(-1)!.to).toBe(leg.points.length - 1);
    for (let i = 1; i < leg.spans.length; i++) expect(leg.spans[i].from).toBe(leg.spans[i - 1].to);
    expect(leg.spans.some((s) => s.surface === 'asphalt')).toBe(true);
  });
  it('profile length matches BRouter within 1%', () => {
    const p = buildProfile(leg.points, leg.spans);
    const brLen = Number(fixture.features[0].properties['track-length']);
    expect(Math.abs(p.length - brLen) / brLen).toBeLessThan(0.01);
    expect(p.grade.slice(1).every((g) => g == null || Math.abs(g) < 40)).toBe(true);
  });
});

describe('surface classes', () => {
  it('maps tags', () => {
    expect(surfaceClass({ surface: 'asphalt' })).toBe('paved');
    expect(surfaceClass({ surface: 'gravel' })).toBe('unpaved');
    expect(surfaceClass({ highway: 'track', tracktype: 'grade3' })).toBe('unpaved');
    expect(surfaceClass({ highway: 'path' })).toBe('path');
    expect(surfaceClass({})).toBe('unknown');
  });
});

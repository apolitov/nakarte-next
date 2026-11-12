import { describe, expect, it } from 'vitest';
import { lat3857, y3395 } from './yandex';
import { parseHash, formatHash } from './hash';

describe('yandex projection', () => {
  it('equator maps to the middle in both projections', () => {
    expect(lat3857(128, 256)).toBeCloseTo(0, 12);
    expect(y3395(0, 256)).toBeCloseTo(128, 9);
  });
  it('shift at 55.75N is ~20 km', () => {
    const lat = (55.75 * Math.PI) / 180;
    const size = 256 * 2 ** 18;
    const ySph = (size / 2) * (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI);
    const dyPx = y3395(lat, size) - ySph;
    const mPerPx = (40075016.686 * Math.cos(lat)) / size;
    expect(dyPx * mPerPx).toBeGreaterThan(18000);
    expect(dyPx * mPerPx).toBeLessThan(22000);
  });
  it('inverse of 3857 is consistent', () => {
    const size = 256 * 2 ** 10;
    const lat = lat3857(100000, size);
    const back = (size / 2) * (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI);
    expect(back).toBeCloseTo(100000, 6);
  });
});

describe('hash', () => {
  it('round-trips nakarte-style hash', () => {
    const s = parseHash('#m=13/55.75000/37.62000&l=O/Wc');
    expect(s).toEqual({ zoom: 13, lat: 55.75, lng: 37.62, layers: ['O', 'Wc'] });
    expect(formatHash({ zoom: 13, lat: 55.75, lng: 37.62, layers: ['O', 'Wc'] })).toBe('#m=13/55.75000/37.62000&l=O/Wc');
  });
  it('ignores garbage', () => {
    expect(parseHash('#m=99/1/2')).toEqual({});
  });
});

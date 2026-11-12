import { describe, expect, it, vi } from 'vitest';
import { fetchLeg, packLeg, seedLeg, unpackLeg, type Leg } from './brouter';

describe('stored legs', () => {
  const leg: Leg = { points: [{ lng: -9.1234567, lat: 38.7654321, ele: 12.345 }, { lng: -9.2, lat: 38.8, ele: null }], spans: [{ from: 0, to: 1, surface: 'gravel' }] };

  it('packs to 6 and 1 decimals and back', () => {
    const back = unpackLeg(JSON.parse(JSON.stringify(packLeg(leg))));
    expect(back.points[0]).toEqual({ lng: -9.123457, lat: 38.765432, ele: 12.3 });
    expect(back.points[1].ele).toBeNull();
    expect(back.spans).toEqual(leg.spans);
  });

  it('a seeded leg is answered without the router', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const a = { lng: -9.1, lat: 38.7 }, b = { lng: -9.2, lat: 38.8 };
    seedLeg(a, b, 'nk-gravel', { nk_surface: 1 }, leg);
    expect(await fetchLeg(a, b, 'nk-gravel', { nk_surface: 1 })).toBe(leg);
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
});

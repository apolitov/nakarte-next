import { describe, expect, it } from 'vitest';
import { optionsToParams, paramsToOptions, normalizeProfile, DEFAULT_OPTIONS, type RouteOptions } from './brouter';

describe('route options', () => {
  it('round-trips through profile parameters', () => {
    const all = { steps: true, ferry: true, busy: true, unpaved: true, paths: true };
    const base = { ...DEFAULT_OPTIONS, allow: all };
    const cases: RouteOptions[] = [
      { ...base, cycleways: false },
      { ...base, surface: 1, climbs: 'less' },
      { ...base, surface: -1, climbs: 'any', cycleways: false },
      { ...base, surface: -2 },
      { ...base, climbs: 'avoid' },
      { ...base, heat: true, climbs: 'seek' },
      { ...base, climbs: 'seek', surface: 1 },
      { ...base, surface: 2, climbs: 'less' },
      { ...base, surface: -1 },
      { ...base, maxGrade: 8 },
      { ...base, bigRoads: 'avoid' },
      { ...base, bigRoads: 'less', surface: -2, heat: true },
      { ...base, bigRoads: 'any' },
      { ...base, cobbles: true, heat: true },
      { ...base, sac: 4, trails: true, nature: true, quiet: true },
      { ...base, sac: 6, quiet: true },
      { ...base, allow: { ...all, ferry: false, unpaved: false } },
    ];
    for (const o of cases) expect(paramsToOptions(optionsToParams(o))).toEqual(o);
  });
  it('sends defaults as nothing and restrictions as nk_allow_*=0', () => {
    expect(optionsToParams(DEFAULT_OPTIONS)).toEqual({});
    expect(optionsToParams({ ...DEFAULT_OPTIONS, sac: 4 })).toEqual({ SAC_scale_limit: 4 });
    expect(optionsToParams({ ...DEFAULT_OPTIONS, allow: { ...DEFAULT_OPTIONS.allow, steps: false } })).toEqual({ nk_allow_steps: 0 });
  });
  it('opens routes of the first version', () => {
    expect(normalizeProfile('trekking')).toBe('nk-gravel');
    expect(normalizeProfile('nk-gravel')).toBe('nk-gravel');
    expect(normalizeProfile('whatever')).toBe('nk-gravel');
  });
});

describe('seek climbs', () => {
  it('counts ascent without DEM wiggles under 3 m', async () => {
    const { legAscent } = await import('./brouter');
    const pts = [100, 101, 100, 102, 110, 108, 120, 119, 121].map((ele, i) => ({ lng: i * 0.001, lat: 0, ele }));
    expect(legAscent(pts)).toBe(20);
  });
});

describe('stored legs', () => {
  it('are reused with seek climbs and the heatmap, without asking the router', async () => {
    const { seedLeg, fetchLeg } = await import('./brouter');
    const a = { lng: -9.1, lat: 38.8 }, b = { lng: -9.11, lat: 38.81 };
    const leg = { points: [{ ...a, ele: 1 }, { ...b, ele: 2 }], spans: [] };
    const params = { nk_heat: 1, nk_seek: 1, nk_surface: -1 };
    const orig = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('router asked'))) as typeof fetch;
    try {
      seedLeg(a, b, 'nk-gravel', params, leg);
      await expect(fetchLeg(a, b, 'nk-gravel', params)).resolves.toBe(leg);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

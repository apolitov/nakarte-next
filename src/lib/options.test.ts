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
      { ...base, maxGrade: 8 },
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

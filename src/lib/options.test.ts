import { describe, expect, it } from 'vitest';
import { optionsToParams, paramsToOptions, normalizeProfile } from './brouter';

describe('route options', () => {
  it('round-trips through profile parameters', () => {
    for (const o of [
      { surface: 0, climbs: 'normal', maxGrade: 0, cycleways: false },
      { surface: 1, climbs: 'less', maxGrade: 0, cycleways: true },
      { surface: -1, climbs: 'any', maxGrade: 0, cycleways: false },
      { surface: 0, climbs: 'normal', maxGrade: 8, cycleways: true },
    ] as const) {
      expect(paramsToOptions(optionsToParams(o))).toEqual(o);
    }
  });
  it('opens routes of the first version', () => {
    expect(normalizeProfile('trekking')).toBe('nk-gravel');
    expect(normalizeProfile('nk-gravel')).toBe('nk-gravel');
    expect(normalizeProfile('whatever')).toBe('nk-gravel');
  });
});

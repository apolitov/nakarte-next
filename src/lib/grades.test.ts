import { describe, expect, it } from 'vitest';
import { gradeClasses, gradeColor } from './profile';

describe('grade scales', () => {
  it('bikes: fine below 10%, coarse above, black beyond 18%', () => {
    expect(gradeClasses('nk-road').map((c) => c.min)).toEqual([-Infinity, -10, -1, 1, 3, 5, 7, 10, 14, 18]);
    expect(gradeClasses('nk-gravel')).toBe(gradeClasses('nk-road'));
    expect(gradeClasses('nk-mtb')).toBe(gradeClasses('nk-road'));
    expect(gradeColor(2, 'nk-road')).not.toBe(gradeColor(0, 'nk-road'));
    expect(gradeColor(25, 'nk-gravel')).toBe('#141414');
    expect(gradeClasses('nk-road').at(-1)!.title).toBe('↑ >18%');
  });
  it('walking keeps its wider scale', () => {
    // 6% is a climb on a bike, flat on foot
    expect(gradeColor(6, 'nk-hike')).toBe(gradeColor(0, 'nk-hike'));
    expect(gradeColor(6, 'nk-road')).not.toBe(gradeColor(0, 'nk-road'));
    expect(gradeClasses('nk-hike').at(-1)!.title).toBe('↑ >45%');
  });
  it('falls back to the bike scale', () => {
    expect(gradeClasses('straight')).toBe(gradeClasses('nk-road'));
  });
});

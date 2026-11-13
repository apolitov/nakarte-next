import { describe, expect, it } from 'vitest';
import { gradeClasses, gradeColor } from './profile';

describe('grade scales per route type', () => {
  it('keeps the road scale', () => {
    expect(gradeClasses('nk-road').map((c) => c.min)).toEqual([-Infinity, -8, -3, 3, 6, 10, 15]);
  });
  it('moves the boundaries for walking and mountain biking', () => {
    const road = gradeClasses('nk-road');
    // 6% is a climb on a road bike, flat on foot
    expect(gradeColor(6, 'nk-road')).toBe(road[4].color);
    expect(gradeColor(6, 'nk-hike')).toBe(road[2].color);
    // 25% on a mountain path: "steep" (20-30), not the darkest
    expect(gradeColor(25, 'nk-hike')).toBe(road[4].color);
    expect(gradeColor(25, 'nk-mtb')).toBe(road[6].color);
    expect(gradeColor(-20, 'nk-hike')).toBe(road[1].color);
    expect(gradeClasses('nk-hike')[6].title).toBe('↑ >45%');
  });
  it('falls back to the road scale', () => {
    expect(gradeClasses('straight')).toBe(gradeClasses('nk-road'));
  });
});

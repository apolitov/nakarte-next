import { describe, expect, it } from 'vitest';
import { buildProfile, gradeClasses, gradeColor, bikeGradeColor, flatLimit } from './profile';

describe('grade colours', () => {
  it('bikes: a gradient in 1% steps, black from 18%', () => {
    expect(gradeColor(0, 'nk-road')).toBe('#4fae63');
    expect(gradeColor(18, 'nk-gravel')).toBe('#141414');
    expect(gradeColor(30, 'nk-mtb')).toBe('#141414');
    expect(gradeColor(-30, 'nk-road')).toBe('#08519c');
    // every whole percent differs from its neighbour
    for (let g = -11; g < 18; g++) expect(bikeGradeColor(g)).not.toBe(bikeGradeColor(g + 1));
    // the same colour within a step
    expect(gradeColor(5.2, 'nk-road')).toBe(gradeColor(4.8, 'nk-road'));
    expect(flatLimit('nk-road')).toBe(1);
  });
  it('walking keeps its wider classes', () => {
    expect(gradeColor(6, 'nk-hike')).toBe(gradeColor(0, 'nk-hike'));
    expect(gradeClasses('nk-hike').at(-1)!.title).toBe('↑ >45%');
    expect(gradeClasses('nk-road').at(-1)!.title).toBe('↑ >18%');
    expect(flatLimit('nk-hike')).toBe(10);
  });
});

describe('ferry', () => {
  const pts = Array.from({ length: 21 }, (_, i) => ({ lng: -9.1 + i * 0.002, lat: 38.7, ele: i < 5 || i > 15 ? 20 + i : (i % 2) * 8 }));
  it('a route=ferry span is a ferry with no grade and no climbing', () => {
    const p = buildProfile(pts, [{ from: 0, to: 4, highway: 'residential' }, { from: 4, to: 16, route: 'ferry' }, { from: 16, to: 20, highway: 'residential' }]);
    expect(p.surface[10]).toBe('ferry');
    expect(p.grade[10]).toBeNull();
    expect(p.ascent).toBeLessThan(10);
  });
  it('an old stored span without any tags and longer than 300 m reads as a ferry', () => {
    const p = buildProfile(pts, [{ from: 0, to: 4, highway: 'residential' }, { from: 4, to: 16 }, { from: 16, to: 20, highway: 'residential' }]);
    expect(p.surface[10]).toBe('ferry');
  });
});

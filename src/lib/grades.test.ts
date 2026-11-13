import { describe, expect, it } from 'vitest';
import { gradeClasses, gradeColor, bikeGradeColor, flatLimit } from './profile';

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

import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { encodeCourse } from './fit';

describe('FIT course', () => {
  it('decodes back with track, distance and course points', () => {
    const points = Array.from({ length: 50 }, (_, i) => ({ lng: -9.4 + i * 0.001, lat: 38.79 + i * 0.0005, ele: 100 + i }));
    const bytes = encodeCourse({
      name: 'Синтра гравел длинное имя',
      sport: 'cycling',
      points,
      checkpoints: [{ lng: -9.375, lat: 38.8025, kind: 'water', name: 'Родник' }],
    });
    const d = new Decoder(Stream.fromByteArray(bytes));
    expect(d.isFIT()).toBe(true);
    expect(d.checkIntegrity()).toBe(true);
    const { messages: m, errors } = d.read();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = m as any;
    expect(errors).toEqual([]);
    expect(messages.fileIdMesgs[0].type).toBe('course');
    expect(messages.courseMesgs[0].name).toBe('Синтра гравел д');
    expect(messages.recordMesgs).toHaveLength(50);
    expect(messages.recordMesgs[10].altitude).toBeCloseTo(110, 0);
    expect(messages.recordMesgs[0].positionLat / 2 ** 31 * 180).toBeCloseTo(38.79, 5);
    expect(messages.coursePointMesgs[0].type).toBe('water');
    expect(messages.lapMesgs[0].totalDistance).toBeGreaterThan(4000);
  });
});

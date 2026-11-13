// Rough riding/walking time. Bikes: average speed per route type plus 1 min per
// 10 m of ascent. Walking: the hiking-time rule of DIN 33466 (German and Austrian
// alpine clubs, trail signs): 4 km/h on the flat, 300 m up or 500 m down per hour;
// the larger of horizontal and vertical time plus half of the smaller. Long steep
// descents take real time, which a speed-plus-climb rule misses. Breaks are not included.
import { t } from './i18n';

export const AVG_SPEED: Record<string, number> = {
  'nk-road': 25,
  'nk-gravel': 18,
  'nk-mtb': 12,
  'nk-hike': 4,
};

export function estimateMinutes(lengthM: number, ascentM: number, profile: string, descentM = 0): number {
  if (profile === 'nk-hike') {
    const h = lengthM / 1000 / 4;
    const v = ascentM / 300 + descentM / 500;
    return (Math.max(h, v) + Math.min(h, v) / 2) * 60;
  }
  const v = AVG_SPEED[profile] ?? AVG_SPEED['nk-gravel'];
  return (lengthM / 1000 / v) * 60 + ascentM / 10;
}

export function formatDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return t('time.min', { m });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? t('time.hmin', { h, m: String(r).padStart(2, '0') }) : t('time.h', { h });
}

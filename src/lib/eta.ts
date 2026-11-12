// Rough riding/walking time: average speed per route type plus a climbing
// allowance of 1 min per 10 m of ascent (for walking that is Naismith's rule,
// about 1 h per 600 m).
import { t } from './i18n';

export const AVG_SPEED: Record<string, number> = {
  'nk-road': 25,
  'nk-gravel': 18,
  'nk-mtb': 12,
  'nk-hike': 4.5,
};

export function estimateMinutes(lengthM: number, ascentM: number, profile: string): number {
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

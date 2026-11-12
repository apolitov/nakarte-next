// Checkpoint kinds: title, emoji (for native selects), GPX symbol and a line
// icon (SVG path in a 24×24 box) for markers, the timeline and the profile.
import { t } from './i18n';
export const CHECKPOINT_KINDS = [
  { id: 'water', title: t('cp.water'), icon: '💧', gpx: 'Drinking Water', path: 'M12 2.8c-3.4 4.2-6 7.5-6 10.4a6 6 0 0 0 12 0c0-2.9-2.6-6.2-6-10.4z' },
  { id: 'food', title: t('cp.food'), icon: '🍴', gpx: 'Restaurant', path: 'M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 9.5h1.5a2.5 2.5 0 0 1 0 5H16M6 21h9' },
  { id: 'shop', title: t('cp.shop'), icon: '🛒', gpx: 'Shopping Center', path: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20h.01M17 20h.01' },
  { id: 'camp', title: t('cp.camp'), icon: '⛺', gpx: 'Campground', path: 'M3 20L12 4l9 16zM12 20l-3-6h6z' },
  { id: 'view', title: t('cp.view'), icon: '📷', gpx: 'Scenic Area', path: 'M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0z' },
  { id: 'danger', title: t('cp.danger'), icon: '⚠️', gpx: 'Danger Area', path: 'M12 3L2 20h20zM12 10v4M12 17h.01' },
  { id: 'summit', title: t('cp.summit'), icon: '⛰️', gpx: 'Summit', path: 'M2 20L9 8l4 6 3-4 6 10z' },
  { id: 'generic', title: t('cp.generic'), icon: '📍', gpx: 'Flag, Blue', path: 'M5 21V4M5 4h11l-2 4 2 4H5' },
] as const;

export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export const kindOf = (k: string): CheckpointKind => CHECKPOINT_KINDS.find((x) => x.id === k) ?? CHECKPOINT_KINDS.at(-1)!;

/** Inline SVG markup of a kind's icon. */
export function kindSvg(k: string, size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${kindOf(k).path}"/></svg>`;
}

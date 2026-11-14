// Route settings as one sentence: "Ride gravel and tarmac, fewer climbs, on usual roads,
// preferring cycleways, taking popular roads." Each word is a setting with its choices (the same
// steps as its slider in All settings); rare settings (cobbles, a steepness limit, things the
// route may not use) join the sentence only when they are changed, and open All settings.
import { t } from './i18n';
import { ALLOW_FOR, ALLOW_KEYS, type AllowKey, type ProfileId, type RouteOptions } from './brouter';

export interface Choice {
  label: string;
  patch: Partial<RouteOptions>;
  on: (o: RouteOptions) => boolean;
  /** the route type's default */
  def?: boolean;
}
export interface Word {
  id: string;
  /** text before the word */
  before: string;
  label: string;
  /** at the route type's default: shown grey */
  def: boolean;
  /** choices to pick from; none: the word opens All settings */
  choices?: Choice[];
}

const SURFACE_DEFAULT: Record<string, string> = {
  'nk-road': 'tarmac first',
  'nk-gravel': 'gravel and tarmac',
  'nk-mtb': 'tracks and trails',
  'nk-hike': 'any paths',
};

const pick = (o: RouteOptions, cs: Choice[]) => cs.find((c) => c.on(o)) ?? cs.find((c) => c.def)!;
function word(id: string, before: string, o: RouteOptions, choices: Choice[]): Word {
  const c = pick(o, choices);
  return { id, before, label: c.label, def: !!c.def, choices };
}

export function sentence(o: RouteOptions, profile: ProfileId): { start: string; words: Word[] } {
  const bike = profile === 'nk-road' || profile === 'nk-gravel';
  const hike = profile === 'nk-hike';
  const words: Word[] = [];
  words.push(
    word('surface', '', o, [
      { label: t('ss.onlyAsphalt'), patch: { surface: -2 }, on: (x) => x.surface === -2 },
      { label: t('ss.mostlyAsphalt'), patch: { surface: -1 }, on: (x) => x.surface === -1 },
      { label: SURFACE_DEFAULT[profile] ?? t('ss.usualSurface'), patch: { surface: 0 }, on: (x) => x.surface === 0, def: true },
      { label: t('ss.mostlyDirt'), patch: { surface: 1 }, on: (x) => x.surface === 1 },
      { label: t('ss.trails'), patch: { surface: 2 }, on: (x) => x.surface === 2 },
    ]),
  );
  words.push(
    word('climbs', ', ', o, [
      { label: t('ss.flat'), patch: { climbs: 'avoid', maxGrade: 0 }, on: (x) => x.climbs === 'avoid' },
      { label: t('ss.fewerClimbs'), patch: { climbs: 'less', maxGrade: 0 }, on: (x) => x.climbs === 'less' },
      { label: t('ss.usualClimbs'), patch: { climbs: 'normal', maxGrade: 0 }, on: (x) => x.climbs === 'normal', def: true },
      { label: t('ss.climbsWelcome'), patch: { climbs: 'any', maxGrade: 0 }, on: (x) => x.climbs === 'any' },
      { label: t('ss.seekClimbs'), patch: { climbs: 'seek', maxGrade: 0 }, on: (x) => x.climbs === 'seek' },
    ]),
  );
  if (!hike)
    words.push(
      word('big', t('ss.onRoads'), o, [
        { label: t('ss.quietOnly'), patch: { bigRoads: 'avoid' }, on: (x) => x.bigRoads === 'avoid' },
        { label: t('ss.fewerBig'), patch: { bigRoads: 'less' }, on: (x) => x.bigRoads === 'less' },
        { label: t('ss.usualRoads'), patch: { bigRoads: 'normal' }, on: (x) => x.bigRoads === 'normal', def: true },
        { label: t('ss.bigOk'), patch: { bigRoads: 'any' }, on: (x) => x.bigRoads === 'any' },
      ]),
    );
  if (bike) {
    words.push(
      word('cycleways', ', ', o, [
        { label: t('ss.ignoreCycle'), patch: { cycleways: false, cycleStrict: false }, on: (x) => !x.cycleways },
        { label: t('ss.preferCycle'), patch: { cycleways: true, cycleStrict: false }, on: (x) => x.cycleways && !x.cycleStrict, def: true },
        { label: t('ss.stickCycle'), patch: { cycleways: true, cycleStrict: true }, on: (x) => x.cycleways && x.cycleStrict },
      ]),
    );
    words.push(
      word('heat', ', ', o, [
        { label: t('ss.routerPick'), patch: { heat: false }, on: (x) => !x.heat, def: true },
        { label: t('ss.popular'), patch: { heat: true }, on: (x) => x.heat },
      ]),
    );
  }
  if (hike)
    words.push(
      word('sac', t('ss.pathsUpTo'), o, [2, 3, 4, 6].map((v) => ({ label: v === 6 ? 'T5–T6' : `T${v}`, patch: { sac: v }, on: (x: RouteOptions) => x.sac === v, def: v === 3 }))),
    );
  // the rare ones, only when changed: they open All settings
  if (o.maxGrade) words.push({ id: 'steep', before: ', ', label: t('ss.upTo', { g: o.maxGrade }), def: false });
  if (o.cobbles && !hike) words.push({ id: 'cobbles', before: ', ', label: t('ss.noCobbles'), def: false });
  if (hike && o.trails) words.push({ id: 'trails', before: ', ', label: t('set.sumTrails'), def: false });
  if (hike && o.nature) words.push({ id: 'nature', before: ', ', label: t('set.sumNature'), def: false });
  if (hike && o.quiet) words.push({ id: 'quiet', before: ', ', label: t('set.sumQuiet'), def: false });
  const never = ALLOW_KEYS.filter((k: AllowKey) => o.allow?.[k] === false && ALLOW_FOR[k].includes(profile));
  if (never.length) words.push({ id: 'allow', before: ', ', label: t('set.sumNever', { list: never.map((k) => t(`ss.never_${k}` as Parameters<typeof t>[0])).join(', ') }), def: false });
  return { start: hike ? t('ss.walk') : t('ss.ride'), words };
}

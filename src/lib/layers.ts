import { googleAvailable, googleTileUrl, type GoogleMapType } from './google';
import { t } from './i18n';

export interface LayerDef {
  /** Short stable id, used in the URL. */
  id: string;
  title: string;
  kind: 'base' | 'overlay';
  group: string;
  /** Tile URL templates, or a function that resolves them (sessions, keys). */
  tiles: string[] | (() => Promise<string[]>);
  attribution: string;
  maxzoom?: number;
  /** Pixel size of the served tiles; 512 for retina sources. */
  tileSize?: number;
  /** Drawn by its own module instead of raster tiles. */
  vector?: 'passes';
  /** Hidden when its key is missing. */
  available?: boolean;
  /** Overlays are grouped by activity in the overlays menu. */
  activity?: 'bike' | 'hike' | 'all';
}

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const MAPY_KEY = import.meta.env.VITE_MAPY_KEY;

const google = (id: string, title: string, type: GoogleMapType): LayerDef => ({
  id,
  title,
  kind: 'base',
  group: 'Google',
  tiles: async () => [await googleTileUrl(type)],
  attribution: 'Map data © Google',
  maxzoom: 22,
  available: googleAvailable,
});

const mapy = (id: string, title: string, style: string): LayerDef => ({
  id,
  title,
  kind: 'base',
  group: 'mapy.com',
  // the winter map has no @2x (retina) tiles: 404 for every one of them
  tiles: [`https://api.mapy.com/v1/maptiles/${style}/${style === 'winter' ? '256' : '256@2x'}/{z}/{x}/{y}?apikey=${MAPY_KEY}`],
  tileSize: 256,
  attribution: '© <a href="https://mapy.com">Seznam.cz</a>, ' + OSM_ATTR,
  maxzoom: 19,
  available: Boolean(MAPY_KEY),
});

const ALL: LayerDef[] = [
  {
    id: 'O',
    title: 'OpenStreetMap',
    kind: 'base',
    group: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: OSM_ATTR,
    maxzoom: 19,
  },
  {
    id: 'Co',
    title: 'CyclOSM',
    kind: 'base',
    group: 'OpenStreetMap',
    tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`),
    attribution: '<a href="https://www.cyclosm.org">CyclOSM</a>, ' + OSM_ATTR,
    maxzoom: 20,
  },
  {
    id: 'Otm',
    title: 'OpenTopoMap',
    kind: 'base',
    group: 'OpenStreetMap',
    tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
    attribution: '<a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), ' + OSM_ATTR,
    maxzoom: 17,
  },
  mapy('Mo', t('layer.mapyOutdoor'), 'outdoor'),
  mapy('Mb', t('layer.mapyBasic'), 'basic'),
  mapy('Mw', t('layer.mapyWinter'), 'winter'),
  google('G', t('layer.googleMap'), 'roadmap'),
  google('Gs', t('layer.googleSat'), 'satellite'),
  google('Gh', t('layer.googleHybrid'), 'hybrid'),
  google('Gt', t('layer.googleTerrain'), 'terrain'),
  {
    id: 'E',
    title: t('layer.esriSat'),
    kind: 'base',
    group: t('layerGroup.satellite'),
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxzoom: 19,
  },
  {
    id: 'Bs',
    title: t('layer.bingSat'),
    kind: 'base',
    group: t('layerGroup.satellite'),
    tiles: [0, 1, 2, 3].map((s) => `https://ecn.t${s}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=14000`),
    attribution: '© Microsoft',
    maxzoom: 19,
  },
  {
    id: 'Bm',
    title: t('layer.bingMap'),
    kind: 'base',
    group: 'Bing',
    tiles: [0, 1, 2, 3].map(
      (s) => `https://ecn.t${s}.tiles.virtualearth.net/tiles/r{quadkey}?g=14000&mkt=ru-RU&shading=hill`,
    ),
    attribution: '© Microsoft',
    maxzoom: 19,
  },
  {
    id: 'Y',
    title: t('layer.yandexMap'),
    kind: 'base',
    group: t('layerGroup.yandex'),
    tiles: ['yandex://map/{z}/{x}/{y}'],
    attribution: t('layer.yandexAttr'),
    maxzoom: 19,
  },
  {
    id: 'Ys',
    title: t('layer.yandexSat'),
    kind: 'base',
    group: t('layerGroup.yandex'),
    tiles: ['yandex://sat/{z}/{x}/{y}'],
    attribution: t('layer.yandexAttr'),
    maxzoom: 19,
  },
  {
    id: 'Wc',
    title: t('layer.cycleRoutes'),
    kind: 'overlay',
    group: t('layerGroup.routes'),
    tiles: ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png'],
    attribution: '<a href="https://cycling.waymarkedtrails.org">Waymarked Trails</a>',
    maxzoom: 18,
    activity: 'bike',
  },
  {
    id: 'Wh',
    title: t('layer.hikeRoutes'),
    kind: 'overlay',
    group: t('layerGroup.routes'),
    tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],
    attribution: '<a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>',
    maxzoom: 18,
    activity: 'hike',
  },
  {
    // Ride with GPS global heatmap: public density tiles (yellow to red), cycling-heavy
    id: 'Hr',
    title: t('layer.rwgpsHeat'),
    kind: 'overlay',
    group: t('layerGroup.routes'),
    tiles: ['https://heatmap.ridewithgps.com/normalized/{z}/{x}/{y}.png'],
    attribution: 'Heatmap © <a href="https://ridewithgps.com">Ride with GPS</a>',
    maxzoom: 18,
    activity: 'bike',
  },
  {
    // public GPS traces uploaded to OpenStreetMap, drawn as a density map
    id: 'H',
    title: t('layer.gpsHeat'),
    kind: 'overlay',
    group: t('layerGroup.routes'),
    tiles: ['gpsheat://{z}/{x}/{y}'],
    attribution: 'GPS traces © <a href="https://www.openstreetmap.org/traces">OpenStreetMap contributors</a>',
    maxzoom: 20,
    activity: 'all',
  },
  {
    // vector layer from public/data/passes.geojson, drawn by lib/passes.ts
    id: 'P',
    title: t('layer.passes'),
    kind: 'overlay',
    group: t('layerGroup.routes'),
    tiles: [],
    attribution: '',
    vector: 'passes',
    activity: 'hike',
  },
];

export const LAYERS = ALL.filter((l) => l.available !== false);

export const DEFAULT_BASE = 'Co';

/** Base map that suits the activity: CyclOSM for bikes, OpenTopoMap for hiking. */
export const baseForProfile = (profile: string) => (profile === 'nk-hike' ? 'Otm' : 'Co');

export function layerById(id: string) {
  return LAYERS.find((l) => l.id === id);
}

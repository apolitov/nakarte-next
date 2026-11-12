import { googleAvailable, googleTileUrl, type GoogleMapType } from './google';

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
  /** Hidden when its key is missing. */
  available?: boolean;
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
  tiles: [`https://api.mapy.com/v1/maptiles/${style}/256@2x/{z}/{x}/{y}?apikey=${MAPY_KEY}`],
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
  mapy('Mo', 'mapy.com туристическая', 'outdoor'),
  mapy('Mb', 'mapy.com базовая', 'basic'),
  mapy('Mw', 'mapy.com зимняя', 'winter'),
  google('G', 'Google карта', 'roadmap'),
  google('Gs', 'Google спутник', 'satellite'),
  google('Gh', 'Google гибрид', 'hybrid'),
  google('Gt', 'Google рельеф', 'terrain'),
  {
    id: 'E',
    title: 'ESRI спутник',
    kind: 'base',
    group: 'Спутник',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxzoom: 19,
  },
  {
    id: 'Bs',
    title: 'Bing спутник',
    kind: 'base',
    group: 'Спутник',
    tiles: [0, 1, 2, 3].map((s) => `https://ecn.t${s}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=14000`),
    attribution: '© Microsoft',
    maxzoom: 19,
  },
  {
    id: 'Bm',
    title: 'Bing карта',
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
    title: 'Яндекс карта',
    kind: 'base',
    group: 'Яндекс',
    tiles: ['yandex://map/{z}/{x}/{y}'],
    attribution: '© Яндекс',
    maxzoom: 19,
  },
  {
    id: 'Ys',
    title: 'Яндекс спутник',
    kind: 'base',
    group: 'Яндекс',
    tiles: ['yandex://sat/{z}/{x}/{y}'],
    attribution: '© Яндекс',
    maxzoom: 19,
  },
  {
    id: 'Wc',
    title: 'Велосипедные маршруты',
    kind: 'overlay',
    group: 'Маршруты',
    tiles: ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png'],
    attribution: '<a href="https://cycling.waymarkedtrails.org">Waymarked Trails</a>',
    maxzoom: 18,
  },
  {
    id: 'Wh',
    title: 'Пешие маршруты',
    kind: 'overlay',
    group: 'Маршруты',
    tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],
    attribution: '<a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>',
    maxzoom: 18,
  },
];

export const LAYERS = ALL.filter((l) => l.available !== false);

export const DEFAULT_BASE = 'O';

export function layerById(id: string) {
  return LAYERS.find((l) => l.id === id);
}

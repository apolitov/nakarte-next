// Mountain passes: OpenStreetMap + the FSTR catalogue (tools/passes/build.py).
// Loaded lazily the first time the layer is switched on.
import * as maplibregl from 'maplibre-gl';

const URL_DATA = `${import.meta.env.BASE_URL}data/passes.geojson`;

/** Colour per category, from easy (green) to hard (black), as in tourist catalogues. */
export const PASS_CATEGORIES: { id: string; title: string; color: string; text: string }[] = [
  {
    id: 'нк',
    title: 'NC',
    color: '#8a8a85',
    text: 'Non-graded. Usually a trail or a gentle grassy slope, no snow or ice. No equipment needed.',
  },
  {
    id: '1А',
    title: '1A',
    color: '#2e9d5b',
    text: 'Easy. Scree, grassy slopes, small snowfields of moderate steepness. Mountain hiking experience; sometimes an ice axe for self-belay.',
  },
  {
    id: '1Б',
    title: '1B',
    color: '#c9a227',
    text: 'Moderate. Steep scree and snow slopes, short rock sections. Ice axe self-belay, a rope in places.',
  },
  {
    id: '2А',
    title: '2A',
    color: '#e07b24',
    text: 'Intermediate. Snow, ice and rock sections, covered glaciers. Crampons, ropes, belaying and roped travel.',
  },
  {
    id: '2Б',
    title: '2B',
    color: '#d1242f',
    text: 'Difficult. Steep ice and rock, long rope work, ice and rock anchors. Mountaineering skills required.',
  },
  {
    id: '3А',
    title: '3A',
    color: '#7f1d2e',
    text: 'Very difficult. High altitude, steep ice and rock walls, hours of rope work.',
  },
  {
    id: '3Б',
    title: '3B',
    color: '#141414',
    text: 'Hardest passes. Technical climbing, high altitude, rockfall and avalanche danger.',
  },
];

/** FSTR terrain codes (Russian abbreviations), e.g. «сн-лд-ск-ос» → «snow, ice, rock, scree». */
const KIND_PART: Record<string, string> = {
  сн: 'snow',
  лд: 'ice',
  лед: 'ice',
  ск: 'rock',
  ос: 'scree',
  тр: 'grass',
  тропа: 'trail',
  дорога: 'road',
  гр: 'dirt',
};

function kindText(k?: string) {
  if (!k) return null;
  const parts = k.toLowerCase().split(/[-\s/,]+/).filter(Boolean);
  const known = parts.map((x) => KIND_PART[x]);
  return known.every(Boolean) ? [...new Set(known)].join(', ') : k;
}

const colorExpr = [
  'match',
  ['get', 'c'],
  ...PASS_CATEGORIES.flatMap((c) => [c.id, c.color]),
  '#8a8a85',
] as unknown as maplibregl.ExpressionSpecification;

let loaded: Promise<void> | null = null;

/** Shows passes; categorised ones from zoom 7, named from 10, all from 12. */
export function showPasses(map: maplibregl.Map, beforeId?: string, onHelp?: () => void) {
  loaded ??= (async () => {
    map.addSource('passes', { type: 'geojson', data: URL_DATA, attribution: 'Passes: © OpenStreetMap, FSTR catalogue' });
    const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
    map.addLayer(
      {
        id: 'passes-pt',
        type: 'circle',
        source: 'passes',
        filter: ['any', ['==', ['get', 'rk'], 0], ['all', ['==', ['get', 'rk'], 1], ['>=', ['zoom'], 10]], ['>=', ['zoom'], 12]],
        minzoom: 7,
        paint: {
          'circle-color': colorExpr,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 11, 5, 14, 7],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'passes-label',
        type: 'symbol',
        source: 'passes',
        minzoom: 11,
        filter: ['<=', ['get', 'rk'], 1],
        layout: {
          'text-field': [
            'concat',
            ['coalesce', ['get', 'n'], ''],
            ['case', ['has', 'c'], ['concat', ' ', ['match', ['get', 'c'], ...PASS_CATEGORIES.flatMap((c) => [c.id, c.title]), '']], ''],
          ] as unknown as maplibregl.ExpressionSpecification,
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': '#141414', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      },
      before,
    );
    map.on('mouseenter', 'passes-pt', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'passes-pt', () => (map.getCanvas().style.cursor = ''));
    map.on('click', 'passes-pt', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      e.preventDefault();
      const el = passCard(f.properties as Record<string, unknown>, onHelp);
      new maplibregl.Popup({ maxWidth: '320px', className: 'pass-popup' })
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setDOMContent(el)
        .addTo(map);
    });
  })();
  return loaded.then(() => {
    for (const id of ['passes-pt', 'passes-label']) map.setLayoutProperty(id, 'visibility', 'visible');
  });
}

export function hidePasses(map: maplibregl.Map) {
  for (const id of ['passes-pt', 'passes-label']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
}

/** Card with everything we know about a pass. Text only, never HTML from the data. */
function passCard(p: Record<string, unknown>, onHelp?: () => void): HTMLElement {
  const s = (k: string) => (p[k] == null ? '' : String(p[k]));
  const el = document.createElement('div');
  el.className = 'pass-card';
  const cat = PASS_CATEGORIES.find((c) => c.id === s('c'));
  const h = document.createElement('div');
  h.className = 'pc-head';
  const badge = document.createElement('span');
  badge.className = 'pc-cat';
  badge.textContent = cat ? cat.title : 'no grade';
  if (cat) {
    badge.style.background = cat.color;
    // dark text on the light grades (yellow, orange) for contrast
    badge.style.color = ['1Б', '2А'].includes(cat.id) ? '#141414' : '#ffffff';
  }
  const title = document.createElement('b');
  title.textContent = s('n') || 'Unnamed pass';
  h.append(title, badge);
  el.append(h);
  const line = (label: string, value: string | null) => {
    if (!value) return;
    const d = document.createElement('div');
    d.className = 'pc-row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.textContent = value;
    d.append(l, v);
    el.append(d);
  };
  line('Elevation', s('e') ? `${s('e')} m` : null);
  line('Other names', [s('a'), s('nl'), s('ne')].filter(Boolean).join(', ') || null);
  line('Terrain', kindText(s('k')));
  line('Connects', s('cn') || null);
  line('Area', s('r') || null);
  line('First crossing', s('f') || null);
  line('Notes', s('i') || null);
  if (s('ap')) line('Position', 'approximate');
  const src = document.createElement('div');
  src.className = 'pc-src';
  const parts: string[] = [];
  if (s('src').includes('fstr')) parts.push('FSTR catalogue');
  if (s('o')) parts.push('OpenStreetMap');
  src.textContent = `Source: ${parts.join(' and ')}`;
  if (s('o')) {
    const a = document.createElement('a');
    a.href = `https://www.openstreetmap.org/node/${s('o')}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = ' · on OSM';
    src.append(a);
  }
  el.append(src);
  if (cat) {
    const d = document.createElement('p');
    d.className = 'pc-help';
    d.textContent = cat.text;
    el.append(d);
  }
  if (onHelp) {
    const b = document.createElement('button');
    b.className = 'pc-more';
    b.textContent = 'What the grades mean';
    b.onclick = onHelp;
    el.append(b);
  }
  return el;
}

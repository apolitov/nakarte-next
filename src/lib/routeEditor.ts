// Draws the route on the map and handles editing: click to add a point,
// drag a point, double-click a point to delete it, drag the line to insert a
// point, right-click (long touch) the line to switch a leg to a straight line.
import * as maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { RouteState } from './route.svelte';
import { gradeColor, SURFACE_STYLE, SURFACE_DASH, type SurfaceClass } from './profile';
import { t } from './i18n';

export type ColorMode = 'grade' | 'surface' | 'plain';

const DASH_EXPR = [
  'match',
  ['get', 'surf'],
  ...(Object.entries(SURFACE_DASH) as [SurfaceClass, number[]][]).flatMap(([k, v]) => [k, ['literal', v]]),
  ['literal', [1, 0]],
] as unknown as maplibregl.ExpressionSpecification;
const PLAIN = '#2a6df4';

export class RouteEditor {
  private markers = new Map<number, maplibregl.Marker>();
  editing = false;
  /** grade: colour = grade, dashes = surface; surface: colour and dashes = surface; plain: one colour */
  colorMode: ColorMode = 'grade';
  private dragInsert: { index: number; marker: maplibregl.Marker } | null = null;
  /** Returns true when it handled the click (e.g. placing a checkpoint). */
  onMapClick: ((lng: number, lat: number) => boolean) | null = null;
  /** "Split route here" in the segment menu; the app asks for confirmation. */
  onSplit: ((leg: number, lng: number, lat: number) => void) | null = null;
  /** "Copy up to here": a new route from the start to this point, to try an alternative. */
  onCopyTo: ((leg: number, lng: number, lat: number) => void) | null = null;

  constructor(
    private map: maplibregl.Map,
    private route: RouteState,
  ) {
    map.addSource('route', { type: 'geojson', data: empty() });
    map.addSource('route-hover', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      // dark casing: the light "flat" colour and the gaps of dashes stay readable on any base map
      paint: { 'line-color': '#26262b', 'line-width': 8, 'line-opacity': 0.75 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 5,
        // data-driven dasharray needs MapLibre GL JS >= 5.8
        'line-dasharray': ['case', ['==', ['get', 'straight'], true], ['literal', [1.2, 1.2]], DASH_EXPR],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    // wide invisible line to grab for inserting points
    map.addLayer({ id: 'route-hit', type: 'line', source: 'route', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 } });
    map.addLayer({
      id: 'route-hover',
      type: 'circle',
      source: 'route-hover',
      paint: { 'circle-radius': 7, 'circle-color': '#ffd83d', 'circle-stroke-color': '#141414', 'circle-stroke-width': 3 },
    });

    map.on('click', (e) => {
      if (this.dragInsert) return;
      if (this.onMapClick?.(e.lngLat.lng, e.lngLat.lat)) return;
      if (!this.editing) return;
      if (map.queryRenderedFeatures(e.point, { layers: ['route-hit'] }).length) return;
      route.add(e.lngLat.lng, e.lngLat.lat);
    });
    map.on('mouseenter', 'route-hit', () => {
      if (this.editing) map.getCanvas().style.cursor = 'grab';
    });
    map.on('mouseleave', 'route-hit', () => {
      map.getCanvas().style.cursor = this.editing ? 'crosshair' : '';
    });
    map.on('mousedown', 'route-hit', (e) => {
      if (e.originalEvent.button === 0) this.pressLine(e);
    });
    map.on('touchstart', 'route-hit', (e) => {
      if (e.points.length === 1) this.pressLine(e);
    });
    map.on('contextmenu', 'route-hit', (e) => {
      e.preventDefault();
      const f = e.features?.[0];
      if (f) this.legMenu(Number(f.properties?.leg ?? 0), e.lngLat);
    });
  }

  setEditing(on: boolean) {
    this.editing = on;
    this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
    for (const m of this.markers.values()) m.setDraggable(on);
    if (!on) this.route.prepend = false;
    this.render();
  }

  setColorMode(mode: ColorMode) {
    this.colorMode = mode;
    this.render();
  }

  private popup: maplibregl.Popup | null = null;

  /** Small menu for a leg: switch between road and straight line. */
  legMenu(leg: number, at: maplibregl.LngLatLike) {
    const straight = !!this.route.waypoints[leg]?.straight;
    const el = document.createElement('div');
    el.className = 'ctx';
    const btn = (title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = title;
      b.onclick = () => {
        this.popup?.remove();
        fn();
      };
      el.append(b);
    };
    btn(straight ? t('leg.roads') : t('leg.straight'), () => this.route.setLegStraight(leg, !straight));
    const ll = maplibregl.LngLat.convert(at);
    if (this.onCopyTo) btn(t('leg.copyTo'), () => this.onCopyTo?.(leg, ll.lng, ll.lat));
    if (this.onSplit) btn(t('leg.split'), () => this.onSplit?.(leg, ll.lng, ll.lat));
    this.popup?.remove();
    // a long touch ends with touchend + click on the map: closing on that click would remove
    // the menu before it can be used, so it closes on the next tap after a short delay
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'ctx-popup' }).setLngLat(at).setDOMContent(el).addTo(this.map);
    this.popup = popup;
    setTimeout(() => {
      const close = () => popup.remove();
      this.map.once('click', close);
      this.map.once('movestart', close);
      popup.once('close', () => {
        this.map.off('click', close);
        this.map.off('movestart', close);
      });
    }, 400);
  }

  /**
   * Press on the line: dragging inserts a point (one gesture, as in nakarte);
   * a long touch without movement opens the leg menu.
   */
  private pressLine(e: maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent) {
    if (!this.editing) return;
    const f = e.features?.[0];
    if (!f) return;
    e.preventDefault();
    const leg = Number(f.properties?.leg ?? 0);
    const start = e.point;
    const isTouch = 'points' in e;
    let marker: maplibregl.Marker | null = null;
    const longPress = isTouch ? setTimeout(() => !marker && (cleanup(), this.legMenu(leg, e.lngLat)), 550) : 0;
    const move = (ev: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!marker) {
        if (Math.hypot(ev.point.x - start.x, ev.point.y - start.y) < 6) return;
        clearTimeout(longPress);
        marker = new maplibregl.Marker({ element: markerEl('', 'via') }).setLngLat(ev.lngLat).addTo(this.map);
        this.dragInsert = { index: leg + 1, marker };
      }
      marker.setLngLat(ev.lngLat);
    };
    const cleanup = () => {
      clearTimeout(longPress);
      this.map.off('mousemove', move);
      this.map.off('touchmove', move);
      this.map.off('mouseup', up);
      this.map.off('touchend', up);
    };
    const up = (ev: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      cleanup();
      if (!marker) return;
      marker.remove();
      this.route.insert(leg + 1, ev.lngLat.lng, ev.lngLat.lat);
      // let the click that follows mouseup pass without adding a point
      setTimeout(() => (this.dragInsert = null), 0);
    };
    this.map.on('mousemove', move);
    this.map.on('touchmove', move);
    this.map.on('mouseup', up);
    this.map.on('touchend', up);
  }

  /** Syncs markers and the line with the route state. */
  render() {
    const wps = this.route.waypoints;
    const seen = new Set<number>();
    wps.forEach((w, i) => {
      seen.add(w.id);
      const kind = i === 0 ? 'start' : i === wps.length - 1 ? 'end' : 'via';
      const label = kind === 'via' ? String(i) : '';
      let m = this.markers.get(w.id);
      if (!m) {
        const el = markerEl(label, kind);
        m = new maplibregl.Marker({ element: el, draggable: this.editing }).setLngLat([w.lng, w.lat]).addTo(this.map);
        m.on('dragend', () => {
          const p = m!.getLngLat();
          this.route.move(w.id, p.lng, p.lat);
        });
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (!this.editing) return;
          // click on an end point continues the route from that end
          const ws = this.route.waypoints;
          if (ws.length > 1 && ws[0].id === w.id) this.route.prepend = true;
          else if (ws.at(-1)?.id === w.id) this.route.prepend = false;
          this.render();
        });
        el.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          if (this.editing) this.route.remove(w.id);
        });
        el.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (this.editing) this.route.remove(w.id);
        });
        this.markers.set(w.id, m);
      } else {
        m.setLngLat([w.lng, w.lat]);
        const el = m.getElement();
        // keep MapLibre's own marker classes: replacing className breaks positioning
        el.classList.remove('wp-start', 'wp-via', 'wp-end');
        el.classList.add('wp', `wp-${kind}`);
        el.textContent = label;
      }
      const active = this.editing && ((kind === 'start' && this.route.prepend) || (kind === 'end' && !this.route.prepend));
      m.getElement().classList.toggle('wp-active', active);
      m.setDraggable(this.editing);
      m.getElement().title = this.editing
        ? t('wp.tip')
        : '';
    });
    for (const [id, m] of this.markers) {
      if (!seen.has(id)) {
        m.remove();
        this.markers.delete(id);
      }
    }
    (this.map.getSource('route') as maplibregl.GeoJSONSource).setData(this.lineFeatures());
  }

  /** Splits the route into runs of equal colour; each run knows its leg for inserting points. */
  private lineFeatures(): FeatureCollection {
    const pts = this.route.points;
    const prof = this.route.profileData;
    const features: Feature[] = [];
    let run: number[][] = [];
    let runColor = '';
    let runLeg = -1;
    let runStraight = false;
    let runSurf: SurfaceClass = 'unknown';
    const flush = () => {
      if (run.length > 1) features.push({ type: 'Feature', properties: { color: runColor, leg: runLeg, straight: runStraight, surf: this.colorMode === 'plain' ? 'paved' : runSurf }, geometry: { type: 'LineString', coordinates: run } });
    };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const color =
        this.colorMode === 'grade' ? gradeColor(prof.grade[i]) : this.colorMode === 'surface' ? SURFACE_STYLE[prof.surface[i]].color : PLAIN;
      const leg = i === 0 ? p.leg : pts[i].leg;
      const surf = prof.surface[i];
      if (i > 0 && (color !== runColor || leg !== runLeg || surf !== runSurf)) {
        // segment i-1→i takes the colour of point i
        flush();
        run = [[pts[i - 1].lng, pts[i - 1].lat]];
      }
      runColor = color;
      runLeg = leg;
      runStraight = p.straight;
      runSurf = surf;
      run.push([p.lng, p.lat]);
    }
    flush();
    // legs still loading or failed: a thin straight segment
    this.route.legs.forEach((l, i) => {
      if (l.status === 'ok') return;
      const a = this.route.waypoints[i], b = this.route.waypoints[i + 1];
      if (a && b)
        features.push({
          type: 'Feature',
          properties: { color: l.status === 'error' ? '#d1242f' : '#9a9aa2', leg: i },
          geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
        });
    });
    return { type: 'FeatureCollection', features };
  }

  /** Highlights the route point at index `i` (from the elevation profile). */
  hover(i: number | null) {
    const p = i == null ? null : this.route.points[i];
    (this.map.getSource('route-hover') as maplibregl.GeoJSONSource).setData(
      p ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }] } : empty(),
    );
  }
}

function empty(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function markerEl(label: string, kind: string) {
  const el = document.createElement('div');
  el.className = `wp wp-${kind}`;
  el.textContent = label;
  return el;
}

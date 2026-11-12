// Draws the route on the map and handles editing: click to add a point,
// drag a point, click a point to delete it, drag the line to insert a point.
import * as maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { RouteState } from './route.svelte';
import { gradeColor, SURFACE_STYLE } from './profile';

export type ColorMode = 'grade' | 'surface' | 'plain';
const PLAIN = '#2a6df4';

export class RouteEditor {
  private markers = new Map<number, maplibregl.Marker>();
  editing = false;
  colorMode: ColorMode = 'grade';
  private dragInsert: { index: number; marker: maplibregl.Marker } | null = null;

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
      paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': 0.85 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      paint: { 'line-color': ['get', 'color'], 'line-width': 5 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    // wide invisible line to grab for inserting points
    map.addLayer({ id: 'route-hit', type: 'line', source: 'route', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 } });
    map.addLayer({
      id: 'route-hover',
      type: 'circle',
      source: 'route-hover',
      paint: { 'circle-radius': 7, 'circle-color': '#fff', 'circle-stroke-color': '#111', 'circle-stroke-width': 3 },
    });

    map.on('click', (e) => {
      if (!this.editing || this.dragInsert) return;
      if (map.queryRenderedFeatures(e.point, { layers: ['route-hit'] }).length) return;
      route.add(e.lngLat.lng, e.lngLat.lat);
    });
    map.on('mouseenter', 'route-hit', () => {
      if (this.editing) map.getCanvas().style.cursor = 'grab';
    });
    map.on('mouseleave', 'route-hit', () => {
      map.getCanvas().style.cursor = this.editing ? 'crosshair' : '';
    });
    map.on('mousedown', 'route-hit', (e) => this.startInsert(e));
    map.on('touchstart', 'route-hit', (e) => {
      if (e.points.length === 1) this.startInsert(e);
    });
  }

  setEditing(on: boolean) {
    this.editing = on;
    this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
    for (const m of this.markers.values()) m.setDraggable(on);
  }

  setColorMode(mode: ColorMode) {
    this.colorMode = mode;
    this.render();
  }

  private startInsert(e: maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent) {
    if (!this.editing) return;
    const f = e.features?.[0];
    if (!f) return;
    e.preventDefault();
    const leg = Number(f.properties?.leg ?? 0);
    const el = markerEl('', 'via');
    const marker = new maplibregl.Marker({ element: el }).setLngLat(e.lngLat).addTo(this.map);
    this.dragInsert = { index: leg + 1, marker };
    const move = (ev: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => marker.setLngLat(ev.lngLat);
    const up = (ev: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      this.map.off('mousemove', move);
      this.map.off('touchmove', move);
      this.map.off('mouseup', up);
      this.map.off('touchend', up);
      marker.remove();
      const ins = this.dragInsert!;
      this.route.insert(ins.index, ev.lngLat.lng, ev.lngLat.lat);
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
          if (this.editing) this.route.remove(w.id);
        });
        this.markers.set(w.id, m);
      } else {
        m.setLngLat([w.lng, w.lat]);
        const el = m.getElement();
        el.className = `wp wp-${kind}`;
        el.textContent = label;
      }
      m.getElement().title = this.editing ? 'Тащите, чтобы сдвинуть; щелчок удаляет' : '';
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
    const flush = () => {
      if (run.length > 1) features.push({ type: 'Feature', properties: { color: runColor, leg: runLeg }, geometry: { type: 'LineString', coordinates: run } });
    };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const color =
        this.colorMode === 'grade' ? gradeColor(prof.grade[i]) : this.colorMode === 'surface' ? SURFACE_STYLE[prof.surface[i]].color : PLAIN;
      const leg = i === 0 ? p.leg : pts[i].leg;
      if (i > 0 && (color !== runColor || leg !== runLeg)) {
        // segment i-1→i takes the colour of point i
        flush();
        run = [[pts[i - 1].lng, pts[i - 1].lat]];
      }
      runColor = color;
      runLeg = leg;
      run.push([p.lng, p.lat]);
    }
    flush();
    // legs still loading: draw a dashed straight line? keep it simple — a thin straight segment
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

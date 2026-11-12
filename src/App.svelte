<script lang="ts">
  import * as maplibregl from 'maplibre-gl';
  type MlMap = maplibregl.Map;
  import { onMount } from 'svelte';
  import { LAYERS, DEFAULT_BASE, layerById, type LayerDef } from './lib/layers';
  import { registerYandexProtocol } from './lib/yandex';
  import { parseHash, formatHash } from './lib/hash';
  import { parseTrackFile, toGpx, trackToGeoJSON, bboxOf, type Track } from './lib/gpx';

  let container: HTMLDivElement;
  let map: MlMap | undefined;

  const initial = parseHash(location.hash);
  const initLayers = (initial.layers ?? []).filter((id) => layerById(id));
  let base = $state(initLayers.find((id) => layerById(id)?.kind === 'base') ?? DEFAULT_BASE);
  let overlays = $state<string[]>(initLayers.filter((id) => layerById(id)?.kind === 'overlay'));
  let tracks = $state<Track[]>([]);
  let layersOpen = $state(false);
  let error = $state('');

  const groups = $derived(
    Object.entries(
      LAYERS.reduce<Record<string, LayerDef[]>>((acc, l) => ((acc[l.group] ??= []).push(l), acc), {}),
    ),
  );

  async function sourceSpec(l: LayerDef): Promise<maplibregl.RasterSourceSpecification> {
    const tiles = typeof l.tiles === 'function' ? await l.tiles() : l.tiles;
    return { type: 'raster', tiles, tileSize: l.tileSize ?? 256, maxzoom: l.maxzoom ?? 19, attribution: l.attribution };
  }

  /** Inserts raster layers under tracks; base under every overlay. */
  async function showRaster(l: LayerDef, beforeId?: string) {
    if (!map) return;
    const sid = `src-${l.id}`;
    if (map.getLayer(sid)) return;
    try {
      if (!map.getSource(sid)) map.addSource(sid, await sourceSpec(l));
      map.addLayer({ id: sid, type: 'raster', source: sid }, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
    } catch (e) {
      error = `${l.title}: ${(e as Error).message}`;
    }
  }

  function hideRaster(id: string) {
    if (!map) return;
    const sid = `src-${id}`;
    if (map.getLayer(sid)) map.removeLayer(sid);
    if (map.getSource(sid)) map.removeSource(sid);
  }

  function firstOverlayOrTracks() {
    return overlays.map((id) => `src-${id}`).find((id) => map?.getLayer(id)) ?? 'tracks-line';
  }

  async function setBase(id: string) {
    if (id === base && map?.getLayer(`src-${id}`)) return;
    const prev = base;
    base = id;
    await showRaster(layerById(id)!, firstOverlayOrTracks());
    if (prev !== id) hideRaster(prev);
    syncHash();
  }

  async function toggleOverlay(id: string) {
    if (overlays.includes(id)) {
      overlays = overlays.filter((o) => o !== id);
      hideRaster(id);
    } else {
      overlays = [...overlays, id];
      await showRaster(layerById(id)!, 'tracks-line');
    }
    syncHash();
  }

  function syncHash() {
    if (!map) return;
    const c = map.getCenter();
    history.replaceState(null, '', formatHash({ zoom: map.getZoom(), lat: c.lat, lng: c.lng, layers: [base, ...overlays] }));
  }

  function refreshTracks() {
    (map?.getSource('tracks') as maplibregl.GeoJSONSource | undefined)?.setData(trackToGeoJSON(tracks));
  }

  async function addFiles(files: FileList | File[]) {
    error = '';
    for (const f of Array.from(files)) {
      try {
        const t = parseTrackFile(f.name, await f.text());
        tracks = [...tracks, t];
        refreshTracks();
        zoomTo(t);
      } catch (e) {
        error = (e as Error).message;
      }
    }
  }

  function zoomTo(t: Track) {
    const b = bboxOf(t);
    if (b && map) map.fitBounds(b, { padding: 60, maxZoom: 15 });
  }

  function exportTrack(t: Track) {
    const blob = new Blob([toGpx(t)], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${t.name || 'track'}.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function removeTrack(t: Track) {
    tracks = tracks.filter((x) => x.id !== t.id);
    refreshTracks();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  }

  onMount(() => {
    registerYandexProtocol();
    map = new maplibregl.Map({
      container,
      style: { version: 8, sources: {}, layers: [] },
      center: [initial.lng ?? -9.14, initial.lat ?? 38.72],
      zoom: initial.zoom ?? 10,
      attributionControl: { compact: true },
      maxPitch: 0,
      dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-left');

    map.on('load', async () => {
      map!.addSource('tracks', { type: 'geojson', data: trackToGeoJSON(tracks) });
      map!.addLayer({
        id: 'tracks-line',
        type: 'line',
        source: 'tracks',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#e0218a', 'line-width': 3.5, 'line-opacity': 0.9 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
      map!.addLayer({
        id: 'tracks-points',
        type: 'circle',
        source: 'tracks',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#e0218a', 'circle-stroke-width': 2 },
      });
      await showRaster(layerById(base) ?? layerById(DEFAULT_BASE)!, 'tracks-line');
      for (const id of overlays) await showRaster(layerById(id)!, 'tracks-line');
      syncHash();
    });
    map.on('moveend', syncHash);

    const onHash = () => {
      const s = parseHash(location.hash);
      if (s.zoom != null) map!.jumpTo({ center: [s.lng!, s.lat!], zoom: s.zoom });
    };
    addEventListener('hashchange', onHash);
    return () => {
      removeEventListener('hashchange', onHash);
      map?.remove();
    };
  });
</script>

<div class="app" role="application" ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
  <div class="map" bind:this={container}></div>

  <div class="panel layers" class:open={layersOpen}>
    <button class="toggle" onclick={() => (layersOpen = !layersOpen)} aria-expanded={layersOpen}>
      Слои: {layerById(base)?.title}
    </button>
    {#if layersOpen}
      <div class="list">
        {#each groups as [group, items] (group)}
          <div class="group">{group}</div>
          {#each items as l (l.id)}
            <label>
              {#if l.kind === 'base'}
                <input type="radio" name="base" checked={base === l.id} onchange={() => setBase(l.id)} />
              {:else}
                <input type="checkbox" checked={overlays.includes(l.id)} onchange={() => toggleOverlay(l.id)} />
              {/if}
              {l.title}
            </label>
          {/each}
        {/each}
      </div>
    {/if}
  </div>

  <div class="panel tracks">
    <label class="open">
      Открыть GPX/KML
      <input type="file" accept=".gpx,.kml" multiple onchange={(e) => addFiles((e.currentTarget as HTMLInputElement).files!)} />
    </label>
    {#each tracks as t (t.id)}
      <div class="track">
        <button class="name" onclick={() => zoomTo(t)} title="Показать на карте">{t.name}</button>
        <button onclick={() => exportTrack(t)} title="Скачать GPX">GPX</button>
        <button onclick={() => removeTrack(t)} title="Удалить" aria-label="Удалить">×</button>
      </div>
    {/each}
    {#if error}<div class="error">{error}</div>{/if}
  </div>
</div>

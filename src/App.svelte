<script lang="ts">
  import * as maplibregl from 'maplibre-gl';
  type MlMap = maplibregl.Map;
  import { onMount } from 'svelte';
  import { LAYERS, DEFAULT_BASE, layerById, type LayerDef } from './lib/layers';
  import { registerYandexProtocol } from './lib/yandex';
  import { parseHash, formatHash } from './lib/hash';
  import { parseTrackFile, toGpx, trackToGeoJSON, bboxOf, type Track } from './lib/gpx';
  import { RouteState } from './lib/route.svelte';
  import { RouteEditor, type ColorMode } from './lib/routeEditor';
  import { PROFILES, type ProfileId } from './lib/brouter';
  import ElevationProfile from './ElevationProfile.svelte';
  import { store, newId, type RouteDoc, type TrackDoc } from './lib/store';
  import { routeToParam, paramToRoute } from './lib/share';

  let container: HTMLDivElement;
  let map: MlMap | undefined;

  const initial = parseHash(location.hash);
  const initLayers = (initial.layers ?? []).filter((id) => layerById(id));
  let base = $state(initLayers.find((id) => layerById(id)?.kind === 'base') ?? DEFAULT_BASE);
  let overlays = $state<string[]>(initLayers.filter((id) => layerById(id)?.kind === 'overlay'));
  let tracks = $state<Track[]>([]);
  let layersOpen = $state(false);
  let error = $state('');

  const route = new RouteState();
  let editor = $state<RouteEditor>();
  let editing = $state(false);
  let colorMode = $state<ColorMode>('grade');
  let showProfile = $state(true);
  let savedRoutes = $state<RouteDoc[]>([]);
  let toast = $state('');

  // ---- persistence: autosave the edited route, keep tracks ----
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void route.version;
    if (!loaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveRoute, 500);
  });
  let loaded = false;

  function saveRoute() {
    if (!route.waypoints.length) return;
    const doc = route.toDoc();
    store.put(doc);
    savedRoutes = [doc, ...savedRoutes.filter((r) => r.id !== doc.id)];
  }

  function trackToDoc(t: Track): TrackDoc {
    return {
      id: t.id,
      kind: 'track',
      name: t.name,
      lines: t.lines,
      checkpoints: t.points.map((p) => ({ id: newId('c'), lng: p.coord[0], lat: p.coord[1], kind: 'generic', name: p.name })),
      updated: Date.now(),
    };
  }
  function docToTrack(d: TrackDoc): Track {
    return { id: d.id, name: d.name, lines: d.lines, points: d.checkpoints.map((c) => ({ name: c.name, coord: [c.lng, c.lat] })) };
  }

  async function loadStored() {
    const docs = await store.all();
    tracks = docs.filter((d): d is TrackDoc => d.kind === 'track').map(docToTrack);
    savedRoutes = docs.filter((d): d is RouteDoc => d.kind === 'route').sort((a, b) => b.updated - a.updated);
    // one-time migration from the first version (localStorage)
    try {
      const old = JSON.parse(localStorage.getItem('nk-route') ?? 'null');
      if (old?.waypoints?.length && !savedRoutes.length) {
        route.load({ id: newId('r'), kind: 'route', name: '', profile: old.profile, waypoints: old.waypoints, checkpoints: [], updated: Date.now() });
        localStorage.removeItem('nk-route');
      }
    } catch {
      /* ignore */
    }
    const shared = new URLSearchParams(location.hash.slice(1)).get('r');
    const fromLink = shared ? paramToRoute(shared) : null;
    if (fromLink) {
      route.load({ id: newId('r'), kind: 'route', name: '', checkpoints: [], updated: Date.now(), ...fromLink });
      toast = 'Маршрут из ссылки сохранён у вас';
      fitRoute(fromLink.waypoints);
    } else if (!route.waypoints.length && savedRoutes[0]) {
      route.load(savedRoutes[0]);
    }
    loaded = true;
    refreshTracks();
  }

  function fitRoute(pts: { lng: number; lat: number }[]) {
    if (!map || !pts.length) return;
    const b = pts.reduce(
      (b, p) => [Math.min(b[0], p.lng), Math.min(b[1], p.lat), Math.max(b[2], p.lng), Math.max(b[3], p.lat)],
      [180, 90, -180, -90],
    );
    map.fitBounds(b as [number, number, number, number], { padding: 80, maxZoom: 15 });
  }

  function openRoute(r: RouteDoc) {
    saveRoute();
    route.load(r);
    fitRoute(r.waypoints);
  }

  function deleteRoute(r: RouteDoc) {
    if (!confirm(`Удалить «${r.name}»?`)) return;
    store.delete(r.id);
    savedRoutes = savedRoutes.filter((x) => x.id !== r.id);
    if (r.id === route.docId) route.reset();
  }

  function newRoute() {
    saveRoute();
    route.reset();
    editing = true;
  }

  async function shareRoute() {
    const doc = route.toDoc();
    const c = map!.getCenter();
    const url =
      location.origin + location.pathname +
      formatHash({ zoom: map!.getZoom(), lat: c.lat, lng: c.lng, layers: [base, ...overlays] }) +
      '&r=' + encodeURIComponent(routeToParam(doc));
    try {
      await navigator.clipboard.writeText(url);
      toast = `Ссылка скопирована (${url.length} символов)`;
    } catch {
      prompt('Ссылка на маршрут', url);
    }
  }

  $effect(() => {
    if (!toast) return;
    const t = setTimeout(() => (toast = ''), 3000);
    return () => clearTimeout(t);
  });

  $effect(() => {
    void route.version;
    void route.points;
    editor?.render();
  });
  $effect(() => editor?.setEditing(editing));
  $effect(() => editor?.setColorMode(colorMode));

  function exportRoute() {
    if (route.points.length < 2) return;
    const name = route.name || route.autoName();
    const t: Track = {
      id: 'route',
      name,
      lines: [route.points.map((p) => (p.ele != null ? [p.lng, p.lat, p.ele] : [p.lng, p.lat]))],
      points: route.checkpoints.map((c) => ({ name: c.name, coord: [c.lng, c.lat] })),
    };
    exportTrack(t);
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) route.redo();
      else route.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      route.redo();
    } else if (e.key === 'Escape') {
      editing = false;
    } else if (editing && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      route.removeLast();
    }
  }

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
        store.put(trackToDoc(t));
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
    store.delete(t.id);
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
      editor = new RouteEditor(map!, route);
      await loadStored();
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

<svelte:window onkeydown={onKey} />
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

  <div class="panel routing">
    <div class="row">
      <button class:active={editing} onclick={() => (editing = !editing)}>
        {editing ? 'Готово' : route.waypoints.length ? 'Править маршрут' : 'Построить маршрут'}
      </button>
      <select value={route.profile} onchange={(e) => route.setProfile((e.currentTarget as HTMLSelectElement).value as ProfileId)} aria-label="Профиль">
        {#each PROFILES as p (p.id)}<option value={p.id}>{p.title}</option>{/each}
      </select>
    </div>
    {#if editing}
      <div class="hint">
        Щелчок по карте добавляет точку{route.prepend ? ' в начало' : ''}. Точку можно тащить, двойной щелчок удаляет её,
        Backspace убирает последнюю. Потяните линию, чтобы вставить точку. Правая кнопка (долгое нажатие) по линии: отрезок по прямой.
        ⌘Z / Ctrl+Z отменяет.
      </div>
    {/if}
    {#if route.waypoints.length}
      <div class="row">
        <select bind:value={colorMode} aria-label="Раскраска линии">
          <option value="grade">Цвет: уклон</option>
          <option value="surface">Цвет: покрытие</option>
          <option value="plain">Цвет: один</option>
        </select>
        <button onclick={() => route.undo()} disabled={!route.canUndo} title="Отменить (⌘Z)" aria-label="Отменить">↶</button>
        <button onclick={() => route.redo()} disabled={!route.canRedo} title="Повторить (⌘⇧Z)" aria-label="Повторить">↷</button>
        <button onclick={() => route.reverse()} title="Развернуть" aria-label="Развернуть">⇄</button>
      </div>
      <div class="row">
        <button onclick={() => route.outAndBack()} disabled={route.waypoints.length < 2}>Туда и обратно</button>
        <button onclick={() => route.backToStart()} disabled={route.waypoints.length < 2}>К старту</button>
      </div>
      <div class="row">
        <button onclick={exportRoute} disabled={route.points.length < 2}>GPX</button>
        <button onclick={shareRoute} disabled={!route.waypoints.length}>Поделиться</button>
        <button onclick={newRoute}>Новый</button>
        <button onclick={() => confirm('Очистить маршрут?') && route.clear()} title="Очистить" aria-label="Очистить">×</button>
      </div>
    {/if}
    {#if route.loading}<div class="hint">Считаю…</div>{/if}
    {#if route.error}<div class="error">Маршрут: {route.error.error}</div>{/if}
  </div>

  {#if route.points.length > 1}
    <div class="panel profile-panel" class:collapsed={!showProfile}>
      <button class="collapse" onclick={() => (showProfile = !showProfile)}>{showProfile ? 'Скрыть профиль' : 'Профиль высот'}</button>
      {#if showProfile}
        <ElevationProfile profile={route.profileData} onhover={(i) => editor?.hover(i)} />
      {/if}
    </div>
  {/if}

  <div class="panel tracks">
    <label class="open">
      Открыть GPX/KML
      <input type="file" accept=".gpx,.kml" multiple onchange={(e) => addFiles((e.currentTarget as HTMLInputElement).files!)} />
    </label>
    {#if savedRoutes.length}<div class="sect">Маршруты</div>{/if}
    {#each savedRoutes as r (r.id)}
      <div class="track" class:current={r.id === route.docId}>
        <button class="name route-name" onclick={() => openRoute(r)} title="Открыть">{r.name}</button>
        <button onclick={() => deleteRoute(r)} title="Удалить" aria-label="Удалить">×</button>
      </div>
    {/each}
    {#if tracks.length}<div class="sect">Треки</div>{/if}
    {#each tracks as t (t.id)}
      <div class="track">
        <button class="name" onclick={() => zoomTo(t)} title="Показать на карте">{t.name}</button>
        <button onclick={() => exportTrack(t)} title="Скачать GPX">GPX</button>
        <button onclick={() => removeTrack(t)} title="Удалить" aria-label="Удалить">×</button>
      </div>
    {/each}
    {#if error}<div class="error">{error}</div>{/if}
  </div>

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}
</div>

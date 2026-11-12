<script lang="ts">
  import * as maplibregl from 'maplibre-gl';
  type MlMap = maplibregl.Map;
  import { onMount, untrack } from 'svelte';
  import { DEFAULT_BASE, layerById, type LayerDef } from './lib/layers';
  import { registerYandexProtocol } from './lib/yandex';
  import { parseHash, formatHash } from './lib/hash';
  import { parseTrackFile, toGpx, trackToGeoJSON, bboxOf, type Track } from './lib/gpx';
  import { RouteState } from './lib/route.svelte';
  import { RouteEditor, type ColorMode } from './lib/routeEditor';
  import { PROFILES, type ProfileId, type RouteOptions } from './lib/brouter';
  import { store, newId, type RouteDoc, type TrackDoc } from './lib/store';
  import { routeToParam, paramToRoute } from './lib/share';
  import { showPasses, hidePasses } from './lib/passes';
  import { CheckpointLayer, type CheckpointItem } from './lib/checkpoints';
  import { whoami, login, logout, sync, remote, shareShort, loadShort, type User } from './lib/account';
  import type { Doc } from './lib/store';
  import { encodeCourse } from './lib/fit';
  import { buildTimeline, nearestPoint, segmentClasses, type TimelineEvent } from './lib/timeline';
  import GarminDialog from './ui/GarminDialog.svelte';
  import AccountMenu from './ui/AccountMenu.svelte';
  import RouteSummary from './ui/RouteSummary.svelte';
  import RouteSettings from './ui/RouteSettings.svelte';
  import Segmented from './ui/Segmented.svelte';
  import Fold from './ui/Fold.svelte';
  import Timeline from './ui/Timeline.svelte';
  import MyRoutes from './ui/MyRoutes.svelte';
  import Toolbar from './ui/Toolbar.svelte';
  import LayersPopover from './ui/LayersPopover.svelte';
  import HelpDialog from './ui/HelpDialog.svelte';
  import ProfileCard from './ui/ProfileCard.svelte';
  import KeyTip from './ui/KeyTip.svelte';
  import Icon from './ui/Icon.svelte';
  import { MOD } from './ui/icons';
  import { t } from './lib/i18n';

  let container: HTMLDivElement;
  let map: MlMap | undefined;

  const initial = parseHash(location.hash);
  const initLayers = (initial.layers ?? []).filter((id) => layerById(id));
  let base = $state(initLayers.find((id) => layerById(id)?.kind === 'base') ?? DEFAULT_BASE);
  let overlays = $state<string[]>(initLayers.filter((id) => layerById(id)?.kind === 'overlay'));
  let tracks = $state<Track[]>([]);
  let layersOpen = $state(false);
  let helpOpen = $state(false);

  const route = new RouteState();
  let editor = $state<RouteEditor>();
  let editing = $state(false);
  let colorMode = $state<ColorMode>('grade');
  let showProfile = $state(true);
  let settingsOpen = $state(false);
  let mineOpen = $state(false);
  function setOpt(patch: Partial<RouteOptions>) {
    route.setOptions({ ...route.options, ...patch });
  }
  let savedRoutes = $state<RouteDoc[]>([]);
  let toast = $state('');
  let toastErr = $state(false);
  function say(msg: string, err = false) {
    toast = msg;
    toastErr = err;
  }
  let user = $state<User | null>(null);
  let syncState = $state<'' | 'sync' | 'ok' | 'error'>('');
  let fileInput: HTMLInputElement;
  let accountMenu: AccountMenu | undefined = $state();

  // phone layout: map on top, the panel below it as a sheet
  const mq = matchMedia('(max-width: 639px)');
  let mobile = $state(mq.matches);
  $effect(() => {
    const f = () => (mobile = mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  });

  // on a laptop screen only one of the two folds stays open, so the panel never scrolls
  $effect(() => {
    if (settingsOpen && !mobile) untrack(() => (mineOpen = false));
  });
  $effect(() => {
    if (mineOpen && !mobile) untrack(() => (settingsOpen = false));
  });

  /** Local save plus, when logged in, the server copy. */
  function saveDoc(d: Doc) {
    store.put(d);
    if (user) remote.put(d).then(() => (syncState = 'ok'), () => (syncState = 'error'));
  }
  function deleteDoc(id: string) {
    store.delete(id);
    if (user) remote.delete(id).catch(() => (syncState = 'error'));
  }

  async function runSync() {
    syncState = 'sync';
    try {
      if (await sync()) await reloadLists();
      syncState = 'ok';
    } catch {
      syncState = 'error';
    }
  }
  /** Next map click places a checkpoint on this owner ('route' or a track id). */
  let placing = $state<string | null>(null);
  let cpLayer: CheckpointLayer | undefined;

  const checkpointItems = $derived<CheckpointItem[]>([
    ...route.checkpoints.map((c) => ({ ...c, owner: 'route', editable: true })),
    ...tracks.flatMap((t) =>
      t.points.map((p, i) => ({
        id: p.id ?? `${t.id}:${i}`,
        lng: p.coord[0],
        lat: p.coord[1],
        kind: p.kind ?? 'generic',
        name: p.name,
        note: p.note,
        owner: t.id,
        editable: true,
      })),
    ),
  ]);
  $effect(() => {
    // read the items first: with `cpLayer?.set(items)` an unset layer would skip
    // the read, and the effect would never subscribe to changes
    const items = checkpointItems;
    void route.version;
    cpLayer?.set(items);
  });

  // ---- timeline, hover and selection shared by the map, the profile and the timeline ----
  const classes = $derived(segmentClasses(route.points, route.profileData.surface));
  const events = $derived(buildTimeline({ points: route.points, profile: route.profileData, checkpoints: route.checkpoints }));
  /** Route checkpoints on the route: distance for the profile. */
  const profileMarks = $derived(
    events.filter((e) => e.kind === 'checkpoint').map((e) => ({ d: e.d, kind: e.cpKind ?? 'generic', name: e.label })),
  );
  let hoverIdx = $state<number | null>(null);
  let hoverSrc = $state<'map' | 'prof' | 'tl' | null>(null);
  let hoverBand = $state<[number, number] | null>(null);
  let pinned = $state<TimelineEvent | null>(null);
  /** Leg under the mouse on the map. */
  let cursorLeg = $state<number | null>(null);
  let profH = $state(0);

  const markerIdx = $derived(hoverIdx ?? pinned?.i ?? null);
  const pinnedBand = $derived<[number, number] | null>(pinned?.d2 != null ? [pinned.d, pinned.d2] : null);
  const activeD = $derived(hoverIdx != null && hoverSrc !== 'tl' ? (route.profileData.dist[hoverIdx] ?? null) : null);

  $effect(() => {
    const i = markerIdx;
    editor?.hover(i != null && i < route.points.length ? i : null);
  });
  $effect(() => {
    const id = pinned?.cpId ?? null;
    void checkpointItems;
    cpLayer?.highlight(id);
  });
  // the selected event follows the rebuilt timeline, or goes away
  $effect(() => {
    const evs = events;
    untrack(() => {
      if (pinned) pinned = evs.find((e) => e.id === pinned!.id) ?? null;
      if (hoverIdx != null && hoverIdx >= route.points.length) hoverIdx = null;
    });
  });

  function setHover(i: number | null, src: 'map' | 'prof' | 'tl') {
    if (i == null) {
      if (hoverSrc === src) {
        hoverIdx = null;
        hoverSrc = null;
      }
      return;
    }
    hoverIdx = i;
    hoverSrc = src;
  }

  function onTimelineHover(e: TimelineEvent | null) {
    if (!e) {
      setHover(null, 'tl');
      hoverBand = null;
      return;
    }
    setHover(e.i, 'tl');
    hoverBand = e.d2 != null ? [e.d, e.d2] : null;
  }

  /** Vertical offset that centres a point in the map area free of the toolbar and the profile. */
  function centerOffset(): [number, number] {
    const bottom = mobile ? 0 : profH + 12;
    return [0, (64 - bottom) / 2];
  }
  function padding() {
    return { top: 76, bottom: (mobile ? 0 : profH + 12) + 30, left: 50, right: 70 };
  }

  function pickEvent(e: TimelineEvent) {
    if (pinned?.id === e.id) {
      pinned = null;
      return;
    }
    pinned = e;
    if (!map) return;
    const pts = route.points;
    if (e.i2 != null && e.kind === 'climb') {
      const sl = pts.slice(e.i, e.i2 + 1);
      fitPoints(sl, 15);
    } else {
      const p = pts[e.i];
      if (p) map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 13.5), offset: centerOffset(), duration: 600 });
    }
  }

  function pickProfile(i: number) {
    const p = route.points[i];
    if (p && map) map.easeTo({ center: [p.lng, p.lat], offset: centerOffset(), duration: 400 });
  }

  function fitPoints(pts: { lng: number; lat: number }[], maxZoom = 15) {
    if (!map || !pts.length) return;
    const b = pts.reduce(
      (b, p) => [Math.min(b[0], p.lng), Math.min(b[1], p.lat), Math.max(b[2], p.lng), Math.max(b[3], p.lat)],
      [180, 90, -180, -90],
    );
    map.fitBounds(b as [number, number, number, number], { padding: padding(), maxZoom, duration: 500 });
  }

  function updateTrackPoint(item: CheckpointItem, patch: Partial<CheckpointItem>) {
    tracks = tracks.map((t) => {
      if (t.id !== item.owner) return t;
      const points = t.points.map((p, i) =>
        (p.id ?? `${t.id}:${i}`) === item.id
          ? {
              ...p,
              id: item.id,
              coord: [patch.lng ?? p.coord[0], patch.lat ?? p.coord[1]],
              name: patch.name ?? p.name,
              kind: patch.kind ?? p.kind,
              note: 'note' in patch ? patch.note : p.note,
            }
          : p,
      );
      const nt = { ...t, points };
      saveDoc(trackToDoc(nt));
      return nt;
    });
  }

  function removeTrackPoint(item: CheckpointItem) {
    tracks = tracks.map((t) => {
      if (t.id !== item.owner) return t;
      const nt = { ...t, points: t.points.filter((p, i) => (p.id ?? `${t.id}:${i}`) !== item.id) };
      saveDoc(trackToDoc(nt));
      return nt;
    });
  }

  function placeCheckpoint(lng: number, lat: number): boolean {
    if (!placing) return false;
    const owner = placing;
    placing = null;
    if (owner === 'route') {
      const id = route.addCheckpoint(lng, lat);
      queueMicrotask(() => cpLayer?.open({ id, lng, lat, kind: 'generic', name: '', owner, editable: true }));
    } else {
      const id = newId('c');
      tracks = tracks.map((t) => {
        if (t.id !== owner) return t;
        const nt = { ...t, points: [...t.points, { id, name: '', coord: [lng, lat], kind: 'generic' }] };
        saveDoc(trackToDoc(nt));
        return nt;
      });
      queueMicrotask(() => cpLayer?.open({ id, lng, lat, kind: 'generic', name: '', owner, editable: true }));
    }
    return true;
  }

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
    saveDoc(doc);
    savedRoutes = [doc, ...savedRoutes.filter((r) => r.id !== doc.id)];
  }

  function trackToDoc(t: Track): TrackDoc {
    return {
      id: t.id,
      kind: 'track',
      name: t.name,
      lines: t.lines,
      checkpoints: t.points.map((p) => ({ id: p.id ?? newId('c'), lng: p.coord[0], lat: p.coord[1], kind: p.kind ?? 'generic', name: p.name, note: p.note })),
      updated: Date.now(),
    };
  }
  function docToTrack(d: TrackDoc): Track {
    return {
      id: d.id,
      name: d.name,
      lines: d.lines,
      points: d.checkpoints.map((c) => ({ id: c.id, name: c.name, coord: [c.lng, c.lat], kind: c.kind, note: c.note })),
    };
  }

  async function reloadLists() {
    const docs = await store.all();
    tracks = docs.filter((d): d is TrackDoc => d.kind === 'track').map(docToTrack);
    savedRoutes = docs.filter((d): d is RouteDoc => d.kind === 'route').sort((a, b) => b.updated - a.updated);
    refreshTracks();
  }

  async function loadStored() {
    await reloadLists();
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
    const hp = new URLSearchParams(location.hash.slice(1));
    const shared = hp.get('r');
    const fromLink = shared ? paramToRoute(shared) : null;
    const short = hp.get('s') ? await loadShort(hp.get('s')!) : null;
    if (short?.kind === 'route') {
      route.load({ ...short, id: newId('r'), updated: Date.now() });
      say(t('toast.fromLink'));
      fitPoints(short.waypoints);
      fitWhenReady = true;
    } else if (short?.kind === 'track') {
      const trk = docToTrack({ ...short, id: newId('t') });
      tracks = [...tracks, trk];
      saveDoc(trackToDoc(trk));
      zoomTo(trk);
      say(t('toast.trackFromLink'));
    } else if (fromLink) {
      route.load({ id: newId('r'), kind: 'route', name: '', checkpoints: [], updated: Date.now(), ...fromLink });
      say(t('toast.fromLink'));
      fitPoints(fromLink.waypoints);
      fitWhenReady = true;
    }
    // saved routes are not opened automatically: they are listed in My routes
    loaded = true;
    refreshTracks();
    whoami().then((u) => {
      user = u;
      if (u) runSync();
    });
  }

  /** A route opened from a link is fitted again once its legs are computed and the profile is shown. */
  let fitWhenReady = false;
  $effect(() => {
    if (!hasRoute || route.loading || !fitWhenReady) return;
    fitWhenReady = false;
    setTimeout(fitRoute, 60);
  });

  function fitRoute() {
    const pts = route.points.length > 1 ? route.points : route.waypoints;
    if (pts.length) fitPoints(pts);
  }

  function openRoute(r: RouteDoc) {
    saveRoute();
    route.load(r);
    fitPoints(r.waypoints);
    fitWhenReady = true;
  }

  function deleteRoute(r: RouteDoc) {
    if (!confirm(t('mine.confirmDelete', { name: r.name }))) return;
    deleteDoc(r.id);
    savedRoutes = savedRoutes.filter((x) => x.id !== r.id);
    if (r.id === route.docId) route.reset();
  }

  /** Deletes the route being edited (saved copy too), then starts a new one. */
  function deleteCurrent() {
    if (!route.waypoints.length) return;
    const name = route.name || route.autoName();
    if (!confirm(t('mine.confirmDelete', { name }))) return;
    if (savedRoutes.some((r) => r.id === route.docId)) {
      deleteDoc(route.docId);
      savedRoutes = savedRoutes.filter((x) => x.id !== route.docId);
    }
    route.reset();
    editing = false;
    say(t('route.deleted'));
  }

  function newRoute() {
    saveRoute();
    route.reset();
    editing = true;
  }

  async function shareRoute() {
    if (!route.waypoints.length) return;
    const doc = route.toDoc();
    const c = map!.getCenter();
    // logged in: a short link with everything (checkpoints, notes); otherwise the points go into the URL
    if (user) {
      try {
        const short = await shareShort(doc);
        await copy(short, t('toast.shortCopied'));
        return;
      } catch {
        /* fall back to the long link */
      }
    }
    const url =
      location.origin + location.pathname +
      formatHash({ zoom: map!.getZoom(), lat: c.lat, lng: c.lng, layers: [base, ...overlays] }) +
      '&r=' + encodeURIComponent(routeToParam(doc));
    await copy(url, t('toast.linkCopied', { n: url.length }));
  }

  async function copy(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      say(ok);
    } catch {
      prompt(t('toast.linkPrompt'), text);
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
      points: route.checkpoints.map((c) => ({ name: c.name, coord: [c.lng, c.lat], kind: c.kind, note: c.note })),
    };
    exportTrack(t);
  }

  let garminOpen = $state(false);
  function garminRoute() {
    if (route.points.length < 2) return null;
    const name = route.name || route.autoName();
    const t: Track = {
      id: 'route',
      name,
      lines: [route.points.map((p) => (p.ele != null ? [p.lng, p.lat, p.ele] : [p.lng, p.lat]))],
      points: [],
    };
    return { name, gpx: toGpx(t), profile: route.profile.replace('nk-', '') };
  }

  function exportFit() {
    if (route.points.length < 2) return;
    const name = route.name || route.autoName();
    const bytes = encodeCourse({
      name,
      sport: route.profile === 'nk-hike' ? 'hiking' : 'cycling',
      points: route.points,
      checkpoints: route.checkpoints,
    });
    download(new Blob([bytes as BlobPart], { type: 'application/vnd.ant.fit' }), `${name}.fit`);
  }

  function download(blob: Blob, filename: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- commands (toolbar, menu and shortcuts) ----
  const hasLegs = $derived(route.waypoints.length > 1);
  /** Leg for the "straight" switch: under the cursor, of the selected event, or the last one. */
  function targetLeg(useCursor: boolean): number | null {
    if (!hasLegs) return null;
    if (useCursor && cursorLeg != null) return cursorLeg;
    if (pinned) {
      const p = route.points[Math.min(pinned.i + 1, route.points.length - 1)];
      if (p) return p.leg;
    }
    return route.waypoints.length - 2;
  }
  const straightOn = $derived.by(() => {
    const l = targetLeg(false);
    return l != null && !!route.waypoints[l]?.straight;
  });

  function toggleEdit() {
    editing = !editing;
    if (!editing) placing = null;
  }
  function undo() {
    if (!route.canUndo) return say(t('toast.nothingUndo'));
    route.undo();
  }
  function redo() {
    if (!route.canRedo) return say(t('toast.nothingRedo'));
    route.redo();
  }
  function reverse() {
    if (!hasLegs) return;
    route.reverse();
    say(t('toast.reversed'));
  }
  function outAndBack() {
    if (!hasLegs) return;
    route.outAndBack();
    say(t('toast.outBack'));
  }
  function backToStart() {
    if (!hasLegs) return;
    route.backToStart();
    say(t('toast.backToStart'));
  }
  function toggleStraight(useCursor: boolean) {
    const l = targetLeg(useCursor);
    if (l == null) return;
    const on = !route.waypoints[l]?.straight;
    route.setLegStraight(l, on);
    say(t(on ? 'toast.legStraight' : 'toast.legRoads', { n: l + 1 }));
  }
  function toggleCheckpoint() {
    placing = placing === 'route' ? null : 'route';
  }

  const shortcuts = [
    { title: t('help.edit'), keys: [MOD, 'Enter'] },
    { title: t('help.undo'), keys: [MOD, 'Z'] },
    { title: t('help.redo'), keys: [MOD, '⇧', 'Z'], alt: [MOD, 'Y'] },
    { title: t('help.reverse'), keys: [MOD, 'B'] },
    { title: t('help.checkpoint'), keys: [MOD, 'K'] },
    { title: t('help.straight'), keys: [MOD, 'I'] },
    { title: t('help.layers'), keys: [MOD, 'G'] },
    { title: t('help.fit'), keys: [MOD, '0'] },
    { title: t('help.help'), keys: [MOD, '/'] },
    { title: t('help.removeLast'), keys: ['⌫'] },
    { title: t('help.escape'), keys: ['Esc'] },
  ];

  function escape(): boolean {
    if (layersOpen) return !(layersOpen = false);
    if (accountMenu?.isOpen()) return (accountMenu.close(), true);
    if (placing) return !(placing = null);
    if (pinned) return !(pinned = null);
    if (editing) return !(editing = false);
    return false;
  }

  function onKey(e: KeyboardEvent) {
    if (helpOpen || garminOpen) return; // dialogs handle their own keys
    const t = e.target as HTMLElement;
    const inField = !!t.closest?.('input:not([type=radio]):not([type=checkbox]):not([type=range]):not([type=file]), textarea, select, [contenteditable]');
    if (e.key === 'Escape') {
      if (inField) (t as HTMLElement).blur();
      else if (escape()) e.preventDefault();
      return;
    }
    if (inField) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) {
      if (editing && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        route.removeLast();
      }
      return;
    }
    if (e.altKey) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      toggleEdit();
      return;
    }
    switch (e.code) {
      case 'KeyZ': if (e.shiftKey) redo(); else undo(); break;
      case 'KeyY': redo(); break;
      case 'KeyB': reverse(); break;
      case 'KeyK': toggleCheckpoint(); break;
      case 'KeyI': toggleStraight(true); break;
      case 'KeyG': layersOpen = !layersOpen; break;
      case 'Digit0':
      case 'Numpad0': fitRoute(); break;
      case 'Slash': helpOpen = true; break;
      default: return;
    }
    e.preventDefault();
  }

  // ---- base map and overlays ----
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
      say(`${l.title}: ${(e as Error).message}`, true);
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

  const passesHelp = () => window.open(`${import.meta.env.BASE_URL}help/#passes`, '_blank', 'noopener');

  async function toggleOverlay(id: string) {
    if (layerById(id)?.vector === 'passes') {
      if (overlays.includes(id)) {
        overlays = overlays.filter((o) => o !== id);
        if (map) hidePasses(map);
      } else {
        overlays = [...overlays, id];
        if (map) await showPasses(map, 'tracks-line', passesHelp);
      }
      syncHash();
      return;
    }
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
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ lng: c.lng, lat: c.lat, zoom: map.getZoom() }));
    } catch {
      /* no storage */
    }
    history.replaceState(null, '', formatHash({ zoom: map.getZoom(), lat: c.lat, lng: c.lng, layers: [base, ...overlays] }));
  }

  function refreshTracks() {
    (map?.getSource('tracks') as maplibregl.GeoJSONSource | undefined)?.setData(trackToGeoJSON(tracks));
  }

  async function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      try {
        const trk = parseTrackFile(f.name, await f.text());
        tracks = [...tracks, trk];
        saveDoc(trackToDoc(trk));
        refreshTracks();
        zoomTo(trk);
        say(t('toast.trackAdded', { name: trk.name }));
      } catch (e) {
        say((e as Error).message, true);
      }
    }
  }

  function zoomTo(t: Track) {
    const b = bboxOf(t);
    if (b && map) map.fitBounds(b, { padding: padding(), maxZoom: 15 });
  }

  function exportTrack(t: Track) {
    const blob = new Blob([toGpx(t)], { type: 'application/gpx+xml' });
    download(blob, `${t.name || 'track'}.gpx`);
  }

  function removeTrack(tr: Track) {
    if (!confirm(t('mine.confirmDeleteTrack', { name: tr.name }))) return;
    tracks = tracks.filter((x) => x.id !== tr.id);
    deleteDoc(tr.id);
    refreshTracks();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  }

  const VIEW_KEY = 'nk-view';
  const lastView: { lng: number; lat: number; zoom: number } | null = (() => {
    try {
      return JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    } catch {
      return null;
    }
  })();

  /** First visit without a view in the URL: open the map on the visitor's city (by IP, on our server). */
  async function cityView() {
    if (initial.zoom != null || lastView || new URLSearchParams(location.hash.slice(1)).has('r')) return;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/where`);
      if (r.status !== 200) return;
      const { lat, lon } = await r.json();
      if (map && !route.waypoints.length) map.jumpTo({ center: [lon, lat], zoom: 11 });
    } catch {
      /* stays on Europe */
    }
  }

  onMount(() => {
    registerYandexProtocol();
    cityView();
    map = new maplibregl.Map({
      container,
      style: { version: 8, sources: {}, layers: [] },
      // URL view, else the last view in this browser, else the visitor's city (below), else Europe
      center: [initial.lng ?? lastView?.lng ?? 10, initial.lat ?? lastView?.lat ?? 50],
      zoom: initial.zoom ?? lastView?.zoom ?? 3.5,
      attributionControl: { compact: true },
      maxPitch: 0,
      dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

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
      editor = new RouteEditor(map!, route);
      editor.onMapClick = placeCheckpoint;
      cpLayer = new CheckpointLayer(map!, {
        update: (it, patch) => (it.owner === 'route' ? route.updateCheckpoint(it.id, patch) : updateTrackPoint(it, patch)),
        remove: (it) => (it.owner === 'route' ? route.removeCheckpoint(it.id) : removeTrackPoint(it)),
      });
      cpLayer.set(checkpointItems);
      // the route line under the mouse: highlight the place in the profile and the timeline
      map!.on('mousemove', 'route-hit', (e) => {
        if (e.originalEvent.buttons) return;
        const f = e.features?.[0];
        cursorLeg = f ? Number(f.properties?.leg ?? 0) : null;
        const pts = route.points;
        if (pts.length < 2) return;
        const n = nearestPoint(pts, e.lngLat.lng, e.lngLat.lat);
        if (n.i >= 0) setHover(n.i, 'map');
      });
      map!.on('mouseleave', 'route-hit', () => {
        cursorLeg = null;
        setHover(null, 'map');
      });
      // base map first, stored data after: the map should not wait for IndexedDB
      const layersReady = (async () => {
        await showRaster(layerById(base) ?? layerById(DEFAULT_BASE)!, 'tracks-line');
        for (const id of overlays) {
          const l = layerById(id)!;
          if (l.vector === 'passes') await showPasses(map!, 'tracks-line', passesHelp);
          else await showRaster(l, 'tracks-line');
        }
      })();
      await loadStored();
      await layersReady;
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

  // close the layers popover on a click elsewhere
  let layersBox: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (!layersOpen) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (layersBox?.contains(t) || t.closest?.('[aria-controls="nk-layers"]')) return;
      layersOpen = false;
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  });

  const hasRoute = $derived(route.points.length > 1);
  const optSummary = $derived.by(() => {
    const o = route.options;
    const parts = [o.surface === -1 ? t('set.sumAsphalt') : o.surface === 1 ? t('set.sumDirt') : t('set.sumAny')];
    if (!o.maxGrade) parts.push(o.climbs === 'less' ? t('set.sumLess') : o.climbs === 'any' ? t('set.sumAnyClimbs') : t('set.sumNormal'));
    parts.push(o.maxGrade ? t('set.sumUpTo', { g: o.maxGrade }) : t('set.sumNoLimit'));
    if (o.cycleways && route.profile !== 'nk-hike') parts.push(t('set.sumCycleways'));
    return parts.join(' · ');
  });
</script>

<svelte:window onkeydown={onKey} />
<div class="app" role="application" ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
  <aside class="side" aria-label={t('route.panel')}>
    <div class="head">
      <picture class="logo">
        <source srcset="{import.meta.env.BASE_URL}brand/symbol-colour-dark.svg" media="(prefers-color-scheme: dark)" />
        <img src="{import.meta.env.BASE_URL}brand/symbol-colour.svg" alt="Na Carta" width="81" height="28" />
      </picture>
      <AccountMenu bind:this={accountMenu} {user} {syncState} onlogin={login} onlogout={logout} onsync={runSync} />
    </div>
    <div class="titlerow">
    <input
      class="title"
      value={route.name}
      placeholder={route.waypoints.length ? route.autoName() : t('route.newName')}
      aria-label={t('route.nameLabel')}
      spellcheck="false"
      onchange={(e) => route.rename(e.currentTarget.value)}
      onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
    {#if route.waypoints.length}
      <button class="del" onclick={deleteCurrent} aria-label={t('route.delete')} data-tip={t('route.delete')}><Icon name="trash" size={18} /></button>
    {/if}
    </div>
    <Segmented name="kind" label={t('route.typeLabel')} value={route.profile}
      items={PROFILES.map((p) => [p.id, p.title] as const)}
      onchange={(v) => route.setProfile(v as ProfileId)} />

    {#if hasRoute}
      <RouteSummary profile={route.profileData} profileId={route.profile} {classes} loading={route.loading} error={route.error?.error ?? ''} />
      {#if mobile}
        <ProfileCard bind:open={showProfile} mobile profile={route.profileData} {classes} marks={profileMarks}
          maxGrade={route.options.maxGrade} hoverIdx={markerIdx} band={hoverBand ?? pinnedBand}
          onhover={(i) => setHover(i, 'prof')} onpick={pickProfile} />
      {/if}
    {:else if route.loading}
      <p class="soft">{t('route.computing')}</p>
    {:else if route.error}
      <p class="errline" role="alert">{t('route.error', { error: route.error.error })}</p>
    {/if}

    <Fold id="nk-settings" title={t('set.title')} summary={optSummary} bind:open={settingsOpen}>
      <RouteSettings options={route.options} hike={route.profile === 'nk-hike'} onchange={setOpt} />
    </Fold>

    {#if events.length}
      <Timeline {events} profile={route.profileData} {classes} {activeD} pinnedId={pinned?.id ?? null} {mobile}
        onhover={onTimelineHover} onpick={pickEvent} />
    {:else}
      <div class="empty">
        <p>{t('route.empty1')}
          <button class="inl" onclick={toggleEdit}><Icon name="edit" size={14} /></button>
          (<kbd>{MOD}</kbd> <kbd>Enter</kbd>) {t('route.empty2')}</p>
        <p>{t('route.emptyFiles')}</p>
      </div>
    {/if}

    <div class="acts">
      <button class="garmin" disabled={!hasRoute} onclick={() => (garminOpen = true)}>
        <Icon name="watch" size={22} /><span>{t('act.garmin')}</span><span class="beta">{t('act.beta')}</span>
      </button>
      <div class="sec3">
        <button class="sbtn" disabled={!route.waypoints.length} onclick={shareRoute}>{t('act.share')}</button>
        <button class="sbtn" disabled={!hasRoute} onclick={exportRoute} data-tip={t('act.gpxTip')}>GPX</button>
        <button class="sbtn" disabled={!hasRoute} onclick={exportFit} data-tip={t('act.fitTip')}>FIT</button>
      </div>
      <Fold id="nk-mine" title={t('mine.title')} summary={t('mine.saved', { n: savedRoutes.length + tracks.length })} bind:open={mineOpen}>
        <div class="mine-scroll">
          <MyRoutes routes={savedRoutes} {tracks} currentId={route.docId} {placing}
            onopen={openRoute} ondelete={deleteRoute} onnew={newRoute} onopenfile={() => fileInput.click()}
            onzoomtrack={zoomTo} onexporttrack={exportTrack} onremovetrack={removeTrack}
            onplace={(id) => (placing = placing === id ? null : id)} />
        </div>
      </Fold>
    </div>
    <input bind:this={fileInput} class="hidden" type="file" accept=".gpx,.kml" multiple
      onchange={(e) => { addFiles(e.currentTarget.files!); e.currentTarget.value = ''; }} />
  </aside>

  <main class="mapcol" style="--prof-h:{mobile || !hasRoute ? 0 : profH + 12}px">
    <div class="map" bind:this={container}></div>
    <Toolbar {editing} canUndo={route.canUndo} canRedo={route.canRedo} hasRoute={route.waypoints.length > 0} canLoop={hasLegs}
      {straightOn} placing={placing === 'route'} {layersOpen}
      onedit={toggleEdit} onundo={undo} onredo={redo} onreverse={reverse} onoutback={outAndBack} onbacktostart={backToStart}
      onstraight={() => toggleStraight(false)} oncheckpoint={toggleCheckpoint} onlayers={() => (layersOpen = !layersOpen)}
      onfit={fitRoute} onhelp={() => (helpOpen = true)} />
    {#if layersOpen}
      <div bind:this={layersBox}>
        <LayersPopover {base} {overlays} {colorMode} onbase={setBase} onoverlay={toggleOverlay}
          oncolormode={(m) => (colorMode = m)} onclose={() => (layersOpen = false)} />
      </div>
    {/if}
    {#if editing && !layersOpen}
      <div class="ehint" role="note">
        {#if mobile}
          {t('hint.editTouch', { where: route.prepend ? t('hint.atStart') : '' })}
        {:else}
          {t('hint.edit', { where: route.prepend ? t('hint.atStart') : '', key: 'Backspace' })}
        {/if}
      </div>
    {/if}
    {#if hasRoute && !mobile}
      <div class="profwrap" bind:offsetHeight={profH}>
        <ProfileCard bind:open={showProfile} profile={route.profileData} {classes} marks={profileMarks}
          maxGrade={route.options.maxGrade} hoverIdx={markerIdx} band={hoverBand ?? pinnedBand}
          onhover={(i) => setHover(i, 'prof')} onpick={pickProfile} />
      </div>
    {/if}
    {#if placing}
      <div class="toast" role="status">{t('hint.placing')}</div>
    {:else if toast}
      <div class="toast" class:err={toastErr} role="status">{toast}</div>
    {/if}
  </main>

  <GarminDialog bind:open={garminOpen} loggedIn={!!user} getRoute={garminRoute} onlogin={login} />
  <HelpDialog bind:open={helpOpen} {shortcuts} />
  <KeyTip />
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 36px;
    flex: none;
  }
  .logo {
    display: block;
    line-height: 0;
  }
  .logo img {
    height: 28px;
    width: auto;
  }
  .titlerow {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .titlerow .title {
    flex: 1;
    min-width: 0;
    width: auto;
    margin-right: 0;
  }
  .del {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    color: var(--soft);
  }
  .del:hover {
    background: var(--tint);
    color: #c0262d;
  }
  .title {
    flex: none;
    border: 0;
    border-radius: 10px;
    background: transparent;
    padding: 6px 8px;
    margin: 0 -8px;
    width: calc(100% + 16px);
    font: 650 18px/1.2 var(--sans);
    letter-spacing: -0.015em;
    color: var(--ink);
    text-overflow: ellipsis;
  }
  .title::placeholder {
    color: var(--soft);
  }
  .title:hover {
    background: var(--tint);
  }
  .title:focus {
    background: var(--tint);
    outline: 2px solid var(--ink);
  }
  .soft {
    margin: 0;
    color: var(--soft);
    font-size: 13px;
  }
  .errline {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }
  .empty {
    flex: 1;
    min-height: 0;
    font-size: 13px;
    color: var(--soft);
    padding: 4px 2px;
  }
  .empty p {
    margin: 0 0 8px;
    line-height: 1.6;
  }
  .inl {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: var(--tint);
    color: var(--ink);
    vertical-align: middle;
  }
  .inl:hover {
    background: var(--tint2);
  }
  .acts {
    display: grid;
    gap: 8px;
    flex: none;
  }
  .garmin {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 42px;
    border-radius: 12px;
    font-weight: 600;
    font-size: 14.5px;
    box-shadow: inset 0 0 0 1.5px var(--ink);
  }
  .garmin:hover:not(:disabled) {
    background: var(--tint);
  }
  .garmin:active:not(:disabled) {
    background: var(--tint2);
  }
  .beta {
    font: 600 10.5px/1 var(--mono);
    letter-spacing: 0.02em;
    padding: 3px 6px;
    border-radius: 999px;
    background: var(--tint2);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .sec3 {
    display: grid;
    grid-template-columns: 1.6fr 1fr 1fr;
    gap: 6px;
  }
  .sbtn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 34px;
    border-radius: 10px;
    background: var(--tint);
    font-weight: 500;
    font-size: 13px;
  }
  .sbtn:hover:not(:disabled) {
    background: var(--tint2);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .mine-scroll {
    max-height: min(38vh, 330px);
    overflow: auto;
    margin: 0 -4px;
    padding: 0 4px;
  }
  .hidden {
    display: none;
  }
  .profwrap {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    z-index: 3;
  }
  @media (max-width: 639px) {
    .mine-scroll {
      max-height: none;
    }
  }
</style>

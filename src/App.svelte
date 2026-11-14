<script lang="ts">
  import * as maplibregl from 'maplibre-gl';
  type MlMap = maplibregl.Map;
  import { onMount, untrack } from 'svelte';
  import { DEFAULT_BASE, baseForProfile, layerById, type LayerDef } from './lib/layers';
  import { registerYandexProtocol } from './lib/yandex';
  import { registerGpsHeatProtocol } from './lib/gpsheat';
  import { registerRwHeatProtocol } from './lib/rwheat';
  import { parseHash, formatHash } from './lib/hash';
  import { parseTrackFile, toGpx, trackToGeoJSON, bboxOf, type Track } from './lib/gpx';
  import { RouteState } from './lib/route.svelte';
  import { RouteEditor, type ColorMode } from './lib/routeEditor';
  import { PROFILES, normalizeProfile, ALLOW_KEYS, ALLOW_FOR, type AllowKey, type ProfileId, type RouteOptions } from './lib/brouter';
  import { store, newId, type RouteDoc, type TrackDoc } from './lib/store';
  import Orbit3d from './ui/Orbit3d.svelte';
  import NameDialog from './ui/NameDialog.svelte';
  import { suggestNames } from './lib/routeNames';
  import { trackToRoute, profileForActivity } from './lib/trackRoute';
  import { routeToParam, paramToRoute } from './lib/share';
  import { showPasses, hidePasses } from './lib/passes';
  import { CheckpointLayer, type CheckpointItem } from './lib/checkpoints';
  import { whoami, login, logout, sync, remote, shareShort, snapshot, loadShort, type User, loginAuthelia, deleteAccount } from './lib/account';
  import type { Doc } from './lib/store';
  import { buildTimeline, nearestPoint, segmentClasses, type TimelineEvent } from './lib/timeline';
  import GarminDialog from './ui/GarminDialog.svelte';
  import AccountMenu from './ui/AccountMenu.svelte';
  import RouteSummary from './ui/RouteSummary.svelte';
  import RouteSettings from './ui/RouteSettings.svelte';
  import Segmented from './ui/Segmented.svelte';
  import Fold from './ui/Fold.svelte';
  import Timeline from './ui/Timeline.svelte';
  import ConsentBanner from './ui/ConsentBanner.svelte';
  import { initAnalytics, storedConsent, track, kmBucket } from './lib/analytics';
  import MyRoutes from './ui/MyRoutes.svelte';
  import Toolbar from './ui/Toolbar.svelte';
  import LayersPopover from './ui/LayersPopover.svelte';
  import InlineConfirm from './ui/InlineConfirm.svelte';
  import PoiMenu from './ui/PoiMenu.svelte';
  import PhotoViewer from './ui/PhotoViewer.svelte';
  import { AlongLayer, CATS, catDef, catTitle, fetchPois, fetchSprings, photoGroups, PhotoLoader, PHOTO_MIN_ZOOM, PHOTO_SOURCES, type PhotoSource, type Photo, type Poi, type PoiCat } from './lib/along';
  import HelpDialog from './ui/HelpDialog.svelte';
  import ProfileCard from './ui/ProfileCard.svelte';
  import KeyTip from './ui/KeyTip.svelte';
  import Icon from './ui/Icon.svelte';
  import { MOD, isMac } from './ui/icons';
  import { t } from './lib/i18n';

  let container: HTMLDivElement;
  let map: MlMap | undefined;

  const initial = parseHash(location.hash);
  // the hash as opened: syncHash() rewrites location.hash on the first map move, which can come
  // before the stored routes are read, and would drop a route link (r=, s=) from it
  const openedHash = location.hash;
  /** a short link that could not be loaded (kept in the address for a reload) */
  let pendingShort: string | null = null;
  const initLayers = (initial.layers ?? []).filter((id) => layerById(id));
  let base = $state(initLayers.find((id) => layerById(id)?.kind === 'base') ?? DEFAULT_BASE);
  let overlays = $state<string[]>(initLayers.filter((id) => layerById(id)?.kind === 'overlay'));
  let tracks = $state<Track[]>([]);
  /** Pinned layers panel stays open (to flip between map and satellite) and is remembered. */
  let layersPinned = $state(readFlag('nk-layers-pinned'));
  /** Open menu at the top right: base map or overlays; a pinned one reopens after reload. */
  let layersMenu = $state<'base' | 'over' | 'poi' | null>(readMenu());
  const layersOpen = $derived(layersMenu != null);
  function readMenu(): 'base' | 'over' | 'poi' | null {
    try {
      const m = localStorage.getItem('nk-layers-menu');
      return readFlag('nk-layers-pinned') && (m === 'base' || m === 'over' || m === 'poi') ? m : null;
    } catch {
      return null;
    }
  }
  function openMenu(m: 'base' | 'over' | 'poi') {
    layersMenu = layersMenu === m ? null : m;
    try {
      if (layersMenu) localStorage.setItem('nk-layers-menu', layersMenu);
    } catch {
      /* ignore */
    }
  }
  function readFlag(k: string) {
    try {
      return localStorage.getItem(k) === '1';
    } catch {
      return false;
    }
  }
  function togglePin() {
    layersPinned = !layersPinned;
    try {
      localStorage.setItem('nk-layers-pinned', layersPinned ? '1' : '0');
    } catch {
      /* ignore */
    }
  }
  let helpOpen = $state(false);

  const route = new RouteState();
  let editor = $state<RouteEditor>();
  let editing = $state(false);
  let colorMode = $state<ColorMode>('grade');
  let showProfile = $state(true);
  let settingsOpen = $state(false);
  let mineOpen = $state(false);
  function setOpt(patch: Partial<RouteOptions>) {
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'allow') {
        for (const [a, on] of Object.entries(v as Record<string, boolean>))
          if (route.options.allow[a as keyof typeof route.options.allow] !== on) track('setting_change', { name: `allow_${a}`, value: on ? 'on' : 'off' });
      } else track('setting_change', { name: k === 'bigRoads' ? 'big_roads' : k === 'maxGrade' ? 'max_grade' : k, value: typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v) });
    }
    route.setOptions({ ...route.options, ...patch });
  }
  // the cookie question: shown until answered, reopened from the account menu
  let consentOpen = $state(storedConsent() === null);
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

  // phone layout: full-screen map, the panel as a bottom sheet that collapses to a strip
  const mq = matchMedia('(max-width: 639px), (max-height: 480px) and (orientation: landscape)');
  let mobile = $state(mq.matches);
  let sheetOpen = $state(false);
  /** Swipe on the handle: up opens, down collapses; a short move counts as a tap. */
  function grabStart(e: PointerEvent) {
    const y0 = e.clientY;
    const up = (ev: PointerEvent) => {
      removeEventListener('pointerup', up);
      const dy = ev.clientY - y0;
      if (dy < -30) sheetOpen = true;
      else if (dy > 30) sheetOpen = false;
    };
    addEventListener('pointerup', up);
  }
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
  // ---- points of interest and photos along the route (lib/along.ts) ----
  function readPoi<T>(k: string, def: T): T {
    try {
      const v = localStorage.getItem(`nk-poi-${k}`);
      return v == null ? def : (JSON.parse(v) as T);
    } catch {
      return def;
    }
  }
  function setPoiPref(k: string, v: unknown) {
    try {
      localStorage.setItem(`nk-poi-${k}`, JSON.stringify(v));
    } catch {
      /* no storage */
    }
  }
  let poiCats = $state<PoiCat[]>(readPoi<PoiCat[]>('cats', CATS.filter((c) => c.def).map((c) => c.id)).filter((c) => CATS.some((d) => d.id === c)));
  let poiRadius = $state<number>(readPoi('radius', 300));
  let poiTimeline = $state<boolean>(readPoi('timeline', true));
  let photoSrc = $state<PhotoSource[]>(readPoi<PhotoSource[]>('photoSrc', PHOTO_SOURCES).filter((x) => PHOTO_SOURCES.includes(x)));
  let pois = $state<Poi[]>([]);
  let photos = $state<Photo[]>([]);
  let poiLoading = $state(false);
  let poisLoaded = $state(false);
  let poiError = $state('');
  let along: AlongLayer | null = null;
  let dimBox: HTMLDivElement | undefined = $state();
  // where the map controls block starts, so that open menus stop above it, and where the layer
  // buttons end, so that the block (growing in 3D) stays below them
  let ctlTop = $state(400);
  let btnsBottom = $state(0);
  function measureControls() {
    if (!dimBox) return;
    const col = dimBox.closest('.mapcol')?.getBoundingClientRect();
    ctlTop = Math.round(dimBox.getBoundingClientRect().top - (col?.top ?? 0));
    const b = document.querySelector('.layersbtns')?.getBoundingClientRect();
    btnsBottom = b ? Math.round(b.bottom + 8) : 0;
  }
  $effect(() => {
    if (!dimBox) return;
    const ro = new ResizeObserver(measureControls);
    ro.observe(dimBox);
    ro.observe(document.body);
    measureControls();
    return () => ro.disconnect();
  });
  $effect(() => {
    void profH, void hasRoute, void terrain3d;
    requestAnimationFrame(measureControls);
  });
  let photosOpen = $state(false);
  /** photo viewer: index into `photos`, null when closed */
  let viewer = $state<number | null>(null);
  function openPhoto(p: Photo) {
    track('photo_open', { src: p.src });
    const i = photos.findIndex((x) => x.id === p.id);
    viewer = i >= 0 ? i : 0;
  }
  function togglePoiCat(c: PoiCat) {
    track('poi_toggle', { id: c, on: !poiCats.includes(c) });
    poiCats = poiCats.includes(c) ? poiCats.filter((x) => x !== c) : [...poiCats, c];
    setPoiPref('cats', poiCats);
  }
  const visiblePois = $derived(pois.filter((p) => poiCats.includes(p.cat)));
  const photosOn = $derived(poiCats.includes('photos'));
  const poiCounts = $derived.by(() => {
    const c: Partial<Record<PoiCat, number>> = {};
    if (poisLoaded) for (const d of CATS) if (d.id !== 'photos') c[d.id] = 0;
    for (const p of pois) c[p.cat] = (c[p.cat] ?? 0) + 1;
    if (photos.length || photosOn) c.photos = photos.length;
    return c;
  });
  // points: fetched once the route is computed (and again when it changes), only when wanted
  $effect(() => {
    const ready = route.points.length > 1 && !route.loading;
    const wantPois = layersMenu === 'poi' || poiCats.some((c) => c !== 'photos');
    const pts = route.points, r = poiRadius;
    if (!ready) {
      if (route.points.length < 2) pois = [];
      return;
    }
    if (!wantPois) return;
    const timer = setTimeout(async () => {
      poiLoading = true;
      poiError = '';
      try {
        pois = await fetchPois(pts, r);
        poisLoaded = true;
        // springs come from Overpass, often slow: added when they arrive, nothing waits for them
        if (poiCats.includes('water'))
          fetchSprings(pts, r).then((sp) => {
            if (route.points !== pts || !sp.length) return;
            const have = new Set(pois.map((p) => p.id));
            pois = [...pois, ...sp.filter((p) => !have.has(p.id))].sort((a, b) => a.m - b.m);
          });
      } catch (e) {
        poiError = t('poi.failed', { error: (e as Error).message });
      } finally {
        poiLoading = false;
      }
    }, 900);
    return () => clearTimeout(timer);
  });

  // photos: only for the part of the route on screen, from zoom PHOTO_MIN_ZOOM (lib/along.ts)
  let photoLoader: PhotoLoader | null = null;
  let mapZoom = $state(0);
  $effect(() => {
    const ready = route.points.length > 1 && !route.loading;
    const pts = route.points, src = photoSrc;
    photoLoader = ready ? new PhotoLoader(pts, src) : null;
    photos = [];
    if (ready && photosOn) queueMicrotask(loadPhotosInView);
  });
  async function loadPhotosInView() {
    if (!map) return;
    mapZoom = map.getZoom();
    const loader = photoLoader;
    if (!loader || !photosOn || mapZoom < PHOTO_MIN_ZOOM) return;
    const b = map.getBounds();
    // keep loading while the view has pieces left (4 per round)
    while (loader === photoLoader && (await loader.loadVisible({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() }))) {
      if (loader === photoLoader) photos = loader.photos;
    }
  }
  $effect(() => {
    if (photosOn) loadPhotosInView();
  });

  $effect(() => {
    const vp = visiblePois, ph = photosOn ? photos : [];
    along?.set(vp, ph);
  });

  const baseEvents = $derived(buildTimeline({ points: route.points, profile: route.profileData, checkpoints: route.checkpoints }));
  const events = $derived.by(() => {
    if (!poiTimeline || !visiblePois.length || !baseEvents.length) return baseEvents;
    // cafes and shops: at most one row per 5 km, the town is full of them
    let lastFood = -Infinity;
    const extra: TimelineEvent[] = [];
    for (const p of visiblePois) {
      if (p.cat === 'eat' || p.cat === 'shop') {
        if (p.m - lastFood < 5000) continue;
        lastFood = p.m;
      }
      const dense = p.cat === 'eat' || p.cat === 'shop' || p.cat === 'sight';
      extra.push({ id: `poi:${dense ? 'dense:' : ''}${p.id}`, kind: 'poi', i: p.i, d: p.m, label: ((k) => (p.tags.name ? `${k} · ${p.tags.name}` : k))(p.kind === 'spring' ? t('poi.spring') : catTitle(p.cat)), icon: catDef(p.cat).icon, priority: p.cat === 'water' ? 1 : p.cat === 'repair' || p.cat === 'fuel' ? 2 : 3, weight: 0 });
    }
    const end = baseEvents.at(-1)!;
    return [...baseEvents.slice(0, -1), ...extra].sort((a, b) => a.d - b.d || (a.kind === 'start' ? -1 : 0)).concat(end);
  });
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
    track('timeline_pick', { kind: e.kind });
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
    try {
      sessionStorage.setItem('nk-current', doc.id);
    } catch {
      /* ignore */
    }
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
      activity: t.activity,
      routeId: t.routeId,
      updated: Date.now(),
    };
  }
  function docToTrack(d: TrackDoc): Track {
    return {
      id: d.id,
      name: d.name,
      lines: d.lines,
      points: d.checkpoints.map((c) => ({ id: c.id, name: c.name, coord: [c.lng, c.lat], kind: c.kind, note: c.note })),
      activity: d.activity,
      routeId: d.routeId,
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
    const hp = new URLSearchParams(openedHash.slice(1));
    if (hp.get('signin') === 'failed') say(t('acc.signinFailed'), true);
    const shared = hp.get('r');
    const fromLink = shared ? paramToRoute(shared) : null;
    const got = hp.get('s') ? await loadShort(hp.get('s')!) : null;
    // a link that could not be opened says so instead of showing an empty route
    if (got) track('link_open', { kind: 'short', value: typeof got === 'object' ? 'ok' : got === 'missing' ? 'missing' : 'error' });
    // a reload of a tab with its own route in the address is not a link someone opened
    else if (hp.get('r') && !(fromLink && sameSaved(fromLink))) track('link_open', { kind: 'long', value: 'ok' });
    if (got === 'missing') say(t('toast.linkMissing'), true);
    else if (got === 'failed') {
      say(t('toast.linkFailed'), true);
      pendingShort = hp.get('s');
    }
    const short = typeof got === 'object' ? got : null;
    if (short?.kind === 'route') {
      // our own route (e.g. back from sign-in) or one already saved from this link opens as the saved copy;
      // only a route we do not have yet becomes a new one
      const mine = savedRoutes.find((r) => r.id === short.id) ?? sameSaved(short);
      if (mine) route.load(ownDoc(mine));
      else {
        route.load({ ...short, id: newId('r'), updated: Date.now() });
        say(t('toast.fromLink'));
      }
      openedShort = { id: hp.get('s')!, param: routeParam() };
      fitPoints(short.waypoints);
      fitWhenReady = true;
      if (hp.get('g') === '1') garminOpen = true;
    } else if (short?.kind === 'track') {
      const trk = docToTrack({ ...short, id: newId('t') });
      tracks = [...tracks, trk];
      saveDoc(trackToDoc(trk));
      zoomTo(trk);
      say(t('toast.trackFromLink'));
    } else if (fromLink) {
      const saved = sameSaved(fromLink);
      if (saved) route.load(ownDoc(saved));
      else {
        route.load({ id: newId('r'), kind: 'route', name: '', checkpoints: [], updated: Date.now(), ...fromLink });
        say(t('toast.fromLink'));
      }
      fitPoints(fromLink.waypoints);
      fitWhenReady = true;
    }
    // saved routes are not opened automatically (they are listed in My routes), except the one
    // this tab was editing: a reload must not lose it
    if (!short && !fromLink) {
      try {
        const cur = sessionStorage.getItem('nk-current');
        const doc = cur ? savedRoutes.find((r) => r.id === cur) : null;
        if (doc) route.load(ownDoc(doc));
      } catch {
        /* ignore */
      }
    }
    loaded = true;
    refreshTracks();
    whoami().then((u) => {
      user = u;
      if (u) runSync();
    });
  }

  /** A saved route with the same profile, points (to ~1 m) and options, so opening a link twice does not duplicate it. */
  function sameSaved(d: Pick<RouteDoc, 'profile' | 'waypoints' | 'params'>): RouteDoc | undefined {
    const key = (x: Pick<RouteDoc, 'profile' | 'waypoints' | 'params'>) =>
      normalizeProfile(x.profile ?? '') + '|' +
      x.waypoints.map((w) => `${w.lng.toFixed(5)},${w.lat.toFixed(5)}${w.straight ? 's' : ''}`).join(';') + '|' +
      JSON.stringify(Object.entries(x.params ?? {}).sort());
    const k = key(d);
    return savedRoutes.find((r) => key(r) === k);
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

  /** a saved route made from an imported track keeps the track's line: never routed again
   *  (routes made before RouteDoc.routing existed are known by the track that points to them) */
  function ownDoc(d: RouteDoc): RouteDoc {
    return d.routing || !tracks.some((x) => x.routeId === d.id) ? d : { ...d, routing: 'track' };
  }

  function openRoute(r: RouteDoc) {
    track('routes_open');
    saveRoute();
    route.load(ownDoc(r));
    fitPoints(r.waypoints);
    fitWhenReady = true;
  }

  /** Opens an imported track as a route: its own line and elevation, surfaces from the map. */
  let openingTrack = $state(false);
  async function openTrack(tr: Track) {
    const made = tr.routeId ? savedRoutes.find((r) => r.id === tr.routeId) : undefined;
    if (made) return openRoute(made);
    if (openingTrack) return;
    openingTrack = true;
    zoomTo(tr);
    try {
      // older imports kept no activity; Strava and Garmin put it into the name ("Morning Hike")
      const profile = profileForActivity(tr.activity ?? tr.name, route.profile);
      const built = await trackToRoute(tr.lines, profile, {});
      const doc: RouteDoc = {
        id: newId('r'),
        kind: 'route',
        routing: 'track',
        name: tr.name,
        profile,
        params: {},
        waypoints: built.waypoints,
        checkpoints: tr.points.map((p) => ({ id: p.id ?? newId('c'), lng: p.coord[0], lat: p.coord[1], kind: p.kind ?? 'generic', name: p.name, note: p.note })),
        legs: built.legs,
        created: Date.now(),
        updated: Date.now(),
      };
      saveDoc(doc);
      savedRoutes = [doc, ...savedRoutes];
      tracks = tracks.map((x) => (x.id === tr.id ? { ...x, routeId: doc.id } : x));
      saveDoc(trackToDoc({ ...tr, routeId: doc.id }));
      openRoute(doc);
      say(t('toast.trackOpened', { pct: Math.round(built.matched * 100) }));
    } catch (e) {
      say((e as Error).message, true);
    } finally {
      openingTrack = false;
    }
  }

  function deleteRoute(r: RouteDoc) {
    deleteDoc(r.id);
    savedRoutes = savedRoutes.filter((x) => x.id !== r.id);
    if (r.id === route.docId) route.reset();
  }

  async function removeAccount() {
    try {
      await deleteAccount();
    } catch (e) {
      say((e as Error).message, true);
    }
  }

  let askDelete = $state(false);
  /** Deletes the route being edited (saved copy too), then starts a new one. */
  function deleteCurrent() {
    if (!route.waypoints.length) return;
    askDelete = false;
    if (savedRoutes.some((r) => r.id === route.docId)) {
      deleteDoc(route.docId);
      savedRoutes = savedRoutes.filter((x) => x.id !== route.docId);
    }
    route.reset();
    editing = false;
    say(t('route.deleted'));
  }

  /**
   * Cuts the route at a point of a segment into two routes. The first stays open under
   * the same id, the second is saved to My routes. Checkpoints go to the part they are on.
   */
  function splitRoute(leg: number, lng: number, lat: number) {
    if (!route.waypoints[leg + 1]) return;
    const name = route.name || route.autoName();
    const doc = route.toDoc();
    const wps = doc.waypoints;
    const cut = { lng, lat, straight: wps[leg].straight };
    // nearest computed point to each checkpoint and to the cut decides its part
    const pts = route.points;
    const near = (q: { lng: number; lat: number }) => {
      let bi = 0, bd = Infinity;
      pts.forEach((p, i) => {
        const d = (p.lng - q.lng) ** 2 + (p.lat - q.lat) ** 2;
        if (d < bd) (bd = d), (bi = i);
      });
      return bi;
    };
    const at = near(cut);
    const first: RouteDoc = {
      ...doc,
      name: `${name} · 1`,
      waypoints: [...wps.slice(0, leg + 1), { lng, lat }],
      checkpoints: doc.checkpoints.filter((c) => near(c) <= at),
      legs: undefined,
      updated: Date.now(),
    };
    const second: RouteDoc = {
      ...doc,
      id: newId('r'),
      name: `${name} · 2`,
      waypoints: [cut.straight ? cut : { lng, lat }, ...wps.slice(leg + 1)],
      checkpoints: doc.checkpoints.filter((c) => near(c) > at),
      legs: undefined,
      updated: Date.now(),
    };
    saveDoc(second);
    route.load(first); // unchanged legs come from the request cache
    saveRoute();
    savedRoutes = [first, second, ...savedRoutes.filter((r) => r.id !== first.id && r.id !== second.id)];
    say(t('split.done', { a: first.name, b: second.name }));
  }

  /** Copy of the route from the start to a point of a segment, opened for editing; the original is saved as is. */
  function copyUpTo(leg: number, lng: number, lat: number) {
    saveRoute();
    const doc = route.toDoc();
    const name = `${doc.name} · ${t('copy.suffix')}`;
    route.load({
      ...doc,
      id: newId('r'),
      name,
      waypoints: [...doc.waypoints.slice(0, leg + 1), { lng, lat }],
      checkpoints: [],
      legs: undefined,
      updated: Date.now(),
    });
    editing = true;
    saveRoute();
    say(t('copy.done', { name }));
  }

  function newRoute() {
    if (needName(newRoute)) return;
    saveRoute();
    route.reset();
    editing = true;
  }

  async function shareRoute() {
    if (!route.waypoints.length) return;
    if (needName(shareRoute)) return;
    const doc = route.toDoc();
    const c = map!.getCenter();
    // a short link to a snapshot on the server, with the computed route; the long link is a fallback
    try {
      const short = await shareShort(doc);
      await copy(short, t('toast.shortCopied'));
      track('link_copy', { kind: 'short', profile: route.profile });
      return;
    } catch {
      /* fall back to the long link */
    }
    const url =
      location.origin + location.pathname +
      formatHash({ zoom: map!.getZoom(), lat: c.lat, lng: c.lng, layers: [base, ...overlays] }) +
      '&r=' + encodeURIComponent(routeToParam(doc));
    await copy(url, t('toast.linkCopied', { n: url.length }));
    track('link_copy', { kind: 'long', profile: route.profile });
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
    if (needName(exportRoute)) return;
    const name = route.name || route.autoName();
    const t: Track = {
      id: 'route',
      name,
      lines: [route.points.map((p) => (p.ele != null ? [p.lng, p.lat, p.ele] : [p.lng, p.lat]))],
      points: route.checkpoints.map((c) => ({ name: c.name, coord: [c.lng, c.lat], kind: c.kind, note: c.note })),
    };
    exportTrack(t);
    track('gpx_download', { profile: route.profile, km: kmBucket(route.profileData.length) });
  }

  let garminOpen = $state(false);

  /** Sign-in leaves the page: the open route goes to the server and comes back by its id. */
  async function signIn(reopenGarmin = false) {
    track('sign_in', { kind: 'google' });
    let hash = location.hash;
    if (route.waypoints.length) {
      saveRoute();
      try {
        const c = map!.getCenter();
        hash = formatHash({ zoom: map!.getZoom(), lat: c.lat, lng: c.lng, layers: [base, ...overlays] }) +
          `&s=${await snapshot(route.toDoc())}` + (reopenGarmin ? '&g=1' : '');
      } catch {
        /* sign in anyway; the route stays in My routes */
      }
    }
    login(hash);
  }
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
  const straightOn = $derived(route.drawStraight);

  // ---- 3D: terrain from the open Terrarium tiles (the same as for straight legs), tilt and rotation ----
  let terrain3d = $state(false);
  let orbit: { turn: (deg: number) => void } | undefined = $state();
  /** the map for the controls block (the map itself is not reactive state) */
  let map3d = $state.raw<maplibregl.Map | null>(null);
  let geoCtl = $state.raw<maplibregl.GeolocateControl | null>(null);
  const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  function set3d(on: boolean, animate = true) {
    if (!map) return;
    if (on && animate) track('view_3d');
    terrain3d = on;
    map3d = map;
    try {
      localStorage.setItem('nk-3d', on ? '1' : '0');
    } catch {
      /* no storage */
    }
    const m = map;
    if (on) {
      if (!m.getSource('dem'))
        m.addSource('dem', { type: 'raster-dem', tiles: [DEM_TILES], tileSize: 256, encoding: 'terrarium', maxzoom: 15, attribution: 'Terrain: Mapzen, AWS Open Data' });
      m.setMaxPitch(80);
      m.setTerrain({ source: 'dem', exaggeration: 1.4 });
      m.setSky({ 'sky-color': '#9cc3ea', 'horizon-color': '#e6edf3', 'fog-color': '#f2f4f6', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.8 });
      m.dragRotate.enable();
      m.touchZoomRotate.enableRotation();
      m.touchPitch.enable();
      m.easeTo({ pitch: 62, duration: animate ? 900 : 0 });
    } else {
      m.setTerrain(null);
      m.dragRotate.disable();
      m.touchZoomRotate.disableRotation();
      m.touchPitch.disable();
      m.easeTo({ pitch: 0, bearing: 0, duration: animate ? 600 : 0 });
      m.once('moveend', () => {
        if (!terrain3d) m.setMaxPitch(0);
      });
    }
  }

  // ---- a finished route gets a name (asked once editing ends, or before it leaves the planner) ----
  let nameOpen = $state(false);
  let afterName: (() => void) | null = null;
  /** True when the name dialog was opened instead; `then` runs after the name is given. */
  let nameSuggestions = $state<string[]>([]);
  function needName(then?: () => void): boolean {
    if (route.points.length < 2 || route.name) return false;
    afterName = then ?? null;
    nameSuggestions = [];
    nameOpen = true;
    // place-based names arrive in a moment (cached on the server); the dialog is usable meanwhile
    const pts = route.points;
    suggestNames(pts, route.profileData.length / 1000, profileTitle).then((s) => {
      if (route.points === pts) nameSuggestions = s;
    });
    return true;
  }
  function nameGiven(name: string) {
    route.rename(name);
    saveRoute();
    const go = afterName;
    afterName = null;
    go?.();
  }
  function backToEditing() {
    afterName = null;
    editing = true;
  }

  function toggleEdit() {
    editing = !editing;
    if (editing) track('edit_start');
    if (!editing) {
      placing = null;
      needName();
    }
    // phone: the map needs the room while editing; the open sheet would catch the taps
    if (editing && mobile) sheetOpen = false;
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
    track('route_tool', { tool: 'reverse' });
    route.reverse();
    say(t('toast.reversed'));
  }
  function outAndBack() {
    if (!hasLegs) return;
    track('route_tool', { tool: 'out_and_back' });
    route.outAndBack();
    say(t('toast.outBack'));
  }
  function backToStart() {
    if (!hasLegs) return;
    track('route_tool', { tool: 'back_to_start' });
    route.backToStart();
    say(t('toast.backToStart'));
  }
  /**
   * The toolbar button and B switch the drawing mode: new segments straight or along roads.
   * B with the cursor over a segment switches that segment (as does its right-click menu).
   */
  function toggleStraight(useCursor: boolean) {
    if (useCursor && cursorLeg != null) {
      const l = cursorLeg;
      const on = !route.waypoints[l]?.straight;
      route.setLegStraight(l, on);
      say(t(on ? 'toast.legStraight' : 'toast.legRoads', { n: l + 1 }));
      return;
    }
    route.drawStraight = !route.drawStraight;
    if (route.drawStraight && !editing) toggleEdit();
    say(t(route.drawStraight ? 'toast.drawStraight' : 'toast.drawRoads'));
  }
  function toggleCheckpoint() {
    placing = placing === 'route' ? null : 'route';
  }

  const shortcuts = [
    { title: t('help.edit'), keys: ['D'], alt: ['Enter'] },
    { title: t('help.undo'), keys: [MOD, 'Z'] },
    { title: t('help.redo'), keys: [MOD, '⇧', 'Z'], ...(isMac ? {} : { alt: ['Ctrl', 'Y'] }) },
    { title: t('help.reverse'), keys: ['R'] },
    { title: t('help.checkpoint'), keys: ['P'] },
    { title: t('help.straight'), keys: ['B'] },
    { title: t('help.straightOne'), keys: ['⇧', t('help.click')] },
    { title: t('help.layers'), keys: ['L'] },
    { title: t('help.fit'), keys: ['F'] },
    { title: t('help.dim'), keys: ['T'] },
    { title: t('help.turn'), keys: ['Q'], alt: ['E'] },
    { title: t('help.tilt'), keys: ['⇧', '↑'], alt: ['⇧', '↓'] },
    { title: t('help.help'), keys: ['?'], alt: [MOD, '/'] },
    { title: t('help.removeLast'), keys: ['⌫'] },
    { title: t('help.escape'), keys: ['Esc'] },
  ];

  function escape(): boolean {
    if (layersOpen && !layersPinned) return !(layersMenu = null);
    if (accountMenu?.isOpen()) return (accountMenu.close(), true);
    if (placing) return !(placing = null);
    if (pinned) return !(pinned = null);
    if (route.drawStraight) return !(route.drawStraight = false);
    if (editing) {
      // the same as finishing with the button: a route without a name asks for one
      editing = false;
      needName();
      return true;
    }
    return false;
  }

  function onKey(e: KeyboardEvent) {
    if (helpOpen || garminOpen || nameOpen || viewer != null) return; // dialogs handle their own keys
    const t = e.target as HTMLElement;
    const inField = !!t.closest?.('input:not([type=radio]):not([type=checkbox]):not([type=range]):not([type=file]), textarea, select, [contenteditable]');
    if (e.key === 'Escape') {
      if (inField) (t as HTMLElement).blur();
      else if (escape()) e.preventDefault();
      return;
    }
    if (inField) return;
    const mod = e.metaKey || e.ctrlKey;
    // undo and redo with the modifier, as everywhere; tools are single keys (as in brouter-web,
    // OSM iD, Felt), so no browser shortcut (Cmd+0, G, B, K, Y) is taken over
    if (mod) {
      if (e.altKey) return;
      switch (e.code) {
        case 'KeyZ': if (e.shiftKey) redo(); else undo(); break;
        case 'KeyY': if (isMac) return; redo(); break; // Cmd+Y is History on a Mac
        case 'Slash': helpOpen = true; break;
        default: return;
      }
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    if (editing && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      route.removeLast();
      return;
    }
    if (e.key === 'Enter' && editing) {
      e.preventDefault();
      toggleEdit();
      return;
    }
    if (e.key === '?') {
      e.preventDefault();
      helpOpen = true;
      return;
    }
    if (e.shiftKey) return;
    switch (e.code) {
      case 'KeyD': toggleEdit(); break;
      case 'KeyR': reverse(); break;
      case 'KeyP': toggleCheckpoint(); break;
      case 'KeyB': toggleStraight(true); break;
      case 'KeyL': openMenu('base'); break;
      case 'KeyF': fitRoute(); break;
      case 'KeyT': set3d(!terrain3d); break;
      case 'KeyQ': if (!terrain3d) return; orbit?.turn(-45); break;
      case 'KeyE': if (!terrain3d) return; orbit?.turn(45); break;
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

  /** A new activity brings its map (CyclOSM / OpenTopoMap), unless another map was chosen by hand. */
  function changeProfile(p: ProfileId) {
    if (p !== route.profile) track('profile_change', { profile: p });
    const prevDefault = baseForProfile(route.profile);
    route.setProfile(p);
    const next = baseForProfile(p);
    if (next !== base && (base === prevDefault || base === 'O')) setBase(next);
  }

  async function setBase(id: string) {
    if (id === base && map?.getLayer(`src-${id}`)) return;
    if (loaded) track('layer_change', { id });
    const prev = base;
    base = id;
    await showRaster(layerById(id)!, firstOverlayOrTracks());
    if (prev !== id) hideRaster(prev);
    syncHash();
  }

  const passesHelp = () => window.open(`${import.meta.env.BASE_URL}help/#passes`, '_blank', 'noopener');

  async function toggleOverlay(id: string) {
    track('overlay_toggle', { id, on: !overlays.includes(id) });
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
    // a short link that failed to open stays in the address, so a reload tries it again
    history.replaceState(null, '', formatHash({ zoom: map.getZoom(), lat: c.lat, lng: c.lng, layers: [base, ...overlays] }) + (pendingShort ? `&s=${pendingShort}` : routeInHash()));
  }

  /** The address always holds the route on screen, so copying it from the browser shares the route:
   *  the short link it was opened from while unchanged (it keeps the name and checkpoints), else r=. */
  let openedShort: { id: string; param: string } | null = null;
  const routeParam = () => routeToParam({ profile: route.profile, waypoints: route.waypoints, params: route.params });
  function routeInHash(): string {
    if (route.waypoints.length < 2) return '';
    const p = routeParam();
    if (openedShort && openedShort.param === p) return `&s=${openedShort.id}`;
    return '&r=' + encodeURIComponent(p);
  }
  let hashTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void route.version;
    clearTimeout(hashTimer);
    hashTimer = setTimeout(syncHash, 300);
  });

  function refreshTracks() {
    (map?.getSource('tracks') as maplibregl.GeoJSONSource | undefined)?.setData(trackToGeoJSON(tracks));
  }

  async function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      try {
        const trk = parseTrackFile(f.name, await f.text());
        track('file_import', { kind: f.name.split('.').pop()?.toLowerCase() ?? '' });
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

  /**
   * Opening without a view in the URL: centre on the visitor's city (by IP, on our server).
   * If the last view in this browser is within 30 km of that city it stays as it was;
   * otherwise (another city, a VPN) the map moves to the city.
   */
  async function cityView() {
    if (initial.zoom != null || new URLSearchParams(openedHash.slice(1)).has('r') || new URLSearchParams(openedHash.slice(1)).has('s')) return;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/where`);
      if (r.status !== 200) return;
      const { lat, lon } = await r.json();
      if (!map || route.waypoints.length) return;
      if (lastView) {
        const k = Math.PI / 180;
        const d = 6371 * Math.acos(Math.min(1, Math.sin(lat * k) * Math.sin(lastView.lat * k) + Math.cos(lat * k) * Math.cos(lastView.lat * k) * Math.cos((lon - lastView.lng) * k)));
        if (d < 30) return;
      }
      map.jumpTo({ center: [lon, lat], zoom: 11 });
    } catch {
      /* stays on the last view or Europe */
    }
  }

  onMount(() => {
    initAnalytics();
    // the lists come from this browser's storage and need no map: show them at once,
    // not after the base map has loaded (slow tiles left "Nothing yet" for seconds)
    void reloadLists();
    registerYandexProtocol();
    registerGpsHeatProtocol();
    registerRwHeatProtocol();
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
      // Shift+drag zoom took every Shift+mousedown, so Shift+click (a straight segment) never arrived
      boxZoom: false,
    });
    map.touchZoomRotate.disableRotation();
    // find my location: MapLibre's control does the work (dot, following, errors); its button is
    // hidden (app.css) and the one at the bottom of the map controls block triggers it
    const geo = new maplibregl.GeolocateControl({ trackUserLocation: true });
    map.addControl(geo, 'bottom-right');
    geoCtl = geo;
    if (dimBox) map.addControl({ onAdd: () => dimBox!, onRemove: () => dimBox?.remove() }, 'bottom-right');
    map3d = map;
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
      along = new AlongLayer(map!);
      along.onPhoto = openPhoto;
      editor.onMapClick = placeCheckpoint;
      editor.onSplit = splitRoute;
      editor.onCopyTo = copyUpTo;
      cpLayer = new CheckpointLayer(map!, {
        update: (it, patch) => (it.owner === 'route' ? route.updateCheckpoint(it.id, patch) : updateTrackPoint(it, patch)),
        remove: (it) => (it.owner === 'route' ? route.removeCheckpoint(it.id) : removeTrackPoint(it)),
      });
      cpLayer.set(checkpointItems);
      try {
        if (localStorage.getItem('nk-3d') === '1') set3d(true, false);
      } catch {
        /* no storage */
      }
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
    map.on('moveend', () => loadPhotosInView());

    const onHash = () => {
      // a route link pasted into this tab's address bar changes only the hash: reload to open it
      const h = new URLSearchParams(location.hash.slice(1));
      if (h.has('s') || h.has('r')) return location.reload();
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
    if (!layersOpen || layersPinned) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (layersBox?.contains(t) || t.closest?.('[aria-controls="nk-layers"], [aria-controls="nk-pois"], .poi-mk, .ph-mk')) return;
      layersMenu = null;
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  });

  const hasRoute = $derived(route.points.length > 1);
  // routing takes a moment (hiking especially): show it, but not for quick answers
  let busy = $state(false);
  $effect(() => {
    if (!route.loading) {
      busy = false;
      return;
    }
    const tm = setTimeout(() => (busy = true), 250);
    return () => clearTimeout(tm);
  });
  const profileTitle = $derived(PROFILES.find((p) => p.id === route.profile)?.title ?? '');
  const NEVER_WORD: Record<AllowKey, string> = {
    steps: t('set.allowSteps').toLowerCase(),
    ferry: t('set.allowFerry').toLowerCase(),
    busy: t('set.allowBusy').toLowerCase(),
    unpaved: t('set.allowUnpaved').toLowerCase(),
    paths: t('set.allowPaths').toLowerCase(),
  };
  // only what differs from the route type's own behaviour; nothing changed reads "Gravel defaults"
  const optSummary = $derived.by(() => {
    const o = route.options;
    const bike = route.profile === 'nk-road' || route.profile === 'nk-gravel';
    const parts: string[] = [];
    if (o.surface !== 0) parts.push(({ [-2]: t('set.sumOnlyAsphalt'), [-1]: t('set.sumAsphalt'), 1: t('set.sumDirt'), 2: t('set.sumSurfTrails') } as Record<number, string>)[o.surface]);
    if (!o.maxGrade && o.climbs !== 'normal') parts.push({ avoid: t('set.sumAvoid'), less: t('set.sumLess'), any: t('set.sumAnyClimbs'), seek: t('set.sumSeek') }[o.climbs as 'avoid' | 'less' | 'any' | 'seek']);
    if (o.maxGrade) parts.push(t('set.sumUpTo', { g: o.maxGrade }));
    if (route.profile !== 'nk-hike' && o.bigRoads !== 'normal') parts.push({ avoid: t('set.sumBigAvoid'), less: t('set.sumBigLess'), any: t('set.sumBigAny') }[o.bigRoads as 'avoid' | 'less' | 'any']);
    if (bike && !o.cycleways) parts.push(t('set.sumNoCycleways'));
    if (bike && o.cycleways && o.cycleStrict) parts.push(t('set.sumCycleStick'));
    if (o.heat && bike) parts.push(t('set.sumHeat'));
    if (o.cobbles && route.profile !== 'nk-hike') parts.push(t('set.sumCobbles'));
    const never = ALLOW_KEYS.filter((k) => o.allow?.[k] === false && ALLOW_FOR[k].includes(route.profile));
    if (never.length) parts.push(t('set.sumNever', { list: never.map((k) => NEVER_WORD[k]).join(', ') }));
    if (route.profile === 'nk-hike') {
      if (o.sac !== 3) parts.push(t('set.sumSac', { t: o.sac === 6 ? 'T6' : `T${o.sac}` }));
      if (o.trails) parts.push(t('set.sumTrails'));
      if (o.nature) parts.push(t('set.sumNature'));
      if (o.quiet) parts.push(t('set.sumQuiet'));
    }
    if (!parts.length) return t('set.sumDefaults', { type: PROFILES.find((p) => p.id === route.profile)?.title ?? '' });
    return parts.join(' · ');
  });
</script>

<svelte:window onkeydown={onKey} />
<NameDialog bind:open={nameOpen} profile={route.profileData} profileId={route.profile} typeTitle={profileTitle}
  suggestion={route.autoName()} suggestions={nameSuggestions} onsave={nameGiven} onback={backToEditing} />
<div class="app" role="application" ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
  <aside class="side" class:sheet-open={sheetOpen} class:editing aria-label={t('route.panel')}>
    {#if mobile}
      <button class="grab" aria-label={sheetOpen ? t('sheet.collapse') : t('sheet.expand')} aria-expanded={sheetOpen}
        onclick={() => (sheetOpen = !sheetOpen)}
        onpointerdown={grabStart}><span></span></button>
    {/if}
    <div class="head">
      <!-- the logo starts a new route; the open one stays saved in My routes -->
      <button class="logobtn" onclick={newRoute} aria-label={t('logo.new')} data-tip={route.waypoints.length ? t('logo.new') : undefined}>
        <picture class="logo">
          <source srcset="{import.meta.env.BASE_URL}brand/symbol-colour-dark.svg" media="(prefers-color-scheme: dark)" />
          <img src="{import.meta.env.BASE_URL}brand/symbol-colour.svg" alt="No Mapa" width="81" height="28" />
        </picture>
      </button>
      {#if !mobile && route.waypoints.length}<button class="newb" onclick={newRoute} data-tip={t('mine.newTip')}><Icon name="plus" size={16} /><span>{t('act.new')}</span></button>{/if}
      {#if !mobile}<AccountMenu bind:this={accountMenu} {user} {syncState} onlogin={() => signIn()} onloginAlt={() => (track('sign_in', { kind: 'alexe' }), loginAuthelia())} onlogout={logout} ondelete={removeAccount} onsync={runSync} oncookies={() => (consentOpen = true)} onopen={() => mobile && (sheetOpen = true)} />{/if}
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
      {#if mobile}<button class="newb" onclick={newRoute} data-tip={t('mine.newTip')}><Icon name="plus" size={16} /><span>{t('act.new')}</span></button>{/if}
      <button class="del" aria-expanded={askDelete} onclick={() => (askDelete = !askDelete)} aria-label={t('route.delete')} data-tip={t('route.delete')}><Icon name="trash" size={18} /></button>
    {/if}
    <!-- on a phone the account button sits on the title row, the logo is hidden -->
    {#if mobile}<AccountMenu bind:this={accountMenu} {user} {syncState} onlogin={() => signIn()} onloginAlt={() => (track('sign_in', { kind: 'alexe' }), loginAuthelia())} onlogout={logout} ondelete={removeAccount} onsync={runSync} oncookies={() => (consentOpen = true)} onopen={() => mobile && (sheetOpen = true)} />{/if}
    </div>
    {#if askDelete && route.waypoints.length}
      <InlineConfirm text={t('mine.confirmDelete', { name: route.name || route.autoName() })} action={t('ic.delete')}
        onconfirm={deleteCurrent} oncancel={() => (askDelete = false)} />
    {/if}
    <Segmented name="kind" label={t('route.typeLabel')} value={route.profile}
      items={PROFILES.map((p) => [p.id, p.title] as const)}
      onchange={(v) => changeProfile(v as ProfileId)} />

    {#if hasRoute}
      <RouteSummary profile={route.profileData} profileId={route.profile} {classes} loading={route.loading} error={route.error?.error ?? ''} />
      {#if mobile}
        <ProfileCard bind:open={showProfile} mobile routeType={route.profile} profile={route.profileData} {classes} marks={profileMarks}
          maxGrade={route.options.maxGrade} hoverIdx={markerIdx} band={hoverBand ?? pinnedBand}
          onhover={(i) => setHover(i, 'prof')} onpick={pickProfile} />
      {/if}
    {:else if route.loading}
      <p class="soft">{t('route.computing')}</p>
    {:else if route.error}
      <p class="errline" role="alert">{t('route.error', { error: route.error.error })}</p>
    {/if}

    <Fold id="nk-settings" title={t('set.title')} summary={optSummary} bind:open={settingsOpen}>
      <RouteSettings options={route.options} profile={route.profile} hike={route.profile === 'nk-hike'} cycle={route.profile === 'nk-road' || route.profile === 'nk-gravel'} onchange={setOpt} />
    </Fold>

    {#if events.length}
      <Timeline {events} routeType={route.profile} profile={route.profileData} {classes} {activeD} pinnedId={pinned?.id ?? null} {mobile}
        onhover={onTimelineHover} onpick={pickEvent} />
      {#if photosOn && photos.length}
        <Fold id="nk-photos" title={t('poi.photosTitle')} summary={String(photos.length)} bind:open={photosOpen}>
          <div class="phl">
            {#each photoGroups(photos) as g (g.from)}
              <div class="phg">
                <span class="num">{t('poi.photosGroup', { a: Math.round(g.from / 1000), b: Math.round(g.to / 1000) })} · {g.items.length}</span>
                <div class="phs">
                  {#each g.items.slice(0, 8) as p (p.id)}
                    <button style="background-image:url('{p.thumb}')" aria-label={t('poi.photo')} onclick={() => openPhoto(p)}></button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </Fold>
      {/if}
    {:else if !route.waypoints.length}
      <div class="empty">
        {#if mobile}
          <p>{t('route.empty1')} <button class="inl" onclick={toggleEdit}><Icon name="edit" size={14} /></button> {t('route.empty2Touch')}</p>
        {:else}
          <p>{t('route.empty1')}
            <button class="inl" onclick={toggleEdit}><Icon name="edit" size={14} /></button>
            (<kbd>D</kbd>) {t('route.empty2')} {t('route.emptyFiles')}</p>
        {/if}
      </div>
      <!-- no route open: the panel is the list of my routes and tracks -->
      <div class="browse">
        <MyRoutes routes={savedRoutes} {tracks} currentId={route.docId} {placing}
          onopen={openRoute} ondelete={deleteRoute} onnew={newRoute} onopenfile={() => fileInput.click()}
          onopentrack={openTrack} onzoomtrack={zoomTo} onexporttrack={exportTrack} onremovetrack={removeTrack}
          onplace={(id) => (placing = placing === id ? null : id)} />
      </div>
    {/if}

    <div class="acts">
      <!-- route actions appear only when there is a route -->
      {#if hasRoute}
        <!-- GPX is the main way out; Garmin is an experimental extra -->
        <button class="garmin" onclick={exportRoute}>
          <Icon name="download" size={20} /><span>{t('act.gpx')}</span>
        </button>
        <div class="sec3">
          <button class="sbtn" onclick={shareRoute}><Icon name="link" size={15} />&nbsp;{t('act.share')}</button>
          <button class="sbtn" onclick={() => needName(() => (garminOpen = true)) || (garminOpen = true)} data-tip={t('act.garminTip')}><Icon name="watch" size={15} />&nbsp;Garmin</button>
        </div>
      {/if}
      {#if route.waypoints.length}
      <Fold id="nk-mine" title={t('mine.title')} summary={t('mine.saved', { n: savedRoutes.length + tracks.length })} bind:open={mineOpen}>
        <div class="mine-scroll">
          <MyRoutes routes={savedRoutes} {tracks} currentId={route.docId} {placing}
            onopen={openRoute} ondelete={deleteRoute} onnew={newRoute} onopenfile={() => fileInput.click()}
            onopentrack={openTrack} onzoomtrack={zoomTo} onexporttrack={exportTrack} onremovetrack={removeTrack}
            onplace={(id) => (placing = placing === id ? null : id)} />
        </div>
      </Fold>
      {/if}
    </div>
    <input bind:this={fileInput} class="hidden" type="file" accept=".gpx,.kml" multiple
      onchange={(e) => { addFiles(e.currentTarget.files!); e.currentTarget.value = ''; }} />
  </aside>

  <main class="mapcol" class:t3d={terrain3d} style="--prof-h:{mobile || !hasRoute ? 0 : profH + 12}px; --ctl-top:{ctlTop}px">
    <div class="map" bind:this={container}></div>
    <Toolbar {editing} canUndo={route.canUndo} canRedo={route.canRedo} hasRoute={route.waypoints.length > 0} canLoop={hasLegs}
      {straightOn} placing={placing === 'route'} {layersOpen}
      onedit={toggleEdit} onundo={undo} onredo={redo} onreverse={reverse} onoutback={outAndBack} onbacktostart={backToStart}
      onstraight={() => toggleStraight(false)} oncheckpoint={toggleCheckpoint} onlayers={() => openMenu('base')}
      onfit={fitRoute} onhelp={() => (helpOpen = true)} />
    <div class="layersbtns">
      <button class="layersbtn" aria-expanded={layersMenu === 'base'} aria-controls="nk-layers" aria-label={t('lay.base')}
        title="{t('lay.base')} (L)" onclick={() => openMenu('base')}><Icon name="layers" size={20} /></button>
      <button class="layersbtn" aria-expanded={layersMenu === 'over'} aria-controls="nk-layers" aria-label={t('lay.overlays')}
        title={t('lay.overlays')} onclick={() => openMenu('over')}><Icon name="overlay" size={20} /></button>
      <button class="layersbtn poibtn" class:on={poiCats.length > 0} aria-expanded={layersMenu === 'poi'} aria-controls="nk-pois"
        aria-label={t('poi.title')} title={t('poi.title')} onclick={() => openMenu('poi')}>{t('poi.button')}{#if poiCats.length}<span class="cnt num">{poiCats.length}</span>{/if}</button>
    </div>
    <!-- moved into the map's bottom right corner, right above zoom (a MapLibre control, see onMount) -->
    <!-- one block in the map's bottom right corner (a MapLibre control, see onMount): 2D | 3D and
         zoom; in 3D it grows upwards with turning and tilt -->
    <div class="mapctl maplibregl-ctrl" bind:this={dimBox}>
      {#if map3d}<Orbit3d bind:this={orbit} map={map3d} three={terrain3d} geo={geoCtl} minTop={btnsBottom} layout={`${profH}|${hasRoute}|${mobile}`} onset3d={(on) => set3d(on)} />{/if}
    </div>
    {#if layersMenu === 'poi'}
      <div bind:this={layersBox}>
        <PoiMenu enabled={poiCats} counts={poiCounts} {photoSrc} onphotosrc={(x) => setPoiPref('photoSrc', (photoSrc = photoSrc.includes(x) ? photoSrc.filter((y) => y !== x) : [...photoSrc, x]))} photoZoomHint={photosOn && mapZoom < PHOTO_MIN_ZOOM} radius={poiRadius} inTimeline={poiTimeline} loading={poiLoading} error={poiError}
          pinned={layersPinned} canPin={!mobile} onpin={togglePin} ontoggle={togglePoiCat} onradius={(r) => setPoiPref('radius', (poiRadius = r))}
          ontimeline={(on) => setPoiPref('timeline', (poiTimeline = on))} onclose={() => { layersMenu = null; if (layersPinned) togglePin(); }} />
      </div>
    {:else if layersMenu}
      <div bind:this={layersBox}>
        <LayersPopover mode={layersMenu} profile={route.profile} {base} {overlays} {colorMode} pinned={layersPinned} canPin={!mobile} onpin={togglePin} onbase={setBase} onoverlay={toggleOverlay}
          oncolormode={(m) => (colorMode = m)} onclose={() => { layersMenu = null; if (layersPinned) togglePin(); }} />
      </div>
    {/if}
    <!-- the hint is for the very start: gone once the first point is placed -->
    {#if editing && !route.waypoints.length && !(mobile && layersOpen)}
      <div class="ehint" role="note">
        {#if mobile}
          {t('hint.editTouch', { where: route.prepend ? t('hint.atStart') : '' })}
        {:else}
          {t('hint.edit', { where: route.prepend ? t('hint.atStart') : '', key: 'Backspace' })}
        {/if}
      </div>
    {/if}
    {#if busy || openingTrack}
      <div class="busy" role="status" aria-live="polite"><span class="spin" aria-hidden="true"></span>{openingTrack ? t('track.opening') : t('route.routing', { type: profileTitle })}</div>
    {/if}
    {#if hasRoute && !mobile}
      <div class="profwrap" bind:offsetHeight={profH}>
        <ProfileCard bind:open={showProfile} routeType={route.profile} profile={route.profileData} {classes} marks={profileMarks}
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

  {#if viewer != null && photos.length}
    <PhotoViewer {photos} bind:index={viewer} onclose={() => (viewer = null)}
      onshow={(p) => map?.easeTo({ center: [p.lng, p.lat], duration: 400 })} />
  {/if}
  {#if consentOpen}<ConsentBanner onclose={() => (consentOpen = false)} />{/if}
  <GarminDialog bind:open={garminOpen} loggedIn={!!user} getRoute={garminRoute} onlogin={() => signIn(true)} />
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
  .logobtn {
    display: flex;
    padding: 2px 4px;
    margin: -2px -4px;
    border-radius: 8px;
  }
  .logobtn:hover {
    background: var(--tint);
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
  .newb {
    flex: none;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    padding: 0 10px 0 7px;
    border-radius: 8px;
    border: 1px solid var(--line);
    color: var(--ink);
    font: 550 13.5px/1 var(--sans);
  }
  .newb:hover {
    background: var(--tint);
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
  /* neither the hint nor the list may shrink under their content: squeezed, the hint's text ran
     over the list; when space is short the whole panel scrolls */
  .empty {
    flex: none;
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
  .sec3 {
    display: grid;
    grid-template-columns: 1fr 1fr;
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
  .phl {
    display: grid;
    gap: 8px;
    max-height: 260px;
    overflow: auto;
  }
  .phg > span {
    font-size: 12px;
    color: var(--soft);
  }
  .phs {
    display: flex;
    gap: 4px;
    margin-top: 3px;
    overflow-x: auto;
  }
  .phs button {
    flex: none;
    width: 56px;
    height: 42px;
    border-radius: 6px;
    background: var(--tint) center / cover no-repeat;
  }
  .browse {
    flex: 1 0 auto;
    margin: 0 -4px;
    padding: 0 4px;
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
  @media (max-width: 639px), (max-height: 480px) and (orientation: landscape) {
    .mine-scroll {
      max-height: none;
    }
    .logo {
      display: none;
    }
    /* phone: no logo, and the account button lives in the title row */
    .head {
      display: none;
    }
    .titlerow {
      min-height: 40px;
      gap: 6px;
    }
  }
</style>

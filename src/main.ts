import { mount } from 'svelte';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './app.css';
import App from './App.svelte';

// MapLibre resolves its worker dynamically, which Vite cannot follow.
setWorkerUrl(workerUrl);

export default mount(App, { target: document.getElementById('app')! });

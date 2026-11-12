# Na Carta

*Na carta* is Portuguese for “on the map”. A route planner for hiking and cycling, rebuilt on a modern stack. Inspired by and partly ported from [nakarte.me](https://nakarte.me) ([source](https://github.com/wladich/nakarte)) by Sergey Orlov.

**Status:** early prototype: base maps, URL state, GPX/KML import and export.

## Why

nakarte.me is one of the most convenient route planners around, but:

- it has no routing along roads and trails, let alone routing that respects surface type;
- it is built on Leaflet 1.0 and Knockout;
- some of its data sources no longer work.

## Planned features

- Routing with surface-aware profiles (hiking, gravel, trekking, MTB) via a self-hosted [BRouter](https://github.com/abrensch/brouter).
- Elevation profile with gradient colouring along the line and on the chart.
- Base maps: OpenStreetMap variants (OSM, CyclOSM, OpenTopoMap and others), mapy.cz, Google, Bing, Yandex, Wikimapia overlay.
- Heatmap overlay.
- Mountain passes from OpenStreetMap and the FSTR catalogue.
- Geotagged photos from Wikimedia Commons, Mapillary and other platforms, always credited to their source.
- GPX/KML import and export, shareable links that keep the whole map state in the URL, compatible with nakarte links where possible.

## Stack

- Svelte 5, TypeScript, Vite
- MapLibre GL JS (Yandex tiles are reprojected from EPSG:3395 on the fly)
- BRouter for routing, AWS Terrain Tiles for elevation
- A small backend for proxies that need CORS or server-side credentials

## Development

```bash
npm install
cp .env.example .env   # optional keys: Google Map Tiles, mapy.com
npm run dev            # http://localhost:5173/maps/
npm test
npm run check
```

Layers whose key is missing are hidden.

## License

MIT, see [LICENSE](LICENSE). Code ported from nakarte keeps its original MIT copyright notice.

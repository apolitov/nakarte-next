#!/usr/bin/env bash
# Rebuilds public/data/passes.geojson from OpenStreetMap (Overpass) and the FSTR catalogue.
set -euo pipefail
cd "$(dirname "$0")"
TMP=$(mktemp -d)
Q='[out:json][timeout:500];(node["mountain_pass"="yes"];node["natural"="saddle"]["rtsa_scale"];);out body;'
for u in https://overpass-api.de/api/interpreter https://overpass.kumi.systems/api/interpreter; do
  curl -fsS --max-time 600 -A "nomapa-passes" -o "$TMP/osm.json" --data-urlencode "data=$Q" "$u" && break || sleep 30
done
curl -fsSL --max-time 120 -o "$TMP/fstr.ods" \
  "https://docs.google.com/spreadsheets/d/1azG7VCU_zvEotb45JGnAJd5J4QI4JOM5_RojHwPyxgg/export?format=ods"
mkdir -p ../../public/data
uv run -q --with pandas --with odfpy python -I build.py "$TMP/osm.json" "$TMP/fstr.ods" ../../public/data/passes.geojson
rm -rf "$TMP"

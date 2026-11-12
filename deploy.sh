#!/usr/bin/env bash
# Builds and uploads the app. Target comes from .env: DEPLOY_TARGET=user@host:/path/to/maps/
set -euo pipefail
cd "$(dirname "$0")"
TARGET=$(grep -E '^DEPLOY_TARGET=' .env | cut -d= -f2-)
[ -n "$TARGET" ] || { echo "DEPLOY_TARGET is not set in .env"; exit 1; }
npm run check
npm test
npm run build
# design/shots are screenshots of prototypes, not needed on the server
rsync -az --delete --exclude 'design/shots/' dist/ "$TARGET"
echo "deployed to $TARGET"

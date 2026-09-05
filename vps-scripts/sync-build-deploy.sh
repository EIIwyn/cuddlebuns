#!/usr/bin/env bash
# Runs on the VPS. NocoDB credentials come from the systemd EnvironmentFile.
set -euo pipefail

SOURCE_DIR="${CUDDLEBUNS_SOURCE_DIR:-/var/www/cuddlebuns/source}"
SITE_DIR="$SOURCE_DIR/site"
RELEASES_DIR="${CUDDLEBUNS_RELEASES_DIR:-/var/www/cuddlebuns/releases}"
CURRENT_LINK="${CUDDLEBUNS_CURRENT_LINK:-/var/www/cuddlebuns/current}"
STATE_DIR="$SITE_DIR/.cache/deploy"
DEPLOYED_REVISION_FILE="$STATE_DIR/revision"
LOCK_FILE="$STATE_DIR/sync.lock"

mkdir -p "$STATE_DIR" "$RELEASES_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

if [[ ! -f "$SITE_DIR/package.json" ]]; then
  echo "Missing source checkout at $SITE_DIR" >&2
  exit 1
fi
if [[ ! -d "$SITE_DIR/node_modules" ]]; then
  echo "Run npm ci in $SITE_DIR before enabling the timer." >&2
  exit 1
fi

cd "$SITE_DIR"
SOURCE_REVISION="$(
  {
    find src scripts -type f -print0 | sort -z | xargs -0 sha256sum
    sha256sum package.json package-lock.json vite.config.js index.html
  } | sha256sum | awk '{print $1}'
)"
DEPLOYED_REVISION="$(cat "$DEPLOYED_REVISION_FILE" 2>/dev/null || true)"

set +e
node scripts/sync-nocodb.mjs --check
GALLERY_SYNC_STATUS=$?
node scripts/sync-uma-nocodb.mjs --check
UMA_SYNC_STATUS=$?
set -e
if [[ "$GALLERY_SYNC_STATUS" -ne 0 && "$GALLERY_SYNC_STATUS" -ne 10 ]]; then
  echo "Gallery NocoDB change check failed with status $GALLERY_SYNC_STATUS." >&2
  exit "$GALLERY_SYNC_STATUS"
fi
if [[ "$UMA_SYNC_STATUS" -ne 0 && "$UMA_SYNC_STATUS" -ne 10 ]]; then
  echo "Uma NocoDB change check failed with status $UMA_SYNC_STATUS." >&2
  exit "$UMA_SYNC_STATUS"
fi

if [[ "$GALLERY_SYNC_STATUS" -eq 0 && "$UMA_SYNC_STATUS" -eq 0 && "$SOURCE_REVISION" == "$DEPLOYED_REVISION" && -f "$CURRENT_LINK/index.html" ]]; then
  echo "NocoDB and source code are unchanged; no deployment needed."
  exit 0
fi

if [[ "$GALLERY_SYNC_STATUS" -eq 10 ]]; then
  npm run sync
fi
if [[ "$UMA_SYNC_STATUS" -eq 10 ]]; then
  npm run sync:uma
fi
npm run validate:cms
npm run validate:uma
npm run build

[[ -s dist/index.html ]] || { echo "Build is missing dist/index.html" >&2; exit 1; }
[[ -s dist/data/cms/site.json ]] || { echo "Build is missing CMS navigation JSON" >&2; exit 1; }
find dist/data/cms/gallery -maxdepth 1 -type f -name '*.json' -print -quit | grep -q . || {
  echo "Build contains no per-version gallery JSON" >&2
  exit 1
}
[[ -s dist/data/uma/timeline.json ]] || { echo "Build is missing Uma timeline JSON" >&2; exit 1; }

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
mkdir "$RELEASE_DIR"
cp -a dist/. "$RELEASE_DIR/"

# A complete release exists before Caddy's symlink changes.
TEMP_LINK="${CURRENT_LINK}.next.$$"
ln -s "$RELEASE_DIR" "$TEMP_LINK"
mv -Tf "$TEMP_LINK" "$CURRENT_LINK"
printf '%s\n' "$SOURCE_REVISION" > "$DEPLOYED_REVISION_FILE"

echo "Activated release $RELEASE_ID. Older releases are retained for manual rollback."

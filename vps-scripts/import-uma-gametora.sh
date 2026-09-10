#!/usr/bin/env bash
# Runs on the VPS nightly. NocoDB credentials and UMA_IMPORT_* come from the systemd EnvironmentFile.
set -euo pipefail

SOURCE_DIR="${CUDDLEBUNS_SOURCE_DIR:-/var/www/cuddlebuns/source}"
SITE_DIR="$SOURCE_DIR/site"

if [[ ! -f "$SITE_DIR/package.json" ]]; then
  echo "Missing source checkout at $SITE_DIR" >&2
  exit 1
fi
if [[ ! -d "$SITE_DIR/node_modules" ]]; then
  echo "Run npm ci in $SITE_DIR before enabling the timer." >&2
  exit 1
fi
if [[ -z "${UMA_IMPORT_NOCODB_SCENARIOS_TABLE_ID:-}" || -z "${UMA_IMPORT_NOCODB_PVP_EVENTS_TABLE_ID:-}" || -z "${UMA_IMPORT_NOCODB_SUPPORT_CARDS_TABLE_ID:-}" ]]; then
  echo "UMA_IMPORT_NOCODB_* not configured; skipping GameTora import."
  exit 0
fi

cd "$SITE_DIR"
node scripts/import-uma-gametora.mjs --apply

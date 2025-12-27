#!/bin/bash
# Script to sync assets from local to VPS using WSL
# Run this with: wsl bash vps-scripts/sync-assets-wsl.sh

set -e

echo "📤 Syncing assets to VPS..."

# Get the current directory in WSL format
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_PATH="$(dirname "$SCRIPT_DIR")/assets/"

echo "Syncing from: $ASSETS_PATH"

# Sync assets folder to VPS
rsync -avz --progress \
  --exclude='.gitkeep' \
  "$ASSETS_PATH" \
  masterpyon@cuddlebuns.moe:/var/www/cuddlebuns/public/assets/

echo "✅ Assets synced successfully!"
echo "🌐 Assets available at: https://cuddlebuns.moe/assets/"

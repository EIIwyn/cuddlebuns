#!/bin/bash
# Script to sync assets from local to VPS using WSL
# Run this with: wsl bash vps-scripts/sync-assets-wsl.sh

set -e

echo "📤 Syncing assets to VPS..."

# Convert Windows path to WSL path
WINDOWS_PATH="/mnt/e/Code Stuff/cuddlebuns/assets/"

# Sync assets folder to VPS
rsync -avz --progress \
  --exclude='.gitkeep' \
  "$WINDOWS_PATH" \
  masterpyon@cuddlebuns.moe:/var/www/cuddlebuns/public/assets/

echo "✅ Assets synced successfully!"
echo "🌐 Assets available at: https://cuddlebuns.moe/assets/"

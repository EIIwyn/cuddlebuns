#!/bin/bash
# Script to sync assets from local to VPS
# Run this locally to upload new images

set -e

echo "📤 Syncing assets to VPS..."

# Sync assets folder to VPS
rsync -avz --progress \
  --exclude='.gitkeep' \
  ./assets/ \
  masterpyon@cuddlebuns.moe:/var/www/cuddlebuns/public/assets/

echo "✅ Assets synced successfully!"
echo "🌐 Assets available at: https://cuddlebuns.moe/assets/"

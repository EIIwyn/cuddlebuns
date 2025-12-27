#!/bin/bash
# Script to sync assets from local to VPS using rsync
# Run this locally to upload new images
#

set -e

echo "📤 Syncing assets to VPS with rsync..."

# Sync assets folder to VPS
rsync -avz --progress \
  -e "ssh -p 2222" \
  --exclude='.gitkeep' \
  ./assets/ \
  masterpyon@cuddlebuns.moe:/var/www/cuddlebuns/public/assets/

echo "✅ Assets synced successfully!"
echo "🌐 Assets available at: https://cuddlebuns.moe/assets/"

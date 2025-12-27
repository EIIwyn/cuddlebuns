#!/bin/bash
# Script to sync assets from local to VPS using SCP
# Run this locally to upload new images
#
# RECOMMENDED FOR WINDOWS: More reliable than rsync on Windows Git Bash
# NOTE: Slower than rsync (uploads all files, not just changes)

set -e

echo "📤 Syncing assets to VPS using SCP..."

# Use scp to recursively copy assets
# -r = recursive
# -P = port (capital P for scp)
scp -r -P 2222 \
  ./assets/* \
  masterpyon@cuddlebuns.moe:/var/www/cuddlebuns/public/assets/

echo "✅ Assets synced successfully!"
echo "🌐 Assets available at: https://cuddlebuns.moe/assets/"

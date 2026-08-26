#!/bin/bash
# Script to sync assets from local to VPS using SCP
# Run this locally to upload new images
#

set -e

echo "📤 Syncing assets to VPS using SCP..."

# Use scp to recursively copy the entire assets folder
# -r = recursive
# -P = port (capital P for scp)
# Note: Copying ./assets/ instead of ./assets/* to preserve directory structure
scp -r -P 2222 \
  ./assets/commissions \
  ./assets/nocodb \
  ./assets/referencesheets \
  masterpyon@cuddlebuns.moe:/var/www/cuddlebuns/public/assets/

echo "✅ Assets synced successfully!"
echo "🌐 Assets available at: https://cuddlebuns.moe/assets/"

#!/bin/bash
# Script to update the post-receive hook on the VPS
# Run this with: ssh cuddlebuns.moe 'bash -s' < vps-scripts/update-hook.sh

set -e

echo "📝 Updating post-receive hook..."

# Copy the hook from working tree to git hooks
cp /var/www/cuddlebuns/vps-scripts/post-receive /var/www/cuddlebuns/repos/cuddlebuns.git/hooks/post-receive

# Make it executable
chmod +x /var/www/cuddlebuns/repos/cuddlebuns.git/hooks/post-receive

echo "✅ Hook updated successfully!"
echo "Next deployment will use the new hook configuration"

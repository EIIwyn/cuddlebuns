#!/bin/bash
# Script to update Caddy config symlink from site1.caddy to cuddlebuns.caddy
# Run this on VPS: ssh cuddlebuns.moe 'bash -s' < vps-scripts/setup-caddy-symlink.sh

set -e

echo "🔗 Updating Caddy config symlink..."

# Remove old symlink
if [ -L /etc/caddy/sites/site1.caddy ]; then
    sudo rm -f /etc/caddy/sites/site1.caddy
    echo "✓ Removed old site1.caddy symlink"
fi

# Create new symlink with updated name
sudo ln -sf /var/www/cuddlebuns/cuddlebuns.caddy /etc/caddy/sites/cuddlebuns.caddy

echo "✓ Created symlink: /etc/caddy/sites/cuddlebuns.caddy -> /var/www/cuddlebuns/cuddlebuns.caddy"

# Verify symlink
if [ -L /etc/caddy/sites/cuddlebuns.caddy ]; then
    echo "✓ Symlink verified"
    ls -la /etc/caddy/sites/cuddlebuns.caddy
fi

# Test Caddy config
sudo caddy validate --config /etc/caddy/Caddyfile
echo "✓ Caddy config is valid"

# Reload Caddy
sudo systemctl reload caddy
echo "✓ Caddy reloaded"

echo "✅ Setup complete! Caddy config is now managed via git"

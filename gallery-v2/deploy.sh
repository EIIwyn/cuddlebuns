#!/bin/bash

# Gallery Deployment Script
# Usage: ./deploy.sh username@server-ip

set -e  # Exit on error

echo "🚀 Gallery Deployment Script"
echo "=============================="
echo ""

# Check if server provided
if [ -z "$1" ]; then
    echo "❌ Error: No server specified"
    echo "Usage: ./deploy.sh username@server-ip"
    echo "Example: ./deploy.sh user@123.456.789.0"
    exit 1
fi

SERVER=$1
REMOTE_PATH="/var/www/gallery"

echo "📦 Step 1: Building production bundle..."
pnpm build

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build successful!"
echo ""

echo "📤 Step 2: Uploading to VPS..."
echo "Server: $SERVER"
echo "Path: $REMOTE_PATH"
echo ""

# Create directory on server
ssh $SERVER "mkdir -p $REMOTE_PATH"

# Upload files
rsync -avz --delete dist/ $SERVER:$REMOTE_PATH/

if [ $? -ne 0 ]; then
    echo "❌ Upload failed!"
    exit 1
fi

echo "✅ Upload complete!"
echo ""

echo "🔧 Step 3: Setting permissions..."
ssh $SERVER "sudo chmod -R 755 $REMOTE_PATH"
ssh $SERVER "sudo chown -R www-data:www-data $REMOTE_PATH"

echo "✅ Permissions set!"
echo ""

echo "🎉 Deployment Complete!"
echo ""
echo "Your gallery should now be live at:"
echo "http://$SERVER"
echo ""
echo "Next steps:"
echo "1. Visit your site to verify it works"
echo "2. Configure Nginx/Caddy if not done yet (see DEPLOYMENT.md)"
echo "3. Set up HTTPS with Let's Encrypt"
echo ""

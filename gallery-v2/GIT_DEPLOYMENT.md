# Git Deployment Guide for Gallery v2

This guide explains how to deploy the new Vite gallery using your existing `git push vps main` workflow.

## Overview

Your deployment setup:
- **Local repo**: `E:\Code Stuff\cuddlebuns`
- **VPS remote**: `masterpyon@cuddlebuns.moe:/var/www/cuddlebuns/repos/cuddlebuns.git`
- **Live site**: `/var/www/cuddlebuns/public`
- **Website**: `https://cuddlebuns.moe/gallery/`

## Deployment Strategy

You have two options:

### Option 1: Build Locally, Push Built Files (Recommended)
✅ Faster deployment
✅ No build dependencies on server
✅ Guaranteed consistent builds
❌ Larger git repo

### Option 2: Build on Server via Hook
✅ Smaller git repo (no dist files)
✅ Always fresh builds
❌ Requires Node.js/pnpm on server
❌ Slower deployment

---

## Option 1: Build Locally (Recommended)

### Step 1: Update .gitignore

Remove `gallery-v2/dist/` from `.gitignore` to allow committing built files:

```bash
# Edit .gitignore and remove or comment out this line:
# gallery-v2/dist/
```

### Step 2: Build Production Bundle

```bash
cd "E:\Code Stuff\cuddlebuns\gallery-v2"
pnpm build
```

### Step 3: Copy Build to Public Directory

```powershell
# Remove old gallery
Remove-Item "E:\Code Stuff\cuddlebuns\public\gallery\*" -Recurse -Force

# Copy new built gallery
Copy-Item "E:\Code Stuff\cuddlebuns\gallery-v2\dist\*" -Destination "E:\Code Stuff\cuddlebuns\public\gallery\" -Recurse
```

### Step 4: Commit and Push

```bash
cd "E:\Code Stuff\cuddlebuns"
git add .
git commit -m "Deploy gallery v2 to production

- Built with Vite for optimized performance
- Modern React architecture with components
- SPA routing enabled
- 🚀 Generated with Claude Code"
git push vps main
```

### Step 5: Update Caddyfile on VPS

Follow instructions in `CADDY_UPDATE.md` to add SPA routing support.

---

## Option 2: Build on Server (Advanced)

### Step 1: Create Post-Receive Hook on VPS

SSH into your VPS:

```bash
ssh masterpyon@cuddlebuns.moe
```

Create/edit the post-receive hook:

```bash
sudo nano /var/www/cuddlebuns/repos/cuddlebuns.git/hooks/post-receive
```

Add this content:

```bash
#!/bin/bash

set -e

echo "🚀 Starting deployment..."

# Configuration
GIT_DIR="/var/www/cuddlebuns/repos/cuddlebuns.git"
WORK_TREE="/var/www/cuddlebuns/public"
GALLERY_SRC="/var/www/cuddlebuns/public/gallery-v2"

# Checkout latest code
echo "📥 Checking out latest code..."
GIT_WORK_TREE=$WORK_TREE git --git-dir=$GIT_DIR checkout -f main

# Check if we need to build gallery-v2
if [ -d "$GALLERY_SRC" ]; then
    echo "🔍 Detected gallery-v2, building..."

    cd "$GALLERY_SRC"

    # Install/update dependencies
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing dependencies..."
        pnpm install
    else
        echo "📦 Updating dependencies..."
        pnpm install --frozen-lockfile
    fi

    # Build production bundle
    echo "🔨 Building production bundle..."
    pnpm build

    # Deploy to public/gallery
    echo "📤 Deploying to public/gallery..."
    rm -rf "$WORK_TREE/gallery"
    mkdir -p "$WORK_TREE/gallery"
    cp -r dist/* "$WORK_TREE/gallery/"

    # Set permissions
    echo "🔧 Setting permissions..."
    chown -R www-data:www-data "$WORK_TREE/gallery"
    chmod -R 755 "$WORK_TREE/gallery"

    echo "✅ Gallery built and deployed!"
else
    echo "ℹ️  No gallery-v2 directory, skipping build..."
fi

echo "🎉 Deployment complete!"
echo "Website: https://cuddlebuns.moe/gallery/"
```

Make it executable:

```bash
sudo chmod +x /var/www/cuddlebuns/repos/cuddlebuns.git/hooks/post-receive
```

### Step 2: Install Node.js and pnpm on VPS (if not already installed)

```bash
# Install Node.js (via nvm or package manager)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
sudo npm install -g pnpm
```

### Step 3: Push to Deploy

```bash
cd "E:\Code Stuff\cuddlebuns"
git add .
git commit -m "Add gallery-v2 source files"
git push vps main
```

The hook will automatically build and deploy!

---

## Deployment Checklist

Before deploying:

- [ ] Build works locally: `pnpm build` in gallery-v2/
- [ ] Preview looks correct: `pnpm preview`
- [ ] All features tested (see TESTING.md)
- [ ] Images load properly
- [ ] No console errors
- [ ] Fonts loading correctly

After deploying:

- [ ] Update Caddyfile with SPA routing (CADDY_UPDATE.md)
- [ ] Visit https://cuddlebuns.moe/gallery/
- [ ] Test all character selections
- [ ] Test lightbox functionality
- [ ] Test language toggle
- [ ] Check mobile responsiveness
- [ ] Hard refresh browser (Ctrl+F5) to clear cache

---

## Quick Deploy Script (Option 1)

Save this as `deploy-gallery.ps1` in your cuddlebuns directory:

```powershell
# Gallery Deployment Script
Write-Host "🚀 Deploying Gallery v2..." -ForegroundColor Cyan

# Build
Write-Host "🔨 Building..." -ForegroundColor Yellow
cd gallery-v2
pnpm build
cd ..

# Clear old gallery
Write-Host "🧹 Clearing old gallery..." -ForegroundColor Yellow
Remove-Item "public\gallery\*" -Recurse -Force -ErrorAction SilentlyContinue

# Copy new build
Write-Host "📤 Copying new build..." -ForegroundColor Yellow
Copy-Item "gallery-v2\dist\*" -Destination "public\gallery\" -Recurse

# Git commit and push
Write-Host "📦 Committing and pushing..." -ForegroundColor Yellow
git add .
git commit -m "Deploy gallery v2 - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push vps main

Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host "🌐 Visit: https://cuddlebuns.moe/gallery/" -ForegroundColor Cyan
```

Usage:

```powershell
.\deploy-gallery.ps1
```

---

## Troubleshooting

### Gallery shows 404 errors
- Make sure Caddyfile has SPA routing (see CADDY_UPDATE.md)
- Run `sudo systemctl reload caddy` after updating

### Images not loading
- Check permissions: `sudo chown -R www-data:www-data /var/www/cuddlebuns/public/gallery`
- Check that images exist in `public/gallery/commissions/` and `public/gallery/referencesheets/`

### Old gallery still showing
- Hard refresh: Ctrl+F5
- Clear browser cache
- Check that files were actually updated on server: `ssh masterpyon@cuddlebuns.moe "ls -la /var/www/cuddlebuns/public/gallery/"`

### Build fails on server (Option 2)
- Check Node.js version: `node --version` (should be 18+)
- Check pnpm installed: `pnpm --version`
- Check disk space: `df -h`
- Check error logs: `tail -f /var/log/syslog`

---

## Rollback to Old Gallery

If you need to rollback:

```bash
git revert HEAD
git push vps main
```

Or manually SSH and restore backup:

```bash
ssh masterpyon@cuddlebuns.moe
cd /var/www/cuddlebuns/public
# Restore from backup or previous commit
```

---

**Recommendation**: Use **Option 1** (build locally) for simplicity and reliability!

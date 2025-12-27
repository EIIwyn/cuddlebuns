# Cuddlebuns.moe Deployment Guide

## 📁 File Structure

### Local (Development)
```
cuddlebuns/
├── assets/                    # Images (not in git, synced via rsync)
│   ├── commissions/
│   └── referencesheets/
├── gallery-v2/               # React source code
│   ├── src/
│   ├── public/
│   │   └── characters.json
│   ├── vite.config.js
│   └── package.json
├── public/                   # Deployment staging
│   ├── assets/              # Symlink or copy of ../assets
│   └── gallery/             # Built React app (committed to git)
├── vps-scripts/             # VPS helper scripts
├── deploy.sh                # Main deployment script
└── site1.caddy             # Caddyfile configuration
```

### VPS (`/var/www/cuddlebuns/`)
```
/var/www/cuddlebuns/
├── repos/
│   └── cuddlebuns.git/      # Bare git repository
│       └── hooks/
│           └── post-receive # Auto-deployment hook
├── public/                  # Web root (served by Caddy)
│   ├── assets/             # Shared assets folder
│   │   ├── commissions/
│   │   └── referencesheets/
│   └── gallery/            # Built React app
│       ├── index.html
│       ├── characters.json
│       └── assets/         # Vite-built assets (JS/CSS)
└── .git/                   # Working directory git
```

## 🚀 Deployment Workflow

### 1. Initial VPS Setup (One-time)

**On VPS**, run these commands:

```bash
# Create bare repository
cd /var/www/cuddlebuns/repos
git init --bare cuddlebuns.git

# Set up work tree configuration
cd cuddlebuns.git
git config core.worktree /var/www/cuddlebuns
git config receive.denyCurrentBranch updateInstead

# Copy post-receive hook
# (Upload vps-scripts/post-receive to the VPS first)
cp ~/post-receive /var/www/cuddlebuns/repos/cuddlebuns.git/hooks/
chmod +x /var/www/cuddlebuns/repos/cuddlebuns.git/hooks/post-receive

# Create public directories
mkdir -p /var/www/cuddlebuns/public/assets
mkdir -p /var/www/cuddlebuns/public/gallery

# Set permissions
chown -R masterpyon:www-cuddlebuns /var/www/cuddlebuns/public
chmod -R 755 /var/www/cuddlebuns/public
```

### 2. Deploy Gallery (Regular Workflow)

**On local machine**:

```bash
# Make deploy script executable (first time only)
chmod +x deploy.sh

# Deploy
./deploy.sh
```

This script will:
1. ✅ Build React app locally (`npm run build`)
2. ✅ Copy built files to `public/gallery/`
3. ✅ Commit and push to VPS
4. ✅ Auto-deploy via git hook

### 3. Sync Assets (When you add new images)

**On local machine**:

```bash
# Make script executable (first time only)
chmod +x vps-scripts/sync-assets.sh

# Sync assets
./vps-scripts/sync-assets.sh
```

Or manually with rsync:
```bash
rsync -avz --progress ./assets/ masterpyon@cuddlebuns.moe:/var/www/cuddlebuns/public/assets/
```

## 🔧 How It Works

### Git Remote Configuration
Your local repo has two remotes:
- `origin`: GitHub (backup/collaboration)
- `vps`: Production server

```bash
# View remotes
git remote -v

# Push to VPS
git push vps main

# Push to GitHub
git push origin main
```

### Post-Receive Hook
When you push to `vps`, the hook automatically:
1. Checks out code to `/var/www/cuddlebuns/`
2. Sets correct file permissions
3. Reloads Caddy web server

### Asset References in Code
The React app references assets as:
```javascript
"/assets/commissions/ruri_tinytale/@puffiewaffles.png"
```

This works because:
- **Dev mode**: Vite serves from parent `../assets/` folder
- **Production**: Caddy serves from `/var/www/cuddlebuns/public/assets/`

## 📝 Making Changes

### Update Gallery Code
```bash
# Edit files in gallery-v2/src/
cd gallery-v2
npm run dev  # Test locally

# Deploy when ready
cd ..
./deploy.sh
```

### Update Characters Data
```bash
# Edit gallery-v2/public/characters.json
# Then deploy
./deploy.sh
```

### Add New Images
```bash
# Add images to assets/commissions/ or assets/referencesheets/
# Sync to VPS
./vps-scripts/sync-assets.sh
```

### Update Caddyfile
```bash
# Edit site1.caddy locally
# Upload to VPS
scp site1.caddy masterpyon@cuddlebuns.moe:/etc/caddy/Caddyfile

# Reload Caddy on VPS
ssh masterpyon@cuddlebuns.moe "sudo systemctl reload caddy"
```

## 🛠️ Troubleshooting

### Check Deployment Status
```bash
# On VPS
cd /var/www/cuddlebuns
git log -1  # See latest deployed commit
ls -la public/gallery/  # Check deployed files
```

### Force Re-deploy
```bash
# On VPS
cd /var/www/cuddlebuns/repos/cuddlebuns.git/hooks
./post-receive
```

### Check Caddy Status
```bash
# On VPS
sudo systemctl status caddy
sudo journalctl -u caddy -f  # View logs
```

### Permission Issues
```bash
# On VPS
sudo chown -R masterpyon:www-cuddlebuns /var/www/cuddlebuns/public
sudo chmod -R 755 /var/www/cuddlebuns/public
```

## 🔒 Security Notes

### Assets Protected By:
- Bot blocking (curl, wget, scrapers)
- No directory listing
- Cache headers with source attribution
- Optional hotlink protection (commented out in Caddyfile)

### Git Security:
- `.git/` folder hidden by Caddy
- Built files only (no source code on VPS)
- Assets synced separately (not in git)

## 📚 Quick Reference

| Task | Command |
|------|---------|
| Deploy gallery | `./deploy.sh` |
| Sync assets | `./vps-scripts/sync-assets.sh` |
| Test locally | `cd gallery-v2 && npm run dev` |
| Build locally | `cd gallery-v2 && npm run build` |
| SSH to VPS | `ssh masterpyon@cuddlebuns.moe` |
| View site | `https://cuddlebuns.moe/gallery` |

## 🎯 URLs

- **Production**: https://cuddlebuns.moe/gallery
- **Assets**: https://cuddlebuns.moe/assets/
- **Dev server**: http://localhost:5173 (when running `npm run dev`)

# VPS Asset Migration Guide

## Current State on VPS

```
/var/www/cuddlebuns/public/
└── gallery/
    ├── index.html
    ├── characters.json
    └── assets/              ❌ Assets nested in gallery
        ├── commissions/
        └── referencesheets/
```

## Target State

```
/var/www/cuddlebuns/public/
├── assets/                  ✅ Site-wide shared assets
│   ├── commissions/
│   └── referencesheets/
└── gallery/
    ├── index.html
    └── characters.json
```

## Why This Change?

**Before:** Assets only accessible at `https://cuddlebuns.moe/gallery/assets/...`
- Locked inside gallery
- Can't be used by other site sections
- Awkward URLs

**After:** Assets accessible at `https://cuddlebuns.moe/assets/...`
- ✅ Site-wide access
- ✅ Clean URLs
- ✅ Future pages can use same images
- ✅ No duplication

## Migration Steps

### Option 1: Let Git Deployment Handle It (Recommended)

The updated deployment script will automatically:
1. Copy `/assets` → `/public/assets` locally
2. Commit to git
3. Push to VPS
4. VPS receives assets at correct location

**Just run:**
```powershell
.\deploy-gallery.ps1
```

Then on VPS, verify:
```bash
ssh masterpyon@cuddlebuns.moe
ls /var/www/cuddlebuns/public/assets/
```

### Option 2: Manual Migration on VPS

If you want to migrate existing assets on VPS right now:

```bash
ssh masterpyon@cuddlebuns.moe

# Navigate to public directory
cd /var/www/cuddlebuns/public

# Move assets from gallery to root
mv gallery/assets ./

# Verify structure
ls -la assets/
ls -la gallery/

# Check sizes
du -sh assets/
du -sh gallery/
```

## Post-Migration Verification

After migration, verify assets are accessible:

```bash
# Test asset URLs
curl -I https://cuddlebuns.moe/assets/commissions/ruri_tinytale/@puffiewaffles.png
curl -I https://cuddlebuns.moe/assets/referencesheets/ruri_reference.png

# Should return 200 OK with image/png content-type
```

Visit gallery and test:
- `https://cuddlebuns.moe/gallery/`
- Click character buttons - images should load
- Open lightbox - full-size images should work
- No broken images (check browser console)

## Rollback Plan

If something goes wrong:

```bash
# Restore old structure (if you didn't delete)
ssh masterpyon@cuddlebuns.moe
cd /var/www/cuddlebuns/public
mv assets/ gallery/assets/
```

Or revert git commit and redeploy.

## Expected File Sizes

- `assets/` folder: ~230MB
- `gallery/` folder: ~230KB (without assets)
- Total: Same size, just reorganized

## Caddy Configuration

After migration, update Caddyfile to optimize asset caching:

```caddy
# Cache /assets with long duration
@static {
    path *.jpg *.jpeg *.png *.gif *.webp *.svg
    path /assets/*
}
header @static Cache-Control "public, max-age=31536000, immutable"
```

See `CADDY_UPDATE.md` for complete configuration.

## Future Usage Examples

Now other pages can reference shared assets:

**Homepage** (`/var/www/cuddlebuns/public/index.html`):
```html
<img src="/assets/referencesheets/ruri_reference.png" alt="Ruri">
```

**About page**:
```html
<img src="/assets/commissions/ruri_tinytale/@puffiewaffles.png">
```

**Blog post**:
```html
<img src="/assets/referencesheets/nano_reference.png">
```

All using the same shared assets folder! 🎉

---

**Migration Status**: Ready to deploy
**Estimated Time**: ~5 minutes
**Downtime**: None (assets work from both locations temporarily)

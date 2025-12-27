# Assets Migration to Shared Folder

## What Changed

Moved all images (commissions and reference sheets) from `gallery-v2/public/` to a shared `/assets/` folder at the repository root. This eliminates duplication and allows other parts of the website to use the same images.

## New Structure

```
cuddlebuns/
├── assets/                              # ✨ NEW: Shared assets for entire site
│   ├── commissions/                     # ~230MB of commission artwork
│   │   ├── ruri_tinytale/
│   │   ├── piper_permit/
│   │   ├── nano_gure/
│   │   └── ... (8 character folders)
│   └── referencesheets/                 # Reference sheet images
│       ├── ruri_reference.png
│       ├── piper_reference.png
│       └── ... (16 reference sheets)
│
├── gallery-v2/
│   ├── public/
│   │   ├── characters.json              # Updated with /assets/ paths
│   │   └── vite.svg
│   ├── vite.config.js                   # ✨ Updated: copies assets during build
│   └── ...
│
└── public/
    └── gallery/                          # Deployed gallery (includes assets copy)
```

## Benefits

✅ **No duplication** - Images stored once in `/assets`, used everywhere
✅ **Easier maintenance** - Update character artwork in one location
✅ **Smaller repository** - No duplicate 230MB folders
✅ **Future-proof** - Other site sections can reference `/assets`
✅ **Better caching** - Consistent URLs across the site
✅ **Cleaner builds** - Vite copies only what's needed

## How It Works

### Development Mode (`pnpm dev`)

1. Dev server runs on `http://localhost:5173`
2. Custom Vite middleware serves `/assets/*` requests from `../assets/`
3. Characters.json references `/assets/commissions/...` and `/assets/referencesheets/...`
4. No copying needed - serves directly from source

### Production Build (`pnpm build`)

1. Vite builds React app to `gallery-v2/dist/`
2. `vite-plugin-static-copy` copies `/assets` → `dist/assets/`
3. Final `dist/` folder contains:
   - index.html
   - assets/index-*.css (app styles)
   - assets/index-*.js (app bundle)
   - assets/commissions/ (copied from root)
   - assets/referencesheets/ (copied from root)
4. Deploy script copies `dist/*` → `public/gallery/`

### VPS Deployment

When deployed to VPS:
```
/var/www/cuddlebuns/public/
├── gallery/                    # Gallery app
│   ├── index.html
│   ├── assets/
│   │   ├── index-*.css
│   │   ├── index-*.js
│   │   ├── commissions/       # Copied during build
│   │   └── referencesheets/   # Copied during build
│   ├── characters.json
│   └── vite.svg
└── (other site files)
```

**URL structure:**
- Gallery: `https://cuddlebuns.moe/gallery/`
- Images: `https://cuddlebuns.moe/gallery/assets/commissions/...`

## Technical Details

### Vite Configuration

**vite.config.js** includes:

1. **Custom middleware** (dev only):
   ```js
   function serveAssetsPlugin() {
     // Serves /assets/* from parent directory during dev
   }
   ```

2. **Static copy plugin** (build only):
   ```js
   viteStaticCopy({
     targets: [
       { src: '../assets/commissions', dest: 'assets' },
       { src: '../assets/referencesheets', dest: 'assets' }
     ]
   })
   ```

### Characters.json Updates

All image paths updated from:
```json
"image": "commissions/ruri_tinytale/@puffiewaffles.png"
"refSheets": ["referencesheets/ruri_reference.png"]
```

To:
```json
"image": "/assets/commissions/ruri_tinytale/@puffiewaffles.png"
"refSheets": ["/assets/referencesheets/ruri_reference.png"]
```

### Deployment Script Updates

**deploy-gallery.ps1** now:
1. Builds gallery (automatically copies assets)
2. Copies `gallery-v2/dist/*` → `public/gallery/`
3. Commits both `public/gallery/` and `assets/` to git
4. Pushes to VPS

## Future Usage

Other parts of the website can now reference shared assets:

```html
<!-- Homepage hero image -->
<img src="/assets/referencesheets/ruri_reference.png" alt="Ruri">

<!-- Character showcase -->
<img src="/assets/commissions/ruri_tinytale/@puffiewaffles.png" alt="Commission">
```

No need to duplicate images or maintain separate copies!

## Migration Checklist

- [x] Created `/assets/commissions/` and `/assets/referencesheets/`
- [x] Moved images from `gallery-v2/public/` to `/assets/`
- [x] Updated `characters.json` paths to reference `/assets/`
- [x] Installed `vite-plugin-static-copy` dependency
- [x] Updated `vite.config.js` with asset serving + copying
- [x] Removed duplicate images from `gallery-v2/public/`
- [x] Updated deployment script to commit `/assets/`
- [x] Tested build - assets copied successfully (230MB)
- [x] Tested dev server - assets served correctly

## Maintenance

### Adding New Character

1. Add images to `/assets/commissions/new_character/`
2. Add reference sheet to `/assets/referencesheets/`
3. Update `gallery-v2/public/characters.json`:
   ```json
   {
     "id": 11,
     "name": "New Character",
     "refSheets": ["/assets/referencesheets/new_character.png"],
     "commissions": [
       {
         "image": "/assets/commissions/new_character/@artist.png",
         "sourceUrl": "..."
       }
     ]
   }
   ```
4. Deploy: `.\deploy-gallery.ps1`

### Using Assets in Other Projects

Just reference `/assets/...` paths - no copying needed!

---

**Migration completed**: 2025-12-26
**Images moved**: ~230MB (58 files)
**Status**: ✅ Tested and working

# Gallery Workflow Guide

## Adding New Commissions to the Gallery

Follow these steps when you receive new commission artwork to add to the gallery.

---

## Step-by-Step Checklist

### 1. Add Images to Assets Folder

Place new images in the appropriate character folder:

```bash
/assets/commissions/[character_name]/@artist.png
/assets/commissions/[character_name]/[version]/@artist.png
```

**Example:**
```bash
/assets/commissions/ruri_tinytale/@artist_name.png
/assets/commissions/ruri_tinytale/wiwu/@artist_name.png
```

**Naming Convention:**
- Use `@artist_name` prefix for automatic artist detection
- Supported formats: PNG, JPG, JPEG, GIF

---

### 2. Run Interactive Commission Adder

```bash
cd site
npm run add
```

**What this does:**
- Shows each image with details (path, artist, size, format)
- Automatically detects which character based on folder name
- Asks you to confirm or select a different character
- Prompts you to choose which version to add to
- Asks for source URL (Twitter/Skeb link)
- Updates the character JSON files automatically

---

### 3. Renumber Commission IDs (Optional)

```bash
npm run build:renumber
```

**What this does:**
- Automatically renumbers all commission IDs to be sequential (1, 2, 3...)
- Detects and warns about duplicate IDs
- Only needed if you manually reordered commissions in JSON files
- Safe to run anytime - only updates files that need changes

**When to use:**
- After manually reordering commission entries in character JSON files
- If you notice gaps in commission IDs (e.g., 1, 2, 5, 7)
- When you see duplicate ID warnings

**Note:** This step runs automatically during `npm run build` (production build), so you typically don't need to run it manually.

---

### 4. Rebuild Character Data

```bash
npm run build:data
```

**What this does:**
- Combines individual character JSONs into `characters.json`
- Reports any new images found that haven't been added yet
- No timestamp in output (prevents unnecessary commits)

---

### 5. Convert Images to Modern Formats

```bash
npm run convert:images
```

**What this does:**
- Creates WebP versions (85% quality)
- Creates AVIF versions (75% quality)
- Automatically skips reference sheets (preserves original quality)
- Shows file size savings
- Only converts images that are newer than existing conversions

**Optional flags:**
- `npm run convert:images:force` - Re-convert all images even if they exist

---

### 6. Build Production Files

```bash
npm run build
```

**What this does:**
- Automatically runs `build:renumber` first (renumbers commission IDs)
- Then runs `build:data` (combines character JSONs)
- Builds optimized React app
- Outputs to `dist/` folder

---

### 7. Sync Assets to VPS (Do This First!)

**IMPORTANT:** Always sync assets BEFORE deploying code to avoid 404 errors.

```bash
cd ..
bash vps-scripts/sync-assets-scp.sh
```

**What this does:**
- Uploads all images including WebP/AVIF versions
- Preserves subdirectory structure
- Uses SCP (recommended for Windows)

**Alternative (if rsync is available):**
```bash
bash vps-scripts/sync-assets.sh
```

---

### 8. Deploy Site to VPS

```bash
bash deploy.sh
```

**What this does:**
- Builds the React app (runs steps 3, 4, & 6 automatically)
- Commits built files to git
- Pushes to VPS via git
- VPS automatically updates the live site

---

## Quick Reference Commands

Run all steps in sequence from project root:

```bash
# 1. Add commission metadata (interactive)
cd site && npm run add

# 2. Renumber commission IDs (optional, only if you manually reordered)
npm run build:renumber

# 3. Generate combined JSON
npm run build:data

# 4. Create WebP/AVIF versions
npm run convert:images

# 5. Build for production (automatically runs renumber + build:data)
npm run build

# 6. Upload images FIRST (important!)
cd .. && bash vps-scripts/sync-assets-scp.sh

# 7. Deploy site
bash deploy.sh
```

---

## Important Notes

### Deployment Order Matters
Always run `sync-assets-scp.sh` BEFORE `deploy.sh` to avoid caching issues:
1. Assets sync → images available on VPS
2. Deploy code → HTML/JS references existing images
3. No 404 errors, no cache issues

### Reference Sheets
Reference sheets are **not converted** to WebP/AVIF by default to preserve maximum quality. They remain as PNG files.

### Image Format Fallback
The `ModernImage` component automatically serves the best format:
- Modern browsers (Chrome/Edge): AVIF (~70-90% smaller)
- Most browsers (Safari/Firefox): WebP (~60-80% smaller)
- Old browsers: Original PNG/JPG

### File Size Benefits
- AVIF: ~70-90% smaller than PNG
- WebP: ~60-80% smaller than PNG
- All three versions stored, but users only download one

---

## Troubleshooting

### "No changes to deploy" when running deploy.sh
This is normal if only non-code files changed. The script detects identical bundle hashes.

### Images not showing on live site
1. Check if assets were synced: `ssh -p 2222 masterpyon@cuddlebuns.moe "ls /var/www/cuddlebuns/public/assets/commissions/"`
2. Clear browser cache: Ctrl+Shift+R (hard refresh)
3. Check browser DevTools Network tab for 404 errors

### Console shows "404 /gallery/"
This is normal SPA behavior - Caddy's error handler catches it and serves index.html. Not a real error.

### React warnings about duplicate keys
If you see warnings like "Encountered two children with the same key", run `npm run build:renumber` to fix duplicate or missing commission IDs.

---

## Available Scripts

### Data Management
- `npm run build:data` - Rebuild characters.json from individual files
- `npm run build:renumber` - Renumber commission IDs sequentially (optional)
- `npm run add` - Interactive commission adder

### Image Processing
- `npm run convert:images` - Convert to WebP/AVIF (skip existing)
- `npm run convert:images:force` - Re-convert all images

### Development
- `npm run dev` - Start dev server (http://localhost:5173)
- `npm run build` - Build for production (runs renumber + build:data + vite build)
- `npm run preview` - Preview production build locally
- `npm run lint` - Check code for errors with ESLint

### Deployment
- `bash deploy.sh` - Deploy to VPS (from project root)
- `bash vps-scripts/sync-assets-scp.sh` - Sync assets to VPS

---

## Project Structure

```
cuddlebuns/
├── assets/
│   ├── commissions/
│   │   ├── ruri_tinytale/
│   │   │   ├── @artist.png
│   │   │   ├── @artist.webp
│   │   │   ├── @artist.avif
│   │   │   ├── wiwu/
│   │   │   └── wubold/
│   │   └── [other characters]/
│   └── referencesheets/
│       └── *.png (not converted)
├── site/
│   ├── public/
│   │   └── data/
│   │       ├── characters.json (combined, auto-generated)
│   │       └── characters/
│   │           ├── ruri_tinytale.json
│   │           ├── nano_gure.json
│   │           └── [other characters].json
│   ├── scripts/
│   │   ├── build-characters.js
│   │   ├── add-commissions.js
│   │   ├── convert-images.js
│   │   └── renumber-ids.js
│   └── src/
│       └── components/
│           └── ModernImage.jsx
├── vps-scripts/
│   ├── sync-assets-scp.sh (Windows-friendly)
│   └── sync-assets.sh (rsync variant)
└── deploy.sh
```

---

## Character JSON Structure

Individual character files in `site/public/data/characters/`:

```json
{
  "id": 1,
  "name": "Ruri Tinytale",
  "species": "Kobold",
  "color": "#7be3f2",
  "links": [...],
  "versions": [
    {
      "id": "default",
      "name": "Ruri",
      "refSheets": ["/assets/referencesheets/ruri_reference.png"],
      "commissions": [
        {
          "id": 1,
          "artist": "@artist_name",
          "image": "/assets/commissions/ruri_tinytale/@artist_name.png",
          "sourceUrl": "https://twitter.com/..."
        }
      ]
    }
  ]
}
```

---

## Success!

Once deployed, your new commissions will be live at:
**https://cuddlebuns.moe/gallery**

Modern browsers will automatically load the optimized AVIF/WebP versions for faster loading!

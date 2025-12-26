# Gallery v2 Deployment Checklist

## Pre-Deployment

### Local Testing
- [ ] Run `pnpm dev` - dev server works at http://localhost:5173
- [ ] All 10 characters display correctly
- [ ] Reference sheets load and display
- [ ] Commissions load in grid
- [ ] Lightbox opens and closes (ESC key works)
- [ ] Language toggle works (English ↔ 日本語)
- [ ] Version selector works (for characters with multiple versions)
- [ ] Social links work and open in new tabs
- [ ] No console errors in browser (F12 → Console)

### Production Build Testing
- [ ] Run `pnpm build` - build succeeds
- [ ] Run `pnpm preview` - preview server works at http://localhost:4173
- [ ] Test all features again in preview mode
- [ ] Check that images load from `/commissions/` and `/referencesheets/`
- [ ] Verify fonts load correctly (Playfair Display, Source Sans Pro)

## Deployment Steps

### Option A: Using Deploy Script (Easiest)

1. **Run deployment script:**
   ```powershell
   cd "E:\Code Stuff\cuddlebuns"
   .\deploy-gallery.ps1
   ```

2. **Update Caddyfile on VPS:**
   ```bash
   ssh masterpyon@cuddlebuns.moe
   sudo nano /etc/caddy/Caddyfile
   ```
   - Add SPA routing config (see `CADDY_UPDATE.md`)
   - Save and exit (Ctrl+X, Y, Enter)

3. **Reload Caddy:**
   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

### Option B: Manual Deployment

1. **Build production bundle:**
   ```bash
   cd "E:\Code Stuff\cuddlebuns\gallery-v2"
   pnpm build
   ```

2. **Copy to public directory:**
   ```powershell
   Remove-Item "E:\Code Stuff\cuddlebuns\public\gallery\*" -Recurse -Force
   Copy-Item "E:\Code Stuff\cuddlebuns\gallery-v2\dist\*" -Destination "E:\Code Stuff\cuddlebuns\public\gallery\" -Recurse
   ```

3. **Commit and push:**
   ```bash
   cd "E:\Code Stuff\cuddlebuns"
   git add .
   git commit -m "Deploy gallery v2"
   git push vps main
   ```

4. **Update Caddyfile** (same as Option A, step 2-3)

## Post-Deployment Verification

### Immediate Checks
- [ ] Visit https://cuddlebuns.moe/gallery/
- [ ] Hard refresh (Ctrl+F5) to bypass cache
- [ ] Page loads without errors
- [ ] Header shows "REFERENCE SHEETS & COMMISSIONS"
- [ ] Language toggle button visible in top-right
- [ ] All 10 character buttons visible

### Functionality Tests
- [ ] Click "Ruri Tinytale" - reference sheet displays
- [ ] Click toggle button - commissions display
- [ ] Click a commission - lightbox opens
- [ ] Press ESC - lightbox closes
- [ ] Try "Piper Permit" - multiple ref sheets work (arrows appear)
- [ ] Try "Yukiko Yasashi" - version selector appears
- [ ] Click language toggle - text changes to Japanese
- [ ] Test on mobile device (or browser dev tools mobile mode)

### Performance Checks
- [ ] Page loads quickly (under 3 seconds)
- [ ] Images load progressively
- [ ] No broken image icons
- [ ] Smooth animations
- [ ] No console errors (F12 → Console)

### Cross-Browser Testing
- [ ] Chrome/Edge - works correctly
- [ ] Firefox - works correctly
- [ ] Safari (if available) - works correctly
- [ ] Mobile Chrome - works correctly
- [ ] Mobile Safari - works correctly

## Troubleshooting

### Gallery shows 404
**Problem:** Visiting https://cuddlebuns.moe/gallery/ returns 404

**Solution:**
1. Check Caddyfile has SPA routing (see `CADDY_UPDATE.md`)
2. Reload Caddy: `sudo systemctl reload caddy`
3. Check files exist: `ls -la /var/www/cuddlebuns/public/gallery/`

### Images not loading
**Problem:** Character buttons visible but no images

**Solution:**
1. Check image paths in browser Network tab (F12 → Network)
2. Verify images deployed: `ssh masterpyon@cuddlebuns.moe "ls /var/www/cuddlebuns/public/gallery/commissions/"`
3. Check permissions: `sudo chown -R www-data:www-data /var/www/cuddlebuns/public/gallery`

### Old gallery still showing
**Problem:** Changes not visible on live site

**Solution:**
1. Hard refresh: Ctrl+F5
2. Clear browser cache completely
3. Try incognito/private window
4. Check file modification time on server: `ssh masterpyon@cuddlebuns.moe "stat /var/www/cuddlebuns/public/gallery/index.html"`

### Fonts look wrong
**Problem:** Text appears in wrong fonts

**Solution:**
1. Check browser console for font loading errors
2. Verify Google Fonts loading in Network tab
3. Check `index.html` has font links (should be added already)

### Blank page / JavaScript errors
**Problem:** Page loads but is blank, errors in console

**Solution:**
1. Check console errors - likely path issue
2. Verify `characters.json` accessible at https://cuddlebuns.moe/gallery/characters.json
3. Check that all files from `dist/` were copied correctly

## Rollback Procedure

If something goes wrong and you need to restore the old gallery:

### Quick Rollback (if backup exists)
```powershell
# Find your backup
ls "E:\Code Stuff\cuddlebuns\public\" | Select-String "gallery-backup"

# Restore backup (replace with your backup folder name)
Remove-Item "E:\Code Stuff\cuddlebuns\public\gallery" -Recurse -Force
Move-Item "E:\Code Stuff\cuddlebuns\public\gallery-backup-YYYYMMDD-HHMMSS" "E:\Code Stuff\cuddlebuns\public\gallery"

# Push to VPS
git add .
git commit -m "Rollback to old gallery"
git push vps main
```

### Git Rollback
```bash
git revert HEAD
git push vps main
```

## Success Criteria

Deployment is successful when:
- ✅ https://cuddlebuns.moe/gallery/ loads without errors
- ✅ All characters visible and clickable
- ✅ Reference sheets display correctly
- ✅ Commissions display in grid
- ✅ Lightbox works (open/close/navigate)
- ✅ Language toggle works
- ✅ No console errors
- ✅ Mobile responsive
- ✅ Performance is good (fast load times)

## Maintenance

### Updating Gallery Content

To add new characters or commissions:

1. Edit `gallery-v2/public/characters.json`
2. Add images to `gallery-v2/public/commissions/` or `gallery-v2/public/referencesheets/`
3. Test locally: `pnpm dev`
4. Deploy: `.\deploy-gallery.ps1`

### Updating Code

To make code changes:

1. Edit files in `gallery-v2/src/`
2. Test locally: `pnpm dev`
3. Build and preview: `pnpm build && pnpm preview`
4. Deploy: `.\deploy-gallery.ps1`

---

**Ready to deploy?** Start with "Pre-Deployment" checklist and work your way down!

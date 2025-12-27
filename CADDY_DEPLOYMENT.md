# Caddy Deployment Guide

This guide shows how to deploy the new Caddyfile to your VPS with recommended security protections.

## What's Included

The new Caddyfile includes:

✅ **Gallery SPA Routing** - React app works correctly
✅ **Bot Protection** - Blocks curl, wget, scrapers
✅ **No Directory Listing** - Can't browse /assets folders
✅ **Optimized Caching** - Fast loading with proper cache headers
✅ **Security Headers** - XSS, clickjacking, MIME sniffing protection
✅ **Compression** - Gzip/Zstd for faster downloads
✅ **CORS Support** - Allows cross-origin requests

Optional (commented out):
- Hotlink protection
- Custom error pages
- Access logging
- WWW redirect

## Deployment Steps

### Step 1: Backup Current Caddyfile

SSH into your VPS:

```bash
ssh masterpyon@cuddlebuns.moe
```

Backup the current configuration:

```bash
# Create backup
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.backup-$(date +%Y%m%d)

# Verify backup
ls -la /etc/caddy/Caddyfile*
```

### Step 2: Upload New Caddyfile

**Option A: Copy/Paste (Easy)**

```bash
# Edit Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Then copy the contents from `E:\Code Stuff\cuddlebuns\Caddyfile` and paste into nano.

Save: `Ctrl+X`, `Y`, `Enter`

**Option B: SCP Upload (Recommended)**

From your local Windows machine:

```powershell
# Upload Caddyfile to VPS
scp "E:\Code Stuff\cuddlebuns\Caddyfile" masterpyon@cuddlebuns.moe:/tmp/Caddyfile.new
```

Then on VPS:

```bash
# Move to correct location
sudo mv /tmp/Caddyfile.new /etc/caddy/Caddyfile

# Set correct permissions
sudo chown root:root /etc/caddy/Caddyfile
sudo chmod 644 /etc/caddy/Caddyfile
```

**Option C: Git Pull (If Caddyfile is in repo)**

```bash
# On VPS
cd /var/www/cuddlebuns/live
git pull origin main

# Copy Caddyfile from repo
sudo cp Caddyfile /etc/caddy/Caddyfile
```

### Step 3: Validate Configuration

**IMPORTANT:** Always validate before reloading!

```bash
# Test configuration syntax
sudo caddy validate --config /etc/caddy/Caddyfile
```

**Expected output:**
```
Valid configuration
```

**If you see errors:**
- Check for typos
- Verify file paths
- Compare with backup

### Step 4: Reload Caddy

```bash
# Reload Caddy (no downtime)
sudo systemctl reload caddy

# Check status
sudo systemctl status caddy
```

**Expected output:**
```
● caddy.service - Caddy
     Loaded: loaded
     Active: active (running)
```

**If reload fails:**

```bash
# Check logs for errors
sudo journalctl -u caddy -n 50 --no-pager

# Restore backup if needed
sudo cp /etc/caddy/Caddyfile.backup-YYYYMMDD /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Step 5: Test the Configuration

**Test 1: Gallery Loads**

```bash
curl -I https://cuddlebuns.moe/gallery/
```

Expected: `200 OK` with `content-type: text/html`

**Test 2: Assets Load**

```bash
curl -I https://cuddlebuns.moe/assets/referencesheets/ruri_reference.png
```

Expected: `200 OK` with `content-type: image/png`

**Test 3: Bot Protection Works**

```bash
# This should be BLOCKED (403)
curl -I https://cuddlebuns.moe/assets/commissions/ruri_tinytale/@puffiewaffles.png
```

Expected: `403 Forbidden`

**Test 4: Browser Access Works**

Visit in browser (should work):
- `https://cuddlebuns.moe/gallery/`
- `https://cuddlebuns.moe/assets/referencesheets/ruri_reference.png`

**Test 5: Caching Headers**

```bash
# Check cache headers
curl -I https://cuddlebuns.moe/assets/referencesheets/ruri_reference.png | grep -i cache
```

Expected: `Cache-Control: public, max-age=31536000, immutable`

**Test 6: Compression**

```bash
# Check gzip compression
curl -I -H "Accept-Encoding: gzip" https://cuddlebuns.moe/gallery/ | grep -i encoding
```

Expected: `Content-Encoding: gzip`

**Test 7: Security Headers**

```bash
# Check security headers
curl -I https://cuddlebuns.moe/gallery/ | grep -i "x-frame\|x-content"
```

Expected:
```
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
```

## Verification Checklist

After deployment, verify:

- [ ] Gallery loads: `https://cuddlebuns.moe/gallery/`
- [ ] Character buttons work
- [ ] Images load correctly
- [ ] Lightbox opens/closes
- [ ] No console errors (F12 → Console)
- [ ] Curl/wget requests blocked (403)
- [ ] Browser access works normally
- [ ] Cache headers present
- [ ] Gzip compression enabled
- [ ] HTTPS certificate valid

## Optional Configurations

### Enable Hotlink Protection

Uncomment in Caddyfile:

```caddy
@hotlink {
    path /assets/*
    not header Referer *cuddlebuns.moe*
    not header Referer ""
}
respond @hotlink "Hotlinking not permitted. Please visit cuddlebuns.moe" 403
```

**Warning:** This may prevent sharing on social media. Test thoroughly!

### Enable Access Logging

Uncomment in Caddyfile:

```caddy
log {
    output file /var/log/caddy/cuddlebuns.log
    format json
}
```

Create log directory:

```bash
sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy
sudo systemctl reload caddy
```

View logs:

```bash
sudo tail -f /var/log/caddy/cuddlebuns.log
```

### Add WWW Redirect

Uncomment at bottom of Caddyfile:

```caddy
www.cuddlebuns.moe {
    redir https://cuddlebuns.moe{uri} permanent
}
```

### Custom 404 Page

1. Create custom error page:

```bash
sudo nano /var/www/cuddlebuns/public/404.html
```

2. Uncomment in Caddyfile:

```caddy
handle_errors {
    @404 {
        expression {http.error.status_code} == 404
    }
    rewrite @404 /404.html
    file_server
}
```

## Troubleshooting

### Gallery shows 404

**Problem:** `https://cuddlebuns.moe/gallery/` returns 404

**Solution:**
```bash
# Check files exist
ls -la /var/www/cuddlebuns/public/gallery/

# Verify SPA routing
grep -A5 "@gallery" /etc/caddy/Caddyfile

# Reload Caddy
sudo systemctl reload caddy
```

### Images not loading

**Problem:** Images return 404 or 403

**Solution:**
```bash
# Check assets directory
ls -la /var/www/cuddlebuns/public/assets/

# Check permissions
sudo chown -R www-data:www-data /var/www/cuddlebuns/public/assets
sudo chmod -R 755 /var/www/cuddlebuns/public/assets

# Test direct access
curl -I https://cuddlebuns.moe/assets/referencesheets/ruri_reference.png
```

### Legitimate users blocked

**Problem:** Bot protection too aggressive

**Solution:** Adjust bot detection regex in Caddyfile:

```caddy
# Less aggressive - only block obvious bots
header_regexp User-Agent (?i)(curl|wget|scrapy)

# More aggressive - current setting
header_regexp User-Agent (?i)(curl|wget|python-requests|scrapy|go-http-client|bot|crawler|spider)
```

### HTTPS certificate issues

**Problem:** SSL/TLS errors

**Solution:**
```bash
# Check certificate status
sudo caddy trust

# Force certificate renewal
sudo certbot renew

# Restart Caddy
sudo systemctl restart caddy
```

### Configuration won't validate

**Problem:** `caddy validate` shows errors

**Solution:**
```bash
# Check syntax with verbose output
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Common issues:
# 1. Missing closing braces }
# 2. Incorrect indentation
# 3. Invalid matcher syntax
# 4. Typos in directives

# Restore backup
sudo cp /etc/caddy/Caddyfile.backup-YYYYMMDD /etc/caddy/Caddyfile
```

## Monitoring

### Check Caddy Status

```bash
# Status
sudo systemctl status caddy

# Logs (last 50 lines)
sudo journalctl -u caddy -n 50 --no-pager

# Follow logs in real-time
sudo journalctl -u caddy -f
```

### Performance Testing

```bash
# Test response time
time curl -s -o /dev/null https://cuddlebuns.moe/gallery/

# Check compression ratio
curl -s https://cuddlebuns.moe/gallery/ | wc -c  # Uncompressed
curl -s -H "Accept-Encoding: gzip" https://cuddlebuns.moe/gallery/ | wc -c  # Compressed
```

## Rollback Procedure

If something goes wrong:

```bash
# 1. Restore backup
sudo cp /etc/caddy/Caddyfile.backup-YYYYMMDD /etc/caddy/Caddyfile

# 2. Validate
sudo caddy validate --config /etc/caddy/Caddyfile

# 3. Reload
sudo systemctl reload caddy

# 4. Verify
curl -I https://cuddlebuns.moe/gallery/
```

## Next Steps

After successful deployment:

1. Test all gallery features
2. Monitor access logs (if enabled)
3. Check for any blocked legitimate traffic
4. Fine-tune bot protection if needed
5. Consider enabling hotlink protection after testing
6. Set up monitoring/alerts (optional)

---

**Deployment Status**: Ready to deploy
**Configuration**: Production-ready with protections
**Estimated Time**: 5-10 minutes
**Downtime**: None (reload is graceful)

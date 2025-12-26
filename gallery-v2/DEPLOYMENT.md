# 🚀 VPS Deployment Guide

## ✅ Build Complete!

Your production build is ready:
- **Build Location**: `E:\Code Stuff\cuddlebuns\gallery-v2\dist\`
- **Build Size**: ~228 KB (optimized and gzipped)
- **Test URL**: http://localhost:4173 (preview server running)

---

## 📦 What's in the Build?

```
dist/
├── index.html                      # Main HTML (0.46 KB)
├── assets/
│   ├── index-CxMcM2QE.css         # Styles (17.78 KB → 3.65 KB gzipped)
│   └── index-CONKNhAx.js          # App code (210.44 KB → 66.37 KB gzipped)
├── characters.json                 # Character data (14 KB)
├── commissions/                    # Commission images (~230 MB)
│   ├── manon_merope/
│   ├── miscellaneous/
│   ├── nano_gure/
│   ├── piper_permit/
│   ├── rixxy_brightful/
│   ├── ruri_tinytale/
│   ├── ryenna/
│   └── umamusume/
└── referencesheets/                # Reference sheets
    └── (all character reference images)
```

**Total Size**: ~230 MB (mostly images)

---

## 🎯 Deployment Options

Choose one based on your VPS setup:

### Option 1: Simple Static Hosting (Nginx) - **Recommended**
### Option 2: Caddy (Auto-HTTPS)
### Option 3: Apache

---

## Option 1: Deploy with Nginx (Most Common)

### Prerequisites
- Linux VPS (Ubuntu/Debian)
- SSH access to your server
- Domain name (optional, can use IP)

### Step 1: Prepare Your VPS

```bash
# SSH into your VPS
ssh username@your-server-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Nginx
sudo apt install nginx -y

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Check status
sudo systemctl status nginx
```

### Step 2: Create Directory for Gallery

```bash
# Create directory for your gallery
sudo mkdir -p /var/www/gallery

# Set ownership to your user
sudo chown -R $USER:$USER /var/www/gallery

# Set proper permissions
sudo chmod -R 755 /var/www/gallery
```

### Step 3: Upload Files to VPS

**From your Windows machine**, open PowerShell or use WinSCP:

#### Using SCP (PowerShell):
```powershell
# Navigate to your project
cd "E:\Code Stuff\cuddlebuns\gallery-v2"

# Upload the entire dist folder
scp -r dist/* username@your-server-ip:/var/www/gallery/
```

#### Alternative: Using WinSCP (GUI)
1. Download WinSCP: https://winscp.net/
2. Connect to your VPS
3. Navigate to `/var/www/gallery/`
4. Upload all files from `E:\Code Stuff\cuddlebuns\gallery-v2\dist\`

### Step 4: Configure Nginx

```bash
# On your VPS, create Nginx configuration
sudo nano /etc/nginx/sites-available/gallery
```

**Paste this configuration:**

```nginx
server {
    listen 80;
    listen [::]:80;

    # Replace with your domain or use _ for IP-only access
    server_name gallery.yourdomain.com;
    # Or use: server_name _;

    root /var/www/gallery;
    index index.html;

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss image/svg+xml;

    # SPA fallback - all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location ~* \.(jpg|jpeg|png|gif|ico|webp|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location ~* \.(css|js)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Don't cache HTML
    location ~* \.html$ {
        expires -1;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

Save and exit (Ctrl+X, then Y, then Enter)

### Step 5: Enable the Site

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/gallery /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# If test passes, reload Nginx
sudo systemctl reload nginx
```

### Step 6: Configure Firewall

```bash
# Allow HTTP and HTTPS
sudo ufw allow 'Nginx Full'

# Or manually:
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall if not already enabled
sudo ufw enable

# Check status
sudo ufw status
```

### Step 7: Test Your Deployment

Visit your VPS:
- **By IP**: http://your-server-ip
- **By Domain**: http://gallery.yourdomain.com (if configured)

You should see your character gallery!

### Step 8: Add HTTPS (Free with Let's Encrypt)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get SSL certificate (replace with your domain)
sudo certbot --nginx -d gallery.yourdomain.com

# Follow prompts:
# - Enter email
# - Agree to terms
# - Choose to redirect HTTP to HTTPS (recommended)

# Test auto-renewal
sudo certbot renew --dry-run
```

Your site is now at: **https://gallery.yourdomain.com** 🎉

---

## Option 2: Deploy with Caddy (Easier HTTPS)

Caddy automatically handles HTTPS with Let's Encrypt!

### Step 1: Install Caddy

```bash
# Add Caddy repository
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### Step 2: Upload Files

```bash
# Create directory
sudo mkdir -p /var/www/gallery
sudo chown -R $USER:$USER /var/www/gallery

# From Windows, upload files
scp -r dist/* username@your-server-ip:/var/www/gallery/
```

### Step 3: Configure Caddy

```bash
# Edit Caddyfile
sudo nano /etc/caddy/Caddyfile
```

**Replace contents with:**

```caddy
gallery.yourdomain.com {
    root * /var/www/gallery
    encode gzip

    # SPA fallback
    try_files {path} /index.html

    file_server

    # Cache headers for images
    @images {
        path *.jpg *.jpeg *.png *.gif *.webp *.svg
    }
    header @images Cache-Control "public, max-age=31536000, immutable"

    # Cache headers for JS/CSS
    @assets {
        path *.js *.css
    }
    header @assets Cache-Control "public, max-age=31536000, immutable"
}
```

Save and exit.

### Step 4: Start Caddy

```bash
# Reload Caddy
sudo systemctl reload caddy

# Check status
sudo systemctl status caddy
```

**That's it!** Caddy automatically gets HTTPS certificate.

Visit: **https://gallery.yourdomain.com** 🎉

---

## 🔄 Updating Your Gallery

When you make changes:

### 1. Rebuild
```bash
cd "E:\Code Stuff\cuddlebuns\gallery-v2"
pnpm build
```

### 2. Upload New Build
```powershell
# From Windows
scp -r dist/* username@your-server-ip:/var/www/gallery/
```

### 3. Clear Browser Cache
Your users may need to hard refresh (Ctrl+F5) to see changes.

**Optional: Add versioning to prevent caching issues**

---

## 📊 Post-Deployment Checklist

- [ ] Gallery loads at http://your-server-ip
- [ ] All 10 characters visible
- [ ] Images load correctly
- [ ] Reference sheets work
- [ ] Commissions display
- [ ] Lightbox opens/closes
- [ ] Language toggle works
- [ ] No console errors (F12 → Console)
- [ ] HTTPS configured (if using domain)
- [ ] Firewall allows HTTP/HTTPS
- [ ] Old gallery backed up

---

## 🐛 Troubleshooting

### Images Not Loading
```bash
# Check file permissions
sudo chmod -R 755 /var/www/gallery

# Check ownership
sudo chown -R www-data:www-data /var/www/gallery
```

### 404 Errors
- Check Nginx/Caddy configuration
- Ensure `try_files` directive is correct for SPA

### Nginx Won't Start
```bash
# Check configuration
sudo nginx -t

# View error logs
sudo tail -f /var/log/nginx/error.log
```

### Caddy Won't Start
```bash
# Check configuration
caddy validate --config /etc/caddy/Caddyfile

# View logs
sudo journalctl -u caddy --no-pager | tail -n 50
```

---

## 🎯 Performance Optimization

### Enable HTTP/2 (Nginx)
```nginx
listen 443 ssl http2;
listen [::]:443 ssl http2;
```

### Add Content Security Policy
```nginx
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';" always;
```

### Monitor Bandwidth
```bash
# Install vnstat
sudo apt install vnstat -y

# View stats
vnstat
```

---

## 📝 DNS Configuration (If Using Domain)

If you have a domain, point it to your VPS:

### A Record
```
Type: A
Name: gallery (or @)
Value: YOUR_VPS_IP
TTL: 3600
```

### AAAA Record (IPv6, optional)
```
Type: AAAA
Name: gallery
Value: YOUR_VPS_IPv6
TTL: 3600
```

Wait 5-60 minutes for DNS propagation.

---

## 🔒 Security Best Practices

### 1. Keep System Updated
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Configure Fail2Ban
```bash
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 3. Disable Root Login
```bash
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart sshd
```

### 4. Setup Automatic Security Updates
```bash
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

---

## 📈 Next Steps

After successful deployment:

1. ✅ Test all features thoroughly
2. ✅ Monitor server logs for errors
3. ✅ Set up monitoring (optional: UptimeRobot, Pingdom)
4. ✅ Configure backups
5. ✅ Update DNS if using custom domain
6. ✅ Share your gallery! 🎨

---

## 🆘 Need Help?

**Common Issues:**
- Permissions: `sudo chown -R www-data:www-data /var/www/gallery`
- Firewall: `sudo ufw status` and allow ports 80/443
- Logs: `sudo tail -f /var/log/nginx/error.log`

**Testing Locally:**
Your production build is running at: http://localhost:4173

**Build Stats:**
- Total bundle: ~228 KB (gzipped: ~70 KB)
- Initial load: Lightning fast! ⚡
- Images: Lazy loaded for best performance

---

**Your gallery is production-ready! 🚀**

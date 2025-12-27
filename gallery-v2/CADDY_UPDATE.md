# Caddy Configuration Update for SPA Gallery

Your current Caddyfile needs to be updated to handle Single Page Application (SPA) routing for the new gallery.

## Current Caddyfile Location
`/etc/caddy/Caddyfile` on your VPS

## Required Update

Add this configuration **inside** your `cuddlebuns.moe` block, before the `file_server` directive:

```caddy
cuddlebuns.moe {
    # Set the root directory for the site
    root * /var/www/cuddlebuns/public

    # SPA routing for gallery - IMPORTANT: Add this BEFORE file_server
    @gallery {
        path /gallery /gallery/*
    }
    handle @gallery {
        # Try to serve the file, otherwise serve index.html for client-side routing
        try_files {path} /gallery/index.html
    }

    # Enable the static file server
    file_server

    # Gzip compression
    encode gzip zstd

    # Cache static assets aggressively
    @static {
        path *.jpg *.jpeg *.png *.gif *.webp *.svg *.ico *.css *.js
    }
    header @static {
        Cache-Control "public, max-age=31536000, immutable"
    }

    # Don't cache HTML
    @html {
        path *.html
    }
    header @html {
        Cache-Control "no-cache, no-store, must-revalidate"
    }

    # Enable CORS
    header {
        Access-Control-Allow-Origin "*"
        Access-Control-Allow-Methods "GET, POST, OPTIONS"
        Access-Control-Allow-Headers "Content-Type"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
    }

    # Handle preflight requests
    @options {
        method OPTIONS
    }
    respond @options 204
}
```

## Why This Is Needed

The new Vite gallery is a **Single Page Application (SPA)**. When users visit:
- `https://cuddlebuns.moe/gallery/` - Works fine (serves index.html)
- `https://cuddlebuns.moe/gallery/character/ruri` - Would return 404 without SPA routing

The `try_files` directive tells Caddy:
1. Try to serve the requested file (images, CSS, JS)
2. If the file doesn't exist, serve `/gallery/index.html` instead
3. React Router will then handle the client-side routing

## How to Apply

SSH into your VPS and edit the Caddyfile:

```bash
ssh masterpyon@cuddlebuns.moe
sudo nano /etc/caddy/Caddyfile
```

After making the changes, test and reload Caddy:

```bash
# Test configuration
sudo caddy validate --config /etc/caddy/Caddyfile

# Reload Caddy (no downtime)
sudo systemctl reload caddy
```

## Alternative: Complete Caddyfile

If you prefer, here's the complete updated Caddyfile:

```caddy
# Configuration for cuddlebuns.moe
cuddlebuns.moe {
    root * /var/www/cuddlebuns/public

    # SPA routing for gallery
    @gallery {
        path /gallery /gallery/*
    }
    handle @gallery {
        try_files {path} /gallery/index.html
    }

    file_server
    encode gzip zstd

    # Cache headers for static assets (images, fonts, etc)
    @static {
        path *.jpg *.jpeg *.png *.gif *.webp *.svg *.ico *.woff *.woff2 *.ttf
        path /assets/*
    }
    header @static Cache-Control "public, max-age=31536000, immutable"

    # Cache CSS/JS with shorter duration (can be updated more frequently)
    @scripts {
        path *.css *.js
    }
    header @scripts Cache-Control "public, max-age=2592000"

    # Don't cache HTML
    @html path *.html
    header @html Cache-Control "no-cache, no-store, must-revalidate"

    # Security and CORS headers
    header {
        Access-Control-Allow-Origin "*"
        Access-Control-Allow-Methods "GET, POST, OPTIONS"
        Access-Control-Allow-Headers "Content-Type"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
    }

    @options method OPTIONS
    respond @options 204
}
```

## Important: Assets at Root Level

With the new deployment structure, assets are served from:
- **Local dev**: `http://localhost:5173/assets/...` (served from `../assets/`)
- **Production**: `https://cuddlebuns.moe/assets/...` (served from `/var/www/cuddlebuns/public/assets/`)

This allows other parts of your website (not just the gallery) to reference shared assets!

# Caddy Asset Protection Guide

While assets in `/public/assets/` are publicly accessible (by design for a gallery), you can add protections to prevent abuse.

## Current Setup (No Protection)

```caddy
cuddlebuns.moe {
    root * /var/www/cuddlebuns/public
    file_server  # Serves everything including /assets
}
```

**Issue:** Anyone can hotlink or bulk download your images.

## Recommended Protections

### 1. Disable Directory Listing

Prevent browsing folders like `https://cuddlebuns.moe/assets/commissions/`

```caddy
cuddlebuns.moe {
    root * /var/www/cuddlebuns/public

    file_server {
        hide .git
        # Disable directory browsing
        browse off
    }
}
```

**Effect:** Individual files work, but can't browse directories.

### 2. Hotlink Protection (Referrer Check)

Only allow images to be loaded from your domain:

```caddy
cuddlebuns.moe {
    root * /var/www/cuddlebuns/public

    # Hotlink protection for assets
    @hotlink {
        path /assets/*
        not header Referer *cuddlebuns.moe*
        not header Referer ""  # Allow direct access (for testing)
    }

    # Return 403 for hotlinked requests
    respond @hotlink 403 {
        body "Hotlinking not permitted. Please visit cuddlebuns.moe"
    }

    file_server
}
```

**Effect:** Images only load on your website, not when embedded elsewhere.

### 3. Rate Limiting (Prevent Scraping)

Limit how many assets one IP can request:

```caddy
cuddlebuns.moe {
    root * /var/www/cuddlebuns/public

    # Rate limit asset downloads
    @assets {
        path /assets/*
    }

    route @assets {
        # Allow 100 requests per minute per IP
        rate_limit {remote.ip} 100r/m
        file_server
    }
}
```

**Effect:** Prevents bulk downloading/scraping.

### 4. User-Agent Filtering (Block Bots)

Block known scrapers:

```caddy
cuddlebuns.moe {
    root * /var/www/cuddlebuns/public

    # Block bad bots from assets
    @bad_bots {
        path /assets/*
        header User-Agent *curl*
        header User-Agent *wget*
        header User-Agent *scrapy*
    }

    respond @bad_bots 403

    file_server
}
```

**Effect:** Blocks common download tools.

## Complete Protected Configuration

Combine all protections:

```caddy
cuddlebuns.moe {
    root * /var/www/cuddlebuns/public

    # === GALLERY SPA ROUTING ===
    @gallery {
        path /gallery /gallery/*
    }
    handle @gallery {
        try_files {path} /gallery/index.html
    }

    # === ASSET PROTECTION ===

    # Block bad user agents
    @bad_bots {
        path /assets/*
        header User-Agent *curl*
        header User-Agent *wget*
        header User-Agent *python*
        header User-Agent *scrapy*
    }
    respond @bad_bots "Access denied" 403

    # Hotlink protection (commented out - can be strict for galleries)
    # @hotlink {
    #     path /assets/*
    #     not header Referer *cuddlebuns.moe*
    #     not header Referer ""
    # }
    # respond @hotlink "Hotlinking not permitted" 403

    # === FILE SERVER ===
    file_server {
        hide .git .env
    }

    # === COMPRESSION ===
    encode gzip zstd

    # === CACHING ===
    @static_assets {
        path *.jpg *.jpeg *.png *.gif *.webp *.svg *.ico
        path /assets/*
    }
    header @static_assets {
        Cache-Control "public, max-age=31536000, immutable"
        # Optional: Add watermark hint
        X-Image-Source "cuddlebuns.moe"
    }

    @scripts path *.css *.js
    header @scripts Cache-Control "public, max-age=2592000"

    @html path *.html
    header @html Cache-Control "no-cache, no-store, must-revalidate"

    # === SECURITY HEADERS ===
    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    # === CORS (Allow embedding on your own sites) ===
    @cors_preflight {
        method OPTIONS
    }
    respond @cors_preflight 204
}
```

## Recommended for Galleries

For a public art gallery, I recommend:

1. ✅ **Disable directory browsing** - Basic protection
2. ❌ **Skip hotlink protection** - Artists might share on social media
3. ✅ **Block obvious bots** - Prevent bulk scraping
4. ⚠️ **Maybe rate limiting** - Only if you get abused

## Why Not Move Outside `/public`?

You **could** serve assets outside `/public` via proxy, but:

```caddy
cuddlebuns.moe {
    root * /var/www/cuddlebuns/public

    # Proxy /assets to external directory
    handle /assets/* {
        root * /var/www/cuddlebuns/private_assets
        file_server
    }
}
```

**However, this adds:**
- Extra latency (Caddy has to proxy)
- More complex configuration
- No real security benefit (files still accessible via URL)
- Harder to add CDN later

## Best Practice for Art Galleries

Keep assets in `/public/assets/` because:

1. **Visibility is the goal** - You want people to see/share art
2. **Performance matters** - Fast loading = better UX
3. **SEO optimization** - Google can index images
4. **Easy CDN migration** - Can add Cloudflare later
5. **Simple deployment** - No complex proxy logic

### If You Need Real Protection:

For **paid/private content**, use a different approach:

```
/var/www/cuddlebuns/
├── private/                  # Outside web root
│   └── premium_art/
├── public/
│   └── gallery/
│       └── api/             # Backend to serve private files
```

Then add authentication in your app to check access before serving files.

## Summary

**For your public gallery:** ✅ Keep assets in `/public/assets/`

**Add basic protections:**
- Disable directory browsing
- Block obvious scraper bots
- Add proper cache headers

**Don't overcomplicate** - It's a public gallery, images should be accessible!

---

**Status:** Assets in `/public` is correct for your use case
**Protection level:** Basic (prevent abuse, allow legitimate viewing)

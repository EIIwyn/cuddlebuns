# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Cursor, Copilot, and others) when working with code in this repository. Claude Code reads it through the import in `CLAUDE.md`.

## What this repo is

cuddlebuns.moe: a static React/Vite site (`site/`) plus the VPS deployment pieces that serve it
(`cuddlebuns.caddy`, `vps-scripts/`). There is no package.json at the repo root; all npm work
happens in `site/`. `site/WORKFLOW.md` is the authoritative, detailed guide for NocoDB editing,
local setup, and VPS deployment. Read it before touching the sync scripts or deploy flow.

## Commands (run from `site/`)

On Windows PowerShell use `npm.cmd` if `npm.ps1` is blocked by execution policy.

```bash
npm run dev            # Vite dev server -> http://localhost:5173/gallery
npm run build          # pure Vite build to dist/ (does not touch source JSON)
npm run lint           # eslint . (flat config, react-hooks + react-refresh)
npm run preview        # serve dist/

npm run sync           # pull gallery tables from NocoDB -> public/data/cms/** + responsive images
npm run sync:check     # exit 0 = current, exit 10 = public CMS changes pending (NOT an error)
npm run sync:uma       # pull Uma Musume base -> public/data/uma/timeline.json + card thumbnails
npm run sync:uma:check # same exit-code contract as sync:check
npm run validate:cms   # check generated gallery JSON, image files, relationships, secret leakage
npm run validate:uma   # same for the Uma timeline JSON
npm run build:fresh    # sync + sync:uma + both validators + build
```

There is no test suite. Validation of generated output is done by the `validate:*` scripts.

Sync scripts need `site/.env.local` (copy from `.env.example`; the `UMA_NOCODB_*` variables are
documented in `WORKFLOW.md`, not in `.env.example`). Table IDs are explicit env vars on purpose:
the NocoDB tokens cannot list tables. Optional knobs for the gallery sync: `CMS_IMAGE_CONCURRENCY`
(1-2) and `CMS_WEBP_ONLY=1` to skip AVIF generation on slow machines.

A fresh clone has no `public/data/` or `public/generated/` at all; the dev server shows an error
screen until you run `sync` and `sync:uma` (or point at a copy of the generated output).

## Architecture: NocoDB -> static JSON -> Vite -> Caddy

The browser never talks to NocoDB. Everything public is prebuilt:

1. `scripts/sync-nocodb.mjs` fetches Collections, Characters, Versions, Commissions, Artists and
   writes `public/data/cms/site.json` (navigation + reference-sheet metadata) and one
   `public/data/cms/gallery/<character>--<version>.json` per visible Version. Images are downloaded
   once, cached under `.cache/nocodb/`, and emitted as content-hashed AVIF/WebP derivatives
   (480/960/1600px; 480/600/720px for card thumbnails) under `public/generated/nocodb/images/`.
   Invalid published records are reported and omitted rather than published half-configured.
2. `scripts/sync-uma-nocodb.mjs` does the same for a separate NocoDB base (Scenarios, PvP Events,
   Support Cards tables) into `public/data/uma/timeline.json` (`{ schemaVersion: 1, scenarios,
   pvpEvents, supportCards }`) and thumbnails under `public/generated/nocodb/uma-support/`.
3. Both sync scripts support `--check`, which compares a fingerprint of the public-facing source
   data against the cached manifest and exits 10 when a rebuild is needed. The VPS timer relies on
   this exit code.
4. `npm run build` bundles the React app; the generated JSON/images are plain `public/` assets.

All generated output (`public/data/cms/`, `public/data/uma/*.json`, `public/generated/nocodb/`,
`.cache/`) is gitignored and regenerated on the VPS.

### Frontend (`site/src/`)

- `App.jsx` owns routing. `/gallery` renders `Hub` (character index) when no `?character=` query
  param is present and `Gallery` (one character/version, commissions grid, lightbox) when it is.
  Old paths (`/characters`, `/gallery-noco`, `/uma`) are redirects; `/gallery-lab` is a retained WIP.
  `/uma/timeline` is lazy-loaded via `pages/UmaTimeline.jsx`.
- Pages fetch `/data/cms/site.json` first, then only the selected Version's gallery JSON
  (`version.galleryUrl`), so the whole gallery is never loaded at once.
- `components/ModernImage.jsx` consumes the responsive image descriptor shape emitted by the sync
  (`{ fallback: {url,width,height}, sources: { avif: [...], webp: [...] }, width, height }`) and
  also accepts a bare string path for legacy assets. Keep this shape stable across sync and UI.
- Character accent colors flow through the `--accent` CSS custom property set on page wrappers.
- `features/uma/` is self-contained. `api.js` fetches and shape-checks `timeline.json`.
  `timeline/timeline-model.js` is pure: it converts dates to percent positions along the time
  axis, generates month/quarter/year ticks, and classifies events (`typeKind` cm/loh/other,
  `courseCategory` by surface/distance with `COURSE_COLORS`). `timeline/UmaTimelinePage.jsx`
  renders scenarios and PvP events; `timeline/SupportCardLanes.jsx` renders support cards in
  rating lanes (Auto Include / Style Core / Specialized / Borrow) with usage markers tied to
  events, plus filter controls. Styling is in `timeline/timeline.css`, not `index.css`.
- `translations.js` holds UI strings plus a few helpers (for example `shuffleArray`).

### Deployment (`vps-scripts/`, `cuddlebuns.caddy`)

A systemd timer (`vps-scripts/systemd/`) runs `sync-build-deploy.sh` every five minutes on the
VPS from a full checkout at `/var/www/cuddlebuns/source`. It hashes `src/`, `scripts/`, and build
config, runs both `--check` syncs, and exits early if nothing changed. Otherwise it syncs,
validates, builds, copies `dist/` to `/var/www/cuddlebuns/releases/<timestamp>`, and atomically
repoints the `current` symlink. A failed sync or build never replaces the live release.
`auto-deploy.sh` is an alternative that also pulls `origin/main` and runs `npm ci` when the
lockfile changes. Caddy serves `current` with SPA fallback to `index.html`, immutable caching for
hashed images, and no-cache for HTML and CMS JSON.

## Conventions and constraints

- NocoDB tokens (`NOCODB_TOKEN`, `UMA_NOCODB_TOKEN`) must never be prefixed `VITE_`, committed,
  or referenced from browser code. `validate:cms` and `validate:uma` scan output for leaks.
- Public commission cards are titled `[Type] by Artist`; the NocoDB `Title` field is internal and
  must not be written to public JSON.
- If you change what the sync scripts emit, update the matching validator and any consumer in
  `src/` in the same change, and bump `MANIFEST_VERSION` in `sync-nocodb.mjs` if the cache
  manifest shape changes. For the Uma side, bump `schemaVersion` in both the sync and `api.js`
  if the timeline JSON shape changes incompatibly.
- ESLint runs with `varsIgnorePattern: '^[A-Z_]'` for unused vars. The `scripts/**/*.js` node
  globals override does not match the `.mjs` sync scripts, so they are linted with browser
  globals only. Note `npm run lint` needs the local `node_modules` (`npm ci`); a global ESLint 8
  on PATH cannot load this flat config.

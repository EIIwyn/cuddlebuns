# Gallery Workflow Guide

## Architecture

NocoDB is the editorial CMS and source of truth for the `/gallery` route:

```text
NocoDB (server-side API only)
  -> npm run sync
  -> validated static JSON + hashed responsive images
  -> npm run build
  -> complete Vite dist release
  -> Caddy serves /var/www/cuddlebuns/current
```

The browser never connects to NocoDB. `NOCODB_TOKEN` must only exist in `.env.local`
for local work or `/etc/cuddlebuns/gallery.env` on the VPS. Never prefix it with
`VITE_`, commit it, paste it into browser code, or place it in `public/`.

## One-time local setup

Copy `.env.example` to `.env.local` and fill in all values:

```dotenv
NOCODB_URL=https://noco.cuddlebuns.moe
NOCODB_TOKEN=YOUR_TOKEN_HERE
NOCODB_BASE_ID=YOUR_BASE_ID
NOCODB_ARTISTS_TABLE_ID=YOUR_ARTISTS_TABLE_ID
NOCODB_CHARACTERS_TABLE_ID=YOUR_CHARACTERS_TABLE_ID
NOCODB_COMMISSIONS_TABLE_ID=YOUR_COMMISSIONS_TABLE_ID
NOCODB_COLLECTIONS_TABLE_ID=YOUR_COLLECTIONS_TABLE_ID
NOCODB_VERSIONS_TABLE_ID=YOUR_VERSIONS_TABLE_ID
```

Explicit table IDs are intentional. Personal API tokens in this NocoDB installation do
not expose the table-list metadata permission, but they can read records from a known
table ID.

On Windows PowerShell, use `npm.cmd` if the PowerShell execution policy blocks
`npm.ps1`:

```powershell
npm.cmd install
npm.cmd run sync
npm.cmd run dev
```

Open `http://localhost:5173/gallery`.

## Editing the gallery in NocoDB

Relationships are:

```text
Collections -> Characters -> Versions <-> Commissions -> Artists
```

- Collections, Characters, and Versions must have `Visible` enabled to appear.
- A Character belongs to a Collection through `Project`.
- A Character's optional `Accent Color` is a CSS hex color such as `#7be3f2`.
- A Version belongs to a Character.
- A Commission may link to multiple Versions.
- A Commission may link to one or more Artists.
- Set `Published` only after the record is ready for the public site.

A published Commission requires:

- `Type`
- `Image` with at least one attachment
- `Source URL`
- at least one linked visible Version
- at least one linked Artist with an `Artist Name`

The NocoDB `Title` field remains an internal identifier. Public cards are always shown
as `[Type] by Artist`; the internal title is never written to public JSON.

`Accent Color` accepts three- or six-digit hex values. The sync normalizes valid values
and uses a deterministic fallback palette if the field is blank or invalid.

The sync reports invalid published records and omits them. This prevents partially
configured records from leaking into the live gallery. At the first migration sync,
Commission records 21 and 60 were omitted because they did not have a Source URL.

## Local commands

```powershell
# Fetch and validate all five tables, then generate changed files/images
npm.cmd run sync

# Exit 0 when current; exit 10 when a public CMS change needs syncing
npm.cmd run sync:check

# Pure Vite build; it does not edit source JSON
npm.cmd run build

# Validate JSON relationships, required public fields, responsive files, and secrets
npm.cmd run validate:cms

# Sync first, then build
npm.cmd run build:fresh

# Quality checks
npm.cmd run lint
```

The first sync downloads every attachment and creates 480px, 960px, and 1600px AVIF
and WebP derivatives. Later runs use `.cache/nocodb/manifest.json` and content hashes,
so unchanged images are reused.

Reference-sheet originals are also preserved in the generated image directory. The
page uses responsive derivatives for the embedded preview, then loads the original
file in a viewport-fitted lightbox when the preview is clicked. This preserves full
source quality while allowing the browser to scale the display to the available space.

Generated and cached files are intentionally ignored by Git:

```text
site/.cache/nocodb/
site/public/data/cms/site.json
site/public/data/cms/gallery/<character>--<version>.json
site/public/generated/nocodb/images/<stable-name>-<hash>-<width>.<format>
```

`site.json` contains navigation and reference-sheet metadata. The browser fetches only
the selected Version's gallery JSON, rather than loading the entire gallery at once.

## VPS automatic deployment

The new automation expects a complete source checkout at
`/var/www/cuddlebuns/source`. This is separate from the old sparse production checkout.
Run the following once on the VPS, adapting the clone URL if necessary:

```bash
sudo mkdir -p /var/www/cuddlebuns/source /var/www/cuddlebuns/releases /etc/cuddlebuns
sudo chown -R masterpyon:www-cuddlebuns /var/www/cuddlebuns/source /var/www/cuddlebuns/releases

# Clone or check out the complete repository into /var/www/cuddlebuns/source.
cd /var/www/cuddlebuns/source/site
npm ci
chmod +x ../vps-scripts/sync-build-deploy.sh
```

Create `/etc/cuddlebuns/gallery.env` with the same eight NocoDB values used locally,
then protect it:

```bash
sudo chown root:root /etc/cuddlebuns/gallery.env
sudo chmod 600 /etc/cuddlebuns/gallery.env
```

Install and start the timer:

```bash
sudo cp /var/www/cuddlebuns/source/vps-scripts/systemd/cuddlebuns-gallery-sync.service /etc/systemd/system/
sudo cp /var/www/cuddlebuns/source/vps-scripts/systemd/cuddlebuns-gallery-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start cuddlebuns-gallery-sync.service
sudo systemctl enable --now cuddlebuns-gallery-sync.timer
```

Check it with:

```bash
systemctl status cuddlebuns-gallery-sync.timer
journalctl -u cuddlebuns-gallery-sync.service -n 100 --no-pager
```

The timer checks every five minutes. If both NocoDB and the checked-out Git commit are
unchanged, it exits without building. A changed run validates the output, copies the
complete `dist/` into `/var/www/cuddlebuns/releases/<timestamp>`, and atomically changes
the `/var/www/cuddlebuns/current` symlink. Failed syncs or builds never replace the
active release.

Older releases are retained for rollback. To roll back, point a temporary symlink at a
known release and atomically rename it to `current`.

After the first successful release creates `current`, install the repository's
`cuddlebuns.caddy` configuration and reload Caddy. It serves hashed images with immutable
caching and revalidates `/data/cms/*.json`.

## Troubleshooting

- `npm.ps1 cannot be loaded`: use `npm.cmd` in PowerShell.
- `sync:check` exits 10: this means changes exist; it is not an error.
- A published record is skipped: read the validation message and fill its missing field.
- Images do not update: confirm the attachment itself changed, run `npm.cmd run sync`,
  and verify that a new content hash appears in the generated filename.
- Timer fails before building: verify `/etc/cuddlebuns/gallery.env`, NocoDB access, and
  that `npm ci` was run in the VPS source checkout.
- Site still shows an older release: inspect `readlink -f /var/www/cuddlebuns/current`
  and the service journal.

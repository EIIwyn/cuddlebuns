# Gallery Workflow Guide

## Architecture

NocoDB is the editorial CMS and source of truth for the `/gallery` route and the separate `/uma/timeline` data set:

```text
NocoDB (server-side API only)
  -> npm run sync
  -> validated static JSON + hashed responsive images
  -> npm run build
  -> complete Vite dist release
  -> Caddy serves /var/www/cuddlebuns/current
```

The browser never connects to NocoDB. `NOCODB_TOKEN` and `UMA_NOCODB_TOKEN` must only exist in `.env.local`
for local work or `/etc/cuddlebuns/gallery.env` on the VPS. Never prefix it with
`VITE_`, commit it, paste it into browser code, or place it in `public/`.

## One-time local setup

Copy `.env.example` to `.env.local` and fill in all values:

```dotenv
CMS_SOURCE=nocodb
NOCODB_URL=https://noco.cuddlebuns.moe
NOCODB_TOKEN=YOUR_TOKEN_HERE
NOCODB_BASE_ID=YOUR_BASE_ID
NOCODB_ARTISTS_TABLE_ID=YOUR_ARTISTS_TABLE_ID
NOCODB_CHARACTERS_TABLE_ID=YOUR_CHARACTERS_TABLE_ID
NOCODB_COMMISSIONS_TABLE_ID=YOUR_COMMISSIONS_TABLE_ID
NOCODB_COLLECTIONS_TABLE_ID=YOUR_COLLECTIONS_TABLE_ID
NOCODB_VERSIONS_TABLE_ID=YOUR_VERSIONS_TABLE_ID

# Separate Uma Musume Global base
UMA_NOCODB_URL=https://noco.cuddlebuns.moe
UMA_NOCODB_TOKEN=YOUR_UMA_TOKEN_HERE
UMA_NOCODB_BASE_ID=YOUR_UMA_BASE_ID
UMA_NOCODB_SCENARIOS_TABLE_ID=YOUR_SCENARIOS_TABLE_ID
UMA_NOCODB_PVP_EVENTS_TABLE_ID=YOUR_PVP_EVENTS_TABLE_ID
UMA_NOCODB_SUPPORT_CARDS_TABLE_ID=YOUR_SUPPORT_CARDS_TABLE_ID
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
- A Character's optional `Card Thumbnail` is the curated 5:7 portrait used by the gallery index.
  Upload at least 720×1008px to generate the 480px, 600px, and 720px responsive variants.
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

## Editing the Uma timeline in NocoDB

The Uma tables live in a separate base. The public timeline requires `scenarios` with
`name`, `slug`, `era_start`, and `era_end`, plus `pvp_events` with `name`, `slug`,
`start_date`, `end_date`, and an optional relation to a scenario. Race metadata is
optional and is shown only when supplied.

The pipeline outputs a neutral `unspecified` status until an explicit `status` (or
`confirmed_projected_status`) field is added. When present, only `confirmed` and
`projected` are accepted. Projected events use distinct dashed styling in the UI.

`support_cards` are normalized with stable linked PvP record IDs, general card-level
running styles, release dates, and cached 240px AVIF/WebP thumbnails. `npm run sync:uma`
writes `public/data/uma/timeline.json`; `npm run validate:uma`
checks public data shape, relationships, dates, and secret leakage. Like gallery
output, these generated files are ignored by Git and rebuilt on the VPS.

## Seeding the Uma tables from GameTora

`npm run import:uma` pulls scenarios, Champions Meetings, and support cards from GameTora's
public JSON and prints an upsert plan for the three Uma tables. `npm run import:uma:apply`
performs the writes. The design, field ownership rules, and verified mappings are in
`../docs/2026-09-07-uma-gametora-import-design.md`.

### What the importer owns

- Fact columns are rewritten on every run: scenario slug, era dates, colour; event number,
  type, dates, all race conditions, status, and the scenario link; card character, type,
  rarity, title, release date. Tick `lock_facts` on a row to freeze it.
- `name`, `slug`, and `short_name` are seeded once, then yours. A scenario name that still
  equals GameTora's provisional name is upgraded when the official English name appears.
- `rating`, `styles`, `breakpoints`, card-to-event links, and images are never touched.
- Rows without a `gametora_id` are never touched. League of Heroes rows stay manual.

### Admin checklist before the first run

Add these to the target tables (staging copies first):

| Table | Add |
| --- | --- |
| all three | `gametora_id` (Number), `lock_facts` (Checkbox) |
| `pvp_events` | `status` (SingleSelect: `confirmed`, `projected`); racecourse options Hakodate, Fukushima, Kokura, Santa Anita |
| `support_cards` | `rarity` (SingleSelect: `R`, `SR`, `SSR`), `title` (SingleLineText); card_type options `Friend`, `Group` |

Then put the target table ids in `.env.local` as `UMA_IMPORT_NOCODB_*_TABLE_ID`. The importer
checks every column and select option on startup and refuses to write if any is missing.

### Staging walkthrough

1. Duplicate the three tables with data inside the Uma base, apply the checklist to the copies.
   Then untangle the links: NocoDB's duplicate keeps each copy's link columns pointing at the
   ORIGINAL tables and adds `... copy` columns for the duplicates, on both sides. On the events
   copy delete `scenario` and `support_cards` and rename `scenario copy_1` to `scenario` and
   `support_cards copy` to `support_cards`; on the scenarios copy and the cards copy delete
   `pvp_events` and rename `pvp_events copy` to `pvp_events`. Deleting a link column removes
   its inverse, so this also removes the `... copy` columns the duplication added to the live
   tables. The importer resolves the scenario link by the table it points at and refuses to
   start if the events copy has no link to the staging scenarios copy, so a skipped untangle
   shows up as a clear error rather than a write to the wrong table.
2. `npm run import:uma`. Expect Champions Meetings to show as `link`, most cards as `link`
   (matched by the number at the start of the attachment filename), scenarios and League of
   Heroes rows as `unmatched`. Set `gametora_id` on the scenario rows by hand using the printed
   suggestions. Read the `update` lines: dates and names that differ from GameTora will change.
3. `npm run import:uma:apply`, then `npm run import:uma` again. The second run must be all skip.
4. Point `UMA_NOCODB_*_TABLE_ID` at the staging ids, run `npm run sync:uma` and
   `npm run validate:uma`, open `/uma/timeline` with `npm run dev`. Only rated cards appear.
5. Repoint `UMA_NOCODB_*_TABLE_ID` back at live.

### Cutover

Apply the checklist to the live tables, set `UMA_IMPORT_NOCODB_*` to the live ids in
`/etc/cuddlebuns/gallery.env`, run one manual `npm run import:uma:apply` on the VPS, then
enable `cuddlebuns-uma-import.timer` (nightly at 23:30 UTC). The five-minute sync timer
publishes the changes on its next tick.

## Local commands

```powershell
# Fetch and validate all five tables, then generate changed files/images
npm.cmd run sync

# Exit 0 when current; exit 10 when a public CMS change needs syncing
npm.cmd run sync:check

# Fetch Uma scenarios and PvP events into public timeline JSON
npm.cmd run sync:uma

# Exit 0 when current; exit 10 when public Uma data changed
npm.cmd run sync:uma:check

# Override CMS_SOURCE for an explicit backend check (PocketBase is added later)
npm.cmd run sync:check -- --source=nocodb

# Pure Vite build; it does not edit source JSON
npm.cmd run build

# Validate JSON relationships, required public fields, responsive files, and secrets
npm.cmd run validate:cms

# Validate the public Uma timeline JSON
npm.cmd run validate:uma

# Sync first, then build
npm.cmd run build:fresh

# Quality checks
npm.cmd run lint
```

Source selection follows `--source > CMS_SOURCE > nocodb`. Invalid or unavailable sources fail;
the commands never fall back silently. Backend manifests are isolated under
`.cache/{gallery,uma}/<source>/manifest.json` while original bytes are shared.

The first sync downloads every attachment and creates 480px, 960px, and 1600px AVIF
and WebP derivatives. Later runs use `.cache/gallery/nocodb/manifest.json` and content hashes,
so unchanged images are reused.

Reference-sheet originals are also preserved in the generated image directory. The
page uses responsive derivatives for the embedded preview, then loads the original
file in a viewport-fitted lightbox when the preview is clicked. This preserves full
source quality while allowing the browser to scale the display to the available space.

Generated and cached files are intentionally ignored by Git:

```text
site/.cache/gallery/nocodb/
site/.cache/originals/
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

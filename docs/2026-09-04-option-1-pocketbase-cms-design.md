# Option 1: Replace NocoDB with PocketBase

Date: 2026-09-04
Status: proposal, not yet approved

## In one paragraph

Keep everything about how the site is built and served today. Swap only the place where
content is edited and stored. NocoDB (a heavy app with its own database) is replaced by
PocketBase (one small program with a built-in database, admin screen, and file uploads).
The two sync scripts change how they fetch data, and nothing else in the project changes.
Onboarding drops from fourteen environment variables to three.

## Why change

Today the editing tool is NocoDB, hosted at `noco.cuddlebuns.moe`. It works, but:

- It is a large application to run on a small server.
- Its access tokens cannot list tables, so every table ID has to be copied by hand into
  each developer's `.env.local`. Two separate NocoDB bases mean two sets of everything.
- Nobody outside the sync scripts needs the NocoDB features we pay for in resources.

The parts of the current setup that work well and are kept as they are:

- The website is a static site: plain files that Caddy serves. Visitors never hit a
  database. A broken editing tool cannot break the live site.
- Images are processed once at build time into small AVIF and WebP files.
- Validation scripts refuse to publish half-configured records.
- The server builds a new release and swaps it in atomically, so a failed build never
  replaces a working site.

## What PocketBase is

PocketBase is a single executable file. Inside it are:

- a database (SQLite, stored as a file on disk),
- an admin website where you create tables ("collections" in PocketBase terms), add
  records, and upload files,
- a web API the sync scripts use to read those records,
- optional JavaScript hooks that run when records change.

There is nothing to install besides the one file. All its data lives in one folder called
`pb_data`, which makes backups a copy of that folder.

Facts checked against the PocketBase documentation on 2026-09-04 (pocketbase.io and the
context7 documentation index, current release line v0.35):

- Files are stored on local disk under `pb_data/storage` by default. S3 is optional.
- The default per-file size limit is about 5 MB and can be raised per field in the admin
  screen. Our commission originals will need that raised.
- Records are listed through `GET /api/collections/<name>/records` with paging, filtering,
  sorting, and `expand` to pull in related records.
- A script logs in as an admin with `POST /api/collections/_superusers/auth-with-password`
  using an email and password. That is what the sync will do.
- Files are public by URL unless the field is marked "protected". Protected files need a
  short-lived token from `POST /api/files/token` (valid for about two minutes) and the
  request must pass the collection's view rule.
- The whole collections schema can be exported and imported as JSON through
  `PUT /api/collections/import` or the admin screen, so the schema can be kept in git.
- There is no official Docker image, but the docs recommend a small Alpine-based container
  with a volume at `/pb/pb_data`.
- Backups can be scheduled with a cron expression in the settings, with a retention count
  and optional S3 target, or taken by copying `pb_data`.
- No stated minimum hardware. The docs suggest setting `GOMEMLIMIT` on small servers.

## The design

### Pieces

```text
Editors --browser--> PocketBase admin (cms.cuddlebuns.moe)
                            |
                            | REST API, read-only service login
                            v
                 sync scripts on the VPS (every 5 min)
                            |
                            v
             public/data/**.json + public/generated/** images
                            |
                            v
                     vite build --> releases/<timestamp> --> Caddy serves "current"
```

Only the top two boxes are new. Everything from "sync scripts" down already exists.

### Collections in PocketBase

One PocketBase instance holds all eight collections. There is no longer a separate
"Uma base"; the Uma collections are simply prefixed.

| Collection          | Fields (type)                                                                                                         |
|---------------------|-----------------------------------------------------------------------------------------------------------------------|
| `artists`           | name (text, required), url (url)                                                                                      |
| `collections`       | name (text, required), slug (text), display_order (number), visible (bool), collapsible (bool)                       |
| `characters`        | name, slug, subtitle, accent_color (text), card_thumbnail (file, 1), display_order, visible, collection (relation, 1), social_label, social_url |
| `versions`          | name, slug, reference_sheet (file, many), display_order, visible, character (relation, 1)                             |
| `commissions`       | internal_title (text), type (text, required), image (file, many, required), source_url (url, required), date (date), published (bool), display_order, versions (relation, many), artists (relation, many) |
| `uma_scenarios`     | name, short_name, slug, era_start (date), era_end (date), display_color                                               |
| `uma_pvp_events`    | name, event_number, slug, event_type, start_date, end_date, scenario (relation, 1), distance_class, distance_m, racecourse, direction, track_condition, season, weather, surface, status |
| `uma_support_cards` | name, character_name, slug, image (file, 1), card_type, rating, release_date, styles (select, many), pvp_events (relation, many) |

These mirror the NocoDB tables field for field, so the mapping code in the sync scripts is
a rename exercise rather than a redesign. Field names use snake_case because that is
PocketBase's convention and it avoids quoting names with spaces.

Access rules: every collection stays private (the default). Only a logged-in superuser
can read or write. Files attached to records are readable by URL without login, which is
fine for published art but means an unpublished commission's image is reachable by anyone
who knows its exact URL. If that matters, mark the `image` fields as "protected" in
PocketBase and have the sync request a short-lived file token. This is a small change
and can be decided during implementation.

### Sync scripts

`scripts/sync-nocodb.mjs` and `scripts/sync-uma-nocodb.mjs` each have three layers:

1. fetch records from an API,
2. map raw records into a clean model and report invalid ones,
3. download images, generate derivatives, write JSON, keep a cache manifest.

Only layer 1 and the field names in layer 2 change. Concretely:

- Replace the NocoDB pager with a PocketBase pager: log in once with the service
  account, then page through `/api/collections/<name>/records?perPage=200&page=N`.
- Read fields by their snake_case names instead of "Display Order" style names.
- Relations arrive as arrays of record IDs, which is what the existing `relationIds`
  helper already expects.
- Image download URLs become `/api/files/<collection>/<recordId>/<filename>`.
- The change detection (`--check`, exit code 10) keeps working unchanged because it hashes
  the fetched public data, not anything NocoDB-specific.

Optionally the two scripts could be merged into one because they now talk to one server.
That is a cleanup for later, not part of this change.

Environment variables shrink from fourteen to three:

```dotenv
CMS_URL=https://cms.cuddlebuns.moe
CMS_EMAIL=sync@cuddlebuns.moe
CMS_PASSWORD=...
```

The `NOCODB_*` and `UMA_NOCODB_*` variables are deleted along with their documentation.

### Running PocketBase on the VPS

A `docker-compose.yml` in `vps-scripts/` with one service:

```yaml
services:
  pocketbase:
    build: ./pocketbase          # tiny Alpine image that downloads the pinned binary
    restart: unless-stopped
    ports: ["127.0.0.1:8090:8090"]
    volumes:
      - /var/lib/cuddlebuns/pb_data:/pb/pb_data
      - /var/lib/cuddlebuns/pb_hooks:/pb/pb_hooks
    environment:
      GOMEMLIMIT: 256MiB
```

Caddy gets one more site block that proxies `cms.cuddlebuns.moe` to `127.0.0.1:8090`
and forwards the real client IP headers. The existing systemd timer, deploy script, and
release layout are untouched; the deploy script just reads the new three variables.

Backups: enable PocketBase's built-in daily backup in the admin screen, writing into
`pb_data/backups`. A cron job copies that folder off the server. Restoring is "put the
folder back".

### Optional later step: build on save instead of on a timer

PocketBase can run a small JavaScript hook (a file in `pb_hooks/`) whenever a record is
saved. That hook could touch a flag file that the deploy script checks, replacing the
five-minute poll with an immediate build. This is not part of the first version. The
timer already works and the poll is cheap.

## Day-to-day editing

1. Open `cms.cuddlebuns.moe`, log in.
2. Add or edit records in the admin screen. Upload images on the record itself.
3. Tick `published` (commissions) or `visible` (everything else) when ready.
4. Within five minutes the site rebuilds. If a record is missing something required, the
   sync log on the server lists it and the record is skipped, exactly as today.

## Onboarding a new team member

1. Get a PocketBase login from whoever administers it. That is the only credential.
2. Clone the repo, `cd site`, `npm ci`.
3. Copy `.env.example` to `.env.local` and fill in the three values.
4. `npm run sync && npm run sync:uma`, then `npm run dev`.

Compare with today, where step 3 involves finding eight table IDs across two bases.

## Migration from NocoDB

1. Stand up PocketBase on the VPS alongside NocoDB. Create the eight collections by hand
   in the admin screen (about thirty minutes) or import a collections JSON that we commit
   to the repo so the schema is reproducible.
2. Write a one-time script `scripts/migrate-nocodb-to-pocketbase.mjs`. It reuses the
   existing NocoDB fetch code, creates records in PocketBase in dependency order
   (artists, collections, characters, versions, commissions; then Uma), and uploads each
   image from the existing `.cache/nocodb/originals` folder so nothing is re-downloaded.
   It keeps a map from NocoDB ID to PocketBase ID so relations are rewired correctly.
3. Run the new sync against PocketBase locally, run both validators, and diff the
   generated JSON against the NocoDB-based output. Slugs and public fields should match
   exactly; only `id` values differ.
4. Switch the VPS environment file to the new variables. Watch one deploy succeed.
5. Leave NocoDB running read-only for two weeks as a fallback, then turn it off.

The migration script is thrown away afterwards.

## What changes in the repository

| Area                                     | Change                                                     |
|------------------------------------------|------------------------------------------------------------|
| `site/scripts/sync-nocodb.mjs`           | fetch layer and field names                                |
| `site/scripts/sync-uma-nocodb.mjs`       | fetch layer and field names                                |
| `site/scripts/validate-*.mjs`            | none expected; output shape is unchanged                   |
| `site/src/**`                            | none                                                       |
| `site/.env.example`, `site/WORKFLOW.md`  | new variables, new editing instructions                    |
| `vps-scripts/docker-compose.yml`, `vps-scripts/pocketbase/Dockerfile` | new                            |
| `cuddlebuns.caddy`                       | one new site block                                         |
| `AGENTS.md`                              | update the architecture section                            |

## Risks and trade-offs

- **Still a hosted tool.** Someone has to keep PocketBase updated and backed up. It is much
  less work than NocoDB, but it is not zero.
- **Schema lives outside git.** Field definitions are in PocketBase, not in the repo.
  Mitigation: export the collections JSON from the admin screen and commit it whenever the
  schema changes.
- **Single-writer database.** SQLite is fine for a handful of editors. It would not suit
  hundreds of concurrent writers, which we do not have.
- **PocketBase is pre-1.0.** Upgrades occasionally change APIs. Pin the version in the
  Dockerfile and upgrade deliberately.
- **Image originals in one folder on one disk.** Same as today with NocoDB. Backups cover it.

## Out of scope

- Merging the two sync scripts.
- Build-on-save hooks.
- Any change to the React frontend, validators, Caddy caching rules, or release layout.

## Glossary

- **Static site**: a website made of ready-made files. No code runs on the server per visitor.
- **Sync**: our script that reads the CMS and writes those ready-made files.
- **Release**: one complete built copy of the site in a timestamped folder. Caddy always
  points at the newest good one.
- **Collection**: PocketBase's word for a table.
- **Superuser**: a PocketBase admin account. The sync uses one that only reads.
- **Reverse proxy**: Caddy forwarding `cms.cuddlebuns.moe` to the PocketBase process.

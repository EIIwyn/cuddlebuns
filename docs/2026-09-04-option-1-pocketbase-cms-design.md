# Option 1: Migrate from NocoDB to PocketBase side by side

Date: 2026-09-04
Revised: 2026-09-07
Status: implementation design; production cutover still requires an explicit operations window

## Decision

Run PocketBase beside NocoDB, retain both source adapters until PocketBase has passed local and
VPS rehearsals, and switch the static build pipeline only after semantic and source-image
equivalence is proven. NocoDB remains the production default before cutover. During the initial
post-cutover observation freeze it remains a current rollback source; after editors start making
PocketBase-only changes it becomes an archive, not an automatically current fallback.

Visitors continue to receive static releases from Caddy throughout. A CMS, migration, validation,
or build failure leaves the last successful release active.

## Goals and non-goals

The migration must:

- preserve the browser routes, behavior, and public JSON shapes;
- preserve the `ModernImage` descriptor and `[Type] by Artist` commission presentation;
- keep `--check` exit statuses `0` (current), `10` (changes), and `1` (error);
- preserve attachment order, relationships, publication filtering, and original GIF bytes;
- make schema creation, data migration, cutover, rollback, backup, and restore reproducible;
- avoid using PocketBase record IDs for ordering; and
- leave NocoDB usable until the observation gate has passed.

This design does not merge the gallery and Uma commands, change the React frontend, add
build-on-save hooks, or expose PocketBase directly to site visitors.

## Architecture

```text
                         development and rehearsal
               +----------------+   +------------------+
Editors ------>| NocoDB        |   | PocketBase       |<------ Editors after cutover
               +-------+--------+   +---------+--------+
                       |                      |
                  NocoDB adapter       PocketBase adapter
                       +----------+-----------+
                                  |
                    source-neutral records and attachments
                                  |
                  model -> image pipeline -> output writers
                                  |
              public/data/** + public/generated/** + validators
                                  |
                   Vite dist -> atomic release -> Caddy
```

The browser never talks to either CMS. The existing static release mechanism remains the outage
boundary.

## Public contract and identity

The following remain schema-compatible and behavior-compatible:

- `public/data/cms/site.json`;
- every `public/data/cms/gallery/<character>--<version>.json` file;
- `public/data/uma/timeline.json` with `schemaVersion: 1`;
- responsive descriptors shaped as
  `{ width, height, aspectRatio?, fallback, sources: { avif, webp }, originalUrl? }`;
- gallery routes, selection behavior, and Uma relationship behavior; and
- commission titles derived from public `type` and artist data. An internal commission name is
  never emitted.

Public `id`, `recordId`, and relation-ID values are implementation identifiers used to join one
generated data set. They are not durable external URLs. A semantic comparison may re-key them by
collection and positive `legacy_id`, but it must then compare every relationship target. It may
also normalize `generatedAt` and content-hashed image URLs, provided image URLs are compared by
source SHA-256, descriptor dimensions, derivative dimensions, and original availability. No other
difference is accepted without a documented contract change.

Every content record has a required positive numeric `legacy_id`. Migrated records retain their
NocoDB record number. After cutover, an editor assigns the next unused positive value in that
collection when creating a draft; the unique database index rejects a race or duplicate. The
editing guide must document this intentionally simple allocation rule. `legacy_id` is immutable
after creation. A future server-side allocator may replace the manual rule, but PocketBase's random
record ID must never become a sort key.

Deterministic ordering is defined by the shared model:

- collections, characters, and versions: positive display order, name, then `legacy_id`;
- gallery items: positive display order, date descending, record `legacy_id`, then attachment
  ordinal;
- scenarios: era start, name, then `legacy_id`;
- PvP events: start date, event number, name, then `legacy_id`;
- support cards: release date, name/character name, then `legacy_id`; and
- multi-file and multi-relation values retain source order unless a public field explicitly has
  set semantics.

Duplicate published slugs, missing/zero `legacy_id`, and duplicate `legacy_id` values are hard
errors. Draft completeness remains permissive except that stable identity is required. The shared
model and validators enforce publish-time completeness.

## Source-neutral pipeline

The scripts are renamed before production cutover:

```text
scripts/sync-gallery.mjs
scripts/sync-uma.mjs
scripts/adapters/nocodb-*.mjs
scripts/adapters/pocketbase-*.mjs
scripts/lib/model-*.mjs
scripts/lib/images.mjs
scripts/lib/output-*.mjs
```

Both commands accept `--source=nocodb` and `--source=pocketbase`. Selection precedence is:

```text
explicit --source argument > CMS_SOURCE > nocodb
```

An unknown value, duplicate conflicting arguments, or missing configuration for the selected
source exits `1`; there is no automatic backend fallback. The deployment scripts invoke the normal
npm commands and inherit `CMS_SOURCE` from `/etc/cuddlebuns/gallery.env`.

Backend manifests remain separate because API snapshots and file metadata differ:

```text
.cache/gallery/nocodb/manifest.json
.cache/gallery/pocketbase/manifest.json
.cache/uma/nocodb/manifest.json
.cache/uma/pocketbase/manifest.json
```

Original bytes are shared by SHA-256 under `.cache/originals/<sha256>.<detected-extension>`.
Generated public paths may retain `/generated/nocodb/` during the migration to avoid an unrelated
URL and Caddy cache transition. Manifest versions are bumped whenever their shape changes.

## PocketBase schema

Committed JavaScript migrations under `vps-scripts/pocketbase/pb_migrations/` are the sole schema
source of truth. There is no custom schema-creation CLI and no authoritative exported schema JSON.
Production starts PocketBase with automigration disabled. Schema edits are not made in the
production dashboard; a developer creates or edits a migration, proves it on a disposable fresh
instance and a restarted initialized instance, then deploys it.

System fields such as `id`, `created`, and `updated` are left to PocketBase.

| Collection | Fields |
|---|---|
| `artists` | `legacy_id` number required/unique/positive; `name` text; `url` URL |
| `collections` | `legacy_id`; `name`; `slug`; `display_order` number; `visible` bool; `collapsible` bool |
| `characters` | `legacy_id`; `name`; `slug`; `subtitle`; `accent_color`; `card_thumbnail` file max 1; `display_order`; `visible`; `collection` relation max 1; `social_label`; `social_url` |
| `versions` | `legacy_id`; `name`; `slug`; `reference_sheet` file many; `display_order`; `visible`; `character` relation max 1 |
| `commissions` | `legacy_id`; `name` internal text; `type`; `image` file many; `source_url`; `date`; `published`; `display_order`; `versions` relation many; `artists` relation many |
| `uma_scenarios` | `legacy_id`; `name`; `short_name`; `slug`; `era_start`; `era_end`; `display_color` |
| `uma_pvp_events` | `legacy_id`; `name`; `event_number`; `slug`; `event_type`; `start_date`; `end_date`; `scenario` relation max 1; `distance_class`; `distance_m`; `racecourse`; `direction`; `track_condition`; `season`; `weather`; `surface`; `status` |
| `uma_support_cards` | `legacy_id`; `name`; `character_name`; `slug`; `image` file max 1; `card_type`; `rating`; `release_date`; `styles` JSON array; `breakpoints` JSON array; `pvp_events` relation many |

All eight collections have unique indexes on `legacy_id`; migration and contract tests assert the
indexes. File fields have explicit maximum counts, allowed image MIME types, and byte limits chosen
from the fresh source inventory plus an agreed margin. Implementation stops rather than silently
omitting an oversized file. Source file fields are protected so draft originals are not public.

Only `legacy_id` is schema-required for a content draft. Visibility/publication and the shared
validators decide whether a record is complete enough to publish.

## Authentication and authorization

Human dashboard users have separate `_superusers` accounts. Dashboard access is privileged
administration: these accounts bypass collection API rules and can change records, users, settings,
and schema. Human superusers use MFA and, where operationally practical, the PocketBase
superuser-IP/subnet whitelist. SMTP/OTP delivery and trusted proxy headers must be verified before
enforcing MFA or a whitelist.

A dedicated auth collection, `cms_sync`, contains only the automated sync identity. Password
authentication is enabled; public registration, OAuth, OTP, list, create, update, delete, and manage
access are locked. Each content collection grants list/view and protected-file access only when
the request is authenticated from `cms_sync`; create/update/delete remain locked. Integration tests
prove permitted reads and denied writes.

The client configuration is explicit:

```dotenv
CMS_SOURCE=nocodb
POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_AUTH_COLLECTION=cms_sync
POCKETBASE_SYNC_EMAIL=sync@cuddlebuns.moe
POCKETBASE_SYNC_PASSWORD=...
```

The normal five-minute job never retains a superuser credential. A temporary PocketBase
superuser is created only for schema/bootstrap administration, provisioning the sync identity, and
data migration. Its password is supplied outside git and removed or rotated immediately after the
successful final migration and cutover.

## Container and proxy

PocketBase is pinned to `0.40.3`, subject to a final check against the official release immediately
before implementation. The implementation retrieves the official `checksums.txt`, verifies the
selected archive with SHA-256, and records the exact value; this document does not invent it.

The Dockerfile pins a supported Alpine patch release (and preferably its image digest), installs
only required runtime/build tools, creates a fixed non-root UID/GID, copies `pb_migrations`, and
runs PocketBase from `/pb`. PocketBase listens on `0.0.0.0:8090` inside the container. Compose
publishes `127.0.0.1:8090:8090` on the host, persists `/pb/pb_data`, sets an evidence-based
`GOMEMLIMIT`, defines `/api/health` health checking, and uses `restart: unless-stopped`.

Caddy proxies `cms.cuddlebuns.moe` to host `127.0.0.1:8090`. Its request-body maximum exceeds the
largest allowed PocketBase upload plus multipart overhead, and its read timeout accommodates that
upload. PocketBase trusts only the proxy headers supplied by local Caddy. Rate limiting, logs,
disk use, container health, backup age, and backup-copy failures are monitored.

## Idempotent data migration

The migration is a retained, tested operational tool until decommissioning is complete. It:

1. inventories source counts, duplicate slugs/IDs, relations, attachment order, byte size, detected
   format, and SHA-256;
2. supports `--dry-run` without PocketBase writes;
3. processes collections in dependency order;
4. finds each destination record by unique `legacy_id` and creates or updates it;
5. sends non-file fields and complete relation arrays as an unambiguous JSON object and attaches
   files separately in multipart requests;
6. replaces a destination file only when ordered source SHA-256 values differ;
7. runs a second pass that reconciles every relation after all destination IDs exist;
8. verifies stored downloads by SHA-256, detected format, count, and order;
9. preserves GIF originals according to filename and detected bytes, not MIME metadata alone; and
10. writes a resumable, gitignored, secret-free manifest with source, created, updated, unchanged,
    and failed counts.

The manifest is an optimization, not authority: every rerun checks PocketBase state by
`legacy_id`. Any duplicate, dangling/unmapped relation, oversize file, hash mismatch, missing
record, or unexplained count mismatch produces a nonzero exit.

## Equivalence gate

The test harness uses Node 22+ and built-in `node:test`. A disposable-container suite covers fresh
schema migration, restart with already-applied migrations, read-only authentication, denied writes,
pagination, JSON arrays, single/multiple relations, single/multiple uploads, file limits, protected
downloads, migration reruns, and service restart.

The semantic comparison checks:

- public JSON shape and all public values after the narrow normalization described above;
- record and relationship counts and relationship targets;
- stable ordering and attachment order;
- original source SHA-256 hashes and GIF-original availability;
- responsive descriptor structure and generated dimensions;
- draft/publication filtering and secret leakage;
- both validators; and
- the production Vite build.

No unexplained difference reaches cutover.

## Cutover, rollback, and recovery

Before cutover, operations stop the timer and begin a short editorial freeze. They take a fresh
verified NocoDB database/attachment/configuration backup, copy it off-server, capture a new
NocoDB baseline, run the final migration upsert, prove equivalence, then set
`CMS_SOURCE=pocketbase` and manually run one locked atomic deploy. Browser smoke tests pass before
the timer is re-enabled.

During the initial observation freeze, rollback means restoring the compatible NocoDB environment
file, selecting `CMS_SOURCE=nocodb`, restoring compatible code if required, running both syncs and
validators, building, and atomically deploying. PocketBase editing remains disabled while the
failure is investigated.

After the observation gate, editors are explicitly moved to PocketBase and the freeze ends. From
that moment NocoDB is an archive. Recovery uses a known PocketBase backup or reconciles
PocketBase-only edits back into NocoDB before selecting the NocoDB adapter. Merely restoring an old
environment file is not a complete or current rollback.

PocketBase remains beside NocoDB for a two-week soak. A backup is restored into a disposable
instance before cutover and again after the soak. NocoDB service, credentials, adapter, migration
tooling, proxy/DNS, and backup retention are removed only after the soak and final restore drill
pass.

## Backups and operations

PocketBase built-in backups are stored locally and copied to a separate failure domain. Monitoring
alerts on stale/missing backups, failed off-server copy, low disk space, unhealthy container, and
repeated sync failures. A restore runbook records the PocketBase version, migration revision,
backup timestamp, checksums, disposable destination, and validation results.

Both deployment paths are kept supported during migration:

- `vps-scripts/sync-build-deploy.sh` remains the timer path; and
- `vps-scripts/auto-deploy.sh` remains the Git-pulling alternative unless the owner explicitly
  retires it.

Both honor `CMS_SOURCE`, validate exit `10` as “changes,” run both validators, build a complete
release, and atomically switch `current`. `site/WORKFLOW.md`, `AGENTS.md`, systemd descriptions,
environment examples, Caddy, logs, backup monitoring, and source-specific cache documentation are
updated together before cutover.

## Remaining operational choices

Implementation must measure the fresh source inventory before committing file-size limits and
`GOMEMLIMIT`. Operations must also confirm the VPS CPU architecture, the supported pinned Alpine
tag/digest, backup destination and retention, alert delivery mechanism, static administrative IPs
for the whitelist, and whether `auto-deploy.sh` is actually used. These choices do not alter the
side-by-side architecture or public contract.

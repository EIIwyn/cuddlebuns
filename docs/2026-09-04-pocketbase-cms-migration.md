# PocketBase CMS Migration Implementation Plan

Date: 2026-09-04
Revised: 2026-09-07
Spec: `docs/2026-09-04-option-1-pocketbase-cms-design.md`

## How to use this plan

Work in order. For a code task, write the stated failing test before implementation, run it to
confirm the expected failure, implement only that task, rerun its checks, and commit at the stated
boundary. For an operations task, record the preflight evidence before changing anything and stop
on any failed gate. Never place credentials, production database files, attachment bytes, generated
public output, or migration manifests in git.

All npm commands run from `site/`. On Windows PowerShell, replace `npm` with `npm.cmd` if execution
policy blocks `npm.ps1`. Node 22+ and built-in `node:test` are required. Exit code `10` from either
`sync:*:check` command means public changes are pending; it is not an error.

This plan keeps both sources live until PocketBase is proven. NocoDB is the default and production
authority through Phase 4. No task may silently fall back to another source.

## Fixed contracts and decisions

- Public JSON shapes, routes, frontend behavior, `schemaVersion`, the `ModernImage` descriptor, and
  public commission title format remain unchanged.
- Public IDs may be re-keyed for semantic comparison, but relationship targets must be mapped and
  compared; IDs may not simply be discarded.
- Every content record has a required, immutable, positive numeric `legacy_id`. Migrated records
  retain the NocoDB ID. After cutover, editors allocate the next unused positive number per
  collection; the unique index rejects duplicates.
- Ordering never uses a PocketBase record ID. Shared sort rules end with `legacy_id`; attachment
  order ends with the original array ordinal.
- `styles` and `breakpoints` are PocketBase JSON arrays and public JSON arrays.
- Source originals are content-addressed by SHA-256 and shared between adapters. Backend manifests
  are separate.
- Gallery GIF originals and reference-sheet originals remain available byte-for-byte. Uma does not
  gain a new public `originalUrl` unless a contract fixture proves it already exists; support-card
  GIF bytes are nevertheless verified during migration.
- PocketBase file fields are protected. The read-only sync identity may list/view the eight content
  collections and request protected files, but may not create, update, or delete anything.
- JavaScript files in `vps-scripts/pocketbase/pb_migrations/` are the only schema authority.
  Production automigration is disabled; there is no schema CLI or authoritative schema export.
- PocketBase is pinned to `0.40.3` after a final official-release check. The implementation retrieves
  and verifies the official checksum; the plan intentionally contains no guessed checksum.
- PocketBase listens on `0.0.0.0:8090` inside its container. Docker publishes only
  `127.0.0.1:8090:8090` on the VPS.
- `vps-scripts/auto-deploy.sh` remains supported unless the owner explicitly retires it. This plan
  therefore updates and tests both deployment paths.

## Planned repository layout

```text
site/scripts/
  sync-gallery.mjs
  sync-uma.mjs
  adapters/
    nocodb-gallery.mjs
    nocodb-uma.mjs
    pocketbase-gallery.mjs
    pocketbase-uma.mjs
  lib/
    env.mjs
    source-selection.mjs
    pocketbase-client.mjs
    gallery-model.mjs
    uma-model.mjs
    image-pipeline.mjs
    output-writers.mjs
  migrate/
    migrate-nocodb-to-pocketbase.mjs
    compare-sources.mjs
  tests/
    fixtures/
    *.test.mjs
vps-scripts/pocketbase/
  Dockerfile
  compose.yml
  pb_migrations/*.js
```

Cache state:

```text
site/.cache/originals/<sha256>.<detected-extension>
site/.cache/gallery/{nocodb,pocketbase}/manifest.json
site/.cache/uma/{nocodb,pocketbase}/manifest.json
site/.cache/pocketbase-migration/manifest.json
site/.cache/migration-baseline/**
```

## Phase 0 — Record the completed safety prerequisites

### Task 0: Record the preserved baseline and backups

**Classification:** `[ops]`

**Purpose:** Record, without repeating, the already completed clean branch, NocoDB public-output
baseline, verified PostgreSQL/attachment/configuration backups, and off-VPS copy.

**Files affected:** The external migration log only; no repository files.

**Interfaces or behavior produced:** A dated record containing branch commit, baseline location and
hash, backup timestamps/hashes, restore-verification result, and off-server destination.

**Tests written first:** Not applicable to an ops-only task. Preflight: `git status --short --branch`
must show `feat/pocketbase-migration` and no unexpected changes.

**Validation:** `git rev-parse HEAD`; `sha256sum -c <recorded-checksum-file>`;
`pg_restore --list <postgres-backup.dump>`; `tar -tf <attachments-backup.tar>`; compare the
configuration archive against its recorded file list. Substitute the exact recorded artifact paths,
never globs.

**Expected success result:** All four prerequisites are traceable to immutable timestamps and
checksums.

**Failure/stop conditions:** Stop if any artifact cannot be located or its checksum no longer
matches. Do not infer that an old or unverified backup is usable.

**Commit boundary:** None.

**Rollback implications:** These artifacts are the recovery anchor until the final PocketBase
restore drill and NocoDB retirement complete.

## Phase 1 — Lock down the existing contract before refactoring

### Task 1: Add the test harness and lint all script modules

**Classification:** `[code]`

**Purpose:** Make regression tests and `.mjs` linting part of the normal workflow.

**Files affected:** `site/package.json`, `site/eslint.config.js`,
`site/scripts/tests/smoke.test.mjs`.

**Interfaces or behavior produced:** `npm test` runs `node --test` suites; ESLint applies Node and
required web-platform globals to `scripts/**/*.{js,mjs}`.

**Tests written first:** Add the smoke test and `test` script; run `npm test`. Then add a temporary
`.mjs` fixture using a Node global and prove the old lint selector misses it before correcting the
selector.

**Validation:** `npm test`; `npm run lint`; Windows: `npm.cmd test` and `npm.cmd run lint`.

**Expected success result:** The smoke test passes and every current `.mjs` script is linted without
undefined-global errors.

**Failure/stop conditions:** Stop if local Node is older than 22 or `node_modules` does not match the
lockfile; run `npm ci` before interpreting lint failures.

**Commit boundary:** `chore: add node test harness and lint mjs scripts`.

**Rollback implications:** Reverting this task removes the safety harness and blocks later tasks;
it has no production runtime effect.

### Task 2: Capture the NocoDB model, output, and image contract

**Classification:** `[code]`

**Purpose:** Turn current behavior and the preserved baseline into source-neutral regression
fixtures before changing script boundaries.

**Files affected:** `site/scripts/tests/fixtures/**`, contract tests under
`site/scripts/tests/`, and small export/entry-point guards in the two current sync scripts.

**Interfaces or behavior produced:** Sanitized fixtures for all eight source tables and their
attachments; contract assertions for `site.json`, every gallery shape, timeline shape,
relationships, filtering, ordering, secrets, `styles`, `breakpoints`, multiple attachment order,
responsive descriptors, gallery/reference GIF originals, and source SHA-256 inventory.

The inventory uses a stable attachment key
`<collection>:<positive legacy_id>:<field>:<zero-based ordinal>` and records filename, detected
format, byte size, and SHA-256. It reports observed maximum counts and sizes so Task 6 can choose
schema limits.

**Tests written first:** Write tests against exported pure functions and confirm they initially fail
because the current modules execute `main()` on import or lack exports. Include equal-name/equal-date
records so missing `legacy_id` tie-breakers fail visibly.

**Validation:** `node --test scripts/tests/nocodb-contract.test.mjs`; `npm test`;
`npm run validate:cms`; `npm run validate:uma`; `npm run build`.

**Expected success result:** Fixtures reproduce the preserved contract, every relationship resolves,
attachment hashes and order are recorded, and no fixture contains a token, signed URL, or internal
commission title in public output.

**Failure/stop conditions:** Stop on any unexplained difference from the preserved baseline, missing
`breakpoints`, undecodable source file, duplicate published slug, duplicate/zero source ID, or
unresolved relationship.

**Commit boundary:** `test: capture NocoDB public and image contract`.

**Rollback implications:** Tests are observational. Keep the external full baseline even if these
sanitized fixtures are later revised.

### Task 3: Extract the shared pipeline and rename scripts before cutover

**Classification:** `[code]`

**Purpose:** Separate source adapters from model, image, validation, and output code while NocoDB
behavior remains authoritative; complete script and cache-path transitions before production
cutover.

**Files affected:** Rename `site/scripts/sync-nocodb.mjs` to `sync-gallery.mjs` and
`sync-uma-nocodb.mjs` to `sync-uma.mjs`; create `site/scripts/adapters/nocodb-*.mjs` and shared
`site/scripts/lib/*`; update `site/package.json`, tests, both deploy scripts, `site/WORKFLOW.md`, and
`AGENTS.md` references.

**Interfaces or behavior produced:** Adapters return source-neutral records with
`sourceId`, `legacyId`, ordered relations, and attachments shaped as
`{ sourceKey, filename, mimeHint, size, ordinal, download() }`. Shared model functions and image/output
writers contain no NocoDB URL or token logic. Generated public URLs retain the existing
`/generated/nocodb/` prefix during migration.

**Tests written first:** Add boundary tests that run the existing NocoDB fixtures through the new
interfaces and assert byte-for-byte JSON equality after normalizing only `generatedAt`; confirm the
test fails before extraction.

**Validation:** `npm test`; `npm run lint`; `npm run sync -- --source=nocodb`;
`npm run sync:uma -- --source=nocodb`; `npm run validate:cms`; `npm run validate:uma`;
`npm run build`.

**Expected success result:** The renamed NocoDB path reproduces current public behavior and uses
`.cache/{gallery,uma}/nocodb` plus shared `.cache/originals`.

**Failure/stop conditions:** Stop on output reordering, public shape change, new download, changed
hash, loss of original GIF/reference file, or any frontend/build difference.

**Commit boundary:** `refactor: extract source-neutral CMS pipeline`.

**Rollback implications:** NocoDB remains the only implemented adapter, so this commit can be
reverted without CMS data changes. Record the last compatible pre-rename commit.

### Task 4: Add explicit source selection and isolated manifest state

**Classification:** `[code]`

**Purpose:** Make backend choice visible, testable, and safe before PocketBase exists.

**Files affected:** `site/scripts/lib/source-selection.mjs`, both sync entry points, package scripts,
tests, `.gitignore` if required, and documentation references.

**Interfaces or behavior produced:** `selectSource(argv, env)` returns `nocodb` or `pocketbase` with
precedence `--source > CMS_SOURCE > nocodb`. It rejects unknown/duplicate conflicting values.
`manifestPath(area, source)` isolates backend state while original files remain content-addressed
and shared.

**Tests written first:** Cover both CLI forms (`--source=x`, `--source x`), precedence, default,
invalid/conflicting input, missing selected-source configuration, source-specific fingerprints, and
unchanged `0/10/1` exit behavior.

**Validation:** `npm test`; `npm run lint`; `npm run sync:check -- --source=nocodb` and
`npm run sync:uma:check -- --source=nocodb` (accept only `0` or `10`); run an invalid source and
confirm exit `1`.

**Expected success result:** Both commands default to NocoDB and never silently fall back.

**Failure/stop conditions:** Stop if the deployment scripts cannot select a source solely through
`CMS_SOURCE`, or if the two backends could read/write the same manifest.

**Commit boundary:** `feat: add explicit CMS source selection`.

**Rollback implications:** Until cutover, `/etc/cuddlebuns/gallery.env` either omits `CMS_SOURCE` or
sets it to `nocodb`.

## Phase 2 — Build and prove the PocketBase foundation

### Task 5: Add a configurable read-only PocketBase client

**Classification:** `[code]`

**Purpose:** Provide one injected-fetch client for sync reads and a separately authorized mode for
the temporary migration superuser.

**Files affected:** `site/scripts/lib/env.mjs`, `pocketbase-client.mjs`, and client tests.

**Interfaces or behavior produced:** `getPocketBaseConfig(env, role)` and
`createPocketBaseClient(config, options)` with authentication against configurable
`authCollection`; paged `listAll`; protected-file token and URL creation; `getByLegacyId`; and, only
for migration-role clients, create/update/file replacement helpers. Normal sync configuration uses
`POCKETBASE_AUTH_COLLECTION=cms_sync` and exposes no mutation calls to adapters.

**Tests written first:** Mock login paths, token reuse/refresh, pagination beyond one page, filters,
timeouts/retries, protected file token use, URL encoding, explicit auth collection, denied writes,
and redaction of passwords/tokens from errors.

**Validation:** `node --test scripts/tests/pocketbase-client.test.mjs`; `npm test`; `npm run lint`.

**Expected success result:** No normal client request targets `_superusers`; secrets never appear in
logs or serialized errors.

**Failure/stop conditions:** Stop if authentication is hard-coded, a read client can mutate, or a
retry can duplicate a non-idempotent write.

**Commit boundary:** `feat: add scoped PocketBase client`.

**Rollback implications:** No production path selects PocketBase yet.

### Task 6: Commit the complete PocketBase migrations

**Classification:** `[code]`

**Purpose:** Make a fresh database reproducible and encode least-privilege rules.

**Files affected:** `vps-scripts/pocketbase/pb_migrations/*.js` and schema assertion tests. Do not
create `pocketbase-schema.mjs` or an authoritative schema JSON export.

**Interfaces or behavior produced:** Migrations create `cms_sync` and the eight collections listed
in the design. Content fields include `styles`, `breakpoints`, required positive `legacy_id`, unique
legacy indexes, correct relations, protected files, and limits derived from Task 2's inventory.
System fields are not redefined. Content list/view rules admit only `cms_sync`; write rules are
locked. The sync auth collection cannot self-register or manage records.

**Tests written first:** Parse/apply the migrations in a disposable fixture and assert exact field
types/options, relation targets, rules, required fields, indexes, and file limits. Include attempts
to create missing/zero/duplicate `legacy_id` values.

**Validation:** `npm test`; `npm run lint`; later container validation is the gate in Task 8.

**Expected success result:** Schema assertions cover every current NocoDB field and the auth
collection without defining `created` or `updated`.

**Failure/stop conditions:** Stop if source inventory exceeds a chosen limit, any relation is
ambiguous, or a second schema authority is introduced.

**Commit boundary:** `feat: define PocketBase schema migrations`.

**Rollback implications:** Before production data exists, revert the migration commit and recreate
the disposable database. Never edit an already-applied production migration; add a new one.

### Task 7: Add the pinned, non-root disposable container

**Classification:** `[code]`

**Purpose:** Package exactly the binary and migrations tested and later deployed.

**Files affected:** `vps-scripts/pocketbase/Dockerfile`, `compose.yml`, `.dockerignore`, and container
test helpers.

**Interfaces or behavior produced:** PocketBase `0.40.3`; a supported pinned Alpine patch/digest;
official archive checksum verification; fixed non-root UID/GID; copied migrations; persistent
`/pb/pb_data`; `--automigrate=0`; internal `0.0.0.0:8090`; host
`127.0.0.1:8090:8090`; health check; measured `GOMEMLIMIT`; `restart: unless-stopped`.

**Tests written first:** Add a static policy test rejecting `latest`, root execution, missing
checksum verification, missing migrations, missing health check, container-loopback listening, or
host-wide port publication.

**Validation:** From the repository root, `docker compose -f vps-scripts/pocketbase/compose.yml
config`; `docker build --no-cache -t cuddlebuns-pocketbase:test vps-scripts/pocketbase`; inspect the
resulting image user and labels.

**Expected success result:** Build logs show the official checksum check succeeding and the image
runs as the fixed non-root user.

**Failure/stop conditions:** Stop if `0.40.3` is no longer the approved version, the official
checksum cannot be obtained, the VPS architecture is unknown, or the selected Alpine release is
unsupported.

**Commit boundary:** `feat: add hardened PocketBase container`.

**Rollback implications:** The image is additive and is not yet running on the VPS.

### Task 8: Add disposable-container integration coverage

**Classification:** `[code]`

**Purpose:** Prove real PocketBase behavior instead of relying on REST/schema assumptions.

**Files affected:** `site/scripts/tests/pocketbase-integration.test.mjs`, fixture helpers, and
`site/package.json` scripts such as `test:integration`.

**Interfaces or behavior produced:** A unique temporary directory/volume and port per run; automatic
cleanup; fresh migration, initialized restart, and health readiness helpers.

**Tests written first:** Cover schema application, restart with applied migrations, read-only login,
allowed list/view/protected download, denied create/update/delete, pagination, JSON arrays, single
and multiple relations, one/many files, file order, maximum count/size rejection, valid large file,
and migration-style reruns.

**Validation:** From `site/`, `npm run test:integration`; `npm test`; `npm run lint`. Confirm no test
uses `/var/lib/cuddlebuns` or production port `8090`.

**Expected success result:** A fresh instance and the same restarted instance pass; all disposable
state is removed after success.

**Failure/stop conditions:** Stop on leaked containers, state outside the disposable directory,
write access by `cms_sync`, schema drift, or ordering changes in file/relation arrays.

**Commit boundary:** `test: cover PocketBase container integration`.

**Rollback implications:** Test-only; failure prevents provisioning.

### Task 9: Run the complete local foundation gate

**Classification:** `[code]`

**Purpose:** Establish one reproducible green checkpoint before migration code.

**Files affected:** None unless a test exposes a defect, in which case fix it in its owning earlier
task and amend with reviewer approval.

**Interfaces or behavior produced:** A recorded local test report containing Node, Docker,
PocketBase, Alpine image digest, schema migration, and restart results.

**Tests written first:** No new behavior; this task executes the suites written in Tasks 1–8.

**Validation:** `node --version`; `npm ci`; `npm test`; `npm run test:integration`;
`npm run lint`; `npm run build`.

**Expected success result:** Every command exits `0` and the report names the exact image digest.

**Failure/stop conditions:** Any failure blocks migration work; do not weaken an assertion to pass.

**Commit boundary:** None unless only a reproducible test-report document is intentionally tracked.

**Rollback implications:** None.

## Phase 3 — Implement migration and the second adapters

### Task 10: Build the idempotent NocoDB-to-PocketBase upsert

**Classification:** `[code]`

**Purpose:** Safely converge PocketBase on NocoDB after partial runs and later editorial changes.

**Files affected:** `site/scripts/migrate/*`, migration tests, and `site/package.json`.

**Interfaces or behavior produced:** `npm run migrate:cms -- [--dry-run]`; dependency-ordered record
upserts by `legacy_id`; a second relation pass; ordered file SHA-256 comparison/replacement; GIF
detection by filename and bytes; `styles`/`breakpoints` preservation; and resumable manifest at
`.cache/pocketbase-migration/manifest.json`.

Transform output is `{ collection, legacyId, fields, relations, files }`, where each file has
`field`, `ordinal`, `filename`, `size`, `detectedFormat`, `sha256`, and a lazy byte source. Multipart
writes attach a single JSON serialization of ordinary fields and complete relation arrays plus
separate file parts. The exact encoding is locked by the real-container test.

**Tests written first:** Cover `--dry-run` zero writes; create/update/unchanged outcomes; interrupted
resume; changed scalar/relation/file; removal and replacement; second-pass mapping; multiple file
order; GIF metadata lies; JSON arrays; duplicate slug/legacy ID; zero ID; dangling relation;
oversize file; hash mismatch; and source/created/updated/unchanged/failed counts.

**Validation:** `node --test scripts/tests/migration*.test.mjs`; `npm run test:integration`;
`npm test`; `npm run lint`.

**Expected success result:** Running twice yields only `unchanged` on the second run and identical
destination downloads; every unexplained mismatch exits nonzero.

**Failure/stop conditions:** Stop if the manifest is required for correctness, a record is skipped
solely because it exists, relation loss is tolerated, or changed files are appended instead of
replaced.

**Commit boundary:** `feat: add idempotent NocoDB PocketBase migration`.

**Rollback implications:** The tool affects only an explicitly configured PocketBase destination.
Keep it until NocoDB is fully decommissioned.

### Task 11: Add PocketBase gallery and Uma adapters

**Classification:** `[code]`

**Purpose:** Feed the proven shared pipeline from PocketBase without removing NocoDB.

**Files affected:** `site/scripts/adapters/pocketbase-gallery.mjs`, `pocketbase-uma.mjs`, both sync
entry points, adapter/model tests, and source fingerprints.

**Interfaces or behavior produced:** Both adapters return the same source-neutral shape as NocoDB,
map PocketBase relations back through `legacy_id`, preserve file/relation array order, and download
protected originals through the read-only client. Sorts end in positive `legacy_id` and attachment
ordinal.

**Tests written first:** Run equivalent NocoDB and PocketBase fixtures through the shared models;
cover `styles`, `breakpoints`, drafts, visible/published records, invalid published records,
multiple artists/versions/files, stable gallery/support-card order, and GIF original behavior.

**Validation:** `npm test`; `npm run test:integration`; `npm run lint`;
`npm run sync -- --source=pocketbase`; `npm run sync:uma -- --source=pocketbase`;
`npm run validate:cms`; `npm run validate:uma`; `npm run build`.

**Expected success result:** Both explicit source modes work; the default remains NocoDB.

**Failure/stop conditions:** Stop if a PocketBase ID changes ordering, read auth cannot download a
protected file, or an internal commission name reaches public JSON.

**Commit boundary:** `feat: add PocketBase CMS source adapters`.

**Rollback implications:** Selecting `nocodb` bypasses all new adapter behavior.

### Task 12: Rehearse migration locally while NocoDB remains live

**Classification:** `[ops]`

**Purpose:** Exercise a full migration against a disposable PocketBase instance using current
NocoDB credentials without changing either production service.

**Files affected:** Gitignored `.cache/migration-baseline`, migration manifest, and disposable data.

**Interfaces or behavior produced:** A timestamped rehearsal report with dry-run and two real-run
summaries, source/destination counts, hashes, and duration.

**Tests written first:** Preflight verifies destination URL/instance marker is disposable, dry-run
produces zero writes, and source credentials are read-only.

**Validation:** From `site/`: `npm run migrate:cms -- --dry-run`; `npm run migrate:cms` twice;
`npm run sync -- --source=pocketbase`; `npm run sync:uma -- --source=pocketbase`;
`npm run validate:cms`; `npm run validate:uma`; `npm run build`.

**Expected success result:** First run creates/updates all records, second run is entirely unchanged,
and every validator/build exits `0`.

**Failure/stop conditions:** Any failed/unmapped count, duplicate, oversize file, hash mismatch, or
write to NocoDB stops the rehearsal.

**Commit boundary:** None; credentials and reports stay outside git.

**Rollback implications:** Destroy only the verified disposable instance and its exact test path.

### Task 13: Prove semantic and image-hash equivalence

**Classification:** `[code]`

**Purpose:** Replace raw text/dimension-only comparison with a relationship-aware equivalence gate.

**Files affected:** `site/scripts/migrate/compare-sources.mjs`, comparison tests, and package script.

**Interfaces or behavior produced:** Comparator normalizes only `generatedAt`, backend IDs after
building a complete `legacy_id` mapping, and generated URLs after mapping them to source hashes.
It compares public shapes/values, record and relationship counts/targets, array and display order,
attachment order, original hashes, GIF availability, descriptor entries, and derivative dimensions.

**Tests written first:** Mutation tests independently break each compared property and require exit
`1`; add a valid fixture with different PocketBase IDs/URLs and identical semantics that exits `0`.

**Validation:** `npm test`; `npm run compare:cms`; `npm run validate:cms`;
`npm run validate:uma`; `npm run build`.

**Expected success result:** The local rehearsal has zero unexplained differences. The report lists
all normalized fields rather than hiding them.

**Failure/stop conditions:** Stop if comparison removes IDs without checking mapped relationships,
accepts dimension-only image matches, or has an open-ended ignore list.

**Commit boundary:** `test: add semantic CMS equivalence gate`.

**Rollback implications:** Comparator is non-mutating and remains available through the soak.

## Phase 4 — Provision PocketBase beside authoritative NocoDB

### Task 14A: Create and verify CMS DNS

**Classification:** `[ops]`

**Purpose:** Route `cms.cuddlebuns.moe` to the existing VPS without touching the public site route.

**Files affected:** DNS provider state only.

**Interfaces or behavior produced:** One CMS `A`/`AAAA` record matching the VPS network plan.

**Tests written first:** Record current `dig` output and VPS addresses.

**Validation:** `dig +short cms.cuddlebuns.moe A`; if used, `dig +short cms.cuddlebuns.moe AAAA`.

**Expected success result:** DNS resolves only to intended VPS addresses.

**Failure/stop conditions:** Stop on wrong/stale addresses or an unintended proxy/CDN mode.

**Commit boundary:** None.

**Rollback implications:** Remove only the newly created DNS record.

### Task 14B: Start PocketBase beside NocoDB on the VPS

**Classification:** `[ops]`

**Purpose:** Run the exact tested image with persistent storage and no public cutover.

**Files affected:** `/var/lib/cuddlebuns/pb_data`, Docker/Compose state, and external ops log.

**Interfaces or behavior produced:** Healthy PocketBase on host `127.0.0.1:8090`; migrations apply
automatically with automigration disabled. Create separate human superusers, one temporary
schema/bootstrap-and-migration superuser, and one `cms_sync` record without storing their secrets
in git.

**Tests written first:** Check `ss -ltnp | grep ':8090'` before start, verify data-directory ownership
matches the fixed container UID/GID, and confirm the image digest equals Task 9.

**Validation:** `docker compose -f vps-scripts/pocketbase/compose.yml up -d`;
`docker compose -f vps-scripts/pocketbase/compose.yml ps`;
`curl --fail http://127.0.0.1:8090/api/health`; inspect logs and schema migration history; restart
once and repeat health/schema checks.

**Expected success result:** Container is healthy as non-root after restart and all nine collections
exist once.

**Failure/stop conditions:** Stop on a new image build, migration error, wrong owner, broad port bind,
or existing data in the intended fresh directory.

**Commit boundary:** None.

**Rollback implications:** Stop the new PocketBase container; do not touch NocoDB or current release.

### Task 14C: Publish the PocketBase Caddy block

**Classification:** `[code + ops]`

**Purpose:** Expose the editor/admin endpoint with upload limits and correct client IP handling.

**Files affected:** `cuddlebuns.caddy`; live Caddy configuration; PocketBase proxy-header settings.

**Interfaces or behavior produced:** `cms.cuddlebuns.moe` reverse proxies to `127.0.0.1:8090`, limits
request bodies consistently with schema file limits plus multipart overhead, and uses a sufficient
read timeout. PocketBase trusts the intended Caddy proxy headers only.

**Tests written first:** Add a Caddy config assertion/snapshot and a staging request that checks
health, oversized rejection, login page, and recorded client IP.

**Validation:** `caddy validate --config cuddlebuns.caddy`; on VPS validate the installed file,
reload once, then `curl --fail https://cms.cuddlebuns.moe/api/health` and inspect one request log.

**Expected success result:** HTTPS health succeeds and PocketBase records the real client address.

**Failure/stop conditions:** Stop before reload on validation failure, body-limit mismatch, TLS
failure, or untrusted forwarding headers.

**Commit boundary:** `ops: add PocketBase reverse proxy configuration` before the single reload.

**Rollback implications:** Restore the prior validated Caddy config and reload; PocketBase remains
reachable locally.

### Task 15A: Enable local PocketBase backups

**Classification:** `[ops]`

**Purpose:** Produce versioned, monitored local snapshots before production content is trusted.

**Files affected:** PocketBase settings and `/var/lib/cuddlebuns/pb_data/backups`.

**Interfaces or behavior produced:** Scheduled local backup with documented cadence/retention and
enough disk headroom for data plus originals.

**Tests written first:** Record disk usage and trigger one manual backup before enabling schedule.

**Validation:** Verify backup file existence, timestamp, nonzero size, and checksum; inspect
PocketBase logs for successful completion.

**Expected success result:** A current local backup is created and the next scheduled time is known.

**Failure/stop conditions:** Stop if free disk would fall below the chosen alert threshold or backup
logs report exclusion/error.

**Commit boundary:** None.

**Rollback implications:** Disable only the new schedule; retain the verified backup.

### Task 15B: Enable off-server copy and backup monitoring

**Classification:** `[ops]`

**Purpose:** Move backups to another failure domain and alert on staleness/failure.

**Files affected:** External backup destination, secret store, scheduler, and monitoring config.

**Interfaces or behavior produced:** Encrypted/authenticated copy, retention, last-success metric,
failure alert, and disk-use alert. PocketBase log/container-health checks join the existing service
monitoring.

**Tests written first:** Send a test object and a test alert; document restore access held by a
different failure domain.

**Validation:** Compare local and remote backup checksums; force a harmless failed test job and
observe the alert; return the job to green.

**Expected success result:** Off-server bytes match and monitoring reports success afterward.

**Failure/stop conditions:** No cutover without a verified remote copy and functioning alert path.

**Commit boundary:** Commit only non-secret monitoring/runbook files if the repository owns them;
otherwise none.

**Rollback implications:** Do not delete remote backups when changing the copy job.

### Task 16: Rehearse against VPS PocketBase while NocoDB stays authoritative

**Classification:** `[ops]`

**Purpose:** Prove real VPS networking, storage, limits, auth, and performance without changing the
deployed source.

**Files affected:** PocketBase data and external rehearsal report; no live site configuration.

**Interfaces or behavior produced:** Dry-run, upsert, rerun, PocketBase-source sync to a separate
working output, semantic comparison, and timing/resource measurements.

**Tests written first:** Confirm `/etc/cuddlebuns/gallery.env` still selects `nocodb`, the timer is
healthy, and rehearsal output/cache paths cannot replace `current`.

**Validation:** From the isolated `site/`, run `npm run migrate:cms -- --dry-run`,
`npm run migrate:cms` twice, `npm run sync -- --source=pocketbase`,
`npm run sync:uma -- --source=pocketbase`, `npm run validate:cms`,
`npm run validate:uma`, `npm run compare:cms`, `npm run lint`, `npm test`, and
`npm run build`. Inspect with `docker stats --no-stream cuddlebuns-pocketbase`,
`docker compose -f vps-scripts/pocketbase/compose.yml logs --tail=200 pocketbase`, and
`du -sh /var/lib/cuddlebuns/pb_data`.

**Expected success result:** Zero unexplained differences and acceptable resource headroom while
the live timer continues to read NocoDB.

**Failure/stop conditions:** Stop on any live symlink change, source selection change, equivalence
failure, or resource exhaustion.

**Commit boundary:** None.

**Rollback implications:** PocketBase can be cleared/restored from its pre-rehearsal backup; NocoDB
and the live site were not changed.

### Task 16B: Prove a pre-cutover PocketBase restore

**Classification:** `[ops]`

**Purpose:** Verify backups before depending on them for production recovery.

**Files affected:** A new disposable restore directory/container only.

**Interfaces or behavior produced:** Restore report naming backup checksum, PocketBase image digest,
migration revision, counts, auth result, validators, and cleanup path.

**Tests written first:** Resolve and record the absolute disposable path; assert it is not the live
`pb_data` directory.

**Validation:** Restore the latest off-server backup into the disposable path; start on an unused
loopback port; run health, schema, read-auth, counts, both PocketBase syncs, validators, comparator,
and build.

**Expected success result:** Restored output is equivalent and the live container is untouched.

**Failure/stop conditions:** Stop cutover on any restore, auth, hash, count, or validation failure.

**Commit boundary:** None.

**Rollback implications:** Remove only the verified disposable restore path after recording results.

## Phase 5 — Freeze, final upsert, and controlled cutover

### Task 17: Schedule the editorial freeze and stop automatic sync

**Classification:** `[ops]`

**Purpose:** Establish a bounded final source snapshot and prevent a timer race.

**Files affected:** Editorial schedule and systemd timer state.

**Interfaces or behavior produced:** Announced start/end, editor acknowledgement, rollback owner,
and stopped timer while the last successful static release continues serving.

**Tests written first:** `systemctl list-timers` and `systemctl status
cuddlebuns-gallery-sync.timer`; confirm no service invocation is running.

**Validation:** `sudo systemctl stop cuddlebuns-gallery-sync.timer`; wait for or inspect the oneshot
service; verify `systemctl is-active ...timer` is inactive and the live site still returns `200`.

**Expected success result:** Editors are frozen, timer is inactive, and Caddy serves the prior release.

**Failure/stop conditions:** Stop if any editor cannot acknowledge, a sync process still runs, or no
rollback owner is available.

**Commit boundary:** None.

**Rollback implications:** Re-enable the NocoDB-selected timer if cutover is canceled before the
final migration.

### Task 18: Take the fresh NocoDB backup and baseline

**Classification:** `[ops]`

**Purpose:** Capture the exact final authoritative state immediately before cutover.

**Files affected:** External backups and gitignored `.cache/migration-baseline` only.

**Interfaces or behavior produced:** Fresh PostgreSQL, attachments, configuration, off-server copy,
public output, source-image inventory, commit ID, and checksums.

**Tests written first:** Run source duplicate/relation/oversize inventory and both NocoDB
`--check`/sync validations before backup acceptance.

**Validation:** `npm run sync -- --source=nocodb`; `npm run sync:uma -- --source=nocodb`;
`npm run validate:cms`; `npm run validate:uma`; `npm run build`;
`sha256sum -c <fresh-backup-checksums>` locally and at the off-server destination.

**Expected success result:** Baseline and backup describe the same frozen source and all hashes are
recorded.

**Failure/stop conditions:** Stop on editor activity, validation error, backup mismatch, or missing
off-server copy.

**Commit boundary:** None.

**Rollback implications:** This becomes the current NocoDB rollback point during observation.

### Task 19: Run the final migration upsert

**Classification:** `[ops]`

**Purpose:** Converge VPS PocketBase on the frozen NocoDB source.

**Files affected:** VPS PocketBase data and gitignored migration manifest.

**Interfaces or behavior produced:** Final dry-run, upsert, relation reconciliation, file verification,
and idempotent rerun reports.

**Tests written first:** Dry-run must report expected changes and zero failed/unmapped items.

**Validation:** Run `npm run migrate:cms -- --dry-run`, then `npm run migrate:cms` twice with the
temporary migration superuser; compare source/destination counts, relations, file order, and hashes.

**Expected success result:** Final rerun reports every record and file unchanged with zero failures.

**Failure/stop conditions:** Stop on any mismatch or new source modification. Do not switch source.

**Commit boundary:** None.

**Rollback implications:** NocoDB remains authoritative; restore or recreate PocketBase and rerun.

### Task 20: Run the final validation gate

**Classification:** `[code + ops]`

**Purpose:** Prove the exact production revision and frozen PocketBase data before configuration
changes.

**Files affected:** Build/cache output only.

**Interfaces or behavior produced:** Signed-off test, integration, lint, semantic comparison,
validator, and production-build results.

**Tests written first:** No new tests; execute all previously written gates against both explicit
sources.

**Validation:** `npm ci`; `npm test`; `npm run test:integration`; `npm run lint`;
`npm run sync -- --source=nocodb`; `npm run sync:uma -- --source=nocodb`;
`npm run validate:cms`; `npm run validate:uma`; repeat both syncs and validators with
`--source=pocketbase` in the isolated backend output; then `npm run compare:cms` and
`npm run build`.

**Expected success result:** Every command exits `0`; both `--check` commands for PocketBase exit
`0` after generation.

**Failure/stop conditions:** Any warning without an explained allowlist entry blocks cutover.

**Commit boundary:** The production revision must already be committed and reviewed; no ad hoc VPS
commit.

**Rollback implications:** None; the timer remains stopped and live release unchanged.

### Task 21: Switch only the systemd source environment

**Classification:** `[ops]`

**Purpose:** Select the read-only PocketBase account without deploying yet.

**Files affected:** `/etc/cuddlebuns/gallery.env` and its root-only NocoDB backup.

**Interfaces or behavior produced:** `CMS_SOURCE=pocketbase`, loopback `POCKETBASE_URL`, configurable
`cms_sync` collection, and sync credentials; NocoDB variables remain in a separate `0600` rollback
file.

**Tests written first:** Copy and checksum the current environment file; validate the replacement in
a root-only temporary file; confirm no temporary migration-superuser secret is included.

**Validation:** `sudo chown root:root` and `sudo chmod 600` both files; use a root-only environment
parser to confirm required names; keep timer inactive.

**Expected success result:** The service environment selects PocketBase and contains only read-only
PocketBase credentials for normal sync.

**Failure/stop conditions:** Stop on permissive permissions, missing rollback file, or any superuser
credential.

**Commit boundary:** None.

**Rollback implications:** Before PocketBase editing begins, restore the NocoDB file and explicitly
set `CMS_SOURCE=nocodb`.

### Task 22: Deploy once manually and smoke-test

**Classification:** `[ops]`

**Purpose:** Perform the single atomic production cutover while the timer remains stopped.

**Files affected:** A new release directory and the `current` symlink.

**Interfaces or behavior produced:** One PocketBase-built static release served by Caddy.

**Tests written first:** Record current symlink target and known-good release; verify lock availability,
PocketBase health, source environment, and free disk.

**Validation:** Start `cuddlebuns-gallery-sync.service` once; inspect its complete journal for both
syncs, validators, build, and activated release. Run HTTP checks for `site.json`, representative
gallery JSON, timeline JSON, routes, responsive images, reference/GIF originals, then browser smoke
tests for hub, version selection, lightbox, and Uma relationships.

**Expected success result:** Exactly one new complete release becomes current; visitors experience
no downtime.

**Failure/stop conditions:** If the service fails before activation, retain the old release and
investigate. If post-activation smoke fails, execute the pre-edit rollback below immediately.

**Commit boundary:** None.

**Rollback implications:** Restore NocoDB environment, select `nocodb`, restore the compatible
revision if necessary, run both NocoDB syncs and validators, build, atomically deploy a known-good
release, and keep PocketBase editing disabled.

### Task 22B: Remove or rotate the temporary migration superuser

**Classification:** `[ops]`

**Purpose:** Remove the high-privilege credential as soon as the final migration and cutover are
known good.

**Files affected:** PocketBase `_superusers` records and the external secret store.

**Interfaces or behavior produced:** Human superusers remain separate; the normal timer has only
the `cms_sync` credential.

**Tests written first:** Prove `cms_sync` can still read and download protected files and is denied
create/update/delete. Confirm at least two recoverable human superusers exist before removal.

**Validation:** Delete the temporary account or rotate it to an unavailable random password; remove
its old secret from the operational environment; authenticate the read-only account and one human
administrator again.

**Expected success result:** The migration credential no longer authenticates and the sync identity
remains read-only.

**Failure/stop conditions:** Stop if the temporary account is the only recoverable administrator or
if its credential is referenced by the service environment.

**Commit boundary:** None.

**Rollback implications:** A future migration repair requires a newly authorized temporary
superuser; never promote `cms_sync`.

### Task 23A: Re-enable the timer

**Classification:** `[ops]`

**Purpose:** Resume scheduled checks without combining timer state changes with a content edit.

**Files affected:** systemd timer state only.

**Interfaces or behavior produced:** Enabled five-minute PocketBase-selected timer.

**Tests written first:** Record current release, timer status, source environment, PocketBase health,
and backup age.

**Validation:** `sudo systemctl enable --now cuddlebuns-gallery-sync.timer`; observe one no-change
timer invocation and confirm it does not activate a release.

**Expected success result:** Timer is active and one quiet run succeeds against PocketBase.

**Failure/stop conditions:** Stop the timer and investigate any failure or unexpected release.

**Commit boundary:** None.

**Rollback implications:** Stop the timer; the editorial freeze and current release remain.

### Task 23B: Make one controlled PocketBase edit

**Classification:** `[ops]`

**Purpose:** Prove automatic PocketBase change detection with one reversible content change.

**Files affected:** One chosen PocketBase text field.

**Interfaces or behavior produced:** One observed automatic deployment.

**Tests written first:** Record the field's original value and current release. Choose a field that
does not affect relationships or publication and confirm no unrelated edit is pending.

**Validation:** Make the single edit; observe one timer service run, new release, live value, and
subsequent quiet `--check` result.

**Expected success result:** The edit produces one valid release and later checks are quiet.

**Failure/stop conditions:** Stop editing and execute the pre-edit rollback if detection,
validation, or deployment fails.

**Commit boundary:** None.

**Rollback implications:** The original value is recorded for Task 23C; editorial freeze remains.

### Task 23C: Revert the controlled edit

**Classification:** `[ops]`

**Purpose:** Return production content to the frozen baseline with one separate production change.

**Files affected:** The same PocketBase text field.

**Interfaces or behavior produced:** One automatic release restoring the baseline value.

**Tests written first:** Confirm no unrelated PocketBase edits occurred and the stored original value
matches the final baseline.

**Validation:** Restore the field; observe the timer deployment; rerun browser smoke and semantic
comparison to the frozen baseline.

**Expected success result:** Public content again matches the frozen baseline.

**Failure/stop conditions:** Keep the editorial freeze and treat any unrelated change as a recovery
event.

**Commit boundary:** None.

**Rollback implications:** NocoDB is still current because the only PocketBase edit was reverted.

### Task 24: Complete the rollback observation freeze

**Classification:** `[ops]`

**Purpose:** Keep NocoDB a genuinely current fallback long enough to observe scheduled runs.

**Files affected:** Monitoring/incident log only.

**Interfaces or behavior produced:** Agreed observation duration with repeated health, backup,
disk, logs, timer, output, and browser checks.

**Tests written first:** Schedule checkpoints and name the decision owner before the period starts.

**Validation:** At each checkpoint inspect PocketBase health/logs, timer journal, backup age/remote
copy, disk usage, current release, and representative public endpoints.

**Expected success result:** No unexplained failure or content difference through the observation
window.

**Failure/stop conditions:** Before editor thaw, rollback exactly as follows: stop timer; restore
root-only NocoDB environment; set `CMS_SOURCE=nocodb`; use the recorded compatible revision if
needed; run both syncs and validators; build; manually atomically deploy; smoke-test; re-enable the
NocoDB timer; keep PocketBase editing disabled until root cause is understood.

**Commit boundary:** None.

**Rollback implications:** This is the final window where NocoDB rollback requires no content
reconciliation.

## Phase 6 — PocketBase editing, soak, restore, and retirement

### Task 25: End the freeze and conduct the two-week PocketBase soak

**Classification:** `[ops]`

**Purpose:** Explicitly transfer editorial authority to PocketBase and observe normal use.

**Files affected:** Editorial access/process and operational log.

**Interfaces or behavior produced:** Editors use PocketBase, allocate positive `legacy_id` values,
and understand dashboard accounts are privileged administrators. Human superusers have separate
accounts, MFA, and an IP/subnet whitelist when practical; the temporary migration superuser is
removed or rotated.

**Tests written first:** Verify MFA/OTP delivery, whitelist recovery procedure, `cms_sync` denied
writes, backup recency, and editor instructions before thaw.

**Validation:** For two weeks monitor health, logs, timer failures, disk growth, backup copy, public
outputs, and a sample of new/edited records including stable ordering.

**Expected success result:** Normal edits deploy correctly for two weeks with no unexplained drift.

**Failure/stop conditions:** After thaw, do not claim NocoDB is current. Recover from a known
PocketBase backup, or explicitly reconcile PocketBase-only changes into NocoDB before selecting its
adapter.

**Commit boundary:** Commit the final workflow/AGENTS/environment/systemd/deployment documentation
updates before thaw if not already committed: `docs: document PocketBase CMS operations`.

**Rollback implications:** NocoDB is now an archive; restoring its environment file alone would lose
PocketBase-only edits.

### Task 26: Restore a post-soak backup into a disposable instance

**Classification:** `[ops]`

**Purpose:** Prove the current backup set, including PocketBase-only edits, before NocoDB removal.

**Files affected:** Disposable restore path only.

**Interfaces or behavior produced:** Final restore report with hashes, counts, relationships,
protected files, validators, build, and cleanup evidence.

**Tests written first:** Resolve and compare absolute live/disposable paths; confirm the chosen
off-server backup checksum and exact PocketBase image/migration revision.

**Validation:** Restore on an unused port, start twice, authenticate read-only, run both syncs,
validators, production build, relationship/hash comparison to live PocketBase, and browser smoke
against the disposable output.

**Expected success result:** Restored content exactly matches current PocketBase semantics and
source hashes.

**Failure/stop conditions:** Do not remove NocoDB, adapters, migration tooling, or old credentials
until the drill passes.

**Commit boundary:** None.

**Rollback implications:** Live services are untouched; delete only the verified disposable path.

### Task 27A: Remove migration-only code and the NocoDB adapters

**Classification:** `[code]`

**Purpose:** Simplify the repository only after the soak and restore gate.

**Files affected:** NocoDB adapters, migration CLI/tests/manifests documentation, package scripts,
source selector default, `.env.example`, `site/WORKFLOW.md`, `AGENTS.md`, both deploy scripts, and
validators only where obsolete backend secret checks are deliberately retained or generalized.

**Interfaces or behavior produced:** PocketBase becomes the sole source; normal commands and
`0/10/1` behavior remain. Historical migration documents may retain legitimate `NOCODB_` text.

**Tests written first:** Assert no runtime import/command references NocoDB, both deploy paths still
handle exit `10`, public output remains equivalent, and a scoped runtime-file search—not a
repository-wide historical-doc ban—finds no live NocoDB credentials.

**Validation:** `npm test`; `npm run test:integration`; `npm run lint`;
`npm run sync -- --source=pocketbase`; `npm run sync:uma -- --source=pocketbase`;
`npm run sync:check -- --source=pocketbase`; `npm run sync:uma:check -- --source=pocketbase`;
`npm run validate:cms`; `npm run validate:uma`; `npm run build`; run the named shell/static test
scripts created for `sync-build-deploy.sh` and `auto-deploy.sh`.

**Expected success result:** All production runtime paths use PocketBase and documentation describes
post-migration operation accurately.

**Failure/stop conditions:** Stop if `auto-deploy.sh` has not been confirmed retired or tested,
public output changes, or rollback archives have not met retention policy.

**Commit boundary:** `chore: retire NocoDB source adapters after PocketBase soak`.

**Rollback implications:** Keep the preceding compatible commit and NocoDB archive for the stated
retention period; post-soak recovery normally uses PocketBase backups.

### Task 27B: Deploy the PocketBase-only runtime

**Classification:** `[ops]`

**Purpose:** Put the reviewed cleanup commit into production before changing the NocoDB service.

**Files affected:** A new release directory and the `current` symlink.

**Interfaces or behavior produced:** One PocketBase-only static release with both deployment paths
still verified.

**Tests written first:** Record current release; confirm the reviewed revision no longer imports
NocoDB at runtime; run all Task 27A checks on the VPS.

**Validation:** Deploy the reviewed revision once through the normal atomic mechanism; run browser
smoke tests; observe two PocketBase timer cycles and exercise the retained `auto-deploy.sh` test
path without a second activation.

**Expected success result:** The PocketBase-only revision is current and all runtime paths are green.

**Failure/stop conditions:** Roll back to the preceding release if validation fails; leave NocoDB
running.

**Commit boundary:** None.

**Rollback implications:** Atomically repoint `current` to the recorded release; the NocoDB archive
and service are still intact.

### Task 27C: Stop the NocoDB service

**Classification:** `[ops]`

**Purpose:** End NocoDB compute use after runtime removal is deployed and verified.

**Files affected:** NocoDB service/container state only.

**Interfaces or behavior produced:** Stopped, disabled NocoDB service; archives retained.

**Tests written first:** Confirm the current production revision is the Task 27B revision and
take/check the final archive checksum and off-server copy.

**Validation:** Stop and disable only the identified NocoDB unit/container; monitor two timer cycles,
public endpoints, PocketBase health, and backups.

**Expected success result:** Site and PocketBase operation remain healthy without NocoDB running.

**Failure/stop conditions:** Restart NocoDB if an unexpected runtime dependency appears; do not
delete data.

**Commit boundary:** None.

**Rollback implications:** Service can be restarted from retained configuration while investigating.

### Task 27D: Remove the obsolete NocoDB proxy

**Classification:** `[code + ops]`

**Purpose:** Remove the obsolete Caddy route after stopped-service observation succeeds.

**Files affected:** Repository and live Caddy configuration.

**Interfaces or behavior produced:** No `noco.cuddlebuns.moe` proxy; PocketBase CMS and static site
blocks unchanged.

**Tests written first:** Capture current Caddy state and validate a repository change that removes
only the NocoDB block.

**Validation:** Commit the Caddy change; validate and reload Caddy once; verify the static site, CMS,
and representative public assets.

**Expected success result:** Static site and `cms.cuddlebuns.moe` remain healthy and the NocoDB host
has no responding route.

**Failure/stop conditions:** Restore the previous Caddy file on validation or health failure.

**Commit boundary:** `ops: remove retired NocoDB proxy`.

**Rollback implications:** Restore the previous validated Caddy configuration and reload.

### Task 27E: Remove the obsolete NocoDB DNS record

**Classification:** `[ops]`

**Purpose:** Remove the final public name only after the proxy removal is stable.

**Files affected:** DNS provider state only.

**Interfaces or behavior produced:** `noco.cuddlebuns.moe` no longer resolves after TTL.

**Tests written first:** Record the exact record, TTL, and current answers; confirm the PocketBase
CMS uses a separate DNS record.

**Validation:** Delete only the NocoDB DNS record; query authoritative and recursive resolvers until
the TTL expires; recheck `cuddlebuns.moe` and `cms.cuddlebuns.moe`.

**Expected success result:** Only the retired NocoDB name disappears.

**Failure/stop conditions:** Recreate the recorded DNS value if another hostname is affected.

**Commit boundary:** None.

**Rollback implications:** Recreate the retained DNS record while archives and service definition
remain available.

## Required deployment-document updates before cutover

The implementation is incomplete until the same reviewed commit updates:

- `site/.env.example` with both sources during migration and PocketBase-only values after retirement;
- `site/WORKFLOW.md` with source selection, `legacy_id` allocation, protected files, editor/admin
  privilege, backups, restore, logs, and Windows `npm.cmd` commands;
- `AGENTS.md` with the temporary dual-adapter architecture, then the final architecture;
- `vps-scripts/sync-build-deploy.sh` and `auto-deploy.sh` with `CMS_SOURCE`, source-neutral messages,
  isolated caches, tests, validation, and exit-10 handling;
- systemd descriptions and the root-only environment example;
- `cuddlebuns.caddy` with the CMS proxy, body limit, and timeout;
- backup-age/copy, disk, container-health, PocketBase-log, and timer-failure monitoring; and
- the operational rollback/recovery commands in this plan.

## Completion checklist for this documentation revision

- `git diff --check` passes.
- The design and implementation plan agree on adapters, identity, schema authority, auth, protected
  files, container networking, migration behavior, equivalence, freeze, rollback, backups, and
  retirement.
- Scoped `rg` searches find no superseded PocketBase version, retained privileged sync,
  non-upserting migration, competing schema authority, or weak image-equivalence claim.
- Legitimate descriptions of the historical NocoDB source and rollback adapter remain.
- Only the two planning documents are changed; there is no implementation, production mutation,
  commit, or push in this documentation pass.

## Decisions still requiring operations input

Before Task 6 or Task 7 is committed, the owner must supply or approve:

- maximum observed attachment counts/sizes and the safety margin used for each file field;
- VPS CPU architecture and memory headroom for the archive and `GOMEMLIMIT`;
- the supported pinned Alpine patch/digest at implementation time;
- off-server backup destination, retention, encryption, and alert delivery;
- administrative IPs/subnets, or a documented reason the whitelist is impractical; and
- confirmation that `auto-deploy.sh` remains in operational use. Until confirmed otherwise, it is
  treated as supported and must be updated and tested.

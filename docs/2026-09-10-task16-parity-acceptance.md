# Task 16 PocketBase parity acceptance

## Current status

The test PocketBase rehearsal has completed the CMS migration successfully:

- First migration: 1,622 source records, 869 updated, 753 unchanged, 0 failed.
- Idempotence run: 1,622 source records, 0 created, 0 updated, 1,622 unchanged, 0 failed.
- Gallery sync completed without public PocketBase changes.
- CMS and Uma output validation passed.

The PocketBase Artist collection now contains the migrated editorial fields and
Example attachments. The comparator now emits a bounded, secret-safe diagnostic
report; the remaining summary must be reviewed through that report before it is
accepted as a representation difference.

## Accepted representation differences

These differences must not be treated as data-loss failures:

- NocoDB `CreatedAt` and `UpdatedAt` system metadata are not migrated as
  editorial fields.
- NocoDB `Commissions1` and the null `Commissions` field are inverse/derived
  representations; the PocketBase commission-side `artists` relation is the
  authoritative relationship.
- PocketBase record IDs and file URLs are backend-specific. Comparisons must
  use `legacy_id` and source-file hashes where applicable.
- Empty numeric/date values may be represented as PocketBase zero/empty values
  rather than NocoDB null values.
- Relationship and attachment order must be compared only when order is
  semantically significant.

Real missing records, missing relationships, changed editorial values, or
missing original files remain failures and require investigation.

## Next gate

Before closing Task 16, run the detailed comparator report and record whether
the examples are intentional exclusions or real parity defects. Then run the
full rehearsal gate:

```text
npm test
npm run lint
npm run build
npm run validate:cms
npm run validate:uma
npm run compare:cms
```

The next migration task should use the existing test PocketBase instance and
document the repeatable sync, validation, backup, and rollback procedure. No
production cutover is implied by this acceptance.

## Diagnostic comparator

`site/scripts/migrate/compare-sources.mjs` now emits a bounded diagnostic report
when parity fails. It includes counts and at most 40 representative examples for:

- missing or extra `collection:legacy_id` records;
- field-name and field-value differences;
- relationship collection/target differences;
- original attachment hash and detected-format differences; and
- canonical public JSON file/path differences, including unmapped image URLs.

String values are never printed. Diagnostics report only type, length, and a
12-character SHA-256 prefix; attachment hashes are similarly abbreviated.
Generated image URLs are compared through the existing source-hash map, so
PocketBase record IDs, file names, and backend URL paths do not produce false
public-output differences. A truncated report is explicitly marked as such.

The comparator still treats real editorial, relationship, original-file, and
public-descriptor differences as failures. The local comparison cannot complete
without access to both configured CMS endpoints; the current workstation run
failed during the CMS fetch before a rehearsal snapshot could be diagnosed.

The first rehearsal diagnostic has now isolated the current mismatch:

```text
missingRecords: 0
extraRecords: 1              uma_support_cards:108 on PocketBase
fieldNameDifferences: 0
fieldValueDifferences: 0
relationshipDifferences: 0
attachmentDifferences: 0
publicDifferences: 3
```

The public differences are limited to Uma array lengths: the preserved NocoDB
baseline contains 40 PvP events, 10 scenarios, and 71 support cards, while the
PocketBase rehearsal output contains 43 PvP events, 11 scenarios, and 558
support cards. This is not evidence of a CMS Artist or gallery migration
failure. Before accepting the comparison, verify whether the preserved NocoDB
baseline predates the current Uma source and investigate whether support-card
legacy ID 108 was deleted or omitted from current NocoDB. Do not delete the
PocketBase record automatically; NocoDB remains authoritative.

After removing the blank test-only PocketBase record and regenerating the
PocketBase Uma output, the record-side diagnostic is clean: record, field,
relationship, and attachment difference counts are all zero. The remaining
public differences still show the historical snapshot lengths (40/10/71 on
the left and 558 on the right), even though freshly generated sources are
43/11/557. This proves the comparator's preserved public bundles are stale;
it is not a current CMS or Uma record mismatch. Refresh them into separately
dated comparison bundles, keep the historical baseline untouched, and rerun
the comparator against those new paths.

## Repeatable test-only recovery procedure

Preserve the existing rehearsal database and its backup. For a rehearsal rerun,
restore the backup only into a disposable/test PocketBase instance, run the
idempotent migration twice, then run both source syncs, both validators, the
comparator, and the build. Keep the first migration manifest and comparator
report with the rehearsal evidence. If a rehearsal needs rollback, stop using
that test instance and restore the documented backup into a disposable
instance; do not reset or delete the existing test database and do not change
the live `current` release.

## Task 16B local restore evidence

The 2026-09-10 03:30 UTC automatic backup was verified as a readable complete
PocketBase archive (SHA-256 `8e814c2e7e81ec70114520115e656f2667a5db33b6d2149d33f39c6d6d3ffdb8`)
and restored into a separate rehearsal data directory. A separate read-only,
loopback-only PocketBase container on port 8091 reported healthy while the
active test container on port 8090 remained healthy and untouched.

The restored archive predates the Artist editorial-field migration. Its
comparison therefore shows empty Artist enrichment fields, 204 absent Artist
Example attachments, and the then-present stale Uma support-card placeholder.
This is evidence of backup age, not a restore corruption. To prove current-data
recovery with a local backup, create a new post-migration PocketBase backup,
restore it into another dated disposable path, and repeat the isolated checks.
Off-server-copy proof is explicitly deferred for this rehearsal.

A fresh post-migration local backup was then created as
`task16b-current-1789074468887.zip` (261,618,947 bytes; 2026-09-10
21:07:56 UTC) and restored to a second isolated read-only container on
loopback port 8092. The container became healthy, and the PocketBase gallery
and Uma syncs, both validators, tests, lint, and build completed before the
comparison step. The fresh restore comparison reported zero missing/extra
records and zero field, relationship, or attachment differences. Its only
non-zero result is the existing stale-public-bundle waiver: historical Uma
array lengths of 40/10/71 versus the current 43/11/557 source output (with a
stale right-side bundle still reporting 558 cards).

Task 16B is accepted for the local backup path. Off-server restore proof and
refreshing the dated public comparison bundles remain deferred work before any
production cutover.

## Task 17 freeze record

The editorial freeze began at `2026-09-10T21:14:49Z`. The user is the editor
acknowledgement and rollback owner. The active VPS deployment unit is
`cuddlebuns-auto-deploy.timer` (not the legacy gallery-sync unit named in the
original plan); it was stopped only after confirming NocoDB source selection.
Independent verification confirmed that both the timer and oneshot service are
inactive, the live site returns HTTP 200, and `current` remains
`/var/www/cuddlebuns/releases/20260910-210745`.

## Task 18 frozen NocoDB snapshot

The frozen NocoDB snapshot was captured under
`/var/www/cuddlebuns/rehearsals/task16-20260908T162426Z/task18-20260910T211643Z`.
It contains a PostgreSQL custom-format dump, NocoDB application-data and
attachment archive, protected environment and systemd-unit snapshots, source
revision metadata, and a dated NocoDB public-data baseline with both manifests.
The snapshot is 566 MiB. All recorded archive, manifest, configuration, and
unit-file checksums passed verification after NocoDB-source gallery and Uma
syncs, both validators, and the production build completed. The frozen timer
remained inactive throughout capture.

The earlier pre-edit snapshot at `task18-20260910T211643Z` is superseded by
the verified final snapshot at `task18-refrozen-20260910T215653Z`. Retain the
older snapshot through Task 20 and remove it only after final validation
evidence is recorded.

## Task 19 final migration

Against the refrozen source, the final migration completed with 1,623 source
records and no failures. The subsequent idempotence checks each reported 0
created, 0 updated, and 1,623 unchanged records. This establishes that the
final PocketBase state is converged with the frozen NocoDB source at the
record-migration layer.

## Task 20 final validation

Task 20 completed against the dated final snapshot. The test suite,
integration coverage, lint, NocoDB and PocketBase output generation, both CMS
and Uma validators, frozen-NocoDB-versus-PocketBase comparison, and the
PocketBase production build all passed. SHA-256 verification passed for the
captured PocketBase gallery and Uma manifests under
`task20-pocketbase-public`.

The historical pre-edit Task 18 snapshot is now eligible for removal if space
is needed, but the refrozen Task 18 snapshot and Task 20 evidence must be
retained through cutover and rollback acceptance.

## Task 21 source selection

At `2026-09-10T23:11:01Z`, the VPS runtime environment was switched to
`CMS_SOURCE=pocketbase` while both `cuddlebuns-auto-deploy` units remained
inactive. The prior NocoDB environment was copied to the root-only rollback
file `/etc/cuddlebuns/gallery.env.nocodb-task21-20260910T231101Z`, with a
verified adjacent SHA-256 checksum file. The replacement environment was
validated to use only loopback PocketBase access and the `cms_sync` read-only
identity; it contains neither NocoDB credentials nor PocketBase migration
superuser credentials. No release was deployed as part of this task.

## Task 22 manual PocketBase deployment

After installing the locked dependencies in the production source checkout, a
single manual deployment completed successfully at `2026-09-10T23:50:32Z`.
It atomically activated
`/var/www/cuddlebuns/releases/20260910-235032`. The gallery and Uma syncs,
both output validators, and the Vite production build passed; the live home,
gallery, and Uma routes each returned HTTP 200.

The PocketBase Uma source contains the complete migrated card set, but the
public timeline intentionally publishes only rated/meta cards. The deployment
therefore held back 487 unrated cards and wrote 11 scenarios, 44 PvP events,
and 70 public support cards. This is expected projection behavior, not a
migration or public-data loss. The automated timer remains inactive pending
the remaining post-cutover gates.

## Task 22B temporary migration-superuser removal

The temporary `migration-task16-20260908@cuddlebuns.invalid` PocketBase
superuser was deleted only after additional human superuser accounts were
created and tested for recovery access. Neither `/etc/cuddlebuns/gallery.env`
nor `/etc/cuddlebuns/pocketbase.env` contains a
`POCKETBASE_MIGRATION_` variable. The least-privilege `cms_sync` account
continued to pass both gallery and Uma PocketBase `--check` commands with no
pending public changes. The VPS `masterpyon` SSH/Linux account is independent
of PocketBase superuser records and was not changed.

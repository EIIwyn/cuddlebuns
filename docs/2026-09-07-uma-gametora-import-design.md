# Uma timeline: seed NocoDB from GameTora

Date: 2026-09-07
Status: approved design, awaiting implementation plan
Reference: `docs/reference/gametora-data-sourcing-handoff.md`

## In one paragraph

Today every scenario, PvP event, and support card on `/uma/timeline` is typed into NocoDB by
hand. GameTora publishes the same facts as public JSON: scenario release order and colors,
Champions Meeting dates and race conditions, support card names, types, rarities, and global
release estimates. A new importer script pulls those facts nightly and upserts them into the
three existing NocoDB tables, keyed by a new `gametora_id` column. Admins keep NocoDB as the one
editing surface and keep full ownership of the subjective fields: rating, styles, breakpoints,
and which cards matter for which event. The existing sync, validator, build, and deploy pipeline
is unchanged apart from two small additions to the sync script.

## Goals

- Remove the need to hand-enter scenarios, Champions Meetings, and support card facts.
- Let GameTora's date corrections flow into NocoDB automatically as estimates firm up.
- Keep every human judgement (rating, styles, breakpoints, card-to-event links, custom names)
  untouched by automation.
- Never write to the live tables until an admin has verified the importer against staging copies
  and deliberately repointed it.

## Non-goals

- League of Heroes events. GameTora has no data for them. They stay manual.
- Skills, training events, character cards, races, or any other GameTora dataset.
- Replacing NocoDB. The PocketBase proposal under `docs/superpowers/specs/2026-09-04-*` is
  separate and unapproved; this design assumes NocoDB.
- Uploading images into NocoDB. Thumbnails are handled by the sync at build time.

## Facts verified against GameTora on 2026-09-07

The manifest at `https://gametora.com/data/manifests/umamusume.json` had 275 keys. The datasets
this design depends on, and what was checked:

| Dataset key | Used for | Verified |
| --- | --- | --- |
| `scenarios` | Scenario id, `url_name`, `bg_color`, `name_en` (ids 1 to 5 only; 6 to 14 have only `name_ja`) | 14 records |
| `en/foresight/timeline` | `future_scenarios` (ids 5 to 14 with `display_start`, `is_estimated`); `future_cm` (ids 19 to 47 with `name_en`, `display_start`, `is_estimated`) | 10 scenarios, 29 CMs |
| `events/champions-meeting` | JP record per CM id with `race.{distance,ground,track,turn,condition,season,weather}` and `start`/`end` | 47 records; ids 19 to 22 match the existing NocoDB rows field for field |
| `support-cards` | `support_id`, `char_name`, `type`, `rarity`, `title_en`, `url_name`, `release_en` | 557 records |
| `en/foresight/predicted_releases` | `support_cards[<id>].release_date` for unreleased cards | 312 records |

Domestic track names are not in any GameTora dataset (only foreign tracks appear in
`racetracks_extended`). The importer carries a hardcoded lookup for the seventeen track ids in
`racetracks`, derived from the game's master data. All 26 existing Champions Meeting rows
(CM19 to CM44) were compared against the JP records with these lookups; every id marked `(v)`
appeared in at least one row and agreed with the admin's entry:

```
10001 Sapporo (v)   10002 Hakodate     10003 Niigata (v)   10004 Fukushima    10005 Nakayama (v)
10006 Tokyo (v)     10007 Chukyo (v)   10008 Kyoto (v)     10009 Hanshin (v)  10010 Kokura
10101 Ooi (v)       10103 Kawasaki (v) 10104 Funabashi (v) 10105 Morioka (v)
10201 Longchamp (v) 10202 Santa Anita  10203 Del Mar (v)
```

Enum codes, mapped to the exact option titles of the NocoDB single-select columns and verified
the same way (every code below appeared in at least one of the 26 rows):

```
ground     1 Turf, 2 Dirt
turn       1 Right, 2 Left
condition  1 Firm, 2 Good, 3 Soft, 4 Heavy
season     1 Spring, 2 Summer, 3 Fall, 4 Winter, 5 Spring
weather    1 Sunny, 2 Cloudy, 3 Rain, 4 Snow
```

The current select vocabularies, read from the table metadata on 2026-09-07:

- `racecourse`: Kyoto, Nakayama, Chukyo, Tokyo, Funabashi, Longchamp, Kawasaki, Hanshin, Niigata,
  Ooi, Sapporo, Morioka, Del Mar. Hakodate, Fukushima, Kokura, and Santa Anita are missing and go
  on the admin checklist.
- `direction`: Right, Left, Straight. `season`: Spring, Summer, Fall, Winter.
- `track_condition`: Firm, Good, Heavy, Soft, Random. `weather`: Sunny, Cloudy, Rain, Snow, Random.
- `surface`: Turf, Dirt. `distance_class`: Sprint, Mile, Medium, Long.
- `card_type`: Speed, Wit, Guts, Stamina, Power.

On startup the importer reads each select column's options through the meta endpoint and exits 1
before any write if a value it is about to emit is not an option, naming the column and value.
That turns a vocabulary drift into a clear error instead of a rejected or silently coerced write.

Distance class follows the game's bands: Sprint up to 1400 m, Mile 1401 to 1800, Medium 1801
to 2400, Long 2401 and up.

Support card `type` values are `speed`, `stamina`, `power`, `guts`, `intelligence`, `friend`,
`group`. `intelligence` maps to `Wit`. Cards typed `friend` or `group` are excluded because the
NocoDB `card_type` select has no option for them; the importer reports how many it skipped.

## Architecture

```text
GameTora CDN                       NocoDB (Uma base)                    site build
  manifest + datasets   ------>    scenarios / pvp_events /   ------>   sync-uma-nocodb.mjs
        |                          support_cards                            |
        v                              ^        ^                           v
  .cache/gametora/  (per key+hash)     |        |                    timeline.json
        |                              |   admin edits                      |
        v                              |   (rating, styles, ...)            v
  import-uma-gametora.mjs  ------------+                              validate-uma-output.mjs
  (nightly timer, or manual)
```

The browser still only ever reads `timeline.json`. GameTora is a build-side dependency of the
importer and, for thumbnails only, of the sync.

### Files

New, under `site/scripts/`:

| File | Responsibility | Pure? |
| --- | --- | --- |
| `lib/env.mjs` | `loadEnvironment()` extracted from the sync script, shared | yes |
| `lib/nocodb.mjs` | `fetchAllRecords`, `createRecords`, `updateRecords`, `linkRecords`, `unlinkRecords`, `getTableMeta` against the v3 data API and the v2 meta endpoint | no (network) |
| `gametora/client.mjs` | `loadManifest`, `loadDataset(key)` with disk cache under `.cache/gametora/<key>.<hash>.json`, cache fallback on fetch error, `--no-fetch` support | no (network) |
| `gametora/transform.mjs` | GameTora JSON to candidate rows for the three tables. Lookups above live here. | yes |
| `gametora/plan.mjs` | Given candidate rows and current NocoDB rows, produce a plan: link, create, update, skip, locked, unmatched | yes |
| `import-uma-gametora.mjs` | CLI: wires the above, prints the plan, applies it with `--apply` | no |

Changed:

- `sync-uma-nocodb.mjs` uses `lib/env.mjs` and `lib/nocodb.mjs`, publishes only rated cards,
  fetches GameTora thumbnails when a card has no attachment, and emits `rarity` and `title`.
- `validate-uma-output.mjs` accepts the two new optional string fields.
- `package.json` gains `import:uma` and `import:uma:apply`.
- `.env.example`, `WORKFLOW.md`, `AGENTS.md` document the new variables and commands.
- `vps-scripts/import-uma-gametora.sh` and `vps-scripts/systemd/cuddlebuns-uma-import.{service,timer}`.

The gallery sync script (`sync-nocodb.mjs`) is not touched. Its own copies of the env loader
and fetch helper stay where they are; unifying them is out of scope.

### Configuration

The importer reuses `UMA_NOCODB_URL`, `UMA_NOCODB_TOKEN`, and `UMA_NOCODB_BASE_ID`. Its write
targets come from three new variables and it refuses to start if any is missing:

```
UMA_IMPORT_NOCODB_SCENARIOS_TABLE_ID=
UMA_IMPORT_NOCODB_PVP_EVENTS_TABLE_ID=
UMA_IMPORT_NOCODB_SUPPORT_CARDS_TABLE_ID=
```

The existing `UMA_NOCODB_*_TABLE_ID` variables remain the sync's read targets. During testing
the import variables point at staging copies and the sync variables at either live or staging.
At cutover the admin sets the import variables to the live ids. No equality guard is needed
because the separation is by variable name, and the default mode is a dry run.

Optional: `GAMETORA_USER_AGENT` overrides the default
`Mozilla/5.0 (compatible; cuddlebuns-uma-importer/1.0)`.

### CLI

```
node scripts/import-uma-gametora.mjs            # dry run: fetch, transform, print plan, exit 0
node scripts/import-uma-gametora.mjs --apply    # same, then perform the writes
node scripts/import-uma-gametora.mjs --no-fetch # transform from cache only (offline iteration)
node scripts/import-uma-gametora.mjs --json     # print the plan as JSON instead of a table
```

Exit codes: 0 success or clean dry run, 1 any error that prevented a complete plan or apply.
Partial write failures exit 1 after attempting every planned write, so one bad row does not
block the others and the log names each failure.

## Schema additions

An admin adds these columns by hand. The importer checks for them through the meta endpoint on
startup and exits 1 with the missing column names if any are absent.

| Table | Column | Type | Purpose |
| --- | --- | --- | --- |
| all three | `gametora_id` | Number | Join key. Scenario id, CM id, or `support_id`. |
| `pvp_events` | `racecourse` options | add Hakodate, Fukushima, Kokura, Santa Anita | Tracks GameTora can reference that the select lacks today. |
| all three | `lock_facts` | Checkbox | When checked, the importer skips this row entirely. |
| `pvp_events` | `status` | SingleSelect: `confirmed`, `projected` | The sync already reads this column; today it is absent and every event publishes as `unspecified`. |
| `support_cards` | `rarity` | SingleSelect: `R`, `SR`, `SSR` | Tells two cards of one character and type apart. |
| `support_cards` | `title` | SingleLineText | Card title, for example `[Run Forth! Dash On! Ever Forward!]`. |

Column titles are matched exactly as written above, lowercase with underscores, consistent with
the existing columns.

## Field ownership

Every column on the three tables falls into exactly one tier.

### Fact fields: importer-owned, rewritten each run unless `lock_facts`

| Table | Columns | Source |
| --- | --- | --- |
| `scenarios` | `slug`, `era_start`, `era_end`, `display_color` | `url_name`; `future_scenarios[].display_start` as a UTC date; the next scenario's `era_start`; `bg_color` prefixed with `#` |
| `pvp_events` | `event_number`, `event_type`, `start_date`, `end_date`, `distance_class`, `distance_m`, `racecourse`, `direction`, `season`, `track_condition`, `weather`, `surface`, `status`, `scenario` link | `future_cm[].id`; the constant `Champions Meeting`; `display_start` as a UTC date; start plus the JP record's `(end - start)` rounded to whole days; derived from `distance`; `race.distance`; track lookup; `turn`; `season`; `condition`; `weather`; `ground`; `is_estimated` false becomes `confirmed`, true becomes `projected`; the scenario whose `[era_start, era_end)` contains `start_date` |
| `support_cards` | `character_name`, `card_type`, `rarity`, `title`, `release_date` | `char_name`; `type` mapped; numeric rarity mapped 1 R, 2 SR, 3 SSR; `title_en`; `release_en` if present, else `predicted_releases.support_cards[id].release_date` |

The importer's scenario set is the current scenario plus everything in `future_scenarios`. The
current scenario is the `scenarios` record with the latest `start_en` that is not in the future
(ids are not in global release order: id 4 Trackblazer released before id 3 Grand Live), and its
`era_start` is that `start_en`. Older scenarios are never created. The chain is sorted by
`era_start` before `era_end` is derived.

The last scenario in the chain has no successor and therefore no `era_end`. The sync requires
both dates, so the importer writes `era_end` as `era_start` plus 120 days for the final scenario
only and marks the plan line with a note. When GameTora publishes the next scenario the value is
replaced by the real boundary on the following run. 120 days is the median gap between
consecutive `future_scenarios` entries at the time of writing.

Champions Meetings that `future_cm` lists but the JP table lacks race data for are skipped with
a warning. CM ids in the JP table with no `future_cm` entry (ids 1 to 18, already run on global)
are ignored; historical events are out of scope.

### Seed-once fields: importer writes only when blank, then admin-owned

| Table | Column | Seed value |
| --- | --- | --- |
| `scenarios` | `name` | `name_en`, else `name_en_full`, else `url_name` title-cased with hyphens as spaces |
| `scenarios` | `short_name` | `url_name` with hyphens removed |
| `pvp_events` | `name` | `CM<id> <name_en without trailing " Cup">`, else `CM<id> <distance_class>` when GameTora has no English name yet |
| `pvp_events` | `slug` | `cm<id>` |
| `support_cards` | `name` | `<char_name> <card_type> <rarity>`, for example `Oguri Cap Wit SSR` |
| `support_cards` | `slug` | `url_name` |

Blank means null or whitespace-only.

### Curated fields: never read for decisions, never written

`rating`, `styles`, `breakpoints`, `image`, the `pvp_events` link on cards and its mirror
`support_cards` link on events, and `lock_facts` itself.

## Linking existing rows on first run

Rows already in NocoDB have no `gametora_id`. The plan step links them under narrow rules and
never guesses beyond these:

- `pvp_events`: an unlinked row with `event_type` equal to `Champions Meeting` and a numeric
  `event_number` links to the CM with that id.
- `support_cards`: an unlinked row whose first attachment `title` starts with digits followed by
  a hyphen links to the card with that `support_id`, provided the card's `char_name` equals the
  row's `character_name` case-insensitively. The existing attachments follow this pattern, for
  example `30118-Symboli-Kris-S-stm.png`.
- `scenarios`: never auto-linked. Ten rows are cheap to link by hand.

A candidate that matches no row is a `create`. An existing row that matches no candidate and
has no `gametora_id` is listed as `unmatched` with a best-effort suggestion (the candidate with the
same `character_name` and `card_type`, or the scenario with the nearest `era_start`) so the admin
can set `gametora_id` in NocoDB. Unmatched rows are otherwise untouched, which is how League of
Heroes rows and any admin-only rows survive every run.

If two unlinked rows would link to the same candidate, neither is linked and both are reported.

## Plan and apply

`plan.mjs` produces one entry per candidate or existing row with an action:

| Action | Meaning | Apply |
| --- | --- | --- |
| `create` | No row has this `gametora_id` and no link rule matched | POST with all fact and seed fields |
| `link` | Link rule matched an unlinked row | PATCH `gametora_id`, then treated as `update` |
| `update` | Row exists and at least one fact or blank seed field differs | PATCH only the differing fields |
| `skip` | Row exists and nothing differs | nothing |
| `locked` | `lock_facts` checked | nothing, listed for visibility |
| `unmatched` | Existing unlinked row with no rule match | nothing, listed with suggestion |
| `dropped` | Row has a `gametora_id` GameTora no longer lists | nothing, listed. Never deleted. |

Comparison normalises both sides: dates to `YYYY-MM-DD`, numbers to numbers, text trimmed,
select values as strings, colours lowercased. A run against already-imported data must produce
an all-`skip` plan. This idempotency matters because NocoDB bumps `UpdatedAt` on every write and
the sync's `--check` fingerprint includes it, so a needless PATCH triggers a needless site
rebuild.

The scenario link on events is applied through the v3 links endpoint, which needs the link
field id. The importer reads it once per run from `GET /api/v2/meta/tables/<eventsTableId>`
(the token can read table metadata; this was confirmed). When the derived scenario changes, the
old link is removed and the new one added. Link changes count as an `update`.

Writes go through `lib/nocodb.mjs` in batches. The v3 data API accepts arrays for POST and
PATCH; the batch size is a constant set during implementation after checking the installed
NocoDB version's limit. Attachments cannot be written through this API, which is fine because
the importer never writes images.

Order of apply: scenarios, then events (so the scenario link targets exist), then cards.
Within a table: links, creates, updates.

## Sync script changes

1. **Publish only rated cards.** A support card row is emitted only when `rating` is non-empty.
   The log prints how many rows were held back. Existing behaviour for `styles`, `breakpoints`,
   and `eventIds` is unchanged.
2. **GameTora thumbnails.** When a card has no attachment and has a `gametora_id`, the sync
   downloads `https://gametora.com/images/umamusume/supports/support_card_s_<id>.png`, caches
   the bytes under `.cache/uma/gametora-thumbs/<id>.png`, and runs the existing sharp pipeline.
   The manifest entry is keyed `gametora:<id>` with the signature being the id, since the URL
   is stable. If the download fails and no cache exists, the card publishes with `image: null`
   and a warning, exactly as a card with no attachment does today. An attachment always wins.
3. **New public fields.** `rarity` and `title` are added to each card as strings or null.
   `gametoraId` is not published. `schemaVersion` stays 1 because the change is additive, and
   `api.js` is unchanged. The validator checks the two new fields are strings when present.

## Error handling

| Situation | Behaviour |
| --- | --- |
| Manifest fetch fails | Use cached manifest with a warning; exit 1 if none |
| Dataset fetch fails | Use cached copy for that key with a warning; exit 1 if none |
| Key missing from manifest | Skip that dataset with a warning; dependent candidates are dropped from the plan |
| Candidate fails validation (missing date, unknown track id, unknown enum) | Skipped and reported; never written half-configured |
| Required column missing in NocoDB | Exit 1 before any write, listing the columns |
| NocoDB read fails | Exit 1, no writes |
| One write in a batch fails | Log it, continue with remaining writes, exit 1 at the end |
| `--apply` without the import table ids | Exit 1 with the missing variable names |

The importer never deletes rows, never writes curated columns, and never writes attachments.

## Testing

Unit tests use `node:test` and live under `site/scripts/__tests__/`. Fixture files are trimmed
copies of the GameTora datasets captured on 2026-09-07, small enough to read: three scenarios,
five CMs including one unnamed and one with a foreign track, and eight support cards covering
each type, one `friend`, one without any global date, and one already released.

- `transform.test.mjs`: track and enum lookups, distance class bands, `era_end` chaining and the
  final-scenario fallback, scenario assignment by date, name seeding for named and unnamed CMs,
  card type and rarity mapping, exclusion of friend and group cards, exclusion of cards with no
  global date, UTC date conversion of `display_start`.
- `plan.test.mjs`: each action in the table above, the two linking rules including the
  character-name guard and the duplicate-candidate case, locked rows, dropped rows, field-level
  diffing so only changed fields are patched, and the idempotency case where planning against
  the output of a previous apply yields only `skip`.
- `nocodb.test.mjs`: pagination and batching against a stubbed `fetch`.

Integration, done by hand with the admin:

1. Admin duplicates the three tables in the Uma base as staging copies with data, adds the
   columns from the checklist, and puts the staging ids in `UMA_IMPORT_NOCODB_*`.
2. `npm run import:uma` prints the plan. Expected on first run: events 19 to 44 as `link`,
   45 to 47 as `create`, most cards as `link`, League of Heroes rows as `unmatched`, scenarios
   as `unmatched` with suggestions. Admin sets scenario ids by hand.
3. `npm run import:uma:apply`, then `npm run import:uma` again must be all `skip`.
4. Point `UMA_NOCODB_*_TABLE_ID` at the staging ids, run `npm run sync:uma` and
   `npm run validate:uma`, open `/uma/timeline` in `npm run dev`, and compare with the live site.
5. Repoint the sync at live. The staging tables stay until cutover.

## Rollout

1. Land the code with the import variables absent from the VPS env, so nothing runs there.
2. Admin completes the integration steps above against staging.
3. Admin repoints `UMA_IMPORT_NOCODB_*` at the live table ids in `/etc/cuddlebuns/gallery.env`
   after adding the same columns to the live tables, and runs one manual `--apply`.
4. Install the systemd timer. It runs `vps-scripts/import-uma-gametora.sh` daily at 23:30 UTC,
   which runs the importer with `--apply` from the existing checkout. The existing five-minute
   sync timer picks up the resulting NocoDB changes on its next tick. A `concurrency`-style
   guard is unnecessary because systemd serialises a service against itself, and the two
   timers touch different resources (NocoDB versus the release directory).
5. Admin drops the staging tables.

## Open points settled during design

- GameTora's estimates differ from the dates already entered (CM19 is entered as 2026-09-17 and
  estimated as 2026-09-20). Under the merge rule the estimate wins on the first apply unless the
  admin checks `lock_facts` on that row first. The integration plan output makes every such
  change visible before it happens.
- `display_start` values carry odd times of day. They are converted to a UTC calendar date. If
  the admin finds a consistent one-day skew against in-game announcements, the fix is a single
  timezone constant in `transform.mjs`.
- Two existing rows disagree with GameTora in ways the mapping cannot explain: CM44 is entered as
  Dirt where the JP record says Turf (`ground` 1, the same code that yields Turf on 24 other rows),
  and CM43 is entered with a nine-day window where every JP record spans six days. The first apply
  will overwrite both and the dry-run plan will show it; the admin should check `lock_facts` on
  CM44 first if their source is better.
- Scenario names for ids 6 to 14 have no English text on GameTora. The seed-once rule means the
  existing hand-entered names survive linking, and new scenarios get a title-cased slug the
  admin can rename once.

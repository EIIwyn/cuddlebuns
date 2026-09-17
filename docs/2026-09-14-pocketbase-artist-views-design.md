# PocketBase Artist Views and Gallery Workspace

Date: 2026-09-14
Status: In progress

Current implementation handoff: `docs/2026-09-16-pocketbase-artist-views-progress.md`

## Intent

Create an editorial workspace for the `artists` collection that feels closer to the useful
parts of the current NocoDB setup:

- separate, easy-to-scan artist categories;
- saved filters and counts for editorial workflow; and
- a gallery view that puts the artist name, pricing, availability, and example artwork together.

The primary user journey is: discover an artist on a supported website, capture them quickly,
review them later, then choose an artist when planning a new commission. The workspace should
optimize that loop rather than behave like a generic database browser.

This is an internal tool. It must not expose PocketBase credentials or make the public React site
talk directly to PocketBase. The existing sync still produces the public static gallery.

## Current data to preserve

The existing PocketBase `artists` collection already contains the fields required for a first
version:

| Purpose | PocketBase fields |
| --- | --- |
| Identity | `artist_name`, `url` |
| Workflow | `status`, `date_added`, `notes` |
| Offering | `commission_subject`, `price_jpy`, `price_usd`, `price_bracket` |
| Visual preview | protected `example` file, maximum two images |
| Usage | inverse `commissions.artists` relation |

`artist_name` is the current canonical field name. The old `legacy_id` is migration history and
must not be used as the UI ordering key now that it has been removed from the live schema.

## Observed workflow

### Intake from the web

The current Tampermonkey bookmarklet is used on sites such as Skeb, VGen, and Pipipen. It opens an
Artist Tracker form and captures, or allows entry of:

- artist name and source URL;
- initial status, usually Candidate or Reserve;
- date added;
- currency and price;
- notes describing style, commission ideas, or useful descriptors; and
- duplicate-check and re-scan actions before saving.

The normal intake action must stay fast. Example images are often added later manually, so a
missing example is an actionable review state rather than a reason to reject the intake.

The editor should preserve the bookmarklet’s duplicate-check behavior. A duplicate should be
identified using a normalized source URL and a normalized artist identity, with a visible warning
and a link to the existing record. It must not silently create a second artist.

### Editorial states

- **Candidate** is the active review queue and the main place to look when planning a new
  commission.
- **Reserve** contains artists worth keeping for a future possibility but not actively considering
  now.
- **Worked** means a commission has already been completed with the artist, or work has begun.
- **Assigned** is an optional state for an artist currently selected for a commission. It is useful
  to retain for compatibility, but it is not a primary workflow queue today.

The implementation should not infer Worked or Assigned from free-form notes. If the user wants
those states to be automatic later, that should be an explicit rule based on a commission lifecycle
field, not a hidden side effect of linking records.

### Review and selection

When planning a commission, the desired flow is:

1. Open Candidate artists.
2. See examples and notes without opening every record.
3. Narrow by price bracket, exact price/currency, and commission subject.
4. Open the artist URL or detail record for final review.
5. Optionally change the status to Assigned, then later Worked.

The same experience should work for Reserve and Worked, but Candidate should be the default view.

## Decisions captured so far

- The workspace is primarily internal. A future public-facing Worked-artist directory is a
  secondary feature and must not complicate the internal review MVP.
- The existing bookmarklet remains the intake interface; the workspace does not need to replace it.
- `Assigned` remains available but is a low-frequency, optional state.
- Example images are manually uploaded to PocketBase for now. A later bookmarklet enhancement may
  check the artist and assist with example handling.
- Missing examples are flagged as `Needs example`; they do not prevent an artist from being a
  Candidate.
- Artist cards use only curated `example` images, not commission images.
- Original quoted currency and amount must be preserved. Price brackets continue to be captured by
  the bookmarklet rather than calculated by the workspace.
- Notes should support both quick card editing and full editing in a detail view.
- PocketBase changes should be immediately available to the editorial workspace. Public-facing
  output can continue to publish on the next scheduled sync.
- The initial permission model is one editor account with full permissions. A read-only viewer
  account may be added later, but viewer access to private notes must be deliberate.
- The workspace lives in this React repository on the `cms.cuddlebuns.moe` host at `/editor`.
  `/gallery` on the CMS host redirects there; `/editor` is also the local/development route. The CMS host serves the React release while
  forwarding PocketBase’s `/api/*` and `/_/*` paths to the PocketBase service.

## Proposed artist views

Use one artist collection and multiple saved views rather than separate collections. This keeps
relations, deduplication, and editorial updates simple.

### Workflow views

| View | Filter | Sort | Purpose |
| --- | --- | --- | --- |
| Candidates | `status = "Candidate"` | `date_added desc`, `artist_name asc` | New artists awaiting review; default |
| Reserve | `status = "Reserve"` | `artist_name asc` | Viable artists not currently prioritized |
| Worked | `status = "Worked"` | latest linked commission desc, `artist_name asc` | Artists already used |
| Assigned | `status = "Assigned"` | `date_added desc`, `artist_name asc` | Optional active-commission queue |
| Needs review | missing status, missing URL, or missing example | `date_added asc`, `artist_name asc` | Cleanup queue |
| All artists | no filter | `artist_name asc` | Complete directory |

The exact status vocabulary should remain a controlled application-level set. If more statuses are
needed later, add them deliberately and update the view definitions and validation together.

### Optional commercial views

These can be added after the workflow views prove useful:

- Affordable / Balanced / Premium, based on `price_bracket`;
- by commission subject, using `commission_subject`;
- no example artwork;
- no linked commissions; and
- recently added, for intake review.

These are facets of the same directory, not new data categories.

### Nested category view

The category view should mirror the useful structure in the second reference image:

```text
Candidate (count)
  Affordable (count)  -> artist cards
  Balanced (count)    -> artist cards
  Premium (count)     -> artist cards
  Upscale (count)     -> artist cards
  Empty / unclassified (count) -> artist cards
Reserve (count)
  ...
Worked (count)
  ...
```

Status groups can be collapsed independently. Price groups should show counts even when collapsed,
and the card grid should appear only after expanding a group. The exact bracket labels should come
from stored data rather than being hard-coded to only three values.

## Gallery card design

The gallery view should use a responsive card grid. Each card contains:

1. the first `example` image as the cover, with a second example available in a small gallery or
   lightbox;
2. artist name as the primary title;
3. status badge;
4. price bracket, plus the source currency/price and normalized JPY/USD values when present;
5. commission subjects as compact tags;
6. a short, readable Notes preview with truncation and an expand action;
7. linked commission count; and
8. actions for opening the record, visiting the artist URL, adding/replacing examples, and moving
   the artist between workflow
   statuses.

Cards without an example use a neutral placeholder and remain visible in the cleanup view. Missing
artwork should be legible as missing data, not silently mistaken for a broken image.

The card should not display private `notes` by default. Notes belong in the record detail/edit view.
Protected PocketBase files should be requested only after the authenticated workspace has loaded a
card that needs them; no file URL should be persisted in client storage.

## Intake and pricing additions

The current collection stores `price_jpy` and `price_usd`, but the bookmarklet workflow also has a
source currency and source price. Before implementing the editor, decide whether to add explicit
fields such as `price_amount` and `price_currency`. This avoids losing the original quoted price
or confusing a converted estimate with the artist’s actual price.

The workspace should display:

- original quoted amount and currency;
- converted values, if available, labeled as estimates;
- the manually curated `price_bracket`; and
- the date or exchange-rate context for any conversion that is persisted.

Price conversion should not silently overwrite the source quote. If conversion is only a review
convenience, it may remain a client-side display calculation and not become part of public output.

## Recommended architecture

Build a separate authenticated editorial workspace rather than modifying the public static routes.
The likely shape is:

```text
editorial browser
    -> authenticated PocketBase API
    -> artists + commissions collections

public site build
    -> sync script
    -> generated static JSON/images
```

The workspace may live in the existing Vite app behind an `/admin` route if deployment and
authentication can be isolated safely. A separate small app is preferable if the public bundle
should never contain admin code or PocketBase configuration. In either case:

- authentication uses a dedicated PocketBase auth collection or an explicitly scoped editor account;
- PocketBase write permissions are limited to the editor role;
- protected example files remain protected;
- the public sync remains the only publisher to `public/data/cms/**`; and
- mutations invalidate or trigger the existing sync/deploy process rather than changing public
  JSON in the browser.

The bookmarklet should use a small authenticated intake API or a narrowly scoped PocketBase write
client. It should not receive a superuser credential. Its minimum operations are duplicate lookup,
artist create, and artist update for the intake-owned fields. Example upload can remain a later
editor action until the protected-file upload flow is proven.

The first editor release can read and write PocketBase directly from the authenticated `/editor`
route, subject to PocketBase rules and protected-file handling. Public sync remains separate, so an
editorial save is immediately visible in `/editor` without implying that the public site has been
rebuilt.

## Commission-driven Worked status

An artist should not become Worked merely because a commission relation exists: a draft or planned
commission may already have an artist relation. The safer automatic rule is:

```text
commission linked to artist + commission lifecycle is started or completed
    -> artist may be promoted to Worked
```

This requires an explicit commission lifecycle/status field if the current `commissions` schema
does not distinguish planned, started, and completed work. Until that field exists, keep Worked
manual and show a “linked commission” signal in the workspace. Any automatic promotion should be
auditable and should never overwrite a deliberate later status without confirmation.

Do not try to encode saved views as PocketBase schema migrations. They are editorial UI/query
configuration and should be versioned as application data or code.

## Delivery phases

### Phase 1: Intake and review prototype

- Define the bookmarklet-to-PocketBase intake payload and duplicate rules.
- Authenticate an editor or intake client with least privilege.
- Preserve the fast intake form, including source currency/price and notes.
- List Candidate artists with pagination and stable sorting.
- Load protected example thumbnails and show Notes previews.
- Show Candidate counts and an empty state for missing examples.

### Phase 2: Record detail and safe edits

- Add detail drawer/page with all fields, including private notes.
- Implement status and price-bracket changes, including optional Assigned.
- Edit pricing, subjects, URL, notes, and example files.
- Confirm destructive or high-impact changes.
- Add optimistic UI only where failure rollback is straightforward.

### Phase 3: Relationship-aware gallery

- Implement the nested Status → Price Bracket view with counts.
- Add Reserve, Worked, Assigned, Needs Review, and All Artists filters.
- Load linked commission count and a small set of recent commission previews.
- Add filters for subject and price bracket.
- Add a card lightbox for multiple examples.
- Add missing-data diagnostics and bulk review navigation.

### Phase 4: Publisher integration

- Define how an editor save requests or schedules a sync.
- Show last sync/build status in the workspace.
- Add an explicit preview/draft boundary if editorial changes should not publish immediately.
- Verify output with `validate:cms` and the existing public build before deployment.

## Decisions to make before implementation

1. What commission lifecycle values should distinguish planned, started, and completed work?
2. Should automatic Worked promotion be opt-in per commission, or happen for every started/completed
   commission?
3. Should the editor be called `/editor`, `/artists`, or something less discoverable under the CMS
   host?
4. Should a future viewer account see private Notes, or only the artist cards and examples?
5. Should the bookmarklet eventually upload an example automatically, or only perform duplicate
   lookup and open the existing editor record for manual upload?

## MVP acceptance criteria

- An editor can switch between the workflow views without rebuilding the public site.
- The bookmarklet can create or update an artist without creating silent duplicates.
- Each status and price-bracket group shows an accurate count and deterministic ordering.
- Artist cards show example artwork, Notes, status, pricing, subjects, and linked commission count.
- Missing examples and incomplete records are discoverable.
- Private notes and protected file URLs do not enter public JSON, logs, or browser storage.
- A PocketBase edit can be synchronized and validated through the existing CMS pipeline.
- The public `/gallery` route and its generated JSON contract remain unchanged.

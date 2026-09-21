# PocketBase Artist Workspace — Implementation Progress

Date: 2026-09-16
Related design: `docs/2026-09-14-pocketbase-artist-views-design.md`

This document is a handoff for continued work in another terminal or VS Code session.

## Current product surface

The React workspace is available locally at:

```text
http://localhost:5173/editor
```

The intended production route is:

```text
https://cms.cuddlebuns.moe/editor
```

The public gallery remains:

```text
https://cuddlebuns.moe/gallery
```

## Completed

### Artist workspace

`site/src/pages/ArtistWorkspace.jsx` currently provides:

- `users` auth-collection login;
- paginated loading of all Artists and Commissions;
- status tabs for All, Candidate, Reserve, Worked, and Assigned;
- accurate status counts after pagination;
- artist and notes search;
- price-bracket filtering;
- Needs Example filtering;
- artist cards with status, price, subjects, notes, URL, and upload action;
- protected-file token acquisition for PocketBase images;
- protected Example uploads through multipart `PATCH`;
- editable Artist detail drawer with save/cancel/error states for status, URL, pricing, price
  bracket, subjects, and notes;
- image lightbox with Escape, close, and multi-image navigation; and
- Worked cards that use the most recent linked commission image as the thumbnail.

For Candidate, Reserve, and Assigned, the thumbnail comes from the artist `example` field. For
Worked, the latest linked commission image is preferred, then the artist Example image, then the
Needs Example placeholder.

### PocketBase access

`cms_sync` remains the automated sync identity. Human editor login uses the existing `users` auth
collection. The migration file:

```text
vps-scripts/pocketbase/pb_migrations/1789200000_add_cms_editor_access.js
```

adds `users` list/view access to gallery collections and `users` update access for artist/example
uploads. It intentionally does not create or delete the existing `users` collection.

Required gallery rules for human editor access:

```text
List/View:
@request.auth.collectionName = "cms_sync" || @request.auth.collectionName = "users"

Update:
@request.auth.collectionName = "users"
```

Create and Delete remain locked.

The detail drawer uses `PATCH /api/collections/artists/records/:id` with JSON fields. It does not
create or delete records. The existing Example upload continues to use multipart `PATCH`.

### Caddy

`cuddlebuns.caddy` currently has a CMS-host exception intended to serve the React release for
`/editor` and `/static/*`, while sending all other CMS requests to PocketBase. The relevant shape
is:

```caddy
@editor path /editor /editor/*
handle @editor { ... /var/www/cuddlebuns/current ... }
handle /static/* { ... /var/www/cuddlebuns/current ... }
reverse_proxy 127.0.0.1:8090 { ... }
```

Validate the deployed Caddyfile before reload. PocketBase admin remains at `/_/` and API requests
remain under `/api/*`.

## Validation currently passing

Run from `site/`:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd test
```

The test suite currently reports 120 passing tests and one skipped disposable-container integration
test. The Caddy config test is included in `npm test`.

## Known deployment caveats

1. The `users` permission migration must be present in the deployed PocketBase migrations and
   applied before `/editor` can list Artists/Commissions as a human user.
2. A stale browser auth token can produce a PocketBase authorization error. Sign out and sign in
   again after changing the auth collection or permissions.
3. The Caddy `/editor` routing change must be deployed and validated independently of the PocketBase
   migration.
4. The current migration filename still contains `cms_editor` for historical development reasons;
   do not rename or edit an already-applied migration without adding a safe follow-up migration.

## Not implemented yet

- Nested expandable Status → Price Bracket groups with counts;
- record detail drawer/page;
- editing notes, statuses, prices, subjects, or URLs;
- bookmarklet duplicate lookup/intake integration;
- automatic Worked promotion based on commission lifecycle;
- viewer/editor roles;
- explicit public publish/sync status;
- richer recent-commission previews or counts; and
- public Worked artist surfaces.

## Recommended next sequence

### Next 1: Verify production access

- Deploy the React build and Caddy change.
- Apply the PocketBase users-permission migration.
- Confirm a `users` account can list Artists and Commissions.
- Upload one test Example and verify the protected file loads after refresh.

### Next 2: Extend safe record editing

- Add protected Example management inside the detail drawer, including replacement/removal
  confirmation.
- Add field-level validation and dirty-state warnings.
- Keep artist creation and deletion out of the first editor mutation pass.
- Add explicit success/error feedback and reload the record after save.

### Next 3: Add the planned grouped view

- Keep the current tabs as quick filters.
- Add expandable Status groups containing Price Bracket groups.
- Render the same cards inside expanded leaf groups.
- Preserve deterministic ordering and counts.

### Next 4: Connect the bookmarklet workflow

- Document the existing bookmarklet payload and duplicate behavior first.
- Add a least-privilege duplicate lookup/update path.
- Do not put PocketBase superuser credentials in the bookmarklet or browser bundle.

## Important architectural boundary

The editor reads and writes PocketBase at runtime. The public site remains generated static output.
An editor save should be immediately visible in `/editor`, but public JSON/images continue to update
through the existing sync/build/deploy pipeline.

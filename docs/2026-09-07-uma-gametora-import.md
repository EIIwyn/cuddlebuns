# Uma GameTora Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks tagged [ops] need a human with NocoDB or VPS access; stop and hand over when you reach one.

**Goal:** A nightly importer that seeds and refreshes the three Uma NocoDB tables (scenarios, pvp_events, support_cards) from GameTora's public JSON, plus the small sync changes that publish the result.

**Architecture:** A pure transform turns GameTora datasets into candidate rows; a pure planner diffs them against current NocoDB rows into create/link/update/skip actions; a thin CLI wires a cached GameTora client and a NocoDB client around them and only writes with `--apply`. The existing sync keeps producing `timeline.json`, gaining rated-only publishing, GameTora thumbnails, and two new card fields.

**Tech Stack:** Node 22+ (`node:test`, `node:fs`, built-in `fetch`), sharp (already a devDependency), NocoDB Data API v3 and Meta API v2, systemd.

**Spec:** `docs/2026-09-07-uma-gametora-import-design.md` (tracked copy; identical working copy at `docs/superpowers/specs/2026-09-07-uma-gametora-import-design.md`). Read it first. Every table, enum, and rule below is copied from it.

## Global Constraints

- All npm commands run from `site/`. On Windows PowerShell use `npm.cmd`.
- The `.env.local` credentials point at the LIVE NocoDB base. Never write to any table named by `UMA_NOCODB_*_TABLE_ID`. The importer writes only to tables named by `UMA_IMPORT_NOCODB_SCENARIOS_TABLE_ID`, `UMA_IMPORT_NOCODB_PVP_EVENTS_TABLE_ID`, `UMA_IMPORT_NOCODB_SUPPORT_CARDS_TABLE_ID`, and only with `--apply`. Until Task 13 [ops] those variables are absent, so every run is a dry run.
- Tokens (`UMA_NOCODB_TOKEN`) are never prefixed `VITE_`, never committed, never referenced from `site/src/`.
- Public output shape: `timeline.json` keeps `schemaVersion: 1`. Additions are `rarity` and `title` on cards (string or null). `gametoraId` is never published. `api.js` is unchanged.
- The importer never deletes rows, never writes `rating`, `styles`, `breakpoints`, `image`, `pvp_events`/`support_cards` links, or `lock_facts`, and never writes attachments.
- Column titles are exact: `gametora_id`, `lock_facts`, `status`, `rarity`, `title`, plus the existing lowercase snake_case columns.
- Select vocabularies (exact option titles): racecourse per the track table; direction `Right`/`Left`; season `Spring`/`Summer`/`Fall`/`Winter`; track_condition `Firm`/`Good`/`Soft`/`Heavy`; weather `Sunny`/`Cloudy`/`Rain`/`Snow`; surface `Turf`/`Dirt`; distance_class `Sprint`/`Mile`/`Medium`/`Long`; card_type `Speed`/`Stamina`/`Power`/`Guts`/`Wit`/`Friend`/`Group`; rarity `R`/`SR`/`SSR`; status `confirmed`/`projected`.
- NocoDB v3 batch size is 10 records per POST or PATCH request.
- A plan run against already-imported data must be all `skip`. Every write bumps `UpdatedAt`, which the sync fingerprints, which triggers a site rebuild.
- Tests use `node:test` under `site/scripts/__tests__/` and run with `npm test`. Tests use small inline records shaped like the GameTora fields named in the spec, not captured fixture files (deviation from the spec's fixture paragraph, chosen so date assertions are explicit rather than copied from live estimates).
- `.mjs` files are not matched by the ESLint config (`**/*.{js,jsx}`), so `npm run lint` does not cover scripts. Keep the existing style anyway: 2-space indent, single quotes, semicolons, `node:` import prefixes.
- Commit after every task with the message shown. Never commit `.env.local`, `.cache/`, `public/data/`, or `public/generated/`.

---

## File Structure

New files under `site/scripts/`:

| File | Responsibility |
| --- | --- |
| `lib/env.mjs` | `SITE_DIR` and `loadEnvironment()`: read `.env.local` into `process.env` without overriding existing values. Pure apart from file read. |
| `lib/nocodb.mjs` | `createNocodbClient(config)` returning `fetchAllRecords`, `getTableMeta`, `createRecords`, `updateRecords`, `linkRecords`, `unlinkRecords`. All network calls go through an injectable `fetchImpl`. |
| `gametora/client.mjs` | `createGametoraClient(options)` returning `loadManifest()` and `loadDataset(manifest, key)` with a disk cache and cache fallback. |
| `gametora/transform.mjs` | Lookup tables and three pure functions: `transformScenarios`, `transformEvents`, `transformSupportCards`. Output is candidate rows. |
| `gametora/plan.mjs` | `normalizeValue`, `buildPlan`. Pure diff of candidates against existing NocoDB records. |
| `import-uma-gametora.mjs` | CLI: config, schema and vocabulary check, fetch, transform, plan, print, apply. |
| `__tests__/env.test.mjs`, `nocodb.test.mjs`, `gametora-client.test.mjs`, `transform.test.mjs`, `plan.test.mjs` | Unit tests. |

Modified:

| File | Change |
| --- | --- |
| `scripts/sync-uma-nocodb.mjs` | Use `lib/env.mjs` and `lib/nocodb.mjs`; rated-only publishing; GameTora thumbnails; emit `rarity`, `title`. |
| `scripts/validate-uma-output.mjs` | Accept `rarity` and `title`. |
| `package.json` | `test`, `import:uma`, `import:uma:apply` scripts. |
| `.env.example`, `WORKFLOW.md`, `../AGENTS.md` | Document variables, commands, admin checklist, cutover. |
| `../vps-scripts/import-uma-gametora.sh`, `../vps-scripts/systemd/cuddlebuns-uma-import.service`, `.timer` | Nightly run. |

### Shared data shapes (used by Tasks 5 through 9)

A **candidate row** produced by the transform and consumed by the planner:

```js
{
  gametoraId: 19,                       // number
  label: 'CM19 Scorpio',                // for log lines only
  facts: { event_number: 19, start_date: '2026-09-20', /* ...column: value */ },
  seeds: {
    name: { value: 'CM19 Scorpio', alternatives: [] },
    slug: { value: 'cm19', alternatives: [] },
  },
  // events only: which scenario this belongs to, by GameTora scenario id
  scenarioGametoraId: 3,                // or null
  note: 'era_end estimated (+120 days)' // optional, shown in the plan
}
```

`seeds[col].alternatives` lists lower-tier seed values. The planner writes `value` when the current cell is blank, or when the current cell equals one of `alternatives` (the "still provisional" rule). Otherwise the cell is left alone. Only scenario `name` uses alternatives.

A **plan entry** produced by the planner and consumed by the CLI:

```js
{
  action: 'create' | 'link' | 'update' | 'skip' | 'locked' | 'unmatched' | 'dropped',
  gametoraId: 19,            // null for unmatched
  recordId: '7',             // NocoDB record id as string; null for create
  label: 'CM19 Scorpio',
  changes: { start_date: { from: '2026-09-17', to: '2026-09-20' } },   // {} when none
  link: { field: 'scenario', from: '1', to: '3' } | null,             // events only
  suggestion: 'gametora_id 30146 (Oguri Cap / Wit)' | null,           // unmatched only
  note: '...' | null,
}
```

---

### Task 1: Shared environment loader

**Files:**
- Create: `site/scripts/lib/env.mjs`
- Create: `site/scripts/__tests__/env.test.mjs`
- Modify: `site/scripts/sync-uma-nocodb.mjs:6-27` (remove local `SITE_DIR` and `loadEnvironment`, import them)
- Modify: `site/package.json` (add `test` script)

**Interfaces:**
- Produces: `export const SITE_DIR` (absolute path of `site/`), `export function loadEnvironment({ envFile = path.join(SITE_DIR, '.env.local'), env = process.env } = {})` which returns `env` after filling keys that are not already set.

- [ ] **Step 1: Add the test script to package.json**

In `site/package.json` `scripts`, add:

```json
"test": "node --test scripts/__tests__/",
```

- [ ] **Step 2: Write the failing test**

Create `site/scripts/__tests__/env.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvironment, SITE_DIR } from '../lib/env.mjs';

function tempEnvFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-env-'));
  const file = path.join(dir, '.env.local');
  fs.writeFileSync(file, contents);
  return file;
}

test('SITE_DIR points at the site directory', () => {
  assert.ok(fs.existsSync(path.join(SITE_DIR, 'package.json')));
});

test('loadEnvironment fills missing keys, strips quotes, skips comments and blanks', () => {
  const file = tempEnvFile('# comment\n\nA=1\nB="two"\nC=\'three\'\nNOEQUALS\n=nokey\n');
  const env = loadEnvironment({ envFile: file, env: {} });
  assert.deepEqual(env, { A: '1', B: 'two', C: 'three' });
});

test('loadEnvironment never overrides an existing value', () => {
  const file = tempEnvFile('A=file\n');
  const env = loadEnvironment({ envFile: file, env: { A: 'shell' } });
  assert.equal(env.A, 'shell');
});

test('loadEnvironment is a no-op when the file is missing', () => {
  const env = loadEnvironment({ envFile: path.join(os.tmpdir(), 'does-not-exist.env'), env: { X: '1' } });
  assert.deepEqual(env, { X: '1' });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run from `site/`: `npm test`
Expected: FAIL, `Cannot find module '../lib/env.mjs'`.

- [ ] **Step 4: Create the module**

Create `site/scripts/lib/env.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';

export const SITE_DIR = path.resolve(import.meta.dirname, '..', '..');

export function loadEnvironment({ envFile = path.join(SITE_DIR, '.env.local'), env = process.env } = {}) {
  if (!fs.existsSync(envFile)) return env;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!env[key]) env[key] = value;
  }
  return env;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: 4 passing.

- [ ] **Step 6: Point the sync script at the shared loader**

In `site/scripts/sync-uma-nocodb.mjs`, delete the `const SITE_DIR = ...` line and the whole local `function loadEnvironment() { ... }` (lines 6 and 15 to 27 in the current file), and add after the `sharp` import:

```js
import { SITE_DIR, loadEnvironment } from './lib/env.mjs';
```

The call `loadEnvironment();` inside `main()` stays as is.

- [ ] **Step 7: Verify the sync still runs in check mode**

Run: `npm run sync:uma:check`
Expected: prints `No public Uma NocoDB changes detected.` or `Public Uma NocoDB changes detected.` and exits 0 or 10. Any other exit code means the refactor broke something. This reads the live base, which is allowed.

- [ ] **Step 8: Commit**

```bash
git add site/package.json site/scripts/lib/env.mjs site/scripts/__tests__/env.test.mjs site/scripts/sync-uma-nocodb.mjs
git commit -m "Extract shared .env.local loader for Uma scripts"
```

---

### Task 2: NocoDB client

**Files:**
- Create: `site/scripts/lib/nocodb.mjs`
- Create: `site/scripts/__tests__/nocodb.test.mjs`
- Modify: `site/scripts/sync-uma-nocodb.mjs` (replace local `fetchTable` with the client)

**Interfaces:**
- Produces:
  - `export const BATCH_SIZE = 10`
  - `export function createNocodbClient({ url, token, baseId, fetchImpl = globalThis.fetch, timeoutMs = 120_000 })` returning an object with:
    - `fetchAllRecords(tableId, label)` → `Promise<Array<{ id: string, fields: object }>>`, follows `next` pagination, `linksAsLtar=true`, `pageSize=100`.
    - `getTableMeta(tableId)` → `Promise<{ columns: Array<{ id, title, uidt, options: string[] | null }> }>` (v2 meta; `options` is the select option titles or null).
    - `createRecords(tableId, fieldsList)` → `Promise<Array<{ id: string }>>` in input order, batched by 10.
    - `updateRecords(tableId, updates)` where `updates` is `Array<{ id, fields }>` → `Promise<void>`, batched by 10.
    - `linkRecords(tableId, linkFieldId, recordId, targetIds)` and `unlinkRecords(...)` → `Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `site/scripts/__tests__/nocodb.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_SIZE, createNocodbClient } from '../lib/nocodb.mjs';

function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers };
    calls.push(call);
    const result = handler(call, calls.length);
    return { ok: true, status: 200, statusText: 'OK', json: async () => result };
  };
  return { fetchImpl, calls };
}

const config = { url: 'https://noco.example/', token: 'tok', baseId: 'base1' };

test('fetchAllRecords follows next links and rebases them on the configured URL', async () => {
  const { fetchImpl, calls } = stubFetch((call, n) => (n === 1
    ? { records: [{ id: 1, fields: { name: 'a' } }], next: 'https://internal.host/api/v3/data/base1/t1/records?page=2' }
    : { records: [{ id: 2, fields: { name: 'b' } }], next: null }));
  const client = createNocodbClient({ ...config, fetchImpl });
  const records = await client.fetchAllRecords('t1', 'things');
  assert.deepEqual(records.map((r) => r.id), ['1', '2']);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.startsWith('https://noco.example/api/v3/data/base1/t1/records?'));
  assert.ok(calls[0].url.includes('linksAsLtar=true'));
  assert.ok(calls[1].url.startsWith('https://noco.example/api/v3/data/base1/t1/records?page=2'));
  assert.equal(calls[0].headers['xc-token'], 'tok');
});

test('getTableMeta exposes column ids, titles, types and select options', async () => {
  const { fetchImpl, calls } = stubFetch(() => ({ columns: [
    { id: 'c1', title: 'name', uidt: 'SingleLineText' },
    { id: 'c2', title: 'weather', uidt: 'SingleSelect', colOptions: { options: [{ title: 'Sunny' }, { title: 'Rain' }] } },
    { id: 'c3', title: 'scenario', uidt: 'LinkToAnotherRecord' },
  ] }));
  const client = createNocodbClient({ ...config, fetchImpl });
  const meta = await client.getTableMeta('t1');
  assert.equal(calls[0].url, 'https://noco.example/api/v2/meta/tables/t1');
  assert.deepEqual(meta.columns, [
    { id: 'c1', title: 'name', uidt: 'SingleLineText', options: null },
    { id: 'c2', title: 'weather', uidt: 'SingleSelect', options: ['Sunny', 'Rain'] },
    { id: 'c3', title: 'scenario', uidt: 'LinkToAnotherRecord', options: null },
  ]);
});

test('createRecords batches by BATCH_SIZE and returns ids in order', async () => {
  const { fetchImpl, calls } = stubFetch((call) => ({ records: call.body.map((record, i) => ({ id: 100 + i, fields: record.fields })) }));
  const client = createNocodbClient({ ...config, fetchImpl });
  const fieldsList = Array.from({ length: 23 }, (_, i) => ({ name: `row${i}` }));
  const created = await client.createRecords('t1', fieldsList);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.length, BATCH_SIZE);
  assert.deepEqual(calls[0].body[0], { fields: { name: 'row0' } });
  assert.equal(created.length, 23);
  assert.equal(created[0].id, '100');
});

test('updateRecords sends PATCH batches of { id, fields }', async () => {
  const { fetchImpl, calls } = stubFetch((call) => ({ records: call.body.map((r) => ({ id: r.id })) }));
  const client = createNocodbClient({ ...config, fetchImpl });
  await client.updateRecords('t1', [{ id: '5', fields: { name: 'x' } }, { id: '6', fields: { name: 'y' } }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PATCH');
  assert.deepEqual(calls[0].body, [{ id: '5', fields: { name: 'x' } }, { id: '6', fields: { name: 'y' } }]);
});

test('linkRecords and unlinkRecords hit the links endpoint with { id } arrays', async () => {
  const { fetchImpl, calls } = stubFetch(() => ({ success: true }));
  const client = createNocodbClient({ ...config, fetchImpl });
  await client.linkRecords('t1', 'lnk1', '7', ['3']);
  await client.unlinkRecords('t1', 'lnk1', '7', ['1']);
  assert.equal(calls[0].url, 'https://noco.example/api/v3/data/base1/t1/links/lnk1/7');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, [{ id: '3' }]);
  assert.equal(calls[1].method, 'DELETE');
  assert.deepEqual(calls[1].body, [{ id: '1' }]);
});

test('non-OK responses throw with the label and status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) });
  const client = createNocodbClient({ ...config, fetchImpl });
  await assert.rejects(() => client.fetchAllRecords('t1', 'Scenarios'), /Scenarios request failed: 401 Unauthorized/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `Cannot find module '../lib/nocodb.mjs'`.

- [ ] **Step 3: Create the module**

Create `site/scripts/lib/nocodb.mjs`:

```js
export const BATCH_SIZE = 10;
const PAGE_SIZE = 100;

export function createNocodbClient({ url, token, baseId, fetchImpl = globalThis.fetch, timeoutMs = 120_000 }) {
  const base = String(url).replace(/\/+$/, '');
  const headers = { 'xc-token': token, 'content-type': 'application/json' };

  async function request(method, pathname, { body, label }) {
    const target = new URL(pathname, `${base}/`);
    const response = await fetchImpl(target, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${label} request failed: ${response.status} ${response.statusText}`);
    return response.json();
  }

  function dataPath(tableId, suffix = '') {
    return `/api/v3/data/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}/records${suffix}`;
  }

  function chunk(items) {
    const chunks = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) chunks.push(items.slice(i, i + BATCH_SIZE));
    return chunks;
  }

  return {
    async fetchAllRecords(tableId, label) {
      const records = [];
      let next = `${dataPath(tableId)}?pageSize=${PAGE_SIZE}&linksAsLtar=true`;
      while (next) {
        // NocoDB may return absolute `next` URLs for its internal host; keep only path + query.
        const returned = new URL(next, `${base}/`);
        const page = await request('GET', `${returned.pathname}${returned.search}`, { label });
        records.push(...(page.records ?? []).map((record) => ({ ...record, id: String(record.id) })));
        next = page.next ?? null;
      }
      return records;
    },

    async getTableMeta(tableId) {
      const meta = await request('GET', `/api/v2/meta/tables/${encodeURIComponent(tableId)}`, { label: 'Table metadata' });
      return {
        columns: (meta.columns ?? []).map((column) => ({
          id: column.id, title: column.title, uidt: column.uidt,
          options: Array.isArray(column.colOptions?.options) ? column.colOptions.options.map((option) => option.title) : null,
        })),
      };
    },

    async createRecords(tableId, fieldsList) {
      const created = [];
      for (const batch of chunk(fieldsList)) {
        const result = await request('POST', dataPath(tableId), { body: batch.map((fields) => ({ fields })), label: 'Create records' });
        created.push(...(result.records ?? []).map((record) => ({ id: String(record.id) })));
      }
      return created;
    },

    async updateRecords(tableId, updates) {
      for (const batch of chunk(updates)) {
        await request('PATCH', dataPath(tableId), { body: batch.map(({ id, fields }) => ({ id, fields })), label: 'Update records' });
      }
    },

    async linkRecords(tableId, linkFieldId, recordId, targetIds) {
      if (!targetIds.length) return;
      await request('POST', `/api/v3/data/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}/links/${encodeURIComponent(linkFieldId)}/${encodeURIComponent(recordId)}`, { body: targetIds.map((id) => ({ id: String(id) })), label: 'Link records' });
    },

    async unlinkRecords(tableId, linkFieldId, recordId, targetIds) {
      if (!targetIds.length) return;
      await request('DELETE', `/api/v3/data/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}/links/${encodeURIComponent(linkFieldId)}/${encodeURIComponent(recordId)}`, { body: targetIds.map((id) => ({ id: String(id) })), label: 'Unlink records' });
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all passing (4 env + 6 nocodb).

- [ ] **Step 5: Use the client in the sync script**

In `site/scripts/sync-uma-nocodb.mjs`:

1. Add `import { createNocodbClient } from './lib/nocodb.mjs';` after the env import.
2. Delete the whole `async function fetchTable(config, tableId, label) { ... }` function and the constants `API_PAGE_SIZE` and `API_TIMEOUT_MS` is still used by `downloadImage`, so keep `API_TIMEOUT_MS` and delete only `API_PAGE_SIZE`.
3. In `main()`, replace the three `fetchTable(...)` calls with:

```js
  const client = createNocodbClient({ url: config.url, token: config.token, baseId: config.baseId, timeoutMs: API_TIMEOUT_MS });
  const scenarios = await client.fetchAllRecords(config.scenarios, 'Scenarios');
  const events = await client.fetchAllRecords(config.events, 'PvP events');
  const supportCards = await client.fetchAllRecords(config.supportCards, 'Support cards');
  console.log(`Fetched ${scenarios.length} scenario, ${events.length} PvP event, and ${supportCards.length} support card record(s).`);
```

Note that record ids are now already strings; the existing `String(record.id)` calls in `createModel` are harmless and stay.

- [ ] **Step 6: Verify the sync still works end to end**

Run: `npm run sync:uma` then `npm run validate:uma`
Expected: sync writes `public/data/uma/timeline.json` and prints the counts; validation prints `Uma output validation passed.` Compare `git diff --stat` shows no tracked changes other than the scripts.

- [ ] **Step 7: Commit**

```bash
git add site/scripts/lib/nocodb.mjs site/scripts/__tests__/nocodb.test.mjs site/scripts/sync-uma-nocodb.mjs
git commit -m "Add shared NocoDB v3 client and use it in the Uma sync"
```

---

### Task 3: GameTora client with disk cache

**Files:**
- Create: `site/scripts/gametora/client.mjs`
- Create: `site/scripts/__tests__/gametora-client.test.mjs`

**Interfaces:**
- Produces: `export function createGametoraClient({ cacheDir, fetchImpl = globalThis.fetch, userAgent = DEFAULT_USER_AGENT, noFetch = false, log = console, timeoutMs = 60_000 })` returning:
  - `loadManifest()` → `Promise<object>` mapping dataset key to hash.
  - `loadDataset(manifest, key)` → `Promise<object | null>`; `null` when the key is absent from the manifest.
  - `export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; cuddlebuns-uma-importer/1.0)'`
- Cache layout: `<cacheDir>/manifest.json`, `<cacheDir>/<key with '/' replaced by '__'>.<hash>.json`.

- [ ] **Step 1: Write the failing test**

Create `site/scripts/__tests__/gametora-client.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGametoraClient, DEFAULT_USER_AGENT } from '../gametora/client.mjs';

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cb-gt-')); }

function stubFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers });
    const entry = responses[String(url)];
    if (entry === 'fail') throw new Error('network down');
    if (entry === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
    return { ok: true, status: 200, statusText: 'OK', json: async () => entry };
  };
  return { fetchImpl, calls };
}

const MANIFEST_URL = 'https://gametora.com/data/manifests/umamusume.json';
const quiet = { warn() {}, log() {} };

test('loadManifest fetches with the user agent and caches to disk', async () => {
  const cacheDir = tempDir();
  const { fetchImpl, calls } = stubFetch({ [MANIFEST_URL]: { scenarios: 'abc' } });
  const client = createGametoraClient({ cacheDir, fetchImpl, log: quiet });
  const manifest = await client.loadManifest();
  assert.deepEqual(manifest, { scenarios: 'abc' });
  assert.equal(calls[0].headers['user-agent'], DEFAULT_USER_AGENT);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cacheDir, 'manifest.json'), 'utf8')), { scenarios: 'abc' });
});

test('loadDataset returns null for a key missing from the manifest without fetching', async () => {
  const { fetchImpl, calls } = stubFetch({});
  const client = createGametoraClient({ cacheDir: tempDir(), fetchImpl, log: quiet });
  assert.equal(await client.loadDataset({}, 'scenarios'), null);
  assert.equal(calls.length, 0);
});

test('loadDataset fetches by key and hash, caches, and reuses the cache on the next call', async () => {
  const cacheDir = tempDir();
  const url = 'https://gametora.com/data/umamusume/en/foresight/timeline.h1.json';
  const { fetchImpl, calls } = stubFetch({ [url]: { future_cm: [] } });
  const client = createGametoraClient({ cacheDir, fetchImpl, log: quiet });
  const manifest = { 'en/foresight/timeline': 'h1' };
  assert.deepEqual(await client.loadDataset(manifest, 'en/foresight/timeline'), { future_cm: [] });
  assert.ok(fs.existsSync(path.join(cacheDir, 'en__foresight__timeline.h1.json')));
  assert.deepEqual(await client.loadDataset(manifest, 'en/foresight/timeline'), { future_cm: [] });
  assert.equal(calls.length, 1);
});

test('a failed fetch falls back to the newest cached copy for that key and warns', async () => {
  const cacheDir = tempDir();
  fs.writeFileSync(path.join(cacheDir, 'scenarios.old.json'), JSON.stringify([{ id: 1 }]));
  const warnings = [];
  const { fetchImpl } = stubFetch({ 'https://gametora.com/data/umamusume/scenarios.new.json': 'fail' });
  const client = createGametoraClient({ cacheDir, fetchImpl, log: { warn: (m) => warnings.push(m), log() {} } });
  assert.deepEqual(await client.loadDataset({ scenarios: 'new' }, 'scenarios'), [{ id: 1 }]);
  assert.match(warnings[0], /scenarios.*cached/i);
});

test('a failed fetch with no cache throws', async () => {
  const { fetchImpl } = stubFetch({ [MANIFEST_URL]: 'fail' });
  const client = createGametoraClient({ cacheDir: tempDir(), fetchImpl, log: quiet });
  await assert.rejects(() => client.loadManifest(), /manifest/i);
});

test('noFetch reads only from cache and throws when the key is not cached', async () => {
  const cacheDir = tempDir();
  fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({ scenarios: 'h9' }));
  fs.writeFileSync(path.join(cacheDir, 'scenarios.h9.json'), JSON.stringify([{ id: 2 }]));
  const { fetchImpl, calls } = stubFetch({});
  const client = createGametoraClient({ cacheDir, fetchImpl, noFetch: true, log: quiet });
  const manifest = await client.loadManifest();
  assert.deepEqual(await client.loadDataset(manifest, 'scenarios'), [{ id: 2 }]);
  await assert.rejects(() => client.loadDataset({ 'support-cards': 'zz' }, 'support-cards'), /no cached copy/i);
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `Cannot find module '../gametora/client.mjs'`.

- [ ] **Step 3: Create the module**

Create `site/scripts/gametora/client.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; cuddlebuns-uma-importer/1.0)';
const BASE = 'https://gametora.com';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, file);
}
function cacheStem(key) { return key.replace(/\//g, '__'); }

export function createGametoraClient({ cacheDir, fetchImpl = globalThis.fetch, userAgent = DEFAULT_USER_AGENT, noFetch = false, log = console, timeoutMs = 60_000 }) {
  const headers = { 'user-agent': userAgent, accept: 'application/json' };

  async function fetchJson(url, label) {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`${label} HTTP ${response.status} ${response.statusText}`);
    return response.json();
  }

  function newestCachedFor(key) {
    if (!fs.existsSync(cacheDir)) return null;
    const prefix = `${cacheStem(key)}.`;
    const candidates = fs.readdirSync(cacheDir).filter((name) => name.startsWith(prefix) && name.endsWith('.json'));
    if (!candidates.length) return null;
    candidates.sort((a, b) => fs.statSync(path.join(cacheDir, b)).mtimeMs - fs.statSync(path.join(cacheDir, a)).mtimeMs);
    return path.join(cacheDir, candidates[0]);
  }

  async function loadWithCache({ url, exactFile, fallbackFile, label }) {
    if (exactFile && fs.existsSync(exactFile)) return readJson(exactFile);
    if (noFetch) {
      if (!fallbackFile) throw new Error(`${label}: --no-fetch set and no cached copy exists.`);
      return readJson(fallbackFile);
    }
    try {
      const value = await fetchJson(url, label);
      if (exactFile) writeJsonAtomic(exactFile, value);
      return value;
    } catch (error) {
      if (fallbackFile) {
        log.warn(`${label}: fetch failed (${error.message}); using cached copy ${path.basename(fallbackFile)}.`);
        return readJson(fallbackFile);
      }
      throw new Error(`${label}: fetch failed (${error.message}) and no cached copy exists.`);
    }
  }

  return {
    async loadManifest() {
      const file = path.join(cacheDir, 'manifest.json');
      // The manifest has no hash of its own, so it is refetched on every run unless --no-fetch.
      const manifest = await loadWithCache({
        url: `${BASE}/data/manifests/umamusume.json`,
        exactFile: null,
        fallbackFile: fs.existsSync(file) ? file : null,
        label: 'GameTora manifest',
      });
      writeJsonAtomic(file, manifest);
      return manifest;
    },

    async loadDataset(manifest, key) {
      const hash = manifest?.[key];
      if (!hash) return null;
      const exactFile = path.join(cacheDir, `${cacheStem(key)}.${hash}.json`);
      return loadWithCache({ url: `${BASE}/data/umamusume/${key}.${hash}.json`, exactFile, fallbackFile: newestCachedFor(key), label: `GameTora dataset ${key}` });
    },
  };
}
```

Trace for the `noFetch` test: `loadManifest` with `noFetch` finds `manifest.json` as `fallbackFile` and returns it without fetching. `loadDataset` for `scenarios` finds the exact file `scenarios.h9.json`. For `support-cards` there is no exact file and no fallback, so it throws with "no cached copy".

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add site/scripts/gametora/client.mjs site/scripts/__tests__/gametora-client.test.mjs
git commit -m "Add cached GameTora dataset client"
```

---

### Task 4: Transform lookups and scenarios

**Files:**
- Create: `site/scripts/gametora/transform.mjs`
- Create: `site/scripts/__tests__/transform.test.mjs`

**Interfaces:**
- Produces (all exported from `transform.mjs`):
  - `TRACKS` (object id → name), `GROUND`, `TURN`, `CONDITION`, `SEASON`, `WEATHER`, `CARD_TYPES`, `RARITY` lookup objects.
  - `distanceClass(meters)` → `'Sprint' | 'Mile' | 'Medium' | 'Long'`.
  - `unixToDate(seconds)` → `'YYYY-MM-DD'` in UTC.
  - `addDays(date, days)` → `'YYYY-MM-DD'`.
  - `titleCaseSlug(slug)` → `'Project Larc'` from `'project-larc'`.
  - `transformScenarios({ scenarios, foresight, now = new Date() })` → `{ rows: CandidateRow[], warnings: string[] }`. Rows are sorted by `facts.era_start`.
  - `FINAL_ERA_DAYS = 120`.

- [ ] **Step 1: Write the failing tests**

Create `site/scripts/__tests__/transform.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKS, distanceClass, unixToDate, addDays, titleCaseSlug, transformScenarios, FINAL_ERA_DAYS,
} from '../gametora/transform.mjs';

// Unix seconds for an ISO date at an odd time of day, like GameTora's display_start values.
export const T = (iso) => Math.floor(Date.parse(`${iso}T05:30:00Z`) / 1000);

test('lookups match the verified track ids and distance bands', () => {
  assert.equal(TRACKS[10003], 'Niigata');
  assert.equal(TRACKS[10005], 'Nakayama');
  assert.equal(TRACKS[10203], 'Del Mar');
  assert.equal(distanceClass(1400), 'Sprint');
  assert.equal(distanceClass(1401), 'Mile');
  assert.equal(distanceClass(1800), 'Mile');
  assert.equal(distanceClass(2400), 'Medium');
  assert.equal(distanceClass(2401), 'Long');
});

test('date helpers use UTC calendar dates', () => {
  assert.equal(unixToDate(T('2026-09-20')), '2026-09-20');
  assert.equal(addDays('2026-12-30', 6), '2027-01-05');
  assert.equal(titleCaseSlug('project-larc'), 'Project Larc');
});

export const scenarios = [
  { id: 4, name_en: 'Trackblazer', name_en_old: 'Make a New Track', url_name: 'trackblazer', bg_color: 'AABBCC', start_en: T('2026-03-12') },
  { id: 3, name_en: 'Brighter Together Our Grand Concert', name_en_old: 'Grand Live', url_name: 'grand-live', bg_color: '9CD127', start_en: T('2026-07-22') },
  { id: 5, name_en: 'Grandmasters Legacies Immortal', name_en_old: 'Grand Masters', url_name: 'grand-masters', bg_color: 'fb5f5f' },
  { id: 6, name_en_old: 'Project L\'Arc', url_name: 'project-larc', bg_color: '4B84F4' },
  { id: 7, url_name: 'uaf', bg_color: 'fc6625' },
];
export const foresight = { future_scenarios: [
  { id: 5, display_start: T('2026-12-05'), is_estimated: true },
  { id: 6, display_start: T('2027-04-18'), is_estimated: true },
  { id: 7, display_start: T('2027-09-02'), is_estimated: true },
] };
export const now = new Date('2026-09-07T00:00:00Z');

test('transformScenarios picks the current scenario by latest past start_en, chains era_end, and sorts', () => {
  const { rows, warnings } = transformScenarios({ scenarios, foresight, now });
  assert.deepEqual(rows.map((r) => r.gametoraId), [3, 5, 6, 7]);
  assert.deepEqual(rows[0].facts, { slug: 'grand-live', era_start: '2026-07-22', era_end: '2026-12-05', display_color: '#9cd127' });
  assert.deepEqual(rows[1].facts, { slug: 'grand-masters', era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#fb5f5f' });
  assert.equal(rows[3].facts.era_end, addDays('2027-09-02', FINAL_ERA_DAYS));
  assert.match(rows[3].note, /estimated/);
  assert.equal(rows[0].note, null);
  assert.deepEqual(warnings, []);
});

test('transformScenarios seeds name tiers and short_name', () => {
  const { rows } = transformScenarios({ scenarios, foresight, now });
  const byId = Object.fromEntries(rows.map((r) => [r.gametoraId, r]));
  assert.deepEqual(byId[3].seeds.name, { value: 'Brighter Together Our Grand Concert', alternatives: ['Grand Live'] });
  assert.deepEqual(byId[6].seeds.name, { value: 'Project L\'Arc', alternatives: ['Project Larc'] });
  assert.deepEqual(byId[7].seeds.name, { value: 'Uaf', alternatives: [] });
  assert.deepEqual(byId[5].seeds.short_name, { value: 'grandmasters', alternatives: [] });
});

test('transformScenarios warns and skips a future scenario with no matching record', () => {
  const { rows, warnings } = transformScenarios({ scenarios, foresight: { future_scenarios: [{ id: 99, display_start: T('2028-01-01') }] }, now });
  assert.deepEqual(rows.map((r) => r.gametoraId), [3]);
  assert.match(warnings[0], /99/);
});
```

The exports (`T`, `scenarios`, `foresight`, `now`) are reused by the event and card tests in Tasks 5 and 6.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../gametora/transform.mjs'`.

- [ ] **Step 3: Create the module with lookups and scenarios**

Create `site/scripts/gametora/transform.mjs`:

```js
// Pure transforms from GameTora JSON to candidate rows. No I/O here.
// Every lookup below is documented and verified in docs/2026-09-07-uma-gametora-import-design.md.

export const TRACKS = {
  10001: 'Sapporo', 10002: 'Hakodate', 10003: 'Niigata', 10004: 'Fukushima', 10005: 'Nakayama',
  10006: 'Tokyo', 10007: 'Chukyo', 10008: 'Kyoto', 10009: 'Hanshin', 10010: 'Kokura',
  10101: 'Ooi', 10103: 'Kawasaki', 10104: 'Funabashi', 10105: 'Morioka',
  10201: 'Longchamp', 10202: 'Santa Anita', 10203: 'Del Mar',
};
export const GROUND = { 1: 'Turf', 2: 'Dirt' };
export const TURN = { 1: 'Right', 2: 'Left' };
export const CONDITION = { 1: 'Firm', 2: 'Good', 3: 'Soft', 4: 'Heavy' };
export const SEASON = { 1: 'Spring', 2: 'Summer', 3: 'Fall', 4: 'Winter', 5: 'Spring' };
export const WEATHER = { 1: 'Sunny', 2: 'Cloudy', 3: 'Rain', 4: 'Snow' };
export const CARD_TYPES = { speed: 'Speed', stamina: 'Stamina', power: 'Power', guts: 'Guts', intelligence: 'Wit', friend: 'Friend', group: 'Group' };
export const RARITY = { 1: 'R', 2: 'SR', 3: 'SSR' };
export const FINAL_ERA_DAYS = 120;

export function distanceClass(meters) {
  if (meters <= 1400) return 'Sprint';
  if (meters <= 1800) return 'Mile';
  if (meters <= 2400) return 'Medium';
  return 'Long';
}

export function unixToDate(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function titleCaseSlug(slug) {
  return String(slug ?? '').split('-').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

export function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function color(value) { const hex = text(value); return hex ? `#${hex.replace(/^#/, '').toLowerCase()}` : null; }
export function seed(value, ...alternatives) {
  return { value, alternatives: [...new Set(alternatives.filter((alt) => alt && alt !== value))] };
}

export function transformScenarios({ scenarios, foresight, now = new Date() }) {
  const warnings = [];
  const byId = new Map((scenarios ?? []).map((scenario) => [scenario.id, scenario]));
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const released = (scenarios ?? []).filter((scenario) => typeof scenario.start_en === 'number' && scenario.start_en <= nowSeconds);
  const current = released.sort((a, b) => b.start_en - a.start_en)[0] ?? null;

  const starts = [];
  if (current) starts.push({ scenario: current, eraStart: unixToDate(current.start_en) });
  for (const entry of foresight?.future_scenarios ?? []) {
    const scenario = byId.get(entry.id);
    if (!scenario) { warnings.push(`Scenario ${entry.id}: listed in future_scenarios but missing from scenarios; skipped.`); continue; }
    if (current && scenario.id === current.id) continue;
    if (typeof entry.display_start !== 'number') { warnings.push(`Scenario ${entry.id}: no display_start; skipped.`); continue; }
    starts.push({ scenario, eraStart: unixToDate(entry.display_start) });
  }
  starts.sort((a, b) => a.eraStart.localeCompare(b.eraStart));

  const rows = starts.map(({ scenario, eraStart }, index) => {
    const next = starts[index + 1];
    const official = text(scenario.name_en);
    const provisional = text(scenario.name_en_old);
    const fromSlug = titleCaseSlug(scenario.url_name);
    const nameValue = official ?? provisional ?? fromSlug;
    return {
      gametoraId: scenario.id,
      label: nameValue,
      facts: {
        slug: text(scenario.url_name),
        era_start: eraStart,
        era_end: next ? next.eraStart : addDays(eraStart, FINAL_ERA_DAYS),
        display_color: color(scenario.bg_color),
      },
      seeds: {
        name: seed(nameValue, provisional, fromSlug),
        short_name: seed(String(scenario.url_name ?? '').replace(/-/g, '')),
      },
      scenarioGametoraId: null,
      note: next ? null : `era_end estimated (era_start + ${FINAL_ERA_DAYS} days) until GameTora lists the next scenario`,
    };
  });
  return { rows, warnings };
}
```

`seed()` deduplicates alternatives and drops any equal to the value, which is why id 3 ends up with `['Grand Live']` even though `name_en_old` and the title-cased slug coincide.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add site/scripts/gametora/transform.mjs site/scripts/__tests__/transform.test.mjs
git commit -m "Add GameTora transform lookups and scenario candidates"
```

---

### Task 5: Transform Champions Meeting events

**Files:**
- Modify: `site/scripts/gametora/transform.mjs` (append `transformEvents`)
- Modify: `site/scripts/__tests__/transform.test.mjs` (append tests)

**Interfaces:**
- Consumes: `transformScenarios` output rows (`facts.era_start`, `facts.era_end`, `gametoraId`).
- Produces: `transformEvents({ foresight, jpChampionsMeetings, scenarioRows })` → `{ rows: CandidateRow[], warnings: string[] }`. Each row has `facts` with exactly these keys: `event_number, event_type, start_date, end_date, distance_class, distance_m, racecourse, direction, season, track_condition, weather, surface, status`; `seeds.name`, `seeds.slug`; `scenarioGametoraId`.

- [ ] **Step 1: Append the failing tests**

Append to `site/scripts/__tests__/transform.test.mjs`:

```js
import { transformEvents } from '../gametora/transform.mjs';

const jp = (id, race, name, startIso = '2022-11-13', days = 6) => ({
  id, name, name_en: name, race, start: T(startIso), end: T(startIso) + days * 86_400,
});
const jpChampionsMeetings = [
  jp(19, { condition: 1, distance: 2200, ground: 1, season: 3, track: 10008, turn: 1, weather: 1 }, 'Scorpio Cup'),
  jp(27, { condition: 3, distance: 2400, ground: 1, season: 3, track: 10201, turn: 1, weather: 3 }, undefined),
  jp(41, { condition: 1, distance: 1200, ground: 1, season: 3, track: 10003, turn: 2, weather: 2 }, undefined),
  jp(44, { condition: 1, distance: 2200, ground: 1, season: 1, track: 10203, turn: 2, weather: 1 }, undefined, '2025-01-01', 9),
  jp(45, { condition: 1, distance: 2000, ground: 2, season: 1, track: 99999, turn: 2, weather: 1 }, undefined),
];
const futureCm = [
  { id: 19, name_en: 'Scorpio Cup', display_start: T('2026-09-20'), is_estimated: true },
  { id: 27, display_start: T('2027-05-25'), is_estimated: false },
  { id: 41, display_start: T('2028-11-25'), is_estimated: true },
  { id: 44, display_start: T('2029-03-16'), is_estimated: true },
  { id: 45, display_start: T('2029-04-08'), is_estimated: true },
  { id: 46, display_start: T('2029-05-24'), is_estimated: true },
];
const scenarioRows = transformScenarios({ scenarios, foresight, now }).rows;

test('transformEvents joins foresight with JP race data and maps every code', () => {
  const { rows } = transformEvents({ foresight: { future_cm: futureCm }, jpChampionsMeetings, scenarioRows });
  const cm19 = rows.find((r) => r.gametoraId === 19);
  assert.deepEqual(cm19.facts, {
    event_number: 19, event_type: 'Champions Meeting', start_date: '2026-09-20', end_date: '2026-09-26',
    distance_class: 'Medium', distance_m: 2200, racecourse: 'Kyoto', direction: 'Right', season: 'Fall',
    track_condition: 'Firm', weather: 'Sunny', surface: 'Turf', status: 'projected',
  });
  assert.deepEqual(cm19.seeds, { name: { value: 'CM19 Scorpio', alternatives: [] }, slug: { value: 'cm19', alternatives: [] } });
  assert.equal(cm19.scenarioGametoraId, 3);
});

test('transformEvents names unnamed CMs by distance class and marks announced ones confirmed', () => {
  const { rows } = transformEvents({ foresight: { future_cm: futureCm }, jpChampionsMeetings, scenarioRows });
  const cm27 = rows.find((r) => r.gametoraId === 27);
  assert.equal(cm27.seeds.name.value, 'CM27 Medium');
  assert.equal(cm27.facts.racecourse, 'Longchamp');
  assert.equal(cm27.facts.weather, 'Rain');
  assert.equal(cm27.facts.status, 'confirmed');
  assert.equal(cm27.scenarioGametoraId, 6);
  const cm41 = rows.find((r) => r.gametoraId === 41);
  assert.equal(cm41.facts.racecourse, 'Niigata');
  assert.equal(cm41.facts.direction, 'Left');
  const cm44 = rows.find((r) => r.gametoraId === 44);
  assert.equal(cm44.facts.end_date, '2029-03-25');
  assert.equal(cm44.scenarioGametoraId, null);
});

test('transformEvents skips CMs with no JP record or an unknown track and warns', () => {
  const { rows, warnings } = transformEvents({ foresight: { future_cm: futureCm }, jpChampionsMeetings, scenarioRows });
  assert.deepEqual(rows.map((r) => r.gametoraId), [19, 27, 41, 44]);
  assert.equal(warnings.length, 2);
  assert.match(warnings.find((w) => w.includes('45')), /track 99999/);
  assert.match(warnings.find((w) => w.includes('46')), /no JP record/);
});
```

Trace for CM44's end date: the JP record spans 9 days, so `addDays('2029-03-16', 9)` is `2029-03-25`. Its start is after the last scenario's estimated era end (`2027-09-02` plus 120 days), so no scenario matches.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `transformEvents` is not exported.

- [ ] **Step 3: Append the implementation**

Append to `site/scripts/gametora/transform.mjs`:

```js
export function transformEvents({ foresight, jpChampionsMeetings, scenarioRows }) {
  const warnings = [];
  const jpById = new Map((jpChampionsMeetings ?? []).map((cm) => [cm.id, cm]));
  const rows = [];
  for (const entry of foresight?.future_cm ?? []) {
    const jp = jpById.get(entry.id);
    if (!jp?.race) { warnings.push(`CM${entry.id}: no JP record with race data; skipped.`); continue; }
    if (typeof entry.display_start !== 'number') { warnings.push(`CM${entry.id}: no display_start; skipped.`); continue; }
    const race = jp.race;
    const lookups = [
      ['track', TRACKS[race.track]], ['ground', GROUND[race.ground]], ['turn', TURN[race.turn]],
      ['condition', CONDITION[race.condition]], ['season', SEASON[race.season]], ['weather', WEATHER[race.weather]],
    ];
    const missing = lookups.find(([, value]) => !value);
    if (missing || !Number.isFinite(race.distance)) {
      warnings.push(`CM${entry.id}: unknown ${missing ? `${missing[0]} ${race[missing[0]]}` : 'distance'}; skipped.`);
      continue;
    }
    const startDate = unixToDate(entry.display_start);
    const durationDays = Number.isFinite(jp.start) && Number.isFinite(jp.end) ? Math.max(1, Math.round((jp.end - jp.start) / 86_400)) : 6;
    const officialName = text(entry.name_en);
    const distance = distanceClass(race.distance);
    const scenario = (scenarioRows ?? []).find((row) => row.facts.era_start <= startDate && startDate < row.facts.era_end) ?? null;
    rows.push({
      gametoraId: entry.id,
      label: officialName ? `CM${entry.id} ${officialName}` : `CM${entry.id}`,
      facts: {
        event_number: entry.id,
        event_type: 'Champions Meeting',
        start_date: startDate,
        end_date: addDays(startDate, durationDays),
        distance_class: distance,
        distance_m: race.distance,
        racecourse: TRACKS[race.track],
        direction: TURN[race.turn],
        season: SEASON[race.season],
        track_condition: CONDITION[race.condition],
        weather: WEATHER[race.weather],
        surface: GROUND[race.ground],
        status: entry.is_estimated === false ? 'confirmed' : 'projected',
      },
      seeds: {
        name: seed(officialName ? `CM${entry.id} ${officialName.replace(/\s+Cup$/i, '')}` : `CM${entry.id} ${distance}`),
        slug: seed(`cm${entry.id}`),
      },
      scenarioGametoraId: scenario?.gametoraId ?? null,
      note: null,
    });
  }
  rows.sort((a, b) => a.facts.start_date.localeCompare(b.facts.start_date) || a.gametoraId - b.gametoraId);
  return { rows, warnings };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add site/scripts/gametora/transform.mjs site/scripts/__tests__/transform.test.mjs
git commit -m "Transform GameTora Champions Meetings into event candidates"
```

---

### Task 6: Transform support cards

**Files:**
- Modify: `site/scripts/gametora/transform.mjs` (append `transformSupportCards`)
- Modify: `site/scripts/__tests__/transform.test.mjs` (append tests)

**Interfaces:**
- Produces: `transformSupportCards({ supportCards, predictedReleases })` → `{ rows: CandidateRow[], warnings: string[], skippedNoGlobalDate: number }`. Each row has `facts` with exactly `character_name, card_type, rarity, title, release_date`; `seeds.name`, `seeds.slug`; `scenarioGametoraId: null`.

- [ ] **Step 1: Append the failing tests**

Append to `site/scripts/__tests__/transform.test.mjs`:

```js
import { transformSupportCards } from '../gametora/transform.mjs';

const supportCards = [
  { support_id: 30146, char_name: 'Oguri Cap', type: 'intelligence', rarity: 3, title_en: '[Run Forth! Dash On! Ever Forward!]', url_name: '30146-oguri-cap', release_en: '2026-10-19' },
  { support_id: 30118, char_name: 'Symboli Kris', type: 'stamina', rarity: 3, title_en: '[Kris Title]', url_name: '30118-symboli-kris' },
  { support_id: 10021, char_name: 'Tazuna Hayakawa', type: 'friend', rarity: 3, title_en: '[Tracen Academy]', url_name: '10021-tazuna-hayakawa', release_en: '2025-06-26' },
  { support_id: 30500, char_name: 'Someone', type: 'group', rarity: 2, title_en: '[Group]', url_name: '30500-someone' },
  { support_id: 30900, char_name: 'Nobody', type: 'speed', rarity: 1, title_en: '[No Date]', url_name: '30900-nobody' },
  { support_id: 30901, char_name: 'Odd', type: 'mystery', rarity: 3, title_en: '[Bad Type]', url_name: '30901-odd', release_en: '2026-01-01' },
];
const predictedReleases = { support_cards: {
  30118: { banner_id: 1, banner_type: 'support', release_date: '2026-09-01' },
  30500: { release_date: '2027-02-02' },
} };

test('transformSupportCards maps type, rarity, title and picks the global release date', () => {
  const { rows } = transformSupportCards({ supportCards, predictedReleases });
  const oguri = rows.find((r) => r.gametoraId === 30146);
  assert.deepEqual(oguri.facts, { character_name: 'Oguri Cap', card_type: 'Wit', rarity: 'SSR', title: '[Run Forth! Dash On! Ever Forward!]', release_date: '2026-10-19' });
  assert.deepEqual(oguri.seeds, { name: { value: 'Oguri Cap Wit SSR', alternatives: [] }, slug: { value: '30146-oguri-cap', alternatives: [] } });
  const kris = rows.find((r) => r.gametoraId === 30118);
  assert.equal(kris.facts.release_date, '2026-09-01');
  assert.equal(rows.find((r) => r.gametoraId === 10021).facts.card_type, 'Friend');
  assert.equal(rows.find((r) => r.gametoraId === 30500).facts.card_type, 'Group');
  assert.equal(rows.find((r) => r.gametoraId === 30500).facts.rarity, 'SR');
});

test('transformSupportCards skips cards without a global date silently and unknown types with a warning', () => {
  const { rows, warnings, skippedNoGlobalDate } = transformSupportCards({ supportCards, predictedReleases });
  assert.deepEqual(rows.map((r) => r.gametoraId).sort((a, b) => a - b), [10021, 30118, 30146, 30500]);
  assert.equal(skippedNoGlobalDate, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /30901.*mystery/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `transformSupportCards` is not exported.

- [ ] **Step 3: Append the implementation**

Append to `site/scripts/gametora/transform.mjs`:

```js
function isoDate(value) {
  const normalized = typeof value === 'string' ? value.slice(0, 10) : null;
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export function transformSupportCards({ supportCards, predictedReleases }) {
  const warnings = [];
  const rows = [];
  let skippedNoGlobalDate = 0;
  for (const card of supportCards ?? []) {
    const releaseDate = isoDate(card.release_en) ?? isoDate(predictedReleases?.support_cards?.[card.support_id]?.release_date);
    if (!releaseDate) { skippedNoGlobalDate += 1; continue; }
    const cardType = CARD_TYPES[card.type];
    if (!cardType) { warnings.push(`Support card ${card.support_id}: unknown type "${card.type}"; skipped.`); continue; }
    const rarity = RARITY[card.rarity] ?? null;
    const characterName = text(card.char_name);
    if (!characterName) { warnings.push(`Support card ${card.support_id}: no character name; skipped.`); continue; }
    rows.push({
      gametoraId: card.support_id,
      label: `${characterName} ${text(card.title_en) ?? ''}`.trim(),
      facts: {
        character_name: characterName,
        card_type: cardType,
        rarity,
        title: text(card.title_en),
        release_date: releaseDate,
      },
      seeds: {
        name: seed([characterName, cardType, rarity].filter(Boolean).join(' ')),
        slug: seed(text(card.url_name) ?? `support-card-${card.support_id}`),
      },
      scenarioGametoraId: null,
      note: null,
    });
  }
  rows.sort((a, b) => a.facts.release_date.localeCompare(b.facts.release_date) || a.gametoraId - b.gametoraId);
  return { rows, warnings, skippedNoGlobalDate };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add site/scripts/gametora/transform.mjs site/scripts/__tests__/transform.test.mjs
git commit -m "Transform GameTora support cards into candidates"
```

---

### Task 7: Planner (diff candidates against NocoDB rows)

**Files:**
- Create: `site/scripts/gametora/plan.mjs`
- Create: `site/scripts/__tests__/plan.test.mjs`

**Interfaces:**
- Consumes: candidate rows from Task 4 to 6; NocoDB records `{ id: string, fields: object }` from `fetchAllRecords` (link fields arrive as arrays of `{ id, fields }` because of `linksAsLtar=true`; attachments as arrays of `{ title, ... }`).
- Produces:
  - `export function normalizeValue(value)` → `null | string | number | boolean`.
  - `export function relationIds(value)` → `string[]` of linked record ids (same behaviour as the helper in the sync script).
  - `export function buildPlan({ table, candidates, existing, scenarioRecordIdByGametoraId = new Map() })` → `{ entries: PlanEntry[], summary: { create, link, update, skip, locked, unmatched, dropped } }`. `table` is `'scenarios' | 'pvp_events' | 'support_cards'`.
  - For events, `entry.link.to` is a record id string, or `'new:<scenarioGametoraId>'` when the scenario does not exist yet, or `null`.
  - `entry.changes` for `create` and `link` includes `gametora_id: { from: null, to: <id> }` so the CLI can write it with the same code path as any other field.

- [ ] **Step 1: Write the failing tests**

Create `site/scripts/__tests__/plan.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, normalizeValue, relationIds } from '../gametora/plan.mjs';

const rec = (id, fields) => ({ id: String(id), fields });
const scenarioCandidate = (gametoraId, overrides = {}) => ({
  gametoraId, label: `S${gametoraId}`,
  facts: { slug: `s${gametoraId}`, era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#fb5f5f', ...overrides.facts },
  seeds: { name: { value: 'Grandmasters Legacies Immortal', alternatives: ['Grand Masters'] }, short_name: { value: 'grandmasters', alternatives: [] }, ...overrides.seeds },
  scenarioGametoraId: null, note: overrides.note ?? null,
});
const eventCandidate = (gametoraId, overrides = {}) => ({
  gametoraId, label: `CM${gametoraId}`,
  facts: { event_number: gametoraId, event_type: 'Champions Meeting', start_date: '2026-09-20', end_date: '2026-09-26', distance_class: 'Medium', distance_m: 2200, racecourse: 'Kyoto', direction: 'Right', season: 'Fall', track_condition: 'Firm', weather: 'Sunny', surface: 'Turf', status: 'projected', ...overrides.facts },
  seeds: { name: { value: `CM${gametoraId} Scorpio`, alternatives: [] }, slug: { value: `cm${gametoraId}`, alternatives: [] } },
  scenarioGametoraId: overrides.scenarioGametoraId ?? 3, note: null,
});
const cardCandidate = (gametoraId, overrides = {}) => ({
  gametoraId, label: `card ${gametoraId}`,
  facts: { character_name: 'Oguri Cap', card_type: 'Wit', rarity: 'SSR', title: '[Run Forth!]', release_date: '2026-10-19', ...overrides.facts },
  seeds: { name: { value: 'Oguri Cap Wit SSR', alternatives: [] }, slug: { value: `${gametoraId}-oguri-cap`, alternatives: [] } },
  scenarioGametoraId: null, note: null,
});
const summaryOf = (plan) => Object.fromEntries(Object.entries(plan.summary).filter(([, n]) => n > 0));

test('normalizeValue treats blanks as null and trims, keeps numbers and booleans, lowercases colours', () => {
  assert.equal(normalizeValue(''), null);
  assert.equal(normalizeValue('  '), null);
  assert.equal(normalizeValue(undefined), null);
  assert.equal(normalizeValue(' Kyoto '), 'Kyoto');
  assert.equal(normalizeValue('2026-09-20T00:00:00.000Z'), '2026-09-20');
  assert.equal(normalizeValue(2200), 2200);
  assert.equal(normalizeValue('2200'), '2200');
  assert.equal(normalizeValue(true), true);
  assert.equal(normalizeValue('#FB5F5F'), '#fb5f5f');
  assert.deepEqual(relationIds([{ id: 3, fields: { name: 'x' } }]), ['3']);
});

test('creates a row when nothing matches, with every fact and seed as a change', () => {
  const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5)], existing: [] });
  assert.deepEqual(summaryOf(plan), { create: 1 });
  const [entry] = plan.entries;
  assert.equal(entry.action, 'create');
  assert.equal(entry.recordId, null);
  assert.deepEqual(entry.changes.gametora_id, { from: null, to: 5 });
  assert.deepEqual(entry.changes.name, { from: null, to: 'Grandmasters Legacies Immortal' });
  assert.deepEqual(entry.changes.era_end, { from: null, to: '2027-04-18' });
});

test('skips a row whose facts and seeds already match, even with formatting differences', () => {
  const existing = [rec(1, { gametora_id: 5, slug: 's5', era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#FB5F5F', name: 'Grandmasters Legacies Immortal', short_name: 'grandmasters', lock_facts: false })];
  const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5)], existing });
  assert.deepEqual(summaryOf(plan), { skip: 1 });
});

test('updates only the differing fact fields', () => {
  const existing = [rec(1, { gametora_id: 5, slug: 's5', era_start: '2026-12-01', era_end: '2027-04-18', display_color: '#fb5f5f', name: 'My Name', short_name: 'gm' })];
  const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5)], existing });
  const [entry] = plan.entries;
  assert.equal(entry.action, 'update');
  assert.deepEqual(entry.changes, { era_start: { from: '2026-12-01', to: '2026-12-05' } });
});

test('seed-once: blank is seeded, hand-edited is kept, provisional is upgraded', () => {
  const blank = rec(1, { gametora_id: 5, slug: 's5', era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#fb5f5f', name: '', short_name: null });
  const edited = rec(2, { gametora_id: 5, slug: 's5', era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#fb5f5f', name: 'GM Legacy', short_name: 'gm' });
  const provisional = rec(3, { gametora_id: 5, slug: 's5', era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#fb5f5f', name: ' grand masters ', short_name: 'gm' });
  for (const [record, expected] of [[blank, { name: { from: null, to: 'Grandmasters Legacies Immortal' }, short_name: { from: null, to: 'grandmasters' } }], [edited, null], [provisional, { name: { from: 'grand masters', to: 'Grandmasters Legacies Immortal' } }]]) {
    const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5)], existing: [record] });
    if (expected === null) assert.equal(plan.entries[0].action, 'skip');
    else { assert.equal(plan.entries[0].action, 'update'); assert.deepEqual(plan.entries[0].changes, expected); }
  }
});

test('locked rows are reported and never diffed', () => {
  const existing = [rec(1, { gametora_id: 5, slug: 'anything', era_start: '2000-01-01', era_end: '2000-01-02', name: 'x', lock_facts: true })];
  const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5)], existing });
  assert.deepEqual(summaryOf(plan), { locked: 1 });
  assert.deepEqual(plan.entries[0].changes, {});
});

test('rows with a gametora_id GameTora no longer lists are dropped, never deleted', () => {
  const existing = [rec(1, { gametora_id: 99, name: 'Old' })];
  const plan = buildPlan({ table: 'scenarios', candidates: [], existing });
  assert.deepEqual(summaryOf(plan), { dropped: 1 });
  assert.equal(plan.entries[0].recordId, '1');
});

test('events link by event_number, resolve the scenario link, and never touch LoH rows', () => {
  const existing = [
    rec(7, { name: 'CM19 Scorpio', slug: 'cm19', event_type: 'Champions Meeting', event_number: 19, start_date: '2026-09-17', end_date: '2026-09-23', distance_class: 'Medium', distance_m: 2200, racecourse: 'Kyoto', direction: 'Right', season: 'Fall', track_condition: 'Firm', weather: 'Sunny', surface: 'Turf', scenario: [{ id: 1, fields: { name: 'Grand Live' } }] }),
    rec(8, { name: 'LoH1', slug: 'loh1', event_type: 'League of Heroes', event_number: 1, start_date: '2027-01-23', end_date: '2027-01-29' }),
  ];
  const scenarioIds = new Map([[3, '1'], [5, '2']]);
  const plan = buildPlan({ table: 'pvp_events', candidates: [eventCandidate(19), eventCandidate(45, { facts: { start_date: '2029-04-08', end_date: '2029-04-14' }, scenarioGametoraId: 14 })], existing, scenarioRecordIdByGametoraId: scenarioIds });
  assert.deepEqual(summaryOf(plan), { link: 1, create: 1, unmatched: 1 });
  const linked = plan.entries.find((e) => e.action === 'link');
  assert.equal(linked.recordId, '7');
  assert.deepEqual(linked.changes.gametora_id, { from: null, to: 19 });
  assert.deepEqual(linked.changes.start_date, { from: '2026-09-17', to: '2026-09-20' });
  assert.deepEqual(linked.changes.end_date, { from: '2026-09-23', to: '2026-09-26' });
  assert.deepEqual(linked.changes.status, { from: null, to: 'projected' });
  assert.equal(linked.changes.name, undefined);
  assert.equal(linked.link, null);
  const created = plan.entries.find((e) => e.action === 'create');
  assert.deepEqual(created.link, { field: 'scenario', from: null, to: 'new:14' });
  const loh = plan.entries.find((e) => e.action === 'unmatched');
  assert.equal(loh.recordId, '8');
  assert.equal(loh.suggestion, null);
});

test('an event whose derived scenario changed gets a link change', () => {
  const existing = [rec(7, { gametora_id: 19, name: 'CM19 Scorpio', slug: 'cm19', event_type: 'Champions Meeting', event_number: 19, start_date: '2026-09-20', end_date: '2026-09-26', distance_class: 'Medium', distance_m: 2200, racecourse: 'Kyoto', direction: 'Right', season: 'Fall', track_condition: 'Firm', weather: 'Sunny', surface: 'Turf', status: 'projected', scenario: [{ id: 1 }] })];
  const plan = buildPlan({ table: 'pvp_events', candidates: [eventCandidate(19, { scenarioGametoraId: 5 })], existing, scenarioRecordIdByGametoraId: new Map([[5, '2']]) });
  assert.equal(plan.entries[0].action, 'update');
  assert.deepEqual(plan.entries[0].changes, {});
  assert.deepEqual(plan.entries[0].link, { field: 'scenario', from: '1', to: '2' });
});

test('cards link by attachment id prefix only when the character name agrees', () => {
  const existing = [
    rec(8, { name: 'oguriwit', character_name: 'oguri cap', card_type: 'Wit', image: [{ title: '30146-Oguri-Cap-SSR-wit.png' }], rating: 'Borrow', styles: ['Pace'] }),
    rec(9, { name: 'other', character_name: 'Someone Else', card_type: 'Wit', image: [{ title: '30147-x.png' }] }),
    rec(10, { name: 'noimage', character_name: 'Oguri Cap', card_type: 'Speed' }),
  ];
  const candidates = [cardCandidate(30146), cardCandidate(30147, { facts: { character_name: 'Oguri Cap' } }), cardCandidate(30148, { facts: { card_type: 'Speed' } })];
  const plan = buildPlan({ table: 'support_cards', candidates, existing });
  assert.deepEqual(summaryOf(plan), { link: 1, create: 2, unmatched: 2 });
  const linked = plan.entries.find((e) => e.action === 'link');
  assert.equal(linked.recordId, '8');
  assert.equal(linked.changes.rating, undefined);
  assert.equal(linked.changes.name, undefined);
  assert.deepEqual(linked.changes.character_name, { from: 'oguri cap', to: 'Oguri Cap' });
  const noImage = plan.entries.find((e) => e.action === 'unmatched' && e.recordId === '10');
  assert.match(noImage.suggestion, /30148/);
});

test('two unlinked rows pointing at one candidate are both left unmatched', () => {
  const existing = [
    rec(1, { name: 'a', event_type: 'Champions Meeting', event_number: 19 }),
    rec(2, { name: 'b', event_type: 'Champions Meeting', event_number: 19 }),
  ];
  const plan = buildPlan({ table: 'pvp_events', candidates: [eventCandidate(19)], existing });
  assert.deepEqual(summaryOf(plan), { create: 1, unmatched: 2 });
  assert.match(plan.entries.find((e) => e.recordId === '1').note, /ambiguous/);
});

test('unmatched scenarios get the nearest era_start as a suggestion', () => {
  const existing = [rec(1, { name: 'Grand Masters', era_start: '2026-11-28', era_end: '2027-04-04' })];
  const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5), scenarioCandidate(6, { facts: { era_start: '2027-04-18' } })], existing });
  const unmatched = plan.entries.find((e) => e.action === 'unmatched');
  assert.match(unmatched.suggestion, /gametora_id 5/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../gametora/plan.mjs'`.

- [ ] **Step 3: Create the module**

Create `site/scripts/gametora/plan.mjs`:

```js
// Pure planner: diffs candidate rows against current NocoDB records. No I/O.
// Ownership tiers (see the spec): facts are importer-owned unless lock_facts;
// seeds are written when blank or still provisional; curated columns are never read for decisions.

const ACTIONS = ['create', 'link', 'update', 'skip', 'locked', 'unmatched', 'dropped'];
const LINK_FIELD = { pvp_events: 'scenario' };

export function relationIds(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map((item) => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return item?.id != null ? String(item.id) : item?.id_fields?.Id != null ? String(item.id_fields.Id) : null;
  }).filter(Boolean);
}

export function normalizeValue(value) {
  if (value == null) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

function foldedEquals(a, b) {
  return String(normalizeValue(a) ?? '').toLowerCase() === String(normalizeValue(b) ?? '').toLowerCase();
}

function numberOrNull(value) {
  const number = Number(value);
  return value != null && value !== '' && Number.isFinite(number) ? number : null;
}

function isLocked(fields) {
  const value = fields?.lock_facts;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function attachmentGametoraId(fields) {
  const first = Array.isArray(fields?.image) ? fields.image[0] : null;
  const match = /^(\d+)-/.exec(first?.title ?? '');
  return match ? Number(match[1]) : null;
}

// Link rules: which unlinked existing record a candidate may claim. Narrow on purpose.
function linkTarget(table, fields, candidatesById) {
  if (table === 'pvp_events') {
    if (normalizeValue(fields.event_type) !== 'Champions Meeting') return null;
    const number = numberOrNull(fields.event_number);
    return number != null && candidatesById.has(number) ? number : null;
  }
  if (table === 'support_cards') {
    const id = attachmentGametoraId(fields);
    const candidate = id != null ? candidatesById.get(id) : null;
    return candidate && foldedEquals(candidate.facts.character_name, fields.character_name) ? id : null;
  }
  return null;
}

function suggestionFor(table, fields, candidates) {
  if (table === 'support_cards') {
    const match = candidates.find((c) => foldedEquals(c.facts.character_name, fields.character_name) && foldedEquals(c.facts.card_type, fields.card_type));
    return match ? `gametora_id ${match.gametoraId} (${match.facts.character_name} / ${match.facts.card_type}${match.facts.title ? ` ${match.facts.title}` : ''})` : null;
  }
  if (table === 'scenarios') {
    const start = normalizeValue(fields.era_start);
    if (!start || !candidates.length) return null;
    const distance = (c) => Math.abs(Date.parse(c.facts.era_start) - Date.parse(start));
    const nearest = [...candidates].sort((a, b) => distance(a) - distance(b))[0];
    return `gametora_id ${nearest.gametoraId} (${nearest.label}, era_start ${nearest.facts.era_start})`;
  }
  return null;
}

function diffFields(candidate, fields) {
  const changes = {};
  for (const [column, value] of Object.entries(candidate.facts)) {
    const from = normalizeValue(fields[column]);
    const to = normalizeValue(value);
    if (from !== to) changes[column] = { from, to };
  }
  for (const [column, { value, alternatives }] of Object.entries(candidate.seeds ?? {})) {
    const current = normalizeValue(fields[column]);
    const to = normalizeValue(value);
    if (current === null && to !== null) changes[column] = { from: null, to };
    else if (current !== null && current !== to && alternatives.some((alt) => foldedEquals(alt, current))) changes[column] = { from: current, to };
  }
  return changes;
}

function linkChange(table, candidate, fields, scenarioRecordIdByGametoraId) {
  const field = LINK_FIELD[table];
  if (!field) return null;
  const from = fields ? relationIds(fields[field])[0] ?? null : null;
  const wanted = candidate.scenarioGametoraId;
  const to = wanted == null ? null : scenarioRecordIdByGametoraId.get(wanted) ?? `new:${wanted}`;
  return from === to ? null : { field, from, to };
}

export function buildPlan({ table, candidates, existing, scenarioRecordIdByGametoraId = new Map() }) {
  const entries = [];
  const candidatesById = new Map(candidates.map((c) => [c.gametoraId, c]));
  const claimed = new Set();

  // 1. Existing rows already keyed by gametora_id.
  const byGametoraId = new Map();
  const unlinked = [];
  for (const record of existing) {
    const id = numberOrNull(record.fields?.gametora_id);
    if (id == null) unlinked.push(record);
    else if (!byGametoraId.has(id)) byGametoraId.set(id, record);
    else entries.push({ action: 'dropped', gametoraId: id, recordId: record.id, label: String(record.fields?.name ?? record.id), changes: {}, link: null, suggestion: null, note: `duplicate gametora_id ${id}; first row wins` });
  }

  // 2. Link rules for unlinked rows. Ambiguous targets link nothing.
  const linkTargets = new Map();
  for (const record of unlinked) {
    const target = linkTarget(table, record.fields ?? {}, candidatesById);
    if (target != null) linkTargets.set(target, [...(linkTargets.get(target) ?? []), record]);
  }
  const linkedRecordByGametoraId = new Map();
  const ambiguous = new Set();
  for (const [gametoraId, records] of linkTargets) {
    if (records.length === 1) linkedRecordByGametoraId.set(gametoraId, records[0]);
    else for (const record of records) ambiguous.add(record.id);
  }

  // 3. One entry per candidate.
  for (const candidate of candidates) {
    const keyed = byGametoraId.get(candidate.gametoraId) ?? null;
    const linked = keyed ? null : linkedRecordByGametoraId.get(candidate.gametoraId) ?? null;
    const record = keyed ?? linked;
    const base = { gametoraId: candidate.gametoraId, label: candidate.label, suggestion: null, note: candidate.note ?? null };
    if (!record) {
      const changes = { gametora_id: { from: null, to: candidate.gametoraId } };
      for (const [column, value] of Object.entries(candidate.facts)) changes[column] = { from: null, to: normalizeValue(value) };
      for (const [column, { value }] of Object.entries(candidate.seeds ?? {})) changes[column] = { from: null, to: normalizeValue(value) };
      entries.push({ ...base, action: 'create', recordId: null, changes, link: linkChange(table, candidate, null, scenarioRecordIdByGametoraId) });
      continue;
    }
    claimed.add(record.id);
    const fields = record.fields ?? {};
    if (isLocked(fields)) { entries.push({ ...base, action: 'locked', recordId: record.id, changes: {}, link: null }); continue; }
    const changes = diffFields(candidate, fields);
    if (linked) changes.gametora_id = { from: null, to: candidate.gametoraId };
    const link = linkChange(table, candidate, fields, scenarioRecordIdByGametoraId);
    const action = linked ? 'link' : Object.keys(changes).length || link ? 'update' : 'skip';
    entries.push({ ...base, action, recordId: record.id, changes, link });
  }

  // 4. Leftovers: keyed rows GameTora dropped, and unlinked rows nothing claimed.
  for (const [gametoraId, record] of byGametoraId) {
    if (claimed.has(record.id)) continue;
    entries.push({ action: 'dropped', gametoraId, recordId: record.id, label: String(record.fields?.name ?? record.id), changes: {}, link: null, suggestion: null, note: 'gametora_id no longer listed by GameTora; row left as is' });
  }
  for (const record of unlinked) {
    if (claimed.has(record.id)) continue;
    const fields = record.fields ?? {};
    entries.push({
      action: 'unmatched', gametoraId: null, recordId: record.id, label: String(fields.name ?? record.id), changes: {}, link: null,
      suggestion: suggestionFor(table, fields, candidates),
      note: ambiguous.has(record.id) ? 'ambiguous: another unlinked row matches the same candidate; set gametora_id by hand' : null,
    });
  }

  const summary = Object.fromEntries(ACTIONS.map((action) => [action, entries.filter((e) => e.action === action).length]));
  return { entries, summary };
}
```

Trace for the card test: record 8 has attachment prefix `30146` and `character_name` "oguri cap", which case-folds equal to the candidate's "Oguri Cap", so it links; the fact diff then normalises both sides with `normalizeValue` (which trims but does not case-fold), so `character_name` shows as a change from "oguri cap" to "Oguri Cap". Record 9 has prefix `30147` but a different character, so it is not linked and becomes `unmatched`. Record 10 has no image; its suggestion is the Speed candidate for Oguri Cap, id 30148.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all passing. If the seed-once test fails on `short_name`, check that `normalizeValue(null)` returns `null` and that `changes.short_name` is produced for a `null` cell.

- [ ] **Step 5: Commit**

```bash
git add site/scripts/gametora/plan.mjs site/scripts/__tests__/plan.test.mjs
git commit -m "Add pure planner for GameTora to NocoDB upserts"
```

---

### Task 8: Schema check and apply helpers

**Files:**
- Create: `site/scripts/gametora/apply.mjs`
- Create: `site/scripts/__tests__/apply.test.mjs`

**Interfaces:**
- Consumes: `getTableMeta` result shape from Task 2; plan entries from Task 7; a NocoDB client from Task 2.
- Produces:
  - `export const REQUIRED_COLUMNS` — `{ scenarios: [...], pvp_events: [...], support_cards: [...] }` column titles.
  - `export function checkSchema({ table, meta, candidates })` → `{ errors: string[], columnIdByTitle: Map<string, string> }`. Errors name missing columns and select values with no matching option.
  - `export function fieldsForEntry(entry)` → object of `{ column: value }` from `entry.changes[*].to`, excluding the link field.
  - `export async function applyPlan({ client, tableId, plan, linkFieldId = null, log = console })` → `Promise<{ created: number, updated: number, failures: string[] }>`. Creates in batches of `BATCH_SIZE`, then updates, then link changes. A failing batch is logged and counted; the rest continues.

- [ ] **Step 1: Write the failing tests**

Create `site/scripts/__tests__/apply.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_COLUMNS, checkSchema, fieldsForEntry, applyPlan } from '../gametora/apply.mjs';
import { BATCH_SIZE } from '../lib/nocodb.mjs';

const col = (title, uidt = 'SingleLineText', options = null) => ({ id: `c_${title}`, title, uidt, options });
const eventMeta = { columns: [
  ...REQUIRED_COLUMNS.pvp_events.filter((t) => !['weather', 'racecourse', 'status', 'scenario'].includes(t)).map((t) => col(t)),
  col('weather', 'SingleSelect', ['Sunny', 'Cloudy', 'Rain', 'Snow']),
  col('racecourse', 'SingleSelect', ['Kyoto', 'Nakayama']),
  col('status', 'SingleSelect', ['confirmed', 'projected']),
  col('scenario', 'LinkToAnotherRecord'),
] };
const candidate = (facts) => ({ gametoraId: 1, label: 'x', facts, seeds: {}, scenarioGametoraId: null, note: null });

test('checkSchema passes when every column and option exists and returns column ids', () => {
  const { errors, columnIdByTitle } = checkSchema({ table: 'pvp_events', meta: eventMeta, candidates: [candidate({ weather: 'Rain', racecourse: 'Kyoto', status: 'projected' })] });
  assert.deepEqual(errors, []);
  assert.equal(columnIdByTitle.get('scenario'), 'c_scenario');
});

test('checkSchema reports missing columns and missing select options', () => {
  const meta = { columns: eventMeta.columns.filter((c) => c.title !== 'lock_facts') };
  const { errors } = checkSchema({ table: 'pvp_events', meta, candidates: [candidate({ weather: 'Rain', racecourse: 'Hakodate', status: 'projected' })] });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /missing column.*lock_facts/);
  assert.match(errors[1], /racecourse.*Hakodate/);
});

test('fieldsForEntry collects the target values and skips the link', () => {
  const entry = { action: 'create', changes: { gametora_id: { from: null, to: 19 }, name: { from: null, to: 'CM19' }, start_date: { from: '2026-09-17', to: '2026-09-20' } }, link: { field: 'scenario', from: null, to: '3' } };
  assert.deepEqual(fieldsForEntry(entry), { gametora_id: 19, name: 'CM19', start_date: '2026-09-20' });
});

function stubClient(failOn = () => false) {
  const calls = [];
  let nextId = 100;
  return {
    calls,
    async createRecords(tableId, fieldsList) { calls.push(['create', tableId, fieldsList]); if (failOn('create', fieldsList)) throw new Error('boom'); return fieldsList.map(() => ({ id: String(nextId++) })); },
    async updateRecords(tableId, updates) { calls.push(['update', tableId, updates]); if (failOn('update', updates)) throw new Error('boom'); },
    async linkRecords(tableId, field, recordId, ids) { calls.push(['link', tableId, field, recordId, ids]); },
    async unlinkRecords(tableId, field, recordId, ids) { calls.push(['unlink', tableId, field, recordId, ids]); },
  };
}
const quiet = { log() {}, warn() {}, error() {} };

test('applyPlan creates with inline links, updates, then relinks, and reports counts', async () => {
  const client = stubClient();
  const plan = { entries: [
    { action: 'create', recordId: null, changes: { gametora_id: { from: null, to: 45 }, name: { from: null, to: 'CM45' } }, link: { field: 'scenario', from: null, to: '2' } },
    { action: 'create', recordId: null, changes: { gametora_id: { from: null, to: 46 } }, link: { field: 'scenario', from: null, to: 'new:14' } },
    { action: 'link', recordId: '7', changes: { gametora_id: { from: null, to: 19 }, start_date: { from: 'a', to: 'b' } }, link: null },
    { action: 'update', recordId: '8', changes: {}, link: { field: 'scenario', from: '1', to: '2' } },
    { action: 'skip', recordId: '9', changes: {}, link: null },
    { action: 'locked', recordId: '10', changes: {}, link: null },
  ] };
  const result = await applyPlan({ client, tableId: 't', plan, linkFieldId: 'lnk', log: quiet });
  assert.deepEqual(result, { created: 2, updated: 2, failures: [] });
  assert.deepEqual(client.calls[0], ['create', 't', [{ gametora_id: 45, name: 'CM45', scenario: [{ id: '2' }] }, { gametora_id: 46 }]]);
  assert.deepEqual(client.calls[1], ['update', 't', [{ id: '7', fields: { gametora_id: 19, start_date: 'b' } }]]);
  assert.deepEqual(client.calls[2], ['unlink', 't', 'lnk', '8', ['1']]);
  assert.deepEqual(client.calls[3], ['link', 't', 'lnk', '8', ['2']]);
});

test('applyPlan batches creates by BATCH_SIZE and keeps going after a failed batch', async () => {
  const client = stubClient((op, batch) => op === 'create' && batch[0].gametora_id === 0);
  const plan = { entries: Array.from({ length: BATCH_SIZE + 3 }, (_, i) => ({ action: 'create', recordId: null, changes: { gametora_id: { from: null, to: i } }, link: null })) };
  const result = await applyPlan({ client, tableId: 't', plan, log: quiet });
  assert.equal(client.calls.filter((c) => c[0] === 'create').length, 2);
  assert.equal(result.created, 3);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /boom/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../gametora/apply.mjs'`.

- [ ] **Step 3: Create the module**

Create `site/scripts/gametora/apply.mjs`:

```js
import { BATCH_SIZE } from '../lib/nocodb.mjs';

const COMMON = ['gametora_id', 'lock_facts', 'name', 'slug'];
export const REQUIRED_COLUMNS = {
  scenarios: [...COMMON, 'short_name', 'era_start', 'era_end', 'display_color'],
  pvp_events: [...COMMON, 'event_number', 'event_type', 'start_date', 'end_date', 'distance_class', 'distance_m', 'racecourse', 'direction', 'season', 'track_condition', 'weather', 'surface', 'status', 'scenario'],
  support_cards: [...COMMON, 'character_name', 'card_type', 'rarity', 'title', 'release_date'],
};
const LINK_FIELDS = new Set(['scenario']);

export function checkSchema({ table, meta, candidates }) {
  const errors = [];
  const byTitle = new Map((meta.columns ?? []).map((column) => [column.title, column]));
  for (const title of REQUIRED_COLUMNS[table] ?? []) if (!byTitle.has(title)) errors.push(`${table}: missing column "${title}".`);
  const emitted = new Map();
  for (const candidate of candidates) {
    for (const [column, value] of Object.entries(candidate.facts ?? {})) {
      if (value == null) continue;
      if (!emitted.has(column)) emitted.set(column, new Set());
      emitted.get(column).add(String(value));
    }
  }
  for (const [column, values] of emitted) {
    const columnMeta = byTitle.get(column);
    if (!columnMeta || !Array.isArray(columnMeta.options)) continue;
    for (const value of values) if (!columnMeta.options.includes(value)) errors.push(`${table}: column "${column}" has no select option "${value}"; add it in NocoDB.`);
  }
  return { errors, columnIdByTitle: new Map([...byTitle].map(([title, column]) => [title, column.id])) };
}

export function fieldsForEntry(entry) {
  return Object.fromEntries(Object.entries(entry.changes ?? {}).filter(([column]) => !LINK_FIELDS.has(column)).map(([column, change]) => [column, change.to]));
}

function chunk(items) {
  const chunks = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) chunks.push(items.slice(i, i + BATCH_SIZE));
  return chunks;
}

function inlineLink(entry) {
  const to = entry.link?.to;
  return to && !String(to).startsWith('new:') ? { [entry.link.field]: [{ id: String(to) }] } : {};
}

export async function applyPlan({ client, tableId, plan, linkFieldId = null, log = console }) {
  const result = { created: 0, updated: 0, failures: [] };
  const creates = plan.entries.filter((entry) => entry.action === 'create');
  const updates = plan.entries.filter((entry) => entry.action === 'link' || entry.action === 'update');

  for (const batch of chunk(creates)) {
    try {
      await client.createRecords(tableId, batch.map((entry) => ({ ...fieldsForEntry(entry), ...inlineLink(entry) })));
      result.created += batch.length;
    } catch (error) {
      result.failures.push(`create batch (${batch.map((e) => e.label ?? e.changes?.gametora_id?.to).join(', ')}): ${error.message}`);
      log.error(result.failures.at(-1));
    }
    for (const entry of batch) if (String(entry.link?.to ?? '').startsWith('new:')) log.warn(`${entry.label ?? 'row'}: scenario ${entry.link.to} did not exist at apply time; link it on the next run.`);
  }

  const withFields = updates.filter((entry) => Object.keys(fieldsForEntry(entry)).length);
  for (const batch of chunk(withFields)) {
    try {
      await client.updateRecords(tableId, batch.map((entry) => ({ id: entry.recordId, fields: fieldsForEntry(entry) })));
      result.updated += batch.length;
    } catch (error) {
      result.failures.push(`update batch (${batch.map((e) => e.recordId).join(', ')}): ${error.message}`);
      log.error(result.failures.at(-1));
    }
  }

  for (const entry of updates) {
    if (!entry.link) continue;
    if (!linkFieldId) { result.failures.push(`record ${entry.recordId}: link change requested but no link field id known.`); continue; }
    if (String(entry.link.to ?? '').startsWith('new:')) { log.warn(`record ${entry.recordId}: scenario ${entry.link.to} does not exist yet; link it on the next run.`); continue; }
    try {
      if (entry.link.from) await client.unlinkRecords(tableId, linkFieldId, entry.recordId, [entry.link.from]);
      if (entry.link.to) await client.linkRecords(tableId, linkFieldId, entry.recordId, [entry.link.to]);
      if (!Object.keys(fieldsForEntry(entry)).length) result.updated += 1;
    } catch (error) {
      result.failures.push(`record ${entry.recordId} link: ${error.message}`);
      log.error(result.failures.at(-1));
    }
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add site/scripts/gametora/apply.mjs site/scripts/__tests__/apply.test.mjs
git commit -m "Add schema check and plan apply helpers for the GameTora importer"
```

---

### Task 9: Importer CLI

**Files:**
- Create: `site/scripts/import-uma-gametora.mjs`
- Modify: `site/package.json` (scripts)

**Interfaces:**
- Consumes everything from Tasks 1 to 8.
- Produces the commands `npm run import:uma` (dry run), `npm run import:uma:apply`, plus flags `--no-fetch` and `--json`.
- Exit codes: 0 clean; 1 on config, schema, GameTora, NocoDB read, or any apply failure.

- [ ] **Step 1: Add the npm scripts**

In `site/package.json` `scripts`, add:

```json
"import:uma": "node scripts/import-uma-gametora.mjs",
"import:uma:apply": "node scripts/import-uma-gametora.mjs --apply",
```

- [ ] **Step 2: Create the CLI**

Create `site/scripts/import-uma-gametora.mjs`:

```js
#!/usr/bin/env node
// Seeds and refreshes the Uma NocoDB tables from GameTora. Dry run by default; writes only with --apply.
// Design: docs/2026-09-07-uma-gametora-import-design.md
import path from 'node:path';
import { SITE_DIR, loadEnvironment } from './lib/env.mjs';
import { createNocodbClient } from './lib/nocodb.mjs';
import { createGametoraClient } from './gametora/client.mjs';
import { transformScenarios, transformEvents, transformSupportCards } from './gametora/transform.mjs';
import { buildPlan } from './gametora/plan.mjs';
import { checkSchema, applyPlan } from './gametora/apply.mjs';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const NO_FETCH = args.has('--no-fetch');
const JSON_OUTPUT = args.has('--json');
const CACHE_DIR = path.join(SITE_DIR, '.cache', 'gametora');
const DATASETS = {
  scenarios: 'scenarios',
  foresight: 'en/foresight/timeline',
  jpChampionsMeetings: 'events/champions-meeting',
  supportCards: 'support-cards',
  predictedReleases: 'en/foresight/predicted_releases',
};

function getConfig() {
  const names = {
    url: 'UMA_NOCODB_URL', token: 'UMA_NOCODB_TOKEN', baseId: 'UMA_NOCODB_BASE_ID',
    scenarios: 'UMA_IMPORT_NOCODB_SCENARIOS_TABLE_ID', pvp_events: 'UMA_IMPORT_NOCODB_PVP_EVENTS_TABLE_ID', support_cards: 'UMA_IMPORT_NOCODB_SUPPORT_CARDS_TABLE_ID',
  };
  const config = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, process.env[name]?.trim()]));
  const missing = Object.entries(config).filter(([, value]) => !value || value.startsWith('YOUR_')).map(([key]) => names[key]);
  if (missing.length) throw new Error(`Missing importer configuration: ${missing.join(', ')}. The UMA_IMPORT_* variables must name the tables the importer may write to.`);
  config.url = config.url.replace(/\/+$/, '');
  config.userAgent = process.env.GAMETORA_USER_AGENT?.trim() || undefined;
  return config;
}

function describeChange(column, { from, to }) { return `${column}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`; }

function printPlan(table, plan) {
  const { summary } = plan;
  console.log(`\n== ${table}: ${Object.entries(summary).filter(([, n]) => n).map(([action, n]) => `${n} ${action}`).join(', ') || 'nothing'}`);
  for (const entry of plan.entries) {
    if (entry.action === 'skip') continue;
    const parts = Object.entries(entry.changes).map(([column, change]) => describeChange(column, change));
    if (entry.link) parts.push(`${entry.link.field}: ${JSON.stringify(entry.link.from)} -> ${JSON.stringify(entry.link.to)}`);
    const where = entry.recordId ? `record ${entry.recordId}` : 'new row';
    const extras = [entry.suggestion && `suggest ${entry.suggestion}`, entry.note].filter(Boolean);
    console.log(`  [${entry.action}] ${entry.label} (${where})${parts.length ? `\n      ${parts.join('\n      ')}` : ''}${extras.length ? `\n      ${extras.join('\n      ')}` : ''}`);
  }
}

async function loadDatasets(gametora) {
  const manifest = await gametora.loadManifest();
  const datasets = {};
  for (const [name, key] of Object.entries(DATASETS)) {
    datasets[name] = await gametora.loadDataset(manifest, key);
    if (datasets[name] == null) console.warn(`GameTora manifest has no "${key}"; dependent rows will be skipped.`);
  }
  return datasets;
}

function scenarioIdMap(records) {
  const map = new Map();
  for (const record of records) {
    const id = Number(record.fields?.gametora_id);
    if (Number.isFinite(id) && !map.has(id)) map.set(id, record.id);
  }
  return map;
}

async function main() {
  loadEnvironment();
  const config = getConfig();
  const gametora = createGametoraClient({ cacheDir: CACHE_DIR, noFetch: NO_FETCH, userAgent: config.userAgent });
  const datasets = await loadDatasets(gametora);

  const scenarios = transformScenarios({ scenarios: datasets.scenarios ?? [], foresight: datasets.foresight ?? {} });
  const events = transformEvents({ foresight: datasets.foresight ?? {}, jpChampionsMeetings: datasets.jpChampionsMeetings ?? [], scenarioRows: scenarios.rows });
  const cards = transformSupportCards({ supportCards: datasets.supportCards ?? [], predictedReleases: datasets.predictedReleases ?? {} });
  for (const warning of [...scenarios.warnings, ...events.warnings, ...cards.warnings]) console.warn(`- ${warning}`);
  console.log(`GameTora: ${scenarios.rows.length} scenario(s), ${events.rows.length} Champions Meeting(s), ${cards.rows.length} support card(s) with a global date (${cards.skippedNoGlobalDate} without one skipped).`);

  const client = createNocodbClient({ url: config.url, token: config.token, baseId: config.baseId });
  const tables = [
    ['scenarios', config.scenarios, scenarios.rows],
    ['pvp_events', config.pvp_events, events.rows],
    ['support_cards', config.support_cards, cards.rows],
  ];
  const state = {};
  const schemaErrors = [];
  for (const [table, tableId, candidates] of tables) {
    const meta = await client.getTableMeta(tableId);
    const { errors, columnIdByTitle } = checkSchema({ table, meta, candidates });
    schemaErrors.push(...errors);
    state[table] = { tableId, candidates, columnIdByTitle, existing: await client.fetchAllRecords(tableId, table) };
  }
  if (schemaErrors.length) {
    console.error(`Schema check failed with ${schemaErrors.length} issue(s); nothing written:`);
    for (const error of schemaErrors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const output = {};
  let failures = 0;
  let scenarioIds = scenarioIdMap(state.scenarios.existing);
  for (const [table] of tables) {
    const { tableId, candidates, columnIdByTitle, existing } = state[table];
    const plan = buildPlan({ table, candidates, existing, scenarioRecordIdByGametoraId: scenarioIds });
    output[table] = plan;
    if (!JSON_OUTPUT) printPlan(table, plan);
    if (!APPLY) continue;
    const result = await applyPlan({ client, tableId, plan, linkFieldId: columnIdByTitle.get('scenario') ?? null });
    console.log(`  applied ${table}: ${result.created} created, ${result.updated} updated, ${result.failures.length} failed.`);
    failures += result.failures.length;
    if (table === 'scenarios') scenarioIds = scenarioIdMap(await client.fetchAllRecords(tableId, table));
  }
  if (JSON_OUTPUT) console.log(JSON.stringify(output, null, 2));
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to write the plan above.');
  if (failures) process.exitCode = 1;
}

main().catch((error) => { console.error(`Uma GameTora import failed: ${error.message}`); process.exitCode = 1; });
```

- [ ] **Step 3: Verify the guard rails by running without import variables**

Run: `npm run import:uma`
Expected: exits 1 with `Missing importer configuration: UMA_IMPORT_NOCODB_SCENARIOS_TABLE_ID, ...`. It must not reach NocoDB. This is the expected state until the admin creates staging tables (Task 12).

- [ ] **Step 4: Verify the GameTora half offline-capable**

Temporarily export the three `UMA_IMPORT_*` variables set to the string `dryrun-not-a-table` in the shell (not in `.env.local`) and run `npm run import:uma`.
Expected: the manifest and five datasets download into `site/.cache/gametora/`, the transform summary line prints (expect about 10 scenarios, 29 Champions Meetings, and around 340 cards), and then the run fails at `Table metadata request failed: 404` or similar, exit 1, with nothing written. Run again with `--no-fetch` and confirm no network calls are needed for the GameTora half (the `.cache/gametora/` files are reused). Unset the variables afterwards.

- [ ] **Step 5: Run the whole test suite**

Run: `npm test`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add site/package.json site/scripts/import-uma-gametora.mjs
git commit -m "Add Uma GameTora importer CLI (dry run by default)"
```

---

### Task 10: Sync publishes rated cards, GameTora thumbnails, rarity and title

**Files:**
- Modify: `site/scripts/sync-uma-nocodb.mjs` (`processImage` at lines 88 to 113, the card block at lines 188 to 207, `main()` at lines 218 to 239, the module-level `main()` call)
- Modify: `site/scripts/validate-uma-output.mjs:23`
- Create: `site/scripts/__tests__/sync-uma.test.mjs`

**Interfaces:**
- Produces: `export function createModel(scenarioRecords, eventRecords, supportCardRecords)` from the sync script (already exists, now exported) returning `{ scenarios, events, supportCards, imageTasks, errors, unrated }`. Image tasks are `{ key, kind: 'attachment', attachment }` or `{ key, kind: 'gametora', gametoraId }`. Cards gain `rarity` and `title` (string or null).
- The sync no longer runs `main()` when imported, only when executed directly.

- [ ] **Step 1: Make the sync importable and write the failing test**

At the bottom of `site/scripts/sync-uma-nocodb.mjs`, replace:

```js
main().catch((error) => { console.error(`Uma NocoDB sync failed: ${error.message}`); process.exitCode = 1; });
```

with:

```js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Uma NocoDB sync failed: ${error.message}`); process.exitCode = 1; });
}
```

and add `import { fileURLToPath } from 'node:url';` to the imports. Change `function createModel(` to `export function createModel(`.

Create `site/scripts/__tests__/sync-uma.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../sync-uma-nocodb.mjs';

const scenarioRecords = [{ id: '1', fields: { name: 'Grand Live', slug: 'grandlive', era_start: '2026-07-22', era_end: '2026-11-28' } }];
const eventRecords = [{ id: '1', fields: { name: 'CM19 Scorpio', slug: 'cm19', start_date: '2026-09-17', end_date: '2026-09-23', scenario: [{ id: 1 }], status: 'projected' } }];
const card = (id, fields) => ({ id: String(id), fields: { name: `card${id}`, character_name: 'Oguri Cap', card_type: 'Wit', styles: [], breakpoints: [], pvp_events: [], ...fields } });

test('only rated cards are published and the rest are counted', () => {
  const model = createModel(scenarioRecords, eventRecords, [card(1, { rating: 'Borrow' }), card(2, { rating: '' }), card(3, {})]);
  assert.deepEqual(model.supportCards.map((c) => c.id), ['1']);
  assert.equal(model.unrated, 2);
});

test('rarity and title are published as strings or null', () => {
  const model = createModel(scenarioRecords, eventRecords, [card(1, { rating: 'Borrow', rarity: 'SSR', title: '[Run Forth!]' }), card(2, { rating: 'Borrow' })]);
  assert.equal(model.supportCards[0].rarity, 'SSR');
  assert.equal(model.supportCards[0].title, '[Run Forth!]');
  assert.equal(model.supportCards[1].rarity, null);
  assert.equal(model.supportCards[1].title, null);
});

test('a card with an attachment uses it; without one but with a gametora_id it gets a GameTora task', () => {
  const attachment = { id: 'att1', signedPath: 'dltemp/x.png', title: '30146-oguri.png' };
  const model = createModel(scenarioRecords, eventRecords, [
    card(1, { rating: 'Borrow', image: [attachment], gametora_id: 30146 }),
    card(2, { rating: 'Borrow', gametora_id: 30118 }),
    card(3, { rating: 'Borrow' }),
  ]);
  const tasks = [...model.imageTasks.values()];
  assert.deepEqual(tasks.map((t) => t.kind), ['attachment', 'gametora']);
  assert.equal(tasks[1].gametoraId, 30118);
  assert.equal(model.supportCards[0].imageTaskKey, 'support-card:1:att1');
  assert.equal(model.supportCards[1].imageTaskKey, 'gametora:30118');
  assert.equal(model.supportCards[2].imageTaskKey, null);
  assert.equal(model.events[0].status, 'projected');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: the three sync tests FAIL (`unrated` undefined, `rarity` undefined, task kinds undefined). Everything else passes. If importing the sync triggers a NocoDB fetch, the `main()` guard from Step 1 is wrong.

- [ ] **Step 3: Change the card block in createModel**

Replace the card block (from `const imageTasks = new Map();` through the closing `});` of `supportCardRecords.map`) with:

```js
  const imageTasks = new Map();
  let unrated = 0;
  const supportCards = supportCardRecords.map((record) => {
    const fields = record.fields ?? {};
    const rating = text(field(fields, 'rating', 'Rating'));
    if (!rating) { unrated += 1; return null; }
    const name = text(field(fields, 'name', 'Name'));
    const characterName = text(field(fields, 'character_name', 'Character Name'));
    const gametoraId = Number(field(fields, 'gametora_id'));
    const attachment = Array.isArray(field(fields, 'image', 'Image')) ? field(fields, 'image', 'Image')[0] : null;
    let taskKey = null;
    if (attachment?.signedPath) {
      taskKey = `support-card:${record.id}:${attachment.id ?? 0}`;
      imageTasks.set(taskKey, { key: taskKey, kind: 'attachment', attachment });
    } else if (attachment) {
      errors.push(`Support card ${record.id}: image has no downloadable path; omitted.`);
    } else if (Number.isFinite(gametoraId) && gametoraId > 0) {
      taskKey = `gametora:${gametoraId}`;
      imageTasks.set(taskKey, { key: taskKey, kind: 'gametora', gametoraId });
    }
    return {
      id: String(record.id), slug: slugify(field(fields, 'slug', 'Slug') || name || characterName, `support-card-${record.id}`),
      name: name || characterName || 'Untitled support card', characterName,
      cardType: text(field(fields, 'card_type', 'Card Type')),
      rarity: text(field(fields, 'rarity', 'Rarity')),
      title: text(field(fields, 'title', 'Title')),
      rating,
      releaseDate: date(field(fields, 'release_date', 'Release Date')),
      styles: multiText(field(fields, 'styles', 'Styles')),
      breakpoints: multiText(field(fields, 'breakpoints', 'Breakpoints')),
      eventIds: relationIds(field(fields, 'pvp_events', 'PvP Events')).filter((id) => eventIds.has(id)),
      imageTaskKey: taskKey,
    };
  }).filter(Boolean);
```

and change the function's final `return { scenarios, events, supportCards, imageTasks, errors };` to `return { scenarios, events, supportCards, imageTasks, errors, unrated };`.

- [ ] **Step 4: Teach processImage about GameTora thumbnails**

Add after the `PUBLIC_IMAGE_ROOT` constant:

```js
const GAMETORA_THUMB_DIR = path.join(SITE_DIR, '.cache', 'uma', 'gametora-thumbs');
const GAMETORA_THUMB_URL = (id) => `https://gametora.com/images/umamusume/supports/support_card_s_${id}.png`;
```

Replace the whole `async function processImage(task, previous, baseUrl) { ... }` with:

```js
async function loadImageBuffer(task, baseUrl) {
  if (task.kind === 'gametora') {
    const file = path.join(GAMETORA_THUMB_DIR, `${task.gametoraId}.png`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
    const buffer = await downloadImage(GAMETORA_THUMB_URL(task.gametoraId));
    await sharp(buffer).metadata(); // throws on a non-image (for example an HTML error page)
    fs.mkdirSync(GAMETORA_THUMB_DIR, { recursive: true });
    fs.writeFileSync(file, buffer);
    return buffer;
  }
  let buffer = await downloadImage(new URL(task.attachment.signedPath, `${baseUrl}/`).href);
  try { await sharp(buffer).metadata(); } catch {
    const fallback = task.attachment?.thumbnails?.small?.signedPath || task.attachment?.thumbnails?.card_cover?.signedPath;
    if (!fallback) throw new Error(`${task.key}: attachment cannot be decoded and has no thumbnail fallback.`);
    buffer = await downloadImage(new URL(fallback, `${baseUrl}/`).href);
  }
  return buffer;
}

async function processImage(task, previous, baseUrl) {
  const signature = task.kind === 'gametora' ? `gametora:${task.gametoraId}` : fingerprint(attachmentSnapshot(task.attachment));
  if (previous?.signature === signature && imageFileExists(previous.image?.fallback?.url)) return previous;
  const buffer = await loadImageBuffer(task, baseUrl);
  const contentHash = hash(buffer);
  const stem = `${slugify(task.key, 'support-card')}-${contentHash.slice(0, 12)}`;
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const sources = {};
  for (const [format, options] of Object.entries({ avif: { quality: 60, effort: 3 }, webp: { quality: 78, effort: 4 } })) {
    const filename = `${stem}-240.${format}`;
    const file = path.join(IMAGE_DIR, filename);
    const info = fs.existsSync(file) ? await sharp(file).metadata() : await sharp(buffer).rotate().resize({ width: 240, height: 160, fit: 'cover', position: 'top' })[format](options).toFile(file);
    sources[format] = [{ url: `${PUBLIC_IMAGE_ROOT}/${filename}`, width: info.width, height: info.height }];
  }
  return { signature, image: { width: sources.webp[0].width, height: sources.webp[0].height, sources, fallback: sources.webp[0] } };
}
```

- [ ] **Step 5: Handle GameTora download failures softly in main()**

In `main()`, replace:

```js
  for (const task of model.imageTasks.values()) attachments[task.key] = await processImage(task, previous.attachments?.[task.key], config.url);
```

with:

```js
  for (const task of model.imageTasks.values()) {
    try {
      attachments[task.key] = await processImage(task, previous.attachments?.[task.key], config.url);
    } catch (error) {
      if (task.kind !== 'gametora') throw error;
      console.warn(`- ${task.key}: GameTora thumbnail unavailable (${error.message}); publishing without an image.`);
    }
  }
```

and replace `card.image = card.imageTaskKey ? attachments[card.imageTaskKey].image : null;` with `card.image = card.imageTaskKey ? attachments[card.imageTaskKey]?.image ?? null : null;`.

After the `if (model.errors.length) ...` line add:

```js
  if (model.unrated) console.log(`Held back ${model.unrated} unrated support card(s).`);
```

- [ ] **Step 6: Update the validator**

In `site/scripts/validate-uma-output.mjs`, the card check line currently reads:

```js
    if (!card.id || !card.slug || !card.name || !Array.isArray(card.styles) || !Array.isArray(card.breakpoints) || !Array.isArray(card.eventIds) || (card.rating != null && typeof card.rating !== 'string')) errors.push(`Support card ${card.id ?? 'unknown'}: invalid public fields.`);
```

Replace it with:

```js
    const optionalStrings = ['rating', 'rarity', 'title'].every((key) => card[key] == null || typeof card[key] === 'string');
    if (!card.id || !card.slug || !card.name || !Array.isArray(card.styles) || !Array.isArray(card.breakpoints) || !Array.isArray(card.eventIds) || !optionalStrings) errors.push(`Support card ${card.id ?? 'unknown'}: invalid public fields.`);
    if (!card.rating) errors.push(`Support card ${card.id}: published without a rating.`);
```

- [ ] **Step 7: Run the tests, then the real sync against the live base (read-only)**

Run: `npm test`
Expected: all passing.

Run: `npm run sync:uma` then `npm run validate:uma`
Expected: sync completes; every live card has a rating today so `Held back` is not printed; `rarity` and `title` are `null` for every card because the live tables have no such columns yet; validation passes. Check `git status` shows only the three script files changed.

- [ ] **Step 8: Commit**

```bash
git add site/scripts/sync-uma-nocodb.mjs site/scripts/validate-uma-output.mjs site/scripts/__tests__/sync-uma.test.mjs
git commit -m "Uma sync: publish rated cards only, GameTora thumbnails, rarity and title"
```

---

### Task 11: Documentation and environment template

**Files:**
- Modify: `site/.env.example`
- Modify: `site/WORKFLOW.md` (new section after "Editing the Uma timeline in NocoDB")
- Modify: `AGENTS.md` (commands block and architecture list)

- [ ] **Step 1: Extend .env.example**

Append to `site/.env.example`:

```
# Separate Uma Musume Global base (read targets for the sync)
UMA_NOCODB_URL=https://noco.cuddlebuns.moe
UMA_NOCODB_TOKEN=YOUR_UMA_TOKEN_HERE
UMA_NOCODB_BASE_ID=YOUR_UMA_BASE_ID
UMA_NOCODB_SCENARIOS_TABLE_ID=YOUR_SCENARIOS_TABLE_ID
UMA_NOCODB_PVP_EVENTS_TABLE_ID=YOUR_PVP_EVENTS_TABLE_ID
UMA_NOCODB_SUPPORT_CARDS_TABLE_ID=YOUR_SUPPORT_CARDS_TABLE_ID

# Write targets for the GameTora importer. Leave unset unless you have staging tables.
# The importer refuses to run without them and only writes with --apply.
UMA_IMPORT_NOCODB_SCENARIOS_TABLE_ID=
UMA_IMPORT_NOCODB_PVP_EVENTS_TABLE_ID=
UMA_IMPORT_NOCODB_SUPPORT_CARDS_TABLE_ID=
# Optional: override the User-Agent sent to GameTora.
# GAMETORA_USER_AGENT=
```

- [ ] **Step 2: Add the WORKFLOW.md section**

Insert after the "Editing the Uma timeline in NocoDB" section (before "## Local commands"):

```markdown
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
```

- [ ] **Step 3: Update AGENTS.md**

In the commands block add after `npm run validate:uma`:

```
npm test               # node:test suites for the sync helpers and the GameTora importer
npm run import:uma     # dry run: plan GameTora -> NocoDB upserts for the Uma tables (needs UMA_IMPORT_*)
npm run import:uma:apply  # perform the plan; only ever against tables named by UMA_IMPORT_*
```

In the "Architecture" numbered list add a new item 3 (renumber the rest):

```
3. `scripts/import-uma-gametora.mjs` seeds the three Uma NocoDB tables from GameTora's public
   JSON (`scripts/gametora/`: cached client, pure transform, pure planner, apply helpers). It is
   dry-run by default, writes only with `--apply` to tables named by `UMA_IMPORT_NOCODB_*`, owns
   fact columns keyed by `gametora_id`, and never touches rating, styles, breakpoints, links, or
   images. A nightly timer runs it on the VPS. Design: `docs/2026-09-07-uma-gametora-import-design.md`.
```

In the "Commands" section, the sentence saying the `UMA_NOCODB_*` variables "are documented in `WORKFLOW.md`, not in `.env.example`" is now stale; change it to say both files list them and that the `UMA_IMPORT_*` variables stay empty unless staging tables exist.

In "Conventions and constraints" add:

```
- Never point `UMA_IMPORT_NOCODB_*` at the live Uma tables from a developer machine. Staging
  copies only; the VPS env owns the live ids after cutover.
```

- [ ] **Step 4: Commit**

```bash
git add site/.env.example site/WORKFLOW.md AGENTS.md
git commit -m "Document the GameTora importer, admin checklist, and cutover"
```

---

### Task 12: VPS wrapper and nightly timer

**Files:**
- Create: `vps-scripts/import-uma-gametora.sh` (executable)
- Create: `vps-scripts/systemd/cuddlebuns-uma-import.service`
- Create: `vps-scripts/systemd/cuddlebuns-uma-import.timer`

- [ ] **Step 1: Create the wrapper**

Create `vps-scripts/import-uma-gametora.sh`:

```bash
#!/usr/bin/env bash
# Runs on the VPS nightly. NocoDB credentials and UMA_IMPORT_* come from the systemd EnvironmentFile.
set -euo pipefail

SOURCE_DIR="${CUDDLEBUNS_SOURCE_DIR:-/var/www/cuddlebuns/source}"
SITE_DIR="$SOURCE_DIR/site"

if [[ ! -f "$SITE_DIR/package.json" ]]; then
  echo "Missing source checkout at $SITE_DIR" >&2
  exit 1
fi
if [[ ! -d "$SITE_DIR/node_modules" ]]; then
  echo "Run npm ci in $SITE_DIR before enabling the timer." >&2
  exit 1
fi
if [[ -z "${UMA_IMPORT_NOCODB_SCENARIOS_TABLE_ID:-}" || -z "${UMA_IMPORT_NOCODB_PVP_EVENTS_TABLE_ID:-}" || -z "${UMA_IMPORT_NOCODB_SUPPORT_CARDS_TABLE_ID:-}" ]]; then
  echo "UMA_IMPORT_NOCODB_* not configured; skipping GameTora import."
  exit 0
fi

cd "$SITE_DIR"
node scripts/import-uma-gametora.mjs --apply
```

Run `git update-index --chmod=+x vps-scripts/import-uma-gametora.sh` after adding it so the executable bit is tracked (the repo is checked out on Windows).

- [ ] **Step 2: Create the systemd units**

Create `vps-scripts/systemd/cuddlebuns-uma-import.service`:

```ini
[Unit]
Description=Seed Uma NocoDB tables from GameTora
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=masterpyon
Group=www-cuddlebuns
WorkingDirectory=/var/www/cuddlebuns/source/site
EnvironmentFile=/etc/cuddlebuns/gallery.env
Environment=NODE_ENV=production
ExecStart=/var/www/cuddlebuns/source/vps-scripts/import-uma-gametora.sh

[Install]
WantedBy=multi-user.target
```

Create `vps-scripts/systemd/cuddlebuns-uma-import.timer`:

```ini
[Unit]
Description=Nightly GameTora import for the Uma timeline

[Timer]
OnCalendar=*-*-* 23:30:00 UTC
RandomizedDelaySec=10min
Persistent=true
Unit=cuddlebuns-uma-import.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Verify shell syntax**

Run from the repo root: `bash -n vps-scripts/import-uma-gametora.sh`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add vps-scripts/import-uma-gametora.sh vps-scripts/systemd/cuddlebuns-uma-import.service vps-scripts/systemd/cuddlebuns-uma-import.timer
git update-index --chmod=+x vps-scripts/import-uma-gametora.sh
git commit -m "Add nightly VPS timer for the GameTora importer"
```

---

### Task 13 [ops]: Staging verification

Needs a human with NocoDB access. Nothing in this task is code.

- [ ] **Step 1:** In the Uma base, duplicate `scenarios`, `pvp_events`, and `support_cards` with their data. Apply the admin checklist from WORKFLOW.md to the copies (columns, select options). Note the three new table ids.
- [ ] **Step 2:** Put the ids in `site/.env.local` as `UMA_IMPORT_NOCODB_SCENARIOS_TABLE_ID`, `UMA_IMPORT_NOCODB_PVP_EVENTS_TABLE_ID`, `UMA_IMPORT_NOCODB_SUPPORT_CARDS_TABLE_ID`. Leave `UMA_NOCODB_*` untouched.
- [ ] **Step 3:** Run `npm run import:uma`. Confirm: no schema errors; CM19 to CM44 listed as `link`; CM45 to CM47 as `create`; League of Heroes rows as `unmatched` with no suggestion; all ten scenarios `unmatched` with a suggestion each; most cards `link`. Read every `update` line for the linked CMs: expect date shifts to GameTora's estimates, `status` set to `projected`, and CM44 surface plus CM43 end date changing (spec "Open points"). Tick `lock_facts` on any row you want to keep.
- [ ] **Step 4:** Set `gametora_id` on the ten staging scenario rows from the suggestions. Re-run the dry run; scenarios should now be `update` or `skip`, and the Grand Live and Grand Masters names will show an upgrade to the official long names unless you edit them first.
- [ ] **Step 5:** Run `npm run import:uma:apply`, then `npm run import:uma`. The second run must report only `skip`, `locked`, and `unmatched`. If anything shows `update` on the second run, stop and report it as a bug in normalisation.
- [ ] **Step 6:** Temporarily set `UMA_NOCODB_*_TABLE_ID` to the staging ids, run `npm run sync:uma` and `npm run validate:uma`, then `npm run dev` and open `/uma/timeline`. Expect: the same cards as live (only rated ones publish), new CM45 to CM47 on the axis, projected styling on CM events, GameTora thumbnails for any card you rate that has no attachment. Restore `UMA_NOCODB_*_TABLE_ID` to live afterwards and re-run `npm run sync:uma`.
- [ ] **Step 7:** Rate a handful of newly seeded cards in staging and repeat Step 6 to see them appear.

---

### Task 14 [ops]: Cutover

Needs a human with NocoDB and VPS access.

- [ ] **Step 1:** Apply the admin checklist to the live tables. Set `gametora_id` on the ten live scenario rows (same values as staging). Tick `lock_facts` on any live row that must not change.
- [ ] **Step 2:** On the VPS, pull `main`, run `npm ci` in `site/` if the lockfile changed, and add the three `UMA_IMPORT_NOCODB_*` variables with the live ids to `/etc/cuddlebuns/gallery.env`.
- [ ] **Step 3:** From `/var/www/cuddlebuns/source/site`, run `node scripts/import-uma-gametora.mjs` as the service user with the env file loaded, read the plan, then run it with `--apply`. Within five minutes the sync timer rebuilds the site; confirm `/uma/timeline` on the live domain.
- [ ] **Step 4:** Install and enable the timer:

```bash
sudo cp /var/www/cuddlebuns/source/vps-scripts/systemd/cuddlebuns-uma-import.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cuddlebuns-uma-import.timer
systemctl list-timers cuddlebuns-uma-import.timer
```

- [ ] **Step 5:** After the first nightly run, check `journalctl -u cuddlebuns-uma-import.service` for a plan that is all `skip` (or a small set of date updates), and drop the staging tables.

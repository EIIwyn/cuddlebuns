# PocketBase CMS Migration Implementation Plan

  > **For agentic workers:** Work one task at a time, in order. For each task: write the failing test first, run it, implement, run again, then commit before moving on. Tick the `- [ ]` checkboxes as you go so a reviewer can see progress. Tasks tagged [ops] need a human with VPS or NocoDB access; stop and hand over when you reach one.

**Goal:** Replace NocoDB with a self-hosted PocketBase instance as the content source for cuddlebuns.moe, migrate all existing content, and leave the build, validate, and deploy pipeline unchanged.

**Architecture:** PocketBase runs as one Docker container on the VPS behind Caddy at `cms.cuddlebuns.moe`. The two sync scripts keep their model, image, and output layers and swap only their fetch layer to a shared PocketBase client. A one-time migration script copies every NocoDB record and image into PocketBase. Nothing under `site/src/` changes.

**Tech Stack:** Node 22+ (uses built-in `node:test`, `fetch`, `FormData`, `Blob`), sharp, PocketBase 0.39.x in an Alpine container, Docker Compose, Caddy, systemd.

**Spec:** `docs/2026-09-04-option-1-pocketbase-cms-design.md`

## Global Constraints

- Public JSON output shapes (`site.json`, `gallery/<character>--<version>.json`, `uma/timeline.json`) must not change. The frontend and both output validators are the contract.
- The `ModernImage` descriptor shape `{ fallback: {url,width,height}, sources: { avif: [...], webp: [...] }, width, height }` stays identical.
- Public commission cards are titled `[Type] by Artist`. `internal_title` is never written to public JSON.
- Secrets (`CMS_PASSWORD`, old `NOCODB_TOKEN`) are never prefixed `VITE_`, never committed, never referenced from `site/src/`.
- `MANIFEST_VERSION` in the gallery sync is bumped from 3 to 4 because the cached attachment snapshot shape changes.
- Change detection contract stays: `--check` exits 0 when current, 10 when a rebuild is needed, 1 on error.
- Only `name` fields are required at the PocketBase schema level. "Draft now, publish later" must keep working; completeness is enforced by the sync at publish time, exactly as today. This is a deliberate deviation from the spec table, which marked `type`, `image`, and `source_url` as required.
- `styles` on support cards is a JSON array field, not a select, because the set of running styles is not enumerated anywhere. Deviation from the spec table.
- Every collection gets a `legacy_id` number field holding the NocoDB record ID. It makes the migration re-runnable and is ignored by the sync.
- PocketBase stores an unset number as `0`, an unset text as `""`, an unset single relation or file as `""`, and unset multi-value fields as `[]`. Sync code treats `0` as "no display order" and `""` as null.
- All npm commands run from `site/`. On Windows PowerShell use `npm.cmd`.
- Commit after every task. Never commit `.env.local`, `.cache/`, `public/data/`, or `public/generated/`.

## Roles

Tasks are tagged so a team can split them:

- **[code]** — done at a laptop against the repo. A subagent can do these end to end.
- **[ops]** — needs SSH to the VPS, DNS access, or NocoDB admin credentials. A human does these; the steps are exact commands.

---

## File Structure

New files:

| Path | Responsibility |
|------|----------------|
| `site/scripts/lib/env.mjs` | Load `site/.env.local` into `process.env` (one copy instead of two). |
| `site/scripts/lib/pocketbase-client.mjs` | Config reading, login, paged listing, file URLs, record and collection creation, retries. Pure function of an injected `fetch`. |
| `site/scripts/pocketbase-schema.mjs` | Declares the eight collections and creates any that are missing. Idempotent. |
| `site/scripts/migrate/nocodb-source.mjs` | Copy of the old NocoDB fetch code, used only by the migration. Deleted at the end. |
| `site/scripts/migrate/transform.mjs` | Pure NocoDB-record to PocketBase-body mapping. Unit tested. Deleted at the end. |
| `site/scripts/migrate/migrate-nocodb-to-pocketbase.mjs` | One-time migration CLI. Deleted at the end. |
| `site/scripts/migrate/compare-output.mjs` | Diffs baseline output against PocketBase-based output. Deleted at the end. |
| `site/scripts/tests/*.test.mjs` | `node:test` suites. |
| `vps-scripts/pocketbase/Dockerfile` | Alpine image with the pinned PocketBase binary. |
| `vps-scripts/docker-compose.yml` | The one PocketBase service. |

Modified files:

| Path | Change |
|------|--------|
| `site/scripts/sync-nocodb.mjs` | Fetch layer, field names, attachment shape, exported `createModel`. Renamed to `sync-gallery.mjs` in Task 12. |
| `site/scripts/sync-uma-nocodb.mjs` | Same. Renamed to `sync-uma.mjs` in Task 12. |
| `site/package.json` | `test`, `schema:cms`, `migrate:cms` scripts. |
| `site/eslint.config.js` | Node globals for `scripts/**/*.mjs`. |
| `site/.env.example`, `site/WORKFLOW.md`, `AGENTS.md` | New variables and editing instructions. |
| `cuddlebuns.caddy` | `cms.cuddlebuns.moe` site block. |
| `vps-scripts/systemd/*` | Descriptions only. |

---

### Task 1: Test harness and lint fix [code]

**Files:**
- Modify: `site/package.json`
- Modify: `site/eslint.config.js`
- Create: `site/scripts/tests/smoke.test.mjs`

**Interfaces:**
- Produces: `npm test` runs every `site/scripts/tests/*.test.mjs` with the built-in runner.

- [ ] **Step 1: Add the test script**

In `site/package.json` `scripts`, add:

```json
"test": "node --test \"scripts/tests/*.test.mjs\""
```

- [ ] **Step 2: Write a smoke test**

Create `site/scripts/tests/smoke.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Run it**

Run from `site/`: `npm test`
Expected: `# pass 1`, exit code 0.

- [ ] **Step 4: Give the `.mjs` scripts node globals in ESLint**

In `site/eslint.config.js`, change the last block from `files: ['scripts/**/*.js']` to:

```js
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
```

`globals.browser` is kept because the scripts use `fetch`, `FormData`, `Blob`, and `Response`, which the `globals` package lists under browser.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors from `scripts/`. (If `node_modules` is missing, run `npm ci` first.)

- [ ] **Step 6: Commit**

```bash
git add site/package.json site/eslint.config.js site/scripts/tests/smoke.test.mjs
git commit -m "chore: add node:test harness and lint node globals for .mjs scripts"
```

---

### Task 2: Shared env loader and PocketBase client [code]

**Files:**
- Create: `site/scripts/lib/env.mjs`
- Create: `site/scripts/lib/pocketbase-client.mjs`
- Test: `site/scripts/tests/pocketbase-client.test.mjs`

**Interfaces:**
- Produces: `loadEnvironment(siteDir)` — reads `<siteDir>/.env.local` into `process.env` without overriding existing values.
- Produces: `getPocketBaseConfig(env = process.env)` → `{ url, email, password }`; throws `Missing PocketBase configuration: CMS_URL, ...`.
- Produces: `createPocketBaseClient(config, options)` → `{ authenticate(), listAll(collection, { sort, filter }), fileUrl(collection, recordId, filename), createRecord(collection, body), getCollection(name), createCollection(definition) }`.
  - `options`: `{ fetch, sleep, maxAttempts = 4, retryBaseMs = 4000, timeoutMs = 120000, pageSize = 200 }`.
  - `listAll` logs in on first use, returns all records across pages sorted by `id`.
  - `createRecord` accepts a plain object (sent as JSON) or a `FormData` (sent as multipart).
  - `getCollection` returns `null` on 404.

- [ ] **Step 1: Write the failing client tests**

Create `site/scripts/tests/pocketbase-client.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPocketBaseConfig, createPocketBaseClient } from '../lib/pocketbase-client.mjs';

const CONFIG = { url: 'http://pb.test', email: 'sync@example.com', password: 'secret' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Routes: [{ match: substring of URL, respond: (url, init) => Response }]
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const route = routes.find((candidate) => String(url).includes(candidate.match));
    if (!route) throw new Error(`Unexpected request: ${url}`);
    return route.respond(String(url), init, calls.length);
  };
  impl.calls = calls;
  return impl;
}

const noSleep = async () => {};

test('getPocketBaseConfig reports every missing variable', () => {
  assert.throws(
    () => getPocketBaseConfig({ CMS_URL: 'http://x' }),
    /Missing PocketBase configuration: CMS_EMAIL, CMS_PASSWORD/,
  );
});

test('getPocketBaseConfig strips a trailing slash and rejects placeholders', () => {
  const config = getPocketBaseConfig({ CMS_URL: 'http://x/', CMS_EMAIL: 'a@b', CMS_PASSWORD: 'p' });
  assert.equal(config.url, 'http://x');
  assert.throws(
    () => getPocketBaseConfig({ CMS_URL: 'http://x', CMS_EMAIL: 'a@b', CMS_PASSWORD: 'YOUR_PASSWORD' }),
    /CMS_PASSWORD/,
  );
});

test('listAll logs in once, sends the token, and walks every page', async () => {
  const fetchImpl = fakeFetch([
    {
      match: '/api/collections/_superusers/auth-with-password',
      respond: (_url, init) => {
        const body = JSON.parse(init.body);
        assert.deepEqual(body, { identity: 'sync@example.com', password: 'secret' });
        return jsonResponse({ token: 'tok123' });
      },
    },
    {
      match: '/api/collections/artists/records',
      respond: (url, init) => {
        assert.equal(init.headers.Authorization, 'tok123');
        const page = Number(new URL(url).searchParams.get('page'));
        assert.equal(new URL(url).searchParams.get('perPage'), '2');
        assert.equal(new URL(url).searchParams.get('sort'), 'id');
        const pages = {
          1: { items: [{ id: 'a1' }, { id: 'a2' }], totalPages: 2 },
          2: { items: [{ id: 'a3' }], totalPages: 2 },
        };
        return jsonResponse(pages[page]);
      },
    },
  ]);
  const client = createPocketBaseClient(CONFIG, { fetch: fetchImpl, sleep: noSleep, pageSize: 2 });
  const records = await client.listAll('artists');
  assert.deepEqual(records.map((record) => record.id), ['a1', 'a2', 'a3']);
  const logins = fetchImpl.calls.filter((call) => call.url.includes('auth-with-password'));
  assert.equal(logins.length, 1);
});

test('listAll passes a filter through', async () => {
  const fetchImpl = fakeFetch([
    { match: 'auth-with-password', respond: () => jsonResponse({ token: 't' }) },
    {
      match: '/records',
      respond: (url) => {
        assert.equal(new URL(url).searchParams.get('filter'), 'legacy_id=7');
        return jsonResponse({ items: [], totalPages: 1 });
      },
    },
  ]);
  const client = createPocketBaseClient(CONFIG, { fetch: fetchImpl, sleep: noSleep });
  assert.deepEqual(await client.listAll('artists', { filter: 'legacy_id=7' }), []);
});

test('requests retry on 503 and then succeed', async () => {
  let attempts = 0;
  const fetchImpl = fakeFetch([
    { match: 'auth-with-password', respond: () => jsonResponse({ token: 't' }) },
    {
      match: '/records',
      respond: () => {
        attempts += 1;
        return attempts < 3 ? jsonResponse({ message: 'down' }, 503) : jsonResponse({ items: [{ id: 'x' }], totalPages: 1 });
      },
    },
  ]);
  const client = createPocketBaseClient(CONFIG, { fetch: fetchImpl, sleep: noSleep });
  const records = await client.listAll('artists');
  assert.equal(records.length, 1);
  assert.equal(attempts, 3);
});

test('a 400 is not retried and surfaces the server message', async () => {
  const fetchImpl = fakeFetch([
    { match: 'auth-with-password', respond: () => jsonResponse({ message: 'Failed to authenticate.' }, 400) },
  ]);
  const client = createPocketBaseClient(CONFIG, { fetch: fetchImpl, sleep: noSleep });
  await assert.rejects(client.authenticate(), /PocketBase login failed: 400[\s\S]*Failed to authenticate/);
  assert.equal(fetchImpl.calls.length, 1);
});

test('fileUrl encodes each path segment', () => {
  const client = createPocketBaseClient(CONFIG, { fetch: fakeFetch([]) });
  assert.equal(
    client.fileUrl('commissions', 'abc 123', 'my image.png'),
    'http://pb.test/api/files/commissions/abc%20123/my%20image.png',
  );
});

test('createRecord sends JSON for objects and multipart for FormData', async () => {
  const fetchImpl = fakeFetch([
    { match: 'auth-with-password', respond: () => jsonResponse({ token: 't' }) },
    {
      match: '/api/collections/artists/records',
      respond: (_url, init) => {
        if (init.body instanceof FormData) {
          assert.equal(init.headers['content-type'], undefined);
          assert.equal(init.body.get('name'), 'Form Artist');
          return jsonResponse({ id: 'form1' });
        }
        assert.equal(init.headers['content-type'], 'application/json');
        assert.deepEqual(JSON.parse(init.body), { name: 'Json Artist' });
        return jsonResponse({ id: 'json1' });
      },
    },
  ]);
  const client = createPocketBaseClient(CONFIG, { fetch: fetchImpl, sleep: noSleep });
  assert.equal((await client.createRecord('artists', { name: 'Json Artist' })).id, 'json1');
  const form = new FormData();
  form.append('name', 'Form Artist');
  assert.equal((await client.createRecord('artists', form)).id, 'form1');
});

test('getCollection returns null on 404 and the body otherwise', async () => {
  const fetchImpl = fakeFetch([
    { match: 'auth-with-password', respond: () => jsonResponse({ token: 't' }) },
    { match: '/api/collections/missing', respond: () => jsonResponse({ message: 'not found' }, 404) },
    { match: '/api/collections/artists', respond: () => jsonResponse({ id: 'col1', name: 'artists' }) },
  ]);
  const client = createPocketBaseClient(CONFIG, { fetch: fetchImpl, sleep: noSleep });
  assert.equal(await client.getCollection('missing'), null);
  assert.equal((await client.getCollection('artists')).id, 'col1');
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../lib/pocketbase-client.mjs'`.

- [ ] **Step 3: Write the env loader**

Create `site/scripts/lib/env.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';

// Reads KEY=value lines from <siteDir>/.env.local into process.env.
// Existing process.env values win, so the VPS systemd EnvironmentFile takes precedence.
export function loadEnvironment(siteDir) {
  const envFile = path.join(siteDir, '.env.local');
  if (!fs.existsSync(envFile)) return;

  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
```

- [ ] **Step 4: Write the client**

Create `site/scripts/lib/pocketbase-client.mjs`:

```js
// Minimal PocketBase REST client for the sync and migration scripts.
// No SDK dependency: the three calls we need are plain fetch requests.

const VARIABLE_NAMES = { url: 'CMS_URL', email: 'CMS_EMAIL', password: 'CMS_PASSWORD' };

export function getPocketBaseConfig(env = process.env) {
  const config = Object.fromEntries(
    Object.entries(VARIABLE_NAMES).map(([key, name]) => [key, env[name]?.trim()]),
  );
  const missing = Object.entries(config)
    .filter(([, value]) => !value || value.startsWith('YOUR_'))
    .map(([key]) => VARIABLE_NAMES[key]);
  if (missing.length) {
    throw new Error(`Missing PocketBase configuration: ${missing.join(', ')}`);
  }
  config.url = config.url.replace(/\/+$/, '');
  return config;
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPocketBaseClient(config, {
  fetch: fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  maxAttempts = 4,
  retryBaseMs = 4000,
  timeoutMs = 120_000,
  pageSize = 200,
} = {}) {
  let token = null;

  async function request(pathname, init = {}, label = pathname) {
    const url = `${config.url}${pathname}`;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          ...init,
          headers: { ...(token ? { Authorization: token } : {}), ...(init.headers ?? {}) },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) break;
        const delay = retryBaseMs * attempt;
        console.warn(`${label}: request error (${error?.name || 'error'}); retrying in ${Math.round(delay / 1000)}s (${attempt}/${maxAttempts})...`);
        await sleep(delay);
        continue;
      }
      if (response.ok) return response;

      const detail = (await response.text()).slice(0, 500);
      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        throw new Error(`${label} failed: ${response.status} ${response.statusText}\n${detail}`);
      }
      const delay = retryBaseMs * attempt;
      console.warn(`${label}: ${response.status}; retrying in ${Math.round(delay / 1000)}s (${attempt}/${maxAttempts})...`);
      await sleep(delay);
    }
    throw lastError ?? new Error(`${label} failed.`);
  }

  async function authenticate() {
    const response = await request('/api/collections/_superusers/auth-with-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: config.email, password: config.password }),
    }, 'PocketBase login');
    const data = await response.json();
    if (!data?.token) throw new Error('PocketBase login returned no token.');
    token = data.token;
  }

  async function ensureAuthenticated() {
    if (!token) await authenticate();
  }

  async function listAll(collection, { sort = 'id', filter } = {}) {
    await ensureAuthenticated();
    const records = [];
    let page = 1;
    let totalPages = 1;
    do {
      const params = new URLSearchParams({ page: String(page), perPage: String(pageSize), sort });
      if (filter) params.set('filter', filter);
      const response = await request(
        `/api/collections/${encodeURIComponent(collection)}/records?${params}`,
        {},
        `${collection} page ${page}`,
      );
      const data = await response.json();
      records.push(...(data.items ?? []));
      totalPages = data.totalPages ?? 1;
      page += 1;
    } while (page <= totalPages);
    console.log(`Fetched ${records.length} ${collection} record(s).`);
    return records;
  }

  function fileUrl(collection, recordId, filename) {
    return `${config.url}/api/files/${encodeURIComponent(collection)}/${encodeURIComponent(recordId)}/${encodeURIComponent(filename)}`;
  }

  async function createRecord(collection, body) {
    await ensureAuthenticated();
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const response = await request(`/api/collections/${encodeURIComponent(collection)}/records`, {
      method: 'POST',
      headers: isForm ? {} : { 'content-type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
    }, `create ${collection} record`);
    return response.json();
  }

  async function getCollection(name) {
    await ensureAuthenticated();
    try {
      const response = await request(`/api/collections/${encodeURIComponent(name)}`, {}, `get collection ${name}`);
      return await response.json();
    } catch (error) {
      if (/failed: 404/.test(error.message)) return null;
      throw error;
    }
  }

  async function createCollection(definition) {
    await ensureAuthenticated();
    const response = await request('/api/collections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(definition),
    }, `create collection ${definition.name}`);
    return response.json();
  }

  return { authenticate, listAll, fileUrl, createRecord, getCollection, createCollection };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all tests in `pocketbase-client.test.mjs` pass.

- [ ] **Step 6: Commit**

```bash
git add site/scripts/lib site/scripts/tests/pocketbase-client.test.mjs
git commit -m "feat: add shared env loader and PocketBase REST client"
```

---

### Task 3: Schema script, Dockerfile, compose file, Caddy block [code]

**Files:**
- Create: `site/scripts/pocketbase-schema.mjs`
- Create: `vps-scripts/pocketbase/Dockerfile`
- Create: `vps-scripts/docker-compose.yml`
- Modify: `cuddlebuns.caddy`
- Modify: `site/package.json`
- Test: `site/scripts/tests/pocketbase-schema.test.mjs`

**Interfaces:**
- Consumes: `createPocketBaseClient` from Task 2.
- Produces: `COLLECTION_DEFINITIONS` (array, dependency order) and `applySchema(client, log)` which creates missing collections and returns `{ created: [...names], existing: [...names] }`.
- Produces: `npm run schema:cms` CLI.

- [ ] **Step 1: Write the failing schema tests**

Create `site/scripts/tests/pocketbase-schema.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTION_DEFINITIONS, applySchema } from '../pocketbase-schema.mjs';

test('definitions are in dependency order', () => {
  const seen = new Set();
  for (const definition of COLLECTION_DEFINITIONS) {
    for (const field of definition.fields) {
      if (field.type === 'relation') {
        assert.ok(seen.has(field.collectionId), `${definition.name}.${field.name} targets ${field.collectionId} before it is defined`);
      }
    }
    seen.add(definition.name);
  }
  assert.deepEqual([...seen], [
    'artists', 'collections', 'characters', 'versions', 'commissions',
    'uma_scenarios', 'uma_pvp_events', 'uma_support_cards',
  ]);
});

test('every collection has legacy_id and only name fields are required', () => {
  for (const definition of COLLECTION_DEFINITIONS) {
    assert.ok(definition.fields.some((field) => field.name === 'legacy_id' && field.type === 'number'), definition.name);
    const required = definition.fields.filter((field) => field.required).map((field) => field.name);
    assert.deepEqual(required, ['name'], definition.name);
  }
});

test('applySchema creates missing collections with resolved relation ids and skips existing ones', async () => {
  const existing = new Map([['artists', { id: 'ART', name: 'artists' }]]);
  const created = [];
  const client = {
    async getCollection(name) { return existing.get(name) ?? null; },
    async createCollection(definition) {
      created.push(definition);
      const record = { id: `ID_${definition.name}`, name: definition.name };
      existing.set(definition.name, record);
      return record;
    },
  };
  const result = await applySchema(client, () => {});
  assert.deepEqual(result.existing, ['artists']);
  assert.equal(result.created.length, 7);
  const commissions = created.find((definition) => definition.name === 'commissions');
  const artistsRelation = commissions.fields.find((field) => field.name === 'artists');
  assert.equal(artistsRelation.collectionId, 'ART');
  const versionsRelation = commissions.fields.find((field) => field.name === 'versions');
  assert.equal(versionsRelation.collectionId, 'ID_versions');
  assert.equal(commissions.type, 'base');
  assert.equal(commissions.listRule, null);
});
```

- [ ] **Step 2: Run tests to see them fail**

Run: `npm test`
Expected: FAIL, cannot find `../pocketbase-schema.mjs`.

- [ ] **Step 3: Write the schema script**

Create `site/scripts/pocketbase-schema.mjs`:

```js
// Declares the PocketBase collections and creates any that are missing.
// Run: npm run schema:cms   (needs CMS_URL, CMS_EMAIL, CMS_PASSWORD)
// Safe to re-run: existing collections are left untouched, so field changes
// after first creation must be made in the PocketBase dashboard, then
// exported (Settings > Export collections) into vps-scripts/pocketbase/pb_schema.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './lib/env.mjs';
import { getPocketBaseConfig, createPocketBaseClient } from './lib/pocketbase-client.mjs';

const MB = 1024 * 1024;
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

const text = (name, extra = {}) => ({ name, type: 'text', required: false, ...extra });
const number = (name) => ({ name, type: 'number', required: false });
const bool = (name) => ({ name, type: 'bool', required: false });
const url = (name) => ({ name, type: 'url', required: false });
const date = (name) => ({ name, type: 'date', required: false });
const json = (name) => ({ name, type: 'json', required: false, maxSize: 100_000 });
const file = (name, { maxSelect, maxSize }) => ({
  name, type: 'file', required: false, maxSelect, maxSize, mimeTypes: IMAGE_MIME_TYPES, protected: false,
});
// collectionId holds the TARGET COLLECTION NAME here; applySchema swaps in the real id.
const relation = (name, target, { maxSelect }) => ({
  name, type: 'relation', required: false, collectionId: target, maxSelect, cascadeDelete: false,
});
const timestamps = () => [
  { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
];

export const COLLECTION_DEFINITIONS = [
  { name: 'artists', fields: [
    text('name', { required: true }), url('url'), number('legacy_id'), ...timestamps(),
  ] },
  { name: 'collections', fields: [
    text('name', { required: true }), text('slug'), number('display_order'), bool('visible'), bool('collapsible'),
    number('legacy_id'), ...timestamps(),
  ] },
  { name: 'characters', fields: [
    text('name', { required: true }), text('slug'), text('subtitle'), text('accent_color'),
    file('card_thumbnail', { maxSelect: 1, maxSize: 20 * MB }),
    number('display_order'), bool('visible'),
    relation('collection', 'collections', { maxSelect: 1 }),
    text('social_label'), url('social_url'),
    number('legacy_id'), ...timestamps(),
  ] },
  { name: 'versions', fields: [
    text('name', { required: true }), text('slug'),
    file('reference_sheet', { maxSelect: 20, maxSize: 50 * MB }),
    number('display_order'), bool('visible'),
    relation('character', 'characters', { maxSelect: 1 }),
    number('legacy_id'), ...timestamps(),
  ] },
  { name: 'commissions', fields: [
    text('name', { required: true }), // internal label shown in the dashboard list; never published
    text('type'),
    file('image', { maxSelect: 50, maxSize: 50 * MB }),
    url('source_url'), date('date'), bool('published'), number('display_order'),
    relation('versions', 'versions', { maxSelect: 50 }),
    relation('artists', 'artists', { maxSelect: 20 }),
    number('legacy_id'), ...timestamps(),
  ] },
  { name: 'uma_scenarios', fields: [
    text('name', { required: true }), text('short_name'), text('slug'),
    date('era_start'), date('era_end'), text('display_color'),
    number('legacy_id'), ...timestamps(),
  ] },
  { name: 'uma_pvp_events', fields: [
    text('name', { required: true }), number('event_number'), text('slug'), text('event_type'),
    date('start_date'), date('end_date'),
    relation('scenario', 'uma_scenarios', { maxSelect: 1 }),
    text('distance_class'), number('distance_m'), text('racecourse'), text('direction'),
    text('track_condition'), text('season'), text('weather'), text('surface'), text('status'),
    number('legacy_id'), ...timestamps(),
  ] },
  { name: 'uma_support_cards', fields: [
    text('name', { required: true }), text('character_name'), text('slug'),
    file('image', { maxSelect: 1, maxSize: 20 * MB }),
    text('card_type'), text('rating'), date('release_date'), json('styles'),
    relation('pvp_events', 'uma_pvp_events', { maxSelect: 200 }),
    number('legacy_id'), ...timestamps(),
  ] },
];

export async function applySchema(client, log = console.log) {
  const ids = new Map();
  const result = { created: [], existing: [] };
  for (const definition of COLLECTION_DEFINITIONS) {
    const found = await client.getCollection(definition.name);
    if (found) {
      ids.set(definition.name, found.id);
      result.existing.push(definition.name);
      log(`- ${definition.name}: exists (${found.id}); leaving as is.`);
      continue;
    }
    const fields = definition.fields.map((field) => {
      if (field.type !== 'relation') return field;
      const targetId = ids.get(field.collectionId);
      if (!targetId) throw new Error(`${definition.name}.${field.name}: target collection ${field.collectionId} not created yet.`);
      return { ...field, collectionId: targetId };
    });
    const created = await client.createCollection({
      name: definition.name,
      type: 'base',
      fields,
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    });
    ids.set(definition.name, created.id);
    result.created.push(definition.name);
    log(`- ${definition.name}: created (${created.id}).`);
  }
  return result;
}

async function main() {
  const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  loadEnvironment(siteDir);
  const client = createPocketBaseClient(getPocketBaseConfig());
  console.log('Applying PocketBase schema...');
  const result = await applySchema(client);
  console.log(`Done. Created ${result.created.length}, existing ${result.existing.length}.`);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((error) => { console.error(`Schema apply failed: ${error.message}`); process.exitCode = 1; });
}
```

Note on `commissions.name`: PocketBase's dashboard lists records by their first text field. Migration writes the old NocoDB `Internal Title` (or `Title`) there so editors can find records. The sync must never publish it. The spec called this field `internal_title`; `name` is used instead so the dashboard list is readable.

- [ ] **Step 4: Add the npm script**

In `site/package.json` `scripts`, add:

```json
"schema:cms": "node scripts/pocketbase-schema.mjs"
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Write the Dockerfile**

Create `vps-scripts/pocketbase/Dockerfile`:

```dockerfile
FROM alpine:3.20

# Check https://github.com/pocketbase/pocketbase/releases for the latest 0.x release
# and bump deliberately. Read the release notes first: pre-1.0 releases can change APIs.
ARG PB_VERSION=0.39.9

RUN apk add --no-cache unzip ca-certificates

ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/ && rm /tmp/pb.zip

EXPOSE 8090

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090"]
```

- [ ] **Step 7: Write the compose file**

Create `vps-scripts/docker-compose.yml`:

```yaml
services:
  pocketbase:
    build:
      context: ./pocketbase
    container_name: cuddlebuns-pocketbase
    restart: unless-stopped
    ports:
      - "127.0.0.1:8090:8090"
    volumes:
      - /var/lib/cuddlebuns/pb_data:/pb/pb_data
      - /var/lib/cuddlebuns/pb_hooks:/pb/pb_hooks
    environment:
      GOMEMLIMIT: 256MiB
```

- [ ] **Step 8: Add the Caddy site block**

Append to `cuddlebuns.caddy`, after the closing brace of the `cuddlebuns.moe { ... }` block and before the commented WWW section:

```caddy
# ========================================
# CMS (PocketBase)
# ========================================
cms.cuddlebuns.moe {
    encode gzip zstd

    # Commission originals can be large; PocketBase field limit is 50 MB.
    request_body {
        max_size 60MB
    }

    reverse_proxy 127.0.0.1:8090 {
        header_up X-Real-IP {remote_host}
    }
}
```

- [ ] **Step 9: Smoke-test the container locally (optional if Docker is installed)**

From the repo root:

```bash
docker compose -f vps-scripts/docker-compose.yml build
```

Expected: image builds. Do not `up` locally with the production volume paths; they are VPS paths.

- [ ] **Step 10: Commit**

```bash
git add site/scripts/pocketbase-schema.mjs site/scripts/tests/pocketbase-schema.test.mjs site/package.json vps-scripts/pocketbase/Dockerfile vps-scripts/docker-compose.yml cuddlebuns.caddy
git commit -m "feat: PocketBase schema script, container definition, and Caddy site"
```

---

### Task 4: Provision PocketBase on the VPS [ops]

**Files:** none in the repo. Everything here happens on the VPS and in DNS.

**Interfaces:**
- Produces: a running PocketBase at `https://cms.cuddlebuns.moe` with the eight collections, a superuser for humans, and a second superuser for the sync.

- [ ] **Step 1: DNS**

Add an `A` record `cms.cuddlebuns.moe` pointing at the VPS IP. Wait until `dig +short cms.cuddlebuns.moe` (run from your laptop) returns the IP.

- [ ] **Step 2: Confirm Docker and a free port**

On the VPS:

```bash
docker --version && docker compose version
ss -ltnp | grep ':8090' || echo "port 8090 is free"
```

If Docker is missing, install it with the distribution's package (`sudo apt install docker.io docker-compose-v2` on Debian/Ubuntu) and add your user to the `docker` group.

- [ ] **Step 3: Pull the repo and create data folders**

```bash
cd /var/www/cuddlebuns/source && git pull origin main
sudo mkdir -p /var/lib/cuddlebuns/pb_data /var/lib/cuddlebuns/pb_hooks
sudo chown -R "$(id -u):$(id -g)" /var/lib/cuddlebuns
```

- [ ] **Step 4: Build and start**

```bash
cd /var/www/cuddlebuns/source/vps-scripts
docker compose up -d --build
docker compose logs --tail=20 pocketbase
curl -s http://127.0.0.1:8090/api/health
```

Expected: the log shows `Server started at http://0.0.0.0:8090` and the health check returns `{"code":200,...}`.

- [ ] **Step 5: Create the two superusers**

```bash
docker compose exec pocketbase /pb/pocketbase superuser create admin@cuddlebuns.moe 'CHOOSE_A_STRONG_PASSWORD'
docker compose exec pocketbase /pb/pocketbase superuser create sync@cuddlebuns.moe 'CHOOSE_A_DIFFERENT_STRONG_PASSWORD'
```

The `sync@` account is only ever used by the VPS timer and by the migration. PocketBase superusers cannot be made read-only; the separate account exists so it can be rotated without touching human logins. Store both passwords in the team password manager.

- [ ] **Step 6: Install Caddy config and reload**

```bash
sudo cp /var/www/cuddlebuns/source/cuddlebuns.caddy /etc/caddy/Caddyfile   # or wherever the live file lives; check `caddy environ` / systemd unit
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -sI https://cms.cuddlebuns.moe/api/health | head -1
```

Expected: `HTTP/2 200`. Open `https://cms.cuddlebuns.moe/_/` in a browser and log in as `admin@`.

- [ ] **Step 7: Tell PocketBase about the proxy**

In the dashboard: Settings > Application > "User IP proxy headers": add `X-Forwarded-For`. Save. (This only affects logged IPs.)

- [ ] **Step 8: Apply the schema**

On the VPS the systemd env file is not read by an interactive shell, so pass the variables inline:

```bash
cd /var/www/cuddlebuns/source/site
CMS_URL=http://127.0.0.1:8090 CMS_EMAIL=sync@cuddlebuns.moe CMS_PASSWORD='...' npm run schema:cms
```

Expected: eight `created` lines. Re-running prints eight `exists` lines.

If the server rejects a field option name (a `400` mentioning `fields`), the option naming for this PocketBase version differs from the plan. Create that one collection in the dashboard using the field list in `pocketbase-schema.mjs`, then re-run the script; it skips existing collections. If the `400` says `created` or `updated` already exists, this PocketBase version adds those automatically: delete the `...timestamps()` entries from every definition in `pocketbase-schema.mjs` and re-run.

- [ ] **Step 9: Export the schema into git**

In the dashboard: Settings > Export collections > download. Save the file as `vps-scripts/pocketbase/pb_schema.json` on your laptop, commit, and push:

```bash
git add vps-scripts/pocketbase/pb_schema.json
git commit -m "chore: export PocketBase collections schema"
```

This file is the recoverable record of the schema. Re-export it whenever fields change.

- [ ] **Step 10: Turn on scheduled backups**

Dashboard: Settings > Backups > enable auto backups with cron `0 3 * * *`, keep `7`. Backups land in `/var/lib/cuddlebuns/pb_data/backups`. Add an off-server copy of that folder to whatever backup job already covers the VPS.

---

### Task 5: Capture a baseline of the NocoDB-based output [ops]

This baseline is what the migrated output will be compared against in Task 9. It needs working NocoDB credentials in `site/.env.local`, so the current NocoDB admin should do it before any sync code changes land on their machine.

- [ ] **Step 1: Sync everything from NocoDB with the current code**

From `site/` on a checkout at the commit from Task 3 (before Task 7 lands):

```bash
git log -1 --format=%h   # note this commit
npm run sync
npm run sync:uma
npm run validate:cms
npm run validate:uma
```

Expected: both validators print `passed`.

- [ ] **Step 2: Copy the output aside**

```bash
mkdir -p .cache/baseline
cp -r public/data .cache/baseline/data
cp .cache/nocodb/manifest.json .cache/baseline/gallery-manifest.json
echo "$(git log -1 --format=%h)" > .cache/baseline/commit
```

`.cache/` is gitignored. Keep this folder until Task 9 has passed.

---

### Task 6: Migration script [code], then run it [ops]

**Files:**
- Create: `site/scripts/migrate/nocodb-source.mjs`
- Create: `site/scripts/migrate/transform.mjs`
- Create: `site/scripts/migrate/migrate-nocodb-to-pocketbase.mjs`
- Modify: `site/package.json`
- Test: `site/scripts/tests/migrate-transform.test.mjs`

**Interfaces:**
- Consumes: `createPocketBaseClient` (Task 2) with `listAll`, `createRecord`, and the schema from Task 3.
- Produces: `dateValue(value)`, `toPocketBaseBody(table, record, idMap)` → `{ fields, files }` where `files` is `[{ field, attachment }]` and `attachment` is the raw NocoDB attachment object.
- Produces: `npm run migrate:cms` CLI.

- [ ] **Step 1: Write the failing transform tests**

Create `site/scripts/tests/migrate-transform.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateValue, toPocketBaseBody } from '../migrate/transform.mjs';

const idMap = {
  artists: new Map([['1', 'ART1'], ['2', 'ART2']]),
  collections: new Map([['5', 'COL5']]),
  characters: new Map([['9', 'CHR9']]),
  versions: new Map([['11', 'VER11'], ['12', 'VER12']]),
  uma_scenarios: new Map([['3', 'SCN3']]),
  uma_pvp_events: new Map([['20', 'EVT20']]),
};

test('dateValue converts YYYY-MM-DD to the PocketBase canonical form', () => {
  assert.equal(dateValue('2026-03-14'), '2026-03-14 00:00:00.000Z');
  assert.equal(dateValue('2026-03-14T10:00:00.000Z'), '2026-03-14 00:00:00.000Z');
  assert.equal(dateValue(null), '');
  assert.equal(dateValue('nonsense'), '');
});

test('commission maps fields, relations, and images', () => {
  const record = { id: 42, fields: {
    'Internal Title': 'Kiki spring', Type: 'Full body', 'Source URL': 'https://x/1', Date: '2026-03-14',
    Published: true, 'Display Order': 3,
    Versions: [{ id: 11 }, { id: 12 }, { id: 999 }], Artists: [{ id: 2 }],
    Image: [{ id: 'att1', title: 'a.png', signedPath: 'dltemp/a', mimetype: 'image/png' }],
  } };
  const body = toPocketBaseBody('commissions', record, idMap);
  assert.deepEqual(body.fields, {
    name: 'Kiki spring', type: 'Full body', source_url: 'https://x/1', date: '2026-03-14 00:00:00.000Z',
    published: true, display_order: 3, versions: ['VER11', 'VER12'], artists: ['ART2'], legacy_id: 42,
  });
  assert.deepEqual(body.files, [{ field: 'image', attachment: record.fields.Image[0] }]);
});

test('commission without internal title falls back to a generated name', () => {
  const body = toPocketBaseBody('commissions', { id: 7, fields: { Type: 'Bust' } }, idMap);
  assert.equal(body.fields.name, 'Commission 7');
  assert.equal(body.fields.published, false);
  assert.equal(body.files.length, 0);
  assert.equal('display_order' in body.fields, false);
});

test('character maps collection relation, thumbnail, and social', () => {
  const record = { id: 9, fields: {
    Name: 'Kiki', Slug: 'kiki', Subtitle: 'The original', 'Accent Color': '#7be3f2',
    'Display Order': 1, Visible: true, Collections: [{ id: 5 }],
    'Social 1 Label': 'Profile', 'Social 1 URL': 'https://x/kiki',
    'Card Thumbnail': [{ id: 't1', title: 'kiki.png', signedPath: 'dltemp/k' }],
  } };
  const body = toPocketBaseBody('characters', record, idMap);
  assert.equal(body.fields.collection, 'COL5');
  assert.equal(body.fields.accent_color, '#7be3f2');
  assert.equal(body.fields.social_url, 'https://x/kiki');
  assert.deepEqual(body.files, [{ field: 'card_thumbnail', attachment: record.fields['Card Thumbnail'][0] }]);
});

test('version maps character relation and every reference sheet', () => {
  const sheets = [{ id: 'r1', title: 'a.png', signedPath: 'p1' }, { id: 'r2', title: 'b.png', signedPath: 'p2' }];
  const body = toPocketBaseBody('versions', { id: 11, fields: { Name: 'Default', Character: [{ id: 9 }], Visible: true, 'Reference Sheet': sheets } }, idMap);
  assert.equal(body.fields.character, 'CHR9');
  assert.equal(body.files.length, 2);
  assert.equal(body.files[1].field, 'reference_sheet');
});

test('support card maps styles to an array and events to relations', () => {
  const body = toPocketBaseBody('uma_support_cards', { id: 30, fields: {
    name: 'Kitasan Black', character_name: 'Kitasan Black', card_type: 'Speed', rating: 'Auto Include',
    release_date: '2025-06-26', styles: 'Front Runner,Pace Chaser', pvp_events: [{ id: 20 }],
    image: [{ id: 'i', title: 'k.png', signedPath: 'p' }],
  } }, idMap);
  assert.deepEqual(body.fields.styles, ['Front Runner', 'Pace Chaser']);
  assert.deepEqual(body.fields.pvp_events, ['EVT20']);
  assert.equal(body.fields.release_date, '2025-06-26 00:00:00.000Z');
});

test('pvp event maps scenario relation and numeric fields', () => {
  const body = toPocketBaseBody('uma_pvp_events', { id: 20, fields: {
    Name: 'CM 5', 'Event Number': '5', 'Start Date': '2025-08-01', 'End Date': '2025-08-05',
    Scenario: [{ id: 3 }], 'Distance M': '2400', Surface: 'Turf', Status: 'Confirmed',
  } }, idMap);
  assert.equal(body.fields.scenario, 'SCN3');
  assert.equal(body.fields.event_number, 5);
  assert.equal(body.fields.distance_m, 2400);
  assert.equal(body.fields.status, 'Confirmed');
});
```

- [ ] **Step 2: Run tests to see them fail**

Run: `npm test`
Expected: FAIL, cannot find `../migrate/transform.mjs`.

- [ ] **Step 3: Write the transform module**

Create `site/scripts/migrate/transform.mjs`:

```js
// Pure mapping from NocoDB API v3 records to PocketBase create bodies.
// Throwaway: deleted once the migration has run.

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function pick(fields, ...names) {
  for (const name of names) if (fields?.[name] != null && fields[name] !== '') return fields[name];
  return null;
}

function number(value) {
  const parsed = Number(value);
  return value != null && value !== '' && Number.isFinite(parsed) ? parsed : null;
}

export function dateValue(value) {
  const normalized = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) return '';
  return `${normalized} 00:00:00.000Z`;
}

function relationIds(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map((item) => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return item?.id != null ? String(item.id) : item?.id_fields?.Id != null ? String(item.id_fields.Id) : null;
  }).filter(Boolean);
}

function mapped(ids, map) {
  return ids.map((id) => map?.get(id)).filter(Boolean);
}

function attachments(value) {
  return Array.isArray(value) ? value.filter((item) => item?.signedPath) : [];
}

function multiText(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return values.map((item) => text(typeof item === 'object' ? item?.title ?? item?.value ?? item?.name : item)).filter(Boolean);
}

function setIf(target, key, value) {
  if (value != null && value !== '') target[key] = value;
}

export function toPocketBaseBody(table, record, idMap) {
  const fields = record.fields ?? {};
  const out = { legacy_id: Number(record.id) };
  const files = [];

  switch (table) {
    case 'artists':
      out.name = text(pick(fields, 'Artist Name', 'Name')) || `Artist ${record.id}`;
      setIf(out, 'url', text(pick(fields, 'URL', 'Url')));
      break;
    case 'collections':
      out.name = text(fields.Name) || `Collection ${record.id}`;
      setIf(out, 'slug', text(fields.Slug));
      setIf(out, 'display_order', number(fields['Display Order']));
      out.visible = fields.Visible === true;
      out.collapsible = fields.Collapsible === true;
      break;
    case 'characters':
      out.name = text(fields.Name) || `Character ${record.id}`;
      setIf(out, 'slug', text(fields.Slug));
      setIf(out, 'subtitle', text(fields.Subtitle));
      setIf(out, 'accent_color', text(fields['Accent Color']));
      setIf(out, 'display_order', number(fields['Display Order']));
      out.visible = fields.Visible === true;
      setIf(out, 'collection', mapped(relationIds(fields.Collections), idMap.collections)[0]);
      setIf(out, 'social_label', text(fields['Social 1 Label']));
      setIf(out, 'social_url', text(fields['Social 1 URL']));
      for (const attachment of attachments(fields['Card Thumbnail']).slice(0, 1)) files.push({ field: 'card_thumbnail', attachment });
      break;
    case 'versions':
      out.name = text(fields.Name) || 'Default';
      setIf(out, 'slug', text(fields.Slug));
      setIf(out, 'display_order', number(fields['Display Order']));
      out.visible = fields.Visible === true;
      setIf(out, 'character', mapped(relationIds(fields.Character), idMap.characters)[0]);
      for (const attachment of attachments(fields['Reference Sheet'])) files.push({ field: 'reference_sheet', attachment });
      break;
    case 'commissions':
      out.name = text(pick(fields, 'Internal Title', 'Title')) || `Commission ${record.id}`;
      setIf(out, 'type', text(fields.Type));
      setIf(out, 'source_url', text(fields['Source URL']));
      setIf(out, 'date', dateValue(fields.Date));
      out.published = fields.Published === true;
      setIf(out, 'display_order', number(fields['Display Order']));
      out.versions = mapped(relationIds(fields.Versions), idMap.versions);
      out.artists = mapped(relationIds(fields.Artists), idMap.artists);
      for (const attachment of attachments(fields.Image)) files.push({ field: 'image', attachment });
      break;
    case 'uma_scenarios':
      out.name = text(pick(fields, 'name', 'Name')) || `Scenario ${record.id}`;
      setIf(out, 'short_name', text(pick(fields, 'short_name', 'Short Name')));
      setIf(out, 'slug', text(pick(fields, 'slug', 'Slug')));
      setIf(out, 'era_start', dateValue(pick(fields, 'era_start', 'Era Start')));
      setIf(out, 'era_end', dateValue(pick(fields, 'era_end', 'Era End')));
      setIf(out, 'display_color', text(pick(fields, 'display_color', 'Display Color')));
      break;
    case 'uma_pvp_events':
      out.name = text(pick(fields, 'name', 'Name')) || `PvP event ${record.id}`;
      setIf(out, 'event_number', number(pick(fields, 'event_number', 'Event Number')));
      setIf(out, 'slug', text(pick(fields, 'slug', 'Slug')));
      setIf(out, 'event_type', text(pick(fields, 'event_type', 'Event Type')));
      setIf(out, 'start_date', dateValue(pick(fields, 'start_date', 'Start Date')));
      setIf(out, 'end_date', dateValue(pick(fields, 'end_date', 'End Date')));
      setIf(out, 'scenario', mapped(relationIds(pick(fields, 'scenario', 'Scenario')), idMap.uma_scenarios)[0]);
      setIf(out, 'distance_class', text(pick(fields, 'distance_class', 'Distance Class')));
      setIf(out, 'distance_m', number(pick(fields, 'distance_m', 'Distance M')));
      setIf(out, 'racecourse', text(pick(fields, 'racecourse', 'Racecourse')));
      setIf(out, 'direction', text(pick(fields, 'direction', 'Direction')));
      setIf(out, 'track_condition', text(pick(fields, 'track_condition', 'Track Condition')));
      setIf(out, 'season', text(pick(fields, 'season', 'Season')));
      setIf(out, 'weather', text(pick(fields, 'weather', 'Weather')));
      setIf(out, 'surface', text(pick(fields, 'surface', 'Surface')));
      setIf(out, 'status', text(pick(fields, 'status', 'Status', 'confirmed_projected_status', 'Confirmed/Projected Status')));
      break;
    case 'uma_support_cards':
      out.name = text(pick(fields, 'name', 'Name')) || text(pick(fields, 'character_name', 'Character Name')) || `Support card ${record.id}`;
      setIf(out, 'character_name', text(pick(fields, 'character_name', 'Character Name')));
      setIf(out, 'slug', text(pick(fields, 'slug', 'Slug')));
      setIf(out, 'card_type', text(pick(fields, 'card_type', 'Card Type')));
      setIf(out, 'rating', text(pick(fields, 'rating', 'Rating')));
      setIf(out, 'release_date', dateValue(pick(fields, 'release_date', 'Release Date')));
      out.styles = multiText(pick(fields, 'styles', 'Styles'));
      out.pvp_events = mapped(relationIds(pick(fields, 'pvp_events', 'PvP Events')), idMap.uma_pvp_events);
      for (const attachment of attachments(pick(fields, 'image', 'Image')).slice(0, 1)) files.push({ field: 'image', attachment });
      break;
    default:
      throw new Error(`Unknown table ${table}`);
  }
  return { fields: out, files };
}
```

- [ ] **Step 4: Run the transform tests**

Run: `npm test`
Expected: all `migrate-transform` tests pass.

- [ ] **Step 5: Write the NocoDB source module**

Create `site/scripts/migrate/nocodb-source.mjs` (a trimmed copy of the fetch code in the current sync scripts):

```js
// NocoDB API v3 reader used only by the migration. Deleted afterwards.

const API_PAGE_SIZE = 25;
const API_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 4000;

export function getNocoConfig(env = process.env) {
  const names = {
    gallery: {
      url: 'NOCODB_URL', token: 'NOCODB_TOKEN', baseId: 'NOCODB_BASE_ID',
      artists: 'NOCODB_ARTISTS_TABLE_ID', characters: 'NOCODB_CHARACTERS_TABLE_ID',
      commissions: 'NOCODB_COMMISSIONS_TABLE_ID', collections: 'NOCODB_COLLECTIONS_TABLE_ID',
      versions: 'NOCODB_VERSIONS_TABLE_ID',
    },
    uma: {
      url: 'UMA_NOCODB_URL', token: 'UMA_NOCODB_TOKEN', baseId: 'UMA_NOCODB_BASE_ID',
      uma_scenarios: 'UMA_NOCODB_SCENARIOS_TABLE_ID', uma_pvp_events: 'UMA_NOCODB_PVP_EVENTS_TABLE_ID',
      uma_support_cards: 'UMA_NOCODB_SUPPORT_CARDS_TABLE_ID',
    },
  };
  const result = {};
  const missing = [];
  for (const [group, variables] of Object.entries(names)) {
    result[group] = {};
    for (const [key, name] of Object.entries(variables)) {
      const value = env[name]?.trim();
      if (!value || value.startsWith('YOUR_')) missing.push(name);
      result[group][key] = value;
    }
    result[group].url = (result[group].url ?? '').replace(/\/+$/, '');
  }
  if (missing.length) throw new Error(`Missing NocoDB configuration: ${missing.join(', ')}`);
  return result;
}

async function fetchWithRetry(url, init, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
      if (response.ok) return response;
      const detail = (await response.text()).slice(0, 300);
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) throw new Error(`${label} failed: ${response.status} ${response.statusText}\n${detail}`);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt));
  }
  throw lastError ?? new Error(`${label} failed.`);
}

export async function fetchNocoTable(group, tableId, label) {
  const records = [];
  let next = `${group.url}/api/v3/data/${encodeURIComponent(group.baseId)}/${encodeURIComponent(tableId)}/records?pageSize=${API_PAGE_SIZE}&linksAsLtar=true`;
  while (next) {
    const returned = new URL(next, `${group.url}/`);
    const url = new URL(`${returned.pathname}${returned.search}`, `${group.url}/`);
    const response = await fetchWithRetry(url, { headers: { 'xc-token': group.token } }, `${label} page`);
    const page = await response.json();
    records.push(...(page.records ?? []));
    next = page.next ?? null;
  }
  console.log(`Fetched ${records.length} ${label} record(s) from NocoDB.`);
  return records;
}

export async function downloadNocoAttachment(group, attachment) {
  const url = new URL(attachment.signedPath, `${group.url}/`).href;
  const response = await fetchWithRetry(url, {}, `download ${attachment.title || attachment.id}`);
  return Buffer.from(await response.arrayBuffer());
}
```

- [ ] **Step 6: Write the migration CLI**

Create `site/scripts/migrate/migrate-nocodb-to-pocketbase.mjs`:

```js
// One-time migration: NocoDB -> PocketBase. Re-runnable: records whose legacy_id
// already exists in PocketBase are skipped, so a crash mid-way can be resumed.
//
// Run from site/:  npm run migrate:cms
// Needs in .env.local: all NOCODB_* and UMA_NOCODB_* variables (old) plus CMS_* (new).
// Add --dry-run to print what would be created without writing anything.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../lib/env.mjs';
import { getPocketBaseConfig, createPocketBaseClient } from '../lib/pocketbase-client.mjs';
import { getNocoConfig, fetchNocoTable, downloadNocoAttachment } from './nocodb-source.mjs';
import { toPocketBaseBody } from './transform.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

// [pocketbase collection, noco group name, noco table key, label]
const ORDER = [
  ['artists', 'gallery', 'artists', 'Artists'],
  ['collections', 'gallery', 'collections', 'Collections'],
  ['characters', 'gallery', 'characters', 'Characters'],
  ['versions', 'gallery', 'versions', 'Versions'],
  ['commissions', 'gallery', 'commissions', 'Commissions'],
  ['uma_scenarios', 'uma', 'uma_scenarios', 'Scenarios'],
  ['uma_pvp_events', 'uma', 'uma_pvp_events', 'PvP events'],
  ['uma_support_cards', 'uma', 'uma_support_cards', 'Support cards'],
];

function mimeFor(attachment) {
  if (attachment.mimetype) return attachment.mimetype;
  const extension = path.extname(attachment.title || '').toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' }[extension] ?? 'application/octet-stream';
}

async function buildFormData(nocoGroup, body) {
  const form = new FormData();
  for (const [key, value] of Object.entries(body.fields)) {
    if (Array.isArray(value)) {
      if (key === 'styles') form.append(key, JSON.stringify(value));
      else if (value.length === 0) form.append(key, '');
      else for (const item of value) form.append(key, String(item));
    } else {
      form.append(key, String(value));
    }
  }
  for (const { field, attachment } of body.files) {
    const buffer = await downloadNocoAttachment(nocoGroup, attachment);
    const filename = attachment.title || `${attachment.id}${path.extname(attachment.path || '') || '.img'}`;
    form.append(field, new Blob([buffer], { type: mimeFor(attachment) }), filename);
  }
  return form;
}

async function main() {
  const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  loadEnvironment(siteDir);
  const noco = getNocoConfig();
  const client = createPocketBaseClient(getPocketBaseConfig(), { timeoutMs: 600_000 });
  await client.authenticate();

  const idMap = {};
  const summary = [];
  for (const [collection, groupName, tableKey, label] of ORDER) {
    const group = noco[groupName];
    const sourceRecords = await fetchNocoTable(group, group[tableKey], label);
    const existing = await client.listAll(collection);
    const byLegacyId = new Map(existing.filter((record) => record.legacy_id).map((record) => [String(record.legacy_id), record.id]));
    idMap[collection] = byLegacyId;

    let created = 0;
    let skipped = 0;
    for (const record of sourceRecords) {
      const legacyId = String(record.id);
      if (byLegacyId.has(legacyId)) { skipped += 1; continue; }
      const body = toPocketBaseBody(collection, record, idMap);
      if (DRY_RUN) {
        console.log(`[dry-run] ${collection} #${legacyId}: ${JSON.stringify(body.fields)} + ${body.files.length} file(s)`);
        byLegacyId.set(legacyId, `DRY_${collection}_${legacyId}`);
        created += 1;
        continue;
      }
      const form = await buildFormData(group, body);
      const saved = await client.createRecord(collection, form);
      byLegacyId.set(legacyId, saved.id);
      created += 1;
      console.log(`${collection} #${legacyId} -> ${saved.id} (${body.files.length} file(s))`);
    }
    summary.push({ collection, source: sourceRecords.length, created, skipped });
  }

  console.log('\nMigration summary:');
  console.table(summary);
  const mismatched = summary.filter((row) => row.created + row.skipped !== row.source);
  if (mismatched.length) {
    console.error('Some collections did not migrate every record. Re-run to resume.');
    process.exitCode = 1;
  }
}

main().catch((error) => { console.error(`Migration failed: ${error.message}`); process.exitCode = 1; });
```

- [ ] **Step 7: Add the npm script**

In `site/package.json` `scripts`, add:

```json
"migrate:cms": "node scripts/migrate/migrate-nocodb-to-pocketbase.mjs"
```

- [ ] **Step 8: Lint and test**

Run: `npm run lint && npm test`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add site/scripts/migrate site/scripts/tests/migrate-transform.test.mjs site/package.json
git commit -m "feat: one-time NocoDB to PocketBase migration script"
```

- [ ] **Step 10 [ops]: Dry run from the admin's laptop**

The NocoDB admin adds the three new variables to `site/.env.local` alongside the existing NocoDB ones:

```dotenv
CMS_URL=https://cms.cuddlebuns.moe
CMS_EMAIL=sync@cuddlebuns.moe
CMS_PASSWORD=...
```

Then from `site/`:

```bash
git pull
npm ci
npm run migrate:cms -- --dry-run
```

Expected: one line per record showing the mapped fields and file count, then a summary table where `source` equals `created` for every collection. Skim the commissions lines: `name` should show the old internal titles, `versions` and `artists` should be non-empty arrays for published records.

- [ ] **Step 11 [ops]: Real run**

```bash
npm run migrate:cms
```

This downloads every image from NocoDB and uploads it to PocketBase, so it takes a while. If it fails partway (network), run it again; already-migrated records are skipped.

Expected: summary table with `created + skipped == source` for all eight rows.

- [ ] **Step 12 [ops]: Spot-check in the dashboard**

Open `https://cms.cuddlebuns.moe/_/`:

- `commissions`: count matches NocoDB. Open one published record: image preview shows, `versions` and `artists` are linked, `date` shows the right day.
- `characters`: open one, confirm `card_thumbnail` and `collection`.
- `uma_support_cards`: open one, confirm `styles` shows a JSON array and `pvp_events` is linked.

---

### Task 7: Gallery sync on PocketBase [code]

**Files:**
- Modify: `site/scripts/sync-nocodb.mjs`
- Test: `site/scripts/tests/sync-gallery-model.test.mjs`

**Interfaces:**
- Consumes: `loadEnvironment`, `getPocketBaseConfig`, `createPocketBaseClient` from Task 2.
- Produces: named exports `createModel(tables, fileUrl)`, `publicSourceSnapshot(tables)`, `attachmentSnapshot(attachment)` from the sync script. `tables` is `{ collections, characters, versions, commissions, artists }` of raw PocketBase records. `fileUrl(collection, recordId, filename)` returns a download URL.
- Attachment objects inside the script become `{ id: filename, title: filename, collection, recordId }`.

- [ ] **Step 1: Write the failing model tests**

Create `site/scripts/tests/sync-gallery-model.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, publicSourceSnapshot } from '../sync-nocodb.mjs';

const fileUrl = (collection, recordId, filename) => `http://pb/api/files/${collection}/${recordId}/${filename}`;

function fixture() {
  return {
    artists: [
      { id: 'art1', name: 'Artist One', url: 'https://one.example', legacy_id: 1 },
      { id: 'art2', name: '  ', url: '', legacy_id: 2 },
    ],
    collections: [
      { id: 'col1', name: 'Main Cast', slug: 'main-cast', display_order: 1, visible: true, collapsible: false },
      { id: 'col2', name: 'Hidden', slug: 'hidden', display_order: 0, visible: false, collapsible: false },
    ],
    characters: [
      { id: 'chr1', name: 'Kiki', slug: 'kiki', subtitle: '', accent_color: '#ABC', card_thumbnail: 'kiki_x1.png',
        display_order: 0, visible: true, collection: 'col1', social_label: '', social_url: 'https://x/kiki' },
      { id: 'chr2', name: 'Orphan', slug: 'orphan', visible: true, collection: 'col2', card_thumbnail: '' },
    ],
    versions: [
      { id: 'ver1', name: 'Default', slug: 'default', reference_sheet: ['ref_a.png', 'ref_b.png'], display_order: 1, visible: true, character: 'chr1' },
      { id: 'ver2', name: 'Alt', slug: 'alt', reference_sheet: [], display_order: 2, visible: false, character: 'chr1' },
    ],
    commissions: [
      { id: 'com1', name: 'internal only', type: 'Full body', image: ['a_1.png', 'b_2.png'], source_url: 'https://x/1',
        date: '2026-03-14 00:00:00.000Z', published: true, display_order: 2, versions: ['ver1', 'ver2'], artists: ['art1', 'art2'] },
      { id: 'com2', name: 'draft', type: 'Bust', image: ['c.png'], source_url: '', date: '', published: true,
        display_order: 0, versions: ['ver1'], artists: ['art1'] },
      { id: 'com3', name: 'unpublished', type: 'Bust', image: ['d.png'], source_url: 'https://x/3', published: false,
        versions: ['ver1'], artists: ['art1'] },
    ],
  };
}

test('visible collections, characters, and versions are kept and ordered', () => {
  const model = createModel(fixture(), fileUrl);
  assert.deepEqual(model.collections.map((collection) => collection.slug), ['main-cast']);
  const [kiki] = model.collections[0].characters;
  assert.equal(kiki.slug, 'kiki');
  assert.equal(kiki.color, '#aabbcc');
  assert.equal(kiki.subtitle, null);
  assert.equal(kiki.order, null, 'display_order 0 means unset');
  assert.deepEqual(kiki.social, { label: 'Profile', url: 'https://x/kiki' });
  assert.deepEqual(kiki.versions.map((version) => version.slug), ['default']);
  assert.equal(kiki.versions[0].galleryUrl, '/data/cms/gallery/kiki--default.json');
});

test('image tasks point at PocketBase file URLs', () => {
  const model = createModel(fixture(), fileUrl);
  const thumbnail = model.imageTasks.get('character-thumbnail:chr1:kiki_x1.png');
  assert.equal(thumbnail.sourceUrl, 'http://pb/api/files/characters/chr1/kiki_x1.png');
  assert.deepEqual(thumbnail.derivativeWidths, [480, 600, 720]);
  const reference = model.imageTasks.get('reference:ver1:ref_b.png');
  assert.equal(reference.sourceUrl, 'http://pb/api/files/versions/ver1/ref_b.png');
  assert.equal(reference.preserveOriginal, true);
  assert.equal(model.versions[0].referenceSheets.length, 2);
});

test('published commissions become [Type] by Artist items, one per image, without the internal name', () => {
  const model = createModel(fixture(), fileUrl);
  const items = model.galleries.get('ver1');
  const com1 = items.filter((item) => item.recordId === 'com1');
  assert.equal(com1.length, 2);
  assert.equal(com1[0].title, 'Full body');
  assert.equal(com1[0].artist, 'Artist One');
  assert.deepEqual(com1[0].artists, [{ name: 'Artist One', url: 'https://one.example' }]);
  assert.equal(com1[0].date, '2026-03-14');
  assert.equal(com1[0].displayOrder, 2);
  assert.equal(com1[0].taskKey, 'commission:com1:a_1.png');
  assert.equal(JSON.stringify(items).includes('internal only'), false);
});

test('a published commission missing its source URL is reported and skipped', () => {
  const model = createModel(fixture(), fileUrl);
  assert.ok(model.errors.some((error) => /Commission com2 \(draft\): missing Source URL; skipped/.test(error)), model.errors.join('\n'));
  assert.equal(model.galleries.get('ver1').some((item) => item.recordId === 'com2'), false);
  assert.equal(model.galleries.get('ver1').some((item) => item.recordId === 'com3'), false);
});

test('publicSourceSnapshot ignores internal fields and is order-independent', () => {
  const tables = fixture();
  const first = publicSourceSnapshot(tables);
  tables.commissions[0].name = 'renamed internally';
  tables.commissions[0].updated = '2026-09-04 10:00:00.000Z';
  tables.commissions.reverse();
  const second = publicSourceSnapshot(tables);
  assert.deepEqual(first, second);
});
```

- [ ] **Step 2: Run tests to see them fail**

Run: `npm test`
Expected: FAIL. `sync-nocodb.mjs` has no named exports and runs `main()` on import (it will also throw `Missing NocoDB configuration`).

- [ ] **Step 3: Replace the configuration and fetch layer**

In `site/scripts/sync-nocodb.mjs`:

Replace the import block at the top with:

```js
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadEnvironment } from "./lib/env.mjs";
import { getPocketBaseConfig, createPocketBaseClient } from "./lib/pocketbase-client.mjs";
```

Change `const MANIFEST_VERSION = 3;` to `const MANIFEST_VERSION = 4;`.

Delete these constants: `API_PAGE_SIZE`, `API_TIMEOUT_MS`, `API_MAX_ATTEMPTS`, `API_RETRY_BASE_MS`.

Delete the local `loadEnvironment` function and the `getConfig` function.

Delete `isRetryableApiFailure`, `fetchApiPage`, `fetchTable`, and `thumbnailFallbackUrl`.

- [ ] **Step 4: Replace the attachment helpers**

Replace `attachmentSnapshot` with:

```js
// PocketBase file fields are plain filenames. PocketBase appends a random suffix
// on upload, so a re-uploaded image always gets a new filename and a new signature.
export function attachmentSnapshot(attachment) {
  return { id: attachment?.id ?? null, title: attachment?.title ?? null };
}

function fileAttachments(collection, record, field, fileUrl) {
  const value = record[field];
  const filenames = Array.isArray(value) ? value : value ? [value] : [];
  return filenames.filter(Boolean).map((filename) => ({
    id: filename,
    title: filename,
    collection,
    recordId: record.id,
    sourceUrl: fileUrl(collection, record.id, filename),
  }));
}

function dateOnly(value) {
  const normalized = typeof value === "string" ? value.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function orderValue(value) {
  // PocketBase stores an unset number as 0. Display orders start at 1.
  return typeof value === "number" && value > 0 ? value : null;
}

function textValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
```

`extensionFor(attachment)` keeps working because it falls back to the extension of `attachment.title`. Remove the `mimetype` lookup line so it reads:

```js
function extensionFor(attachment) {
  const extension = path.extname(attachment?.title || "").toLowerCase();
  return /^\.(avif|gif|jpe?g|png|webp)$/.test(extension) ? extension : ".img";
}
```

- [ ] **Step 5: Replace `publicSourceSnapshot`**

```js
export function publicSourceSnapshot(tables) {
  const wanted = {
    collections: ["name", "slug", "display_order", "visible", "collapsible"],
    characters: ["name", "slug", "subtitle", "accent_color", "card_thumbnail", "display_order", "visible", "collection", "social_label", "social_url"],
    versions: ["name", "slug", "reference_sheet", "display_order", "visible", "character"],
    commissions: ["image", "source_url", "type", "date", "published", "display_order", "versions", "artists"],
    artists: ["name", "url"],
  };
  const relationFields = new Set(["collection", "character", "versions", "artists"]);

  return Object.fromEntries(Object.entries(wanted).map(([table, fields]) => [
    table,
    (tables[table] ?? []).map((record) => ({
      id: record.id,
      fields: Object.fromEntries(fields.map((name) => {
        const value = record[name];
        if (relationFields.has(name)) return [name, relationIds(value).sort()];
        if (Array.isArray(value)) return [name, [...value]];
        return [name, value ?? null];
      })),
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  ]));
}
```

- [ ] **Step 6: Replace `createModel`**

Replace the whole `createModel(tables, config)` function with `createModel(tables, fileUrl)`:

```js
export function createModel(tables, fileUrl) {
  const errors = [];
  const imageTasks = new Map();
  const artistById = new Map(tables.artists.map((record) => [String(record.id), record]));

  const collections = tables.collections
    .filter((record) => record.visible === true)
    .map((record) => ({
      id: String(record.id),
      name: textValue(record.name) ?? "Untitled collection",
      slug: slugify(record.slug || record.name, `collection-${record.id}`),
      order: orderValue(record.display_order),
      collapsible: record.collapsible === true,
      characters: [],
    }));
  const collectionById = new Map(collections.map((item) => [item.id, item]));

  const characters = tables.characters
    .filter((record) => record.visible === true)
    .map((record) => {
      const name = textValue(record.name) ?? "Untitled character";
      return {
        id: String(record.id),
        name,
        slug: slugify(record.slug || name, `character-${record.id}`),
        subtitle: textValue(record.subtitle),
        order: orderValue(record.display_order),
        color: accentColor(record.accent_color, record.slug || name),
        collectionId: relationIds(record.collection)[0] ?? null,
        social: textValue(record.social_url) ? {
          label: textValue(record.social_label) ?? "Profile",
          url: record.social_url.trim(),
        } : null,
        thumbnail: null,
        thumbnailAttachment: fileAttachments("characters", record, "card_thumbnail", fileUrl)[0] ?? null,
        versions: [],
      };
    })
    .filter((character) => collectionById.has(character.collectionId));
  const characterById = new Map(characters.map((item) => [item.id, item]));

  for (const character of characters) {
    const attachment = character.thumbnailAttachment;
    delete character.thumbnailAttachment;
    if (!attachment) continue;
    const taskKey = `character-thumbnail:${character.id}:${attachment.id}`;
    imageTasks.set(taskKey, {
      key: taskKey,
      attachment,
      sourceUrl: attachment.sourceUrl,
      derivativeWidths: THUMBNAIL_WIDTHS,
    });
    character.thumbnail = { taskKey };
  }

  const versions = tables.versions
    .filter((record) => record.visible === true)
    .map((record) => {
      const characterId = relationIds(record.character)[0] ?? null;
      const character = characterById.get(characterId);
      const name = textValue(record.name) ?? "Default";
      const slug = slugify(record.slug || name, `version-${record.id}`);
      return {
        id: String(record.id),
        name,
        slug,
        order: orderValue(record.display_order),
        characterId,
        galleryUrl: character ? `/data/cms/gallery/${character.slug}--${slug}.json` : null,
        commissionCount: 0,
        referenceSheets: [],
        referenceAttachments: fileAttachments("versions", record, "reference_sheet", fileUrl),
      };
    })
    .filter((version) => characterById.has(version.characterId));
  const versionById = new Map(versions.map((item) => [item.id, item]));

  for (const version of versions) {
    for (const attachment of version.referenceAttachments) {
      const taskKey = `reference:${version.id}:${attachment.id}`;
      imageTasks.set(taskKey, {
        key: taskKey,
        attachment,
        sourceUrl: attachment.sourceUrl,
        preserveOriginal: true,
      });
      version.referenceSheets.push({ taskKey });
    }
    delete version.referenceAttachments;
  }

  const galleries = new Map(versions.map((version) => [version.id, []]));
  for (const record of tables.commissions) {
    if (record.published !== true) continue;

    const internalName = textValue(record.name);
    const label = `Commission ${record.id}${internalName ? ` (${internalName})` : ""}`;
    const type = textValue(record.type) ?? "";
    const sourceUrl = textValue(record.source_url) ?? "";
    const attachments = fileAttachments("commissions", record, "image", fileUrl);
    const linkedVersionIds = relationIds(record.versions).filter((id) => versionById.has(id));
    const linkedArtists = relationIds(record.artists)
      .map((id) => artistById.get(id))
      .filter(Boolean)
      .map((artist) => ({ name: textValue(artist.name) ?? "", url: textValue(artist.url) }))
      .filter((artist) => artist.name);

    const problems = [];
    if (!type) problems.push("Type");
    if (!sourceUrl) problems.push("Source URL");
    if (!attachments.length) problems.push("Image");
    if (!linkedVersionIds.length) problems.push("at least one visible Version");
    if (!linkedArtists.length) problems.push("Artist");
    if (problems.length) {
      errors.push(`${label}: missing ${problems.join(", ")}; skipped.`);
      continue;
    }

    for (const attachment of attachments) {
      const taskKey = `commission:${record.id}:${attachment.id}`;
      imageTasks.set(taskKey, { key: taskKey, attachment, sourceUrl: attachment.sourceUrl });
      const item = {
        id: `${record.id}-${attachment.id}`,
        recordId: String(record.id),
        title: type,
        type,
        artist: linkedArtists.map((artist) => artist.name).join(", "),
        artists: linkedArtists,
        sourceUrl,
        date: dateOnly(record.date),
        displayOrder: orderValue(record.display_order),
        taskKey,
      };
      for (const versionId of linkedVersionIds) galleries.get(versionId).push({ ...item });
    }
  }

  for (const collection of collections) {
    collection.characters = characters.filter((character) => character.collectionId === collection.id);
  }
  for (const character of characters) {
    character.versions = versions.filter((version) => version.characterId === character.id);
  }
  for (const version of versions) {
    const items = galleries.get(version.id);
    items.sort((left, right) =>
      numericOrder(left.displayOrder) - numericOrder(right.displayOrder) ||
      String(right.date ?? "").localeCompare(String(left.date ?? "")) ||
      left.id.localeCompare(right.id),
    );
    version.commissionCount = items.length;
  }

  collections.sort(byOrderThenName);
  for (const collection of collections) collection.characters.sort(byOrderThenName);
  for (const character of characters) character.versions.sort(byOrderThenName);

  return { collections, galleries, versions, imageTasks, errors };
}
```

- [ ] **Step 7: Simplify `processImage`**

In `processImage`, replace everything from `let processingBuffer = buffer;` through `usedThumbnailFallback = true;\n  }` with:

```js
  const processingBuffer = buffer;
  const usedThumbnailFallback = false;
  try {
    await sharp(processingBuffer, { animated: false }).metadata();
  } catch (error) {
    throw new Error(
      `${task.key} (${task.attachment?.title || "untitled"}) cannot be decoded by Sharp: ${error.message}. ` +
      "Re-upload the image as PNG, JPEG, WebP, or GIF.",
    );
  }
```

Leave the rest of `processImage` untouched; `usedThumbnailFallback` is still referenced in the stem and return value and is now always `false`. The `downloadTask` function is unchanged: PocketBase file URLs are public and need no header.

- [ ] **Step 8: Update `main` and guard it**

Replace the top of `main()` down to `const tables = ...` with:

```js
async function main() {
  loadEnvironment(SITE_DIR);
  const client = createPocketBaseClient(getPocketBaseConfig());
  console.log("Fetching collections, characters, versions, commissions, and artists from PocketBase...");
  const tables = {
    collections: await client.listAll("collections"),
    characters: await client.listAll("characters"),
    versions: await client.listAll("versions"),
    commissions: await client.listAll("commissions"),
    artists: await client.listAll("artists"),
  };
```

Change `const model = createModel(tables, config);` to `const model = createModel(tables, client.fileUrl);`.

Change `commissions.filter((record) => record.fields?.Published === true)` to `tables.commissions.filter((record) => record.published === true)`.

Replace every log string containing `NocoDB` in `main()` with `PocketBase` (three `console.log` lines about changes detected, and the final `catch` message `NocoDB sync failed` becomes `Gallery sync failed`).

Replace the final `main().catch(...)` with:

```js
const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((error) => {
    console.error(`Gallery sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 9: Run the tests**

Run: `npm test`
Expected: all `sync-gallery-model` tests pass. If `publicSourceSnapshot ignores internal fields` fails, check that `name` on commissions is not in the `wanted.commissions` list.

- [ ] **Step 10: Lint**

Run: `npm run lint`
Expected: clean. Unused imports or the removed `config` parameter are the likely complaints.

- [ ] **Step 11: Run against the real PocketBase**

With `CMS_*` in `site/.env.local` (from Task 6 step 10) and the old `NOCODB_*` lines still present (they are ignored now):

```bash
npm run sync:check ; echo "exit $?"
```

Expected: `Public PocketBase changes detected.` and `exit 10` (the manifest version changed, so everything is stale).

```bash
npm run sync
npm run validate:cms
npm run sync:check ; echo "exit $?"
```

Expected: the sync downloads and processes every image once (this is the slow, one-time pass), the validator prints `passed`, and the second check prints `exit 0`.

- [ ] **Step 12: Commit**

```bash
git add site/scripts/sync-nocodb.mjs site/scripts/tests/sync-gallery-model.test.mjs
git commit -m "feat: gallery sync reads from PocketBase"
```

---

### Task 8: Uma sync on PocketBase [code]

**Files:**
- Modify: `site/scripts/sync-uma-nocodb.mjs`
- Test: `site/scripts/tests/sync-uma-model.test.mjs`

**Interfaces:**
- Consumes: Task 2 client.
- Produces: named export `createModel(scenarioRecords, eventRecords, supportCardRecords, fileUrl)` with the same return shape as today: `{ scenarios, events, supportCards, imageTasks, errors }`. Image tasks carry `sourceUrl`.

- [ ] **Step 1: Write the failing tests**

Create `site/scripts/tests/sync-uma-model.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../sync-uma-nocodb.mjs';

const fileUrl = (collection, recordId, filename) => `http://pb/api/files/${collection}/${recordId}/${filename}`;

const scenarios = [
  { id: 's1', name: 'URA Finals', short_name: 'URA', slug: 'ura', era_start: '2025-06-26 00:00:00.000Z', era_end: '2025-12-31 00:00:00.000Z', display_color: '#123456' },
  { id: 's2', name: 'Broken', era_start: '2025-12-31 00:00:00.000Z', era_end: '2025-01-01 00:00:00.000Z' },
];
const events = [
  { id: 'e1', name: 'CM Leo', event_number: 1, slug: '', event_type: 'Champions Meeting', start_date: '2025-08-01 00:00:00.000Z',
    end_date: '2025-08-05 00:00:00.000Z', scenario: 's1', distance_class: 'medium', distance_m: 2400, surface: 'Turf', status: 'Confirmed' },
  { id: 'e2', name: 'No dates', start_date: '', end_date: '' },
  { id: 'e3', name: 'Zero number', event_number: 0, start_date: '2025-09-01 00:00:00.000Z', end_date: '2025-09-02 00:00:00.000Z', scenario: 's2', distance_m: 0, status: '' },
];
const cards = [
  { id: 'c1', name: 'Kitasan Black', character_name: 'Kitasan Black', slug: '', image: 'kitasan_ab12.png', card_type: 'Speed', rating: 'Auto Include',
    release_date: '2025-06-26 00:00:00.000Z', styles: ['Front Runner', 'Pace Chaser'], pvp_events: ['e1', 'e2'] },
  { id: 'c2', name: '', character_name: 'Nameless', image: '', styles: null, pvp_events: [] },
];

test('scenarios are validated and sorted', () => {
  const model = createModel(scenarios, events, cards, fileUrl);
  assert.deepEqual(model.scenarios.map((scenario) => scenario.id), ['s1']);
  assert.equal(model.scenarios[0].eraStart, '2025-06-26');
  assert.ok(model.errors.some((error) => /Scenario s2/.test(error)));
});

test('events normalise dates, numbers, status, and scenario links', () => {
  const model = createModel(scenarios, events, cards, fileUrl);
  const byId = Object.fromEntries(model.events.map((event) => [event.id, event]));
  assert.equal(byId.e1.startDate, '2025-08-01');
  assert.equal(byId.e1.slug, 'cm-leo');
  assert.equal(byId.e1.scenarioId, 's1');
  assert.equal(byId.e1.status, 'confirmed');
  assert.equal(byId.e1.distanceM, 2400);
  assert.equal(byId.e2, undefined);
  assert.equal(byId.e3.eventNumber, null, 'event_number 0 means unset');
  assert.equal(byId.e3.distanceM, null);
  assert.equal(byId.e3.scenarioId, null, 'link to an invalid scenario is dropped');
  assert.equal(byId.e3.status, 'unspecified');
});

test('support cards map styles, event links, and image tasks', () => {
  const model = createModel(scenarios, events, cards, fileUrl);
  const [kitasan, nameless] = model.supportCards;
  assert.equal(kitasan.slug, 'kitasan-black');
  assert.deepEqual(kitasan.styles, ['Front Runner', 'Pace Chaser']);
  assert.deepEqual(kitasan.eventIds, ['e1'], 'link to an invalid event is dropped');
  assert.equal(kitasan.releaseDate, '2025-06-26');
  assert.equal(kitasan.imageTaskKey, 'support-card:c1:kitasan_ab12.png');
  assert.equal(model.imageTasks.get(kitasan.imageTaskKey).sourceUrl, 'http://pb/api/files/uma_support_cards/c1/kitasan_ab12.png');
  assert.equal(nameless.name, 'Nameless');
  assert.deepEqual(nameless.styles, []);
  assert.equal(nameless.imageTaskKey, null);
});
```

- [ ] **Step 2: Run tests to see them fail**

Run: `npm test`
Expected: FAIL, no export `createModel` and the module runs `main()` on import.

- [ ] **Step 3: Rewrite the fetch layer and helpers**

In `site/scripts/sync-uma-nocodb.mjs`:

Replace the imports with:

```js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadEnvironment } from './lib/env.mjs';
import { getPocketBaseConfig, createPocketBaseClient } from './lib/pocketbase-client.mjs';
```

Delete `API_PAGE_SIZE`, the local `loadEnvironment`, `getConfig`, `fetchTable`, and `attachmentSnapshot`. Keep `API_TIMEOUT_MS` (used by `downloadImage`).

Replace `multiText` with:

```js
function multiText(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? value.split(',') : [];
  return values.map((item) => text(typeof item === 'object' ? item?.title ?? item?.value ?? item?.name : item)).filter(Boolean);
}
```

Add after `text`:

```js
function positiveNumber(value) {
  // PocketBase stores an unset number as 0; treat 0 as unset.
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
```

Replace `processImage(task, previous, baseUrl)` with:

```js
async function processImage(task, previous) {
  const signature = fingerprint({ filename: task.attachment.title });
  if (previous?.signature === signature && imageFileExists(previous.image?.fallback?.url)) return previous;
  const buffer = await downloadImage(task.sourceUrl);
  try { await sharp(buffer).metadata(); } catch (error) {
    throw new Error(`${task.key}: ${task.attachment.title} cannot be decoded (${error.message}). Re-upload as PNG, JPEG, or WebP.`);
  }
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

- [ ] **Step 4: Rewrite `createModel`**

Replace the whole `createModel` with:

```js
export function createModel(scenarioRecords, eventRecords, supportCardRecords, fileUrl) {
  const errors = [];
  const scenarios = scenarioRecords.map((record) => {
    const name = text(record.name);
    const eraStart = date(record.era_start);
    const eraEnd = date(record.era_end);
    if (!name || !eraStart || !eraEnd || eraEnd < eraStart) {
      errors.push(`Scenario ${record.id}: requires name and a valid era_start/era_end range; skipped.`);
      return null;
    }
    return {
      id: String(record.id), name,
      shortName: text(record.short_name),
      slug: slugify(record.slug || name, `scenario-${record.id}`),
      eraStart, eraEnd,
      displayColor: text(record.display_color),
    };
  }).filter(Boolean);
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));

  const events = eventRecords.map((record) => {
    const name = text(record.name);
    const startDate = date(record.start_date);
    const endDate = date(record.end_date);
    if (!name || !startDate || !endDate || endDate < startDate) {
      errors.push(`PvP event ${record.id}: requires name and a valid start_date/end_date range; skipped.`);
      return null;
    }
    const scenarioId = relationIds(record.scenario).find((id) => scenarioIds.has(id)) ?? null;
    return {
      id: String(record.id), name,
      eventNumber: positiveNumber(record.event_number),
      slug: slugify(record.slug || name, `pvp-event-${record.id}`),
      eventType: text(record.event_type),
      startDate, endDate, scenarioId,
      distanceClass: text(record.distance_class),
      distanceM: positiveNumber(record.distance_m),
      racecourse: text(record.racecourse),
      direction: text(record.direction),
      trackCondition: text(record.track_condition),
      season: text(record.season),
      weather: text(record.weather),
      surface: text(record.surface),
      status: status(record.status),
    };
  }).filter(Boolean);
  const eventIds = new Set(events.map((event) => event.id));

  const imageTasks = new Map();
  const supportCards = supportCardRecords.map((record) => {
    const name = text(record.name);
    const characterName = text(record.character_name);
    const filename = typeof record.image === 'string' && record.image ? record.image : null;
    const taskKey = filename ? `support-card:${record.id}:${filename}` : null;
    if (taskKey) {
      imageTasks.set(taskKey, {
        key: taskKey,
        attachment: { id: filename, title: filename },
        sourceUrl: fileUrl('uma_support_cards', record.id, filename),
      });
    }
    return {
      id: String(record.id),
      slug: slugify(record.slug || name || characterName, `support-card-${record.id}`),
      name: name || characterName || 'Untitled support card',
      characterName,
      cardType: text(record.card_type),
      rating: text(record.rating),
      releaseDate: date(record.release_date),
      styles: multiText(record.styles),
      eventIds: relationIds(record.pvp_events).filter((id) => eventIds.has(id)),
      imageTaskKey: taskKey,
    };
  });

  scenarios.sort((left, right) => left.eraStart.localeCompare(right.eraStart) || left.name.localeCompare(right.name));
  events.sort((left, right) => left.startDate.localeCompare(right.startDate) || (left.eventNumber ?? Infinity) - (right.eventNumber ?? Infinity) || left.name.localeCompare(right.name));
  return { scenarios, events, supportCards, imageTasks, errors };
}
```

The existing `date(value)` helper already slices to ten characters, so PocketBase's `YYYY-MM-DD 00:00:00.000Z` values work unchanged.

- [ ] **Step 5: Rewrite `main` and guard it**

```js
async function main() {
  loadEnvironment(SITE_DIR);
  const client = createPocketBaseClient(getPocketBaseConfig());
  const scenarios = await client.listAll('uma_scenarios');
  const events = await client.listAll('uma_pvp_events');
  const supportCards = await client.listAll('uma_support_cards');
  const model = createModel(scenarios, events, supportCards, client.fileUrl);
  const sourceFingerprint = fingerprint({ scenarios, events, supportCards });
  const previous = readJson(MANIFEST_FILE, {});
  const current = previous.sourceFingerprint === sourceFingerprint && fs.existsSync(OUTPUT_FILE);
  if (CHECK_ONLY) {
    console.log(current ? 'No public Uma PocketBase changes detected.' : 'Public Uma PocketBase changes detected.');
    process.exitCode = current ? 0 : 10;
    return;
  }
  if (model.errors.length) for (const error of model.errors) console.warn(`- ${error}`);
  console.log(`Processing ${model.imageTasks.size} support-card image(s).`);
  const attachments = {};
  for (const task of model.imageTasks.values()) attachments[task.key] = await processImage(task, previous.attachments?.[task.key]);
  console.log('Publishing public Uma timeline data.');
  for (const card of model.supportCards) {
    card.image = card.imageTaskKey ? attachments[card.imageTaskKey].image : null;
    delete card.imageTaskKey;
  }
  writeJsonAtomic(OUTPUT_FILE, { schemaVersion: 1, generatedAt: new Date().toISOString(), scenarios: model.scenarios, pvpEvents: model.events, supportCards: model.supportCards });
  writeJsonAtomic(MANIFEST_FILE, { sourceFingerprint, attachments });
  console.log(`Wrote public/data/uma/timeline.json with ${model.scenarios.length} scenario(s), ${model.events.length} PvP event(s), and ${model.supportCards.length} support card(s).`);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((error) => { console.error(`Uma sync failed: ${error.message}`); process.exitCode = 1; });
}
```

- [ ] **Step 6: Tests and lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 7: Run against the real PocketBase**

```bash
npm run sync:uma
npm run validate:uma
npm run sync:uma:check ; echo "exit $?"
```

Expected: `Uma output validation passed.` and `exit 0`.

- [ ] **Step 8: Commit**

```bash
git add site/scripts/sync-uma-nocodb.mjs site/scripts/tests/sync-uma-model.test.mjs
git commit -m "feat: Uma sync reads from PocketBase"
```

---

### Task 9: Prove the output matches the baseline [code, needs the Task 5 baseline]

**Files:**
- Create: `site/scripts/migrate/compare-output.mjs`

**Interfaces:**
- Consumes: `site/.cache/baseline/data` (Task 5) and `site/public/data` (Tasks 7 and 8).
- Produces: exit 0 when the public content is equivalent, exit 1 with a list of differences otherwise.

- [ ] **Step 1: Write the comparison script**

Create `site/scripts/migrate/compare-output.mjs`:

```js
// Compares baseline (NocoDB-built) public JSON with the PocketBase-built JSON.
// IDs, timestamps, and hashed image filenames differ by design, so both sides
// are normalised to slugs and image dimensions before a deep comparison.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = path.join(SITE_DIR, '.cache', 'baseline', 'data');
const CURRENT = path.join(SITE_DIR, 'public', 'data');
const differences = [];

const read = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const image = (descriptor) => descriptor ? {
  width: descriptor.width, height: descriptor.height,
  avif: (descriptor.sources?.avif ?? []).map((source) => source.width),
  webp: (descriptor.sources?.webp ?? []).map((source) => source.width),
  hasOriginal: Boolean(descriptor.originalUrl),
} : null;

function normaliseSite(site) {
  return site.collections.map((collection) => ({
    slug: collection.slug, name: collection.name, order: collection.order, collapsible: collection.collapsible,
    characters: collection.characters.map((character) => ({
      slug: character.slug, name: character.name, subtitle: character.subtitle, order: character.order,
      color: character.color, social: character.social, thumbnail: image(character.thumbnail),
      versions: character.versions.map((version) => ({
        slug: version.slug, name: version.name, order: version.order, galleryUrl: version.galleryUrl,
        commissionCount: version.commissionCount, referenceSheets: version.referenceSheets.map(image),
      })),
    })),
  }));
}

function normaliseGallery(gallery) {
  return {
    character: gallery.character.slug, version: gallery.version.slug,
    commissions: gallery.commissions.map((item) => ({
      title: item.title, type: item.type, artist: item.artist, artists: item.artists,
      sourceUrl: item.sourceUrl, date: item.date, displayOrder: item.displayOrder, image: image(item.image),
    })),
  };
}

function normaliseTimeline(timeline) {
  const scenarioSlug = new Map(timeline.scenarios.map((scenario) => [scenario.id, scenario.slug]));
  const eventSlug = new Map(timeline.pvpEvents.map((event) => [event.id, event.slug]));
  return {
    scenarios: timeline.scenarios.map(({ id: _id, ...scenario }) => scenario),
    pvpEvents: timeline.pvpEvents.map(({ id: _id, scenarioId, ...event }) => ({ ...event, scenario: scenarioSlug.get(scenarioId) ?? null })),
    supportCards: timeline.supportCards.map(({ id: _id, eventIds, image: descriptor, ...card }) => ({
      ...card, events: eventIds.map((eventId) => eventSlug.get(eventId)).sort(), image: image(descriptor),
    })),
  };
}

function compare(label, left, right, trail = label) {
  if (JSON.stringify(left) === JSON.stringify(right)) return;
  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {
    left.forEach((item, index) => compare(label, item, right[index], `${trail}[${index}]`));
    return;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) compare(label, left[key], right[key], `${trail}.${key}`);
    return;
  }
  differences.push(`${trail}: baseline ${JSON.stringify(left)} vs current ${JSON.stringify(right)}`);
}

compare('site.json', normaliseSite(read(BASELINE, 'cms/site.json')), normaliseSite(read(CURRENT, 'cms/site.json')));

const galleryFiles = new Set([
  ...fs.readdirSync(path.join(BASELINE, 'cms', 'gallery')),
  ...fs.readdirSync(path.join(CURRENT, 'cms', 'gallery')),
]);
for (const file of galleryFiles) {
  const baselineFile = path.join(BASELINE, 'cms', 'gallery', file);
  const currentFile = path.join(CURRENT, 'cms', 'gallery', file);
  if (!fs.existsSync(baselineFile) || !fs.existsSync(currentFile)) {
    differences.push(`gallery/${file}: present on only one side`);
    continue;
  }
  compare(`gallery/${file}`, normaliseGallery(read(BASELINE, `cms/gallery/${file}`)), normaliseGallery(read(CURRENT, `cms/gallery/${file}`)));
}

compare('timeline.json', normaliseTimeline(read(BASELINE, 'uma/timeline.json')), normaliseTimeline(read(CURRENT, 'uma/timeline.json')));

if (differences.length) {
  console.error(`Output differs from baseline in ${differences.length} place(s):`);
  for (const difference of differences) console.error(`- ${difference}`);
  process.exitCode = 1;
} else {
  console.log('PocketBase-built output matches the NocoDB baseline.');
}
```

- [ ] **Step 2: Run it**

From `site/`, after Tasks 7 and 8 have produced fresh output:

```bash
node scripts/migrate/compare-output.mjs
```

Expected: `matches the NocoDB baseline.`

Acceptable differences to investigate and then accept:
- A gallery item that was previously ordered by a `Display Order` of `0` now sorts last (0 is treated as unset).
- Image `width`/`height` differing by one pixel is not expected; if it happens, the migration uploaded a different file. Check that record in both systems.

Unacceptable differences: missing gallery files, different commission counts, different titles or artists, different dates. Fix the mapping in Task 6 or 7 and re-run.

- [ ] **Step 3: Commit**

```bash
git add site/scripts/migrate/compare-output.mjs
git commit -m "chore: baseline comparison script for the CMS migration"
```

---

### Task 10: Documentation and configuration [code]

**Files:**
- Modify: `site/.env.example`
- Modify: `site/WORKFLOW.md`
- Modify: `AGENTS.md` (the agent guidance file; `CLAUDE.md` only imports it)
- Modify: `vps-scripts/systemd/cuddlebuns-gallery-sync.service`, `vps-scripts/systemd/cuddlebuns-gallery-sync.timer`
- Modify: `vps-scripts/sync-build-deploy.sh` (comments and messages only)

- [ ] **Step 1: Replace `.env.example`**

```dotenv
# PocketBase CMS. Get the sync account details from the team password manager.
CMS_URL=https://cms.cuddlebuns.moe
CMS_EMAIL=sync@cuddlebuns.moe
CMS_PASSWORD=YOUR_PASSWORD

# Optional image pipeline knobs for slow machines
# CMS_IMAGE_CONCURRENCY=1
# CMS_WEBP_ONLY=1
```

- [ ] **Step 2: Rewrite the NocoDB sections of `WORKFLOW.md`**

Replace the "One-time local setup" section body with:

````markdown
Copy `.env.example` to `.env.local` and fill in the PocketBase sync account:

```dotenv
CMS_URL=https://cms.cuddlebuns.moe
CMS_EMAIL=sync@cuddlebuns.moe
CMS_PASSWORD=...
```

Then:

```powershell
npm.cmd install
npm.cmd run sync
npm.cmd run sync:uma
npm.cmd run dev
```

Open `http://localhost:5173/gallery`.
````

Replace "Editing the gallery in NocoDB" with "Editing the gallery in PocketBase", keeping the relationships diagram and the published-commission requirements, and changing:

- "NocoDB" to "PocketBase" and "the `Title` field" to "the `name` field on a commission".
- Add: "Display order starts at 1. Leaving it at 0 means unset, and unset records sort after ordered ones, alphabetically."
- Add: "Uploads are limited to 50 MB per image for commissions and reference sheets and 20 MB for card thumbnails. Supported formats: PNG, JPEG, GIF, WebP, AVIF."
- Add: "Log in at `https://cms.cuddlebuns.moe/_/`. Ask an admin for an account."

Rename "Editing the Uma timeline in NocoDB" to "... in PocketBase" and note: "`styles` is a JSON list, for example `["Front Runner", "Pace Chaser"]`."

In "Local commands", add `npm run test` (unit tests for the sync scripts) and `npm run schema:cms` (creates any missing PocketBase collections; safe to re-run).

In "VPS automatic deployment", replace "Create `/etc/cuddlebuns/gallery.env` with the same eight NocoDB values used locally" with "Create `/etc/cuddlebuns/gallery.env` with the three `CMS_*` values". Add a subsection:

````markdown
### PocketBase on the VPS

PocketBase runs from `vps-scripts/docker-compose.yml` with its data in `/var/lib/cuddlebuns/pb_data`.

```bash
cd /var/www/cuddlebuns/source/vps-scripts
docker compose up -d --build        # start or rebuild after bumping PB_VERSION
docker compose logs -f pocketbase   # follow logs
```

Backups are scheduled inside PocketBase (Settings > Backups) and land in
`/var/lib/cuddlebuns/pb_data/backups`. To restore, stop the container, replace
`pb_data` with the unzipped backup, start the container.

The schema is exported to `vps-scripts/pocketbase/pb_schema.json`. Re-export it
from Settings > Export collections whenever fields change.
````

In "Troubleshooting", replace the NocoDB bullet with: "Timer fails before building: verify `/etc/cuddlebuns/gallery.env`, that `curl http://127.0.0.1:8090/api/health` returns 200, and that `npm ci` was run in the VPS source checkout."

- [ ] **Step 3: Update `AGENTS.md`**

In the architecture section, replace "NocoDB" with "PocketBase" throughout, and:

- Change the title line to `## Architecture: PocketBase -> static JSON -> Vite -> Caddy`.
- Item 1: "`scripts/sync-gallery.mjs` fetches the `collections`, `characters`, `versions`, `commissions`, and `artists` collections through `scripts/lib/pocketbase-client.mjs`..." (use the post-rename filename from Task 12).
- Item 2: "`scripts/sync-uma.mjs` reads `uma_scenarios`, `uma_pvp_events`, `uma_support_cards` from the same PocketBase instance."
- Replace the env-var paragraph in Commands with: "Sync scripts need `site/.env.local` with `CMS_URL`, `CMS_EMAIL`, `CMS_PASSWORD` (copy from `.env.example`)."
- Add `npm test` to the command list: `# node:test suites in scripts/tests/`.
- Conventions: replace the NocoDB token sentence with "The PocketBase password (`CMS_PASSWORD`) must never be prefixed `VITE_`, committed, or referenced from browser code." Add: "PocketBase returns `0` for unset numbers and `\"\"` for unset text; sync helpers `orderValue`, `positiveNumber`, and `textValue` normalise these. Display orders start at 1."
- Add to Deployment: "PocketBase itself runs from `vps-scripts/docker-compose.yml` behind Caddy at `cms.cuddlebuns.moe`, data in `/var/lib/cuddlebuns/pb_data`."
- Remove the sentence about the `.mjs` lint gap; it is fixed in Task 1.

- [ ] **Step 4: systemd and deploy script wording**

`cuddlebuns-gallery-sync.service`: `Description=Sync PocketBase and atomically deploy cuddlebuns gallery`.
`cuddlebuns-gallery-sync.timer`: `Description=Check PocketBase for gallery changes every five minutes`.
`sync-build-deploy.sh`: line 2 comment becomes `# Runs on the VPS. PocketBase credentials come from the systemd EnvironmentFile.`; the two error messages `Gallery NocoDB change check failed` and `Uma NocoDB change check failed` become `Gallery change check failed` and `Uma change check failed`; the "NocoDB and source code are unchanged" message becomes "CMS and source code are unchanged".

- [ ] **Step 5: Commit**

```bash
git add site/.env.example site/WORKFLOW.md AGENTS.md vps-scripts/systemd vps-scripts/sync-build-deploy.sh
git commit -m "docs: describe the PocketBase CMS setup and editing workflow"
```

---

### Task 11: Switch the VPS to PocketBase [ops]

- [ ] **Step 1: Push everything and pull on the VPS**

From your laptop: `git push origin main`.

On the VPS:

```bash
cd /var/www/cuddlebuns/source && git pull origin main
cd site && npm ci
npm test
```

Expected: tests pass on the VPS too (this also confirms Node is 22+).

- [ ] **Step 2: Replace the environment file**

```bash
sudo cp /etc/cuddlebuns/gallery.env /etc/cuddlebuns/gallery.env.nocodb-backup
sudo tee /etc/cuddlebuns/gallery.env > /dev/null <<'EOF'
CMS_URL=http://127.0.0.1:8090
CMS_EMAIL=sync@cuddlebuns.moe
CMS_PASSWORD=PASTE_THE_SYNC_PASSWORD
EOF
sudo chown root:root /etc/cuddlebuns/gallery.env && sudo chmod 600 /etc/cuddlebuns/gallery.env
```

`127.0.0.1:8090` skips Caddy for the sync, which is fine on the same host.

- [ ] **Step 3: Install updated units and run one deploy by hand**

```bash
sudo cp /var/www/cuddlebuns/source/vps-scripts/systemd/cuddlebuns-gallery-sync.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start cuddlebuns-gallery-sync.service
journalctl -u cuddlebuns-gallery-sync.service -n 200 --no-pager
```

Expected in the journal: `Public PocketBase changes detected.`, the image pass (slow the first time), both validators passing, `Activated release <timestamp>`.

- [ ] **Step 4: Verify the live site**

```bash
readlink -f /var/www/cuddlebuns/current
curl -s https://cuddlebuns.moe/data/cms/site.json | head -c 400
```

In a browser: open `https://cuddlebuns.moe/gallery`, click through two characters and a version, open a lightbox, then `https://cuddlebuns.moe/uma/timeline`. Compare against what you remember or against `.cache/baseline` counts.

- [ ] **Step 5: Confirm the timer is quiet when nothing changed**

```bash
sudo systemctl start cuddlebuns-gallery-sync.service
journalctl -u cuddlebuns-gallery-sync.service -n 20 --no-pager
```

Expected: `CMS and source code are unchanged; no deployment needed.`

- [ ] **Step 6: End-to-end edit**

In the dashboard, change the `subtitle` of one visible character. Within five minutes, reload the gallery hub and confirm the new subtitle. Change it back.

- [ ] **Step 7: Freeze NocoDB**

Do not delete NocoDB yet. Remove editors' write access or tell the team it is read-only from today. Note the date; Task 13 happens two weeks later.

---

### Task 12: Rename and clean up [code]

**Files:**
- Rename: `site/scripts/sync-nocodb.mjs` → `site/scripts/sync-gallery.mjs`
- Rename: `site/scripts/sync-uma-nocodb.mjs` → `site/scripts/sync-uma.mjs`
- Modify: `site/package.json`, `site/scripts/tests/sync-gallery-model.test.mjs`, `site/scripts/tests/sync-uma-model.test.mjs`, `vps-scripts/sync-build-deploy.sh`, `site/WORKFLOW.md`

- [ ] **Step 1: Rename with git so history follows**

```bash
git mv site/scripts/sync-nocodb.mjs site/scripts/sync-gallery.mjs
git mv site/scripts/sync-uma-nocodb.mjs site/scripts/sync-uma.mjs
```

- [ ] **Step 2: Update every reference**

`site/package.json`:

```json
"sync": "node scripts/sync-gallery.mjs",
"sync:check": "node scripts/sync-gallery.mjs --check",
"sync:uma": "node scripts/sync-uma.mjs",
"sync:uma:check": "node scripts/sync-uma.mjs --check",
```

Tests: change `from '../sync-nocodb.mjs'` to `from '../sync-gallery.mjs'` and `from '../sync-uma-nocodb.mjs'` to `from '../sync-uma.mjs'`.

`vps-scripts/sync-build-deploy.sh`: `node scripts/sync-nocodb.mjs --check` → `node scripts/sync-gallery.mjs --check`; `node scripts/sync-uma-nocodb.mjs --check` → `node scripts/sync-uma.mjs --check`.

`site/WORKFLOW.md` and `AGENTS.md`: search for `sync-nocodb` and `sync-uma-nocodb` and replace.

In `sync-gallery.mjs`, change `CACHE_DIR` from `.cache/nocodb` to `.cache/gallery`. Leave `public/generated/nocodb/` as the public URL path: changing it would touch Caddy, both validators, and every cached URL for no user-visible benefit.

- [ ] **Step 3: Verify**

```bash
npm test && npm run lint
npm run sync:check ; echo "exit $?"
```

Expected: tests pass. The check exits 10 once because the cache directory moved, then `npm run sync` and a second check exits 0.

- [ ] **Step 4: Commit and deploy**

```bash
git add -A site/scripts site/package.json vps-scripts/sync-build-deploy.sh site/WORKFLOW.md AGENTS.md
git commit -m "refactor: rename sync scripts now that NocoDB is gone"
git push origin main
```

On the VPS: `cd /var/www/cuddlebuns/source && git pull && sudo systemctl start cuddlebuns-gallery-sync.service && journalctl -u cuddlebuns-gallery-sync.service -n 30 --no-pager`. Expected: one rebuild, then quiet.

---

### Task 13: Decommission NocoDB [ops, two weeks after Task 11]

- [ ] **Step 1: Confirm nothing still reads NocoDB**

```bash
grep -rn "NOCODB\|nocodb" /var/www/cuddlebuns/source --include='*.mjs' --include='*.sh' --include='*.md' --include='*.caddy' -l
```

Expected: only `site/scripts/migrate/` and the `public/generated/nocodb` path string.

- [ ] **Step 2: Take a final NocoDB backup**

Whatever the NocoDB install uses (its Docker volume or Postgres dump), archive it once off the server. Keep it for six months.

- [ ] **Step 3: Stop NocoDB and remove its Caddy block**

Stop its container or service. Edit the live Caddyfile to remove the `noco.cuddlebuns.moe` block, `caddy validate`, `systemctl reload caddy`. Remove the DNS record when convenient.

- [ ] **Step 4: Delete the migration code and old env backup [code]**

```bash
git rm -r site/scripts/migrate site/scripts/tests/migrate-transform.test.mjs
```

Remove `"migrate:cms"` from `site/package.json`. Run `npm test && npm run lint`. Commit:

```bash
git commit -am "chore: remove one-time NocoDB migration scripts"
```

On the VPS: `sudo rm /etc/cuddlebuns/gallery.env.nocodb-backup`. Delete the `NOCODB_*` and `UMA_NOCODB_*` lines from every developer's `.env.local` and from the password manager. Delete `site/.cache/baseline` and `site/.cache/nocodb` on the machine that made them.

---

## Self-review notes

Spec coverage: collections and fields (Task 3), access rules private by default (Task 3, `listRule: null`), sync fetch layer and snake_case fields (Tasks 7 and 8), three env vars (Tasks 2, 10, 11), Docker and Caddy (Tasks 3 and 4), backups (Task 4 step 10), migration with ID map and reuse of originals (Task 6; originals are streamed from NocoDB rather than the local cache because the cache is keyed by content hash, which is unknown before download), output diff (Task 9), env file switch and one watched deploy (Task 11), two-week NocoDB fallback (Tasks 11 and 13), docs and AGENTS.md (Task 10), protected files left as a follow-up (Task 3 sets `protected: false`; flip it in the dashboard and add a file token to `downloadTask` if ever needed), build-on-save hooks out of scope.

Deviations from the spec, all stated in Global Constraints: only `name` required at schema level; `styles` is JSON; `legacy_id` added everywhere; commission `internal_title` is stored in the `name` field.

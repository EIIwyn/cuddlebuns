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

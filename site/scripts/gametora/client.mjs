import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; cuddlebuns-uma-importer/1.0)';
const BASE = 'https://gametora.com';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readCachedJson(file, label, log) {
  try {
    return readJson(file);
  } catch (error) {
    log.warn(`${label}: cached copy ${path.basename(file)} is unreadable (${error.message}); ignoring it.`);
    return null;
  }
}
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
    if (exactFile && fs.existsSync(exactFile)) {
      const value = readCachedJson(exactFile, label, log);
      if (value !== null) return value;
    }
    if (noFetch) {
      if (!fallbackFile) throw new Error(`${label}: --no-fetch set and no readable cached copy exists.`);
      const value = readCachedJson(fallbackFile, label, log);
      if (value !== null) return value;
      throw new Error(`${label}: --no-fetch set and no readable cached copy exists.`);
    }
    try {
      const value = await fetchJson(url, label);
      if (exactFile) writeJsonAtomic(exactFile, value);
      return value;
    } catch (error) {
      if (fallbackFile) {
        log.warn(`${label}: fetch failed (${error.message}); using cached copy ${path.basename(fallbackFile)}.`);
        const value = readCachedJson(fallbackFile, label, log);
        if (value !== null) return value;
        throw new Error(`${label}: fetch failed (${error.message}) and the cached copy is unreadable.`);
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

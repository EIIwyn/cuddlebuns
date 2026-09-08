import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getPocketBaseConfig } from '../lib/env.mjs'
import { createPocketBaseClient } from '../lib/pocketbase-client.mjs'
import { createAttachmentResolver } from './attachment-resolver.mjs'
import { runMigration } from './migration-core.mjs'
import { fetchNocoDbSources, getNocoDbMigrationConfig, sourceFingerprint } from './nocodb-source.mjs'
import { transformNocoDbSources } from './nocodb-transform.mjs'

const SITE_DIR = path.resolve(import.meta.dirname, '../..')
const CACHE_DIR = path.join(SITE_DIR, '.cache')
const MANIFEST_FILE = path.join(CACHE_DIR, 'pocketbase-migration', 'manifest.json')
const ORIGINALS_DIR = path.join(CACHE_DIR, 'originals')
const INVENTORY_FILES = [
  path.join(CACHE_DIR, 'migration-baseline', 'gallery-originals-inventory.json'),
  path.join(CACHE_DIR, 'migration-baseline', 'uma-originals-inventory.json'),
]

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function loadEnvironment(file = path.join(SITE_DIR, '.env.local')) {
  let source
  try {
    source = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!process.env[key]) process.env[key] = value
  }
}

function parseArguments(args) {
  const unknown = args.filter((argument) => argument !== '--dry-run')
  if (unknown.length) throw new Error(`Unknown migration argument: ${unknown.join(', ')}`)
  return { dryRun: args.includes('--dry-run') }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
}

export async function main(args = process.argv.slice(2), options = {}) {
  const { dryRun } = parseArguments(args)
  await loadEnvironment(options.envFile)
  const nocoConfig = getNocoDbMigrationConfig(options.env ?? process.env)
  const pocketBaseConfig = getPocketBaseConfig(options.env ?? process.env, 'migration')
  const fetchImpl = options.fetch ?? globalThis.fetch

  console.log('Fetching the pre-migration NocoDB metadata snapshot...')
  const before = await fetchNocoDbSources(nocoConfig, { fetch: fetchImpl })
  const beforeFingerprint = sourceFingerprint(before)
  const inventories = await Promise.all(INVENTORY_FILES.map((file) => readJson(file, { entries: [] })))
  const resolveAttachment = createAttachmentResolver({
    cacheDir: ORIGINALS_DIR,
    inventories,
    fetch: fetchImpl,
    sourceUrls: { gallery: nocoConfig.gallery.url, uma: nocoConfig.uma.url },
  })
  const records = await transformNocoDbSources(before, { resolveAttachment })

  console.log('Fetching the post-attachment NocoDB metadata snapshot...')
  const after = await fetchNocoDbSources(nocoConfig, { fetch: fetchImpl })
  const afterFingerprint = sourceFingerprint(after)
  if (beforeFingerprint !== afterFingerprint) {
    throw new Error('NocoDB metadata changed during source preparation; rejecting the inconsistent run')
  }

  const client = createPocketBaseClient(pocketBaseConfig, { fetch: fetchImpl })
  const previousManifest = await readJson(MANIFEST_FILE, null)
  const generatedAt = new Date().toISOString()
  const result = await runMigration(records, {
    client,
    dryRun,
    previousManifest,
    writeManifest: (progress) => writeJsonAtomic(MANIFEST_FILE, {
      ...progress,
      generatedAt,
      sourceFingerprint: beforeFingerprint,
    }),
  })
  console.log(`${dryRun ? 'Dry run' : 'Migration'} complete: ` +
    `${result.counts.source} source, ${result.counts.created} created, ` +
    `${result.counts.updated} updated, ${result.counts.unchanged} unchanged, ` +
    `${result.counts.failed} failed.`)
  return result
}

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`PocketBase migration failed: ${error.message}`)
    process.exitCode = 1
  })
}

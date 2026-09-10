import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { loadPocketBaseGallerySource } from '../adapters/pocketbase-gallery.mjs'
import { loadPocketBaseUmaSource } from '../adapters/pocketbase-uma.mjs'
import { getPocketBaseConfig } from '../lib/env.mjs'
import { createPocketBaseClient } from '../lib/pocketbase-client.mjs'
import { createAttachmentResolver } from './attachment-resolver.mjs'
import { detectImageFormat } from './migration-core.mjs'
import { fetchNocoDbSources, getNocoDbMigrationConfig } from './nocodb-source.mjs'
import { transformNocoDbSources } from './nocodb-transform.mjs'

export const NORMALIZED_FIELDS = [
  'generatedAt',
  'backendId after complete legacyId mapping',
  'generated URL and commission card attachment ID after source SHA-256 mapping',
]
  'blank display order null/0 equivalence',

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  }
  return value
}

function equal(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right))
}

function validateIdentity(records, side) {
  const legacyIds = new Set()
  const backendIds = new Set()
  for (const record of records) {
    const legacyKey = `${record.collection}:${record.legacyId}`
    const backendKey = `${record.collection}:${record.backendId}`
    if (legacyIds.has(legacyKey)) throw new Error(`${side} has duplicate legacyId ${legacyKey}`)
    if (record.backendId != null && backendIds.has(backendKey)) {
      throw new Error(`${side} has duplicate backendId ${backendKey}`)
    }
    legacyIds.add(legacyKey)
    if (record.backendId != null) backendIds.add(backendKey)
  }
}

function canonicalRecords(records) {
  return [...records].map((record) => ({
    collection: record.collection,
    legacyId: record.legacyId,
    fields: record.fields,
    relations: record.relations,
    files: (record.files ?? []).map((file) => ({
      field: file.field,
      ordinal: file.ordinal,
      sha256: file.sha256,
      detectedFormat: file.detectedFormat,
    })),
  })).sort((left, right) => left.collection.localeCompare(right.collection) || left.legacyId - right.legacyId)
}

function looksLikeGeneratedImageUrl(value) {
  if (typeof value !== 'string') return false
  const pathname = value.split(/[?#]/, 1)[0]
  return pathname.startsWith('/') && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(pathname)
}

function cardAttachmentIdentity(value, urlMap) {
  const fallbackUrl = value?.image?.fallback?.url
  return typeof fallbackUrl === 'string' ? urlMap[fallbackUrl] ?? null : null
}

function canonicalPublic(value, urlMap, location, unmapped) {
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalPublic(item, urlMap, `${location}[${index}]`, unmapped))
  }
  if (value && typeof value === 'object') {
    const attachmentIdentity = cardAttachmentIdentity(value, urlMap)
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'generatedAt')
      .map(([key, item]) => [key, key === 'id' && attachmentIdentity
        ? { mappedAttachmentId: stable(attachmentIdentity) }
        : (key === 'order' || key === 'displayOrder') && item === null
          ? 0
          : canonicalPublic(item, urlMap, `${location}.${key}`, unmapped)]))
  }
  if (looksLikeGeneratedImageUrl(value)) {
    const mapped = urlMap[value]
    if (!mapped) {
      unmapped.push(`${location}: ${value}`)
      return { unmappedUrl: path.extname(value) }
    }
    return { mappedImage: stable(mapped) }
  }
  return value
}

export function compareSnapshots(left, right) {
  validateIdentity(left.records, 'left snapshot')
  validateIdentity(right.records, 'right snapshot')
  const differences = []
  const leftRecords = canonicalRecords(left.records)
  const rightRecords = canonicalRecords(right.records)
  if (!equal(leftRecords, rightRecords)) differences.push('source records, relationships, arrays, or original files differ')

  const leftUnmapped = []
  const rightUnmapped = []
  const leftPublic = canonicalPublic(left.publicFiles, left.urlMap, 'left.publicFiles', leftUnmapped)
  const rightPublic = canonicalPublic(right.publicFiles, right.urlMap, 'right.publicFiles', rightUnmapped)
  differences.push(...leftUnmapped.map((item) => `unmapped left generated URL at ${item}`))
  differences.push(...rightUnmapped.map((item) => `unmapped right generated URL at ${item}`))
  if (!equal(leftPublic, rightPublic)) differences.push('public JSON shapes, values, order, or image descriptors differ')

  return { equal: differences.length === 0, differences, normalized: [...NORMALIZED_FIELDS] }
}

function fileSlot(taskKey) {
  const [kind, legacyId] = taskKey.split(':')
  return {
    'character-thumbnail': { collection: 'characters', legacyId: Number(legacyId), field: 'card_thumbnail' },
    reference: { collection: 'versions', legacyId: Number(legacyId), field: 'reference_sheet' },
    commission: { collection: 'commissions', legacyId: Number(legacyId), field: 'image' },
    'support-card': { collection: 'uma_support_cards', legacyId: Number(legacyId), field: 'image' },
  }[kind]
}

export function buildUrlMap(manifests, records) {
  const files = new Map(records.flatMap((record) => (record.files ?? []).map((file) => [
    `${record.collection}:${record.legacyId}:${file.field}:${file.ordinal}`,
    file,
  ])))
  const ordinals = new Map()
  const result = {}
  for (const manifest of manifests) {
    for (const [taskKey, entry] of Object.entries(manifest.attachments ?? {})) {
      const slot = fileSlot(taskKey)
      if (!slot) throw new Error(`Unknown image task key: ${taskKey}`)
      const prefix = `${slot.collection}:${slot.legacyId}:${slot.field}`
      const ordinal = ordinals.get(prefix) ?? 0
      ordinals.set(prefix, ordinal + 1)
      const file = files.get(`${prefix}:${ordinal}`)
      if (!file) throw new Error(`Image task ${taskKey} has no source file at ordinal ${ordinal}`)
      for (const [format, descriptors] of Object.entries(entry.image?.sources ?? {})) {
        for (const descriptor of descriptors) result[descriptor.url] = {
          sourceSha256: file.sha256, kind: 'derivative', format,
          width: descriptor.width, height: descriptor.height,
        }
      }
      if (entry.image?.originalUrl) result[entry.image.originalUrl] = {
        sourceSha256: file.sha256, kind: 'original', format: file.detectedFormat,
      }
    }
  }
  return result
}

async function loadEnvironment(siteDir) {
  let source
  try { source = await readFile(path.join(siteDir, '.env.local'), 'utf8') } catch (error) {
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

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function loadPublicFiles(directory) {
  const result = {}
  async function visit(current) {
    for (const name of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(current, name.name)
      if (name.isDirectory()) await visit(file)
      else if (name.name.endsWith('.json')) {
        result[path.relative(directory, file).replaceAll('\\', '/')] = await readJson(file)
      }
    }
  }
  await visit(path.join(directory, 'data'))
  return result
}

async function loadBundle(directory, records) {
  const manifests = await Promise.all(['gallery-manifest.json', 'uma-manifest.json']
    .map((name) => readJson(path.join(directory, name))))
  return { records, publicFiles: await loadPublicFiles(directory), urlMap: buildUrlMap(manifests, records) }
}

function parseArguments(args, siteDir) {
  const values = {
    left: path.join(siteDir, '.cache', 'migration-baseline', 'nocodb'),
    right: path.join(siteDir, '.cache', 'migration-baseline', 'pocketbase'),
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!['--left', '--right'].includes(argument) || !args[index + 1]) {
      throw new Error(`Unknown or incomplete comparison argument: ${argument}`)
    }
    values[argument.slice(2)] = path.resolve(siteDir, args[++index])
  }
  return values
}

async function pocketBaseFile(descriptor) {
  const bytes = Buffer.from(await descriptor.attachment.read())
  const detectedFormat = detectImageFormat(bytes)
  if (!detectedFormat) throw new Error(`${descriptor.collection}:${descriptor.legacyId} has unsupported destination bytes`)
  return {
    field: descriptor.field, ordinal: descriptor.ordinal, filename: descriptor.attachment.title,
    size: bytes.length, detectedFormat,
    sha256: createHash('sha256').update(bytes).digest('hex'), read: async () => bytes,
  }
}

export async function main(args = process.argv.slice(2)) {
  const siteDir = path.resolve(import.meta.dirname, '../..')
  await loadEnvironment(siteDir)
  const directories = parseArguments(args, siteDir)
  const inventories = await Promise.all([
    'gallery-originals-inventory.json', 'uma-originals-inventory.json',
  ].map((name) => readJson(path.join(siteDir, '.cache', 'migration-baseline', name))))
  const nocoConfig = getNocoDbMigrationConfig()
  const nocoSources = await fetchNocoDbSources(nocoConfig)
  const nocoRecords = await transformNocoDbSources(nocoSources, {
    resolveAttachment: createAttachmentResolver({
      cacheDir: path.join(siteDir, '.cache', 'originals'), inventories,
      sourceUrls: { gallery: nocoConfig.gallery.url, uma: nocoConfig.uma.url },
    }),
  })
  const client = createPocketBaseClient(getPocketBaseConfig(process.env, 'sync'))
  const [gallery, uma] = await Promise.all([
    loadPocketBaseGallerySource(client), loadPocketBaseUmaSource(client),
  ])
  const pocketBaseRecords = await transformNocoDbSources({ gallery, uma }, { resolveAttachment: pocketBaseFile })
  const result = compareSnapshots(
    await loadBundle(directories.left, nocoRecords),
    await loadBundle(directories.right, pocketBaseRecords),
  )
  console.log(`Normalized fields: ${result.normalized.join('; ')}`)
  if (!result.equal) {
    for (const difference of result.differences) console.error(`- ${difference}`)
    process.exitCode = 1
  } else console.log('NocoDB and PocketBase CMS sources are semantically equivalent.')
  return result
}

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
}

if (isMainModule()) main().catch((error) => {
  console.error(`CMS source comparison failed: ${error.message}`)
  process.exitCode = 1
})

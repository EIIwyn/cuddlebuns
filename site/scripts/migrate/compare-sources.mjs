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

const MAX_DIAGNOSTICS = 40

export const NORMALIZED_FIELDS = [
  'generatedAt',
  'backendId after complete legacyId mapping',
  'generated URL and commission card attachment ID after source SHA-256 mapping',
  'blank display order null/0 equivalence',
]

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

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

function safeValue(value) {
  if (value === null) return { type: 'null' }
  if (value === undefined) return { type: 'undefined' }
  if (typeof value === 'string') return { type: 'string', length: value.length, sha256_12: digest(value) }
  if (typeof value === 'number' || typeof value === 'boolean') return { type: typeof value, value }
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (typeof value === 'object') return { type: 'object', keys: Object.keys(value).sort() }
  return { type: typeof value }
}

function pushDiagnostic(diagnostics, item) {
  diagnostics.push(item)
}

function recordMap(records) {
  return new Map(records.map((record) => [`${record.collection}:${record.legacyId}`, record]))
}

function compareRecordDetails(left, right, diagnostics) {
  const leftFields = new Set(Object.keys(left.fields ?? {}))
  const rightFields = new Set(Object.keys(right.fields ?? {}))
  for (const field of [...new Set([...leftFields, ...rightFields])].sort()) {
    if (!leftFields.has(field) || !rightFields.has(field)) {
      pushDiagnostic(diagnostics, {
        kind: 'field-name', record: `${left.collection}:${left.legacyId}`, field,
        left: leftFields.has(field), right: rightFields.has(field),
      })
    } else if (!equal(left.fields[field], right.fields[field])) {
      pushDiagnostic(diagnostics, {
        kind: 'field-value', record: `${left.collection}:${left.legacyId}`, field,
        left: safeValue(left.fields[field]), right: safeValue(right.fields[field]),
      })
    }
  }

  const leftRelations = left.relations ?? {}
  const rightRelations = right.relations ?? {}
  for (const field of [...new Set([...Object.keys(leftRelations), ...Object.keys(rightRelations)])].sort()) {
    const a = leftRelations[field]
    const b = rightRelations[field]
    if (!a || !b || a.collection !== b.collection || !equal(a.legacyIds ?? [], b.legacyIds ?? [])) {
      pushDiagnostic(diagnostics, {
        kind: 'relationship', record: `${left.collection}:${left.legacyId}`, field,
        left: a ? { collection: a.collection, legacyIds: a.legacyIds ?? [] } : null,
        right: b ? { collection: b.collection, legacyIds: b.legacyIds ?? [] } : null,
      })
    }
  }

  const leftFiles = left.files ?? []
  const rightFiles = right.files ?? []
  const fileKeys = new Set([
    ...leftFiles.map((file) => `${file.field}:${file.ordinal}`),
    ...rightFiles.map((file) => `${file.field}:${file.ordinal}`),
  ])
  for (const key of [...fileKeys].sort()) {
    const a = leftFiles.find((file) => `${file.field}:${file.ordinal}` === key)
    const b = rightFiles.find((file) => `${file.field}:${file.ordinal}` === key)
    if (!a || !b || a.sha256 !== b.sha256 || a.detectedFormat !== b.detectedFormat) {
      pushDiagnostic(diagnostics, {
        kind: 'attachment', record: `${left.collection}:${left.legacyId}`, slot: key,
        left: a ? { sha256_12: a.sha256?.slice(0, 12), format: a.detectedFormat } : null,
        right: b ? { sha256_12: b.sha256?.slice(0, 12), format: b.detectedFormat } : null,
      })
    }
  }
}

function comparePublicPaths(left, right, location, diagnostics) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      pushDiagnostic(diagnostics, { kind: 'public-path', path: location, left: safeValue(left), right: safeValue(right) })
      return
    }
    for (let index = 0; index < left.length; index += 1) comparePublicPaths(left[index], right[index], `${location}[${index}]`, diagnostics)
    return
  }
  if ((left && typeof left === 'object') || (right && typeof right === 'object')) {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
      pushDiagnostic(diagnostics, { kind: 'public-path', path: location, left: safeValue(left), right: safeValue(right) })
      return
    }
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      if (key === 'generatedAt') continue
      if (!(key in left) || !(key in right)) {
        pushDiagnostic(diagnostics, { kind: 'public-path', path: `${location}.${key}`, left: key in left, right: key in right })
      } else comparePublicPaths(left[key], right[key], `${location}.${key}`, diagnostics)
    }
    return
  }
  if (left !== right) pushDiagnostic(diagnostics, { kind: 'public-path', path: location, left: safeValue(left), right: safeValue(right) })
}

export function diagnoseSnapshots(left, right) {
  const diagnostics = []
  const leftRecords = recordMap(left.records)
  const rightRecords = recordMap(right.records)
  for (const key of [...leftRecords.keys()].filter((item) => !rightRecords.has(item)).sort()) {
    pushDiagnostic(diagnostics, { kind: 'missing-record', record: key, side: 'right' })
  }
  for (const key of [...rightRecords.keys()].filter((item) => !leftRecords.has(item)).sort()) {
    pushDiagnostic(diagnostics, { kind: 'extra-record', record: key, side: 'right' })
  }
  for (const key of [...leftRecords.keys()].filter((item) => rightRecords.has(item)).sort()) {
    compareRecordDetails(leftRecords.get(key), rightRecords.get(key), diagnostics)
  }
  const leftUnmapped = []
  const rightUnmapped = []
  const leftPublicFiles = canonicalPublic(left.publicFiles ?? {}, left.urlMap ?? {}, 'left.publicFiles', leftUnmapped)
  const rightPublicFiles = canonicalPublic(right.publicFiles ?? {}, right.urlMap ?? {}, 'right.publicFiles', rightUnmapped)
  for (const path of leftUnmapped) pushDiagnostic(diagnostics, { kind: 'unmapped-public-url', side: 'left', path })
  for (const path of rightUnmapped) pushDiagnostic(diagnostics, { kind: 'unmapped-public-url', side: 'right', path })
  const publicPaths = new Set([...Object.keys(leftPublicFiles), ...Object.keys(rightPublicFiles)])
  for (const file of [...publicPaths].sort()) {
    if (!(file in leftPublicFiles) || !(file in rightPublicFiles)) {
      pushDiagnostic(diagnostics, { kind: 'public-file', path: file, left: file in leftPublicFiles, right: file in rightPublicFiles })
    } else comparePublicPaths(leftPublicFiles[file], rightPublicFiles[file], file, diagnostics)
  }
  return {
    truncated: diagnostics.length >= MAX_DIAGNOSTICS,
    examples: diagnostics.slice(0, MAX_DIAGNOSTICS),
    counts: {
      missingRecords: diagnostics.filter(({ kind }) => kind === 'missing-record').length,
      extraRecords: diagnostics.filter(({ kind }) => kind === 'extra-record').length,
      fieldNameDifferences: diagnostics.filter(({ kind }) => kind === 'field-name').length,
      fieldValueDifferences: diagnostics.filter(({ kind }) => kind === 'field-value').length,
      relationshipDifferences: diagnostics.filter(({ kind }) => kind === 'relationship').length,
      attachmentDifferences: diagnostics.filter(({ kind }) => kind === 'attachment').length,
      publicDifferences: diagnostics.filter(({ kind }) => kind === 'public-path' || kind === 'public-file' || kind === 'unmapped-public-url').length,
    },
  }
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
  const diagnostic = diagnoseSnapshots(left, right)
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

  return { equal: differences.length === 0, differences, diagnostic, normalized: [...NORMALIZED_FIELDS] }
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
    console.error(`Diagnostic counts: ${JSON.stringify(result.diagnostic.counts)}`)
    for (const example of result.diagnostic.examples) console.error(`  ${JSON.stringify(example)}`)
    if (result.diagnostic.truncated) console.error(`  Diagnostic examples truncated at ${MAX_DIAGNOSTICS}`)
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

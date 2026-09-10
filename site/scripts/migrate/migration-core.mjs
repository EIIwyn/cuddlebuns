import { createHash } from 'node:crypto'

export const COLLECTION_ORDER = [
  'artists',
  'collections',
  'characters',
  'versions',
  'commissions',
  'uma_scenarios',
  'uma_pvp_events',
  'uma_support_cards',
]

export const FILE_LIMITS = {
  'artists.example': { maxSelect: 2, maxSize: 16 * 1024 * 1024 },
  'characters.card_thumbnail': { maxSelect: 1, maxSize: 2 * 1024 * 1024 },
  'versions.reference_sheet': { maxSelect: 6, maxSize: 24 * 1024 * 1024 },
  'commissions.image': { maxSelect: 5, maxSize: 18 * 1024 * 1024 },
  'uma_support_cards.image': { maxSelect: 1, maxSize: 2 * 1024 * 1024 },
}

const FILE_FIELDS = Object.fromEntries(COLLECTION_ORDER.map((collection) => [
  collection,
  Object.keys(FILE_LIMITS)
    .filter((key) => key.startsWith(`${collection}.`))
    .map((key) => key.slice(collection.length + 1)),
]))
const MULTI_RELATIONS = new Set(['commissions.versions', 'commissions.artists', 'uma_support_cards.pvp_events'])
const MIME_TYPES = { avif: 'image/avif', gif: 'image/gif', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function recordKey(collection, legacyId) {
  return `${collection}:${legacyId}`
}

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

function filenames(record, field) {
  const value = record?.[field]
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function detectImageFormat(bytes) {
  const buffer = Buffer.from(bytes)
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'gif'
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii')
    if (['avif', 'avis'].includes(brand)) return 'avif'
  }
  return null
}

export function validateMigrationRecords(records) {
  const identities = new Map()
  const slugs = new Map()

  for (const record of records) {
    if (!COLLECTION_ORDER.includes(record.collection)) throw new Error(`Unknown collection: ${record.collection}`)
    if (!Number.isInteger(record.legacyId) || record.legacyId < 1) {
      throw new Error(`${record.collection} requires a positive legacy_id; received ${record.legacyId}`)
    }
    const key = recordKey(record.collection, record.legacyId)
    if (identities.has(key)) throw new Error(`Duplicate legacy_id ${record.legacyId} in ${record.collection}`)
    identities.set(key, record)

    const slug = typeof record.fields?.slug === 'string' ? record.fields.slug.trim() : ''
    if (slug) {
      const slugKey = `${record.collection}:${slug}`
      if (slugs.has(slugKey)) throw new Error(`Duplicate slug "${slug}" in ${record.collection}`)
      slugs.set(slugKey, record)
    }

    const filesByField = Map.groupBy(record.files ?? [], ({ field }) => field)
    for (const [field, files] of filesByField) {
      const limit = FILE_LIMITS[`${record.collection}.${field}`]
      if (!limit) throw new Error(`Unexpected file field ${record.collection}.${field}`)
      if (files.length > limit.maxSelect) {
        throw new Error(`${record.collection}.${field} has ${files.length} files and exceeds maxSelect ${limit.maxSelect}`)
      }
      const ordinals = files.map(({ ordinal }) => ordinal)
      if (new Set(ordinals).size !== ordinals.length || ordinals.some((value) => !Number.isInteger(value) || value < 0)) {
        throw new Error(`${record.collection}.${field} has invalid attachment ordinals`)
      }
      for (const file of files) {
        if (Number.isFinite(file.size) && file.size > limit.maxSize) {
          throw new Error(`${record.collection}.${field} file ${file.filename} exceeds ${limit.maxSize} bytes`)
        }
      }
    }
  }

  for (const record of records) {
    for (const [field, relation] of Object.entries(record.relations ?? {})) {
      for (const legacyId of relation.legacyIds ?? []) {
        if (!identities.has(recordKey(relation.collection, legacyId))) {
          throw new Error(`Dangling relation ${record.collection}.${field} -> ${relation.collection}:${legacyId}`)
        }
      }
    }
  }
  return records
}

async function prepareFile(record, file) {
  const bytes = Buffer.from(await file.read())
  const actualHash = hash(bytes)
  const format = detectImageFormat(bytes)
  const limit = FILE_LIMITS[`${record.collection}.${file.field}`]
  if (!format) throw new Error(`${record.collection}.${file.field} file ${file.filename} has unsupported image bytes`)
  if (file.sha256 && file.sha256 !== actualHash) {
    throw new Error(`${record.collection}.${file.field} file ${file.filename} hash mismatch`)
  }
  if (Number.isFinite(file.size) && file.size !== bytes.length) {
    throw new Error(`${record.collection}.${file.field} file ${file.filename} size mismatch`)
  }
  if (bytes.length > limit.maxSize) {
    throw new Error(`${record.collection}.${file.field} file ${file.filename} exceeds ${limit.maxSize} bytes`)
  }
  return { ...file, bytes, detectedFormat: format, sha256: actualHash, size: bytes.length }
}

export async function buildRecordBody(fields, files = []) {
  if (!files.length) return fields
  const body = new FormData()
  body.append('@jsonPayload', JSON.stringify(fields))
  for (const file of [...files].sort((left, right) => left.ordinal - right.ordinal)) {
    const bytes = file.bytes ? Buffer.from(file.bytes) : Buffer.from(await file.read())
    const format = file.detectedFormat ?? detectImageFormat(bytes)
    body.append(file.field, new Blob([bytes], { type: MIME_TYPES[format] }), file.filename)
  }
  return body
}

async function destinationHashes(client, collection, record, field) {
  const values = filenames(record, field)
  const hashes = []
  for (const filename of values) {
    const bytes = await client.downloadFile(collection, record, filename)
    hashes.push(hash(Buffer.from(bytes)))
  }
  return hashes
}

function relationValue(record, field, relation, mapping) {
  const ids = (relation.legacyIds ?? []).map((legacyId) => {
    const id = mapping.get(recordKey(relation.collection, legacyId))
    if (!id) throw new Error(`Unmapped relation ${record.collection}.${field} -> ${relation.collection}:${legacyId}`)
    return id
  })
  const multiple = relation.many ?? MULTI_RELATIONS.has(`${record.collection}.${field}`)
  return multiple ? ids : ids[0] ?? ''
}

function relationMatches(actual, expected) {
  if (Array.isArray(expected)) return equal(Array.isArray(actual) ? actual : actual ? [actual] : [], expected)
  return String(actual ?? '') === String(expected ?? '')
}

function manifest(counts, statuses, dryRun) {
  return {
    version: 1,
    source: 'nocodb',
    dryRun,
    counts: { ...counts },
    records: Object.fromEntries(statuses),
  }
}

export async function runMigration(records, options) {
  validateMigrationRecords(records)
  const { client, dryRun = false, writeManifest = async () => {} } = options
  const ordered = COLLECTION_ORDER.flatMap((collection) => records
    .filter((record) => record.collection === collection)
    .sort((left, right) => left.legacyId - right.legacyId))
  const counts = { source: ordered.length, created: 0, updated: 0, unchanged: 0, failed: 0 }
  const statuses = new Map()
  const destination = new Map()
  const mapping = new Map()
  const preparedFiles = new Map()

  for (const collection of COLLECTION_ORDER) {
    const seen = new Set()
    for (const record of await client.listAll(collection)) {
      const legacyId = Number(record.legacy_id)
      if (!Number.isInteger(legacyId) || legacyId < 1) throw new Error(`Invalid destination legacy_id in ${collection}`)
      if (seen.has(legacyId)) throw new Error(`Duplicate destination legacy_id ${legacyId} in ${collection}`)
      seen.add(legacyId)
      destination.set(recordKey(collection, legacyId), record)
      mapping.set(recordKey(collection, legacyId), record.id)
    }
  }

  try {
    for (const source of ordered) {
      const key = recordKey(source.collection, source.legacyId)
      const existing = destination.get(key)
      const expectedFields = { legacy_id: source.legacyId, ...source.fields }
      const scalarChanged = existing && Object.entries(expectedFields)
        .some(([field, value]) => !equal(existing[field], value))
      const expectedByField = Map.groupBy(source.files ?? [], ({ field }) => field)
      const changedFileFields = []
      const allPrepared = []

      for (const field of FILE_FIELDS[source.collection]) {
        const expectedFiles = [...(expectedByField.get(field) ?? [])].sort((left, right) => left.ordinal - right.ordinal)
        const ready = []
        for (const file of expectedFiles) ready.push(await prepareFile(source, file))
        preparedFiles.set(`${key}.${field}`, ready)
        allPrepared.push(...ready)
        const actualHashes = existing ? await destinationHashes(client, source.collection, existing, field) : []
        if (!equal(actualHashes, ready.map(({ sha256: value }) => value))) changedFileFields.push(field)
      }

      if (!existing) {
        statuses.set(key, 'created')
        counts.created += 1
        if (dryRun) {
          mapping.set(key, `dry-${source.collection}-${source.legacyId}`)
          continue
        }
        const created = await client.createRecord(source.collection,
          await buildRecordBody(expectedFields, allPrepared))
        destination.set(key, created)
        mapping.set(key, created.id)
      } else if (scalarChanged || changedFileFields.length) {
        statuses.set(key, 'updated')
        counts.updated += 1
        if (dryRun) continue
        const payload = scalarChanged ? expectedFields : {}
        for (const field of changedFileFields) payload[field] = []
        const files = changedFileFields.flatMap((field) => preparedFiles.get(`${key}.${field}`))
        const updated = await client.updateRecord(source.collection, existing.id,
          await buildRecordBody(payload, files))
        destination.set(key, updated)
      } else {
        statuses.set(key, 'unchanged')
        counts.unchanged += 1
      }
      await writeManifest(manifest(counts, statuses, dryRun))
    }

    for (const source of ordered) {
      const relationEntries = Object.entries(source.relations ?? {})
      if (!relationEntries.length) continue
      const key = recordKey(source.collection, source.legacyId)
      const existing = destination.get(key)
      const payload = Object.fromEntries(relationEntries.map(([field, relation]) => [
        field,
        relationValue(source, field, relation, mapping),
      ]))
      const changed = Object.entries(payload).some(([field, value]) => !relationMatches(existing?.[field], value))
      if (!changed) continue
      if (statuses.get(key) === 'unchanged') {
        statuses.set(key, 'updated')
        counts.unchanged -= 1
        counts.updated += 1
      }
      if (!dryRun) {
        const updated = await client.updateRecord(source.collection, existing.id, payload)
        destination.set(key, updated)
      }
      await writeManifest(manifest(counts, statuses, dryRun))
    }
  } catch (error) {
    counts.failed += 1
    await writeManifest(manifest(counts, statuses, dryRun))
    throw error
  }

  const result = manifest(counts, statuses, dryRun)
  await writeManifest(result)
  return result
}

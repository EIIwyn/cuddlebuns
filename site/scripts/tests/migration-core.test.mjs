import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  buildRecordBody,
  detectImageFormat,
  runMigration,
  validateMigrationRecords,
} from '../migrate/migration-core.mjs'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sourceFile(field, filename, bytes, options = {}) {
  return {
    field,
    ordinal: options.ordinal ?? 0,
    filename,
    size: options.size ?? bytes.length,
    detectedFormat: options.detectedFormat ?? detectImageFormat(bytes),
    sha256: options.sha256 ?? sha256(bytes),
    read: async () => Buffer.from(bytes),
  }
}

function baseRecords() {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex')
  return [
    { collection: 'artists', legacyId: 1, fields: { name: 'One', url: '' }, relations: {}, files: [] },
    { collection: 'artists', legacyId: 2, fields: { name: 'Two', url: '' }, relations: {}, files: [] },
    { collection: 'collections', legacyId: 1, fields: { name: 'Project', slug: 'project' }, relations: {}, files: [] },
    {
      collection: 'characters', legacyId: 1,
      fields: { name: 'Character', slug: 'character' },
      relations: { collection: { collection: 'collections', legacyIds: [1] } },
      files: [sourceFile('card_thumbnail', 'card.png', png)],
    },
    {
      collection: 'versions', legacyId: 1,
      fields: { name: 'Version', slug: 'version' },
      relations: { character: { collection: 'characters', legacyIds: [1] } }, files: [],
    },
    {
      collection: 'commissions', legacyId: 1,
      fields: { name: 'Internal', type: 'Portrait' },
      relations: {
        versions: { collection: 'versions', legacyIds: [1] },
        artists: { collection: 'artists', legacyIds: [2, 1] },
      },
      files: [
        sourceFile('image', 'first.png', png, { ordinal: 0 }),
        sourceFile('image', 'second.png', png, { ordinal: 1 }),
      ],
    },
    { collection: 'uma_scenarios', legacyId: 1, fields: { name: 'Scenario', slug: 'scenario' }, relations: {}, files: [] },
    {
      collection: 'uma_pvp_events', legacyId: 1, fields: { name: 'Event', slug: 'event' },
      relations: { scenario: { collection: 'uma_scenarios', legacyIds: [1] } }, files: [],
    },
    {
      collection: 'uma_support_cards', legacyId: 1,
      fields: { name: 'Support', slug: 'support', styles: ['Front'], breakpoints: ['LB0', 'LB4'] },
      relations: { pvp_events: { collection: 'uma_pvp_events', legacyIds: [1] } }, files: [],
    },
  ]
}

async function decodeBody(body) {
  if (!(body instanceof FormData)) return { fields: structuredClone(body), files: {} }
  const fields = JSON.parse(body.get('@jsonPayload'))
  const files = {}
  for (const [name, value] of body.entries()) {
    if (name === '@jsonPayload') continue
    files[name] ??= []
    files[name].push({ filename: value.name, bytes: Buffer.from(await value.arrayBuffer()) })
  }
  return { fields, files }
}

class FakeClient {
  constructor() {
    this.collections = new Map()
    this.writes = []
    this.failAfter = Infinity
  }

  async listAll(collection) {
    return [...(this.collections.get(collection) ?? [])]
  }

  async createRecord(collection, body) {
    this.#maybeFail()
    const decoded = await decodeBody(body)
    const record = {
      id: `${collection}-${decoded.fields.legacy_id}`,
      collectionName: collection,
      ...decoded.fields,
      _files: {},
    }
    this.#applyFiles(record, decoded)
    this.#records(collection).push(record)
    this.writes.push({ collection, kind: 'create', record })
    return record
  }

  async updateRecord(collection, id, body) {
    this.#maybeFail()
    const decoded = await decodeBody(body)
    const record = this.#records(collection).find((item) => item.id === id)
    Object.assign(record, decoded.fields)
    this.#applyFiles(record, decoded)
    this.writes.push({ collection, kind: 'update', record })
    return record
  }

  async downloadFile(collection, record, filename) {
    return record._files[filename]
  }

  #applyFiles(record, decoded) {
    for (const [field, values] of Object.entries(decoded.files)) {
      for (const oldName of Array.isArray(decoded.fields[field]) ? decoded.fields[field] : []) {
        delete record._files[oldName]
      }
      record[field] = values.map(({ filename }, index) => `${filename.replace(/\.[^.]+$/, '')}_${index}.png`)
      for (const [index, file] of values.entries()) record._files[record[field][index]] = file.bytes
      if (values.length === 1 && ['card_thumbnail', 'image'].includes(field) && record.collectionName !== 'commissions') {
        record[field] = record[field][0]
      }
    }
    for (const [field, value] of Object.entries(decoded.fields)) {
      if (Array.isArray(value) && value.length === 0 && !decoded.files[field]) {
        for (const filename of Array.isArray(record[field]) ? record[field] : [record[field]].filter(Boolean)) {
          delete record._files[filename]
        }
        record[field] = []
      }
    }
  }

  #maybeFail() {
    if (this.writes.length >= this.failAfter) throw new Error('simulated interruption')
  }

  #records(collection) {
    if (!this.collections.has(collection)) this.collections.set(collection, [])
    return this.collections.get(collection)
  }
}

test('image detection trusts bytes rather than lying metadata', () => {
  assert.equal(detectImageFormat(Buffer.from('474946383961', 'hex')), 'gif')
  assert.equal(detectImageFormat(Buffer.from('89504e470d0a1a0a', 'hex')), 'png')
  assert.equal(detectImageFormat(Buffer.from('ffd8ffe0', 'hex')), 'jpg')
  assert.equal(detectImageFormat(Buffer.from('524946460000000057454250', 'hex')), 'webp')
  assert.equal(detectImageFormat(Buffer.from('000000186674797061766966', 'hex')), 'avif')
  assert.equal(detectImageFormat(Buffer.from('not-an-image')), null)
})

test('multipart writes serialize ordinary fields once and retain file order', async () => {
  const bytes = Buffer.from('474946383961', 'hex')
  const files = [
    sourceFile('image', 'first.gif', bytes, { ordinal: 0 }),
    sourceFile('image', 'second.gif', bytes, { ordinal: 1 }),
  ]
  const body = await buildRecordBody({ legacy_id: 1, styles: ['Front'], image: [] }, files)
  assert.equal(body.getAll('@jsonPayload').length, 1)
  assert.deepEqual(JSON.parse(body.get('@jsonPayload')), { legacy_id: 1, styles: ['Front'], image: [] })
  assert.deepEqual(body.getAll('image').map(({ name }) => name), ['first.gif', 'second.gif'])
})

test('migration creates in dependency order, maps relations on pass two, and is idempotent', async () => {
  const client = new FakeClient()
  const manifests = []
  const first = await runMigration(baseRecords(), { client, writeManifest: async (value) => manifests.push(value) })
  assert.deepEqual(first.counts, { source: 9, created: 9, updated: 0, unchanged: 0, failed: 0 })
  assert.deepEqual(client.writes.filter(({ kind }) => kind === 'create').map(({ collection }) => collection),
    ['artists', 'artists', 'collections', 'characters', 'versions', 'commissions',
      'uma_scenarios', 'uma_pvp_events', 'uma_support_cards'])
  const commission = client.collections.get('commissions')[0]
  assert.deepEqual(commission.artists, ['artists-2', 'artists-1'])
  assert.deepEqual(commission.versions, ['versions-1'])
  assert.equal(commission.image.length, 2)

  client.writes.length = 0
  const second = await runMigration(baseRecords(), { client, writeManifest: async (value) => manifests.push(value) })
  assert.deepEqual(second.counts, { source: 9, created: 0, updated: 0, unchanged: 9, failed: 0 })
  assert.equal(client.writes.length, 0)
  assert.equal(manifests.at(-1).counts.unchanged, 9)
})

test('dry-run performs no writes and interrupted runs resume from destination state', async () => {
  const dryClient = new FakeClient()
  const dry = await runMigration(baseRecords(), { client: dryClient, dryRun: true })
  assert.equal(dryClient.writes.length, 0)
  assert.deepEqual(dry.counts, { source: 9, created: 9, updated: 0, unchanged: 0, failed: 0 })

  const client = new FakeClient()
  client.failAfter = 2
  await assert.rejects(() => runMigration(baseRecords(), { client }), /simulated interruption/)
  assert.equal(client.writes.length, 2)
  client.failAfter = Infinity
  const resumed = await runMigration(baseRecords(), { client, previousManifest: { misleading: true } })
  assert.equal(resumed.counts.created, 7)
  assert.equal(resumed.counts.unchanged, 2)
  assert.equal(client.collections.get('uma_support_cards').length, 1)
})

test('migration updates changed scalars, relations, and files by replacement and removal', async () => {
  const client = new FakeClient()
  const records = baseRecords()
  await runMigration(records, { client })
  client.writes.length = 0

  records.find(({ collection }) => collection === 'artists').fields.name = 'Changed'
  const commission = records.find(({ collection }) => collection === 'commissions')
  commission.relations.artists.legacyIds = [1]
  commission.files = [sourceFile('image', 'replacement.gif', Buffer.from('474946383961', 'hex'))]
  records.find(({ collection }) => collection === 'characters').files = []

  const result = await runMigration(records, { client })
  assert.ok(result.counts.updated >= 3)
  assert.deepEqual(client.collections.get('commissions')[0].artists, ['artists-1'])
  assert.equal(client.collections.get('commissions')[0].image.length, 1)
  assert.match(client.collections.get('commissions')[0].image[0], /^replacement/)
  assert.deepEqual(client.collections.get('characters')[0].card_thumbnail, [])
})

test('validation rejects duplicate or zero identity, duplicate slugs, and dangling relations', () => {
  const cases = [
    [
      [...baseRecords(), { ...baseRecords()[0] }],
      /duplicate legacy_id/i,
    ],
    [
      baseRecords().map((record, index) => index === 0 ? { ...record, legacyId: 0 } : record),
      /positive legacy_id/i,
    ],
    [
      [...baseRecords(), { collection: 'characters', legacyId: 2, fields: { slug: 'character' }, relations: {}, files: [] }],
      /duplicate slug/i,
    ],
    [
      baseRecords().map((record) => record.collection === 'versions'
        ? { ...record, relations: { character: { collection: 'characters', legacyIds: [404] } } }
        : record),
      /dangling relation/i,
    ],
  ]
  for (const [records, pattern] of cases) assert.throws(() => validateMigrationRecords(records), pattern)
})

test('migration rejects oversized, undecodable, and hash-mismatched files', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex')
  const variants = [
    [sourceFile('card_thumbnail', 'large.png', png, { size: 2 * 1024 * 1024 + 1 }), /exceeds/i],
    [sourceFile('card_thumbnail', 'bad.bin', Buffer.from('bad')), /unsupported image/i],
    [sourceFile('card_thumbnail', 'wrong.png', png, { sha256: '0'.repeat(64) }), /hash mismatch/i],
  ]
  for (const [file, pattern] of variants) {
    const records = baseRecords()
    records.find(({ collection }) => collection === 'characters').files = [file]
    await assert.rejects(() => runMigration(records, { client: new FakeClient() }), pattern)
  }
})

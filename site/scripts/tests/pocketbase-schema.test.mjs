import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const migrationsDirectory = new URL('../../../vps-scripts/pocketbase/pb_migrations/', import.meta.url)
const readRule = '@request.auth.collectionName = "cms_sync"'
const imageMimeTypes = ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']

const expectedFields = {
  artists: {
    legacy_id: 'number', name: 'text', url: 'url', commission_subject: 'json', date_added: 'date',
    notes: 'text', price_jpy: 'number', price_usd: 'number', price_bracket: 'text', status: 'text',
    example: 'file',
  },
  collections: {
    legacy_id: 'number', name: 'text', slug: 'text', display_order: 'number', visible: 'bool',
    collapsible: 'bool',
  },
  characters: {
    legacy_id: 'number', name: 'text', slug: 'text', subtitle: 'text', accent_color: 'text',
    card_thumbnail: 'file', display_order: 'number', visible: 'bool', collection: 'relation',
    social_label: 'text', social_url: 'url',
  },
  versions: {
    legacy_id: 'number', name: 'text', slug: 'text', reference_sheet: 'file',
    display_order: 'number', visible: 'bool', character: 'relation',
  },
  commissions: {
    legacy_id: 'number', name: 'text', type: 'text', image: 'file', source_url: 'url', date: 'date',
    published: 'bool', display_order: 'number', versions: 'relation', artists: 'relation',
  },
  uma_scenarios: {
    legacy_id: 'number', name: 'text', short_name: 'text', slug: 'text', era_start: 'date',
    era_end: 'date', display_color: 'text',
  },
  uma_pvp_events: {
    legacy_id: 'number', name: 'text', event_number: 'number', slug: 'text', event_type: 'text',
    start_date: 'date', end_date: 'date', scenario: 'relation', distance_class: 'text',
    distance_m: 'number', racecourse: 'text', direction: 'text', track_condition: 'text',
    season: 'text', weather: 'text', surface: 'text', status: 'text',
  },
  uma_support_cards: {
    legacy_id: 'number', name: 'text', character_name: 'text', slug: 'text', image: 'file',
    card_type: 'text', rating: 'text', release_date: 'date', styles: 'json', breakpoints: 'json',
    pvp_events: 'relation',
  },
}

const expectedRelations = {
  'characters.collection': ['collections', 1],
  'versions.character': ['characters', 1],
  'commissions.versions': ['versions', 999],
  'commissions.artists': ['artists', 999],
  'uma_pvp_events.scenario': ['uma_scenarios', 1],
  'uma_support_cards.pvp_events': ['uma_pvp_events', 999],
}

const expectedFiles = {
  'artists.example': [2, 16 * 1024 * 1024],
  'characters.card_thumbnail': [1, 2 * 1024 * 1024],
  'versions.reference_sheet': [6, 24 * 1024 * 1024],
  'commissions.image': [5, 18 * 1024 * 1024],
  'uma_support_cards.image': [1, 2 * 1024 * 1024],
}

class Collection {
  constructor(options) {
    Object.assign(this, options)
  }
}

async function loadMigrations() {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.js'))
    .sort()
  assert.ok(filenames.length > 0, 'at least one PocketBase migration is required')

  const migrations = []
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsDirectory), 'utf8')
    let calls = 0
    vm.runInNewContext(source, {
      Collection,
      migrate(up, down) {
        calls += 1
        migrations.push({ down, filename, up })
      },
    }, { filename })
    assert.equal(calls, 1, `${filename} must contain exactly one migrate() call`)
  }
  return migrations
}

function createFixtureApp() {
  const collections = new Map()
  return {
    collections,
    delete(collection) {
      collections.delete(collection.name)
    },
    findCollectionByNameOrId(nameOrId) {
      const collection = collections.get(nameOrId)
        ?? [...collections.values()].find(({ id }) => id === nameOrId)
      if (!collection) throw new Error(`Collection not found: ${nameOrId}`)
      return collection
    },
    save(collection) {
      collection.id ||= `fixture_${collection.name}`
      collections.set(collection.name, collection)
    },
  }
}

function fieldsByName(collection) {
  return Object.fromEntries(collection.fields.map((field) => [field.name, field]))
}

async function applySchema() {
  const migrations = await loadMigrations()
  const app = createFixtureApp()
  for (const migration of migrations) migration.up(app)
  return { app, migrations }
}

function insertWithFixtureConstraints(collection, records, record) {
  const legacyId = fieldsByName(collection).legacy_id
  if (legacyId.required && record.legacy_id == null) throw new Error('legacy_id is required')
  if (legacyId.onlyInt && !Number.isInteger(record.legacy_id)) throw new Error('legacy_id must be an integer')
  if (record.legacy_id < legacyId.min) throw new Error('legacy_id must be positive')
  if (records.some(({ legacy_id: value }) => value === record.legacy_id)) {
    throw new Error('legacy_id must be unique')
  }
  records.push(record)
}

test('PocketBase migrations create the complete least-privilege CMS schema', async () => {
  const { app } = await applySchema()
  assert.deepEqual([...app.collections.keys()], ['cms_sync', ...Object.keys(expectedFields)])

  const sync = app.collections.get('cms_sync')
  assert.equal(sync.type, 'auth')
  assert.deepEqual({
    authRule: sync.authRule,
    createRule: sync.createRule,
    deleteRule: sync.deleteRule,
    listRule: sync.listRule,
    manageRule: sync.manageRule,
    updateRule: sync.updateRule,
    viewRule: sync.viewRule,
  }, {
    authRule: '', createRule: null, deleteRule: null, listRule: null, manageRule: null,
    updateRule: null, viewRule: null,
  })
  assert.equal(sync.passwordAuth.enabled, true)
  assert.deepEqual(Array.from(sync.passwordAuth.identityFields), ['email'])
  assert.equal(sync.oauth2.enabled, false)
  assert.equal(sync.otp.enabled, false)
  assert.equal(sync.mfa.enabled, false)

  for (const [name, fieldTypes] of Object.entries(expectedFields)) {
    const collection = app.collections.get(name)
    const fields = fieldsByName(collection)
    assert.equal(collection.type, 'base', `${name} must be a base collection`)
    assert.equal(collection.listRule, readRule, `${name} list rule`)
    assert.equal(collection.viewRule, readRule, `${name} view rule`)
    assert.equal(collection.createRule, null, `${name} create rule`)
    assert.equal(collection.updateRule, null, `${name} update rule`)
    assert.equal(collection.deleteRule, null, `${name} delete rule`)
    assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([fieldName, field]) => [fieldName, field.type])),
      fieldTypes, `${name} field types`)
    assert.equal(fields.legacy_id.required, true, `${name}.legacy_id required`)
    assert.equal(fields.legacy_id.onlyInt, true, `${name}.legacy_id integer`)
    assert.equal(fields.legacy_id.min, 1, `${name}.legacy_id positive`)
    assert.ok(collection.indexes.some((index) => new RegExp(
      `CREATE UNIQUE INDEX \\S+ ON ${name} \\(legacy_id\\)`, 'i').test(index)),
    `${name}.legacy_id unique index`)
    assert.equal(collection.fields.filter(({ required }) => required).length, 1,
      `${name} must require only legacy_id for drafts`)
    assert.equal(collection.fields.some(({ name: fieldName }) => ['id', 'created', 'updated'].includes(fieldName)),
      false, `${name} must leave system fields to PocketBase`)
  }
})

test('PocketBase migrations target the intended collections and preserve multi-value relations', async () => {
  const { app } = await applySchema()
  for (const [key, [targetName, maxSelect]] of Object.entries(expectedRelations)) {
    const [collectionName, fieldName] = key.split('.')
    const field = fieldsByName(app.collections.get(collectionName))[fieldName]
    assert.equal(field.collectionId, app.collections.get(targetName).id, `${key} target`)
    assert.equal(field.maxSelect, maxSelect, `${key} maxSelect`)
    assert.equal(field.cascadeDelete, false, `${key} must not cascade content deletion`)
  }
})

test('PocketBase file fields use the approved protected image limits', async () => {
  const { app } = await applySchema()
  for (const [key, [maxSelect, maxSize]] of Object.entries(expectedFiles)) {
    const [collectionName, fieldName] = key.split('.')
    const field = fieldsByName(app.collections.get(collectionName))[fieldName]
    assert.equal(field.protected, true, `${key} protected`)
    assert.equal(field.maxSelect, maxSelect, `${key} maxSelect`)
    assert.equal(field.maxSize, maxSize, `${key} maxSize`)
    assert.deepEqual(Array.from(field.mimeTypes), imageMimeTypes, `${key} MIME types`)
  }
})

test('legacy_id constraints reject missing, zero, fractional, and duplicate values', async () => {
  const { app } = await applySchema()
  for (const name of Object.keys(expectedFields)) {
    const collection = app.collections.get(name)
    const records = []
    assert.throws(() => insertWithFixtureConstraints(collection, records, {}), /required/, name)
    assert.throws(() => insertWithFixtureConstraints(collection, records, { legacy_id: 0 }), /positive/, name)
    assert.throws(() => insertWithFixtureConstraints(collection, records, { legacy_id: 1.5 }), /integer/, name)
    insertWithFixtureConstraints(collection, records, { legacy_id: 1 })
    assert.throws(() => insertWithFixtureConstraints(collection, records, { legacy_id: 1 }), /unique/, name)
  }
})

test('PocketBase schema migration has a complete reverse operation', async () => {
  const { app, migrations } = await applySchema()
  for (const migration of [...migrations].reverse()) migration.down(app)
  assert.equal(app.collections.size, 0)
})

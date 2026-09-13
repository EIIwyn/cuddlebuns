import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseMigrationArguments } from '../migrate/migrate-cms.mjs'
import { assertUmaImporterColumns, fetchNocoDbSources, getNocoDbMigrationConfig } from '../migrate/nocodb-source.mjs'

const umaEnv = {
  UMA_NOCODB_URL: 'https://noco.invalid/',
  UMA_NOCODB_TOKEN: 'uma-token',
  UMA_NOCODB_BASE_ID: 'uma-base',
  UMA_NOCODB_SCENARIOS_TABLE_ID: 'tbl-scenarios',
  UMA_NOCODB_PVP_EVENTS_TABLE_ID: 'tbl-events',
  UMA_NOCODB_SUPPORT_CARDS_TABLE_ID: 'tbl-cards',
}

test('--uma selects the three Uma collections and --preserve names fields to keep', () => {
  assert.deepEqual(parseMigrationArguments(['--dry-run']), { dryRun: true, scopes: ['gallery', 'uma'], preserveFields: {} })
  assert.deepEqual(parseMigrationArguments(['--uma', '--preserve=uma_support_cards.release_date']), {
    dryRun: false,
    scopes: ['uma'],
    preserveFields: { uma_support_cards: ['release_date'] },
  })
  assert.throws(() => parseMigrationArguments(['--preserve=release_date']), /collection\.field/)
  assert.throws(() => parseMigrationArguments(['--preserve=nope.release_date']), /unknown collection/i)
  assert.throws(() => parseMigrationArguments(['--gallery']), /unknown migration argument/i)
})

test('a Uma-scoped config needs only the UMA_NOCODB_* variables', () => {
  assert.throws(() => getNocoDbMigrationConfig(umaEnv), /NOCODB_URL/)
  const config = getNocoDbMigrationConfig(umaEnv, { scopes: ['uma'] })
  assert.deepEqual(Object.keys(config), ['uma'])
  assert.equal(config.uma.url, 'https://noco.invalid')
  assert.deepEqual(config.uma.tables, { scenarios: 'tbl-scenarios', events: 'tbl-events', supportCards: 'tbl-cards' })
})

test('a Uma-scoped fetch reads only the Uma tables', async () => {
  const requested = []
  const fetchImpl = async (url) => {
    requested.push(String(url))
    return { ok: true, json: async () => ({ records: [{ id: 1, fields: { name: 'x', gametora_id: null } }], next: null }) }
  }
  const config = getNocoDbMigrationConfig(umaEnv, { scopes: ['uma'] })
  const sources = await fetchNocoDbSources(config, { fetch: fetchImpl, scopes: ['uma'] })
  assert.deepEqual(Object.keys(sources), ['uma'])
  assert.deepEqual(Object.keys(sources.uma), ['scenarios', 'events', 'supportCards'])
  assert.equal(requested.length, 3)
  assert.ok(requested.every((url) => url.includes('/uma-base/tbl-')))
})

test('the Uma mirror refuses source tables that lack the importer columns', () => {
  const seeded = {
    scenarios: [{ id: 1, fields: { name: 'S', gametora_id: 5 } }],
    events: [],
    supportCards: [{ id: 1, fields: { name: 'C', gametora_id: null } }],
  }
  assert.doesNotThrow(() => assertUmaImporterColumns(seeded))
  const old = { ...seeded, supportCards: [{ id: 1, fields: { name: 'C' } }] }
  assert.throws(() => assertUmaImporterColumns(old), /UMA_NOCODB_SUPPORT_CARDS_TABLE_ID.*gametora_id/)
})

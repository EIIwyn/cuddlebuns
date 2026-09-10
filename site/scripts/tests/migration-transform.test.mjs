import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { transformNocoDbSources } from '../migrate/nocodb-transform.mjs'

const fixtureUrl = new URL('./fixtures/nocodb-source.json', import.meta.url)

test('NocoDB transform maps every collection, relations, private fields, and JSON arrays', async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'))
  const attachmentCalls = []
  const resolveAttachment = async (descriptor) => {
    attachmentCalls.push(descriptor)
    const bytes = descriptor.attachment.title.endsWith('.gif')
      ? Buffer.from('474946383961', 'hex')
      : Buffer.from('89504e470d0a1a0a', 'hex')
    return {
      ...descriptor,
      filename: descriptor.attachment.title,
      size: bytes.length,
      detectedFormat: descriptor.attachment.title.endsWith('.gif') ? 'gif' : 'png',
      sha256: 'a'.repeat(64),
      read: async () => bytes,
    }
  }
  const records = await transformNocoDbSources({
    gallery: {
      artists: fixture.artists,
      collections: fixture.collections,
      characters: fixture.characters,
      versions: fixture.versions,
      commissions: fixture.commissions,
    },
    uma: {
      scenarios: fixture.uma_scenarios,
      events: fixture.uma_pvp_events,
      supportCards: fixture.uma_support_cards,
    },
  }, { resolveAttachment })

  assert.deepEqual(records.map(({ collection, legacyId }) => `${collection}:${legacyId}`), [
    'artists:1', 'artists:2', 'collections:1', 'collections:2', 'characters:1', 'characters:2',
    'versions:2', 'versions:10', 'commissions:2', 'commissions:10', 'uma_scenarios:1',
    'uma_scenarios:2', 'uma_pvp_events:2', 'uma_pvp_events:10', 'uma_support_cards:2',
    'uma_support_cards:10',
  ])
  const character = records.find(({ collection, legacyId }) => collection === 'characters' && legacyId === 1)
  assert.equal(character.fields.accent_color, '#abcdef')
  assert.deepEqual(character.relations.collection.legacyIds, [1])
  const commission = records.find(({ collection, legacyId }) => collection === 'commissions' && legacyId === 10)
  assert.equal(commission.fields.name, 'must remain private')
  assert.deepEqual(commission.relations.artists.legacyIds, [2, 1])
  assert.deepEqual(commission.relations.versions.legacyIds, [2])
  const support = records.find(({ collection, legacyId }) => collection === 'uma_support_cards' && legacyId === 2)
  assert.equal(support.fields.release_date, '2026-01-04 00:00:00.000Z')
  assert.deepEqual(support.fields.styles, ['Front', 'Late'])
  assert.deepEqual(support.fields.breakpoints, ['LB0', 'LB4'])
  assert.deepEqual(support.relations.pvp_events.legacyIds, [2, 10])
  assert.equal(attachmentCalls.find(({ field }) => field === 'reference_sheet').ordinal, 0)
  assert.equal(attachmentCalls.filter(({ collection }) => collection === 'commissions').length, 3)
})

test('NocoDB transform canonicalizes a blank gallery display order as zero', async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'))
  fixture.versions.find(({ id }) => id === 10).fields['Display Order'] = null

  const records = await transformNocoDbSources({
    gallery: {
      artists: fixture.artists,
      collections: fixture.collections,
      characters: fixture.characters,
      versions: fixture.versions,
      commissions: fixture.commissions,
    },
    uma: {
      scenarios: fixture.uma_scenarios,
      events: fixture.uma_pvp_events,
      supportCards: fixture.uma_support_cards,
    },
  }, { resolveAttachment: async () => ({}) })

  const version = records.find(({ collection, legacyId }) => collection === 'versions' && legacyId === 10)
  assert.equal(version.fields.display_order, 0)
})

test('NocoDB transform rejects a record ID that cannot be represented as a positive legacy_id', async () => {
  await assert.rejects(() => transformNocoDbSources({
    gallery: {
      artists: [{ id: 'not-numeric', fields: { 'Artist Name': 'Bad' } }],
      collections: [], characters: [], versions: [], commissions: [],
    },
    uma: { scenarios: [], events: [], supportCards: [] },
  }, { resolveAttachment: async () => assert.fail('no attachments expected') }), /positive numeric ID/i)
})

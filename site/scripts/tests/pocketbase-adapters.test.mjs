import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadPocketBaseGallerySource } from '../adapters/pocketbase-gallery.mjs'
import { loadPocketBaseUmaSource } from '../adapters/pocketbase-uma.mjs'
import { createModel as createGalleryModel } from '../sync-gallery.mjs'
import { createModel as createUmaModel } from '../sync-uma.mjs'

class FixtureClient {
  constructor(collections) {
    this.collections = collections
    this.downloads = []
  }

  async listAll(collection) {
    return this.collections[collection] ?? []
  }

  async downloadFile(collection, record, filename) {
    this.downloads.push(`${collection}:${record.legacy_id}:${filename}`)
    return Buffer.from(filename.endsWith('.gif') ? '474946383961' : '89504e470d0a1a0a', 'hex')
  }
}

function pocketBaseFixture() {
  return {
    artists: [
      { id: 'artist-two', legacy_id: 2, name: 'Artist B', url: 'https://example.invalid/b', updated: '2026-01-01' },
      { id: 'artist-one', legacy_id: 1, name: 'Artist A', url: 'https://example.invalid/a', updated: '2026-01-01' },
    ],
    collections: [
      { id: 'collection-two', legacy_id: 2, name: 'Collection', slug: 'second', display_order: 1, visible: true, collapsible: true, updated: '2026-01-01' },
      { id: 'collection-one', legacy_id: 1, name: 'Collection', slug: 'first', display_order: 1, visible: true, collapsible: false, updated: '2026-01-01' },
    ],
    characters: [
      { id: 'character-two', legacy_id: 2, name: 'Character', slug: 'second', visible: true, collection: 'collection-two', card_thumbnail: '', updated: '2026-01-01' },
      { id: 'character-one', legacy_id: 1, name: 'Character', slug: 'first', subtitle: 'Fixture', accent_color: '#abcdef', card_thumbnail: 'thumb.png', display_order: 1, visible: true, collection: 'collection-one', social_label: 'Profile', social_url: 'https://example.invalid/profile', updated: '2026-01-01' },
      { id: 'character-draft', legacy_id: 3, name: 'Draft', slug: 'draft', visible: false, collection: 'collection-two', card_thumbnail: '', updated: '2026-01-01' },
    ],
    versions: [
      { id: 'version-ten', legacy_id: 10, name: 'Version', slug: 'ten', reference_sheet: [], display_order: 1, visible: true, character: 'character-one', updated: '2026-01-01' },
      { id: 'version-two', legacy_id: 2, name: 'Version', slug: 'two', reference_sheet: ['reference-a.gif', 'reference-b.png'], display_order: 1, visible: true, character: 'character-one', updated: '2026-01-01' },
    ],
    commissions: [
      { id: 'commission-ten', legacy_id: 10, name: 'must remain private', type: 'Portrait', image: ['ten.webp'], source_url: 'https://example.invalid/ten', date: '2026-01-01 00:00:00.000Z', published: true, display_order: 1, versions: ['version-two'], artists: ['artist-two', 'artist-one'], updated: '2026-01-01' },
      { id: 'commission-two', legacy_id: 2, name: 'also private', type: 'Portrait', image: ['two-a.png', 'two-b.png'], source_url: 'https://example.invalid/two', date: '2026-01-01 00:00:00.000Z', published: true, display_order: 1, versions: ['version-two'], artists: ['artist-one'], updated: '2026-01-01' },
      { id: 'commission-draft', legacy_id: 3, name: 'draft private', type: 'Portrait', image: ['draft.png'], published: false, versions: ['version-two'], artists: ['artist-one'], updated: '2026-01-01' },
    ],
    uma_scenarios: [
      { id: 'scenario-one', legacy_id: 1, name: 'Scenario', short_name: 'first', slug: 'first', era_start: '2026-01-01 00:00:00.000Z', era_end: '2026-02-01 00:00:00.000Z', display_color: '#123456', updated: '2026-01-01' },
    ],
    uma_pvp_events: [
      { id: 'event-two', legacy_id: 2, name: 'Event', event_number: 1, slug: 'two', event_type: 'CM', start_date: '2026-01-02 00:00:00.000Z', end_date: '2026-01-03 00:00:00.000Z', scenario: 'scenario-one', distance_class: 'Mile', distance_m: 1600, surface: 'Turf', status: 'confirmed', updated: '2026-01-01' },
      { id: 'event-ten', legacy_id: 10, name: 'Event', event_number: 1, slug: 'ten', event_type: 'CM', start_date: '2026-01-02 00:00:00.000Z', end_date: '2026-01-03 00:00:00.000Z', scenario: 'scenario-one', distance_class: 'Mile', distance_m: 1600, surface: 'Turf', status: 'projected', updated: '2026-01-01' },
    ],
    uma_support_cards: [
      { id: 'support-ten', legacy_id: 10, name: 'Support', character_name: 'Character', slug: 'ten', image: '', card_type: 'Speed', rating: 'Core', release_date: '2026-01-04 00:00:00.000Z', styles: ['Front'], breakpoints: ['LB0', 'LB4'], pvp_events: ['event-ten', 'event-two'], updated: '2026-01-01' },
      { id: 'support-two', legacy_id: 2, name: 'Support', character_name: 'Character', slug: 'two', image: 'support.png', card_type: 'Speed', rating: 'Core', release_date: '2026-01-04 00:00:00.000Z', styles: ['Front', 'Late'], breakpoints: ['LB0', 'LB4'], pvp_events: ['event-two', 'event-ten'], updated: '2026-01-01' },
    ],
  }
}

test('PocketBase gallery adapter restores legacy relations, file order, drafts, and public model behavior', async () => {
  const client = new FixtureClient(pocketBaseFixture())
  const tables = await loadPocketBaseGallerySource(client)
  const model = createGalleryModel(tables, { url: 'https://unused.invalid' })
  assert.deepEqual(model.collections.map(({ id }) => id), ['1', '2'])
  assert.deepEqual(model.collections[0].characters.map(({ id }) => id), ['1'])
  assert.deepEqual(model.collections[1].characters.map(({ id }) => id), ['2'])
  assert.deepEqual(model.collections[0].characters[0].versions.map(({ id }) => id), ['2', '10'])
  assert.deepEqual(model.galleries.get('2').map(({ recordId }) => recordId), ['2', '2', '10'])
  assert.equal(JSON.stringify(model).includes('must remain private'), false)
  assert.equal(model.galleries.get('2')[0].date, '2026-01-01')
  assert.equal(model.errors.length, 0)
  assert.deepEqual([...model.imageTasks].map(([key]) => key), [
    'character-thumbnail:1:thumb.png', 'reference:2:reference-a.gif',
    'reference:2:reference-b.png', 'commission:2:two-a.png',
    'commission:2:two-b.png', 'commission:10:ten.webp',
  ])
  const gifTask = model.imageTasks.get('reference:2:reference-a.gif')
  assert.deepEqual(await gifTask.read(), Buffer.from('474946383961', 'hex'))
  assert.deepEqual(client.downloads, ['versions:2:reference-a.gif'])
})

test('PocketBase Uma adapter preserves arrays, relation order, dates, status, and image access', async () => {
  const client = new FixtureClient(pocketBaseFixture())
  const tables = await loadPocketBaseUmaSource(client)
  const model = createUmaModel(tables.scenarios, tables.events, tables.supportCards)
  assert.deepEqual(model.events.map(({ id }) => id), ['2', '10'])
  assert.deepEqual(model.events.map(({ status }) => status), ['confirmed', 'projected'])
  assert.deepEqual(model.supportCards.map(({ id }) => id), ['2', '10'])
  assert.deepEqual(model.supportCards[0].styles, ['Front', 'Late'])
  assert.deepEqual(model.supportCards[0].breakpoints, ['LB0', 'LB4'])
  assert.deepEqual(model.supportCards[0].eventIds, ['2', '10'])
  const task = model.imageTasks.get('support-card:2:support.png')
  assert.deepEqual(await task.read(), Buffer.from('89504e470d0a1a0a', 'hex'))
  assert.deepEqual(client.downloads, ['uma_support_cards:2:support.png'])
})

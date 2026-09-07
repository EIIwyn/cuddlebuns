import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const galleryModulePath = path.resolve(import.meta.dirname, '../sync-nocodb.mjs')
const umaModulePath = path.resolve(import.meta.dirname, '../sync-uma-nocodb.mjs')
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/nocodb-source.json', import.meta.url)))

const attachmentFields = {
  characters: ['Card Thumbnail'],
  versions: ['Reference Sheet'],
  commissions: ['Image'],
  uma_support_cards: ['image'],
}

function fixtureAttachmentInventory() {
  const entries = []
  for (const [collection, fields] of Object.entries(attachmentFields)) {
    for (const record of fixture[collection]) {
      assert.ok(Number(record.id) > 0, `${collection} fixture IDs must be positive`)
      for (const field of fields) {
        const attachments = record.fields[field] ?? []
        attachments.forEach((attachment, ordinal) => {
          entries.push({
            key: `${collection}:${record.id}:${field}:${ordinal}`,
            filename: attachment.title,
            detectedFormat: path.extname(attachment.title).slice(1).toLowerCase(),
            size: attachment.size,
            sha256: attachment.sha256,
          })
        })
      }
    }
  }
  return entries
}

test('sync modules expose pure model functions without running their entry points on import', async () => {
  for (const file of [galleryModulePath, umaModulePath]) {
    const source = fs.readFileSync(file, 'utf8')
    assert.match(source, /isMainModule/)
  }

  const gallery = await import('../sync-nocodb.mjs')
  const uma = await import('../sync-uma-nocodb.mjs')
  assert.equal(typeof gallery.createModel, 'function')
  assert.equal(typeof gallery.publicSourceSnapshot, 'function')
  assert.equal(typeof uma.createModel, 'function')
})

test('gallery fixture preserves relationships, attachment order, filtering, and numeric ID ties', async () => {
  const { createModel, publicSourceSnapshot } = await import('../sync-nocodb.mjs')
  const tables = Object.fromEntries(['collections', 'characters', 'versions', 'commissions', 'artists'].map((name) => [name, fixture[name]]))
  const snapshot = publicSourceSnapshot(tables)
  const model = createModel(tables, { url: 'https://cms.invalid' })

  assert.deepEqual(model.collections.map(({ id }) => id), ['1', '2'])
  assert.deepEqual(model.collections[0].characters.map(({ id }) => id), ['1'])
  assert.deepEqual(model.collections[0].characters[0].versions.map(({ id }) => id), ['2', '10'])
  assert.deepEqual(model.galleries.get('2').map(({ recordId }) => recordId), ['2', '2', '10'])
  assert.deepEqual([...model.imageTasks].map(([key]) => key), [
    'character-thumbnail:1:thumb-1',
    'reference:2:ref-a',
    'reference:2:ref-b',
    'commission:10:commission-10',
    'commission:2:commission-2a',
    'commission:2:commission-2b',
  ])
  assert.equal(JSON.stringify(model).includes('must remain private'), false)
  assert.equal(JSON.stringify(snapshot).includes('Internal Title'), false)
  assert.equal(model.errors.length, 0)
})

test('Uma fixture preserves arrays, relation order, and numeric ID ties', async () => {
  const { createModel } = await import('../sync-uma-nocodb.mjs')
  const model = createModel(fixture.uma_scenarios, fixture.uma_pvp_events, fixture.uma_support_cards)

  assert.deepEqual(model.scenarios.map(({ id }) => id), ['1', '2'])
  assert.deepEqual(model.events.map(({ id }) => id), ['2', '10'])
  assert.deepEqual(model.supportCards.map(({ id }) => id), ['2', '10'])
  assert.deepEqual(model.supportCards[0].styles, ['Front', 'Late'])
  assert.deepEqual(model.supportCards[0].breakpoints, ['LB0', 'LB4'])
  assert.deepEqual(model.supportCards[0].eventIds, ['2', '10'])
  assert.equal(model.errors.length, 0)
})

test('fixtures cover all eight tables and use stable ordered attachment inventory keys', () => {
  assert.deepEqual(Object.keys(fixture).sort(), [
    'artists',
    'characters',
    'collections',
    'commissions',
    'uma_pvp_events',
    'uma_scenarios',
    'uma_support_cards',
    'versions',
  ])
  const inventory = fixtureAttachmentInventory()
  assert.equal(new Set(inventory.map(({ key }) => key)).size, inventory.length)
  assert.ok(inventory.every(({ key }) => /^[a-z_]+:[1-9]\d*:[^:]+:\d+$/.test(key)))
  assert.ok(inventory.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)))
  assert.equal(Math.max(...inventory.map(({ size }) => size)), 8192)
  const attachmentCounts = Object.entries(attachmentFields).flatMap(([collection, fields]) =>
    fixture[collection].flatMap((record) => fields.map((field) => (record.fields[field] ?? []).length)))
  assert.equal(Math.max(...attachmentCounts), 2)
  assert.doesNotMatch(JSON.stringify(fixture), /NOCODB_TOKEN|xc-token|[?&](token|jwt)=/i)
})

test('saved baseline retains the established public descriptors and schemas when available', () => {
  const baseline = path.resolve(import.meta.dirname, '../../.cache/baseline-2026-09-06')
  if (!fs.existsSync(baseline)) return
  const site = JSON.parse(fs.readFileSync(path.join(baseline, 'data/cms/site.json')))
  const timeline = JSON.parse(fs.readFileSync(path.join(baseline, 'data/uma/timeline.json')))
  const descriptors = JSON.stringify([site, timeline])

  assert.equal(site.schemaVersion, 1)
  assert.equal(timeline.schemaVersion, 1)
  assert.ok(site.collections.length > 0)
  assert.ok(timeline.scenarios.length > 0)
  assert.match(descriptors, /"breakpoints":/)
  assert.match(descriptors, /"sources":\{"avif":/)
  assert.doesNotMatch(descriptors, /NOCODB_TOKEN|xc-token|Internal Title/)
})

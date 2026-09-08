import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildUrlMap, compareSnapshots } from '../migrate/compare-sources.mjs'

function snapshot(side) {
  const prefix = side === 'left' ? '/noco' : '/pocketbase'
  return {
    records: [
      { collection: 'artists', legacyId: 1, backendId: `${side}-artist`, fields: { name: 'Artist' }, relations: {}, files: [] },
      { collection: 'versions', legacyId: 2, backendId: `${side}-version`, fields: { name: 'Version', display_order: 1 }, relations: {}, files: [
        { field: 'reference_sheet', ordinal: 0, filename: `${side}-reference.png`, sha256: '1'.repeat(64), detectedFormat: 'png' },
      ] },
      { collection: 'commissions', legacyId: 3, backendId: `${side}-commission`, fields: { type: 'Portrait', display_order: 2 }, relations: {
        versions: { collection: 'versions', legacyIds: [2] },
        artists: { collection: 'artists', legacyIds: [1] },
      }, files: [
        { field: 'image', ordinal: 0, filename: `${side}-first.gif`, sha256: '2'.repeat(64), detectedFormat: 'gif' },
        { field: 'image', ordinal: 1, filename: `${side}-second.png`, sha256: '3'.repeat(64), detectedFormat: 'png' },
      ] },
      { collection: 'uma_support_cards', legacyId: 4, backendId: `${side}-support`, fields: {
        name: 'Support', styles: ['Front', 'Late'], breakpoints: ['LB0', 'LB4'],
      }, relations: {}, files: [] },
    ],
    publicFiles: {
      'data/cms/site.json': {
        schemaVersion: 1,
        generatedAt: side === 'left' ? '2026-01-01T00:00:00Z' : '2026-09-01T00:00:00Z',
        collections: [{ id: '1', order: 1, versions: ['2'] }],
      },
      'data/cms/gallery/item.json': {
        schemaVersion: 1,
        commissions: [{ id: '3-file', displayOrder: 2, image: {
          width: 100, height: 200,
          sources: {
            avif: [{ url: `${prefix}/image.avif`, width: 100, height: 200 }],
            webp: [{ url: `${prefix}/image.webp`, width: 100, height: 200 }],
          },
          fallback: { url: `${prefix}/image.webp`, width: 100, height: 200 },
          originalUrl: `${prefix}/image.gif`,
        } }],
      },
      'data/uma/timeline.json': {
        schemaVersion: 1,
        generatedAt: 'ignored',
        supportCards: [{ id: '4', styles: ['Front', 'Late'], breakpoints: ['LB0', 'LB4'] }],
      },
    },
    urlMap: {
      [`${prefix}/image.avif`]: { sourceSha256: '2'.repeat(64), kind: 'source', format: 'avif', width: 100, height: 200 },
      [`${prefix}/image.webp`]: { sourceSha256: '2'.repeat(64), kind: 'source', format: 'webp', width: 100, height: 200 },
      [`${prefix}/image.gif`]: { sourceSha256: '2'.repeat(64), kind: 'original', format: 'gif' },
    },
  }
}

test('equivalent snapshots accept only documented normalization and different backend IDs/URLs', () => {
  const result = compareSnapshots(snapshot('left'), snapshot('right'))
  assert.equal(result.equal, true)
  assert.deepEqual(result.differences, [])
  assert.deepEqual(result.normalized, [
    'generatedAt', 'backendId after complete legacyId mapping', 'generated URL after source SHA-256 mapping',
  ])
})

test('independent semantic and image mutations are rejected', () => {
  const mutations = [
    ['record count', (value) => value.records.pop()],
    ['scalar', (value) => { value.records[2].fields.type = 'Sketch' }],
    ['display order', (value) => { value.records[2].fields.display_order = 9 }],
    ['relation target', (value) => { value.records[2].relations.artists.legacyIds = [404] }],
    ['relation order', (value) => { value.records[2].relations.versions.legacyIds = [2, 1] }],
    ['JSON array order', (value) => { value.records[3].fields.styles.reverse() }],
    ['attachment order', (value) => { value.records[2].files.reverse() }],
    ['original hash', (value) => { value.records[2].files[0].sha256 = '9'.repeat(64) }],
    ['GIF availability', (value) => { value.publicFiles['data/cms/gallery/item.json'].commissions[0].image.originalUrl = null }],
    ['descriptor entry', (value) => { value.publicFiles['data/cms/gallery/item.json'].commissions[0].image.sources.avif = [] }],
    ['descriptor dimensions', (value) => { value.publicFiles['data/cms/gallery/item.json'].commissions[0].image.sources.webp[0].width = 99 }],
    ['public array order', (value) => { value.publicFiles['data/uma/timeline.json'].supportCards[0].breakpoints.reverse() }],
    ['unmapped URL', (value) => { value.publicFiles['data/cms/gallery/item.json'].commissions[0].image.fallback.url = '/unknown.webp' }],
  ]
  for (const [name, mutate] of mutations) {
    const right = snapshot('right')
    mutate(right)
    const result = compareSnapshots(snapshot('left'), right)
    assert.equal(result.equal, false, name)
    assert.ok(result.differences.length > 0, name)
  }
})

test('duplicate legacy or backend IDs prevent normalization', () => {
  for (const field of ['legacyId', 'backendId']) {
    const right = snapshot('right')
    const duplicate = structuredClone(right.records[0])
    if (field === 'backendId') duplicate.legacyId = 99
    right.records.push(duplicate)
    assert.throws(() => compareSnapshots(snapshot('left'), right), new RegExp(`duplicate ${field}`, 'i'))
  }
})

test('manifest tasks map to migration file slots in collection, ID, field order', () => {
  const records = [{
    collection: 'characters', legacyId: 6,
    files: [{ field: 'card_thumbnail', ordinal: 0, sha256: 'source-hash', detectedFormat: 'png' }],
  }]
  const manifests = [{ attachments: {
    'character-thumbnail:6:backend-file-id': { image: {
      sources: { webp: [{ url: '/generated/thumbnail.webp', width: 480, height: 600 }] },
      originalUrl: '/generated/thumbnail.png',
    } },
  } }]

  assert.deepEqual(buildUrlMap(manifests, records), {
    '/generated/thumbnail.webp': {
      sourceSha256: 'source-hash', kind: 'derivative', format: 'webp', width: 480, height: 600,
    },
    '/generated/thumbnail.png': { sourceSha256: 'source-hash', kind: 'original', format: 'png' },
  })
})

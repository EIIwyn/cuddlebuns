import test from 'node:test'
import assert from 'node:assert/strict'

import { summarizeArtistInventory } from '../migrate/inventory-artists.mjs'

test('Artist inventory summarizes fields and attachments without values', () => {
  const summary = summarizeArtistInventory([
    { id: '1', fields: {
      'Artist Name': '@one', Notes: 'private', Status: 'Candidate', Example: [
        { title: 'one.png', mimetype: 'image/png', size: 12 },
      ],
    } },
    { id: '2', fields: {
      'Artist Name': '@two', Status: 'Approved', Example: [],
    } },
  ])

  assert.equal(summary.records, 2)
  assert.deepEqual(summary.fields.Status, { present: 2, types: ['string'] })
  assert.deepEqual(summary.attachments, {
    Example: { count: 1, formats: ['image/png'], maxBytes: 12 },
  })
  assert.equal(JSON.stringify(summary).includes('@one'), false)
  assert.equal(JSON.stringify(summary).includes('private'), false)
})
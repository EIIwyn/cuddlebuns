import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import {
  assertSourceAvailable,
  manifestPath,
  scopedFingerprint,
  selectSource,
} from '../lib/source-selection.mjs'

test('source selection defaults to NocoDB and follows CLI then environment precedence', () => {
  assert.equal(selectSource([], {}), 'nocodb')
  assert.equal(selectSource([], { CMS_SOURCE: 'pocketbase' }), 'pocketbase')
  assert.equal(selectSource(['--source=nocodb'], { CMS_SOURCE: 'pocketbase' }), 'nocodb')
  assert.equal(selectSource(['--source', 'pocketbase'], { CMS_SOURCE: 'nocodb' }), 'pocketbase')
})

test('source selection rejects invalid, missing, and conflicting CLI values', () => {
  assert.throws(() => selectSource(['--source=other'], {}), /Unknown CMS source/)
  assert.throws(() => selectSource(['--source'], {}), /requires a value/)
  assert.throws(() => selectSource(['--source=nocodb', '--source=pocketbase'], {}), /Conflicting --source/)
  assert.equal(selectSource(['--source=nocodb', '--source', 'nocodb'], {}), 'nocodb')
})

test('manifest state and fingerprints are isolated by area and source', () => {
  const root = path.resolve('fixture-site')
  assert.equal(manifestPath('gallery', 'nocodb', root), path.join(root, '.cache', 'gallery', 'nocodb', 'manifest.json'))
  assert.equal(manifestPath('gallery', 'pocketbase', root), path.join(root, '.cache', 'gallery', 'pocketbase', 'manifest.json'))
  assert.notEqual(scopedFingerprint('nocodb', { id: 1 }), scopedFingerprint('pocketbase', { id: 1 }))
})

test('an explicitly selected unavailable adapter fails instead of falling back', () => {
  assert.equal(assertSourceAvailable('nocodb', ['nocodb']), 'nocodb')
  assert.throws(() => assertSourceAvailable('pocketbase', ['nocodb']), /not configured/)
})

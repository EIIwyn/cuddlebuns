import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const siteDir = path.resolve(import.meta.dirname, '../..')
const repositoryDir = path.resolve(siteDir, '..')

test('source-neutral sync entry points replace backend-named commands everywhere', () => {
  for (const file of ['scripts/sync-gallery.mjs', 'scripts/sync-uma.mjs']) {
    assert.equal(fs.existsSync(path.join(siteDir, file)), true, `${file} must exist`)
  }
  for (const file of ['scripts/sync-nocodb.mjs', 'scripts/sync-uma-nocodb.mjs']) {
    assert.equal(fs.existsSync(path.join(siteDir, file)), false, `${file} must be retired`)
  }
  const references = [
    fs.readFileSync(path.join(siteDir, 'package.json'), 'utf8'),
    fs.readFileSync(path.join(siteDir, 'WORKFLOW.md'), 'utf8'),
    fs.readFileSync(path.join(repositoryDir, 'AGENTS.md'), 'utf8'),
    fs.readFileSync(path.join(repositoryDir, 'vps-scripts/sync-build-deploy.sh'), 'utf8'),
    fs.readFileSync(path.join(repositoryDir, 'vps-scripts/auto-deploy.sh'), 'utf8'),
  ].join('\n')
  assert.doesNotMatch(references, /sync-nocodb\.mjs|sync-uma-nocodb\.mjs/)
})

test('NocoDB and PocketBase adapters expose the same shared pipeline boundaries', async () => {
  const galleryAdapter = await import('../adapters/nocodb-gallery.mjs')
  const umaAdapter = await import('../adapters/nocodb-uma.mjs')
  const pocketBaseGalleryAdapter = await import('../adapters/pocketbase-gallery.mjs')
  const pocketBaseUmaAdapter = await import('../adapters/pocketbase-uma.mjs')
  const galleryModel = await import('../lib/gallery-model.mjs')
  const umaModel = await import('../lib/uma-model.mjs')

  assert.equal(typeof galleryAdapter.loadGallerySource, 'function')
  assert.equal(typeof umaAdapter.loadUmaSource, 'function')
  assert.equal(typeof pocketBaseGalleryAdapter.loadPocketBaseGallerySource, 'function')
  assert.equal(typeof pocketBaseUmaAdapter.loadPocketBaseUmaSource, 'function')
  assert.equal(typeof galleryModel.createGalleryModel, 'function')
  assert.equal(typeof umaModel.createUmaModel, 'function')
})

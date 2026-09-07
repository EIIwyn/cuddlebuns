import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { createAttachmentResolver } from '../migrate/attachment-resolver.mjs'
import { sourceFingerprint } from '../migrate/nocodb-source.mjs'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

test('source fingerprint ignores expiring signed paths but detects editorial changes and order', () => {
  const left = { gallery: { versions: [{ id: 1, fields: {
    Name: 'A',
    'Reference Sheet': [{ id: 'file', title: 'a.png', signedPath: '/one', size: 10 }],
  } }] } }
  const newSignature = structuredClone(left)
  newSignature.gallery.versions[0].fields['Reference Sheet'][0].signedPath = '/two'
  assert.equal(sourceFingerprint(left), sourceFingerprint(newSignature))

  const edited = structuredClone(left)
  edited.gallery.versions[0].fields.Name = 'B'
  assert.notEqual(sourceFingerprint(left), sourceFingerprint(edited))

  const reordered = structuredClone(left)
  reordered.gallery.versions[0].fields['Reference Sheet'].push({ id: 'second', title: 'b.png', size: 10 })
  reordered.gallery.versions[0].fields['Reference Sheet'].reverse()
  assert.notEqual(sourceFingerprint(left), sourceFingerprint(reordered))
})

test('attachment resolver verifies inventory cache and detects GIF bytes despite a PNG hint', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cuddlebuns-migration-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bytes = Buffer.from('474946383961', 'hex')
  const digest = sha256(bytes)
  await writeFile(path.join(directory, `${digest}.gif`), bytes)
  let requests = 0
  const resolve = createAttachmentResolver({
    cacheDir: directory,
    inventories: [{ entries: [{
      key: 'versions:2:reference_sheet:0', attachmentId: 'ref-a', filename: 'wrong.png',
      actualSize: bytes.length, sha256: digest, detectedFormat: 'gif',
    }] }],
    fetch: async () => { requests += 1; throw new Error('cache should be used') },
  })
  const result = await resolve({
    collection: 'versions', legacyId: 2, field: 'reference_sheet', ordinal: 0,
    attachment: { id: 'ref-a', title: 'wrong.png', mimetype: 'image/png', size: bytes.length, signedPath: '/secret' },
  })
  assert.equal(result.detectedFormat, 'gif')
  assert.equal(result.filename, 'wrong.gif')
  assert.equal(result.sha256, digest)
  assert.deepEqual(await result.read(), bytes)
  assert.equal(requests, 0)
})

test('attachment resolver downloads uncached bytes once and writes only content-addressed data', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cuddlebuns-migration-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex')
  let requests = 0
  const resolve = createAttachmentResolver({
    cacheDir: directory,
    inventories: [],
    fetch: async (url) => {
      requests += 1
      assert.equal(url, 'https://noco.invalid/signed-secret')
      return new Response(bytes, { status: 200 })
    },
    sourceUrls: { gallery: 'https://noco.invalid' },
  })
  const descriptor = {
    collection: 'commissions', legacyId: 1, field: 'image', ordinal: 0,
    attachment: { id: 'image', title: '../unsafe.name', size: bytes.length, signedPath: '/signed-secret' },
  }
  const first = await resolve(descriptor)
  const second = await resolve(descriptor)
  assert.equal(requests, 1)
  assert.equal(first.filename, 'unsafe.png')
  assert.equal(first.sha256, second.sha256)
  assert.deepEqual(await readFile(path.join(directory, `${first.sha256}.png`)), bytes)
})

test('attachment resolver treats a changed attachment as new instead of trusting stale inventory', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cuddlebuns-migration-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const oldBytes = Buffer.from('474946383961', 'hex')
  const newBytes = Buffer.from('89504e470d0a1a0a', 'hex')
  const oldHash = sha256(oldBytes)
  await writeFile(path.join(directory, `${oldHash}.gif`), oldBytes)
  let requests = 0
  const resolve = createAttachmentResolver({
    cacheDir: directory,
    inventories: [{ entries: [{
      key: 'commissions:1:image:0', attachmentId: 'old', filename: 'old.gif',
      actualSize: oldBytes.length, sha256: oldHash, detectedFormat: 'gif',
    }] }],
    fetch: async () => { requests += 1; return new Response(newBytes, { status: 200 }) },
    sourceUrls: { gallery: 'https://noco.invalid' },
  })
  const result = await resolve({
    collection: 'commissions', legacyId: 1, field: 'image', ordinal: 0,
    attachment: { id: 'new', title: 'new.png', size: newBytes.length, signedPath: '/new' },
  })
  assert.equal(requests, 1)
  assert.equal(result.sha256, sha256(newBytes))
  assert.equal(result.filename, 'new.png')
})

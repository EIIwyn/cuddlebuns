import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getPocketBaseConfig } from '../lib/env.mjs'
import { createPocketBaseClient } from '../lib/pocketbase-client.mjs'

function response(status, body) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const syncEnv = {
  POCKETBASE_URL: 'http://127.0.0.1:8090/',
  POCKETBASE_AUTH_COLLECTION: 'cms_sync',
  POCKETBASE_SYNC_EMAIL: 'sync@example.invalid',
  POCKETBASE_SYNC_PASSWORD: 'secret-password',
}

test('PocketBase config separates sync and migration credentials', () => {
  assert.deepEqual(getPocketBaseConfig(syncEnv, 'sync'), {
    url: 'http://127.0.0.1:8090', authCollection: 'cms_sync',
    identity: 'sync@example.invalid', password: 'secret-password', role: 'sync',
  })
  const migration = getPocketBaseConfig({
    POCKETBASE_URL: 'http://localhost:8090',
    POCKETBASE_MIGRATION_AUTH_COLLECTION: '_superusers',
    POCKETBASE_MIGRATION_EMAIL: 'admin@example.invalid',
    POCKETBASE_MIGRATION_PASSWORD: 'migration-secret',
  }, 'migration')
  assert.equal(migration.authCollection, '_superusers')
  assert.equal(migration.role, 'migration')
  assert.throws(() => getPocketBaseConfig({}, 'sync'), /Missing PocketBase configuration/)
})

test('read client authenticates once, paginates, filters, and has no mutation methods', async () => {
  const requests = []
  const fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (String(url).includes('auth-with-password')) return response(200, { token: 'auth-token', record: { id: 'sync' } })
    const page = Number(new URL(url).searchParams.get('page'))
    return response(200, { page, totalPages: 2, items: [{ id: `record-${page}`, legacy_id: page }] })
  }
  const client = createPocketBaseClient(getPocketBaseConfig(syncEnv, 'sync'), { fetch })
  const records = await client.listAll('artists', { filter: 'legacy_id > 0', perPage: 1 })
  assert.deepEqual(records.map(({ id }) => id), ['record-1', 'record-2'])
  assert.equal(requests.filter(({ url }) => url.includes('auth-with-password')).length, 1)
  assert.match(requests[1].url, /filter=legacy_id(?:\+|%20)%3E(?:\+|%20)0/)
  assert.equal(requests[1].options.headers.Authorization, 'auth-token')
  assert.equal(client.createRecord, undefined)
  assert.equal(client.updateRecord, undefined)
})

test('client reauthenticates once after an unauthorized read', async () => {
  let authCount = 0
  let listCount = 0
  const fetch = async (url) => {
    if (String(url).includes('auth-with-password')) return response(200, { token: `token-${++authCount}` })
    listCount += 1
    if (listCount === 1) return response(401, { message: 'expired' })
    return response(200, { page: 1, totalPages: 1, items: [] })
  }
  const client = createPocketBaseClient(getPocketBaseConfig(syncEnv, 'sync'), { fetch })
  await client.listAll('artists')
  assert.equal(authCount, 2)
})

test('idempotent reads retry transient failures and carry a timeout signal', async () => {
  let reads = 0
  const fetch = async (url, options) => {
    if (String(url).includes('auth-with-password')) return response(200, { token: 'auth-token' })
    reads += 1
    assert.ok(options.signal instanceof AbortSignal)
    if (reads === 1) throw new TypeError('temporary network failure')
    return response(200, { page: 1, totalPages: 1, items: [] })
  }
  const client = createPocketBaseClient(getPocketBaseConfig(syncEnv, 'sync'), { fetch, maxReadAttempts: 2 })
  await client.listAll('artists')
  assert.equal(reads, 2)
})

test('protected-file helpers request a token and encode every URL segment', async () => {
  const fetch = async (url) => String(url).includes('auth-with-password')
    ? response(200, { token: 'auth-token' })
    : response(200, { token: 'file-token' })
  const client = createPocketBaseClient(getPocketBaseConfig(syncEnv, 'sync'), { fetch })
  const token = await client.getFileToken()
  assert.equal(token, 'file-token')
  assert.equal(client.fileUrl('support cards', 'record/id', 'image name.png', token),
    'http://127.0.0.1:8090/api/files/support%20cards/record%2Fid/image%20name.png?token=file-token')
})

test('migration mutations are explicit and non-retrying, and errors redact secrets', async () => {
  const config = getPocketBaseConfig({
    POCKETBASE_URL: 'http://localhost:8090', POCKETBASE_MIGRATION_EMAIL: 'admin@example.invalid',
    POCKETBASE_MIGRATION_PASSWORD: 'migration-secret',
  }, 'migration')
  let createCount = 0
  const fetch = async (url) => {
    if (String(url).includes('auth-with-password')) return response(200, { token: 'migration-token' })
    createCount += 1
    return response(500, { message: 'migration-secret migration-token' })
  }
  const client = createPocketBaseClient(config, { fetch })
  await assert.rejects(() => client.createRecord('artists', { legacy_id: 1 }), (error) => {
    assert.doesNotMatch(error.message, /migration-secret|migration-token/)
    return true
  })
  assert.equal(createCount, 1)
})

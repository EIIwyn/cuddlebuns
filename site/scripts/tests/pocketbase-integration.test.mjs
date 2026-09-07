import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const execFile = promisify(execFileCallback)
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const pocketBaseDirectory = fileURLToPath(new URL('../../../vps-scripts/pocketbase/', import.meta.url))
const integrationEnabled = process.env.POCKETBASE_INTEGRATION === '1'
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

async function docker(args, { allowFailure = false } = {}) {
  try {
    return await execFile('docker', args, {
      cwd: repositoryRoot,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (error) {
    if (allowFailure) return error
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`docker ${args[0]} failed${detail ? `:\n${detail}` : ''}`, { cause: error })
  }
}

async function api(baseUrl, method, path, { body, expected = 200, token } = {}) {
  const headers = {}
  if (token) headers.Authorization = token
  let requestBody = body
  if (body != null && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json'
    requestBody = JSON.stringify(body)
  }
  const response = await fetch(`${baseUrl}${path}`, { body: requestBody, headers, method })
  const text = await response.text()
  const result = text ? JSON.parse(text) : null
  const statuses = Array.isArray(expected) ? expected : [expected]
  assert.ok(statuses.includes(response.status),
    `${method} ${path}: expected ${statuses.join('/')}, received ${response.status}: ${text}`)
  return result
}

function addFields(form, fields) {
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, Array.isArray(value) || (value && typeof value === 'object')
      ? JSON.stringify(value)
      : String(value))
  }
  return form
}

function imageBlob(size = pngBytes.length) {
  const bytes = new Uint8Array(size)
  bytes.set(pngBytes.subarray(0, Math.min(size, pngBytes.length)))
  return new Blob([bytes], { type: 'image/png' })
}

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
      lastError = new Error(`health returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`PocketBase did not become healthy: ${lastError?.message ?? 'timeout'}`)
}

async function waitForContainerHealth(baseUrl, container) {
  try {
    await waitForHealth(baseUrl)
  } catch (error) {
    const logs = await docker(['logs', container], { allowFailure: true })
    const detail = [logs.stdout, logs.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${error.message}${detail ? `\nContainer logs:\n${detail}` : ''}`, { cause: error })
  }
}

async function containerBaseUrl(container) {
  const { stdout } = await docker(['port', container, '8090/tcp'])
  const match = stdout.trim().match(/^127\.0\.0\.1:(\d+)$/)
  assert.ok(match, `unexpected Docker port output: ${stdout}`)
  return `http://127.0.0.1:${match[1]}`
}

async function authenticate(baseUrl, collection, identity, password) {
  return api(baseUrl, 'POST', `/api/collections/${collection}/auth-with-password`, {
    body: { identity, password },
  })
}

async function createRecord(baseUrl, collection, body, token) {
  return api(baseUrl, 'POST', `/api/collections/${collection}/records`, { body, token })
}

test('PocketBase integration harness cannot target production state or port', async () => {
  const source = await readFile(new URL('pocketbase-integration.test.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\/var\/lib\/cuddlebuns/)
  assert.doesNotMatch(source, /127\.0\.0\.1:8090/)
  assert.match(source, /127\.0\.0\.1::8090/)
  assert.match(source, /docker\(\['volume', 'create'/)
  assert.match(source, /finally/)
})

test('PocketBase disposable container enforces schema, auth, relations, and file contracts', {
  skip: !integrationEnabled,
  timeout: 10 * 60 * 1000,
}, async (t) => {
  const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`
  const image = `cuddlebuns-pocketbase:integration-${suffix}`
  const container = `cuddlebuns-pocketbase-integration-${suffix}`
  const volume = `cuddlebuns-pocketbase-integration-${suffix}`
  const migrateContainer = `${container}-migrate`
  const superuserContainer = `${container}-superuser`
  const adminEmail = `admin-${suffix}@example.invalid`
  const adminPassword = `Admin-${randomBytes(18).toString('base64url')}`
  const syncEmail = `sync-${suffix}@example.invalid`
  const syncPassword = `Sync-${randomBytes(18).toString('base64url')}`
  let baseUrl

  const dataArgs = ['--volume', `${volume}:/pb/pb_data`]
  const pocketBaseArgs = ['--dir=/pb/pb_data', '--migrationsDir=/pb/pb_migrations', '--automigrate=0']

  try {
    await docker(['build', '--no-cache', '--tag', image, pocketBaseDirectory])
    await docker(['volume', 'create', '--label', 'cuddlebuns.task=pocketbase-integration', volume])
    await docker([
      'run', '--rm', '--user', '0:0', ...dataArgs, '--entrypoint', '/bin/chown', image,
      '-R', '10001:10001', '/pb/pb_data',
    ])
    await docker([
      'run', '--rm', '--name', migrateContainer, ...dataArgs, image,
      'migrate', 'up', ...pocketBaseArgs,
    ])
    await docker([
      'run', '--rm', '--name', superuserContainer, ...dataArgs, image,
      'superuser', 'create', adminEmail, adminPassword, ...pocketBaseArgs,
    ])
    await docker([
      'run', '--detach', '--name', container,
      '--label', 'cuddlebuns.task=pocketbase-integration',
      '--user', '10001:10001',
      '--read-only',
      '--tmpfs', '/tmp:size=64m,mode=1777',
      '--network', 'bridge',
      '--publish', '127.0.0.1::8090',
      '--env', 'GOMEMLIMIT=384MiB',
      '--memory', '512m',
      '--pids-limit', '128',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      ...dataArgs,
      image,
    ])
    baseUrl = await containerBaseUrl(container)
    await waitForContainerHealth(baseUrl, container)

    const adminAuth = await authenticate(baseUrl, '_superusers', adminEmail, adminPassword)
    const adminToken = adminAuth.token

    await t.test('fresh migrations create all collections exactly once', async () => {
      const result = await api(baseUrl, 'GET', '/api/collections?perPage=200', { token: adminToken })
      const expected = [
        'artists', 'cms_sync', 'collections', 'characters', 'versions', 'commissions',
        'uma_scenarios', 'uma_pvp_events', 'uma_support_cards',
      ]
      const names = result.items.map(({ name }) => name)
      for (const name of expected) assert.ok(names.includes(name), `missing ${name}`)
      assert.equal(names.filter((name) => expected.includes(name)).length, expected.length)

      const characters = result.items.find(({ name }) => name === 'characters')
      const thumbnail = characters.fields.find(({ name }) => name === 'card_thumbnail')
      assert.deepEqual({ maxSelect: thumbnail.maxSelect, maxSize: thumbnail.maxSize, protected: thumbnail.protected },
        { maxSelect: 1, maxSize: 2 * 1024 * 1024, protected: true })
    })

    const syncRecord = await createRecord(baseUrl, 'cms_sync', {
      email: syncEmail,
      password: syncPassword,
      passwordConfirm: syncPassword,
    }, adminToken)
    const syncAuth = await authenticate(baseUrl, 'cms_sync', syncEmail, syncPassword)
    const syncToken = syncAuth.token

    await t.test('sync identity can read but cannot register or mutate', async () => {
      await api(baseUrl, 'POST', '/api/collections/cms_sync/records', {
        body: { email: 'blocked@example.invalid', password: syncPassword, passwordConfirm: syncPassword },
        expected: 403,
      })
      const artist = await createRecord(baseUrl, 'artists', { legacy_id: 90, name: 'Read only' }, adminToken)
      const page = await api(baseUrl, 'GET', '/api/collections/artists/records?perPage=1', { token: syncToken })
      assert.equal(page.items.length, 1)
      const viewed = await api(baseUrl, 'GET', `/api/collections/artists/records/${artist.id}`, { token: syncToken })
      assert.equal(viewed.id, artist.id)
      await api(baseUrl, 'POST', '/api/collections/artists/records', {
        body: { legacy_id: 91 }, expected: 403, token: syncToken,
      })
      await api(baseUrl, 'PATCH', `/api/collections/artists/records/${artist.id}`, {
        body: { name: 'blocked' }, expected: 403, token: syncToken,
      })
      await api(baseUrl, 'DELETE', `/api/collections/artists/records/${artist.id}`, {
        expected: 403, token: syncToken,
      })
      assert.equal(syncRecord.email, syncEmail)
    })

    await t.test('positive unique legacy IDs and pagination are enforced', async () => {
      await api(baseUrl, 'POST', '/api/collections/artists/records', {
        body: { name: 'missing' }, expected: 400, token: adminToken,
      })
      await api(baseUrl, 'POST', '/api/collections/artists/records', {
        body: { legacy_id: 0 }, expected: 400, token: adminToken,
      })
      await createRecord(baseUrl, 'artists', { legacy_id: 100, name: 'One' }, adminToken)
      await createRecord(baseUrl, 'artists', { legacy_id: 101, name: 'Two' }, adminToken)
      await api(baseUrl, 'POST', '/api/collections/artists/records', {
        body: { legacy_id: 100 }, expected: 400, token: adminToken,
      })
      const first = await api(baseUrl, 'GET', '/api/collections/artists/records?page=1&perPage=1&sort=legacy_id', {
        token: syncToken,
      })
      const second = await api(baseUrl, 'GET', '/api/collections/artists/records?page=2&perPage=1&sort=legacy_id', {
        token: syncToken,
      })
      assert.equal(first.page, 1)
      assert.equal(second.page, 2)
      assert.notEqual(first.items[0].id, second.items[0].id)
    })

    const artist1 = await createRecord(baseUrl, 'artists', { legacy_id: 1, name: 'Artist One' }, adminToken)
    const artist2 = await createRecord(baseUrl, 'artists', { legacy_id: 2, name: 'Artist Two' }, adminToken)
    const project = await createRecord(baseUrl, 'collections', { legacy_id: 1, name: 'Project' }, adminToken)

    const characterForm = addFields(new FormData(), {
      legacy_id: 1, name: 'Character', collection: project.id,
    })
    characterForm.append('card_thumbnail', imageBlob(), 'thumbnail.png')
    const character = await createRecord(baseUrl, 'characters', characterForm, adminToken)
    const version1 = await createRecord(baseUrl, 'versions', {
      legacy_id: 1, name: 'Version One', character: character.id,
    }, adminToken)
    const version2 = await createRecord(baseUrl, 'versions', {
      legacy_id: 2, name: 'Version Two', character: character.id,
    }, adminToken)

    const commissionForm = addFields(new FormData(), {
      legacy_id: 1,
      name: 'Internal only',
      versions: [version1.id, version2.id],
      artists: [artist1.id, artist2.id],
    })
    commissionForm.append('image', imageBlob(), 'first.png')
    commissionForm.append('image', imageBlob(), 'second.png')
    const commission = await createRecord(baseUrl, 'commissions', commissionForm, adminToken)

    const scenario = await createRecord(baseUrl, 'uma_scenarios', { legacy_id: 1, name: 'Scenario' }, adminToken)
    const event1 = await createRecord(baseUrl, 'uma_pvp_events', {
      legacy_id: 1, name: 'Event One', scenario: scenario.id,
    }, adminToken)
    const event2 = await createRecord(baseUrl, 'uma_pvp_events', {
      legacy_id: 2, name: 'Event Two', scenario: scenario.id,
    }, adminToken)
    const supportForm = addFields(new FormData(), {
      legacy_id: 1,
      name: 'Support',
      styles: ['front', 'pace'],
      breakpoints: [{ event: 1, rating: 'core' }],
      pvp_events: [event1.id, event2.id],
    })
    supportForm.append('image', imageBlob(), 'support.png')
    const support = await createRecord(baseUrl, 'uma_support_cards', supportForm, adminToken)

    await t.test('single and multiple relations, files, and JSON arrays retain order', async () => {
      assert.equal(character.collection, project.id)
      assert.equal(typeof character.card_thumbnail, 'string')
      assert.deepEqual(Array.from(commission.versions), [version1.id, version2.id])
      assert.deepEqual(Array.from(commission.artists), [artist1.id, artist2.id])
      assert.equal(commission.image.length, 2)
      assert.match(commission.image[0], /^first_/)
      assert.match(commission.image[1], /^second_/)
      assert.deepEqual(Array.from(support.styles), ['front', 'pace'])
      assert.deepEqual(support.breakpoints, [{ event: 1, rating: 'core' }])
      assert.deepEqual(Array.from(support.pvp_events), [event1.id, event2.id])
    })

    await t.test('protected files require and accept a sync file token', async () => {
      const withoutToken = await fetch(
        `${baseUrl}/api/files/${character.collectionId}/${character.id}/${character.card_thumbnail}`,
      )
      assert.equal(withoutToken.ok, false)
      const fileToken = await api(baseUrl, 'POST', '/api/files/token', { token: syncToken })
      const withToken = await fetch(
        `${baseUrl}/api/files/${character.collectionId}/${character.id}/${character.card_thumbnail}?token=${fileToken.token}`,
      )
      assert.equal(withToken.status, 200)
      assert.deepEqual(Buffer.from(await withToken.arrayBuffer()), pngBytes)
    })

    await t.test('file count and per-file size limits accept the boundary and reject overflow', async () => {
      const twoThumbnails = addFields(new FormData(), { legacy_id: 2 })
      twoThumbnails.append('card_thumbnail', imageBlob(), 'one.png')
      twoThumbnails.append('card_thumbnail', imageBlob(), 'two.png')
      const replaced = await createRecord(baseUrl, 'characters', twoThumbnails, adminToken)
      assert.equal(typeof replaced.card_thumbnail, 'string')
      assert.match(replaced.card_thumbnail, /^two_/)

      const tooLarge = addFields(new FormData(), { legacy_id: 3 })
      tooLarge.append('card_thumbnail', imageBlob(2 * 1024 * 1024 + 1), 'too-large.png')
      await api(baseUrl, 'POST', '/api/collections/characters/records', {
        body: tooLarge, expected: 400, token: adminToken,
      })

      const atLimit = addFields(new FormData(), { legacy_id: 4 })
      atLimit.append('card_thumbnail', imageBlob(2 * 1024 * 1024), 'at-limit.png')
      const accepted = await createRecord(baseUrl, 'characters', atLimit, adminToken)
      assert.match(accepted.card_thumbnail, /^at[_-]limit_/)

      const tooManyReferences = addFields(new FormData(), { legacy_id: 3 })
      for (let index = 0; index < 7; index += 1) {
        tooManyReferences.append('reference_sheet', imageBlob(), `reference-${index}.png`)
      }
      await api(baseUrl, 'POST', '/api/collections/versions/records', {
        body: tooManyReferences, expected: 400, token: adminToken,
      })
    })

    await t.test('initialized restart and no-op migration rerun preserve state', async () => {
      await docker(['restart', container])
      baseUrl = await containerBaseUrl(container)
      await waitForContainerHealth(baseUrl, container)
      const afterRestart = await authenticate(baseUrl, 'cms_sync', syncEmail, syncPassword)
      assert.equal(afterRestart.record.id, syncRecord.id)

      await docker(['stop', container])
      const rerun = await docker([
        'run', '--rm', '--name', migrateContainer, ...dataArgs, image,
        'migrate', 'up', ...pocketBaseArgs,
      ])
      assert.doesNotMatch(`${rerun.stdout}\n${rerun.stderr}`, /failed/i)
      await docker(['start', container])
      baseUrl = await containerBaseUrl(container)
      await waitForContainerHealth(baseUrl, container)
      const afterRerun = await authenticate(baseUrl, 'cms_sync', syncEmail, syncPassword)
      assert.equal(afterRerun.record.id, syncRecord.id)
    })
  } finally {
    await docker(['rm', '--force', container], { allowFailure: true })
    await docker(['rm', '--force', migrateContainer], { allowFailure: true })
    await docker(['rm', '--force', superuserContainer], { allowFailure: true })
    await docker(['volume', 'rm', '--force', volume], { allowFailure: true })
    await docker(['image', 'rm', '--force', image], { allowFailure: true })
  }
})

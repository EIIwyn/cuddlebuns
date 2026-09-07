import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const pocketBaseDirectory = new URL('../../../vps-scripts/pocketbase/', import.meta.url)

async function read(name) {
  return readFile(new URL(name, pocketBaseDirectory), 'utf8')
}

test('PocketBase image pins verified amd64 inputs and runs as a fixed non-root user', async () => {
  const dockerfile = await read('Dockerfile')

  assert.doesNotMatch(dockerfile, /\blatest\b/i)
  assert.match(dockerfile,
    /alpine:3\.24\.1@sha256:79ff19e9084a00eece421b2523fb93e22d730e2c0e525905de047e848e56d95f/)
  assert.match(dockerfile, /POCKETBASE_VERSION=0\.40\.3/)
  assert.match(dockerfile,
    /POCKETBASE_SHA256=8d81b6b79add0e219373e922ebe1dddbee7f57fcff602e3585e0d2c654b983ce/)
  assert.match(dockerfile, /pocketbase_\$\{POCKETBASE_VERSION\}_linux_amd64\.zip/)
  assert.match(dockerfile, /checksums\.txt/)
  assert.match(dockerfile, /sha256sum -c/)
  assert.match(dockerfile, /COPY --from=download .*pocketbase .*pocketbase/)
  assert.match(dockerfile,
    /COPY --chown=10001:10001 --chmod=0444 pb_migrations \/pb\/pb_migrations/)
  assert.match(dockerfile, /org\.opencontainers\.image\.source="https:\/\/github\.com\/EIIwyn\/cuddlebuns"/)
  assert.match(dockerfile, /USER 10001:10001/)
  assert.match(dockerfile, /"--http=0\.0\.0\.0:8090"/)
  assert.match(dockerfile, /"--automigrate=0"/)
})

test('PocketBase Compose policy keeps the service private, persistent, bounded, and healthy', async () => {
  const compose = await read('compose.yml')

  assert.match(compose, /127\.0\.0\.1:8090:8090/)
  assert.doesNotMatch(compose, /^\s*-\s*["']?(?:0\.0\.0\.0:)?8090:8090/m)
  assert.match(compose, /\/pb\/pb_data/)
  assert.match(compose, /GOMEMLIMIT:\s*["']?384MiB["']?/)
  assert.match(compose, /mem_limit:\s*["']?512m["']?/)
  assert.match(compose, /restart:\s*unless-stopped/)
  assert.match(compose, /healthcheck:/)
  assert.match(compose, /http:\/\/127\.0\.0\.1:8090\/api\/health/)
  assert.match(compose, /no-new-privileges:true/)
  assert.match(compose, /cap_drop:\s*\r?\n\s*- ALL/)
})

test('PocketBase Docker context contains only the build inputs', async () => {
  const dockerignore = await read('.dockerignore')

  assert.match(dockerignore, /^\*$/m)
  assert.match(dockerignore, /^!Dockerfile$/m)
  assert.match(dockerignore, /^!pb_migrations\/$/m)
  assert.match(dockerignore, /^!pb_migrations\/\*\.js$/m)
  assert.doesNotMatch(dockerignore, /pb_data|\.env/)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const config = new URL('../../../cuddlebuns.caddy', import.meta.url)

test('CMS Caddy block is private-upstream, upload-safe, and preserves the client IP', async () => {
  const source = await readFile(config, 'utf8')
  const block = source.match(/cms\.cuddlebuns\.moe\s*\{([\s\S]*?)^\}/m)?.[1]

  assert.ok(block, 'missing cms.cuddlebuns.moe block')
  assert.match(block, /request_body\s*\{\s*max_size 160MB\s*\}/m)
  assert.match(block, /reverse_proxy 127\.0\.0\.1:8090\s*\{/)
  assert.doesNotMatch(block, /reverse_proxy\s+(?:0\.0\.0\.0|86\.38\.200\.117)/)
  assert.match(block, /header_up X-Real-IP \{remote_host\}/)
  assert.match(block, /transport http\s*\{\s*read_timeout 6m\s*\}/m)
})

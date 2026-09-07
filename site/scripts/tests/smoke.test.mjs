import assert from 'node:assert/strict'
import { test } from 'node:test'

test('the Node test harness executes deterministic assertions', () => {
  assert.equal(2 + 2, 4)
})

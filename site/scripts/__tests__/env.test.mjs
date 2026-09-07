import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvironment, SITE_DIR } from '../lib/env.mjs';

function tempEnvFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-env-'));
  const file = path.join(dir, '.env.local');
  fs.writeFileSync(file, contents);
  return file;
}

test('SITE_DIR points at the site directory', () => {
  assert.ok(fs.existsSync(path.join(SITE_DIR, 'package.json')));
});

test('loadEnvironment fills missing keys, strips quotes, skips comments and blanks', () => {
  const file = tempEnvFile('# comment\n\nA=1\nB="two"\nC=\'three\'\nNOEQUALS\n=nokey\n');
  const env = loadEnvironment({ envFile: file, env: {} });
  assert.deepEqual(env, { A: '1', B: 'two', C: 'three' });
});

test('loadEnvironment never overrides an existing value', () => {
  const file = tempEnvFile('A=file\n');
  const env = loadEnvironment({ envFile: file, env: { A: 'shell' } });
  assert.equal(env.A, 'shell');
});

test('loadEnvironment is a no-op when the file is missing', () => {
  const env = loadEnvironment({ envFile: path.join(os.tmpdir(), 'does-not-exist.env'), env: { X: '1' } });
  assert.deepEqual(env, { X: '1' });
});

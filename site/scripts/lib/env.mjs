import fs from 'node:fs';
import path from 'node:path';

export const SITE_DIR = path.resolve(import.meta.dirname, '..', '..');

export function loadEnvironment({ envFile = path.join(SITE_DIR, '.env.local'), env = process.env } = {}) {
  if (!fs.existsSync(envFile)) return env;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!env[key]) env[key] = value;
  }
  return env;
}

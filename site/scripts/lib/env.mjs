import fs from 'node:fs'
import path from 'node:path'

export const SITE_DIR = path.resolve(import.meta.dirname, '..', '..')

function required(env, names) {
  const values = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, env[name]?.trim()]))
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => names[key])
  if (missing.length) throw new Error(`Missing PocketBase configuration: ${missing.join(', ')}`)
  return values
}

export function getPocketBaseConfig(env = process.env, role = 'sync') {
  if (!['sync', 'migration'].includes(role)) throw new Error(`Unknown PocketBase client role: ${role}`)
  const names = role === 'sync' ? {
    url: 'POCKETBASE_URL',
    identity: 'POCKETBASE_SYNC_EMAIL',
    password: 'POCKETBASE_SYNC_PASSWORD',
  } : {
    url: 'POCKETBASE_URL',
    identity: 'POCKETBASE_MIGRATION_EMAIL',
    password: 'POCKETBASE_MIGRATION_PASSWORD',
  }
  const values = required(env, names)
  let parsed
  try {
    parsed = new URL(values.url)
  } catch {
    throw new Error('POCKETBASE_URL must be an absolute HTTP(S) URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('POCKETBASE_URL must use HTTP(S)')
  return {
    url: values.url.replace(/\/+$/, ''),
    authCollection: role === 'sync'
      ? env.POCKETBASE_AUTH_COLLECTION?.trim() || 'cms_sync'
      : env.POCKETBASE_MIGRATION_AUTH_COLLECTION?.trim() || '_superusers',
    identity: values.identity,
    password: values.password,
    role,
  }
}

// Reads site/.env.local into env without overriding keys that are already set.
export function loadEnvironment({ envFile = path.join(SITE_DIR, '.env.local'), env = process.env } = {}) {
  if (!fs.existsSync(envFile)) return env
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!env[key]) env[key] = value
  }
  return env
}

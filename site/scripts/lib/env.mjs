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

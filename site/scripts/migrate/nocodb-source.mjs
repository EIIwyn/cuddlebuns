import { createHash } from 'node:crypto'

const TABLES = {
  gallery: {
    artists: 'NOCODB_ARTISTS_TABLE_ID',
    collections: 'NOCODB_COLLECTIONS_TABLE_ID',
    characters: 'NOCODB_CHARACTERS_TABLE_ID',
    versions: 'NOCODB_VERSIONS_TABLE_ID',
    commissions: 'NOCODB_COMMISSIONS_TABLE_ID',
  },
  uma: {
    scenarios: 'UMA_NOCODB_SCENARIOS_TABLE_ID',
    events: 'UMA_NOCODB_PVP_EVENTS_TABLE_ID',
    supportCards: 'UMA_NOCODB_SUPPORT_CARDS_TABLE_ID',
  },
}

function required(env, name) {
  const result = env[name]?.trim()
  if (!result || result.startsWith('YOUR_')) throw new Error(`Missing NocoDB configuration: ${name}`)
  return result
}

export function getNocoDbMigrationConfig(env = process.env) {
  const config = {}
  for (const scope of Object.keys(TABLES)) {
    const prefix = scope === 'gallery' ? 'NOCODB' : 'UMA_NOCODB'
    config[scope] = {
      url: required(env, `${prefix}_URL`).replace(/\/+$/, ''),
      token: required(env, `${prefix}_TOKEN`),
      baseId: required(env, `${prefix}_BASE_ID`),
      tables: Object.fromEntries(Object.entries(TABLES[scope])
        .map(([key, name]) => [key, required(env, name)])),
    }
  }
  return config
}

export async function fetchNocoDbTable(config, tableId, fetchImpl = globalThis.fetch) {
  const records = []
  let next = `${config.url}/api/v3/data/${encodeURIComponent(config.baseId)}/` +
    `${encodeURIComponent(tableId)}/records?pageSize=100&linksAsLtar=true`
  while (next) {
    const returned = new URL(next, `${config.url}/`)
    const url = new URL(`${returned.pathname}${returned.search}`, `${config.url}/`)
    const response = await fetchImpl(url, {
      headers: { 'xc-token': config.token },
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error(`NocoDB metadata request failed with status ${response.status}`)
    const page = await response.json()
    records.push(...(page.records ?? []))
    next = page.next ?? null
  }
  return records
}

export async function fetchNocoDbSources(config, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const result = { gallery: {}, uma: {} }
  for (const scope of Object.keys(TABLES)) {
    for (const key of Object.keys(TABLES[scope])) {
      result[scope][key] = await fetchNocoDbTable(config[scope], config[scope].tables[key], fetchImpl)
    }
  }
  return result
}

function fingerprintValue(input) {
  if (Array.isArray(input)) return input.map(fingerprintValue)
  if (input && typeof input === 'object') {
    return Object.fromEntries(Object.keys(input).filter((key) => key !== 'signedPath').sort()
      .map((key) => [key, fingerprintValue(input[key])]))
  }
  return input
}

export function sourceFingerprint(sources) {
  const ordered = Object.fromEntries(Object.entries(sources).map(([scope, tables]) => [
    scope,
    Object.fromEntries(Object.entries(tables).map(([table, records]) => [
      table,
      [...records].sort((left, right) => String(left.id).localeCompare(String(right.id), undefined, { numeric: true })),
    ])),
  ]))
  return createHash('sha256').update(JSON.stringify(fingerprintValue(ordered))).digest('hex')
}

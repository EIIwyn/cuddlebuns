import crypto from 'node:crypto'
import path from 'node:path'

const SOURCES = new Set(['nocodb', 'pocketbase'])

function normalizeSource(value, origin) {
  const source = String(value ?? '').trim().toLowerCase()
  if (!source) throw new Error(`${origin} requires a value`)
  if (!SOURCES.has(source)) throw new Error(`Unknown CMS source: ${value}`)
  return source
}

export function selectSource(argv = [], env = process.env) {
  const cliSources = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--source') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--source requires a value')
      cliSources.push(normalizeSource(value, '--source'))
      index += 1
    } else if (argument.startsWith('--source=')) {
      cliSources.push(normalizeSource(argument.slice('--source='.length), '--source'))
    }
  }
  if (new Set(cliSources).size > 1) throw new Error('Conflicting --source values')
  if (cliSources.length) return cliSources[0]
  if (env.CMS_SOURCE != null && String(env.CMS_SOURCE).trim()) {
    return normalizeSource(env.CMS_SOURCE, 'CMS_SOURCE')
  }
  return 'nocodb'
}

export function assertSourceAvailable(source, availableSources) {
  if (!availableSources.includes(source)) {
    throw new Error(`CMS source ${source} is selected but its adapter is not configured`)
  }
  return source
}

export function manifestPath(area, source, siteDir) {
  return path.join(siteDir, '.cache', area, source, 'manifest.json')
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  }
  return value
}

export function scopedFingerprint(source, value) {
  return crypto.createHash('sha256').update(`${source}\0${JSON.stringify(stable(value))}`).digest('hex')
}

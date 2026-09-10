import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { getNocoDbMigrationConfig, fetchNocoDbTable } from './nocodb-source.mjs'

const SITE_DIR = path.resolve(import.meta.dirname, '../..')

async function loadEnvironment(file = path.join(SITE_DIR, '.env.local')) {
  try {
    const source = await readFile(file, 'utf8')
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator < 1) continue
      const key = trimmed.slice(0, separator).trim()
      let value = trimmed.slice(separator + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      if (!process.env[key]) process.env[key] = value
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function valueType(value) {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

export function summarizeArtistInventory(records) {
  const fields = new Map()
  const attachmentRecords = new Map()
  for (const record of records) {
    for (const [name, value] of Object.entries(record.fields ?? {})) {
      const entry = fields.get(name) ?? { present: 0, types: new Set(), maxArrayLength: 0 }
      entry.present += 1
      entry.types.add(valueType(value))
      if (Array.isArray(value)) entry.maxArrayLength = Math.max(entry.maxArrayLength, value.length)
      fields.set(name, entry)
      if (Array.isArray(value) && value.length && value.every((item) => item && typeof item === 'object' &&
        ('title' in item || 'mimetype' in item || 'size' in item))) {
        const existing = attachmentRecords.get(name) ?? []
        attachmentRecords.set(name, [...existing, ...value])
      }
    }
  }

  return {
    records: records.length,
    fields: Object.fromEntries([...fields.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entry]) => [name, {
        present: entry.present,
        types: [...entry.types].sort(),
        ...(entry.maxArrayLength ? { maxArrayLength: entry.maxArrayLength } : {}),
      }])),
    attachments: Object.fromEntries([...attachmentRecords.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([field, values]) => [field, {
        count: values.length,
        formats: [...new Set(values.map((item) => item.mimetype).filter(Boolean))].sort(),
        maxBytes: Math.max(...values.map((item) => Number(item.size) || 0)),
      }])),
  }
}

export async function main() {
  await loadEnvironment()
  const config = getNocoDbMigrationConfig()
  const records = await fetchNocoDbTable(config.gallery, config.gallery.tables.artists)
  console.log(JSON.stringify(summarizeArtistInventory(records), null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(`Artist inventory failed: ${error.message}`)
    process.exitCode = 1
  })
}
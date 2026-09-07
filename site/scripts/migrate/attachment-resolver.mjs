import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { detectImageFormat } from './migration-core.mjs'

const EXTENSIONS = ['avif', 'gif', 'jpg', 'png', 'webp']

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function descriptorKey({ collection, legacyId, field, ordinal }) {
  return `${collection}:${legacyId}:${field}:${ordinal}`
}

function safeFilename(input, format) {
  const basename = path.basename(String(input || 'attachment')).replace(/[^a-zA-Z0-9._ -]/g, '_')
  const stem = basename.replace(/\.[^.]*$/, '') || 'attachment'
  return `${stem}.${format}`
}

function scopeFor(collection) {
  return collection.startsWith('uma_') ? 'uma' : 'gallery'
}

export function createAttachmentResolver(options) {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const inventory = new Map((options.inventories ?? []).flatMap(({ entries = [] }) => entries)
    .map((entry) => [entry.key, entry]))
  const resolved = new Map()

  async function cacheHit(entry) {
    if (!entry?.sha256 || !entry.detectedFormat) return null
    const expectedFile = path.join(options.cacheDir, `${entry.sha256}.${entry.detectedFormat}`)
    try {
      return { bytes: await readFile(expectedFile), file: expectedFile }
    } catch {
      for (const extension of EXTENSIONS) {
        if (extension === entry.detectedFormat) continue
        try {
          const file = path.join(options.cacheDir, `${entry.sha256}.${extension}`)
          return { bytes: await readFile(file), file }
        } catch { /* continue */ }
      }
      return null
    }
  }

  async function resolve(descriptor) {
    const key = descriptorKey(descriptor)
    if (resolved.has(key)) return resolved.get(key)
    const promise = (async () => {
      let entry = inventory.get(key)
      const attachmentId = descriptor.attachment?.id == null ? null : String(descriptor.attachment.id)
      const metadataSize = Number(descriptor.attachment?.size)
      const inventoryMatches = entry &&
        (entry.attachmentId == null || String(entry.attachmentId) === attachmentId) &&
        (entry.filename == null || entry.filename === descriptor.attachment?.title) &&
        (entry.metadataSize == null || Number(entry.metadataSize) === metadataSize)
      if (!inventoryMatches) entry = null

      let cached = await cacheHit(entry)
      if (!cached) {
        const signedPath = descriptor.attachment?.signedPath
        if (!signedPath) throw new Error(`${key} has no downloadable attachment path`)
        const baseUrl = options.sourceUrls?.[scopeFor(descriptor.collection)]
        if (!baseUrl) throw new Error(`${key} has no configured source URL`)
        const response = await fetchImpl(new URL(signedPath, `${baseUrl}/`).href, {
          signal: AbortSignal.timeout(600_000),
        })
        if (!response.ok) throw new Error(`${key} attachment request failed with status ${response.status}`)
        const bytes = Buffer.from(await response.arrayBuffer())
        const format = detectImageFormat(bytes)
        if (!format) throw new Error(`${key} has unsupported image bytes`)
        const digest = sha256(bytes)
        await mkdir(options.cacheDir, { recursive: true })
        const file = path.join(options.cacheDir, `${digest}.${format}`)
        const temporary = `${file}.${process.pid}.tmp`
        await writeFile(temporary, bytes, { flag: 'wx' })
        await rename(temporary, file).catch(async (error) => {
          if (!['EEXIST', 'EPERM'].includes(error.code)) throw error
          await rm(temporary, { force: true })
        })
        cached = { bytes, file }
      }

      const bytes = Buffer.from(cached.bytes)
      const digest = sha256(bytes)
      const format = detectImageFormat(bytes)
      if (!format) throw new Error(`${key} has unsupported image bytes`)
      if (entry?.sha256 && entry.sha256 !== digest) throw new Error(`${key} cached attachment hash mismatch`)
      if (entry?.actualSize != null && Number(entry.actualSize) !== bytes.length) {
        throw new Error(`${key} cached attachment size mismatch`)
      }
      if (Number.isFinite(metadataSize) && metadataSize > 0 && metadataSize !== bytes.length) {
        throw new Error(`${key} NocoDB attachment size mismatch`)
      }
      return {
        field: descriptor.field,
        ordinal: descriptor.ordinal,
        filename: safeFilename(descriptor.attachment?.title, format),
        size: bytes.length,
        detectedFormat: format,
        sha256: digest,
        read: async () => readFile(cached.file),
      }
    })()
    resolved.set(key, promise)
    return promise
  }

  return resolve
}

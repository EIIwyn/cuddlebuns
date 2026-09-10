import path from 'node:path'

const COLLECTIONS = ['artists', 'collections', 'characters', 'versions', 'commissions']

function ordered(records) {
  return [...records].sort((left, right) => Number(left.legacy_id) - Number(right.legacy_id))
}

function legacyMap(records, collection) {
  return new Map(records.map((record) => {
    const legacyId = Number(record.legacy_id)
    if (!Number.isInteger(legacyId) || legacyId < 1) {
      throw new Error(`${collection} record ${record.id} has invalid legacy_id`)
    }
    return [record.id, legacyId]
  }))
}

function relations(input, mapping, label) {
  const ids = Array.isArray(input) ? input : input ? [input] : []
  return ids.map((id) => {
    const legacyId = mapping.get(id)
    if (!legacyId) throw new Error(`${label} references unknown PocketBase record ${id}`)
    return { id: legacyId }
  })
}

function mimeType(filename) {
  return {
    '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  }[path.extname(filename).toLowerCase()] ?? 'application/octet-stream'
}

function attachments(client, collection, record, field) {
  const filenames = Array.isArray(record[field]) ? record[field] : record[field] ? [record[field]] : []
  return filenames.map((filename) => ({
    id: filename,
    path: `${record.updated ?? ''}/${filename}`,
    title: filename,
    mimetype: mimeType(filename),
    size: null,
    read: () => client.downloadFile(collection, record, filename),
  }))
}

export async function loadPocketBaseGallerySource(client) {
  const tables = Object.fromEntries(await Promise.all(COLLECTIONS.map(async (collection) => [
    collection,
    ordered(await client.listAll(collection)),
  ])))
  const mappings = Object.fromEntries(COLLECTIONS.map((collection) => [
    collection,
    legacyMap(tables[collection], collection),
  ]))

  return {
    artists: tables.artists.map((record) => ({
      id: record.legacy_id,
      fields: {
        'Artist Name': record.name, URL: record.url,
        'Commission Subject': record.commission_subject,
        'Date Added': record.date_added, Notes: record.notes,
        'Price (JPY)': record.price_jpy, 'Price (USD)': record.price_usd,
        'Price Bracket': record.price_bracket, Status: record.status,
        Example: attachments(client, 'artists', record, 'example'),
      },
    })),
    collections: tables.collections.map((record) => ({
      id: record.legacy_id,
      fields: {
        Name: record.name, Slug: record.slug, 'Display Order': record.display_order,
        Visible: record.visible, Collapsible: record.collapsible,
        Characters: tables.characters.filter(({ collection }) => collection === record.id)
          .map(({ legacy_id: id }) => ({ id })),
      },
    })),
    characters: tables.characters.map((record) => ({
      id: record.legacy_id,
      fields: {
        Name: record.name,
        Slug: record.slug,
        Subtitle: record.subtitle,
        'Accent Color': record.accent_color,
        'Card Thumbnail': attachments(client, 'characters', record, 'card_thumbnail'),
        'Display Order': record.display_order,
        Visible: record.visible,
        Collections: relations(record.collection, mappings.collections, `characters:${record.legacy_id}.collection`),
        Versions: tables.versions.filter(({ character }) => character === record.id)
          .map(({ legacy_id: id }) => ({ id })),
        'Social 1 Label': record.social_label,
        'Social 1 URL': record.social_url,
      },
    })),
    versions: tables.versions.map((record) => ({
      id: record.legacy_id,
      fields: {
        Name: record.name,
        Slug: record.slug,
        'Reference Sheet': attachments(client, 'versions', record, 'reference_sheet'),
        'Display Order': record.display_order,
        Visible: record.visible,
        Character: relations(record.character, mappings.characters, `versions:${record.legacy_id}.character`),
        Commissions: tables.commissions.filter(({ versions }) => versions.includes(record.id))
          .map(({ legacy_id: id }) => ({ id })),
      },
    })),
    commissions: tables.commissions.map((record) => ({
      id: record.legacy_id,
      fields: {
        'Internal Title': record.name,
        Type: record.type,
        Image: attachments(client, 'commissions', record, 'image'),
        'Source URL': record.source_url,
        Date: typeof record.date === 'string' ? record.date.slice(0, 10) : record.date,
        Published: record.published,
        'Display Order': record.display_order,
        Versions: relations(record.versions, mappings.versions, `commissions:${record.legacy_id}.versions`),
        Artists: relations(record.artists, mappings.artists, `commissions:${record.legacy_id}.artists`),
      },
    })),
  }
}

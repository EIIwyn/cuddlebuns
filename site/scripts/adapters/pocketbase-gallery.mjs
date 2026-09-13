import path from 'node:path'

const COLLECTIONS = ['artists', 'collections', 'characters', 'versions', 'commissions']

function ordered(records) {
  return [...records].sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

function relations(input, label) {
  const ids = relationRecordIds(input)
  return ids.map((id) => {
    if (!id) throw new Error(`${label} contains an invalid PocketBase relation`)
    return { id }
  })
}

function relationRecordIds(input) {
  const ids = Array.isArray(input) ? input : input ? [input] : []
  return ids.map((value) => {
    if (value == null) return null
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    return value.id != null ? String(value.id) : null
  }).filter(Boolean)
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
  return {
    artists: tables.artists.map((record) => ({
      id: record.id,
      fields: {
        'Artist Name': record.artist_name ?? record.name, URL: record.url,
        'Commission Subject': record.commission_subject,
        'Date Added': record.date_added, Notes: record.notes,
        'Price (JPY)': record.price_jpy, 'Price (USD)': record.price_usd,
        'Price Bracket': record.price_bracket, Status: record.status,
        Example: attachments(client, 'artists', record, 'example'),
      },
    })),
    collections: tables.collections.map((record) => ({
      id: record.id,
      fields: {
        Name: record.name, Slug: record.slug, 'Display Order': record.display_order,
        Visible: record.visible, Collapsible: record.collapsible,
        Characters: tables.characters.filter(({ collection }) => relationRecordIds(collection).includes(String(record.id)))
          .map(({ id }) => ({ id })),
      },
    })),
    characters: tables.characters.map((record) => ({
      id: record.id,
      fields: {
        Name: record.name,
        Slug: record.slug,
        Subtitle: record.subtitle,
        'Accent Color': record.accent_color,
        'Card Thumbnail': attachments(client, 'characters', record, 'card_thumbnail'),
        'Display Order': record.display_order,
        Visible: record.visible,
        Collections: relations(record.collection, `characters:${record.id}.collection`),
        Versions: tables.versions.filter(({ character }) => relationRecordIds(character).includes(String(record.id)))
          .map(({ id }) => ({ id })),
        'Social 1 Label': record.social_label,
        'Social 1 URL': record.social_url,
      },
    })),
    versions: tables.versions.map((record) => ({
      id: record.id,
      fields: {
        Name: record.name,
        Slug: record.slug,
        'Reference Sheet': attachments(client, 'versions', record, 'reference_sheet'),
        'Display Order': record.display_order,
        Visible: record.visible,
        Character: relations(record.character, `versions:${record.id}.character`),
        Commissions: tables.commissions.filter(({ versions }) => relationRecordIds(versions).includes(String(record.id)))
          .map(({ id }) => ({ id })),
      },
    })),
    commissions: tables.commissions.map((record) => ({
      id: record.id,
      fields: {
        'Internal Title': record.name,
        Type: record.type,
        Image: attachments(client, 'commissions', record, 'image'),
        'Source URL': record.source_url,
        Date: typeof record.date === 'string' ? record.date.slice(0, 10) : record.date,
        Published: record.published,
        'Display Order': record.display_order,
        Versions: relations(record.versions, `commissions:${record.id}.versions`),
        Artists: relations(record.artists, `commissions:${record.id}.artists`),
      },
    })),
  }
}

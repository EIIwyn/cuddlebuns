import path from 'node:path'

const COLLECTIONS = ['uma_scenarios', 'uma_pvp_events', 'uma_support_cards']

function ordered(records) {
  return [...records].sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

function relationIds(input) {
  const ids = Array.isArray(input) ? input : input ? [input] : []
  return ids.map((value) => typeof value === 'object' && value !== null ? value.id : value)
    .filter((id) => id != null && id !== '')
    .map((id) => ({ id: String(id) }))
}

function mimeType(filename) {
  return {
    '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  }[path.extname(filename).toLowerCase()] ?? 'application/octet-stream'
}

function image(client, record) {
  if (!record.image) return []
  return [{
    id: record.image,
    path: `${record.updated ?? ''}/${record.image}`,
    title: record.image,
    mimetype: mimeType(record.image),
    size: null,
    read: () => client.downloadFile('uma_support_cards', record, record.image),
  }]
}

export async function loadPocketBaseUmaSource(client) {
  const tables = Object.fromEntries(await Promise.all(COLLECTIONS.map(async (collection) => [
    collection,
    ordered(await client.listAll(collection)),
  ])))
  return {
    scenarios: tables.uma_scenarios.map((record) => ({
      id: record.id,
      fields: {
        name: record.name, short_name: record.short_name, slug: record.slug,
        era_start: record.era_start, era_end: record.era_end, display_color: record.display_color,
        gametora_id: record.gametora_id,
      },
    })),
    events: tables.uma_pvp_events.map((record) => ({
      id: record.id,
      fields: {
        name: record.name,
        event_number: record.event_number,
        slug: record.slug,
        event_type: record.event_type,
        start_date: record.start_date,
        end_date: record.end_date,
        scenario: relationIds(record.scenario),
        distance_class: record.distance_class,
        distance_m: record.distance_m,
        racecourse: record.racecourse,
        direction: record.direction,
        track_condition: record.track_condition,
        season: record.season,
        weather: record.weather,
        surface: record.surface,
        status: record.status,
        gametora_id: record.gametora_id,
      },
    })),
    supportCards: tables.uma_support_cards.map((record) => ({
      id: record.id,
      fields: {
        name: record.name,
        character_name: record.character_name,
        slug: record.slug,
        image: image(client, record),
        card_type: record.card_type,
        rating: record.rating,
        release_date: record.release_date,
        styles: record.styles,
        breakpoints: record.breakpoints,
        pvp_events: relationIds(record.pvp_events),
        gametora_id: record.gametora_id,
        rarity: record.rarity,
        title: record.title,
      },
    })),
  }
}

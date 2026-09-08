import path from 'node:path'

const COLLECTIONS = ['uma_scenarios', 'uma_pvp_events', 'uma_support_cards']

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
  const scenarioMap = legacyMap(tables.uma_scenarios, 'uma_scenarios')
  const eventMap = legacyMap(tables.uma_pvp_events, 'uma_pvp_events')
  legacyMap(tables.uma_support_cards, 'uma_support_cards')

  return {
    scenarios: tables.uma_scenarios.map((record) => ({
      id: record.legacy_id,
      fields: {
        name: record.name, short_name: record.short_name, slug: record.slug,
        era_start: record.era_start, era_end: record.era_end, display_color: record.display_color,
      },
    })),
    events: tables.uma_pvp_events.map((record) => ({
      id: record.legacy_id,
      fields: {
        name: record.name,
        event_number: record.event_number,
        slug: record.slug,
        event_type: record.event_type,
        start_date: record.start_date,
        end_date: record.end_date,
        scenario: relations(record.scenario, scenarioMap, `uma_pvp_events:${record.legacy_id}.scenario`),
        distance_class: record.distance_class,
        distance_m: record.distance_m,
        racecourse: record.racecourse,
        direction: record.direction,
        track_condition: record.track_condition,
        season: record.season,
        weather: record.weather,
        surface: record.surface,
        status: record.status,
      },
    })),
    supportCards: tables.uma_support_cards.map((record) => ({
      id: record.legacy_id,
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
        pvp_events: relations(record.pvp_events, eventMap, `uma_support_cards:${record.legacy_id}.pvp_events`),
      },
    })),
  }
}

function value(fields, ...names) {
  for (const name of names) if (fields?.[name] != null) return fields[name]
  return null
}

function text(input) {
  return typeof input === 'string' ? input.trim() : input == null ? '' : String(input)
}

function number(input) {
  const result = Number(input)
  return Number.isFinite(result) ? result : 0
}

function date(input) {
  const result = typeof input === 'string' ? input.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? `${result} 00:00:00.000Z` : ''
}

function status(input) {
  const normalized = text(input).toLowerCase()
  return ['confirmed', 'projected'].includes(normalized) ? normalized : 'unspecified'
}

function slugify(input, fallback) {
  const slug = String(input ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function legacyId(record) {
  const id = Number(record?.id)
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`NocoDB record requires a positive numeric ID; received ${record?.id}`)
  }
  return id
}

function relationIds(input) {
  const values = Array.isArray(input) ? input : input == null ? [] : [input]
  return values.map((item) => {
    const raw = typeof item === 'object' ? item?.id ?? item?.id_fields?.Id : item
    const id = Number(raw)
    if (!Number.isInteger(id) || id < 1) throw new Error(`Relation requires a positive numeric ID; received ${raw}`)
    return id
  })
}

function multiText(input) {
  const values = Array.isArray(input) ? input : input == null ? [] : [input]
  return values.map((item) => text(typeof item === 'object'
    ? item?.title ?? item?.value ?? item?.name
    : item)).filter(Boolean)
}

async function filesFor(record, collection, field, sourceFields, resolveAttachment) {
  const attachments = value(record.fields, ...sourceFields)
  if (!Array.isArray(attachments)) return []
  return Promise.all(attachments.map((attachment, ordinal) => resolveAttachment({
    collection,
    legacyId: legacyId(record),
    field,
    ordinal,
    attachment,
  })))
}

function migrationRecord(collection, record, fields, relations = {}, files = []) {
  return { collection, legacyId: legacyId(record), fields, relations, files }
}

function sorted(records) {
  return [...records].sort((left, right) => legacyId(left) - legacyId(right))
}

export async function transformNocoDbSources(sources, options) {
  const { resolveAttachment } = options
  if (typeof resolveAttachment !== 'function') throw new Error('resolveAttachment is required')
  const gallery = sources.gallery ?? {}
  const uma = sources.uma ?? {}
  const records = []

  for (const record of sorted(gallery.artists ?? [])) {
    const fields = record.fields ?? {}
    records.push(migrationRecord('artists', record, {
      name: text(value(fields, 'Artist Name')),
      url: text(value(fields, 'URL')),
    }))
  }

  for (const record of sorted(gallery.collections ?? [])) {
    const fields = record.fields ?? {}
    records.push(migrationRecord('collections', record, {
      name: text(value(fields, 'Name')),
      slug: slugify(value(fields, 'Slug', 'Name'), `collection-${legacyId(record)}`),
      display_order: number(value(fields, 'Display Order')),
      visible: value(fields, 'Visible') === true,
      collapsible: value(fields, 'Collapsible') === true,
    }))
  }

  for (const record of sorted(gallery.characters ?? [])) {
    const fields = record.fields ?? {}
    records.push(migrationRecord('characters', record, {
      name: text(value(fields, 'Name')),
      slug: slugify(value(fields, 'Slug', 'Name'), `character-${legacyId(record)}`),
      subtitle: text(value(fields, 'Subtitle')),
      accent_color: text(value(fields, 'Accent Color')),
      display_order: number(value(fields, 'Display Order')),
      visible: value(fields, 'Visible') === true,
      social_label: text(value(fields, 'Social 1 Label')),
      social_url: text(value(fields, 'Social 1 URL')),
    }, {
      collection: { collection: 'collections', legacyIds: relationIds(value(fields, 'Collections')) },
    }, await filesFor(record, 'characters', 'card_thumbnail', ['Card Thumbnail'], resolveAttachment)))
  }

  for (const record of sorted(gallery.versions ?? [])) {
    const fields = record.fields ?? {}
    records.push(migrationRecord('versions', record, {
      name: text(value(fields, 'Name')),
      slug: slugify(value(fields, 'Slug', 'Name'), `version-${legacyId(record)}`),
      display_order: number(value(fields, 'Display Order')),
      visible: value(fields, 'Visible') === true,
    }, {
      character: { collection: 'characters', legacyIds: relationIds(value(fields, 'Character')) },
    }, await filesFor(record, 'versions', 'reference_sheet', ['Reference Sheet'], resolveAttachment)))
  }

  for (const record of sorted(gallery.commissions ?? [])) {
    const fields = record.fields ?? {}
    records.push(migrationRecord('commissions', record, {
      name: text(value(fields, 'Internal Title', 'Title')),
      type: text(value(fields, 'Type')),
      source_url: text(value(fields, 'Source URL')),
      date: date(value(fields, 'Date')),
      published: value(fields, 'Published') === true,
      display_order: number(value(fields, 'Display Order')),
    }, {
      versions: { collection: 'versions', legacyIds: relationIds(value(fields, 'Versions')), many: true },
      artists: { collection: 'artists', legacyIds: relationIds(value(fields, 'Artists')), many: true },
    }, await filesFor(record, 'commissions', 'image', ['Image'], resolveAttachment)))
  }

  for (const record of sorted(uma.scenarios ?? [])) {
    const fields = record.fields ?? {}
    const name = text(value(fields, 'name', 'Name'))
    records.push(migrationRecord('uma_scenarios', record, {
      name,
      short_name: text(value(fields, 'short_name', 'Short Name')),
      slug: slugify(value(fields, 'slug', 'Slug') || name, `scenario-${legacyId(record)}`),
      era_start: date(value(fields, 'era_start', 'Era Start')),
      era_end: date(value(fields, 'era_end', 'Era End')),
      display_color: text(value(fields, 'display_color', 'Display Color')),
    }))
  }

  for (const record of sorted(uma.events ?? [])) {
    const fields = record.fields ?? {}
    const name = text(value(fields, 'name', 'Name'))
    records.push(migrationRecord('uma_pvp_events', record, {
      name,
      event_number: number(value(fields, 'event_number', 'Event Number')),
      slug: slugify(value(fields, 'slug', 'Slug') || name, `pvp-event-${legacyId(record)}`),
      event_type: text(value(fields, 'event_type', 'Event Type')),
      start_date: date(value(fields, 'start_date', 'Start Date')),
      end_date: date(value(fields, 'end_date', 'End Date')),
      distance_class: text(value(fields, 'distance_class', 'Distance Class')),
      distance_m: number(value(fields, 'distance_m', 'Distance M')),
      racecourse: text(value(fields, 'racecourse', 'Racecourse')),
      direction: text(value(fields, 'direction', 'Direction')),
      track_condition: text(value(fields, 'track_condition', 'Track Condition')),
      season: text(value(fields, 'season', 'Season')),
      weather: text(value(fields, 'weather', 'Weather')),
      surface: text(value(fields, 'surface', 'Surface')),
      status: status(value(fields, 'status', 'Status', 'confirmed_projected_status', 'Confirmed/Projected Status')),
    }, {
      scenario: { collection: 'uma_scenarios', legacyIds: relationIds(value(fields, 'scenario', 'Scenario')) },
    }))
  }

  for (const record of sorted(uma.supportCards ?? [])) {
    const fields = record.fields ?? {}
    const name = text(value(fields, 'name', 'Name'))
    const characterName = text(value(fields, 'character_name', 'Character Name'))
    records.push(migrationRecord('uma_support_cards', record, {
      name: name || characterName || 'Untitled support card',
      character_name: characterName,
      slug: slugify(value(fields, 'slug', 'Slug') || name || characterName,
        `support-card-${legacyId(record)}`),
      card_type: text(value(fields, 'card_type', 'Card Type')),
      rating: text(value(fields, 'rating', 'Rating')),
      release_date: date(value(fields, 'release_date', 'Release Date')),
      styles: multiText(value(fields, 'styles', 'Styles')),
      breakpoints: multiText(value(fields, 'breakpoints', 'Breakpoints')),
    }, {
      pvp_events: {
        collection: 'uma_pvp_events',
        legacyIds: relationIds(value(fields, 'pvp_events', 'PvP Events')),
        many: true,
      },
    }, await filesFor(record, 'uma_support_cards', 'image', ['image', 'Image'], resolveAttachment)))
  }

  return records
}

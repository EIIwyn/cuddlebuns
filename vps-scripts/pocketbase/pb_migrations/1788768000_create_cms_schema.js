migrate((app) => {
  const readRule = '@request.auth.collectionName = "cms_sync"'
  const imageMimeTypes = ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']

  const legacyIdField = () => ({
    name: 'legacy_id',
    type: 'number',
    required: true,
    min: 1,
    onlyInt: true,
  })

  const contentCollection = (name, fields) => new Collection({
    type: 'base',
    name,
    listRule: readRule,
    viewRule: readRule,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [legacyIdField(), ...fields],
    indexes: [`CREATE UNIQUE INDEX idx_${name}_legacy_id ON ${name} (legacy_id)`],
  })

  const relationField = (name, collectionId, maxSelect = 1) => ({
    name,
    type: 'relation',
    collectionId,
    maxSelect,
    cascadeDelete: false,
  })

  const fileField = (name, maxSelect, maxSize) => ({
    name,
    type: 'file',
    maxSelect,
    maxSize,
    mimeTypes: imageMimeTypes,
    protected: true,
  })

  app.save(new Collection({
    type: 'auth',
    name: 'cms_sync',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    manageRule: null,
    authRule: '',
    fields: [],
    passwordAuth: {
      enabled: true,
      identityFields: ['email'],
    },
    oauth2: { enabled: false },
    otp: { enabled: false },
    mfa: { enabled: false },
  }))

  app.save(contentCollection('artists', [
    { name: 'name', type: 'text' },
    { name: 'url', type: 'url' },
  ]))

  app.save(contentCollection('collections', [
    { name: 'name', type: 'text' },
    { name: 'slug', type: 'text' },
    { name: 'display_order', type: 'number' },
    { name: 'visible', type: 'bool' },
    { name: 'collapsible', type: 'bool' },
  ]))

  const artists = app.findCollectionByNameOrId('artists')
  const collections = app.findCollectionByNameOrId('collections')

  app.save(contentCollection('characters', [
    { name: 'name', type: 'text' },
    { name: 'slug', type: 'text' },
    { name: 'subtitle', type: 'text' },
    { name: 'accent_color', type: 'text' },
    fileField('card_thumbnail', 1, 2 * 1024 * 1024),
    { name: 'display_order', type: 'number' },
    { name: 'visible', type: 'bool' },
    relationField('collection', collections.id),
    { name: 'social_label', type: 'text' },
    { name: 'social_url', type: 'url' },
  ]))

  const characters = app.findCollectionByNameOrId('characters')

  app.save(contentCollection('versions', [
    { name: 'name', type: 'text' },
    { name: 'slug', type: 'text' },
    fileField('reference_sheet', 6, 24 * 1024 * 1024),
    { name: 'display_order', type: 'number' },
    { name: 'visible', type: 'bool' },
    relationField('character', characters.id),
  ]))

  const versions = app.findCollectionByNameOrId('versions')

  app.save(contentCollection('commissions', [
    { name: 'name', type: 'text' },
    { name: 'type', type: 'text' },
    fileField('image', 5, 18 * 1024 * 1024),
    { name: 'source_url', type: 'url' },
    { name: 'date', type: 'date' },
    { name: 'published', type: 'bool' },
    { name: 'display_order', type: 'number' },
    relationField('versions', versions.id, 999),
    relationField('artists', artists.id, 999),
  ]))

  app.save(contentCollection('uma_scenarios', [
    { name: 'name', type: 'text' },
    { name: 'short_name', type: 'text' },
    { name: 'slug', type: 'text' },
    { name: 'era_start', type: 'date' },
    { name: 'era_end', type: 'date' },
    { name: 'display_color', type: 'text' },
  ]))

  const scenarios = app.findCollectionByNameOrId('uma_scenarios')

  app.save(contentCollection('uma_pvp_events', [
    { name: 'name', type: 'text' },
    { name: 'event_number', type: 'number' },
    { name: 'slug', type: 'text' },
    { name: 'event_type', type: 'text' },
    { name: 'start_date', type: 'date' },
    { name: 'end_date', type: 'date' },
    relationField('scenario', scenarios.id),
    { name: 'distance_class', type: 'text' },
    { name: 'distance_m', type: 'number' },
    { name: 'racecourse', type: 'text' },
    { name: 'direction', type: 'text' },
    { name: 'track_condition', type: 'text' },
    { name: 'season', type: 'text' },
    { name: 'weather', type: 'text' },
    { name: 'surface', type: 'text' },
    { name: 'status', type: 'text' },
  ]))

  const pvpEvents = app.findCollectionByNameOrId('uma_pvp_events')

  app.save(contentCollection('uma_support_cards', [
    { name: 'name', type: 'text' },
    { name: 'character_name', type: 'text' },
    { name: 'slug', type: 'text' },
    fileField('image', 1, 2 * 1024 * 1024),
    { name: 'card_type', type: 'text' },
    { name: 'rating', type: 'text' },
    { name: 'release_date', type: 'date' },
    { name: 'styles', type: 'json' },
    { name: 'breakpoints', type: 'json' },
    relationField('pvp_events', pvpEvents.id, 999),
  ]))
}, (app) => {
  const collectionNames = [
    'uma_support_cards',
    'uma_pvp_events',
    'uma_scenarios',
    'commissions',
    'versions',
    'characters',
    'collections',
    'artists',
    'cms_sync',
  ]

  for (const name of collectionNames) {
    app.delete(app.findCollectionByNameOrId(name))
  }
})

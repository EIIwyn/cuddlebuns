migrate((app) => {
  const artists = app.findCollectionByNameOrId('artists')
  artists.fields.addMarshaledJSON(JSON.stringify([
    { name: 'commission_subject', type: 'json' },
    { name: 'date_added', type: 'date' },
    { name: 'notes', type: 'text' },
    { name: 'price_jpy', type: 'number' },
    { name: 'price_usd', type: 'number' },
    { name: 'price_bracket', type: 'text' },
    { name: 'status', type: 'text' },
    {
      name: 'example',
      type: 'file',
      maxSelect: 2,
      maxSize: 16 * 1024 * 1024,
      mimeTypes: ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'],
      protected: true,
    },
  ]))
  app.save(artists)
}, (app) => {
  const artists = app.findCollectionByNameOrId('artists')
  const removed = new Set([
    'commission_subject', 'date_added', 'notes', 'price_jpy', 'price_usd',
    'price_bracket', 'status', 'example',
  ])
  artists.fields = artists.fields.filter(({ name }) => !removed.has(name))
  app.save(artists)
})
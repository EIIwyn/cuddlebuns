migrate((app) => {
  const artists = app.findCollectionByNameOrId('artists')
  const field = artists.fields.find(({ name }) => name === 'name')
  if (field && !artists.fields.some(({ name }) => name === 'artist_name')) field.name = 'artist_name'
  app.save(artists)
}, (app) => {
  const artists = app.findCollectionByNameOrId('artists')
  const field = artists.fields.find(({ name }) => name === 'artist_name')
  if (field && !artists.fields.some(({ name }) => name === 'name')) field.name = 'name'
  app.save(artists)
})

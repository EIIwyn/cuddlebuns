const SELECT_OPTIONS = {
  price_bracket: ['Affordable', 'Balanced', 'Premium', 'Upscale'],
  status: ['Candidate', 'Reserve', 'Worked', 'Assigned'],
}

function changeFieldType(collection, name, type, values) {
  const field = collection.fields.find(({ name: fieldName }) => fieldName === name)
  if (!field) throw new Error(`Missing artists.${name} field`)
  field.type = type
  field.maxSelect = 1
  field.values = values
}

migrate((app) => {
  const artists = app.findCollectionByNameOrId('artists')
  for (const [name, values] of Object.entries(SELECT_OPTIONS)) changeFieldType(artists, name, 'select', values)
  app.save(artists)
}, (app) => {
  const artists = app.findCollectionByNameOrId('artists')
  for (const name of Object.keys(SELECT_OPTIONS)) {
    const field = artists.fields.find(({ name: fieldName }) => fieldName === name)
    if (!field) throw new Error(`Missing artists.${name} field`)
    field.type = 'text'
    delete field.maxSelect
    delete field.values
  }
  app.save(artists)
})

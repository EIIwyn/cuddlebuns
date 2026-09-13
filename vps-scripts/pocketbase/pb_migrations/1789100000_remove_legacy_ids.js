migrate((app) => {
  const collectionNames = [
    'artists', 'collections', 'characters', 'versions', 'commissions',
    'uma_scenarios', 'uma_pvp_events', 'uma_support_cards',
  ]

  for (const name of collectionNames) {
    const collection = app.findCollectionByNameOrId(name)
    collection.fields = collection.fields.filter(({ name: fieldName }) => fieldName !== 'legacy_id')
    collection.indexes = collection.indexes.filter((index) => !/legacy_id/i.test(index))
    app.save(collection)
  }
}, (app) => {
  const collectionNames = [
    'artists', 'collections', 'characters', 'versions', 'commissions',
    'uma_scenarios', 'uma_pvp_events', 'uma_support_cards',
  ]

  for (const name of collectionNames) {
    const collection = app.findCollectionByNameOrId(name)
    collection.fields.addMarshaledJSON(JSON.stringify([{
      name: 'legacy_id', type: 'number', required: true, min: 1, onlyInt: true,
    }]))
    collection.indexes.push(`CREATE UNIQUE INDEX idx_${name}_legacy_id ON ${name} (legacy_id)`)
    app.save(collection)
  }
})

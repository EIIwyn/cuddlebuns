// Mirrors the columns the GameTora importer added to the NocoDB Uma tables.
// lock_facts is PocketBase-owned: when true, the NocoDB -> PocketBase Uma mirror skips the row.
migrate((app) => {
  const importerFields = [
    { name: 'gametora_id', type: 'number', onlyInt: true },
    { name: 'lock_facts', type: 'bool' },
  ]
  const extraFields = {
    uma_scenarios: [],
    uma_pvp_events: [],
    uma_support_cards: [
      { name: 'rarity', type: 'text' },
      { name: 'title', type: 'text' },
    ],
  }
  for (const [name, extra] of Object.entries(extraFields)) {
    const collection = app.findCollectionByNameOrId(name)
    collection.fields.addMarshaledJSON(JSON.stringify([...importerFields, ...extra]))
    app.save(collection)
  }
}, (app) => {
  const removed = new Set(['gametora_id', 'lock_facts', 'rarity', 'title'])
  for (const name of ['uma_support_cards', 'uma_pvp_events', 'uma_scenarios']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.fields = collection.fields.filter((field) => !removed.has(field.name))
    app.save(collection)
  }
})

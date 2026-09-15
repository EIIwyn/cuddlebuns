migrate((app) => {
  const editorRule = '@request.auth.collectionName = "users"'
  // `users` is the existing human-auth collection provisioned in PocketBase.
  // Keep the editor access migration focused on permissions; do not replace
  // or delete the collection and its accounts.
  app.findCollectionByNameOrId('users')

  for (const name of ['artists', 'collections', 'characters', 'versions', 'commissions']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.listRule = `${collection.listRule} || ${editorRule}`
    collection.viewRule = `${collection.viewRule} || ${editorRule}`
    collection.updateRule = editorRule
    app.save(collection)
  }
}, (app) => {
  for (const name of ['artists', 'collections', 'characters', 'versions', 'commissions']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.listRule = '@request.auth.collectionName = "cms_sync"'
    collection.viewRule = '@request.auth.collectionName = "cms_sync"'
    collection.updateRule = null
    app.save(collection)
  }
})

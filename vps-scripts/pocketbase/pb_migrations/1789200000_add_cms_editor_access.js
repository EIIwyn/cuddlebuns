migrate((app) => {
  const editorRule = '@request.auth.collectionName = "cms_editor"'

  app.save(new Collection({
    type: 'auth',
    name: 'cms_editor',
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
  app.delete(app.findCollectionByNameOrId('cms_editor'))
})

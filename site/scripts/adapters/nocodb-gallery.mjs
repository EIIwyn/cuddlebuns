export async function loadGallerySource(config, fetchTable) {
  const collections = await fetchTable(config, config.collections, 'Collections')
  const characters = await fetchTable(config, config.characters, 'Characters')
  const versions = await fetchTable(config, config.versions, 'Versions')
  const commissions = await fetchTable(config, config.commissions, 'Commissions')
  const artists = await fetchTable(config, config.artists, 'Artists')
  return { collections, characters, versions, commissions, artists }
}

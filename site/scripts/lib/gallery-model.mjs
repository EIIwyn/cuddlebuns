function numeric(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER
}

export function compareOrderedRecords(left, right) {
  return numeric(left.order) - numeric(right.order) ||
    String(left.name).localeCompare(String(right.name)) ||
    numeric(left.legacyId ?? left.id) - numeric(right.legacyId ?? right.id)
}

export function compareGalleryItems(left, right) {
  return numeric(left.displayOrder) - numeric(right.displayOrder) ||
    String(right.date ?? '').localeCompare(String(left.date ?? '')) ||
    numeric(left.legacyId ?? left.recordId) - numeric(right.legacyId ?? right.recordId) ||
    numeric(left.attachmentOrdinal) - numeric(right.attachmentOrdinal)
}

export function createGalleryModel(model) {
  model.collections.sort(compareOrderedRecords)
  for (const collection of model.collections) collection.characters.sort(compareOrderedRecords)
  for (const character of model.collections.flatMap(({ characters }) => characters)) {
    character.versions.sort(compareOrderedRecords)
  }
  for (const items of model.galleries.values()) items.sort(compareGalleryItems)
  return model
}

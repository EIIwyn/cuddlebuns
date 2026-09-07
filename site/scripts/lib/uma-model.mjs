function legacyId(record) {
  return Number(record.legacyId ?? record.id)
}

export function createUmaModel(model) {
  model.scenarios.sort((left, right) =>
    left.eraStart.localeCompare(right.eraStart) || left.name.localeCompare(right.name) || legacyId(left) - legacyId(right))
  model.events.sort((left, right) =>
    left.startDate.localeCompare(right.startDate) ||
    (left.eventNumber ?? Infinity) - (right.eventNumber ?? Infinity) ||
    left.name.localeCompare(right.name) || legacyId(left) - legacyId(right))
  model.supportCards.sort((left, right) =>
    String(left.releaseDate ?? '').localeCompare(String(right.releaseDate ?? '')) ||
    left.name.localeCompare(right.name) ||
    String(left.characterName ?? '').localeCompare(String(right.characterName ?? '')) ||
    legacyId(left) - legacyId(right))
  return model
}

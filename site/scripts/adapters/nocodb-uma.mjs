export async function loadUmaSource(config, fetchTable) {
  const scenarios = await fetchTable(config, config.scenarios, 'Scenarios')
  const events = await fetchTable(config, config.events, 'PvP events')
  const supportCards = await fetchTable(config, config.supportCards, 'Support cards')
  return { scenarios, events, supportCards }
}

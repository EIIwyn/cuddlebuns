import { BATCH_SIZE, chunkByBatch } from '../lib/nocodb.mjs';

const COMMON = ['gametora_id', 'lock_facts', 'name', 'slug'];
export const REQUIRED_COLUMNS = {
  scenarios: [...COMMON, 'short_name', 'era_start', 'era_end', 'display_color'],
  pvp_events: [...COMMON, 'event_number', 'event_type', 'start_date', 'end_date', 'distance_class', 'distance_m', 'racecourse', 'direction', 'season', 'track_condition', 'weather', 'surface', 'status'],
  support_cards: [...COMMON, 'character_name', 'card_type', 'rarity', 'title', 'release_date'],
};

// The scenario link must be identified by the table it points at: a duplicated table keeps
// link columns that still point at the original tables under their original titles.
export function resolveScenarioLink({ meta, scenariosTableId }) {
  const links = (meta.columns ?? []).filter((column) => /Link/.test(column.uidt ?? ''));
  const matches = links.filter((column) => column.relatedTableId === scenariosTableId);
  if (matches.length === 1) return { link: { id: matches[0].id, title: matches[0].title }, errors: [] };
  const found = links.length ? links.map((column) => `${column.title} -> ${column.relatedTableId ?? 'unknown'}`).join(', ') : 'none';
  const error = matches.length === 0
    ? `pvp_events: no link column points at the import scenarios table ${scenariosTableId}; found: ${found}.`
    : `pvp_events: ${matches.length} link columns point at the import scenarios table ${scenariosTableId} (${matches.map((column) => column.title).join(', ')}); keep exactly one.`;
  return { link: null, errors: [error] };
}

export function checkSchema({ table, meta, candidates, scenariosTableId }) {
  const errors = [];
  const byTitle = new Map((meta.columns ?? []).map((column) => [column.title, column]));
  for (const title of REQUIRED_COLUMNS[table] ?? []) if (!byTitle.has(title)) errors.push(`${table}: missing column "${title}".`);
  const emitted = new Map();
  for (const candidate of candidates) {
    for (const [column, value] of Object.entries(candidate.facts ?? {})) {
      if (value == null) continue;
      if (!emitted.has(column)) emitted.set(column, new Set());
      emitted.get(column).add(String(value));
    }
  }
  for (const [column, values] of emitted) {
    const columnMeta = byTitle.get(column);
    if (!columnMeta || !Array.isArray(columnMeta.options)) continue;
    for (const value of values) if (!columnMeta.options.includes(value)) errors.push(`${table}: column "${column}" has no select option "${value}"; add it in NocoDB.`);
  }
  let scenarioLink = null;
  if (table === 'pvp_events') {
    const resolved = resolveScenarioLink({ meta, scenariosTableId });
    errors.push(...resolved.errors);
    scenarioLink = resolved.link;
  }
  return { errors, columnIdByTitle: new Map([...byTitle].map(([title, column]) => [title, column.id])), scenarioLink };
}

export function fieldsForEntry(entry) {
  const linkField = entry.link?.field ?? null;
  return Object.fromEntries(Object.entries(entry.changes ?? {}).filter(([column]) => column !== linkField).map(([column, change]) => [column, change.to]));
}

function inlineLink(entry) {
  const to = entry.link?.to;
  return to && !String(to).startsWith('new:') ? { [entry.link.field]: [{ id: String(to) }] } : {};
}

export async function applyPlan({ client, tableId, plan, linkFieldId = null, log = console }) {
  const result = { created: 0, updated: 0, failures: [] };
  const creates = plan.entries.filter((entry) => entry.action === 'create');
  const updates = plan.entries.filter((entry) => entry.action === 'link' || entry.action === 'update');

  for (const batch of chunkByBatch(creates)) {
    try {
      await client.createRecords(tableId, batch.map((entry) => ({ ...fieldsForEntry(entry), ...inlineLink(entry) })));
      result.created += batch.length;
    } catch (error) {
      result.failures.push(`create batch (${batch.map((e) => e.label ?? e.changes?.gametora_id?.to).join(', ')}): ${error.message}`);
      log.error(result.failures.at(-1));
    }
    for (const entry of batch) if (String(entry.link?.to ?? '').startsWith('new:')) log.warn(`${entry.label ?? 'row'}: scenario ${entry.link.to} did not exist at apply time; link it on the next run.`);
  }

  const withFields = updates.filter((entry) => Object.keys(fieldsForEntry(entry)).length);
  for (const batch of chunkByBatch(withFields)) {
    try {
      await client.updateRecords(tableId, batch.map((entry) => ({ id: entry.recordId, fields: fieldsForEntry(entry) })));
      result.updated += batch.length;
    } catch (error) {
      result.failures.push(`update batch (${batch.map((e) => e.recordId).join(', ')}): ${error.message}`);
      log.error(result.failures.at(-1));
    }
  }

  for (const entry of updates) {
    if (!entry.link) continue;
    if (!linkFieldId) { result.failures.push(`record ${entry.recordId}: link change requested but no link field id known.`); continue; }
    if (String(entry.link.to ?? '').startsWith('new:')) { log.warn(`record ${entry.recordId}: scenario ${entry.link.to} does not exist yet; link it on the next run.`); continue; }
    try {
      if (entry.link.from) await client.unlinkRecords(tableId, linkFieldId, entry.recordId, [entry.link.from]);
      if (entry.link.to) await client.linkRecords(tableId, linkFieldId, entry.recordId, [entry.link.to]);
      if (!Object.keys(fieldsForEntry(entry)).length) result.updated += 1;
    } catch (error) {
      result.failures.push(`record ${entry.recordId} link: ${error.message}`);
      log.error(result.failures.at(-1));
    }
  }
  return result;
}

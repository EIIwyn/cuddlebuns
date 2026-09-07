// Pure planner: diffs candidate rows against current NocoDB records. No I/O.
// Ownership tiers (see the spec): facts are importer-owned unless lock_facts;
// seeds are written when blank or still provisional; curated columns are never read for decisions.

const ACTIONS = ['create', 'link', 'update', 'skip', 'locked', 'unmatched', 'dropped'];
const LINK_FIELD = { pvp_events: 'scenario' };

export function relationIds(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map((item) => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return item?.id != null ? String(item.id) : item?.id_fields?.Id != null ? String(item.id_fields.Id) : null;
  }).filter(Boolean);
}

export function normalizeValue(value) {
  if (value == null) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

function foldedEquals(a, b) {
  return String(normalizeValue(a) ?? '').toLowerCase() === String(normalizeValue(b) ?? '').toLowerCase();
}

function numberOrNull(value) {
  const number = Number(value);
  return value != null && value !== '' && Number.isFinite(number) ? number : null;
}

function isLocked(fields) {
  const value = fields?.lock_facts;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function attachmentGametoraId(fields) {
  const first = Array.isArray(fields?.image) ? fields.image[0] : null;
  const match = /^(\d+)-/.exec(first?.title ?? '');
  return match ? Number(match[1]) : null;
}

// Link rules: which unlinked existing record a candidate may claim. Narrow on purpose.
function linkTarget(table, fields, candidatesById) {
  if (table === 'pvp_events') {
    if (normalizeValue(fields.event_type) !== 'Champions Meeting') return null;
    const number = numberOrNull(fields.event_number);
    return number != null && candidatesById.has(number) ? number : null;
  }
  if (table === 'support_cards') {
    const id = attachmentGametoraId(fields);
    const candidate = id != null ? candidatesById.get(id) : null;
    return candidate && foldedEquals(candidate.facts.character_name, fields.character_name) ? id : null;
  }
  return null;
}

function suggestionFor(table, fields, candidates) {
  if (table === 'support_cards') {
    const match = candidates.find((c) => foldedEquals(c.facts.character_name, fields.character_name) && foldedEquals(c.facts.card_type, fields.card_type));
    return match ? `gametora_id ${match.gametoraId} (${match.facts.character_name} / ${match.facts.card_type}${match.facts.title ? ` ${match.facts.title}` : ''})` : null;
  }
  if (table === 'scenarios') {
    const start = normalizeValue(fields.era_start);
    if (!start || !candidates.length) return null;
    const distance = (c) => Math.abs(Date.parse(c.facts.era_start) - Date.parse(start));
    const nearest = [...candidates].sort((a, b) => distance(a) - distance(b))[0];
    return `gametora_id ${nearest.gametoraId} (${nearest.label}, era_start ${nearest.facts.era_start})`;
  }
  return null;
}

function diffFields(candidate, fields) {
  const changes = {};
  for (const [column, value] of Object.entries(candidate.facts)) {
    const from = normalizeValue(fields[column]);
    const to = normalizeValue(value);
    if (from !== to) changes[column] = { from, to };
  }
  for (const [column, { value, alternatives }] of Object.entries(candidate.seeds ?? {})) {
    const current = normalizeValue(fields[column]);
    const to = normalizeValue(value);
    if (current === null && to !== null) changes[column] = { from: null, to };
    else if (current !== null && current !== to && alternatives.some((alt) => foldedEquals(alt, current))) changes[column] = { from: current, to };
  }
  return changes;
}

function linkChange(table, candidate, fields, scenarioRecordIdByGametoraId) {
  const field = LINK_FIELD[table];
  if (!field) return null;
  const from = fields ? relationIds(fields[field])[0] ?? null : null;
  const wanted = candidate.scenarioGametoraId;
  const to = wanted == null ? null : scenarioRecordIdByGametoraId.get(wanted) ?? `new:${wanted}`;
  return from === to ? null : { field, from, to };
}

export function buildPlan({ table, candidates, existing, scenarioRecordIdByGametoraId = new Map() }) {
  const entries = [];
  const candidatesById = new Map(candidates.map((c) => [c.gametoraId, c]));
  const claimed = new Set();

  // 1. Existing rows already keyed by gametora_id.
  const byGametoraId = new Map();
  const unlinked = [];
  for (const record of existing) {
    const id = numberOrNull(record.fields?.gametora_id);
    if (id == null) unlinked.push(record);
    else if (!byGametoraId.has(id)) byGametoraId.set(id, record);
    else entries.push({ action: 'dropped', gametoraId: id, recordId: record.id, label: String(record.fields?.name ?? record.id), changes: {}, link: null, suggestion: null, note: `duplicate gametora_id ${id}; first row wins` });
  }

  // 2. Link rules for unlinked rows. Ambiguous targets link nothing.
  const linkTargets = new Map();
  for (const record of unlinked) {
    const target = linkTarget(table, record.fields ?? {}, candidatesById);
    if (target != null) linkTargets.set(target, [...(linkTargets.get(target) ?? []), record]);
  }
  const linkedRecordByGametoraId = new Map();
  const ambiguous = new Set();
  for (const [gametoraId, records] of linkTargets) {
    if (records.length === 1) linkedRecordByGametoraId.set(gametoraId, records[0]);
    else for (const record of records) ambiguous.add(record.id);
  }

  // 3. One entry per candidate.
  for (const candidate of candidates) {
    const keyed = byGametoraId.get(candidate.gametoraId) ?? null;
    const linked = keyed ? null : linkedRecordByGametoraId.get(candidate.gametoraId) ?? null;
    const record = keyed ?? linked;
    const base = { gametoraId: candidate.gametoraId, label: candidate.label, suggestion: null, note: candidate.note ?? null };
    if (!record) {
      const changes = { gametora_id: { from: null, to: candidate.gametoraId } };
      for (const [column, value] of Object.entries(candidate.facts)) changes[column] = { from: null, to: normalizeValue(value) };
      for (const [column, { value }] of Object.entries(candidate.seeds ?? {})) changes[column] = { from: null, to: normalizeValue(value) };
      entries.push({ ...base, action: 'create', recordId: null, changes, link: linkChange(table, candidate, null, scenarioRecordIdByGametoraId) });
      continue;
    }
    claimed.add(record.id);
    const fields = record.fields ?? {};
    if (isLocked(fields)) { entries.push({ ...base, action: 'locked', recordId: record.id, changes: {}, link: null }); continue; }
    const changes = diffFields(candidate, fields);
    if (linked) changes.gametora_id = { from: null, to: candidate.gametoraId };
    const link = linkChange(table, candidate, fields, scenarioRecordIdByGametoraId);
    const action = linked ? 'link' : Object.keys(changes).length || link ? 'update' : 'skip';
    entries.push({ ...base, action, recordId: record.id, changes, link });
  }

  // 4. Leftovers: keyed rows GameTora dropped, and unlinked rows nothing claimed.
  for (const [gametoraId, record] of byGametoraId) {
    if (claimed.has(record.id)) continue;
    entries.push({ action: 'dropped', gametoraId, recordId: record.id, label: String(record.fields?.name ?? record.id), changes: {}, link: null, suggestion: null, note: 'gametora_id no longer listed by GameTora; row left as is' });
  }
  for (const record of unlinked) {
    if (claimed.has(record.id)) continue;
    const fields = record.fields ?? {};
    entries.push({
      action: 'unmatched', gametoraId: null, recordId: record.id, label: String(fields.name ?? record.id), changes: {}, link: null,
      suggestion: suggestionFor(table, fields, candidates),
      note: ambiguous.has(record.id) ? 'ambiguous: another unlinked row matches the same candidate; set gametora_id by hand' : null,
    });
  }

  const summary = Object.fromEntries(ACTIONS.map((action) => [action, entries.filter((e) => e.action === action).length]));
  return { entries, summary };
}

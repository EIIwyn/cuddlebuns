import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, normalizeValue, relationIds } from '../gametora/plan.mjs';

const rec = (id, fields) => ({ id: String(id), fields });
const scenarioCandidate = (gametoraId, overrides = {}) => ({
  gametoraId, label: `S${gametoraId}`,
  facts: { slug: `s${gametoraId}`, era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#fb5f5f', ...overrides.facts },
  seeds: { name: { value: 'Grandmasters Legacies Immortal', alternatives: ['Grand Masters'] }, short_name: { value: 'grandmasters', alternatives: [] }, ...overrides.seeds },
  scenarioGametoraId: null, note: overrides.note ?? null,
});
const eventCandidate = (gametoraId, overrides = {}) => ({
  gametoraId, label: `CM${gametoraId}`,
  facts: { event_number: gametoraId, event_type: 'Champions Meeting', start_date: '2026-09-20', end_date: '2026-09-26', distance_class: 'Medium', distance_m: 2200, racecourse: 'Kyoto', direction: 'Right', season: 'Fall', track_condition: 'Firm', weather: 'Sunny', surface: 'Turf', status: 'projected', ...overrides.facts },
  seeds: { name: { value: `CM${gametoraId} Scorpio`, alternatives: [] }, slug: { value: `cm${gametoraId}`, alternatives: [] } },
  scenarioGametoraId: overrides.scenarioGametoraId ?? 3, note: null,
});
const cardCandidate = (gametoraId, overrides = {}) => ({
  gametoraId, label: `card ${gametoraId}`,
  facts: { character_name: 'Oguri Cap', card_type: 'Wit', rarity: 'SSR', title: '[Run Forth!]', release_date: '2026-10-19', ...overrides.facts },
  seeds: { name: { value: 'Oguri Cap Wit SSR', alternatives: [] }, slug: { value: `${gametoraId}-oguri-cap`, alternatives: [] } },
  scenarioGametoraId: null, note: null,
});
const summaryOf = (plan) => Object.fromEntries(Object.entries(plan.summary).filter(([, n]) => n > 0));

test('normalizeValue treats blanks as null and trims, keeps numbers and booleans, lowercases colours', () => {
  assert.equal(normalizeValue(''), null);
  assert.equal(normalizeValue('  '), null);
  assert.equal(normalizeValue(undefined), null);
  assert.equal(normalizeValue(' Kyoto '), 'Kyoto');
  assert.equal(normalizeValue('2026-09-20T00:00:00.000Z'), '2026-09-20');
  assert.equal(normalizeValue(2200), 2200);
  assert.equal(normalizeValue('2200'), '2200');
  assert.equal(normalizeValue(true), true);
  assert.equal(normalizeValue('#FB5F5F'), '#fb5f5f');
  assert.deepEqual(relationIds([{ id: 3, fields: { name: 'x' } }]), ['3']);
});

test('creates a row when nothing matches, with every fact and seed as a change', () => {
  const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5)], existing: [] });
  assert.deepEqual(summaryOf(plan), { create: 1 });
  const [entry] = plan.entries;
  assert.equal(entry.action, 'create');
  assert.equal(entry.recordId, null);
  assert.deepEqual(entry.changes.gametora_id, { from: null, to: 5 });
  assert.deepEqual(entry.changes.name, { from: null, to: 'Grandmasters Legacies Immortal' });
  assert.deepEqual(entry.changes.era_end, { from: null, to: '2027-04-18' });
});

test('skips a row whose facts and seeds already match, even with formatting differences', () => {
  const existing = [rec(1, { gametora_id: 5, slug: 's5', era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#FB5F5F', name: 'Grandmasters Legacies Immortal', short_name: 'grandmasters', lock_facts: false })];
  const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5)], existing });
  assert.deepEqual(summaryOf(plan), { skip: 1 });
});

test('updates only the differing fact fields', () => {
  const existing = [rec(1, { gametora_id: 5, slug: 's5', era_start: '2026-12-01', era_end: '2027-04-18', display_color: '#fb5f5f', name: 'My Name', short_name: 'gm' })];
  const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5)], existing });
  const [entry] = plan.entries;
  assert.equal(entry.action, 'update');
  assert.deepEqual(entry.changes, { era_start: { from: '2026-12-01', to: '2026-12-05' } });
});

test('seed-once: blank is seeded, hand-edited is kept, provisional is upgraded', () => {
  const blank = rec(1, { gametora_id: 5, slug: 's5', era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#fb5f5f', name: '', short_name: null });
  const edited = rec(2, { gametora_id: 5, slug: 's5', era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#fb5f5f', name: 'GM Legacy', short_name: 'gm' });
  const provisional = rec(3, { gametora_id: 5, slug: 's5', era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#fb5f5f', name: ' grand masters ', short_name: 'gm' });
  for (const [record, expected] of [[blank, { name: { from: null, to: 'Grandmasters Legacies Immortal' }, short_name: { from: null, to: 'grandmasters' } }], [edited, null], [provisional, { name: { from: 'grand masters', to: 'Grandmasters Legacies Immortal' } }]]) {
    const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5)], existing: [record] });
    if (expected === null) assert.equal(plan.entries[0].action, 'skip');
    else { assert.equal(plan.entries[0].action, 'update'); assert.deepEqual(plan.entries[0].changes, expected); }
  }
});

test('locked rows are reported and never diffed', () => {
  const existing = [rec(1, { gametora_id: 5, slug: 'anything', era_start: '2000-01-01', era_end: '2000-01-02', name: 'x', lock_facts: true })];
  const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5)], existing });
  assert.deepEqual(summaryOf(plan), { locked: 1 });
  assert.deepEqual(plan.entries[0].changes, {});
});

test('rows with a gametora_id GameTora no longer lists are dropped, never deleted', () => {
  const existing = [rec(1, { gametora_id: 99, name: 'Old' })];
  const plan = buildPlan({ table: 'scenarios', candidates: [], existing });
  assert.deepEqual(summaryOf(plan), { dropped: 1 });
  assert.equal(plan.entries[0].recordId, '1');
});

test('events link by event_number, resolve the scenario link, and never touch LoH rows', () => {
  const existing = [
    rec(7, { name: 'CM19 Scorpio', slug: 'cm19', event_type: 'Champions Meeting', event_number: 19, start_date: '2026-09-17', end_date: '2026-09-23', distance_class: 'Medium', distance_m: 2200, racecourse: 'Kyoto', direction: 'Right', season: 'Fall', track_condition: 'Firm', weather: 'Sunny', surface: 'Turf', scenario: [{ id: 1, fields: { name: 'Grand Live' } }] }),
    rec(8, { name: 'LoH1', slug: 'loh1', event_type: 'League of Heroes', event_number: 1, start_date: '2027-01-23', end_date: '2027-01-29' }),
  ];
  const scenarioIds = new Map([[3, '1'], [5, '2']]);
  const plan = buildPlan({ table: 'pvp_events', candidates: [eventCandidate(19), eventCandidate(45, { facts: { start_date: '2029-04-08', end_date: '2029-04-14' }, scenarioGametoraId: 14 })], existing, scenarioRecordIdByGametoraId: scenarioIds });
  assert.deepEqual(summaryOf(plan), { link: 1, create: 1, unmatched: 1 });
  const linked = plan.entries.find((e) => e.action === 'link');
  assert.equal(linked.recordId, '7');
  assert.deepEqual(linked.changes.gametora_id, { from: null, to: 19 });
  assert.deepEqual(linked.changes.start_date, { from: '2026-09-17', to: '2026-09-20' });
  assert.deepEqual(linked.changes.end_date, { from: '2026-09-23', to: '2026-09-26' });
  assert.deepEqual(linked.changes.status, { from: null, to: 'projected' });
  assert.equal(linked.changes.name, undefined);
  assert.equal(linked.link, null);
  const created = plan.entries.find((e) => e.action === 'create');
  assert.deepEqual(created.link, { field: 'scenario', from: null, to: 'new:14' });
  const loh = plan.entries.find((e) => e.action === 'unmatched');
  assert.equal(loh.recordId, '8');
  assert.equal(loh.suggestion, null);
});

test('an already-imported event with matching facts and link is a skip', () => {
  const existing = [rec(7, { gametora_id: 19, name: 'CM19 Scorpio', slug: 'cm19', event_type: 'Champions Meeting', event_number: 19, start_date: '2026-09-20', end_date: '2026-09-26', distance_class: 'Medium', distance_m: 2200, racecourse: 'Kyoto', direction: 'Right', season: 'Fall', track_condition: 'Firm', weather: 'Sunny', surface: 'Turf', status: 'projected', lock_facts: false, scenario: [{ id: 1, fields: { name: 'Grand Live' } }] })];
  const plan = buildPlan({ table: 'pvp_events', candidates: [eventCandidate(19)], existing, scenarioRecordIdByGametoraId: new Map([[3, '1']]) });
  assert.deepEqual(summaryOf(plan), { skip: 1 });
  assert.deepEqual(plan.entries[0].changes, {});
  assert.equal(plan.entries[0].link, null);
});

test('an event whose derived scenario changed gets a link change', () => {
  const existing = [rec(7, { gametora_id: 19, name: 'CM19 Scorpio', slug: 'cm19', event_type: 'Champions Meeting', event_number: 19, start_date: '2026-09-20', end_date: '2026-09-26', distance_class: 'Medium', distance_m: 2200, racecourse: 'Kyoto', direction: 'Right', season: 'Fall', track_condition: 'Firm', weather: 'Sunny', surface: 'Turf', status: 'projected', scenario: [{ id: 1 }] })];
  const plan = buildPlan({ table: 'pvp_events', candidates: [eventCandidate(19, { scenarioGametoraId: 5 })], existing, scenarioRecordIdByGametoraId: new Map([[5, '2']]) });
  assert.equal(plan.entries[0].action, 'update');
  assert.deepEqual(plan.entries[0].changes, {});
  assert.deepEqual(plan.entries[0].link, { field: 'scenario', from: '1', to: '2' });
});

test('cards link by attachment id prefix only when the character name agrees', () => {
  const existing = [
    rec(8, { name: 'oguriwit', character_name: 'oguri cap', card_type: 'Wit', image: [{ title: '30146-Oguri-Cap-SSR-wit.png' }], rating: 'Borrow', styles: ['Pace'] }),
    rec(9, { name: 'other', character_name: 'Someone Else', card_type: 'Wit', image: [{ title: '30147-x.png' }] }),
    rec(10, { name: 'noimage', character_name: 'Oguri Cap', card_type: 'Speed' }),
  ];
  const candidates = [cardCandidate(30146), cardCandidate(30147, { facts: { character_name: 'Oguri Cap' } }), cardCandidate(30148, { facts: { card_type: 'Speed' } })];
  const plan = buildPlan({ table: 'support_cards', candidates, existing });
  assert.deepEqual(summaryOf(plan), { link: 1, create: 2, unmatched: 2 });
  const linked = plan.entries.find((e) => e.action === 'link');
  assert.equal(linked.recordId, '8');
  assert.equal(linked.changes.rating, undefined);
  assert.equal(linked.changes.name, undefined);
  assert.deepEqual(linked.changes.character_name, { from: 'oguri cap', to: 'Oguri Cap' });
  const noImage = plan.entries.find((e) => e.action === 'unmatched' && e.recordId === '10');
  assert.match(noImage.suggestion, /30148/);
});

test('two unlinked rows pointing at one candidate are both left unmatched', () => {
  const existing = [
    rec(1, { name: 'a', event_type: 'Champions Meeting', event_number: 19 }),
    rec(2, { name: 'b', event_type: 'Champions Meeting', event_number: 19 }),
  ];
  const plan = buildPlan({ table: 'pvp_events', candidates: [eventCandidate(19)], existing });
  assert.deepEqual(summaryOf(plan), { create: 1, unmatched: 2 });
  assert.match(plan.entries.find((e) => e.recordId === '1').note, /ambiguous/);
});

test('unmatched scenarios get the nearest era_start as a suggestion', () => {
  const existing = [rec(1, { name: 'Grand Masters', era_start: '2026-11-28', era_end: '2027-04-04' })];
  const plan = buildPlan({ table: 'scenarios', candidates: [scenarioCandidate(5), scenarioCandidate(6, { facts: { era_start: '2027-04-18' } })], existing });
  const unmatched = plan.entries.find((e) => e.action === 'unmatched');
  assert.match(unmatched.suggestion, /gametora_id 5/);
});

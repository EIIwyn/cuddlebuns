import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKS, distanceClass, unixToDate, addDays, titleCaseSlug, transformScenarios, FINAL_ERA_DAYS,
} from '../gametora/transform.mjs';

// Unix seconds for an ISO date at an odd time of day, like GameTora's display_start values.
export const T = (iso) => Math.floor(Date.parse(`${iso}T05:30:00Z`) / 1000);

test('lookups match the verified track ids and distance bands', () => {
  assert.equal(TRACKS[10003], 'Niigata');
  assert.equal(TRACKS[10005], 'Nakayama');
  assert.equal(TRACKS[10203], 'Del Mar');
  assert.equal(distanceClass(1400), 'Sprint');
  assert.equal(distanceClass(1401), 'Mile');
  assert.equal(distanceClass(1800), 'Mile');
  assert.equal(distanceClass(2400), 'Medium');
  assert.equal(distanceClass(2401), 'Long');
});

test('date helpers use UTC calendar dates', () => {
  assert.equal(unixToDate(T('2026-09-20')), '2026-09-20');
  assert.equal(addDays('2026-12-30', 6), '2027-01-05');
  assert.equal(titleCaseSlug('project-larc'), 'Project Larc');
});

export const scenarios = [
  { id: 4, name_en: 'Trackblazer', name_en_old: 'Make a New Track', url_name: 'trackblazer', bg_color: 'AABBCC', start_en: T('2026-03-12') },
  { id: 3, name_en: 'Brighter Together Our Grand Concert', name_en_old: 'Grand Live', url_name: 'grand-live', bg_color: '9CD127', start_en: T('2026-07-22') },
  { id: 5, name_en: 'Grandmasters Legacies Immortal', name_en_old: 'Grand Masters', url_name: 'grand-masters', bg_color: 'fb5f5f' },
  { id: 6, name_en_old: 'Project L\'Arc', url_name: 'project-larc', bg_color: '4B84F4' },
  { id: 7, url_name: 'uaf', bg_color: 'fc6625' },
];
export const foresight = { future_scenarios: [
  { id: 5, display_start: T('2026-12-05'), is_estimated: true },
  { id: 6, display_start: T('2027-04-18'), is_estimated: true },
  { id: 7, display_start: T('2027-09-02'), is_estimated: true },
] };
export const now = new Date('2026-09-07T00:00:00Z');

test('transformScenarios picks the current scenario by latest past start_en, chains era_end, and sorts', () => {
  const { rows, warnings } = transformScenarios({ scenarios, foresight, now });
  assert.deepEqual(rows.map((r) => r.gametoraId), [3, 5, 6, 7]);
  assert.deepEqual(rows[0].facts, { slug: 'grand-live', era_start: '2026-07-22', era_end: '2026-12-05', display_color: '#9cd127' });
  assert.deepEqual(rows[1].facts, { slug: 'grand-masters', era_start: '2026-12-05', era_end: '2027-04-18', display_color: '#fb5f5f' });
  assert.equal(rows[3].facts.era_end, addDays('2027-09-02', FINAL_ERA_DAYS));
  assert.match(rows[3].note, /estimated/);
  assert.equal(rows[0].note, null);
  assert.deepEqual(warnings, []);
});

test('transformScenarios seeds name tiers and short_name', () => {
  const { rows } = transformScenarios({ scenarios, foresight, now });
  const byId = Object.fromEntries(rows.map((r) => [r.gametoraId, r]));
  assert.deepEqual(byId[3].seeds.name, { value: 'Brighter Together Our Grand Concert', alternatives: ['Grand Live'] });
  assert.deepEqual(byId[6].seeds.name, { value: 'Project L\'Arc', alternatives: ['Project Larc'] });
  assert.deepEqual(byId[7].seeds.name, { value: 'Uaf', alternatives: [] });
  assert.deepEqual(byId[5].seeds.short_name, { value: 'grandmasters', alternatives: [] });
});

test('transformScenarios warns and skips a future scenario with no matching record', () => {
  const { rows, warnings } = transformScenarios({ scenarios, foresight: { future_scenarios: [{ id: 99, display_start: T('2028-01-01') }] }, now });
  assert.deepEqual(rows.map((r) => r.gametoraId), [3]);
  assert.match(warnings[0], /99/);
});

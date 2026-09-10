import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKS, distanceClass, unixToDate, addDays, titleCaseSlug, transformScenarios, FINAL_ERA_DAYS, transformEvents, transformSupportCards,
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

const jp = (id, race, name, startIso = '2022-11-13', days = 6) => ({
  id, name, name_en: name, race, start: T(startIso), end: T(startIso) + days * 86_400,
});
const jpChampionsMeetings = [
  jp(19, { condition: 1, distance: 2200, ground: 1, season: 3, track: 10008, turn: 1, weather: 1 }, 'Scorpio Cup'),
  jp(27, { condition: 3, distance: 2400, ground: 1, season: 3, track: 10201, turn: 1, weather: 3 }, undefined),
  jp(41, { condition: 1, distance: 1200, ground: 1, season: 3, track: 10003, turn: 2, weather: 2 }, undefined),
  jp(44, { condition: 1, distance: 2200, ground: 1, season: 1, track: 10203, turn: 2, weather: 1 }, undefined, '2025-01-01', 9),
  jp(45, { condition: 1, distance: 2000, ground: 2, season: 1, track: 99999, turn: 2, weather: 1 }, undefined),
];
const futureCm = [
  { id: 19, name_en: 'Scorpio Cup', display_start: T('2026-09-20'), is_estimated: true },
  { id: 27, display_start: T('2027-05-25'), is_estimated: false },
  { id: 41, display_start: T('2028-11-25'), is_estimated: true },
  { id: 44, display_start: T('2029-03-16'), is_estimated: true },
  { id: 45, display_start: T('2029-04-08'), is_estimated: true },
  { id: 46, display_start: T('2029-05-24'), is_estimated: true },
];
const scenarioRows = transformScenarios({ scenarios, foresight, now }).rows;

test('transformEvents joins foresight with JP race data and maps every code', () => {
  const { rows } = transformEvents({ foresight: { future_cm: futureCm }, jpChampionsMeetings, scenarioRows });
  const cm19 = rows.find((r) => r.gametoraId === 19);
  assert.deepEqual(cm19.facts, {
    event_number: 19, event_type: 'Champions Meeting', start_date: '2026-09-20', end_date: '2026-09-26',
    distance_class: 'Medium', distance_m: 2200, racecourse: 'Kyoto', direction: 'Right', season: 'Fall',
    track_condition: 'Firm', weather: 'Sunny', surface: 'Turf', status: 'projected',
  });
  assert.deepEqual(cm19.seeds, { name: { value: 'CM19 Scorpio', alternatives: [] }, slug: { value: 'cm19', alternatives: [] } });
  assert.equal(cm19.scenarioGametoraId, 3);
});

test('transformEvents names unnamed CMs by distance class and marks announced ones confirmed', () => {
  const { rows } = transformEvents({ foresight: { future_cm: futureCm }, jpChampionsMeetings, scenarioRows });
  const cm27 = rows.find((r) => r.gametoraId === 27);
  assert.equal(cm27.seeds.name.value, 'CM27 Medium');
  assert.equal(cm27.facts.racecourse, 'Longchamp');
  assert.equal(cm27.facts.weather, 'Rain');
  assert.equal(cm27.facts.status, 'confirmed');
  assert.equal(cm27.scenarioGametoraId, 6);
  const cm41 = rows.find((r) => r.gametoraId === 41);
  assert.equal(cm41.facts.racecourse, 'Niigata');
  assert.equal(cm41.facts.direction, 'Left');
  const cm44 = rows.find((r) => r.gametoraId === 44);
  assert.equal(cm44.facts.end_date, '2029-03-25');
  assert.equal(cm44.scenarioGametoraId, null);
});

test('transformEvents skips CMs with no JP record or an unknown track and warns', () => {
  const { rows, warnings } = transformEvents({ foresight: { future_cm: futureCm }, jpChampionsMeetings, scenarioRows });
  assert.deepEqual(rows.map((r) => r.gametoraId), [19, 27, 41, 44]);
  assert.equal(warnings.length, 2);
  assert.match(warnings.find((w) => w.includes('45')), /track 99999/);
  assert.match(warnings.find((w) => w.includes('46')), /no JP record/);
});

const supportCards = [
  { support_id: 30146, char_name: 'Oguri Cap', type: 'intelligence', rarity: 3, title_en: '[Run Forth! Dash On! Ever Forward!]', url_name: '30146-oguri-cap', release_en: '2026-10-19' },
  { support_id: 30118, char_name: 'Symboli Kris', type: 'stamina', rarity: 3, title_en: '[Kris Title]', url_name: '30118-symboli-kris' },
  { support_id: 10021, char_name: 'Tazuna Hayakawa', type: 'friend', rarity: 3, title_en: '[Tracen Academy]', url_name: '10021-tazuna-hayakawa', release_en: '2025-06-26' },
  { support_id: 30500, char_name: 'Someone', type: 'group', rarity: 2, title_en: '[Group]', url_name: '30500-someone' },
  { support_id: 30900, char_name: 'Nobody', type: 'speed', rarity: 1, title_en: '[No Date]', url_name: '30900-nobody' },
  { support_id: 30901, char_name: 'Odd', type: 'mystery', rarity: 3, title_en: '[Bad Type]', url_name: '30901-odd', release_en: '2026-01-01' },
];
const predictedReleases = { support_cards: {
  30118: { banner_id: 1, banner_type: 'support', release_date: '2026-09-01' },
  30500: { release_date: '2027-02-02' },
} };

test('transformSupportCards maps type, rarity, title and picks the global release date', () => {
  const { rows } = transformSupportCards({ supportCards, predictedReleases });
  const oguri = rows.find((r) => r.gametoraId === 30146);
  assert.deepEqual(oguri.facts, { character_name: 'Oguri Cap', card_type: 'Wit', rarity: 'SSR', title: '[Run Forth! Dash On! Ever Forward!]', release_date: '2026-10-19' });
  assert.deepEqual(oguri.seeds, { name: { value: 'Oguri Cap Wit SSR', alternatives: [] }, slug: { value: '30146-oguri-cap', alternatives: [] } });
  const kris = rows.find((r) => r.gametoraId === 30118);
  assert.equal(kris.facts.release_date, '2026-09-01');
  assert.equal(rows.find((r) => r.gametoraId === 10021).facts.card_type, 'Friend');
  assert.equal(rows.find((r) => r.gametoraId === 30500).facts.card_type, 'Group');
  assert.equal(rows.find((r) => r.gametoraId === 30500).facts.rarity, 'SR');
});

test('transformSupportCards skips cards without a global date silently and unknown types with a warning', () => {
  const { rows, warnings, skippedNoGlobalDate } = transformSupportCards({ supportCards, predictedReleases });
  assert.deepEqual(rows.map((r) => r.gametoraId).sort((a, b) => a - b), [10021, 30118, 30146, 30500]);
  assert.equal(skippedNoGlobalDate, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /30901.*mystery/);
});

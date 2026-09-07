// Pure transforms from GameTora JSON to candidate rows. No I/O here.
// Every lookup below is documented and verified in docs/2026-09-07-uma-gametora-import-design.md.

export const TRACKS = {
  10001: 'Sapporo', 10002: 'Hakodate', 10003: 'Niigata', 10004: 'Fukushima', 10005: 'Nakayama',
  10006: 'Tokyo', 10007: 'Chukyo', 10008: 'Kyoto', 10009: 'Hanshin', 10010: 'Kokura',
  10101: 'Ooi', 10103: 'Kawasaki', 10104: 'Funabashi', 10105: 'Morioka',
  10201: 'Longchamp', 10202: 'Santa Anita', 10203: 'Del Mar',
};
export const GROUND = { 1: 'Turf', 2: 'Dirt' };
export const TURN = { 1: 'Right', 2: 'Left' };
export const CONDITION = { 1: 'Firm', 2: 'Good', 3: 'Soft', 4: 'Heavy' };
export const SEASON = { 1: 'Spring', 2: 'Summer', 3: 'Fall', 4: 'Winter', 5: 'Spring' };
export const WEATHER = { 1: 'Sunny', 2: 'Cloudy', 3: 'Rain', 4: 'Snow' };
export const CARD_TYPES = { speed: 'Speed', stamina: 'Stamina', power: 'Power', guts: 'Guts', intelligence: 'Wit', friend: 'Friend', group: 'Group' };
export const RARITY = { 1: 'R', 2: 'SR', 3: 'SSR' };
export const FINAL_ERA_DAYS = 120;

export function distanceClass(meters) {
  if (meters <= 1400) return 'Sprint';
  if (meters <= 1800) return 'Mile';
  if (meters <= 2400) return 'Medium';
  return 'Long';
}

export function unixToDate(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function titleCaseSlug(slug) {
  return String(slug ?? '').split('-').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

export function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function color(value) { const hex = text(value); return hex ? `#${hex.replace(/^#/, '').toLowerCase()}` : null; }
export function seed(value, ...alternatives) {
  return { value, alternatives: [...new Set(alternatives.filter((alt) => alt && alt !== value))] };
}

export function transformScenarios({ scenarios, foresight, now = new Date() }) {
  const warnings = [];
  const byId = new Map((scenarios ?? []).map((scenario) => [scenario.id, scenario]));
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const released = (scenarios ?? []).filter((scenario) => typeof scenario.start_en === 'number' && scenario.start_en <= nowSeconds);
  const current = released.sort((a, b) => b.start_en - a.start_en)[0] ?? null;

  const starts = [];
  if (current) starts.push({ scenario: current, eraStart: unixToDate(current.start_en) });
  for (const entry of foresight?.future_scenarios ?? []) {
    const scenario = byId.get(entry.id);
    if (!scenario) { warnings.push(`Scenario ${entry.id}: listed in future_scenarios but missing from scenarios; skipped.`); continue; }
    if (current && scenario.id === current.id) continue;
    if (typeof entry.display_start !== 'number') { warnings.push(`Scenario ${entry.id}: no display_start; skipped.`); continue; }
    starts.push({ scenario, eraStart: unixToDate(entry.display_start) });
  }
  starts.sort((a, b) => a.eraStart.localeCompare(b.eraStart));

  const rows = starts.map(({ scenario, eraStart }, index) => {
    const next = starts[index + 1];
    const official = text(scenario.name_en);
    const provisional = text(scenario.name_en_old);
    const fromSlug = titleCaseSlug(scenario.url_name);
    const nameValue = official ?? provisional ?? fromSlug;
    return {
      gametoraId: scenario.id,
      label: nameValue,
      facts: {
        slug: text(scenario.url_name),
        era_start: eraStart,
        era_end: next ? next.eraStart : addDays(eraStart, FINAL_ERA_DAYS),
        display_color: color(scenario.bg_color),
      },
      seeds: {
        name: seed(nameValue, provisional, fromSlug),
        short_name: seed(String(scenario.url_name ?? '').replace(/-/g, '')),
      },
      scenarioGametoraId: null,
      note: next ? null : `era_end estimated (era_start + ${FINAL_ERA_DAYS} days) until GameTora lists the next scenario`,
    };
  });
  return { rows, warnings };
}

export function transformEvents({ foresight, jpChampionsMeetings, scenarioRows }) {
  const warnings = [];
  const jpById = new Map((jpChampionsMeetings ?? []).map((cm) => [cm.id, cm]));
  const rows = [];
  for (const entry of foresight?.future_cm ?? []) {
    const jp = jpById.get(entry.id);
    if (!jp?.race) { warnings.push(`CM${entry.id}: no JP record with race data; skipped.`); continue; }
    if (typeof entry.display_start !== 'number') { warnings.push(`CM${entry.id}: no display_start; skipped.`); continue; }
    const race = jp.race;
    const lookups = [
      ['track', TRACKS[race.track]], ['ground', GROUND[race.ground]], ['turn', TURN[race.turn]],
      ['condition', CONDITION[race.condition]], ['season', SEASON[race.season]], ['weather', WEATHER[race.weather]],
    ];
    const missing = lookups.find(([, value]) => !value);
    if (missing || !Number.isFinite(race.distance)) {
      warnings.push(`CM${entry.id}: unknown ${missing ? `${missing[0]} ${race[missing[0]]}` : 'distance'}; skipped.`);
      continue;
    }
    const startDate = unixToDate(entry.display_start);
    const durationDays = Number.isFinite(jp.start) && Number.isFinite(jp.end) ? Math.max(1, Math.round((jp.end - jp.start) / 86_400)) : 6;
    const officialName = text(entry.name_en);
    const distance = distanceClass(race.distance);
    const scenario = (scenarioRows ?? []).find((row) => row.facts.era_start <= startDate && startDate < row.facts.era_end) ?? null;
    rows.push({
      gametoraId: entry.id,
      label: officialName ? `CM${entry.id} ${officialName}` : `CM${entry.id}`,
      facts: {
        event_number: entry.id,
        event_type: 'Champions Meeting',
        start_date: startDate,
        end_date: addDays(startDate, durationDays),
        distance_class: distance,
        distance_m: race.distance,
        racecourse: TRACKS[race.track],
        direction: TURN[race.turn],
        season: SEASON[race.season],
        track_condition: CONDITION[race.condition],
        weather: WEATHER[race.weather],
        surface: GROUND[race.ground],
        status: entry.is_estimated === false ? 'confirmed' : 'projected',
      },
      seeds: {
        name: seed(officialName ? `CM${entry.id} ${officialName.replace(/\s+Cup$/i, '')}` : `CM${entry.id} ${distance}`),
        slug: seed(`cm${entry.id}`),
      },
      scenarioGametoraId: scenario?.gametoraId ?? null,
      note: null,
    });
  }
  rows.sort((a, b) => a.facts.start_date.localeCompare(b.facts.start_date) || a.gametoraId - b.gametoraId);
  return { rows, warnings };
}

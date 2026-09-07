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

const DAY_MS = 24 * 60 * 60 * 1000;
export const COURSE_COLORS = { sprint: '#55D6CE', mile: '#68A9FF', medium: '#E6C45C', long: '#D58ADB', dirt: '#DD8A52', unknown: '#8b93a8' };

function asDate(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat('en', { timeZone: 'UTC', ...options }).format(date) : 'Date TBD';
}

export function dateRangeLabel(startDate, endDate) {
  if (!startDate) return 'Date TBD';
  if (!endDate || endDate === startDate) return formatDate(startDate);
  return `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

function timestamp(value) {
  return asDate(value)?.getTime() ?? null;
}

function timelineTicks(start, end, position) {
  const cursor = new Date(start);
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  const ticks = [];
  while (cursor.getTime() < end) {
    const month = cursor.getUTCMonth();
    const kind = month === 0 ? 'year' : month % 3 === 0 ? 'quarter' : 'month';
    ticks.push({
      key: cursor.toISOString(),
      kind,
      label: kind === 'year' ? String(cursor.getUTCFullYear()) : `Q${Math.floor(month / 3) + 1}`,
      percent: position(cursor.toISOString()),
    });
    cursor.setUTCMonth(month + 1);
  }
  return ticks;
}

export function eventTypeKind(eventType) {
  const value = String(eventType ?? '').toLowerCase();
  if (value.includes('champion') || value.includes('metting')) return 'cm';
  if (value.includes('league') || value.includes('heroes')) return 'loh';
  return 'other';
}

export function eventTypeLabel(eventType) {
  const kind = eventTypeKind(eventType);
  if (kind === 'cm') return 'Champions Meeting';
  if (kind === 'loh') return 'League of Heroes';
  return eventType || 'PvP event';
}

export function courseCategory(event) {
  const surface = String(event.surface ?? '').trim().toLowerCase();
  if (surface === 'dirt') return 'dirt';
  const distance = String(event.distanceClass ?? '').trim().toLowerCase();
  return COURSE_COLORS[distance] ? distance : 'unknown';
}

export function courseColor(event) { return COURSE_COLORS[courseCategory(event)]; }

function isoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function createTimelineModel(timeline) {
  const dated = [
    ...timeline.scenarios.flatMap((item) => [timestamp(item.eraStart), timestamp(item.eraEnd)]),
    ...timeline.pvpEvents.flatMap((item) => [timestamp(item.startDate), timestamp(item.endDate)]),
  ].filter((value) => value != null);
  const today = Date.now();
  const earliest = Math.min(...dated, today);
  const latest = Math.max(...dated, today + (90 * DAY_MS));
  const padding = Math.max(28 * DAY_MS, Math.round((latest - earliest) * 0.05));
  const start = earliest - padding;
  const end = latest + padding;
  const span = Math.max(DAY_MS, end - start);
  const position = (value) => {
    const time = timestamp(value);
    return time == null ? null : Math.max(0, Math.min(100, ((time - start) / span) * 100));
  };

  return {
    start,
    end,
    ticks: timelineTicks(start, end, position),
    today: timestamp(isoToday()) >= start && timestamp(isoToday()) <= end ? { date: isoToday(), percent: position(isoToday()) } : null,
    scenarios: [...timeline.scenarios]
      .sort((left, right) => (timestamp(left.eraStart) ?? Infinity) - (timestamp(right.eraStart) ?? Infinity))
      .map((scenario) => ({ ...scenario, startPercent: position(scenario.eraStart), endPercent: position(scenario.eraEnd) })),
    events: [...timeline.pvpEvents]
      .sort((left, right) => (timestamp(left.startDate) ?? Infinity) - (timestamp(right.startDate) ?? Infinity))
      .map((event) => ({ ...event, startPercent: position(event.startDate), endPercent: position(event.endDate), typeKind: eventTypeKind(event.eventType), courseCategory: courseCategory(event), courseColor: courseColor(event), scenarioName: timeline.scenarios.find((scenario) => scenario.id === event.scenarioId)?.name ?? null })),
    supportCards: (timeline.supportCards ?? []).map((card) => ({ ...card, releasePercent: position(card.releaseDate) })),
  };
}

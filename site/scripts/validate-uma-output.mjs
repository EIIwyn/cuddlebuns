import fs from 'node:fs';
import path from 'node:path';

const SITE_DIR = path.resolve(import.meta.dirname, '..');
const FILE = path.join(SITE_DIR, 'public', 'data', 'uma', 'timeline.json');
const errors = [];
let timeline = null;
try { timeline = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (error) { errors.push(`data/uma/timeline.json: ${error.message}`); }
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
if (timeline) {
  if (timeline.schemaVersion !== 1 || !Array.isArray(timeline.scenarios) || !Array.isArray(timeline.pvpEvents) || !Array.isArray(timeline.supportCards)) errors.push('data/uma/timeline.json: unsupported schema.');
  const ids = new Set();
  for (const scenario of timeline.scenarios ?? []) {
    if (!scenario.id || !scenario.name || !scenario.slug || !date(scenario.eraStart) || !date(scenario.eraEnd) || scenario.eraEnd < scenario.eraStart) errors.push(`Scenario ${scenario.id ?? 'unknown'}: invalid public fields.`);
    ids.add(scenario.id);
  }
  for (const event of timeline.pvpEvents ?? []) {
    if (!event.id || !event.name || !event.slug || !date(event.startDate) || !date(event.endDate) || event.endDate < event.startDate) errors.push(`PvP event ${event.id ?? 'unknown'}: invalid public fields.`);
    if (event.scenarioId && !ids.has(event.scenarioId)) errors.push(`PvP event ${event.id}: unknown scenario relation.`);
    if (!['confirmed', 'projected', 'unspecified'].includes(event.status)) errors.push(`PvP event ${event.id}: invalid public status.`);
  }
  const eventIds = new Set((timeline.pvpEvents ?? []).map((event) => event.id));
  for (const card of timeline.supportCards ?? []) {
    if (!card.id || !card.slug || !card.name || !Array.isArray(card.styles) || !Array.isArray(card.eventIds) || (card.rating != null && typeof card.rating !== 'string')) errors.push(`Support card ${card.id ?? 'unknown'}: invalid public fields.`);
    if (card.releaseDate && !date(card.releaseDate)) errors.push(`Support card ${card.id}: invalid release date.`);
    for (const eventId of card.eventIds ?? []) if (!eventIds.has(eventId)) errors.push(`Support card ${card.id}: unknown PvP event relation.`);
    if (card.image?.fallback?.url && !card.image.fallback.url.startsWith('/generated/nocodb/')) errors.push(`Support card ${card.id}: invalid public image URL.`);
  }
  if (/NOCODB_TOKEN|xc-token|signedPath|nc_pat_/i.test(JSON.stringify(timeline))) errors.push('data/uma/timeline.json: contains forbidden private data.');
}
if (errors.length) { console.error(`Uma output validation failed with ${errors.length} issue(s):`); for (const error of errors) console.error(`- ${error}`); process.exitCode = 1; }
else console.log('Uma output validation passed.');

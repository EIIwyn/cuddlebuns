import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SITE_DIR = path.resolve(import.meta.dirname, '..');
const OUTPUT_FILE = path.join(SITE_DIR, 'public', 'data', 'uma', 'timeline.json');
const MANIFEST_FILE = path.join(SITE_DIR, '.cache', 'uma', 'manifest.json');
const IMAGE_DIR = path.join(SITE_DIR, 'public', 'generated', 'nocodb', 'uma-support');
const PUBLIC_IMAGE_ROOT = '/generated/nocodb/uma-support';
const CHECK_ONLY = process.argv.includes('--check');
const API_PAGE_SIZE = 100;
const API_TIMEOUT_MS = 120_000;

function loadEnvironment() {
  const envFile = path.join(SITE_DIR, '.env.local');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function getConfig() {
  const names = {
    url: 'UMA_NOCODB_URL', token: 'UMA_NOCODB_TOKEN', baseId: 'UMA_NOCODB_BASE_ID',
    scenarios: 'UMA_NOCODB_SCENARIOS_TABLE_ID', events: 'UMA_NOCODB_PVP_EVENTS_TABLE_ID', supportCards: 'UMA_NOCODB_SUPPORT_CARDS_TABLE_ID',
  };
  const config = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, process.env[name]?.trim()]));
  const missing = Object.entries(config).filter(([, value]) => !value || value.startsWith('YOUR_')).map(([key]) => names[key]);
  if (missing.length) throw new Error(`Missing Uma NocoDB configuration: ${missing.join(', ')}`);
  config.url = config.url.replace(/\/+$/, '');
  return config;
}

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function fingerprint(value) { return hash(JSON.stringify(stable(value))); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function field(fields, ...names) {
  for (const name of names) if (fields?.[name] != null) return fields[name];
  return null;
}
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function slugify(value, fallback) {
  const slug = String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || fallback;
}
function date(value) {
  const normalized = typeof value === 'string' ? value.slice(0, 10) : null;
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) && !Number.isNaN(Date.parse(`${normalized}T00:00:00Z`)) ? normalized : null;
}
function relationIds(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map((item) => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return item?.id != null ? String(item.id) : item?.id_fields?.Id != null ? String(item.id_fields.Id) : null;
  }).filter(Boolean);
}
function multiText(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map((item) => text(typeof item === 'object' ? item.title ?? item.value ?? item.name : item)).filter(Boolean);
}
function attachmentSnapshot(attachment) {
  return { id: attachment?.id ?? null, path: attachment?.path ?? null, signedPath: attachment?.signedPath ?? null, title: attachment?.title ?? null, mimetype: attachment?.mimetype ?? null, size: attachment?.size ?? null };
}
function imageFileExists(url) { return typeof url === 'string' && url.startsWith(PUBLIC_IMAGE_ROOT) && fs.existsSync(path.join(SITE_DIR, 'public', url.slice(1))); }
function extensionFor(attachment) {
  const extension = path.extname(attachment?.title || '').toLowerCase();
  return /^\.(avif|jpe?g|png|webp)$/.test(extension) ? extension : '.img';
}
async function downloadImage(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Support-card image request failed: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}
async function processImage(task, previous, baseUrl) {
  const signature = fingerprint(attachmentSnapshot(task.attachment));
  if (previous?.signature === signature && imageFileExists(previous.image?.fallback?.url)) return previous;
  let buffer = await downloadImage(new URL(task.attachment.signedPath, `${baseUrl}/`).href);
  try { await sharp(buffer).metadata(); } catch {
    const fallback = task.attachment?.thumbnails?.small?.signedPath || task.attachment?.thumbnails?.card_cover?.signedPath;
    if (!fallback) throw new Error(`${task.key}: attachment cannot be decoded and has no thumbnail fallback.`);
    buffer = await downloadImage(new URL(fallback, `${baseUrl}/`).href);
  }
  const contentHash = hash(buffer);
  const stem = `${slugify(task.key, 'support-card')}-${contentHash.slice(0, 12)}`;
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const sources = {};
  for (const [format, options] of Object.entries({ avif: { quality: 60, effort: 3 }, webp: { quality: 78, effort: 4 } })) {
    const filename = `${stem}-240.${format}`;
    const file = path.join(IMAGE_DIR, filename);
    const info = fs.existsSync(file) ? await sharp(file).metadata() : await sharp(buffer).rotate().resize({ width: 240, height: 160, fit: 'cover', position: 'top' })[format](options).toFile(file);
    sources[format] = [{ url: `${PUBLIC_IMAGE_ROOT}/${filename}`, width: info.width, height: info.height }];
  }
  return { signature, image: { width: sources.webp[0].width, height: sources.webp[0].height, sources, fallback: sources.webp[0] } };
}
function status(value) {
  const normalized = text(value)?.toLowerCase();
  if (normalized === 'confirmed') return 'confirmed';
  if (normalized === 'projected') return 'projected';
  return 'unspecified';
}

async function fetchTable(config, tableId, label) {
  const records = [];
  let next = `${config.url}/api/v3/data/${encodeURIComponent(config.baseId)}/${encodeURIComponent(tableId)}/records?pageSize=${API_PAGE_SIZE}&linksAsLtar=true`;
  while (next) {
    const returned = new URL(next, `${config.url}/`);
    const url = new URL(`${returned.pathname}${returned.search}`, `${config.url}/`);
    const response = await fetch(url, { headers: { 'xc-token': config.token }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${label} request failed: ${response.status} ${response.statusText}`);
    const page = await response.json();
    records.push(...(page.records ?? []));
    next = page.next ?? null;
  }
  console.log(`Fetched ${records.length} ${label} record(s).`);
  return records;
}

function createModel(scenarioRecords, eventRecords, supportCardRecords) {
  const errors = [];
  const scenarios = scenarioRecords.map((record) => {
    const fields = record.fields ?? {};
    const name = text(field(fields, 'name', 'Name'));
    const eraStart = date(field(fields, 'era_start', 'Era Start'));
    const eraEnd = date(field(fields, 'era_end', 'Era End'));
    if (!name || !eraStart || !eraEnd || eraEnd < eraStart) {
      errors.push(`Scenario ${record.id}: requires name and a valid era_start/era_end range; skipped.`);
      return null;
    }
    return {
      id: String(record.id), name,
      shortName: text(field(fields, 'short_name', 'Short Name')),
      slug: slugify(field(fields, 'slug', 'Slug') || name, `scenario-${record.id}`),
      eraStart, eraEnd,
      displayColor: text(field(fields, 'display_color', 'Display Color')),
    };
  }).filter(Boolean);
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const events = eventRecords.map((record) => {
    const fields = record.fields ?? {};
    const name = text(field(fields, 'name', 'Name'));
    const startDate = date(field(fields, 'start_date', 'Start Date'));
    const endDate = date(field(fields, 'end_date', 'End Date'));
    if (!name || !startDate || !endDate || endDate < startDate) {
      errors.push(`PvP event ${record.id}: requires name and a valid start_date/end_date range; skipped.`);
      return null;
    }
    const scenarioId = relationIds(field(fields, 'scenario', 'Scenario')).find((id) => scenarioIds.has(id)) ?? null;
    const eventNumber = Number(field(fields, 'event_number', 'Event Number'));
    return {
      id: String(record.id), name,
      eventNumber: Number.isFinite(eventNumber) ? eventNumber : null,
      slug: slugify(field(fields, 'slug', 'Slug') || name, `pvp-event-${record.id}`),
      eventType: text(field(fields, 'event_type', 'Event Type')),
      startDate, endDate, scenarioId,
      distanceClass: text(field(fields, 'distance_class', 'Distance Class')),
      distanceM: Number.isFinite(Number(field(fields, 'distance_m', 'Distance M'))) ? Number(field(fields, 'distance_m', 'Distance M')) : null,
      racecourse: text(field(fields, 'racecourse', 'Racecourse')),
      direction: text(field(fields, 'direction', 'Direction')),
      trackCondition: text(field(fields, 'track_condition', 'Track Condition')),
      season: text(field(fields, 'season', 'Season')),
      weather: text(field(fields, 'weather', 'Weather')),
      surface: text(field(fields, 'surface', 'Surface')),
      // This remains unspecified until a source status field is deliberately added.
      status: status(field(fields, 'status', 'Status', 'confirmed_projected_status', 'Confirmed/Projected Status')),
    };
  }).filter(Boolean);
  const eventIds = new Set(events.map((event) => event.id));
  const imageTasks = new Map();
  const supportCards = supportCardRecords.map((record) => {
    const fields = record.fields ?? {};
    const name = text(field(fields, 'name', 'Name'));
    const characterName = text(field(fields, 'character_name', 'Character Name'));
    const attachment = Array.isArray(field(fields, 'image', 'Image')) ? field(fields, 'image', 'Image')[0] : null;
    const taskKey = attachment?.signedPath ? `support-card:${record.id}:${attachment.id ?? 0}` : null;
    if (taskKey) imageTasks.set(taskKey, { key: taskKey, attachment });
    else if (attachment) errors.push(`Support card ${record.id}: image has no downloadable path; omitted.`);
    return {
      id: String(record.id), slug: slugify(field(fields, 'slug', 'Slug') || name || characterName, `support-card-${record.id}`),
      name: name || characterName || 'Untitled support card', characterName,
      cardType: text(field(fields, 'card_type', 'Card Type')),
      rating: text(field(fields, 'rating', 'Rating')),
      releaseDate: date(field(fields, 'release_date', 'Release Date')),
      styles: multiText(field(fields, 'styles', 'Styles')),
      breakpoints: multiText(field(fields, 'breakpoints', 'Breakpoints')),
      eventIds: relationIds(field(fields, 'pvp_events', 'PvP Events')).filter((id) => eventIds.has(id)),
      imageTaskKey: taskKey,
    };
  });
  scenarios.sort((left, right) => left.eraStart.localeCompare(right.eraStart) || left.name.localeCompare(right.name));
  events.sort((left, right) => left.startDate.localeCompare(right.startDate) || (left.eventNumber ?? Infinity) - (right.eventNumber ?? Infinity) || left.name.localeCompare(right.name));
  return { scenarios, events, supportCards, imageTasks, errors };
}

async function main() {
  loadEnvironment();
  const config = getConfig();
  const scenarios = await fetchTable(config, config.scenarios, 'Scenarios');
  const events = await fetchTable(config, config.events, 'PvP events');
  const supportCards = await fetchTable(config, config.supportCards, 'Support cards');
  const model = createModel(scenarios, events, supportCards);
  const sourceFingerprint = fingerprint({ scenarios, events, supportCards });
  const previous = readJson(MANIFEST_FILE, {});
  const current = previous.sourceFingerprint === sourceFingerprint && fs.existsSync(OUTPUT_FILE);
  if (CHECK_ONLY) {
    console.log(current ? 'No public Uma NocoDB changes detected.' : 'Public Uma NocoDB changes detected.');
    process.exitCode = current ? 0 : 10;
    return;
  }
  if (model.errors.length) for (const error of model.errors) console.warn(`- ${error}`);
  console.log(`Processing ${model.imageTasks.size} support-card image(s).`);
  const attachments = {};
  for (const task of model.imageTasks.values()) attachments[task.key] = await processImage(task, previous.attachments?.[task.key], config.url);
  console.log('Publishing public Uma timeline data.');
  for (const card of model.supportCards) {
    card.image = card.imageTaskKey ? attachments[card.imageTaskKey].image : null;
    delete card.imageTaskKey;
  }
  writeJsonAtomic(OUTPUT_FILE, { schemaVersion: 1, generatedAt: new Date().toISOString(), scenarios: model.scenarios, pvpEvents: model.events, supportCards: model.supportCards });
  writeJsonAtomic(MANIFEST_FILE, { sourceFingerprint, attachments });
  console.log(`Wrote public/data/uma/timeline.json with ${model.scenarios.length} scenario(s), ${model.events.length} PvP event(s), and ${model.supportCards.length} support card(s).`);
}

main().catch((error) => { console.error(`Uma NocoDB sync failed: ${error.message}`); process.exitCode = 1; });

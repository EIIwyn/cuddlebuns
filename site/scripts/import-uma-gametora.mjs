#!/usr/bin/env node
// Seeds and refreshes the Uma NocoDB tables from GameTora. Dry run by default; writes only with --apply.
// Design: docs/2026-09-07-uma-gametora-import-design.md
import path from 'node:path';
import { SITE_DIR, loadEnvironment } from './lib/env.mjs';
import { createNocodbClient } from './lib/nocodb.mjs';
import { createGametoraClient } from './gametora/client.mjs';
import { transformScenarios, transformEvents, transformSupportCards } from './gametora/transform.mjs';
import { buildPlan } from './gametora/plan.mjs';
import { checkSchema, applyPlan } from './gametora/apply.mjs';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const NO_FETCH = args.has('--no-fetch');
const JSON_OUTPUT = args.has('--json');
const CACHE_DIR = path.join(SITE_DIR, '.cache', 'gametora');
const DATASETS = {
  scenarios: 'scenarios',
  foresight: 'en/foresight/timeline',
  jpChampionsMeetings: 'events/champions-meeting',
  supportCards: 'support-cards',
  predictedReleases: 'en/foresight/predicted_releases',
};

function getConfig() {
  const names = {
    url: 'UMA_NOCODB_URL', token: 'UMA_NOCODB_TOKEN', baseId: 'UMA_NOCODB_BASE_ID',
    scenarios: 'UMA_IMPORT_NOCODB_SCENARIOS_TABLE_ID', pvp_events: 'UMA_IMPORT_NOCODB_PVP_EVENTS_TABLE_ID', support_cards: 'UMA_IMPORT_NOCODB_SUPPORT_CARDS_TABLE_ID',
  };
  const config = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, process.env[name]?.trim()]));
  const missing = Object.entries(config).filter(([, value]) => !value || value.startsWith('YOUR_')).map(([key]) => names[key]);
  if (missing.length) throw new Error(`Missing importer configuration: ${missing.join(', ')}. The UMA_IMPORT_* variables must name the tables the importer may write to.`);
  config.url = config.url.replace(/\/+$/, '');
  config.userAgent = process.env.GAMETORA_USER_AGENT?.trim() || undefined;
  return config;
}

function info(message) { (JSON_OUTPUT ? console.error : console.log)(message); }

function describeChange(column, { from, to }) { return `${column}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`; }

function printPlan(table, plan) {
  const { summary } = plan;
  console.log(`\n== ${table}: ${Object.entries(summary).filter(([, n]) => n).map(([action, n]) => `${n} ${action}`).join(', ') || 'nothing'}`);
  for (const entry of plan.entries) {
    if (entry.action === 'skip') continue;
    const parts = Object.entries(entry.changes).map(([column, change]) => describeChange(column, change));
    if (entry.link) parts.push(`${entry.link.field}: ${JSON.stringify(entry.link.from)} -> ${JSON.stringify(entry.link.to)}`);
    const where = entry.recordId ? `record ${entry.recordId}` : 'new row';
    const extras = [entry.suggestion && `suggest ${entry.suggestion}`, entry.note].filter(Boolean);
    console.log(`  [${entry.action}] ${entry.label} (${where})${parts.length ? `\n      ${parts.join('\n      ')}` : ''}${extras.length ? `\n      ${extras.join('\n      ')}` : ''}`);
  }
}

async function loadDatasets(gametora) {
  const manifest = await gametora.loadManifest();
  const datasets = {};
  for (const [name, key] of Object.entries(DATASETS)) {
    datasets[name] = await gametora.loadDataset(manifest, key);
    if (datasets[name] == null) console.warn(`GameTora manifest has no "${key}"; dependent rows will be skipped.`);
  }
  return datasets;
}

function scenarioIdMap(records) {
  const map = new Map();
  for (const record of records) {
    const id = Number(record.fields?.gametora_id);
    if (Number.isFinite(id) && !map.has(id)) map.set(id, record.id);
  }
  return map;
}

async function main() {
  loadEnvironment();
  const config = getConfig();
  const gametora = createGametoraClient({ cacheDir: CACHE_DIR, noFetch: NO_FETCH, userAgent: config.userAgent });
  const datasets = await loadDatasets(gametora);

  const scenarios = transformScenarios({ scenarios: datasets.scenarios ?? [], foresight: datasets.foresight ?? {} });
  const events = transformEvents({ foresight: datasets.foresight ?? {}, jpChampionsMeetings: datasets.jpChampionsMeetings ?? [], scenarioRows: scenarios.rows });
  const cards = transformSupportCards({ supportCards: datasets.supportCards ?? [], predictedReleases: datasets.predictedReleases ?? {} });
  for (const warning of [...scenarios.warnings, ...events.warnings, ...cards.warnings]) console.warn(`- ${warning}`);
  info(`GameTora: ${scenarios.rows.length} scenario(s), ${events.rows.length} Champions Meeting(s), ${cards.rows.length} support card(s) with a global date (${cards.skippedNoGlobalDate} without one skipped).`);

  const client = createNocodbClient({ url: config.url, token: config.token, baseId: config.baseId });
  const tables = [
    ['scenarios', config.scenarios, scenarios.rows],
    ['pvp_events', config.pvp_events, events.rows],
    ['support_cards', config.support_cards, cards.rows],
  ];
  const state = {};
  const schemaErrors = [];
  for (const [table, tableId, candidates] of tables) {
    const meta = await client.getTableMeta(tableId);
    const { errors, columnIdByTitle } = checkSchema({ table, meta, candidates });
    schemaErrors.push(...errors);
    state[table] = { tableId, candidates, columnIdByTitle, existing: await client.fetchAllRecords(tableId, table) };
  }
  if (schemaErrors.length) {
    console.error(`Schema check failed with ${schemaErrors.length} issue(s); nothing written:`);
    for (const error of schemaErrors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const output = {};
  let failures = 0;
  let scenarioIds = scenarioIdMap(state.scenarios.existing);
  for (const [table] of tables) {
    const { tableId, candidates, columnIdByTitle, existing } = state[table];
    const plan = buildPlan({ table, candidates, existing, scenarioRecordIdByGametoraId: scenarioIds });
    output[table] = plan;
    if (!JSON_OUTPUT) printPlan(table, plan);
    if (!APPLY) continue;
    const result = await applyPlan({ client, tableId, plan, linkFieldId: columnIdByTitle.get('scenario') ?? null });
    info(`  applied ${table}: ${result.created} created, ${result.updated} updated, ${result.failures.length} failed.`);
    failures += result.failures.length;
    if (table === 'scenarios') scenarioIds = scenarioIdMap(await client.fetchAllRecords(tableId, table));
  }
  if (JSON_OUTPUT) console.log(JSON.stringify(output, null, 2));
  if (!APPLY) info('\nDry run only. Re-run with --apply to write the plan above.');
  if (failures) process.exitCode = 1;
}

main().catch((error) => { console.error(`Uma GameTora import failed: ${error.message}`); process.exitCode = 1; });

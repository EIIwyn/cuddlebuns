import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_COLUMNS, checkSchema, fieldsForEntry, applyPlan } from '../gametora/apply.mjs';
import { BATCH_SIZE } from '../lib/nocodb.mjs';

const col = (title, uidt = 'SingleLineText', options = null) => ({ id: `c_${title}`, title, uidt, options });
const eventMeta = { columns: [
  ...REQUIRED_COLUMNS.pvp_events.filter((t) => !['weather', 'racecourse', 'status', 'scenario'].includes(t)).map((t) => col(t)),
  col('weather', 'SingleSelect', ['Sunny', 'Cloudy', 'Rain', 'Snow']),
  col('racecourse', 'SingleSelect', ['Kyoto', 'Nakayama']),
  col('status', 'SingleSelect', ['confirmed', 'projected']),
  col('scenario', 'LinkToAnotherRecord'),
] };
const candidate = (facts) => ({ gametoraId: 1, label: 'x', facts, seeds: {}, scenarioGametoraId: null, note: null });

test('checkSchema passes when every column and option exists and returns column ids', () => {
  const { errors, columnIdByTitle } = checkSchema({ table: 'pvp_events', meta: eventMeta, candidates: [candidate({ weather: 'Rain', racecourse: 'Kyoto', status: 'projected' })] });
  assert.deepEqual(errors, []);
  assert.equal(columnIdByTitle.get('scenario'), 'c_scenario');
});

test('checkSchema reports missing columns and missing select options', () => {
  const meta = { columns: eventMeta.columns.filter((c) => c.title !== 'lock_facts') };
  const { errors } = checkSchema({ table: 'pvp_events', meta, candidates: [candidate({ weather: 'Rain', racecourse: 'Hakodate', status: 'projected' })] });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /missing column.*lock_facts/);
  assert.match(errors[1], /racecourse.*Hakodate/);
});

test('fieldsForEntry collects the target values and skips the link', () => {
  const entry = { action: 'create', changes: { gametora_id: { from: null, to: 19 }, name: { from: null, to: 'CM19' }, start_date: { from: '2026-09-17', to: '2026-09-20' } }, link: { field: 'scenario', from: null, to: '3' } };
  assert.deepEqual(fieldsForEntry(entry), { gametora_id: 19, name: 'CM19', start_date: '2026-09-20' });
});

function stubClient(failOn = () => false) {
  const calls = [];
  let nextId = 100;
  return {
    calls,
    async createRecords(tableId, fieldsList) { calls.push(['create', tableId, fieldsList]); if (failOn('create', fieldsList)) throw new Error('boom'); return fieldsList.map(() => ({ id: String(nextId++) })); },
    async updateRecords(tableId, updates) { calls.push(['update', tableId, updates]); if (failOn('update', updates)) throw new Error('boom'); },
    async linkRecords(tableId, field, recordId, ids) { calls.push(['link', tableId, field, recordId, ids]); },
    async unlinkRecords(tableId, field, recordId, ids) { calls.push(['unlink', tableId, field, recordId, ids]); },
  };
}
const quiet = { log() {}, warn() {}, error() {} };

test('applyPlan creates with inline links, updates, then relinks, and reports counts', async () => {
  const client = stubClient();
  const plan = { entries: [
    { action: 'create', recordId: null, changes: { gametora_id: { from: null, to: 45 }, name: { from: null, to: 'CM45' } }, link: { field: 'scenario', from: null, to: '2' } },
    { action: 'create', recordId: null, changes: { gametora_id: { from: null, to: 46 } }, link: { field: 'scenario', from: null, to: 'new:14' } },
    { action: 'link', recordId: '7', changes: { gametora_id: { from: null, to: 19 }, start_date: { from: 'a', to: 'b' } }, link: null },
    { action: 'update', recordId: '8', changes: {}, link: { field: 'scenario', from: '1', to: '2' } },
    { action: 'skip', recordId: '9', changes: {}, link: null },
    { action: 'locked', recordId: '10', changes: {}, link: null },
  ] };
  const result = await applyPlan({ client, tableId: 't', plan, linkFieldId: 'lnk', log: quiet });
  assert.deepEqual(result, { created: 2, updated: 2, failures: [] });
  assert.deepEqual(client.calls[0], ['create', 't', [{ gametora_id: 45, name: 'CM45', scenario: [{ id: '2' }] }, { gametora_id: 46 }]]);
  assert.deepEqual(client.calls[1], ['update', 't', [{ id: '7', fields: { gametora_id: 19, start_date: 'b' } }]]);
  assert.deepEqual(client.calls[2], ['unlink', 't', 'lnk', '8', ['1']]);
  assert.deepEqual(client.calls[3], ['link', 't', 'lnk', '8', ['2']]);
});

test('applyPlan batches creates by BATCH_SIZE and keeps going after a failed batch', async () => {
  const client = stubClient((op, batch) => op === 'create' && batch[0].gametora_id === 0);
  const plan = { entries: Array.from({ length: BATCH_SIZE + 3 }, (_, i) => ({ action: 'create', recordId: null, changes: { gametora_id: { from: null, to: i } }, link: null })) };
  const result = await applyPlan({ client, tableId: 't', plan, log: quiet });
  assert.equal(client.calls.filter((c) => c[0] === 'create').length, 2);
  assert.equal(result.created, 3);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /boom/);
});

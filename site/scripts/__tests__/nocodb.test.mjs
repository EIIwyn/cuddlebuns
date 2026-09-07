import test from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_SIZE, createNocodbClient } from '../lib/nocodb.mjs';

function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers };
    calls.push(call);
    const result = handler(call, calls.length);
    return { ok: true, status: 200, statusText: 'OK', json: async () => result };
  };
  return { fetchImpl, calls };
}

const config = { url: 'https://noco.example/', token: 'tok', baseId: 'base1' };

test('fetchAllRecords follows next links and rebases them on the configured URL', async () => {
  const { fetchImpl, calls } = stubFetch((call, n) => (n === 1
    ? { records: [{ id: 1, fields: { name: 'a' } }], next: 'https://internal.host/api/v3/data/base1/t1/records?page=2' }
    : { records: [{ id: 2, fields: { name: 'b' } }], next: null }));
  const client = createNocodbClient({ ...config, fetchImpl });
  const records = await client.fetchAllRecords('t1', 'things');
  assert.deepEqual(records.map((r) => r.id), ['1', '2']);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.startsWith('https://noco.example/api/v3/data/base1/t1/records?'));
  assert.ok(calls[0].url.includes('linksAsLtar=true'));
  assert.ok(calls[1].url.startsWith('https://noco.example/api/v3/data/base1/t1/records?page=2'));
  assert.equal(calls[0].headers['xc-token'], 'tok');
});

test('getTableMeta exposes column ids, titles, types and select options', async () => {
  const { fetchImpl, calls } = stubFetch(() => ({ columns: [
    { id: 'c1', title: 'name', uidt: 'SingleLineText' },
    { id: 'c2', title: 'weather', uidt: 'SingleSelect', colOptions: { options: [{ title: 'Sunny' }, { title: 'Rain' }] } },
    { id: 'c3', title: 'scenario', uidt: 'LinkToAnotherRecord' },
  ] }));
  const client = createNocodbClient({ ...config, fetchImpl });
  const meta = await client.getTableMeta('t1');
  assert.equal(calls[0].url, 'https://noco.example/api/v2/meta/tables/t1');
  assert.deepEqual(meta.columns, [
    { id: 'c1', title: 'name', uidt: 'SingleLineText', options: null },
    { id: 'c2', title: 'weather', uidt: 'SingleSelect', options: ['Sunny', 'Rain'] },
    { id: 'c3', title: 'scenario', uidt: 'LinkToAnotherRecord', options: null },
  ]);
});

test('createRecords batches by BATCH_SIZE and returns ids in order', async () => {
  const { fetchImpl, calls } = stubFetch((call) => ({ records: call.body.map((record, i) => ({ id: 100 + i, fields: record.fields })) }));
  const client = createNocodbClient({ ...config, fetchImpl });
  const fieldsList = Array.from({ length: 23 }, (_, i) => ({ name: `row${i}` }));
  const created = await client.createRecords('t1', fieldsList);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.length, BATCH_SIZE);
  assert.deepEqual(calls[0].body[0], { fields: { name: 'row0' } });
  assert.equal(created.length, 23);
  assert.equal(created[0].id, '100');
});

test('updateRecords sends PATCH batches of { id, fields }', async () => {
  const { fetchImpl, calls } = stubFetch((call) => ({ records: call.body.map((r) => ({ id: r.id })) }));
  const client = createNocodbClient({ ...config, fetchImpl });
  await client.updateRecords('t1', [{ id: '5', fields: { name: 'x' } }, { id: '6', fields: { name: 'y' } }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PATCH');
  assert.deepEqual(calls[0].body, [{ id: '5', fields: { name: 'x' } }, { id: '6', fields: { name: 'y' } }]);
});

test('linkRecords and unlinkRecords hit the links endpoint with { id } arrays', async () => {
  const { fetchImpl, calls } = stubFetch(() => ({ success: true }));
  const client = createNocodbClient({ ...config, fetchImpl });
  await client.linkRecords('t1', 'lnk1', '7', ['3']);
  await client.unlinkRecords('t1', 'lnk1', '7', ['1']);
  assert.equal(calls[0].url, 'https://noco.example/api/v3/data/base1/t1/links/lnk1/7');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, [{ id: '3' }]);
  assert.equal(calls[1].method, 'DELETE');
  assert.deepEqual(calls[1].body, [{ id: '1' }]);
});

test('non-OK responses throw with the label and status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) });
  const client = createNocodbClient({ ...config, fetchImpl });
  await assert.rejects(() => client.fetchAllRecords('t1', 'Scenarios'), /Scenarios request failed: 401 Unauthorized/);
});

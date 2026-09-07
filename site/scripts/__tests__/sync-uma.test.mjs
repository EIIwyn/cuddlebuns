import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../sync-uma-nocodb.mjs';

const scenarioRecords = [{ id: '1', fields: { name: 'Grand Live', slug: 'grandlive', era_start: '2026-07-22', era_end: '2026-11-28' } }];
const eventRecords = [{ id: '1', fields: { name: 'CM19 Scorpio', slug: 'cm19', start_date: '2026-09-17', end_date: '2026-09-23', scenario: [{ id: 1 }], status: 'projected' } }];
const card = (id, fields) => ({ id: String(id), fields: { name: `card${id}`, character_name: 'Oguri Cap', card_type: 'Wit', styles: [], breakpoints: [], pvp_events: [], ...fields } });

test('only rated cards are published and the rest are counted', () => {
  const model = createModel(scenarioRecords, eventRecords, [card(1, { rating: 'Borrow' }), card(2, { rating: '' }), card(3, {})]);
  assert.deepEqual(model.supportCards.map((c) => c.id), ['1']);
  assert.equal(model.unrated, 2);
});

test('rarity and title are published as strings or null', () => {
  const model = createModel(scenarioRecords, eventRecords, [card(1, { rating: 'Borrow', rarity: 'SSR', title: '[Run Forth!]' }), card(2, { rating: 'Borrow' })]);
  assert.equal(model.supportCards[0].rarity, 'SSR');
  assert.equal(model.supportCards[0].title, '[Run Forth!]');
  assert.equal(model.supportCards[1].rarity, null);
  assert.equal(model.supportCards[1].title, null);
});

test('a card with an attachment uses it; without one but with a gametora_id it gets a GameTora task', () => {
  const attachment = { id: 'att1', signedPath: 'dltemp/x.png', title: '30146-oguri.png' };
  const model = createModel(scenarioRecords, eventRecords, [
    card(1, { rating: 'Borrow', image: [attachment], gametora_id: 30146 }),
    card(2, { rating: 'Borrow', gametora_id: 30118 }),
    card(3, { rating: 'Borrow' }),
  ]);
  const tasks = [...model.imageTasks.values()];
  assert.deepEqual(tasks.map((t) => t.kind), ['attachment', 'gametora']);
  assert.equal(tasks[1].gametoraId, 30118);
  assert.equal(model.supportCards[0].imageTaskKey, 'support-card:1:att1');
  assert.equal(model.supportCards[1].imageTaskKey, 'gametora:30118');
  assert.equal(model.supportCards[2].imageTaskKey, null);
  assert.equal(model.events[0].status, 'projected');
});

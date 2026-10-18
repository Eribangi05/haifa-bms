import { test } from 'node:test';
import assert from 'node:assert/strict';
import { counterChoices, proposalChoices } from '../src/lib/negotiation.ts';

test('proposal choices: 5% steps down to the largest discount, rounded up to 50 so the server accepts them, never the usual price', () => {
  const c = proposalChoices(4200, 20);
  assert.deepEqual(c.map((x) => x.pct), [5, 10, 15, 20]);
  for (const x of c) assert.ok(x.amount % 50 === 0 && x.amount < 4200 && x.amount >= Math.ceil((4200 * 80) / 100));
  assert.deepEqual(proposalChoices(4200, 10).map((x) => x.pct), [5, 10]);
  assert.deepEqual(proposalChoices(900, 20).every((x) => x.amount < 900), true);
  assert.deepEqual(proposalChoices(100, 5), [], 'a price too small to discount offers nothing');
});

test('counter choices: strictly above the proposal, at most the usual price, no duplicates', () => {
  assert.deepEqual(counterChoices(3500, 4200), [3750, 4000, 4200]);
  assert.deepEqual(counterChoices(4150, 4200), [4200]);
  assert.deepEqual(counterChoices(4200, 4200), []);
});

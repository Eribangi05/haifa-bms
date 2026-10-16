import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementText, type StatementView } from '../src/lib/statement.ts';

const tr = (k: string, v?: Record<string, string | number>) => `[${k}${v ? ' ' + JSON.stringify(v) : ''}]`;
const base: StatementView = { statement_no: '20261012-AB12', week: 0, from: '2026-10-12', to: '2026-10-18', driver: 'Eric Mugisha',
  days: [{ day: '2026-10-12', trips: 4, fares: 21000, commission: 3150, fleet_share: 0, net: 17850, cash: 12000 }, { day: '2026-10-13', trips: 2, fares: 9000, commission: 1350, fleet_share: 0, net: 7650, cash: 0 }],
  totals: { trips: 6, fares: 30000, commission: 4500, fleet_share: 0, net: 25500, cash: 12000 }, paid_out: { amount: 0, n: 0 }, rating: { avg: 4.456, count: 5 } };

test('statement text: header, one line per day, totals, no empty optional lines', () => {
  const t = statementText(base, tr).split('\n');
  assert.equal(t[0], '[st.msg.head {"no":"20261012-AB12"}]');
  assert.ok(t.includes('12/10: [st.msg.day {"trips":4,"net":"17,850 RWF"}]'));
  assert.ok(t.includes('[st.net]: 25,500 RWF') && t.includes('[st.rating]: 4.46 (5)'));
  assert.ok(!t.some((l) => l.startsWith('[st.paid]') || l.startsWith('[st.fleet]')), 'paid out and fleet share only when there is something');
  assert.ok(!statementText(base, tr).includes('\n\n\n'));
});

test('statement text: a quiet week says so, and a payout or fleet share appears', () => {
  const quiet = statementText({ ...base, days: [], totals: { trips: 0, fares: 0, commission: 0, fleet_share: 0, net: 0, cash: 0 }, rating: { avg: 0, count: 0 } }, tr);
  assert.match(quiet, /\[st\.none\]/); assert.doesNotMatch(quiet, /st\.rating/);
  const full = statementText({ ...base, totals: { ...base.totals, fleet_share: 900 }, paid_out: { amount: 20000, n: 1 } }, tr);
  assert.match(full, /\[st\.paid\]: 20,000 RWF/); assert.match(full, /\[st\.fleet\]: 900 RWF/);
});

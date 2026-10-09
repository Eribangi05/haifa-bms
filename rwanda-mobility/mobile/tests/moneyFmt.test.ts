import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimCanAddInfo, claimCanReply, claimCanWithdraw, claimFormValid, claimRoute, claimTone, creditBookingFields, creditForPoints, depositMinutesLeft, depositUi, dueIn, entryAmount, entryInfo, receiptParts, redeemChoices, signedRwf, splitCredit, tierProgress, validRedeem } from '../src/lib/moneyFmt.ts';

test('splitCredit: none, partial, full, custom and clamping', () => {
  assert.deepEqual(splitCredit(2000, 5000, false), { mode: 'none', credit: 0, remainder: 2000 });
  assert.deepEqual(splitCredit(2000, 0, true), { mode: 'none', credit: 0, remainder: 2000 });
  assert.deepEqual(splitCredit(2000, 5000, true), { mode: 'full', credit: 2000, remainder: 0 });
  assert.deepEqual(splitCredit(2000, 400, true), { mode: 'partial', credit: 400, remainder: 1600 });
  assert.deepEqual(splitCredit(2000, 5000, true, 500), { mode: 'partial', credit: 500, remainder: 1500 });
  assert.deepEqual(splitCredit(2000, 5000, true, 9999), { mode: 'full', credit: 2000, remainder: 0 });
  assert.deepEqual(splitCredit(2000, 300, true, 900), { mode: 'partial', credit: 300, remainder: 1700 });
  assert.equal(splitCredit(2000, 5000, true, 0).mode, 'none');
  assert.equal(splitCredit(null, 5000, true).mode, 'none');
});
test('creditBookingFields follows the contract', () => {
  assert.deepEqual(creditBookingFields({ mode: 'none', credit: 0, remainder: 10 }, 'cash'), { payment_method: 'cash' });
  assert.deepEqual(creditBookingFields({ mode: 'full', credit: 10, remainder: 0 }, 'mtn_momo'), { payment_method: 'wallet' });
  assert.deepEqual(creditBookingFields({ mode: 'partial', credit: 4, remainder: 6 }, 'mtn_momo'), { payment_method: 'wallet_partial', wallet_amount: 4, remainder_method: 'mtn_momo' });
  assert.equal((creditBookingFields({ mode: 'partial', credit: 4, remainder: 6 }, 'airtel_money') as any).remainder_method, 'cash');
});
test('receiptParts: credit, deposit and the rest', () => {
  const p = receiptParts({ final_fare: 5000, wallet: { mode: 'partial', reserved: 3000, applied: 3000 }, deposit: { applied: 1000, refunded: 200 }, payment: { amount: 1000, method: 'cash' } });
  assert.equal(p.credit, 3000); assert.equal(p.deposit, 1000); assert.equal(p.other, 1000); assert.equal(p.refundedCredit, 200); assert.ok(p.hasExtra);
  assert.equal(receiptParts({ final_fare: 800 }).hasExtra, false);
  assert.equal(receiptParts({ final_fare: 500, wallet: { mode: 'full', reserved: 900, applied: 900 } }).other, 0);
});
test('redeem steps and credit value', () => {
  assert.deepEqual(redeemChoices(700, 500, 100), [500, 600, 700]);
  assert.deepEqual(redeemChoices(450, 500, 100), []);
  assert.deepEqual(redeemChoices(750, 500, 100), [500, 600, 700]);
  const big = redeemChoices(10000, 100, 100, 6); assert.equal(big.length, 6); assert.equal(big[0], 100); assert.equal(big[5], 10000);
  assert.ok(validRedeem(500, 500, 100, 700)); assert.ok(!validRedeem(550, 500, 100, 700)); assert.ok(!validRedeem(400, 500, 100, 700)); assert.ok(!validRedeem(800, 500, 100, 700));
  assert.equal(creditForPoints(500, 100), 500); assert.equal(creditForPoints(300, 50), 150);
});
test('tierProgress', () => {
  const tiers = [{ tier: 'bronze', min_points: 0, bonus_pct: 0, extra_free_cancel_s: 0 }, { tier: 'silver', min_points: 2000, bonus_pct: 10, extra_free_cancel_s: 30 }, { tier: 'gold', min_points: 10000, bonus_pct: 25, extra_free_cancel_s: 60 }];
  assert.deepEqual(tierProgress(1000, tiers, 'bronze'), { ratio: 0.5, next: tiers[1], needed: 1000 });
  assert.equal(tierProgress(2500, tiers, 'silver').needed, 7500);
  assert.equal(tierProgress(20000, tiers, 'gold').ratio, 1); assert.equal(tierProgress(20000, tiers, 'gold').next, null);
});
test('statement mapping and signed amounts', () => {
  assert.deepEqual(entryInfo({ kind: 'credit', source: 'refund' }), { key: 'refund', glyph: '↩️' });
  assert.equal(entryInfo({ kind: 'credit', source: 'loyalty' }).key, 'loyalty');
  assert.equal(entryInfo({ kind: 'credit', source: 'goodwill' }).key, 'adjustment');
  assert.equal(entryInfo({ kind: 'spend', source: 'booking' }).key, 'spend');
  assert.equal(entryInfo({ kind: 'spend', source: 'deposit' }).key, 'deposit');
  assert.equal(entryInfo({ kind: 'expire', source: 'expiry' }).key, 'expire');
  assert.equal(entryAmount({ kind: 'spend', available_delta: 0, held_delta: -2050 }), -2050);
  assert.equal(entryAmount({ kind: 'credit', available_delta: 500, held_delta: 0 }), 500);
  assert.equal(signedRwf(1500), '+1,500'); assert.equal(signedRwf(-2050), '-2,050'); assert.equal(signedRwf(0), '0');
});
test('deposit states come only from the server status', () => {
  assert.equal(depositUi(null), 'none'); assert.equal(depositUi({ required: false, status: 'paid' }), 'none');
  const m: Record<string, string> = { awaiting_payment: 'ask', pending: 'pending', failed: 'failed', paid: 'paid', captured: 'paid', applied: 'applied', refunded: 'refunded', cancelled: 'refunded', expired: 'closed' };
  for (const [k, v] of Object.entries(m)) assert.equal(depositUi({ required: true, status: k }), v, k);
  const now = Date.parse('2026-10-08T10:00:00Z');
  assert.equal(depositMinutesLeft('2026-10-08T10:12:00Z', now), 12); assert.equal(depositMinutesLeft('2026-10-08T09:00:00Z', now), 0); assert.equal(depositMinutesLeft(null, now), null);
});
test('claims: tone, permissions, due, validation, routing', () => {
  assert.equal(claimTone('rejected'), 'bad'); assert.equal(claimTone('settled'), 'ok'); assert.equal(claimTone('under_review'), 'warn');
  assert.ok(claimCanWithdraw({ status: 'submitted', you_are: 'claimant' })); assert.ok(!claimCanWithdraw({ status: 'accepted', you_are: 'claimant' })); assert.ok(!claimCanWithdraw({ status: 'submitted', you_are: 'respondent' }));
  assert.ok(claimCanReply({ status: 'under_review', you_are: 'respondent' })); assert.ok(!claimCanReply({ status: 'closed', you_are: 'respondent' }));
  assert.ok(claimCanAddInfo({ status: 'info_requested', you_are: 'claimant' })); assert.ok(!claimCanAddInfo({ status: 'under_review', you_are: 'claimant' }));
  const now = Date.parse('2026-10-08T10:00:00Z');
  assert.deepEqual(dueIn('2026-10-08T12:30:00Z', now), { late: false, hours: 3, days: 1 }); assert.equal(dueIn('2026-10-08T08:00:00Z', now)?.late, true); assert.equal(dueIn(null), null);
  assert.ok(claimFormValid('Scratch on the door', '40000')); assert.ok(!claimFormValid('short', '40000')); assert.ok(!claimFormValid('Scratch on the door', '0')); assert.ok(!claimFormValid('Scratch on the door', '12.5'));
  assert.deepEqual(claimRoute({ template_key: 'claim_received', ref: 'CL-1' }), { name: 'claims', params: { ref: 'CL-1' } });
  assert.deepEqual(claimRoute({ claim_id: 'abc' }), { name: 'claimDetail', params: { id: 'abc' } });
  assert.equal(claimRoute({ template_key: 'driver_assigned' }), null); assert.equal(claimRoute(null), null);
});

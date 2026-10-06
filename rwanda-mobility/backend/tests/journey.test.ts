import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, KCC, KIMIRONKO, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const ledgerBalanced = async () => {
  const r = await t.db.q1<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries');
  assert.equal(r.d, r.c, 'ledger must balance');
};

test('estimate lists only services with real eligible drivers, never fakes availability', async () => {
  const p = await t.register();
  const none = await t.estimate(p.token);
  assert.equal(none.status, 200);
  assert.ok(none.json.options.every((o: any) => o.available === false), 'no drivers online yet');
  assert.ok(none.json.alternatives.includes('schedule_later'));
  await t.driver({ vehicle: 'moto' });
  const e = await t.estimate(p.token);
  const moto = e.json.options.find((o: any) => o.service_id === 'moto');
  const std = e.json.options.find((o: any) => o.service_id === 'standard');
  assert.equal(moto.available, true);
  assert.ok(moto.quote_id && moto.fare.total >= 800 && moto.is_estimate);
  assert.equal(std.available, false);                   // no car online
  assert.equal(std.reason, 'no_drivers_nearby');
  assert.equal(std.quote_id, null);
});

test('pickup outside coverage is rejected', async () => {
  const p = await t.register();
  const r = await t.api('POST', '/fares/estimate', { token: p.token, body: { pickup: { lat: -1.5, lng: 29.6 }, dest: KIMIRONKO } });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, 'pickup_outside_coverage');
});

test('full cash journey: book -> offer -> accept -> arrive -> PIN -> complete -> cash -> receipt -> rating', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res, quote } = await t.book(p.token, 'moto', 'cash');
  assert.equal(res.status, 201);
  const id = res.json.booking.id;
  assert.equal(res.json.booking.status, 'SEARCHING_DRIVER');       // not "assigned" until a driver commits
  assert.equal(res.json.booking.driver, undefined);

  const offers = await t.api('GET', '/drivers/me/offers', { token: d.token });
  assert.equal(offers.json.offers.length, 1);
  assert.ok(offers.json.offers[0].driver_net > 0, 'driver sees estimated earnings before accepting');
  assert.ok(offers.json.offers[0].driver_net < quote.fare.total);

  const done = await t.runTrip(p, d, id);
  assert.equal(done.status, 'PAYMENT_PENDING');
  assert.equal(done.final_fare, quote.fare.total, 'final fare equals the accepted estimate');
  assert.equal(done.payment.status, 'PENDING'); assert.equal(done.payment.outstanding, done.final_fare);

  const cash = await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare } });
  assert.equal(cash.json.status, 'SUCCESS');
  const v = await t.api('GET', `/bookings/${id}`, { token: p.token });
  assert.equal(v.json.status, 'PAYMENT_COMPLETED');
  assert.equal(v.json.driver.name.startsWith('Test Driver'), true);

  const e = await t.db.q1<any>('select * from driver_earnings where booking_id=$1', [id]);
  assert.equal(e.commission + e.net, e.fare_subtotal);              // 12% moto commission
  assert.equal(e.commission, Math.floor((e.commissionable * 1200 + 5000) / 10000));
  assert.equal(e.collected_by, 'driver');
  await ledgerBalanced();
  const bal = await t.api('GET', '/drivers/me/wallet', { token: d.token });
  assert.equal(bal.json.balance.cash_held, done.final_fare);
  assert.equal(bal.json.balance.owed_to_platform, e.commission);    // driver kept the cash, owes only the commission
  assert.equal(bal.json.balance.eligible_payout, 0);

  const rc = await t.api('GET', `/bookings/${id}/receipt`, { token: p.token });
  assert.equal(rc.status, 200); assert.equal(rc.json.total, done.final_fare);
  const rate = await t.api('POST', `/bookings/${id}/ratings`, { token: p.token, body: { score: 5, comment: 'Great' } });
  assert.equal(rate.status, 200);
  const dup = await t.api('POST', `/bookings/${id}/ratings`, { token: p.token, body: { score: 1 } });
  assert.equal(dup.status, 409);
  const drate = await t.api('POST', `/bookings/${id}/ratings`, { token: d.token, body: { score: 4 } });
  assert.equal(drate.status, 200);
  const st = await t.api('GET', '/drivers/me/status', { token: d.token });
  assert.equal(Number(st.json.profile.rating_avg), 5);
});

test('trip cannot start with a wrong PIN, locks after 5 attempts, and is not startable without arrival', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  await t.api('POST', '/drivers/me/location', { token: d.token, body: KCC });
  const early = await t.api('POST', `/bookings/${id}/start`, { token: d.token, body: { pin: '0000' } });
  assert.equal(early.status, 409);                                  // not arrived yet
  assert.equal((await t.api('POST', `/bookings/${id}/arrived`, { token: d.token })).status, 200);
  const pin = (await t.api('GET', `/bookings/${id}`, { token: p.token })).json.trip_pin;
  const wrong = pin === '1234' ? '4321' : '1234';
  for (let i = 0; i < 5; i++) assert.equal((await t.api('POST', `/bookings/${id}/start`, { token: d.token, body: { pin: wrong } })).status, 400);
  const locked = await t.api('POST', `/bookings/${id}/start`, { token: d.token, body: { pin } });
  assert.equal(locked.status, 423);                                 // correct PIN no longer accepted: contact support
  // an authorised, logged exception is the only way past the PIN
  const dispatcher = await t.staff('dispatcher');
  const noReason = await t.api('POST', `/admin/bookings/${id}/pin-override`, { token: dispatcher.token, body: { reason: 'short' } });
  assert.equal(noReason.status, 400);
  const ok = await t.api('POST', `/admin/bookings/${id}/pin-override`, { token: dispatcher.token, body: { reason: 'Passenger phone dead, verified identity by call' } });
  assert.equal(ok.status, 200); assert.equal(ok.json.status, 'IN_PROGRESS');
  const log = await t.db.q1<any>("select count(*)::int n from audit_logs where action='booking.pin_override' and entity_id=$1", [id]);
  assert.equal(log.n, 1);
  await t.api('POST', `/bookings/${id}/complete`, { token: d.token });
});

test('driver cannot arrive while far from pickup (stale/far location)', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto', at: { lat: KCC.lat - 0.015, lng: KCC.lng } });   // ~1.7 km away: dispatchable but not at the pickup
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  assert.equal((await t.api('POST', `/bookings/${id}/accept`, { token: d.token })).status, 200);
  const far = await t.api('POST', `/bookings/${id}/arrived`, { token: d.token });
  assert.equal(far.status, 409); assert.equal(far.json.error.code, 'too_far_from_pickup');
});

test('concurrent acceptance: exactly one driver wins and the other gets a clean conflict', async () => {
  const p = await t.register();
  const ds = await Promise.all([t.driver({ vehicle: 'moto' }), t.driver({ vehicle: 'moto' }), t.driver({ vehicle: 'moto' })]);
  await t.db.q("update system_settings set value='3' where key='dispatch.group_size'");   // may not exist yet
  await t.db.q("insert into system_settings(key,value) values ('dispatch.group_size','3') on conflict (key) do update set value='3'");
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  const offered = await t.db.q<any>("select driver_id from dispatch_offers where booking_id=$1 and status='pending'", [id]);
  assert.equal(offered.length, 3, 'small-group broadcast');
  const results = await Promise.all(ds.map((d) => t.api('POST', `/bookings/${id}/accept`, { token: d.token })));
  const wins = results.filter((r) => r.status === 200), losses = results.filter((r) => r.status === 409);
  assert.equal(wins.length, 1); assert.equal(losses.length, 2);
  const b = await t.db.q1<any>('select driver_id, status from bookings where id=$1', [id]);
  assert.equal(b.status, 'DRIVER_ASSIGNED');
  await t.db.q("delete from system_settings where key='dispatch.group_size'");
});

test('a driver can never hold two conflicting active trips (DB-enforced), and a passenger cannot double-book', async () => {
  const p1 = await t.register(), p2 = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const spare = await t.driver({ vehicle: 'moto', at: { lat: KCC.lat + 0.01, lng: KCC.lng } });
  const a = await t.book(p1.token); assert.equal((await t.api('POST', `/bookings/${a.res.json.booking.id}/accept`, { token: d.token })).status, 200);
  // second passenger's booking: the busy driver is not even offered
  const b = await t.book(p2.token);
  assert.equal(b.res.status, 201);
  const offers = await t.api('GET', '/drivers/me/offers', { token: d.token });
  assert.equal(offers.json.offers.length, 0);
  assert.equal((await t.api('GET', '/drivers/me/offers', { token: spare.token })).json.offers.length, 1);
  const forced = await t.api('POST', `/bookings/${b.res.json.booking.id}/accept`, { token: d.token });
  assert.equal(forced.status, 409);
  // direct DB attempt is blocked by the partial unique index
  await assert.rejects(() => t.db.q("update bookings set driver_id=$1, status='DRIVER_ASSIGNED' where id=$2", [d.id, b.res.json.booking.id]), /one_active_trip_per_driver/);
  // passenger duplicate request
  const dup = await t.estimate(p1.token, { service_id: 'moto' });
  const q2 = dup.json.options[0].quote_id;
  const r = await t.api('POST', '/bookings', { token: p1.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: q2, payment_method: 'cash' } });
  assert.equal(r.status, 409); assert.equal(r.json.error.code, 'active_booking_exists');
});

test('idempotent booking submission: retries return the same booking, never a duplicate', async () => {
  const p = await t.register(); await t.driver({ vehicle: 'moto' });
  const e = await t.estimate(p.token, { service_id: 'moto' }); const quote = e.json.options[0].quote_id;
  const key = randomUUID();
  const mk = () => t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': key }, body: { quote_id: quote, payment_method: 'cash' } });
  const [a, b, c] = await Promise.all([mk(), mk(), mk()]);
  const ids = new Set([a, b, c].map((x) => x.json.booking?.id).filter(Boolean));
  assert.equal(ids.size, 1);
  const n = await t.db.q1<any>('select count(*)::int n from bookings where passenger_id=$1', [p.id]);
  assert.equal(n.n, 1);
  const noKey = await t.api('POST', '/bookings', { token: p.token, body: { quote_id: quote, payment_method: 'cash' } });
  assert.equal(noKey.status, 400);
});

test('driver rejection re-dispatches to the next driver; legitimate reasons are not penalised', async () => {
  const p = await t.register();
  const near = await t.driver({ vehicle: 'moto', at: KCC });
  const far = await t.driver({ vehicle: 'moto', at: { lat: KCC.lat + 0.02, lng: KCC.lng } });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  assert.equal((await t.api('GET', '/drivers/me/offers', { token: near.token })).json.offers.length, 1, 'nearest first (sequential)');
  assert.equal((await t.api('GET', '/drivers/me/offers', { token: far.token })).json.offers.length, 0);
  await t.api('POST', `/bookings/${id}/reject`, { token: near.token, body: { reason: 'safety_concern' } });
  assert.equal((await t.api('GET', '/drivers/me/offers', { token: far.token })).json.offers.length, 1, 'reassigned after rejection');
  const pen = await t.db.q1<any>('select rejected_count from driver_profiles where user_id=$1', [near.id]);
  assert.equal(pen.rejected_count, 0, 'excused reason: no penalty');
  await t.api('POST', `/bookings/${id}/reject`, { token: far.token, body: { reason: 'just_dont_want' } });
  assert.equal((await t.db.q1<any>('select rejected_count from driver_profiles where user_id=$1', [far.id])).rejected_count, 1);
});

test('offer timeout moves on, and after max rounds the passenger gets NO_DRIVER_FOUND with alternatives', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await t.db.q("insert into system_settings(key,value) values ('dispatch.max_rounds','2') on conflict (key) do update set value='2'");
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  const { dispatchSweep } = await import('../src/services/dispatch.ts');
  await t.db.q("update dispatch_offers set expires_at = now() - interval '1 second' where booking_id=$1", [id]);
  await dispatchSweep();                                           // round 1 expired -> round 2 offered to same? (driver already offered: excluded)
  await t.db.q("update bookings set last_round_at = now() - interval '10 seconds' where id=$1", [id]);
  await dispatchSweep();
  const b = await t.db.q1<any>('select status from bookings where id=$1', [id]);
  assert.equal(b.status, 'NO_DRIVER_FOUND');
  const n = await t.api('GET', '/notifications', { token: p.token });
  assert.ok(n.json.notifications.some((x: any) => x.template_key === 'no_driver'));
  await t.db.q("delete from system_settings where key='dispatch.max_rounds'");
  assert.ok(d);
});

test('passenger cancellation: free before assignment and inside grace; fee after grace; none once in progress', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const a = await t.book(p.token); const id = a.res.json.booking.id;
  const c1 = await t.api('POST', `/bookings/${id}/cancel`, { token: p.token, body: { reason: 'changed_mind' } });
  assert.equal(c1.json.status, 'CANCELLED_BY_PASSENGER'); assert.equal(c1.json.cancel_fee, 0);
  const b = await t.book(p.token); const id2 = b.res.json.booking.id;
  await t.api('POST', `/bookings/${id2}/accept`, { token: d.token });
  const c2 = await t.api('POST', `/bookings/${id2}/cancel`, { token: p.token, body: { reason: 'changed_mind' } });
  assert.equal(c2.json.cancel_fee, 0, 'inside grace period');
  const c = await t.book(p.token); const id3 = c.res.json.booking.id;
  await t.api('POST', `/bookings/${id3}/accept`, { token: d.token });
  await t.db.q("update bookings set assigned_at = now() - interval '10 minutes' where id=$1", [id3]);
  const c3 = await t.api('POST', `/bookings/${id3}/cancel`, { token: p.token, body: { reason: 'changed_mind' } });
  assert.equal(c3.json.cancel_fee, 500, 'after grace');
  const e = await t.book(p.token); const id4 = e.res.json.booking.id;
  await t.api('POST', `/bookings/${id4}/accept`, { token: d.token });
  await t.db.q("update bookings set assigned_at = now() - interval '10 minutes' where id=$1", [id4]);
  const c4 = await t.api('POST', `/bookings/${id4}/cancel`, { token: p.token, body: { reason: 'driver_too_far' } });
  assert.equal(c4.json.cancel_fee, 0, 'no fee when the driver is responsible');
});

test('driver cancellation re-searches automatically, counts only unexcused cancels, and charges the passenger nothing', async () => {
  const p = await t.register(); const d1 = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d1.token });
  const d2 = await t.driver({ vehicle: 'moto' });
  const c = await t.api('POST', `/bookings/${id}/cancel`, { token: d1.token, body: { reason: 'tired', as: 'driver' } });
  assert.equal(c.status, 200);
  const b = await t.db.q1<any>('select status, driver_id, cancel_fee from bookings where id=$1', [id]);
  assert.equal(b.status, 'SEARCHING_DRIVER'); assert.equal(b.driver_id, null); assert.equal(b.cancel_fee, 0);
  assert.equal((await t.db.q1<any>('select cancel_count from driver_profiles where user_id=$1', [d1.id])).cancel_count, 1);
  assert.equal((await t.api('GET', '/drivers/me/offers', { token: d2.token })).json.offers.length, 1, 'new driver offered; the cancelling driver is not re-offered');
  assert.equal((await t.api('GET', '/drivers/me/offers', { token: d1.token })).json.offers.length, 0);
});

test('mobile money (SIMULATED provider): initiate, verified server-side, settled exactly once, duplicates ignored', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token, 'moto', 'mtn_momo'); const id = res.json.booking.id;
  const done = await t.runTrip(p, d, id);
  assert.equal(done.status, 'PAYMENT_PENDING');
  assert.equal(done.payment, undefined, 'no payment until the passenger authorises');
  const early = await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare } });
  assert.equal(early.status, 409, 'cash cannot be recorded against a mobile-money booking');
  // a PENDING payment (msisdn ends 9999) stays pending until the provider says otherwise
  const pend = await t.api('POST', '/payments', { token: p.token, body: { booking_id: id, msisdn: '0788119999' } });
  assert.equal(pend.json.status, 'PENDING'); assert.equal(pend.json.simulated, true);
  const again = await t.api('POST', '/payments', { token: p.token, body: { booking_id: id, msisdn: '0788119999' } });
  assert.equal(again.json.id, pend.json.id, 'idempotent: no second charge');
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: p.token })).json.status, 'PAYMENT_PENDING');
  // forged client "success" changes nothing
  const forged = await t.api('POST', `/webhooks/payments/mtn_momo?token=wrong`, { body: { externalId: pend.json.reference, status: 'SUCCESSFUL' } });
  assert.equal(forged.status, 401);
  const unverified = await t.api('POST', `/webhooks/payments/mtn_momo?token=dev-callback-token`, { body: { externalId: pend.json.reference, status: 'SUCCESSFUL' } });
  assert.equal(unverified.json.status, 'PENDING', 'callback body is never trusted: provider status is re-queried');
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: p.token })).json.status, 'PAYMENT_PENDING');
  // provider confirms
  await t.api('POST', '/dev/momo/settle', { body: { reference: pend.json.reference, status: 'SUCCESS' } });
  const [c1, c2, c3] = await Promise.all([1, 2, 3].map(() => t.api('POST', `/webhooks/payments/mtn_momo?token=dev-callback-token`, { body: { externalId: pend.json.reference } })));
  assert.ok([c1, c2, c3].every((c) => c.status === 200));
  const pay = await t.api('GET', `/payments/${pend.json.id}`, { token: p.token });
  assert.equal(pay.json.status, 'SUCCESS');
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: p.token })).json.status, 'PAYMENT_COMPLETED');
  const n = await t.db.q1<any>('select count(*)::int n from driver_earnings where booking_id=$1', [id]);
  assert.equal(n.n, 1, 'exactly one earnings record despite duplicate notifications');
  const led = await t.db.q1<any>("select count(*)::int n from ledger_entries where booking_id=$1 and account_code='PROVIDER_CLEARING'", [id]);
  assert.equal(led.n, 1);
  const clearing = await t.db.q1<any>("select sum(debit-credit)::int v from ledger_entries where booking_id=$1 and account_code='PROVIDER_CLEARING'", [id]);
  assert.equal(clearing.v, done.final_fare);
  await ledgerBalanced();
  const w = await t.api('GET', '/drivers/me/wallet', { token: d.token });
  assert.ok(w.json.balance.eligible_payout > 0);                   // platform holds the money, driver is owed the net
  assert.equal(w.json.balance.cash_held, 0);
});

test('failed mobile money can fall back to cash; success then failure cannot double settle', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token, 'moto', 'mtn_momo'); const id = res.json.booking.id;
  const done = await t.runTrip(p, d, id);
  const f = await t.api('POST', '/payments', { token: p.token, body: { booking_id: id, msisdn: '0788110000' } });   // simulator: FAILED
  assert.equal(f.json.status, 'FAILED');
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: p.token })).json.status, 'PAYMENT_PENDING');
  const sw = await t.api('POST', `/bookings/${id}/payment-method`, { token: p.token, body: { method: 'cash' } });
  assert.equal(sw.status, 200);
  const cash = await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare } });
  assert.equal(cash.json.status, 'SUCCESS');
  await ledgerBalanced();
});

test('partial cash keeps an outstanding balance; over-collection is rejected', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  const done = await t.runTrip(p, d, id);
  const over = await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare + 1 } });
  assert.equal(over.status, 400);
  const part = await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: 500 } });
  assert.equal(part.json.status, 'PARTIAL'); assert.equal(part.json.outstanding, done.final_fare - 500);
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: p.token })).json.status, 'PAYMENT_PENDING');
  const rest = await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare - 500 } });
  assert.equal(rest.json.status, 'SUCCESS');
  await ledgerBalanced();
});

test('fare is final and cannot be completed twice; unauthorised driver cannot complete', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const other = await t.driver({ vehicle: 'moto', online: false });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.runTrip(p, d, id);
  const again = await t.api('POST', `/bookings/${id}/complete`, { token: d.token });
  assert.equal(again.status, 409);
  const thief = await t.api('POST', `/bookings/${id}/complete`, { token: other.token });
  assert.equal(thief.status, 404);
  const passengerTry = await t.api('POST', `/bookings/${id}/complete`, { token: p.token });
  assert.equal(passengerTry.status, 403);
});

test('promotions: first-ride promo applies, is single-use, funded by the platform, and keeps the ledger balanced', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const e = await t.estimate(p.token, { service_id: 'moto', promo_code: 'WELCOME' });
  const o = e.json.options[0];
  assert.ok(o.promo.discount > 0, JSON.stringify(o.promo));
  assert.equal(o.fare.total, o.fare.subtotal - o.promo.discount);
  const r = await t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: o.quote_id, payment_method: 'cash' } });
  const id = r.json.booking.id;
  const done = await t.runTrip(p, d, id);
  await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare } });
  const earn = await t.db.q1<any>('select * from driver_earnings where booking_id=$1', [id]);
  assert.equal(earn.discount, o.promo.discount);
  assert.equal(earn.commissionable, o.fare.subtotal, 'commission computed on the pre-discount fare: the platform funds the promo');
  const promoExp = await t.db.q1<any>("select sum(debit)::int v from ledger_entries where booking_id=$1 and account_code='PROMO_EXPENSE'", [id]);
  assert.equal(promoExp.v, o.promo.discount);
  await ledgerBalanced();
  const again = await t.estimate(p.token, { service_id: 'moto', promo_code: 'WELCOME' });
  assert.ok(['promo_first_ride_only', 'promo_already_used'].includes(again.json.options[0].promo.error));
});

test('scheduled rides: quoted for the future, no immediate dispatch, released by the sweeper', async () => {
  const p = await t.register(); await t.driver({ vehicle: 'moto' });
  const when = new Date(Date.now() + 40 * 60000).toISOString();
  const e = await t.estimate(p.token, { service_id: 'moto', scheduled_for: when });
  assert.equal(e.status, 200); assert.equal(e.json.options[0].available, true);
  const r = await t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: e.json.options[0].quote_id, payment_method: 'cash' } });
  assert.equal(r.json.booking.status, 'SCHEDULED');
  const soon = await t.estimate(p.token, { scheduled_for: new Date(Date.now() + 5 * 60000).toISOString() });
  assert.equal(soon.json.error.code, 'invalid_schedule');
  const { dispatchSweep } = await import('../src/services/dispatch.ts');
  await dispatchSweep();
  assert.equal((await t.db.q1<any>('select status from bookings where id=$1', [r.json.booking.id])).status, 'SCHEDULED', 'not yet due');
  await t.db.q("update bookings set scheduled_for = now() + interval '10 minutes' where id=$1", [r.json.booking.id]);
  await dispatchSweep();
  assert.equal((await t.db.q1<any>('select status from bookings where id=$1', [r.json.booking.id])).status, 'SEARCHING_DRIVER');
});

test('trip sharing link: limited data, expires, revocable; chat limited to the two parties', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const stranger = await t.register();
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  const sh = await t.api('POST', `/bookings/${id}/share`, { token: p.token, body: {} });
  const token = sh.json.token;
  const pub = await t.api('GET', `/share/${token}`, { headers: { accept: 'application/json' } });
  assert.equal(pub.status, 200);
  assert.ok(!JSON.stringify(pub.json).includes('+250'), 'no phone numbers on the public link');
  assert.equal(pub.json.driver.plate, d.plate);
  await t.db.q("update trip_shares set expires_at = now() - interval '1 minute'");
  assert.equal((await t.api('GET', `/share/${token}`, { headers: { accept: 'application/json' } })).status, 404);
  assert.equal((await t.api('POST', `/bookings/${id}/messages`, { token: p.token, body: { body: 'I am at the gate' } })).status, 200);
  assert.equal((await t.api('GET', `/bookings/${id}/messages`, { token: d.token })).json.messages.length, 1);
  assert.equal((await t.api('POST', `/bookings/${id}/messages`, { token: stranger.token, body: { body: 'hi' } })).status, 404);
});

test('SOS records an incident and never claims anyone was contacted', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  const s = await t.api('POST', '/safety/sos', { token: p.token, body: { booking_id: id, lat: KCC.lat, lng: KCC.lng } });
  assert.equal(s.status, 200); assert.equal(s.json.recorded, true);
  assert.equal(s.json.human_response_confirmed, false);
  assert.equal(s.json.emergency_numbers.police, '112');
  assert.ok(/No one has confirmed/.test(s.json.message));
  const inc = await t.db.q1<any>("select * from safety_incidents where kind='sos' and booking_id=$1", [id]);
  assert.equal(inc.status, 'open'); assert.ok(inc.lat != null);
  const urgent = await t.db.q1<any>("select priority, sensitive from support_cases where subject like $1", [`SOS ${inc.ref}%`]);
  assert.equal(urgent.priority, 'urgent'); assert.equal(urgent.sensitive, true);
});

test('referrals: both sides are rewarded once, after the referee’s first paid trip; self-referral is impossible', async () => {
  const referrer = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const code = (await t.api('GET', '/users/me/referral', { token: referrer.token })).json.code;
  assert.ok(code);
  const ph = t.phone();
  const o = await t.api('POST', '/auth/otp/request', { body: { phone: ph } });
  const v = await t.api('POST', '/auth/otp/verify', { body: { phone: ph, code: o.json.dev_code, referral_code: code } });
  const referee = { token: v.json.access_token, id: v.json.user.id };
  const ref = await t.db.q1<any>('select * from referrals where referee_id=$1', [referee.id]);
  assert.equal(ref.referrer_id, referrer.id); assert.equal(ref.status, 'pending');
  const { res } = await t.book(referee.token); const id = res.json.booking.id;
  const done = await t.runTrip(referee, d, id);
  assert.equal((await t.db.q<any>('select 1 from promotions where user_id is not null')).length, 0, 'no reward before payment');
  await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare } });
  const rewards = await t.db.q<any>('select user_id, value from promotions where user_id is not null');
  assert.deepEqual(rewards.map((r: any) => r.user_id).sort(), [referrer.id, referee.id].sort());
  assert.equal((await t.db.q1<any>('select status from referrals where id=$1', [ref.id])).status, 'rewarded');
  // a reward voucher is only usable by its owner
  const stranger = await t.register();
  const code2 = rewards[0].value && (await t.db.q1<any>('select code from promotions where user_id=$1', [referrer.id])).code;
  const e = await t.estimate(stranger.token, { service_id: 'moto', promo_code: code2 });
  assert.equal(e.json.options[0].promo.error, 'promo_not_eligible');
  // self-referral rejected by the database
  await assert.rejects(() => t.db.q('insert into referrals(referrer_id, referee_id) values ($1,$1)', [referrer.id]), /check/);
});

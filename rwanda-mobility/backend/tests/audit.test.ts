import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { boot, KCC, makePng, type Ctx } from './helpers.ts';

// Regression tests for the backend audit (docs/AUDIT_BACKEND.md). Each test names the finding it pins down.

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const balanced = async () => {
  const r = await t.db.q1<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries');
  assert.equal(r.d, r.c, 'ledger must balance');
};

// ---------------------------------------------------------------- configuration, headers, logging

test('A-01 production config: unsafe live payments settings stop the boot; sandbox/simulator only warn; dev is silent', async () => {
  const { configProblems, config } = await import('../src/config.ts');
  const base = { ...config, momo: { ...config.momo }, jwtSecret: 'a'.repeat(20), dataEncKey: 'b'.repeat(20), pinSecret: 'c'.repeat(20), fileSigningSecret: 'd'.repeat(20), publicBaseUrl: 'https://api.example.rw', databaseUrl: 'postgres://u:p@db/x' };
  assert.deepEqual(configProblems(base, {}, false), { fatal: [], warn: [] }, 'nothing is enforced outside production');
  const live = configProblems({ ...base, momo: { ...base.momo, mode: 'live' as const, subscriptionKey: '', apiUser: '', apiKey: '', callbackToken: 'dev-callback-token' } }, {}, true);
  assert.equal(live.fatal.length, 2, JSON.stringify(live));
  const liveOk = configProblems({ ...base, smsProvider: 'http', smsHttpUrl: 'https://sms.example', momo: { ...base.momo, mode: 'live' as const, subscriptionKey: 'k', apiUser: 'u', apiKey: 'a', callbackToken: 'x'.repeat(24) } }, {}, true);
  assert.deepEqual(liveOk, { fatal: [], warn: [] });
  const sandbox = configProblems({ ...base, momo: { ...base.momo, mode: 'sandbox' as const, callbackToken: 'dev-callback-token' } }, {}, true);
  assert.equal(sandbox.fatal.length, 0); assert.ok(sandbox.warn.some((w) => /MOMO_CALLBACK_TOKEN/.test(w)));
  const sim = configProblems({ ...base, momo: { ...base.momo, mode: 'simulator' as const } }, {}, true);
  assert.ok(sim.warn.some((w) => /SIMULATED/.test(w)));
  assert.equal(configProblems({ ...base, momo: { ...base.momo, mode: 'simulator' as const } }, { APP_ENV: 'staging' }, true).warn.filter((w) => /SIMULATED/.test(w)).length, 0, 'staging may simulate');
  assert.equal(configProblems({ ...base, smsProvider: 'http', smsHttpUrl: '' }, {}, true).fatal.length, 1);
  assert.ok(configProblems({ ...base, jwtSecret: base.dataEncKey }, {}, true).warn.some((w) => /different/.test(w)), 'reused secrets are flagged');
});

test('A-02 logs never carry capability URLs or tokens', async () => {
  const { redactUrl } = await import('../src/app.ts');
  assert.equal(redactUrl('/share/abcDEF123_-xyz?lang=fr'), '/share/[redacted]?lang=fr');
  assert.equal(redactUrl('/api/v1/staff-invite/SECRETTOKEN/activate'), '/api/v1/staff-invite/[redacted]/activate');
  assert.equal(redactUrl('/api/v1/webhooks/payments/mtn_momo?token=dev-callback-token'), '/api/v1/webhooks/payments/mtn_momo?token=[redacted]');
  assert.equal(redactUrl('/api/v1/files/docs/x.jpg?token=123.abc&x=1'), '/api/v1/files/docs/x.jpg?token=[redacted]&x=1');
  assert.equal(redactUrl('/api/v1/bookings'), '/api/v1/bookings');
});

test('A-03 API responses carry a locked-down CSP; the share page does not (it needs its inline script)', async () => {
  const r = await t.api('GET', '/config');
  assert.match(String(r.headers['content-security-policy']), /default-src 'none'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  const s = await t.api('GET', '/share/unknowntoken', { headers: { accept: 'text/html' } });
  assert.equal(s.headers['content-security-policy'], undefined);
});

test('A-04 /ready reports the database; /admin/system/health needs diagnostics.view and reports queues, pool and jobs', async () => {
  assert.deepEqual((await t.api('GET', '/ready')).json, { ready: true });
  const p = await t.register(); const analyst = await t.staff('analyst'); const dispatcher = await t.staff('dispatcher');
  assert.equal((await t.api('GET', '/admin/system/health', { token: p.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/system/health', { token: dispatcher.token })).status, 403);
  const h = await t.api('GET', '/admin/system/health', { token: analyst.token });
  assert.equal(h.status, 200);
  for (const k of ['ok', 'problems', 'pool', 'jobs', 'sms_queued', 'push_queued', 'payments_stuck_pending', 'migrations_applied', 'latest_migration']) assert.ok(k in h.json, k);
  assert.ok(h.json.migrations_applied >= 8);
  const { startJobs, jobHealth } = await import('../src/jobs.ts');
  const stop = startJobs(() => {});
  try {
    const jh = jobHealth();
    assert.equal(jh.started, true);
    for (const j of ['dispatch', 'payments', 'sms', 'push', 'push-receipts', 'eligibility', 'retention', 'stale-drivers']) assert.ok(jh.jobs[j], j);
  } finally { stop(); }
  assert.equal(jobHealth().started, false);
});

// ---------------------------------------------------------------- rate limiting

test('A-05 the global rate limit is per signed-in user, not per carrier IP; anonymous callers share their IP bucket; forged tokens do not buy a new bucket', async () => {
  const prev = process.env.RATE_LIMIT_MAX; process.env.RATE_LIMIT_MAX = '4';
  const { buildApp } = await import('../src/app.ts');
  const app = await buildApp(); process.env.RATE_LIMIT_MAX = prev;
  try {
    const a = await t.register(), b = await t.register();
    const hit = (token?: string) => app.inject({ method: 'GET', url: '/api/v1/users/me', remoteAddress: '10.9.8.7', headers: token ? { authorization: `Bearer ${token}` } : {} }).then((r) => r.statusCode);
    for (let i = 0; i < 4; i++) assert.equal(await hit(a.token), 200);
    assert.equal(await hit(a.token), 429, 'user A exhausted their own bucket');
    assert.equal(await hit(b.token), 200, 'user B on the same IP is unaffected');
    const anon = () => app.inject({ method: 'GET', url: '/api/v1/config', remoteAddress: '10.9.8.8' }).then((r) => r.statusCode);
    for (let i = 0; i < 4; i++) assert.equal(await anon(), 200);
    assert.equal(await anon(), 429);
    const forged = (n: number) => `x.${Buffer.from(JSON.stringify({ sub: `fake-${n}` })).toString('base64url')}.y`;
    assert.equal(await app.inject({ method: 'GET', url: '/api/v1/config', remoteAddress: '10.9.8.8', headers: { authorization: `Bearer ${forged(1)}` } }).then((r) => r.statusCode), 429, 'a forged sub does not escape the IP bucket');
  } finally { await app.close(); }
});

test('A-06 expensive/abusable endpoints have their own limits (SOS, support cases, chat, share)', async () => {
  const p = await t.register();
  const codes: number[] = [];
  for (let i = 0; i < 8; i++) codes.push((await t.api('POST', '/safety/sos', { token: p.token, body: {} })).status);
  assert.deepEqual(codes.slice(0, 6), [200, 200, 200, 200, 200, 200]);
  assert.equal(codes[7], 429, 'SOS is capped per user per minute (each one can text the escalation contacts)');
  assert.equal((await t.api('POST', '/safety/sos', { token: p.token, body: {} , headers: { 'accept-language': 'fr' } })).json.error.code, 'rate_limited');
});

// ---------------------------------------------------------------- authentication

test('B-01 refresh rotation is single-use even when two refreshes race', async () => {
  const u = await t.register();
  const results = await Promise.all([1, 2, 3, 4].map(() => t.api('POST', '/auth/refresh', { body: { refresh_token: u.refresh } })));
  const ok = results.filter((r) => r.status === 200);
  assert.equal(ok.length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 401));
});

test('B-02 the OTP attempt cap holds under parallel guesses', async () => {
  const ph = `+25078${String(5000000 + Math.floor(Math.random() * 999999))}`;
  const o = await t.api('POST', '/auth/otp/request', { body: { phone: ph } });
  const wrong = o.json.dev_code === '000000' ? '111111' : '000000';
  const res = await Promise.all(Array.from({ length: 14 }, () => t.api('POST', '/auth/otp/verify', { body: { phone: ph, code: wrong } })));
  const row = await t.db.q1<any>('select attempts from otp_challenges where phone=$1 order by created_at desc limit 1', [ph]);
  assert.equal(row.attempts, 5, 'exactly max_attempts guesses were ever evaluated');
  assert.equal(res.filter((r) => r.status === 400).length, 5);
  assert.equal(res.filter((r) => r.status === 429).length, 9);
  assert.equal((await t.api('POST', '/auth/otp/verify', { body: { phone: ph, code: o.json.dev_code } })).status, 429, 'even the right code is refused once exhausted');
});

test('B-03 e-mail addresses are case-insensitively unique, so staff sign-in can never match two rows', async () => {
  const a = await t.register(), b = await t.register();
  const addr = `Mixed.Case${Math.floor(Math.random() * 1e6)}@Example.com`;
  assert.equal((await t.api('PATCH', '/users/me', { token: a.token, body: { email: addr } })).status, 200);
  assert.equal((await t.db.q1<any>('select email from users where id=$1', [a.id])).email, addr.toLowerCase(), 'stored lower-case');
  const dup = await t.api('PATCH', '/users/me', { token: b.token, body: { email: addr.toUpperCase().replace('EXAMPLE.COM', 'example.com') } });
  assert.equal(dup.status, 409); assert.equal(dup.json.error.code, 'email_in_use');
  // and the database itself refuses a differently-cased twin
  await assert.rejects(() => t.db.q('update users set email=$2 where id=$1', [b.id, addr.toUpperCase()]), /users_email_lower_uniq/);
});

test('B-04 staff status changes: support cannot lock colleagues or itself; only a super admin touches staff accounts', async () => {
  const lead = await t.staff('support_lead'), disp = await t.staff('dispatcher'), sa = await t.staff('super_admin'); const p = await t.register();
  const set = (who: any, id: string, status = 'deactivated') => t.api('POST', `/admin/users/${id}/status`, { token: who.token, body: { status, reason: 'audit test reason' } });
  assert.equal((await set(lead, disp.id)).status, 403, 'a support lead cannot deactivate a dispatcher');
  assert.equal((await set(lead, sa.id)).status, 403, 'nor the super admin');
  assert.equal((await set(lead, lead.id)).status, 403, 'nor itself');
  assert.equal((await t.db.q1<any>('select status from users where id=$1', [disp.id])).status, 'active');
  assert.equal((await set(lead, p.id, 'restricted')).status, 200, 'customers are fine');
  assert.equal((await set(sa, disp.id)).status, 200, 'a super admin can');
  assert.equal((await t.api('GET', '/admin/dashboard', { token: disp.token })).status, 401, 'and the deactivated session ends at once');
  assert.equal((await set(sa, sa.id)).status, 403, 'even a super admin cannot lock itself out');
});

// ---------------------------------------------------------------- bookings, dispatch, money

test('C-01 booking events: corporate/fleet/passenger viewers never see dispatch internals; the driver and staff do', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const staff = await t.staff('dispatcher');
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  const types = async (tok: string) => (await t.api('GET', `/bookings/${id}/events`, { token: tok })).json.events.map((e: any) => e.type);
  assert.ok(!(await types(p.token)).includes('offer_sent'));
  assert.ok((await types(staff.token)).includes('offer_sent'));
  assert.ok((await types(d.token)).includes('offer_sent'));
});

/** A passenger with a 500 RWF cancellation fee, whose next booking (carrying it) has run out of drivers. */
async function strandedBooking() {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const first = await t.book(p.token); const fid = first.res.json.booking.id;
  await t.api('POST', `/bookings/${fid}/accept`, { token: d.token });
  await t.db.q("update bookings set assigned_at = now() - interval '10 minutes' where id=$1", [fid]);
  assert.equal((await t.api('POST', `/bookings/${fid}/cancel`, { token: p.token, body: { reason: 'changed_mind' } })).json.cancel_fee, 500);
  const { res } = await t.book(p.token); const id = res.json.booking.id;      // the driver is still online, so this quotes and offers
  const carried = async () => (await t.db.q1<any>('select applied_booking_id from passenger_debts where booking_id=$1', [fid])).applied_booking_id;
  assert.equal(await carried(), id, 'the new booking carries the fee');
  const { runRound } = await import('../src/services/dispatch.ts');
  await t.db.q("update dispatch_offers set status='cancelled' where booking_id=$1", [id]);
  await t.db.q('update bookings set dispatch_round = 99 where id=$1', [id]);
  assert.equal((await runRound(id)).status, 'NO_DRIVER_FOUND');
  return { p, d, fid, id, carried };
}

test('C-02 a search that ends with NO_DRIVER_FOUND releases the cancellation fee it carried; a restart carries it again', async () => {
  const { p, id, carried } = await strandedBooking();
  const before = (await t.db.q1<any>('select estimated_fare from bookings where id=$1', [id])).estimated_fare;
  assert.equal(await carried(), null, 'the fee is back on the open balance instead of being stranded on a dead booking');
  assert.equal((await t.api('GET', '/users/me/debts', { token: p.token })).json.total, 500);
  const { startSearch } = await import('../src/services/dispatch.ts');
  await startSearch(id);                                                   // a dispatcher restarts the search: the fee rides along again, the fare is unchanged
  assert.equal(await carried(), id);
  assert.equal((await t.db.q1<any>('select estimated_fare from bookings where id=$1', [id])).estimated_fare, before);
});

test('C-03 restarting a NO_DRIVER_FOUND search after the fee moved on re-states the fare instead of mismatching the debt', async () => {
  const { id, fid } = await strandedBooking();
  const fareWithFee = (await t.db.q1<any>('select estimated_fare from bookings where id=$1', [id])).estimated_fare;
  const fo = await t.staff('support_lead');
  const debt = await t.db.q1<any>('select id from passenger_debts where booking_id=$1', [fid]);
  assert.equal((await t.api('POST', `/admin/finance/passenger-debts/${debt.id}/waive`, { token: fo.token, body: { reason: 'goodwill gesture' } })).status, 200, 'now waivable: nothing carries it');
  const { startSearch } = await import('../src/services/dispatch.ts');
  await startSearch(id);
  const row = await t.db.q1<any>('select estimated_fare, fare_breakdown from bookings where id=$1', [id]);
  assert.equal(row.estimated_fare, fareWithFee - 500);
  assert.ok(!row.fare_breakdown.debt && !row.fare_breakdown.lines.some((l: any) => l.code === 'previous_cancellation_fee'));
});

test('C-04 a second mobile-money request cannot be started while one is in flight; an abandoned INITIATED row is cleaned up', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token, 'moto', 'mtn_momo'); const id = res.json.booking.id;
  const done = await t.runTrip(p, d, id);
  const pay = (bookingId = id, who = p) => t.api('POST', '/payments', { token: who.token, body: { booking_id: bookingId, method: 'mtn_momo', msisdn: who.phone } });
  const insertInit = (bookingId: string, who: any, ref: string) => t.db.q("insert into payments(booking_id, payer_user_id, method, provider, amount, status, reference, settlement_status) values ($1,$2,'mtn_momo','mtn_momo',$3,'INITIATED',$4,'unsettled')", [bookingId, who.id, done.final_fare, ref]);
  await insertInit(id, p, 'RM-INFLIGHT-1');
  const blocked = await pay();
  assert.equal(blocked.status, 409); assert.equal(blocked.json.error.code, 'payment_in_flight', 'was an unhandled unique-violation 500');
  await t.db.q("update payments set updated_at = now() - interval '2 minutes' where reference='RM-INFLIGHT-1'");
  const ok = await pay();
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await t.db.q1<any>("select status from payments where reference='RM-INFLIGHT-1'")).status, 'CANCELLED');
  assert.equal((await t.db.q<any>("select 1 from payments where booking_id=$1 and status in ('INITIATED','PENDING','SUCCESS')", [id])).length, 1, 'never two live charges');
  // the sweeper closes forgotten INITIATED rows on another booking
  const p2 = await t.register(); const d2 = await t.driver({ vehicle: 'moto' });
  const b2 = await t.book(p2.token, 'moto', 'mtn_momo'); await t.runTrip(p2, d2, b2.res.json.booking.id);
  await insertInit(b2.res.json.booking.id, p2, 'RM-INFLIGHT-2');
  await t.db.q("update payments set updated_at = now() - interval '10 minutes' where reference='RM-INFLIGHT-2'");
  const { sweepPendingPayments } = await import('../src/services/payments.ts');
  await sweepPendingPayments();
  const row = await t.db.q1<any>("select status, failure_reason from payments where reference='RM-INFLIGHT-2'");
  assert.deepEqual([row.status, row.failure_reason], ['CANCELLED', 'abandoned_before_send']);
});

test('C-05 cash confirmation cannot settle twice when the driver double-taps', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  const done = await t.runTrip(p, d, id);
  const rs = await Promise.all([1, 2, 3].map(() => t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare } })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => [r.status, r.json?.error?.code])));
  assert.equal((await t.db.q<any>('select 1 from driver_earnings where booking_id=$1', [id])).length, 1);
  assert.equal((await t.db.q1<any>('select count(*)::int n from ledger_entries where booking_id=$1 and account_code=$2', [id, 'COMMISSION_REVENUE'])).n, 1);
  await balanced();
});

test('C-06 a promo with a per-user limit cannot be redeemed twice by racing bookings', async () => {
  const sa = await t.staff('business_manager');
  const code = 'ONCE' + Math.floor(Math.random() * 9999);
  assert.equal((await t.api('POST', '/admin/promotions', { token: sa.token, body: { code, kind: 'fixed', value: 500, min_fare: 0, per_user_limit: 1 } })).status, 200);
  const p = await t.register(); await t.driver({ vehicle: 'moto' });
  const when = new Date(Date.now() + 3 * 3600e3).toISOString();
  const quotes: string[] = [];
  for (let i = 0; i < 2; i++) {
    const e = await t.estimate(p.token, { service_id: 'moto', promo_code: code, scheduled_for: when });
    const q = e.json.options?.[0]?.quote_id; assert.ok(q, JSON.stringify(e.json)); quotes.push(q);
  }
  const rs = await Promise.all(quotes.map((q) => t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: q, payment_method: 'cash' } })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409], JSON.stringify(rs.map((r) => [r.status, r.json?.error?.code])));
  assert.equal(rs.find((r) => r.status === 409)!.json.error.code, 'promo_invalid');
  assert.equal((await t.db.q1<any>('select count(*)::int n from promotion_redemptions pr join promotions p on p.id=pr.promotion_id where upper(p.code)=upper($1)', [code])).n, 1);
});

test('C-07 refund edge cases: pending requests reserve the amount, a rejection frees it, disputes can be refunded, history is append-only', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const lead = await t.staff('support_lead'), fa = await t.staff('finance_approver');
  const { res } = await t.book(p.token, 'moto', 'cash'); const id = res.json.booking.id;
  const done = await t.runTrip(p, d, id); const fare = done.final_fare as number;
  await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: fare } });
  const req = (amount: number) => t.api('POST', '/admin/finance/refunds', { token: lead.token, body: { booking_id: id, amount, reason: 'edge case test' } });
  const r1 = await req(fare - 100);
  assert.equal(r1.status, 200);
  assert.equal((await req(101)).status, 400, 'the pending request already reserves the amount');
  assert.equal((await t.api('POST', `/admin/finance/refunds/${r1.json.id}/decision`, { token: fa.token, body: { approve: false } })).json.processed, false);
  const r2 = await req(fare);                                           // rejected request freed the amount: a full refund is possible again
  assert.equal(r2.status, 200);
  // dispute first: DISPUTED -> REFUNDED must be a legal path
  const support = await t.staff('support_agent');
  assert.equal((await t.api('POST', `/admin/bookings/${id}/dispute`, { token: support.token, body: { reason: 'passenger says not completed' } })).status, 200);
  const ok = await t.api('POST', `/admin/finance/refunds/${r2.json.id}/decision`, { token: fa.token, body: { approve: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await t.db.q1<any>('select status from bookings where id=$1', [id])).status, 'REFUNDED');
  assert.equal((await req(1)).status, 409, 'nothing left to refund once the payment is reversed');
  await balanced();
});

test('C-08 finance driver list equals driverBalance(); CSV leaves numbers alone but neutralises text', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const fo = await t.staff('finance_officer');
  const { res } = await t.book(p.token); const id = res.json.booking.id; const done = await t.runTrip(p, d, id);
  await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare } });
  const list = await t.api('GET', '/admin/finance/drivers', { token: fo.token });
  const { driverBalance } = await import('../src/services/ledger.ts');
  const mine = list.json.drivers.find((x: any) => x.user_id === d.id);
  assert.ok(mine);
  assert.deepEqual({ payable: mine.payable, cash_held: mine.cash_held, eligible_payout: mine.eligible_payout, owed_to_platform: mine.owed_to_platform }, await driverBalance(d.id));
  await t.db.q("update users set display_name='=HYPERLINK(\"x\")' where id=$1", [d.id]);
  const csv = await t.api('GET', '/admin/finance/export/earnings', { token: fo.token });
  assert.equal(csv.status, 200);
  assert.match(csv.raw, /\d{3,},/);                                      // plain numbers are not prefixed with a quote
  assert.ok(!/(^|,)'-?\d/.test(csv.raw.split('\n')[1]));
});

// ---------------------------------------------------------------- privacy & retention

test('D-01 deletion erases every personal table, removes uploaded files, and refuses while a scheduled trip exists', async () => {
  const { executeDeletion } = await import('../src/services/privacy.ts');
  const { saveFile } = await import('../src/services/storage.ts');
  const staff = await t.staff('support_lead'); const actor = { id: staff.id, role: 'support_lead' };
  const u = await t.register(); const d = await t.driver({ vehicle: 'moto', online: false });
  const png = makePng(40, 40);
  const doc = await saveFile(png, 'docs'); const photo = await saveFile(png, 'photos'); const ev = await saveFile(png, 'evidence');
  await t.db.q("update driver_documents set file_key=$2 where driver_id=$1 and doc_type='national_id'", [d.id, doc.key]);
  await t.db.q('update users set photo_key=$2 where id=$1', [d.id, photo.key]);
  const phone = (await t.db.q1<any>('select phone from users where id=$1', [d.id])).phone;
  await t.api('POST', '/users/me/push-token', { token: d.token, body: { token: 'ExponentPushToken[abcdefghijklmnop]', platform: 'android' } });
  await t.api('POST', '/users/me/cars', { token: d.token, body: { plate: 'RAB123C', make: 'Toyota', vehicle_class: 'car', transmission: 'manual', insurance_confirmed: true } });
  await t.db.q("insert into notifications(user_id, channel, template_key, title, body, status) values ($1,'in_app','x','t','Driver John in plate RAA111A','sent')", [d.id]);
  await t.db.q("insert into fleet_invites(fleet_id, phone) select id, $1 from fleets limit 1", [phone]);
  const cs = await t.api('POST', '/support/cases', { token: d.token, body: { category: 'other', subject: 'hello there', body: 'my secret story' } });
  await t.db.q("insert into case_events(case_id, author_id, kind, body, file_key) values ($1,$2,'evidence','Evidence attached',$3)", [cs.json.id, d.id, ev.key]);
  await t.api('POST', '/client-errors', { token: d.token, body: { message: 'boom' } });
  await t.db.q("insert into privacy_requests(user_id, kind, due_at) values ($1,'deletion', now() + interval '30 days')", [d.id]);
  const pr = await t.db.q1<any>("select id from privacy_requests where user_id=$1", [d.id]);
  // a scheduled trip blocks deletion (it used to slip past the active-state list)
  const when = new Date(Date.now() + 3 * 3600e3).toISOString();
  const other = await t.driver({ vehicle: 'moto' });
  await t.db.q("update driver_profiles set accepting='{ride}' where user_id=$1", [other.id]);
  const sched = await t.book(d.token, 'moto', 'cash', { estimate: { scheduled_for: when } });
  assert.equal(sched.res.status, 201, JSON.stringify(sched.res.json));
  await assert.rejects(() => executeDeletion(actor, pr.id), /active or unpaid/);
  await t.db.q("update bookings set status='CANCELLED_BY_PASSENGER' where passenger_id=$1", [d.id]);

  await executeDeletion(actor, pr.id);
  for (const [tbl, col] of [['push_tokens', 'user_id'], ['notifications', 'user_id'], ['driver_documents', 'driver_id'], ['trip_shares', 'created_by']] as const)
    assert.equal((await t.db.q(`select 1 from ${tbl} where ${col}=$1`, [d.id])).length, 0, tbl);
  assert.equal((await t.db.q('select 1 from fleet_invites where phone=$1', [phone])).length, 0);
  assert.equal((await t.db.q('select 1 from otp_challenges where phone=$1', [phone])).length, 0);
  assert.equal((await t.db.q1<any>('select count(*)::int n from client_errors where user_id=$1', [d.id])).n, 0);
  const car = await t.db.q1<any>('select plate, make, active from customer_vehicles where owner_id=$1', [d.id]);
  assert.ok(car.plate.startsWith('DELETED-') && car.make === null && car.active === false);
  const veh = await t.db.q1<any>('select plate, status from vehicles where driver_id=$1', [d.id]);
  assert.ok(veh.plate.startsWith('DELETED-') && veh.status === 'suspended');
  assert.equal((await t.db.q1<any>("select body from case_events where case_id=$1 and kind='message'", [cs.json.id])).body, '[removed]');
  for (const k of [doc.key, photo.key, ev.key]) assert.equal(existsSync(join(process.env.STORAGE_DIR!, k)), false, `${k} must be deleted from disk`);
  void u;
});

test('D-02 data export includes the newer tables (cars, fees, devices, messages, error reports)', async () => {
  const { exportUserData } = await import('../src/services/privacy.ts');
  const u = await t.register();
  await t.api('POST', '/users/me/cars', { token: u.token, body: { plate: 'RAC999D', vehicle_class: 'car', transmission: 'automatic', insurance_confirmed: true } });
  await t.api('POST', '/users/me/push-token', { token: u.token, body: { token: 'ExponentPushToken[zzzzzzzzzzzzzz]', platform: 'ios' } });
  await t.api('POST', '/client-errors', { token: u.token, body: { message: 'oops' } });
  const x: any = await exportUserData(u.id);
  assert.equal(x.cars.length, 1); assert.equal(x.devices.length, 1); assert.equal(x.app_error_reports.length, 1);
  assert.ok(Array.isArray(x.cancellation_fees) && Array.isArray(x.trip_messages_sent));
  assert.ok(!JSON.stringify(x).includes('ExponentPushToken'), 'push tokens themselves are not exported');
});

test('D-03 retention covers notifications, ended sessions, staff invites, share links; keeps what is still needed', async () => {
  const { retention } = await import('../src/jobs.ts');
  const u = await t.register();
  await t.db.q("insert into notifications(user_id, channel, template_key, title, body, status, created_at) values ($1,'in_app','old','t','b','sent', now() - interval '400 days'), ($1,'sms','oldq','t','b','queued', now() - interval '400 days'), ($1,'in_app','new','t','b','sent', now())", [u.id]);
  await t.db.q("insert into sessions(user_id, refresh_hash, expires_at, revoked_at) values ($1,'h-old-revoked', now() + interval '10 days', now() - interval '90 days'), ($1,'h-old-expired', now() - interval '90 days', null), ($1,'h-recent-revoked', now() + interval '10 days', now() - interval '2 days')", [u.id]);
  const staff = await t.staff('super_admin');
  await t.db.q("insert into staff_invites(email, display_name, role, token_hash, invited_by, expires_at, used_at) values ('old@x.rw','Old','analyst','th-old',$1, now() - interval '100 days', now() - interval '99 days'), ('new@x.rw','New','analyst','th-new',$1, now() + interval '1 day', null)", [staff.id]);
  await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(u.token); const bid = res.json.booking.id;
  await t.db.q("insert into trip_shares(booking_id, token_hash, expires_at, created_by) values ($1,'sh-old', now() - interval '30 days', $2), ($1,'sh-live', now() + interval '1 day', $2)", [bid, u.id]);
  await retention();
  const keys = async (sql: string, col: string) => (await t.db.q<any>(sql)).map((r: any) => r[col]).sort();
  assert.deepEqual(await keys(`select template_key k from notifications where user_id='${u.id}'`, 'k'), ['new', 'oldq'].concat(await keys(`select template_key k from notifications where user_id='${u.id}' and template_key not in ('new','oldq','old')`, 'k')).sort(), 'old delivered gone; queued and fresh kept');
  assert.deepEqual(await keys(`select refresh_hash h from sessions where refresh_hash like 'h-%'`, 'h'), ['h-recent-revoked']);
  assert.deepEqual(await keys(`select email e from staff_invites`, 'e'), ['new@x.rw']);
  assert.deepEqual(await keys(`select token_hash h from trip_shares where token_hash like 'sh-%'`, 'h'), ['sh-live']);
});

test('D-04 purged / never-written files give 404, not a 500; impossible calendar dates are rejected', async () => {
  const d = await t.driver({ vehicle: 'moto', online: false });
  const { signFileToken } = await import('../src/util/crypto.ts');
  const key = `docs/${randomUUID()}.jpg`;
  const r = await t.api('GET', `/files/${key}?token=${signFileToken(key, 60)}`);
  assert.equal(r.status, 404);
  const png = makePng(40, 40);
  const boundary = '----t' + randomUUID();
  const body = (date: string) => Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="doc_type"\r\n\r\ninsurance\r\n--${boundary}\r\nContent-Disposition: form-data; name="expiry_date"\r\n\r\n${date}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const up = (date: string) => t.api('POST', '/drivers/documents', { token: d.token, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body(date) });
  assert.equal((await up('2040-02-30')).status, 400, 'was a 500 from the database');
  assert.equal((await up('2040-13-01')).status, 400);
  assert.equal((await up('2040-02-28')).status, 200);
});

test('D-05 client-error flood protection: past the hourly ceiling reports are acknowledged and dropped', async () => {
  await t.db.q("insert into client_errors(message) select 'flood' from generate_series(1, 5000)");
  try {
    const r = await t.api('POST', '/client-errors', { body: { message: 'one more' } });
    assert.equal(r.status, 202); assert.equal(r.json.id, 0);
    assert.equal((await t.db.q1<any>("select count(*)::int n from client_errors where message='one more'")).n, 0);
  } finally { await t.db.q("delete from client_errors where message in ('flood','one more')"); }
});

// ---------------------------------------------------------------- misc invariants

test('E-01 every pool starts with timeouts and an error handler (a DB restart must not crash the process)', async () => {
  const { pool } = await import('../src/db.ts');
  assert.ok(pool.listenerCount('error') >= 1);
  const o: any = pool.options;
  assert.ok(o.connectionTimeoutMillis > 0 && o.statement_timeout > 0 && o.idle_in_transaction_session_timeout > 0);
  const r = await t.db.q1<any>('show statement_timeout'); assert.ok(r.statement_timeout !== '0');
});

test('E-02 migrations are idempotent and safe to run concurrently', async () => {
  const { migrate } = await import('../src/migrate.ts');
  await Promise.all([migrate(false), migrate(false), migrate(false)]);
  const n = await t.db.q1<any>('select count(*)::int n from schema_migrations'); assert.ok(n.n >= 8);
});

test('E-03 seed consistency: every enabled service has an active price, a zone link, a commission and document requirements for its vehicle types', async () => {
  const svcs = await t.db.q<any>('select * from service_categories where enabled');
  assert.ok(svcs.length >= 3);
  for (const s of svcs) {
    assert.ok(await t.db.q1("select 1 from pricing_rules where service_id=$1 and status='active'", [s.id]), `price for ${s.id}`);
    assert.ok(await t.db.q1("select 1 from zone_services where service_id=$1 and zone_id='kigali' and enabled", [s.id]), `zone for ${s.id}`);
    assert.ok(await t.db.q1("select 1 from commission_rules where status='active' and (service_id=$1 or service_id is null)", [s.id]), `commission for ${s.id}`);
    assert.ok(s.name_en && s.name_rw && s.name_fr && s.description_en && s.description_rw && s.description_fr, `all languages for ${s.id}`);
    const vts = s.kind === 'abasare' ? ['abasare'] : s.vehicle_types;
    for (const vt of vts) assert.ok(await t.db.q1('select 1 from document_requirements where vehicle_type=$1 and mandatory', [vt]), `documents for ${vt}`);
  }
});

test('E-04 every permission a route demands is in the permission catalogue; only super_admin holds the admin-only ones', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { ROLE_PERMISSIONS } = await import('../src/rbac.ts');
  const { PERMISSION_KEYS } = await import('../src/permissions.ts');
  const used = new Set<string>();
  for (const f of readdirSync('src/routes')) for (const m of readFileSync(`src/routes/${f}`, 'utf8').matchAll(/(?:requirePerm|requireAnyPerm|can\([^,]+,)\s*\(?\s*'([a-z_.]+)'(?:\s*,\s*'([a-z_.]+)')?/g)) { used.add(m[1]); if (m[2]) used.add(m[2]); }
  for (const p of used) assert.ok(PERMISSION_KEYS.has(p), `permission ${p} is demanded by a route but missing from src/permissions.ts`);
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) for (const p of perms) assert.ok(p === '*' || PERMISSION_KEYS.has(p), `${role} holds ${p}, which is not in the catalogue`);
  const adminOnly = new Set(['audit.view', 'settings.manage', 'users.manage', 'roles.manage', 'requirements.manage', 'support.configure']);
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) if (role !== 'super_admin') for (const p of adminOnly) assert.ok(!perms.includes(p), `${role} must not hold ${p}`);
});

test('E-05 receipts, bookings and the active booking never leak other people’s data to staff-less callers (IDOR sweep over id-bearing routes)', async () => {
  const a = await t.register(), b = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(a.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  const probes: [string, string, any?][] = [
    ['GET', `/bookings/${id}`], ['GET', `/bookings/${id}/events`], ['GET', `/bookings/${id}/receipt`], ['GET', `/bookings/${id}/messages`],
    ['POST', `/bookings/${id}/messages`, { body: 'hi' }], ['POST', `/bookings/${id}/cancel`, { reason: 'nope nope' }], ['POST', `/bookings/${id}/share`, {}],
    ['POST', `/bookings/${id}/payment-method`, { method: 'cash' }], ['POST', `/bookings/${id}/handover/pickup/respond`, { response: 'ok' }],
  ];
  for (const [m, path, body] of probes) {
    const r = await t.api(m, path, { token: b.token, body });
    assert.ok([404, 400, 409].includes(r.status) && r.status !== 200, `${m} ${path} -> ${r.status}`);
  }
  for (const path of ['accept', 'reject', 'en-route', 'arrived', 'verify', 'no-show', 'complete'])
    assert.equal((await t.api('POST', `/bookings/${id}/${path}`, { token: b.token })).status, 403, `passenger cannot ${path}`);
  assert.equal((await t.api('POST', `/bookings/${id}/start`, { token: a.token, body: { pin: '0000' } })).status, 403);
  void KCC;
});

test('C-09 payout and cash-collected requests are idempotent when the client sends an Idempotency-Key', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await t.db.q("insert into system_settings(key,value) values ('payout.min_amount','500') on conflict (key) do update set value=excluded.value");
  try {
    // two cash trips: the driver's commission is netted, so use a mobile-money trip to create payable balance
    const mm = await t.book(p.token, 'moto', 'mtn_momo'); const mid = mm.res.json.booking.id;
    const done = await t.runTrip(p, d, mid);
    await t.api('POST', '/payments', { token: p.token, body: { booking_id: mid, method: 'mtn_momo', msisdn: p.phone } });
    const bal = (await t.api('GET', '/drivers/me/wallet', { token: d.token })).json.balance.eligible_payout as number;
    assert.ok(bal > 600, `balance ${bal}`);
    const amount = Math.floor(bal / 3), key = randomUUID();
    const rs = await Promise.all([1, 2, 3].map(() => t.api('POST', '/drivers/me/payouts', { token: d.token, headers: { 'idempotency-key': key }, body: { amount } })));
    assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
    assert.equal(new Set(rs.map((r) => r.json.id)).size, 1, 'one payout, not three');
    assert.equal((await t.api('GET', '/drivers/me/wallet', { token: d.token })).json.balance.eligible_payout, bal - amount, 'money held once');
    await balanced();
    // cash: a retried partial collection with the same key is counted once
    const p2 = await t.register(); const d2 = await t.driver({ vehicle: 'moto' });
    const { res } = await t.book(p2.token); const id = res.json.booking.id; const cash = await t.runTrip(p2, d2, id);
    const part = Math.floor(cash.final_fare / 2), k2 = randomUUID();
    const r1 = await t.api('POST', `/bookings/${id}/cash-collected`, { token: d2.token, headers: { 'idempotency-key': k2 }, body: { amount: part } });
    const r2 = await t.api('POST', `/bookings/${id}/cash-collected`, { token: d2.token, headers: { 'idempotency-key': k2 }, body: { amount: part } });
    assert.equal(r1.json.collected, part); assert.equal(r2.status, 200); assert.equal(r2.json.collected, part, 'retry did not collect twice'); assert.equal(r2.json.replay, true);
    assert.equal((await t.db.q1<any>("select amount_collected from payments where booking_id=$1 and method='cash'", [id])).amount_collected, part);
    void done;
  } finally { await t.db.q("delete from system_settings where key='payout.min_amount'"); }
});

test('C-10 static sentences in successful responses follow Accept-Language (SOS, receipt note, enrolment) and never mix', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const sos = (lang: string) => t.api('POST', '/safety/sos', { token: p.token, body: {}, headers: { 'accept-language': lang } }).then((r) => r.json.message as string);
  const [en, fr, rw] = [await sos('en'), await sos('fr'), await sos('rw')];
  assert.match(en, /SOS is recorded/); assert.match(fr, /est enregistré/); assert.match(rw, /yanditswe/);
  assert.ok(![fr, rw].some((m) => /Your SOS/.test(m)));
  const { res } = await t.book(p.token); const id = res.json.booking.id; await t.runTrip(p, d, id);
  const note = (lang: string) => t.api('GET', `/bookings/${id}/receipt`, { token: p.token, headers: { 'accept-language': lang } }).then((r) => r.json.final_fare_note as string);
  assert.match(await note('fr'), /prix final/i); assert.match(await note('rw'), /Igiciro/); assert.match(await note('en'), /Final fare/);
});

test('F-01 a driver’s profile photo reaches passengers only after staff approve it; a rejected current photo is withdrawn', async () => {
  const d = await t.driver({ vehicle: 'moto', online: false }); const verifier = await t.staff('driver_verifier');
  const png = makePng(40, 40), boundary = '----p' + randomUUID();
  const mp = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="doc_type"\r\n\r\nprofile_photo\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const up = await t.api('POST', '/drivers/documents', { token: d.token, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: mp });
  assert.equal(up.status, 200);
  const photoKey = async () => (await t.db.q1<any>('select photo_key from users where id=$1', [d.id])).photo_key;
  assert.equal(await photoKey(), null, 'an unreviewed upload is not shown to anyone');
  assert.equal((await t.api('POST', `/admin/documents/${up.json.id}/review`, { token: verifier.token, body: { decision: 'approved' } })).status, 200);
  assert.ok(await photoKey());
  assert.equal((await t.api('POST', `/admin/documents/${up.json.id}/review`, { token: verifier.token, body: { decision: 'rejected', note: 'Face not visible' } })).status, 200);
  assert.equal(await photoKey(), null);
  // an unknown zone is a clean 400, not a foreign-key 500
  const bad = await t.api('POST', '/drivers/applications', { token: d.token, body: { legal_name: 'Test Driver', national_id: '1199080012345678', zone_id: 'atlantis', vehicle: { vehicle_type: 'moto', make: 'A', model: 'B', color: 'red', plate: 'RDZ999Z', capacity: 1 } } });
  assert.equal(bad.status, 400);
});

test('C-11 an Idempotency-Key replays only the same request; reusing it for a different quote is refused', async () => {
  const p = await t.register(); await t.driver({ vehicle: 'moto' });
  const key = randomUUID();
  const first = await t.book(p.token, 'moto', 'cash', { key });
  assert.equal(first.res.status, 201);
  const again = await t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': key }, body: { quote_id: first.quote.quote_id, payment_method: 'cash' } });
  assert.equal(again.status, 200); assert.equal(again.json.replay, true); assert.equal(again.json.booking.id, first.res.json.booking.id);
  const other = (await t.estimate(p.token, { service_id: 'moto' })).json.options[0].quote_id;
  const clash = await t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': key }, body: { quote_id: other, payment_method: 'cash' } });
  assert.equal(clash.status, 409); assert.equal(clash.json.error.code, 'idempotency_conflict');
});

test('G-01 reconciliation days are Kigali days: a payment at 01:30 Kigali belongs to that date, not to the previous UTC day', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const fo = await t.staff('finance_officer');
  const { res } = await t.book(p.token, 'moto', 'mtn_momo'); const id = res.json.booking.id;
  await t.runTrip(p, d, id);
  const pay = await t.api('POST', '/payments', { token: p.token, body: { booking_id: id, method: 'mtn_momo', msisdn: p.phone } });
  assert.equal(pay.json.status, 'SUCCESS');
  await t.db.q("update payments set completed_at = '2026-03-10T23:30:00Z' where booking_id=$1", [id]);     // = 2026-03-11 01:30 in Kigali
  const run = (date: string) => t.api('POST', '/admin/finance/reconcile', { token: fo.token, body: { provider: 'mtn_momo', run_date: date, rows: [] } });
  assert.equal((await run('2026-03-11')).json.summary.MISSING_PROVIDER, 1, 'counted on the Kigali date');
  assert.equal((await run('2026-03-10')).json.summary.MISSING_PROVIDER, 0, 'and not on the UTC date');
});

test('H-01 a provider error while starting a mobile-money payment is not shown to the passenger', async () => {
  const { setMomoProvider } = await import('../src/providers/payment.ts');
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token, 'moto', 'mtn_momo'); const id = res.json.booking.id; await t.runTrip(p, d, id);
  setMomoProvider({ name: 'mtn_momo', simulated: false, initiate: async () => { throw new Error('momo requesttopay 401: Access denied due to invalid subscription key sk_live_SECRET'); }, status: async () => ({ status: 'PENDING' }) });
  try {
    const r = await t.api('POST', '/payments', { token: p.token, body: { booking_id: id, method: 'mtn_momo', msisdn: p.phone } });
    assert.equal(r.status, 502);
    assert.ok(!JSON.stringify(r.json).includes('sk_live_SECRET') && !JSON.stringify(r.json).includes('subscription'));
    const row = await t.db.q1<any>("select status, failure_reason from payments where booking_id=$1 order by created_at desc limit 1", [id]);
    assert.deepEqual([row.status, row.failure_reason], ['FAILED', 'provider_unreachable']);
    const view = await t.api('GET', `/bookings/${id}`, { token: p.token });
    assert.ok(!JSON.stringify(view.json).includes('sk_live_SECRET'));
    assert.match(JSON.stringify(await t.db.q1("select payload from payment_provider_events where event_key like '%INITIATE_ERROR'")), /sk_live_SECRET/, 'but staff can still diagnose it');
  } finally { setMomoProvider(null); }
});

test('I-01 two bookings searching at the same moment each get a driver offer: dispatch locks only the drivers it offers to', async () => {
  const p1 = await t.register(), p2 = await t.register();
  await t.driver({ vehicle: 'moto' }); await t.driver({ vehicle: 'moto' });
  const quote = async (p: any) => (await t.estimate(p.token, { service_id: 'moto' })).json.options[0].quote_id as string;
  const [q1, q2] = [await quote(p1), await quote(p2)];
  const rs = await Promise.all([[p1, q1], [p2, q2]].map(([p, q]: any) => t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: q, payment_method: 'cash' } })));
  assert.deepEqual(rs.map((r) => r.status), [201, 201]);
  const ids = rs.map((r) => r.json.booking.id);
  const offers = await t.db.q<any>("select booking_id, driver_id from dispatch_offers where booking_id = any($1) and status='pending'", [ids]);
  assert.equal(offers.filter((o) => o.booking_id === ids[0]).length, 1, 'booking 1 has its offer');
  assert.equal(offers.filter((o) => o.booking_id === ids[1]).length, 1, 'booking 2 has its offer (it used to find every driver locked and get none)');
  assert.notEqual(offers[0].driver_id, offers[1].driver_id, 'and never the same driver twice');
  const rounds = await t.db.q<any>('select dispatch_round from bookings where id = any($1)', [ids]);
  assert.deepEqual(rounds.map((r) => r.dispatch_round), [1, 1]);
});

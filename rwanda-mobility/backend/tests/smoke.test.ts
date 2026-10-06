import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, KCC, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });

const SKIP = new Set(['POST /api/v1/auth/logout']);          // would end the shared test sessions
const fill = (url: string) => url.replace(/^\/api\/v1/, '').replace(/:(\w+)/g, (_m, k) => (k === 'token' ? 'x' : k === 'provider' ? 'mtn_momo' : k === 'kind' ? 'payments' : k === 'lang' ? 'en' : k === 'key' ? 'x' : randomUUID())).replace(/\*/, 'docs/' + randomUUID() + '.jpg');

test('no route returns a 5xx for any role: GET with real data, mutations with empty/junk bodies', async () => {
  // realistic data so that list/detail endpoints actually run their queries
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const bid = res.json.booking.id;
  await t.api('POST', `/bookings/${bid}/accept`, { token: d.token });
  const staff = await Promise.all(['super_admin', 'finance_approver', 'support_lead', 'dispatcher'].map((r) => t.staff(r)));
  const owner = await t.register(); await t.api('POST', '/fleets', { token: owner.token, body: { name: 'Smoke Fleet' } });
  await t.api('POST', '/businesses', { token: owner.token, body: { legal_name: 'Smoke Co' } });
  await t.api('POST', '/support/cases', { token: p.token, body: { category: 'other', subject: 'Smoke test', body: 'Smoke test body' } });
  const tokens = [p.token, d.token, owner.token, ...staff.map((s) => s.token), undefined];
  const failures: string[] = [];
  let calls = 0, real = 0;
  for (const r of t.routes) {
    const key = `${r.method} ${r.url}`; if (SKIP.has(key)) continue;
    const url = fill(r.url) + (r.method === 'GET' && /admin\/bookings$|admin\/users$|admin\/support\/cases$/.test(r.url) ? '' : '');
    for (const tok of tokens) {
      for (const body of r.method === 'GET' || r.method === 'DELETE' ? [undefined] : [{}, { junk: [1, 2, 3], id: 'x', amount: 'NaN', lat: 'a' }]) {
        const x = await t.api(r.method, url + (r.url.includes('/export/') ? '' : ''), { token: tok, body, headers: r.method === 'POST' && r.url.endsWith('/bookings') ? { 'idempotency-key': randomUUID() } : {} }).catch((e) => ({ status: 599, raw: String(e) } as any));
        calls++; if (x.status !== 404 || /not found|not_found/.test(String(x.raw)) === false) real++;
        if (x.status >= 500) failures.push(`${r.method} ${r.url} -> ${x.status} ${String(x.raw).slice(0, 120)}`);
      }
    }
  }
  assert.ok(calls > 800, `exercised ${calls} calls`);
  assert.ok(real >= 300, `only ${real} calls reached a handler that is not a 404`);
  assert.deepEqual(failures, [], failures.slice(0, 10).join('\n'));
});

test('GET list endpoints with real data return 200 for the owning roles', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const admin = await t.staff('super_admin');
  const { res } = await t.book(p.token); await t.api('POST', `/bookings/${res.json.booking.id}/accept`, { token: d.token });
  const must: [string, string][] = [[p.token, '/users/me'], [p.token, '/bookings'], [p.token, '/bookings/active'], [p.token, '/notifications'], [p.token, '/support/faq'], [p.token, '/places/popular'], [p.token, '/coverage'], [p.token, '/config'], [p.token, '/services'],
    [d.token, '/drivers/me/status'], [d.token, '/drivers/me/offers'], [d.token, '/drivers/me/earnings?period=week'], [d.token, '/drivers/me/wallet'], [d.token, '/drivers/me/payouts'],
    [admin.token, '/admin/dashboard'], [admin.token, '/admin/analytics'], [admin.token, '/admin/live'], [admin.token, '/admin/drivers'], [admin.token, '/admin/bookings'], [admin.token, '/admin/pricing'], [admin.token, '/admin/services'], [admin.token, '/admin/zones'],
    [admin.token, '/admin/promotions'], [admin.token, '/admin/support/cases'], [admin.token, '/admin/safety/incidents'], [admin.token, '/admin/privacy-requests'], [admin.token, '/admin/businesses'], [admin.token, '/admin/settings'], [admin.token, '/admin/audit'],
    [admin.token, '/admin/staff'], [admin.token, '/admin/integration-status'], [admin.token, '/admin/finance/payments'], [admin.token, '/admin/finance/position'], [admin.token, '/admin/finance/drivers'], [admin.token, '/admin/finance/refunds'],
    [admin.token, '/admin/finance/payouts'], [admin.token, '/admin/finance/reconciliation'], [admin.token, '/admin/finance/export/ledger']];
  for (const [tok, path] of must) { const r = await t.api('GET', path, { token: tok }); assert.equal(r.status, 200, `${path} -> ${r.status} ${r.raw.slice(0, 150)}`); }
  void KCC;
});

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';
import type { Rule } from '../src/services/pricing.ts';

// The src modules read env/DB config at import time, so they are loaded only after boot() has pointed them at the test database.
let t: Ctx, computeFare: typeof import('../src/services/pricing.ts').computeFare, timeAdjustPercent: typeof import('../src/services/pricing.ts').timeAdjustPercent, kigaliDow: typeof import('../src/services/pricing.ts').kigaliDow;
let SETTING_DEFAULTS: any, SETTING_META: any;
before(async () => {
  t = await boot('rwanda_mobility_test');
  ({ computeFare, timeAdjustPercent, kigaliDow } = await import('../src/services/pricing.js'));
  ({ SETTING_DEFAULTS } = await import('../src/config.js'));
  ({ SETTING_META } = await import('../src/services/settingsMeta.js'));
});
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); await t.db.q("delete from system_settings where key='pricing.self_approval'"); });

const rule: Rule = {
  id: 'r', service_id: 'moto', zone_id: 'kigali', model: 'platform', base_fare: 400, per_km: 250, per_min: 20, minimum_fare: 800, booking_fee: 0,
  wait_per_min: 20, free_wait_min: 3, airport_fee: 0, scheduled_fee: 0, long_distance_km: null, long_distance_per_km: null, tax_bps: 0, rounding: 50,
  surge_enabled: false, surge_cap_bps: 15000, version: 1,
};
const peak = { label: 'Morning peak', days: [1, 2, 3, 4, 5], start_hour: 7, end_hour: 9, percent: 20 };

// ---------- fare engine: time windows ----------
test('time windows: default none = unchanged; peak adds an itemised line; off-peak discounts; other hours/days untouched', () => {
  const base = computeFare(rule, { distance_m: 4200, duration_s: 600, local_hour: 8, local_dow: 2 });
  assert.equal(base.total, 1650); assert.ok(!base.lines.some((l) => l.code === 'time_multiplier'));
  const r = { ...rule, time_multipliers: [peak, { label: 'Sunday', days: [0], start_hour: 0, end_hour: 24, percent: -10 }] };
  const p = computeFare(r, { distance_m: 4200, duration_s: 600, local_hour: 8, local_dow: 2 });   // 1650 * 1.2 = 1980 -> 2000
  const line = p.lines.find((l) => l.code === 'time_multiplier')!;
  assert.equal(line.amount, 330); assert.equal(p.total, 2000);
  assert.ok(line.label_en && line.label_rw && line.label_fr && new Set([line.label_en, line.label_rw, line.label_fr]).size === 3);
  assert.equal(computeFare(r, { distance_m: 4200, duration_s: 600, local_hour: 9, local_dow: 2 }).total, 1650, 'end hour is exclusive');
  assert.equal(computeFare(r, { distance_m: 4200, duration_s: 600, local_hour: 8, local_dow: 6 }).total, 1650, 'wrong weekday');
  const sun = computeFare(r, { distance_m: 4200, duration_s: 600, local_hour: 15, local_dow: 0 });   // 1650 - 165 = 1485 -> 1500
  assert.equal(sun.total, 1500); assert.equal(sun.lines.find((l) => l.code === 'time_multiplier')!.label_fr, 'Remise heures creuses');
  assert.equal(computeFare(r, { distance_m: 4200, duration_s: 600 }).total, 1650, 'no hour supplied: no adjustment');
});

test('time windows add up but can never exceed the rule surge cap or go below -50%; minimum fare still applies', () => {
  const r = { ...rule, surge_cap_bps: 12000, time_multipliers: [peak, { ...peak, label: 'Stack', percent: 100 }] };
  assert.equal(timeAdjustPercent(r, 8, 1), 20, 'capped at +20% by surge_cap_bps');
  assert.equal(timeAdjustPercent({ ...rule, time_multipliers: [{ ...peak, percent: -50 }, { ...peak, percent: -50 }] }, 8, 1), -50);
  const cheap = computeFare({ ...rule, time_multipliers: [{ ...peak, percent: -50 }] }, { distance_m: 300, duration_s: 60, local_hour: 8, local_dow: 1 });
  assert.equal(cheap.total, 800, 'minimum fare is the floor');
  const overnight = { ...rule, time_multipliers: [{ label: 'Late', days: [], start_hour: 22, end_hour: 5, percent: 15 }] };
  assert.equal(timeAdjustPercent(overnight, 23, 3), 15); assert.equal(timeAdjustPercent(overnight, 3, 3), 15); assert.equal(timeAdjustPercent(overnight, 12, 3), 0);
});

test('time windows apply to hourly (Abasare) billing too, and kigaliDow uses Kigali local time', () => {
  const h = { ...rule, billing: 'hourly' as const, hourly_rate: 4000, min_hours: 2, max_hours: 12, time_multipliers: [peak] };
  const f = computeFare(h, { distance_m: 0, duration_s: 0, hours: 3, local_hour: 7, local_dow: 1 });   // 12000 + 20%
  assert.equal(f.total, 14400); assert.ok(f.lines.some((l) => l.code === 'time_multiplier' && l.amount === 2400));
  assert.equal(kigaliDow(new Date('2026-10-06T23:30:00Z')), 3, '23:30 UTC Tuesday is already Wednesday in Kigali');
});

// ---------- preview endpoint ----------
const proposal = { service_id: 'moto', zone_id: 'kigali', base_fare: 600, per_km: 300, per_min: 25, minimum_fare: 1000, rounding: 50, time_multipliers: [peak] };

test('POST /admin/pricing/preview returns exactly what computeFare returns for the same inputs, plus the current price; stores nothing', async () => {
  const bm = await t.staff('business_manager');
  const before = await t.db.q1<any>('select count(*)::int n from pricing_rules');
  const r = await t.api('POST', '/admin/pricing/preview', { token: bm.token, body: { rule: proposal, trip: { distance_km: 4.2, duration_min: 10, local_hour: 8, local_dow: 2 } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const expected = computeFare({ id: 'preview', version: 0, long_distance_km: null, long_distance_per_km: null, surge_enabled: false, surge_cap_bps: 15000, model: 'platform',
    booking_fee: 0, wait_per_min: 0, free_wait_min: 3, airport_fee: 0, scheduled_fee: 0, tax_bps: 0, ...proposal, time_multipliers: [peak] } as Rule, { distance_m: 4200, duration_s: 600, local_hour: 8, local_dow: 2 });
  assert.deepEqual(r.json.proposed, JSON.parse(JSON.stringify(expected)));
  assert.ok(r.json.proposed.lines.some((l: any) => l.code === 'time_multiplier'));
  assert.ok(r.json.current && r.json.current.total > 0 && r.json.current_rule_id, 'current active moto price is returned for the side-by-side');
  assert.ok(!r.json.current.lines.some((l: any) => l.code === 'time_multiplier'));
  assert.equal((await t.db.q1<any>('select count(*)::int n from pricing_rules')).n, before.n);
  // validation shared with propose; hourly checks
  assert.equal((await t.api('POST', '/admin/pricing/preview', { token: bm.token, body: { rule: { ...proposal, base_fare: -1 } } })).status, 400);
  assert.equal((await t.api('POST', '/admin/pricing/preview', { token: bm.token, body: { rule: { ...proposal, night_start_hour: 22 } } })).status, 400, 'night start without end');
  assert.equal((await t.api('POST', '/admin/pricing/preview', { token: bm.token, body: { rule: { ...proposal, billing: 'hourly', hourly_rate: 4000 }, trip: { hours: 1 } } })).status, 400, 'below min hours');
  const hourly = await t.api('POST', '/admin/pricing/preview', { token: bm.token, body: { rule: { ...proposal, billing: 'hourly', hourly_rate: 4000 }, trip: { hours: 3 } } });
  assert.equal(hourly.json.proposed.total, 12000);
  const disp = await t.staff('dispatcher');
  assert.equal((await t.api('POST', '/admin/pricing/preview', { token: disp.token, body: { rule: proposal } })).status, 403);
  assert.equal((await t.api('POST', '/admin/pricing/preview', { body: { rule: proposal } })).status, 401);
});

test('a proposal with time windows is stored, activates on approval and shows up as an itemised line in real estimates', async () => {
  const bm = await t.staff('business_manager'), fa = await t.staff('finance_approver'); const p = await t.register(); await t.driver({ vehicle: 'moto' });
  // a window covering every hour and day makes the test independent of the clock
  const all = { label: 'All day', days: [], start_hour: 0, end_hour: 24, percent: 10 };
  const prop = await t.api('POST', '/admin/pricing', { token: bm.token, body: { ...proposal, time_multipliers: [all] } });
  assert.equal(prop.status, 200, JSON.stringify(prop.json)); assert.deepEqual(prop.json.time_multipliers, [all]);
  assert.equal((await t.api('POST', '/admin/pricing', { token: bm.token, body: { ...proposal, time_multipliers: [{ ...all, percent: 500 }] } })).status, 400, 'percent out of range');
  assert.equal((await t.api('POST', `/admin/pricing/${prop.json.id}/approve`, { token: fa.token })).status, 200);
  const est = (await t.estimate(p.token, { service_id: 'moto' })).json.options[0];
  assert.ok(est.fare.lines.some((l: any) => l.code === 'time_multiplier' && l.amount > 0), JSON.stringify(est.fare.lines));
});

// ---------- self approval ----------
test('self-approval: default off keeps maker-checker; on lets the proposer approve, audited with self_approved; only super_admin flips it', async () => {
  const sa = await t.staff('super_admin'), bm = await t.staff('business_manager'), fa = await t.staff('finance_approver');
  const mk = async (who: any, base: number) => (await t.api('POST', '/admin/pricing', { token: who.token, body: { service_id: 'moto', base_fare: base, per_km: 300, per_min: 25, minimum_fare: 1000 } })).json;
  // default false: the proposer is refused
  const p1 = await mk(sa, 610);
  const refused = await t.api('POST', `/admin/pricing/${p1.id}/approve`, { token: sa.token });
  assert.equal(refused.status, 403); assert.match(refused.json.error.message, /Maker-checker/);
  // only super_admin can change the switch
  assert.equal((await t.api('PUT', '/admin/settings/pricing.self_approval', { token: bm.token, body: { value: true } })).status, 403);
  assert.equal((await t.api('PUT', '/admin/settings/pricing.self_approval', { token: fa.token, body: { value: true } })).status, 403);
  assert.equal((await t.api('PUT', '/admin/settings/pricing.self_approval', { token: sa.token, body: { value: 'yes' } })).status, 400, 'must be a boolean');
  assert.equal((await t.api('PUT', '/admin/settings/pricing.self_approval', { token: sa.token, body: { value: true } })).status, 200);
  assert.equal((await t.api('DELETE', '/admin/settings/pricing.self_approval', { token: bm.token })).status, 403);
  // on: proposer approves own change; flag recorded
  const ok = await t.api('POST', `/admin/pricing/${p1.id}/approve`, { token: sa.token });
  assert.equal(ok.status, 200);
  const log = await t.db.q1<any>("select after from audit_logs where action='pricing.approved' and entity_id=$1", [p1.id]);
  assert.equal(log.after.self_approved, true);
  // a normal second-person approval is flagged false
  const p2 = await mk(bm, 620); assert.equal((await t.api('POST', `/admin/pricing/${p2.id}/approve`, { token: fa.token })).status, 200);
  assert.equal((await t.db.q1<any>("select after from audit_logs where action='pricing.approved' and entity_id=$1", [p2.id])).after.self_approved, false);
  // approving still needs the approve permission, even with the switch on
  const p3 = await mk(bm, 630); assert.equal((await t.api('POST', `/admin/pricing/${p3.id}/approve`, { token: bm.token })).status, 403);
  // commission changes use the same gate
  const c = await t.api('POST', '/admin/commissions', { token: sa.token, body: { service_id: 'moto', kind: 'percent', percent_bps: 1200 } });
  assert.equal((await t.api('POST', `/admin/commissions/${c.json.id}/approve`, { token: sa.token })).status, 200);
  assert.equal((await t.db.q1<any>("select after from audit_logs where action='commission.approved' and entity_id=$1", [c.json.id])).after.self_approved, true);
  // switch off again: refused once more
  assert.equal((await t.api('DELETE', '/admin/settings/pricing.self_approval', { token: sa.token })).status, 200);
  const c2 = await t.api('POST', '/admin/commissions', { token: sa.token, body: { service_id: 'moto', kind: 'percent', percent_bps: 1300 } });
  assert.equal((await t.api('POST', `/admin/commissions/${c2.json.id}/approve`, { token: sa.token })).status, 403);
});

// ---------- settings metadata ----------
test('settings: every default has metadata; GET is data-driven; PUT validates ranges; reset restores the default; changes are attributed', async () => {
  for (const k of Object.keys(SETTING_DEFAULTS)) assert.ok((SETTING_META as any)[k]?.label && (SETTING_META as any)[k]?.desc && (SETTING_META as any)[k]?.group, `metadata for ${k}`);
  const sa = await t.staff('super_admin');
  const g = await t.api('GET', '/admin/settings', { token: sa.token });
  assert.equal(g.status, 200);
  const it = (k: string) => g.json.items.find((x: any) => x.key === k);
  assert.equal(it('booking.cancel_fee').label, 'Late cancellation fee'); assert.equal(it('booking.cancel_fee').unit, 'RWF');
  assert.equal(it('booking.cancel_fee').default, 500); assert.equal(it('booking.cancel_fee').is_default, true);
  assert.ok(g.json.groups.includes('Advanced')); assert.ok(g.json.settings['booking.cancel_fee'] === 500, 'legacy shape kept');
  const bad = await t.api('PUT', '/admin/settings/booking.cancel_fee', { token: sa.token, body: { value: -5 } });
  assert.equal(bad.status, 400); assert.equal(bad.json.error.code, 'invalid_setting');
  assert.equal((await t.api('PUT', '/admin/settings/booking.cancel_fee', { token: sa.token, body: { value: 999999 } })).status, 400);
  assert.equal((await t.api('PUT', '/admin/settings/booking.cancel_fee', { token: sa.token, body: { value: 12.5 } })).status, 400);
  assert.equal((await t.api('PUT', '/admin/settings/dispatch.strategy', { token: sa.token, body: { value: 'random' } })).status, 400);
  assert.equal((await t.api('PUT', '/admin/settings/safety.escalation_contacts', { token: sa.token, body: { value: ['123'] } })).status, 400);
  assert.equal((await t.api('PUT', '/admin/settings/booking.cancel_fee', { token: sa.token, body: { value: 700 } })).status, 200);
  const g2 = (await t.api('GET', '/admin/settings', { token: sa.token })).json;
  const c = g2.items.find((x: any) => x.key === 'booking.cancel_fee');
  assert.equal(c.value, 700); assert.equal(c.is_default, false); assert.ok(typeof c.last_change.by === 'string' && c.last_change.by.length > 0); assert.equal(c.last_change.before, 500); assert.equal(c.last_change.after, 700);
  const r = await t.api('DELETE', '/admin/settings/booking.cancel_fee', { token: sa.token });
  assert.equal(r.status, 200); assert.equal(r.json.value, 500);
  const g3 = (await t.api('GET', '/admin/settings', { token: sa.token })).json.items.find((x: any) => x.key === 'booking.cancel_fee');
  assert.equal(g3.value, 500); assert.equal(g3.is_default, true); assert.equal(g3.last_change.action, 'setting.reset');
  assert.deepEqual((await t.db.q<any>("select action from audit_logs where entity_id='booking.cancel_fee' order by id")).map((x: any) => x.action), ['setting.changed', 'setting.reset']);
});

test('settings: legacy keys stay editable under Advanced; brand-new keys are rejected', async () => {
  const sa = await t.staff('super_admin');
  await t.db.q("insert into system_settings(key,value) values ('legacy.old_toggle','\"x\"') on conflict (key) do nothing");
  const g = (await t.api('GET', '/admin/settings', { token: sa.token })).json.items.find((x: any) => x.key === 'legacy.old_toggle');
  assert.equal(g.group, 'Advanced'); assert.equal(g.has_default, false);
  assert.equal((await t.api('PUT', '/admin/settings/legacy.old_toggle', { token: sa.token, body: { value: { a: 1 } } })).status, 200);
  assert.equal((await t.api('PUT', '/admin/settings/totally.new.key', { token: sa.token, body: { value: 1 } })).status, 400);
  assert.equal((await t.api('DELETE', '/admin/settings/legacy.old_toggle', { token: sa.token })).status, 200);
  assert.equal((await t.api('GET', '/admin/settings', { token: sa.token })).json.items.some((x: any) => x.key === 'legacy.old_toggle'), false);
});

// ---------- segment promotions ----------
test('segment promos: phone list, corporate members, referred sign-ups and first-ride are enforced; dates and budget are editable', async () => {
  const bm = await t.staff('business_manager');
  const a = await t.register(), b = await t.register(); await t.driver({ vehicle: 'moto' });
  const mk = (code: string, extra: any) => t.api('POST', '/admin/promotions', { token: bm.token, body: { code, kind: 'fixed', value: 300, ...extra } });
  assert.equal((await mk('NOPHONES', { segment: 'phones' })).status, 400, 'phone audience needs numbers');
  assert.equal((await mk('BADDATES', { valid_from: '2030-02-01T00:00:00Z', valid_to: '2030-01-01T00:00:00Z' })).status, 400);
  const ph = await mk('VIPLIST', { segment: 'phones', segment_phones: [a.phone] }); assert.equal(ph.status, 200, JSON.stringify(ph.json));
  const est = async (u: any, code: string) => (await t.estimate(u.token, { service_id: 'moto', promo_code: code })).json.options[0];
  assert.ok((await est(a, 'VIPLIST')).promo.discount > 0);
  assert.equal((await est(b, 'VIPLIST')).promo.error, 'promo_not_eligible');
  // corporate
  await mk('CORPONLY', { segment: 'corporate' });
  assert.equal((await est(a, 'CORPONLY')).promo.error, 'promo_not_eligible');
  const corp = await t.db.q1<any>("insert into corporate_accounts(legal_name,status) values ('Seg Co','active') returning id");
  await t.db.q("insert into corporate_members(corporate_id,user_id,role) values ($1,$2,'employee')", [corp.id, a.id]);
  assert.ok((await est(a, 'CORPONLY')).promo.discount > 0);
  // referred
  await mk('FRIENDS', { segment: 'referred' });
  assert.equal((await est(a, 'FRIENDS')).promo.error, 'promo_not_eligible');
  await t.db.q('insert into referrals(referrer_id, referee_id) values ($1,$2)', [b.id, a.id]);
  assert.ok((await est(a, 'FRIENDS')).promo.discount > 0);
  // first ride segment maps onto first_ride_only
  const fr = await mk('NEWBIE', { segment: 'first_ride' }); assert.equal(fr.json.first_ride_only, true);
  // start date in the future blocks use; budget and dates editable with audit
  const future = await mk('LATER', { valid_from: new Date(Date.now() + 86400_000).toISOString() });
  assert.equal((await est(a, 'LATER')).promo.error, 'promo_expired');
  const up = await t.api('PATCH', `/admin/promotions/${future.json.id}`, { token: bm.token, body: { valid_from: new Date(Date.now() - 1000).toISOString(), budget: 5000 } });
  assert.equal(up.status, 200); assert.ok((await est(a, 'LATER')).promo.discount > 0);
  assert.equal((await t.api('PATCH', `/admin/promotions/${future.json.id}`, { token: bm.token, body: {} })).status, 400);
  assert.equal((await t.db.q1<any>("select budget from promotions where id=$1", [future.json.id])).budget, 5000);
  assert.ok((await t.db.q<any>("select 1 from audit_logs where action='promotion.updated' and entity_id=$1", [future.json.id])).length === 1);
});

// ---------- services manager ----------
test('services manager: rename, capacity, and per-zone enable/disable are audited and respected by estimates', async () => {
  const bm = await t.staff('business_manager'); const p = await t.register(); await t.driver({ vehicle: 'moto' });
  assert.equal((await t.api('PATCH', '/admin/services/moto', { token: bm.token, body: { name_en: 'Moto Taxi', name_fr: 'Moto-taxi', passenger_capacity: 1 } })).status, 200);
  assert.equal((await t.db.q1<any>("select name_en, name_fr from service_categories where id='moto'")).name_en, 'Moto Taxi');
  assert.equal((await t.api('PATCH', '/admin/services/moto', { token: bm.token, body: { name_en: 'x' } })).status, 400);
  const off = await t.api('PUT', '/admin/services/moto/zones/kigali', { token: bm.token, body: { enabled: false } });
  assert.equal(off.status, 200);
  assert.equal((await t.estimate(p.token, { service_id: 'moto' })).status, 400, 'disabled in the zone');
  assert.equal((await t.api('PUT', '/admin/services/moto/zones/kigali', { token: bm.token, body: { enabled: true } })).status, 200);
  assert.equal((await t.estimate(p.token, { service_id: 'moto' })).status, 200);
  assert.equal((await t.api('PUT', '/admin/services/moto/zones/nowhere', { token: bm.token, body: { enabled: true } })).status, 404);
  assert.deepEqual((await t.db.q<any>("select action from audit_logs where action='service.zone_changed' order by id")).length, 2);
  await t.db.q("update service_categories set name_en='Moto' where id='moto'");
});

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx } from './helpers.ts';

// Round 5: gradual rollout and off-switch, fraud checks, staff alerts, dashboard, chat privacy, referrals, vehicle application, review queue.
let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

test('R5-01 rollout: 0% is off, 100% is on, 50% splits people stably', async () => {
  const { flagFor, rolloutBucket } = await import('../src/services/settings.ts');
  await t.db.q("update feature_flags set enabled=true, rollout_pct=0 where key='chat.enabled'");
  assert.equal(await flagFor('chat.enabled', randomUUID()), false);
  await t.db.q("update feature_flags set rollout_pct=100 where key='chat.enabled'");
  assert.equal(await flagFor('chat.enabled', randomUUID()), true);
  await t.db.q("update feature_flags set rollout_pct=50 where key='chat.enabled'");
  const ids = Array.from({ length: 400 }, () => randomUUID());
  const on = (await Promise.all(ids.map((i) => flagFor('chat.enabled', i)))).filter(Boolean).length;
  assert.ok(on > 140 && on < 260, `about half are on (${on})`);
  assert.equal(rolloutBucket('chat.enabled', ids[0]), rolloutBucket('chat.enabled', ids[0]), 'stable per person');
  await t.db.q("update feature_flags set enabled=true, rollout_pct=100 where key='chat.enabled'");
});

test('R5-02 /config/flags tells the app what is on for this person, with the off message; booking.requests is a remote off-switch', async () => {
  const p = await t.register('passenger'); await t.driver();
  await t.db.q("update feature_flags set enabled=false, disabled_message='Maintenance until 10:00' where key='booking.requests'");
  try {
    const f = await t.api('GET', '/config/flags', { token: p.token });
    assert.equal(f.status, 200); assert.equal(f.json.flags['booking.requests'].on, false); assert.equal(f.json.flags['booking.requests'].message, 'Maintenance until 10:00');
    assert.equal(f.json.flags['chat.enabled'].on, true); assert.ok(f.json.support.phone);
    const { res } = await t.book(p.token, 'moto', 'cash');
    assert.equal(res.status, 503); assert.equal(res.json.error.code, 'service_paused'); assert.match(res.json.error.message, /Maintenance until 10:00/);
    const admin = await t.staff('super_admin');
    const put = await t.api('PUT', '/admin/flags/booking.requests', { token: admin.token, body: { enabled: true, rollout_pct: 100, client_visible: true } });
    assert.equal(put.status, 200);
    assert.equal((await t.book(p.token, 'moto', 'cash')).res.status, 201);
  } finally { await t.db.q("update feature_flags set enabled=true, disabled_message=null, rollout_pct=100 where key='booking.requests'"); }
});

test('R5-03 cancel-and-rebook loop pauses new requests after the limit, and records the signal', async () => {
  await t.db.q("update system_settings set value='3' where key='fraud.cancel_loop_count'");
  const p = await t.register('passenger'); await t.driver();
  for (let i = 0; i < 3; i++) {
    const b = await t.book(p.token, 'moto', 'cash'); assert.equal(b.res.status, 201, 'booking ' + i);
    assert.equal((await t.api('POST', `/bookings/${b.res.json.booking.id}/cancel`, { token: p.token, body: { reason: 'changed my mind' } })).status, 200);
  }
  const blocked = await t.book(p.token, 'moto', 'cash');
  assert.equal(blocked.res.status, 429); assert.equal(blocked.res.json.error.code, 'cancel_loop');
  assert.ok(blocked.res.json.error.details?.minutes >= 1);
  assert.equal((await t.db.q1<any>("select count(*)::int n from risk_events where user_id=$1 and kind='cancel_loop'", [p.id])).n, 1);
  const rw = await t.api('POST', '/bookings', { token: p.token, headers: { 'accept-language': 'rw', 'idempotency-key': randomUUID() }, body: { quote_id: randomUUID(), payment_method: 'cash' } });
  assert.equal(rw.status, 429); assert.match(rw.json.error.message, /iminota/);
});

test('R5-04 one promo, one account per phone', async () => {
  const { promoDeviceOk } = await import('../src/services/fraud.ts');
  await t.driver(); const a = await t.register('passenger', undefined, 'shared-phone-1'), b = await t.register('passenger', undefined, 'shared-phone-1'), c = await t.register('passenger', undefined, 'other-phone');
  const promo = (await t.db.q1<any>("insert into promotions(code, kind, value) values ($1,'fixed',500) returning id", ['DEV' + Math.floor(Math.random() * 1e6)]))!;
  assert.equal(await promoDeviceOk(promo.id, a.id), true);
  // account a redeems it from its phone
  const bk = await t.book(a.token, 'moto', 'cash'); await t.db.q('insert into promotion_redemptions(promotion_id,user_id,booking_id,amount,device_id) values ($1,$2,$3,500,$4)', [promo.id, a.id, bk.res.json.booking.id, 'shared-phone-1']);
  assert.equal(await promoDeviceOk(promo.id, b.id), false, 'a second account on the same phone is refused');
  assert.equal(await promoDeviceOk(promo.id, c.id), true, 'a different phone is fine');
  assert.equal((await t.db.q1<any>("select count(*)::int n from risk_events where user_id=$1 and kind='promo_device'", [b.id])).n, 1);
});

test('R5-05 staff alerts: failed sign-ins, token reuse and off-hours privileged actions raise one alert; acknowledging works; dashboard answers', async () => {
  const { auditWatch } = await import('../src/services/alerts.ts');
  const { audit } = await import('../src/services/audit.ts');
  const admin = await t.staff('super_admin'), lead = await t.staff('support_lead'), disp = await t.staff('dispatcher');
  const victim = await t.db.q1<any>("select id from users where id=$1", [disp.id]);
  for (let i = 0; i < 5; i++) await audit({ id: victim.id, ip: '1.2.3.4' }, 'auth.staff_login_failed', 'user', victim.id);
  await new Promise((r) => setTimeout(r, 300));
  let list = await t.api('GET', '/admin/alerts', { token: lead.token });
  assert.equal(list.status, 200); assert.ok(list.json.alerts.some((a: any) => a.kind === 'failed_logins'), 'failed logins alert');
  for (let i = 0; i < 3; i++) await audit({ id: victim.id, ip: '1.2.3.4' }, 'auth.staff_login_failed', 'user', victim.id);
  await new Promise((r) => setTimeout(r, 300));
  list = await t.api('GET', '/admin/alerts', { token: lead.token });
  assert.equal(list.json.alerts.filter((a: any) => a.kind === 'failed_logins').length, 1, 'one open alert per account');
  await t.db.q("insert into system_settings(key,value) values ('alerts.off_hours_start','0'),('alerts.off_hours_end','23') on conflict (key) do update set value=excluded.value");
  await auditWatch({ id: admin.id, role: 'super_admin' }, 'setting.changed', 'setting', 'x');
  list = await t.api('GET', '/admin/alerts', { token: lead.token });
  assert.ok(list.json.alerts.some((a: any) => a.kind === 'off_hours'), 'off-hours alert');
  await t.db.q("delete from system_settings where key in ('alerts.off_hours_start','alerts.off_hours_end')");
  const first = list.json.alerts[0];
  assert.equal((await t.api('POST', `/admin/alerts/${first.id}/ack`, { token: lead.token })).status, 200);
  assert.equal((await t.api('POST', `/admin/alerts/${first.id}/ack`, { token: lead.token })).status, 404, 'already acknowledged');
  assert.equal((await t.api('GET', '/admin/alerts', { token: disp.token })).status, 403, 'dispatcher has no alert access');
  const d = await t.api('GET', '/admin/dashboard/ops?hours=24', { token: admin.token });
  assert.equal(d.status, 200);
  for (const k of ['live', 'trips', 'time_to_first_driver', 'payments', 'per_hour']) assert.ok(k in d.json, k);
  assert.equal(typeof d.json.trips.cancellation_rate_pct, 'number');
});

test('R5-06 dashboard counts trips, cancellations, time to first driver and failed payments', async () => {
  const p = await t.register('passenger'); const d = await t.driver(); const admin = await t.staff('super_admin');
  const b1 = await t.book(p.token, 'moto', 'cash'); await t.runTrip(p, d, b1.res.json.booking.id);
  const b2 = await t.book(p.token, 'moto', 'cash'); await t.api('POST', `/bookings/${b2.res.json.booking.id}/cancel`, { token: p.token, body: { reason: 'changed my mind' } });
  const r = await t.api('GET', '/admin/dashboard/ops?hours=1', { token: admin.token });
  assert.ok(r.json.trips.requested >= 2 && r.json.trips.completed >= 1 && r.json.trips.cancelled >= 1);
  assert.ok(r.json.time_to_first_driver.assigned_trips >= 1 && r.json.time_to_first_driver.median_s >= 0);
  assert.ok(r.json.per_hour.length >= 1);
});

test('R5-07 chat: unread count, read on open, push once a minute, numbers hidden until shared', async () => {
  const p = await t.register('passenger'); const d = await t.driver();
  const bk = await t.book(p.token, 'moto', 'cash'); const id = bk.res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  assert.equal((await t.api('POST', `/bookings/${id}/messages`, { token: p.token, body: { body: 'I am at the gate' } })).status, 200);
  await t.api('POST', `/bookings/${id}/messages`, { token: p.token, body: { body: 'blue jacket' } });
  const dv = await t.api('GET', `/bookings/${id}`, { token: d.token });
  assert.equal(dv.json.unread_messages, 2); assert.equal(dv.json.contact_phone, undefined, 'driver sees no rider number');
  assert.equal((await t.db.q1<any>("select count(*)::int n from notifications where user_id=$1 and template_key='chat_message' and channel='in_app'", [d.id])).n, 1, 'one notification per minute');
  const list = await t.api('GET', `/bookings/${id}/messages`, { token: d.token });
  assert.equal(list.json.messages.length, 2);
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: d.token })).json.unread_messages, 0, 'opening the chat marks read');
  const after = await t.api('GET', `/bookings/${id}/messages?after=${list.json.messages[0].id}`, { token: d.token });
  assert.equal(after.json.messages.length, 1);
  // numbers: hidden both ways until the other person shares
  const pv = await t.api('GET', `/bookings/${id}`, { token: p.token });
  assert.equal(pv.json.contact_phone, undefined);
  await t.api('POST', `/bookings/${id}/share-phone`, { token: d.token, body: { share: true } });
  const pv2 = await t.api('GET', `/bookings/${id}`, { token: p.token });
  assert.ok(pv2.json.contact_phone, 'rider now sees the driver number'); assert.equal(pv2.json.phone_sharing.they_share, true);
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: d.token })).json.contact_phone, undefined, 'the driver still does not see the rider number');
  // chat switched off remotely
  await t.db.q("update feature_flags set enabled=false where key='chat.enabled'");
  try { assert.equal((await t.api('POST', `/bookings/${id}/messages`, { token: p.token, body: { body: 'x' } })).json.error.code, 'chat_unavailable'); }
  finally { await t.db.q("update feature_flags set enabled=true where key='chat.enabled'"); }
});

test('R5-08 referrals: rewarded once with tier bonus; same phone is rejected; monthly cap', async () => {
  const { tx } = await import('../src/db.ts');
  const { rewardReferral, referralSummary } = await import('../src/services/referrals.ts');
  const inviter = await t.register('passenger', undefined, 'inv-dev');
  await t.driver();
  const mk = async (device: string) => { const u = await t.register('passenger', undefined, device); const b = await t.book(u.token, 'moto', 'cash'); return { u, b: b.res.json.booking }; };
  // same phone as the inviter: rejected
  const same = await mk('inv-dev');
  await t.db.q('insert into referrals(referrer_id, referee_id) values ($1,$2)', [inviter.id, same.u.id]);
  await tx(async (c) => rewardReferral(c, { id: same.b.id, passenger_id: same.u.id }));
  assert.equal((await t.db.q1<any>('select status, reject_reason from referrals where referee_id=$1', [same.u.id])).reject_reason, 'same_device');
  // a real new rider: rewarded, voucher created for both, ambassador row appears
  const ok = await mk('friend-dev');
  await t.db.q('insert into referrals(referrer_id, referee_id) values ($1,$2)', [inviter.id, ok.u.id]);
  await tx(async (c) => rewardReferral(c, { id: ok.b.id, passenger_id: ok.u.id }));
  const r = await t.db.q1<any>('select * from referrals where referee_id=$1', [ok.u.id]);
  assert.equal(r.status, 'rewarded'); assert.equal(r.reward_referrer, 1000); assert.equal(r.reward_referee, 1000); assert.equal(r.trigger_booking_id, ok.b.id);
  assert.equal((await t.db.q1<any>("select tier from ambassadors where user_id=$1", [inviter.id])).tier, 'bronze');
  assert.equal((await t.db.q<any>('select 1 from promotions where user_id = any($1)', [[inviter.id, ok.u.id]])).length, 2);
  const s = await referralSummary(inviter.id);
  assert.equal(s.rewarded, 1); assert.equal(s.rejected, 1); assert.equal(s.earned, 1000); assert.equal(s.tier, 'bronze'); assert.equal(s.next?.tier, 'silver');
  // monthly cap
  await t.db.q("insert into system_settings(key,value) values ('referral.max_rewards_per_month','1') on conflict (key) do update set value=excluded.value");
  try {
    const third = await mk('third-dev');
    await t.db.q('insert into referrals(referrer_id, referee_id) values ($1,$2)', [inviter.id, third.u.id]);
    await tx(async (c) => rewardReferral(c, { id: third.b.id, passenger_id: third.u.id }));
    assert.equal((await t.db.q1<any>('select reject_reason from referrals where referee_id=$1', [third.u.id])).reject_reason, 'monthly_cap');
  } finally { await t.db.q("delete from system_settings where key='referral.max_rewards_per_month'"); }
});

test('R5-09 an approved driver without a vehicle applies for one; staff review it; ride jobs follow approval', async () => {
  const d = await t.register('driver'); const admin = await t.staff('super_admin'); const ver = await t.staff('driver_verifier');
  await t.db.q("update driver_profiles set status='APPROVED', legal_name='Abasare Driver', zone_id='kigali' where user_id=$1", [d.id]);
  const none = await t.api('GET', '/drivers/me/vehicle-application', { token: d.token });
  assert.equal(none.json.can_apply, true); assert.equal(none.json.stage, 'none');
  const body = { vehicle_type: 'car', make: 'Toyota', model: 'Vitz', color: 'White', year: 2016, plate: 'RAD' + Math.floor(100 + Math.random() * 899) + 'C', capacity: 4, comfort: false };
  assert.equal((await t.api('POST', '/drivers/me/vehicle-application', { token: d.token, body })).status, 200);
  assert.equal((await t.api('POST', '/drivers/me/vehicle-application/submit', { token: d.token })).json.error.code, 'documents_missing');
  const reqs = await t.db.q<any>("select doc_type, requires_expiry from document_requirements where vehicle_type='car' and mandatory");
  for (const r of reqs) await t.db.q("insert into driver_documents(driver_id, doc_type, file_key, mime, size, expiry_date, review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'pending')", [d.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
  const st = await t.api('GET', '/drivers/me/vehicle-application', { token: d.token });
  assert.ok(st.json.checklist.length >= 4 && st.json.checklist.filter((c: any) => c.mandatory).every((c: any) => c.status !== 'missing'));
  assert.equal((await t.api('POST', '/drivers/me/vehicle-application/submit', { token: d.token })).status, 200);
  assert.equal((await t.api('POST', '/drivers/me/vehicle-application', { token: d.token, body })).json.error.code, 'vehicle_already_pending', 'cannot edit while in review');
  const q = await t.api('GET', '/admin/review-queue', { token: ver.token });
  const row = q.json.vehicle_applications.find((v: any) => v.driver_id === d.id); assert.ok(row); assert.equal(row.late, false);
  const veh = await t.db.q1<any>("select id from vehicles where driver_id=$1", [d.id]);
  assert.equal((await t.api('POST', `/admin/vehicles/${veh.id}/review`, { token: ver.token, body: { decision: 'approve' } })).json.error.code, 'documents_not_approved');
  await t.db.q("update driver_documents set review_status='approved' where driver_id=$1", [d.id]);
  assert.equal((await t.api('POST', `/admin/vehicles/${veh.id}/review`, { token: ver.token, body: { decision: 'approve' } })).status, 200);
  assert.equal((await t.db.q1<any>('select status from vehicles where id=$1', [veh.id])).status, 'approved');
  assert.equal((await t.db.q1<any>("select count(*)::int n from notifications where user_id=$1 and template_key='vehicle_approved' and channel='in_app'", [d.id])).n, 1);
  assert.equal((await t.api('GET', '/drivers/me/vehicle-application', { token: d.token })).json.stage, 'approved');
  assert.equal((await t.api('GET', '/drivers/me/onboarding', { token: d.token })).status, 200);
  assert.equal((await t.api('GET', '/admin/review-queue', { token: admin.token })).status, 200);
});

test('R5-10 an applicant who is not yet approved cannot use the vehicle-application route; onboarding tracker shows the next step', async () => {
  const d = await t.register('driver');
  assert.equal((await t.api('POST', '/drivers/me/vehicle-application', { token: d.token, body: { vehicle_type: 'moto', make: 'TVS', model: 'HLX', color: 'Blue', plate: 'RE123B', capacity: 1 } })).json.error.code, 'not_approved_driver');
  const o = await t.api('GET', '/drivers/me/onboarding', { token: d.token });
  assert.equal(o.status, 200); assert.equal(o.json.status, 'APPLICATION_STARTED'); assert.ok(o.json.review.target_hours >= 1);
});

test('R5-11 SOS also reaches the owner support number and raises a console alert', async () => {
  const p = await t.register('passenger');
  const r = await t.api('POST', '/safety/sos', { token: p.token, body: { lat: -1.95, lng: 30.06 } });
  assert.equal(r.status, 200); assert.equal(r.json.support.phone, '+250786880880'); assert.match(r.json.share_text, /SOS/);
  const a = await t.db.q1<any>("select severity from admin_alerts where kind='sos' order by id desc limit 1"); assert.equal(a.severity, 'critical');
});

test('R5-12 own road router: real road distances, turn steps, far cities, unreachable points', async () => {
  const { routeOnRoads, graphStats } = await import('../src/services/roadGraph.ts');
  assert.ok((graphStats()?.edges ?? 0) > 100_000, 'road graph loaded');
  const r = routeOnRoads({ lat: -1.9536, lng: 30.0927 }, { lat: -1.9395, lng: 30.1255 }, 'car')!;
  assert.ok(r.distance_m > 4500 && r.distance_m < 9500, `KCC to Kimironko about 5-9 km by road (${r.distance_m})`);
  assert.ok(r.duration_s > 300 && r.duration_s < 1800);
  assert.equal(r.steps[0].maneuver, 'depart'); assert.equal(r.steps.at(-1)!.maneuver, 'arrive');
  assert.ok(r.steps.length >= 3 && r.geometry.length > 20);
  assert.ok(r.distance_m >= (await import('../src/util/geo.ts')).haversineM({ lat: -1.9536, lng: 30.0927 }, { lat: -1.9395, lng: 30.1255 }), 'never shorter than the straight line');
  const moto = routeOnRoads({ lat: -1.9536, lng: 30.0927 }, { lat: -1.9395, lng: 30.1255 }, 'moto')!;
  assert.ok(moto.duration_s < r.duration_s, 'a moto is quicker than a car');
  const far = routeOnRoads({ lat: -1.9441, lng: 30.0619 }, { lat: -1.4998, lng: 29.6349 }, 'car')!;
  assert.ok(far.distance_m > 80_000 && far.distance_m < 110_000, `Kigali to Musanze (${far.distance_m})`);
  assert.equal(routeOnRoads({ lat: -1.9536, lng: 30.0927 }, { lat: 5, lng: 10 }, 'car'), null, 'a point outside Rwanda has no road');
  const same = routeOnRoads({ lat: -1.9536, lng: 30.0927 }, { lat: -1.9536, lng: 30.0927 }, 'car'); assert.ok(same && same.distance_m < 30, 'the same place is a zero-length trip');
});

test('R5-13 MAP_PROVIDER=roads feeds fares; the driver gets a turn-by-turn route to the pickup and then the destination', async () => {
  const { config } = await import('../src/config.ts');
  const prev = config.mapProvider; (config as any).mapProvider = 'roads';
  try {
    const p = await t.register('passenger'); const d = await t.driver({ at: { lat: -1.9536, lng: 30.0927 } });
    const e = await t.estimate(p.token, { service_id: 'moto' });
    assert.equal(e.json.options[0].route_source, 'roads'); assert.ok(e.json.options[0].distance_m > 3000);
    const bk = await t.book(p.token, 'moto', 'cash'); const id = bk.res.json.booking.id;
    await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
    const nav = await t.api('GET', `/bookings/${id}/navigation`, { token: d.token });
    assert.equal(nav.status, 200); assert.equal(nav.json.target, 'pickup'); assert.equal(nav.json.available, true);
    assert.ok(Array.isArray(nav.json.steps) && nav.json.geometry.length >= 2);
    const from = await t.api('GET', `/bookings/${id}/navigation?lat=-1.9536&lng=30.0927`, { token: d.token }); assert.equal(from.status, 200);
    assert.equal((await t.api('GET', `/bookings/${id}/navigation`, { token: p.token })).status, 403, 'only the driver');
    assert.equal((await t.api('GET', `/bookings/${id}/navigation?lat=40&lng=30`, { token: d.token })).status, 400, 'bad coordinates');
    await t.db.q("update feature_flags set enabled=false where key='navigation.enabled'");
    try { assert.equal((await t.api('GET', `/bookings/${id}/navigation`, { token: d.token })).json.error.code, 'navigation_unavailable'); }
    finally { await t.db.q("update feature_flags set enabled=true where key='navigation.enabled'"); }
  } finally { (config as any).mapProvider = prev; }
});

test('R5-20 console pulse shows each role only what it may see; the daily digest needs analytics.view', async () => {
  const admin = await t.staff('super_admin'); const sup = await t.staff('support_agent'); const p = await t.register('passenger');
  const a = await t.api('GET', '/admin/pulse', { token: admin.token });
  assert.equal(a.status, 200); assert.equal(typeof a.json.sos.open, 'number'); assert.equal(typeof a.json.drivers_waiting, 'number');
  const s = await t.api('GET', '/admin/pulse', { token: sup.token });
  assert.equal(s.status, 200); assert.ok(s.json.support); assert.equal(s.json.sos, null, 'support agents do not see the safety counter');
  assert.equal((await t.api('GET', '/admin/pulse', { token: p.token })).status, 403);
  const d = await t.api('GET', '/admin/digest?date=2026-10-09', { token: admin.token });
  assert.equal(d.status, 200); assert.equal(d.json.date, '2026-10-09'); assert.ok('trips' in d.json && 'money' in d.json && 'suspicious' in d.json);
  assert.equal((await t.api('GET', '/admin/digest', { token: sup.token })).status, 403);
});

test('R5-21 shortest notice for scheduled trips and the quick hire lengths are settings, and the app reads them from /config', async () => {
  const admin = await t.staff('super_admin'); const p = await t.register('passenger');
  const c0 = await t.api('GET', '/config', { token: p.token }); assert.equal(c0.status, 200);
  assert.equal(c0.json.booking.min_schedule_lead_min, 20); assert.deepEqual(c0.json.abasare.packages, [2, 4, 8, 12]);
  assert.equal((await t.api('PUT', '/admin/settings/booking.min_schedule_lead_min', { token: admin.token, body: { value: 90 } })).status, 200);
  assert.equal((await t.api('PUT', '/admin/settings/abasare.quick_hours', { token: admin.token, body: { value: [3, 6, 10] } })).status, 200);
  try {
    const c1 = await t.api('GET', '/config', { token: p.token }); assert.equal(c1.json.booking.min_schedule_lead_min, 90); assert.deepEqual(c1.json.abasare.packages, [3, 6, 10]);
    const soon = new Date(Date.now() + 45 * 60e3).toISOString();
    const e = await t.api('POST', '/fares/estimate', { token: p.token, body: { pickup: { lat: -1.954, lng: 30.0927 }, dest: { lat: -1.9496, lng: 30.1262 }, service_id: 'moto', scheduled_for: soon } });
    assert.equal(e.status, 400); assert.equal(e.json.error.code, 'invalid_schedule'); assert.match(e.json.error.message, /90 minutes/);
  } finally { await t.api('DELETE', '/admin/settings/booking.min_schedule_lead_min', { token: admin.token }); await t.api('DELETE', '/admin/settings/abasare.quick_hours', { token: admin.token }); }
});

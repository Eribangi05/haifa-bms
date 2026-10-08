import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { boot, type Ctx, KCC, KIMIRONKO } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const JSONH = { accept: 'application/json' };
const setLoc = (d: any, lat: number, lng: number) => t.db.q('update driver_profiles set last_lat=$2, last_lng=$3, last_location_at=now(), last_seen_at=now(), is_online=true where user_id=$1', [d.id, lat, lng]);
const ledgerBalanced = async () => {
  const bad = await t.db.q('select txn_id from ledger_entries group by txn_id having sum(debit) <> sum(credit)');
  assert.equal(bad.length, 0, 'every ledger transaction balances');
};
/** Passenger books, driver accepts and drives to IN_PROGRESS. */
async function inProgress(p: any, d: any, method = 'cash') {
  const { res } = await t.book(p.token, 'moto', method); const id = res.json.booking.id as string;
  assert.equal((await t.api('POST', `/bookings/${id}/accept`, { token: d.token })).status, 200);
  await setLoc(d, KCC.lat + 0.0001, KCC.lng);
  await t.api('POST', `/bookings/${id}/en-route`, { token: d.token });
  assert.equal((await t.api('POST', `/bookings/${id}/arrived`, { token: d.token })).status, 200);
  const pv = await t.api('GET', `/bookings/${id}`, { token: p.token });
  const st = await t.api('POST', `/bookings/${id}/start`, { token: d.token, body: { pin: pv.json.trip_pin } });
  assert.equal(st.status, 200);
  return id;
}
const complete = async (d: any, id: string) => assert.equal((await t.api('POST', `/bookings/${id}/complete`, { token: d.token })).status, 200);
const smsTo = (phone: string) => t.db.q<any>("select * from notifications where channel='sms' and to_phone=$1 order by created_at", [phone]);

// ---------------------------------------------------------------- 1. trusted contacts
test('trusted contacts: opt-in per contact, own language, driver first name + plate + personal link, arrived-safely, opt-out respected', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await t.db.q("update users set display_name='Aline Uwase' where id=$1", [p.id]);
  const c1 = await t.api('POST', '/users/me/emergency-contacts', { token: p.token, body: { name: 'Maman', phone: '0788111222', notify_on_trip: true, lang: 'fr' } });
  const c2 = await t.api('POST', '/users/me/emergency-contacts', { token: p.token, body: { name: 'Papa', phone: '0788333444' } });
  assert.equal(c1.status, 200); assert.equal(c1.json.notify_on_trip, true); assert.equal(c1.json.lang, 'fr');
  assert.equal(c2.json.notify_on_trip, false); assert.equal(c2.json.lang, 'rw');
  assert.equal((await t.api('POST', '/users/me/emergency-contacts', { token: p.token, body: { name: 'X', phone: '0788555666', lang: 'de' } })).status, 400);
  const id = await inProgress(p, d);
  const m1 = await smsTo('+250788111222');
  assert.equal(m1.length, 1);
  assert.match(m1[0].body, /Aline a commencé une course avec le chauffeur Test/); assert.ok(m1[0].body.includes(d.plate)); assert.match(m1[0].body, /\/share\/[\w-]+\?lang=fr/);
  assert.ok(!m1[0].body.includes(p.phone) && !/Uwase/.test(m1[0].body), 'first name only, never the passenger phone or surname');
  assert.equal((await smsTo('+250788333444')).length, 0, 'a contact who did not opt in is never messaged');
  // the link works, is personal, and carries live data without PII
  const token = m1[0].body.match(/\/share\/([\w-]+)\?/)![1];
  const pub = await t.api('GET', `/share/${token}`, { headers: JSONH });
  assert.equal(pub.status, 200); assert.equal(pub.json.driver.plate, d.plate); assert.equal(pub.json.can_stop, true);
  assert.ok(!JSON.stringify(pub.json).includes('+250'));
  await complete(d, id);
  const after = await smsTo('+250788111222');
  assert.equal(after.length, 2); assert.match(after[1].body, /Aline est bien arrivé\(e\)/);
  // idempotent: no duplicates when the hook runs again
  const { onTripStarted } = await import('../src/services/safety.ts');
  await onTripStarted((await t.db.q1<any>('select * from bookings where id=$1', [id]))!);
  assert.equal((await smsTo('+250788111222')).length, 2);
  // delivery goes to the contact number (SIMULATED provider)
  const { outbox } = await import('../src/providers/sms.ts'); const { flushSms } = await import('../src/services/notify.ts');
  await flushSms(200);
  assert.ok(outbox.some((m) => m.to === '+250788111222' && /Aline a commencé/.test(m.text)));
});

test('trusted contacts: STOP link opts the number out; passenger auto_share and per-trip switch both stop messages', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await t.api('POST', '/users/me/emergency-contacts', { token: p.token, body: { name: 'Maman', phone: '0788121212', notify_on_trip: true, lang: 'en' } });
  const id = await inProgress(p, d);
  const msg = (await smsTo('+250788121212'))[0]; assert.match(msg.body, /Follow live/);
  const token = msg.body.match(/\/share\/([\w-]+)\?/)![1];
  assert.equal((await t.api('POST', `/share/${token}/stop`)).json.stopped, true);
  assert.equal((await t.api('GET', `/share/${token}`, { headers: JSONH })).status, 404, 'the personal link stops too');
  assert.equal((await t.db.q1<any>("select count(*)::int n from sms_opt_outs where phone='+250788121212'")).n, 1);
  assert.equal((await t.db.q1<any>("select notify_on_trip from emergency_contacts where phone='+250788121212'")).notify_on_trip, false);
  await complete(d, id);
  assert.equal((await smsTo('+250788121212')).length, 1, 'no arrived message after an opt-out');
  // master switch off
  const p2 = await t.register();
  await t.api('POST', '/users/me/emergency-contacts', { token: p2.token, body: { name: 'A', phone: '0788343434', notify_on_trip: true } });
  assert.equal((await t.api('PATCH', '/users/me/safety-prefs', { token: p2.token, body: { auto_share: false } })).json.auto_share, false);
  const d2 = await t.driver({ vehicle: 'moto' }); const id2 = await inProgress(p2, d2); await complete(d2, id2);
  assert.equal((await smsTo('+250788343434')).length, 0);
  // per-trip switch
  const p3 = await t.register(); await t.api('POST', '/users/me/emergency-contacts', { token: p3.token, body: { name: 'B', phone: '0788565656', notify_on_trip: true } });
  const d3 = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p3.token); const b3 = res.json.booking.id;
  assert.equal((await t.api('PATCH', `/bookings/${b3}/safety-settings`, { token: p3.token, body: { auto_share: false, safety_checks: false } })).json.auto_share, false);
  await t.api('POST', `/bookings/${b3}/accept`, { token: d3.token });
  await setLoc(d3, KCC.lat + 0.0001, KCC.lng);
  await t.api('POST', `/bookings/${b3}/arrived`, { token: d3.token });
  const pin = (await t.api('GET', `/bookings/${b3}`, { token: p3.token })).json.trip_pin;
  await t.api('POST', `/bookings/${b3}/start`, { token: d3.token, body: { pin } });
  assert.equal((await smsTo('+250788565656')).length, 0);
  // admin can record an opt-out
  const lead = await t.staff('support_lead');
  assert.equal((await t.api('POST', '/admin/safety/opt-outs', { token: lead.token, body: { phone: '0788565656' } })).status, 200);
  assert.equal((await t.api('GET', '/admin/safety/opt-outs', { token: lead.token })).json.opt_outs.length >= 2, true);
});

// ---------------------------------------------------------------- 2. live share v2
test('live share v2: eta, vehicle, status, no PII, hide destination, revoke one, expiry trip end + 1h, page in 3 languages', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  const a = await t.api('POST', `/bookings/${id}/share`, { token: p.token, body: { hide_destination: true } });
  const b = await t.api('POST', `/bookings/${id}/share`, { token: p.token, body: {} });
  const ja = await t.api('GET', `/share/${a.json.token}`, { headers: JSONH });
  assert.equal(ja.json.destination, null); assert.equal(ja.json.live, true); assert.equal(ja.json.eta_target, 'pickup'); assert.ok(ja.json.eta_s >= 0);
  assert.equal(ja.json.driver.plate, d.plate); assert.ok(ja.json.driver.vehicle.includes('Toyota')); assert.ok(ja.json.location.lat);
  assert.equal((await t.api('GET', `/share/${b.json.token}`, { headers: JSONH })).json.destination, 'Kimironko');
  assert.ok(!JSON.stringify(ja.json).match(/\+250|passenger|ref/i));
  assert.equal(ja.headers['cache-control'], 'no-store');
  // revoke only the first link
  const list = await t.api('GET', `/bookings/${id}/shares`, { token: p.token });
  assert.equal(list.json.shares.length, 2);
  const sid = list.json.shares.find((s: any) => s.hide_destination).id;
  assert.equal((await t.api('DELETE', `/bookings/${id}/share/${sid}`, { token: p.token })).status, 200);
  assert.equal((await t.api('GET', `/share/${a.json.token}`, { headers: JSONH })).status, 404);
  assert.equal((await t.api('GET', `/share/${b.json.token}`, { headers: JSONH })).status, 200);
  assert.equal((await t.api('DELETE', `/bookings/${id}/share/${sid}`, { token: (await t.register()).token })).status, 404);
  // expiry: trip end + 1h
  await t.db.q("update bookings set status='CANCELLED_BY_PASSENGER', cancelled_at=now() - interval '30 minutes' where id=$1", [id]);
  const ended = await t.api('GET', `/share/${b.json.token}`, { headers: JSONH });
  assert.equal(ended.json.ended, true); assert.equal(ended.json.location, null); assert.equal(ended.json.poll_after_s, 0);
  await t.db.q("update bookings set cancelled_at=now() - interval '61 minutes' where id=$1", [id]);
  assert.equal((await t.api('GET', `/share/${b.json.token}`, { headers: JSONH })).status, 404);
  // page: auto refresh + three languages, no mixing
  const live = await t.api('POST', `/bookings/${(await t.book((await t.register()).token)).res.json.booking.id}/share`, { token: p.token, body: {} });
  void live;
  for (const [lang, word] of [['fr', 'Hors ligne'], ['rw', 'Nta murongo'], ['en', 'Offline']] as const) {
    const pg = await t.api('GET', `/share/${b.json.token}?lang=${lang}`, { headers: { accept: 'text/html' } });
    assert.match(pg.raw, new RegExp(`<html lang="${lang}">`)); assert.match(pg.raw, new RegExp(word)); assert.match(pg.raw, /setTimeout\(r,next\)/); assert.match(pg.raw, /visibilitychange/);
  }
});

// ---------------------------------------------------------------- 3. tags and tips
test('rating tags catalogue is served by /config in 3 languages; unknown tags are refused; abasare tags apply to abasare bookings', async () => {
  const c = (await t.api('GET', '/config')).json;
  assert.deepEqual(c.rating_tags.ride.filter((x: any) => x.kind === 'positive').map((x: any) => x.id), ['clean_car', 'polite', 'safe_driving', 'knows_route', 'on_time', 'helpful']);
  assert.deepEqual(c.rating_tags.ride.filter((x: any) => x.kind === 'negative').map((x: any) => x.id), ['unsafe', 'rude', 'dirty_car', 'late', 'bad_route']);
  for (const tag of [...c.rating_tags.ride, ...c.rating_tags.abasare]) assert.ok(tag.label.rw && tag.label.fr && tag.label.en, tag.id);
  assert.deepEqual(c.rating_tags.abasare.slice(0, 4).map((x: any) => x.id), ['careful_driving', 'punctual', 'car_care', 'respectful']);
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const id = await inProgress(p, d); await complete(d, id);
  const bad = await t.api('POST', `/bookings/${id}/ratings`, { token: p.token, body: { score: 5, tags: ['careful_driving'] }, headers: { 'accept-language': 'fr' } });
  assert.equal(bad.status, 400); assert.equal(bad.json.error.code, 'invalid_tag'); assert.match(bad.json.error.message, /libellé/);
  assert.equal((await t.api('POST', `/bookings/${id}/ratings`, { token: p.token, body: { score: 5, tags: ['polite', 'clean_car'] } })).status, 200);
  const fb = (await t.api('GET', '/drivers/me/feedback', { token: d.token })).json;
  assert.equal(fb.tags.polite, 1); assert.equal(fb.tags.clean_car, 1); assert.equal(fb.rating_count, 1);
  const adm = await t.staff('driver_verifier');
  const agg = (await t.api('GET', '/admin/trust/tags', { token: adm.token })).json.drivers.find((x: any) => x.driver_id === d.id);
  assert.equal(agg.tags.polite, 1);
});

test('tips: MoMo tip is a separate payment of kind tip, 100% to the driver, ledger balanced, fare untouched; one tip per booking; max guard; cash tip informational', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const id = await inProgress(p, d); await complete(d, id);
  const fareBefore = (await t.api('GET', `/bookings/${id}`, { token: p.token })).json;
  assert.equal(fareBefore.status, 'PAYMENT_PENDING');
  const bal0 = await t.db.q1<any>("select coalesce(sum(credit-debit),0)::int b from ledger_entries where account_code='DRIVER_PAYABLE' and owner_user_id=$1", [d.id]);
  assert.equal((await t.api('POST', `/bookings/${id}/tip`, { token: p.token, body: { amount: 50, method: 'mtn_momo', msisdn: '0788123456' } })).json.error.code, 'tip_too_low');
  const hi = await t.api('POST', `/bookings/${id}/tip`, { token: p.token, body: { amount: 999999, method: 'mtn_momo', msisdn: '0788123456' }, headers: { 'accept-language': 'rw' } });
  assert.equal(hi.json.error.code, 'tip_too_high'); assert.match(hi.json.error.message, /20000/);
  assert.equal((await t.api('POST', `/bookings/${id}/tip`, { token: (await t.register()).token, body: { amount: 500, method: 'cash_tip' } })).status, 404);
  const tip = await t.api('POST', `/bookings/${id}/tip`, { token: p.token, body: { amount: 1000, method: 'mtn_momo', msisdn: '0788123456' } });
  assert.equal(tip.status, 200); assert.equal(tip.json.status, 'SUCCESS');
  const pay = await t.db.q1<any>("select * from payments where booking_id=$1 and kind='tip'", [id]);
  assert.equal(pay.amount, 1000); assert.equal(pay.status, 'SUCCESS');
  const bal1 = await t.db.q1<any>("select coalesce(sum(credit-debit),0)::int b from ledger_entries where account_code='DRIVER_PAYABLE' and owner_user_id=$1", [d.id]);
  assert.equal(bal1.b - bal0.b, 1000, '100% of the tip is payable to the driver');
  assert.equal((await t.db.q1<any>("select count(*)::int n from ledger_entries where payment_id=$1 and account_code='COMMISSION_REVENUE'", [pay.id])).n, 0, 'no commission on tips');
  await ledgerBalanced();
  // the fare is still unpaid and its payment flow is untouched by the tip payment
  const after = (await t.api('GET', `/bookings/${id}`, { token: p.token })).json;
  assert.equal(after.status, 'PAYMENT_PENDING'); assert.equal(after.payment.method, 'cash');
  assert.equal((await t.api('POST', `/bookings/${id}/tip`, { token: p.token, body: { amount: 500, method: 'cash_tip' } })).json.error.code, 'tip_exists');
  const fb = (await t.api('GET', '/drivers/me/feedback', { token: d.token })).json;
  assert.equal(fb.tips.momo_total, 1000);
  assert.equal((await t.db.q1<any>("select count(*)::int n from notifications where user_id=$1 and template_key='tip_received'", [d.id])).n >= 1, true);
  // fare payment (cash) still settles normally afterwards
  const due = after.payment.outstanding;
  assert.equal((await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: due } })).json.status, 'SUCCESS');
  await ledgerBalanced();
  // cash tip on another trip: informational only, no payment, no ledger
  const p2 = await t.register(); const d2 = await t.driver({ vehicle: 'moto' });
  const id2 = await inProgress(p2, d2); await complete(d2, id2);
  const ct = await t.api('POST', `/bookings/${id2}/ratings`, { token: p2.token, body: { score: 5, tags: ['on_time'], tip: { amount: 500, method: 'cash_tip' } } });
  assert.equal(ct.json.tip.status, 'recorded');
  assert.equal((await t.db.q1<any>("select count(*)::int n from payments where booking_id=$1 and kind='tip'", [id2])).n, 0);
  assert.equal((await t.db.q1<any>("select count(*)::int n from booking_events where booking_id=$1 and type='cash_tip'", [id2])).n, 1);
  const tot = (await t.api('GET', '/admin/trust/tips', { token: (await t.staff('finance_officer')).token })).json;
  assert.ok(tot.totals.momo_total >= 1000 && tot.totals.cash_total_informational >= 500);
  // a failed MoMo tip can be retried; failed tip does not touch the ledger
  const p3 = await t.register(); const d3 = await t.driver({ vehicle: 'moto' });
  const id3 = await inProgress(p3, d3); await complete(d3, id3);
  const f = await t.api('POST', `/bookings/${id3}/tip`, { token: p3.token, body: { amount: 700, method: 'mtn_momo', msisdn: '0788110000' } });
  assert.equal(f.json.status, 'FAILED');
  assert.equal((await t.api('POST', `/bookings/${id3}/tip`, { token: p3.token, body: { amount: 700, method: 'mtn_momo', msisdn: '0788123456' } })).json.status, 'SUCCESS');
  assert.equal((await t.db.q1<any>('select count(*)::int n from tips where booking_id=$1', [id3])).n, 1);
  await ledgerBalanced();
});

// ---------------------------------------------------------------- 4. favourites and blocked
test('favourite and blocked drivers: only drivers ridden with; blocked never offered; favourite ranked first; prefer_favourite=false disables the boost', async () => {
  const p = await t.register(); const near = await t.driver({ vehicle: 'moto' });
  const id = await inProgress(p, near); await complete(near, id);
  const stranger = await t.driver({ vehicle: 'moto' });
  assert.equal((await t.api('PUT', `/users/me/drivers/${stranger.id}`, { token: p.token, body: { kind: 'blocked' } })).json.error.code, 'not_ridden');
  assert.equal((await t.api('PUT', `/users/me/drivers/${near.id}`, { token: p.token, body: { kind: 'blocked' } })).status, 200);
  const list = (await t.api('GET', '/users/me/drivers', { token: p.token })).json.drivers;
  assert.equal(list[0].kind, 'blocked'); assert.equal(list[0].trips_together, 1); assert.ok(!JSON.stringify(list).includes('+250'));
  await t.reset();
  // `near` is online at KCC, stranger is farther: the blocked driver gets no offer even though closest
  await t.api('PATCH', '/drivers/me/availability', { token: near.token, body: { online: true } }); await setLoc(near, KCC.lat, KCC.lng);
  await t.api('PATCH', '/drivers/me/availability', { token: stranger.token, body: { online: true } }); await setLoc(stranger, KCC.lat + 0.01, KCC.lng);
  const e = await t.estimate(p.token, { service_id: 'moto' }); assert.equal(e.json.options[0].nearby_drivers, 1, 'blocked driver not counted as supply');
  const b1 = (await t.book(p.token)).res.json.booking.id;
  const offers = await t.db.q<any>('select driver_id from dispatch_offers where booking_id=$1', [b1]);
  assert.deepEqual(offers.map((o) => o.driver_id), [stranger.id]);
  assert.equal((await t.api('DELETE', `/users/me/drivers/${near.id}`, { token: p.token })).status, 200);
  await t.reset();
  // favourite: farther driver wins over the nearer one thanks to the boost
  await t.api('PATCH', '/drivers/me/availability', { token: near.token, body: { online: true } }); await setLoc(near, KCC.lat, KCC.lng);
  await t.api('PATCH', '/drivers/me/availability', { token: stranger.token, body: { online: true } }); await setLoc(stranger, KCC.lat + 0.012, KCC.lng);
  await t.db.q("insert into passenger_driver_prefs(passenger_id,driver_id,kind) values ($1,$2,'favourite')", [p.id, stranger.id]);
  await t.db.q("insert into passenger_driver_prefs(passenger_id,driver_id,kind) values ($1,$2,'favourite') on conflict (passenger_id,driver_id) do update set kind='favourite'", [p.id, near.id]);
  await t.db.q("delete from passenger_driver_prefs where driver_id=$1", [near.id]);
  await t.db.q("insert into system_settings(key,value) values ('dispatch.favourite_boost_s','0') on conflict (key) do update set value='0'");
  const b2 = (await t.book(p.token)).res.json.booking.id;
  assert.equal((await t.db.q1<any>('select driver_id from dispatch_offers where booking_id=$1', [b2])).driver_id, near.id, 'no boost: nearest first');
  await t.reset();
  await t.db.q("delete from system_settings where key='dispatch.favourite_boost_s'");
  await t.api('PATCH', '/drivers/me/availability', { token: near.token, body: { online: true } }); await setLoc(near, KCC.lat, KCC.lng);
  await t.api('PATCH', '/drivers/me/availability', { token: stranger.token, body: { online: true } }); await setLoc(stranger, KCC.lat + 0.012, KCC.lng);
  const b3 = (await t.book(p.token)).res.json.booking.id;
  assert.equal((await t.db.q1<any>('select driver_id from dispatch_offers where booking_id=$1', [b3])).driver_id, stranger.id, 'favourite boosted');
  await t.reset();
  await t.api('PATCH', '/drivers/me/availability', { token: near.token, body: { online: true } }); await setLoc(near, KCC.lat, KCC.lng);
  await t.api('PATCH', '/drivers/me/availability', { token: stranger.token, body: { online: true } }); await setLoc(stranger, KCC.lat + 0.012, KCC.lng);
  const b4 = (await t.book(p.token, 'moto', 'cash', { body: { prefer_favourite: false } })).res.json.booking.id;
  assert.equal((await t.db.q1<any>('select driver_id from dispatch_offers where booking_id=$1', [b4])).driver_id, near.id, 'prefer_favourite=false');
  const st = (await t.api('GET', '/admin/trust/favourites', { token: (await t.staff('dispatcher')).token })).json;
  assert.ok(st.totals.favourites >= 1);
});

// ---------------------------------------------------------------- 5. route deviation / long stop
test('safety check: route deviation -> localized push+SMS -> OK closes; HELP escalates to sensitive case + incident; no answer escalates; per-trip off; cooldown', async () => {
  const { runSafetyChecks } = await import('../src/services/safety.ts');
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await t.db.q("update users set preferred_language='fr' where id=$1", [p.id]);
  const id = await inProgress(p, d);
  const lead = await t.staff('support_lead');
  // on the route: nothing
  await t.db.q("update driver_profiles set last_lat=$2, last_lng=$3, last_location_at=now() where user_id=$1", [d.id, (KCC.lat + KIMIRONKO.lat) / 2, (KCC.lng + KIMIRONKO.lng) / 2]);
  await runSafetyChecks();
  assert.equal((await t.db.q1<any>('select count(*)::int n from safety_alerts where booking_id=$1', [id])).n, 0);
  // far off the corridor (about 6 km north)
  await t.db.q("update driver_profiles set last_lat=$2, last_lng=$3, last_location_at=now() where user_id=$1", [d.id, KCC.lat + 0.06, KCC.lng]);
  await t.db.q('update bookings set safety_checked_at=null where id=$1', [id]);
  await runSafetyChecks();
  const al = await t.db.q1<any>('select * from safety_alerts where booking_id=$1', [id]);
  assert.equal(al.kind, 'route_deviation'); assert.equal(al.status, 'asked');
  const ch = await t.db.q<any>("select channel, lang, title, body, critical from notifications where user_id=$1 and template_key='safety_check_deviation' order by channel", [p.id]);
  assert.deepEqual(ch.map((c) => c.channel).sort(), ['in_app', 'push', 'sms']);
  assert.ok(ch.every((c) => c.lang === 'fr' && c.critical)); assert.equal(ch[0].title, 'Tout va bien ?'); assert.ok(!/Open the app|Ugh/.test(ch[0].body));
  assert.equal((await t.api('GET', `/bookings/${id}/safety-check`, { token: p.token })).json.open.id, al.id);
  // a stranger cannot answer; wrong answer is a validation error
  assert.equal((await t.api('POST', `/bookings/${id}/safety-check/respond`, { token: (await t.register()).token, body: { answer: 'ok' } })).status, 404);
  assert.equal((await t.api('POST', `/bookings/${id}/safety-check/respond`, { token: p.token, body: { answer: 'maybe' } })).status, 400);
  // OK
  assert.equal((await t.api('POST', `/bookings/${id}/safety-check/respond`, { token: p.token, body: { answer: 'ok' } })).json.status, 'ok');
  assert.equal((await t.api('POST', `/bookings/${id}/safety-check/respond`, { token: p.token, body: { answer: 'ok' }, headers: { 'accept-language': 'rw' } })).json.error.code, 'no_open_safety_check');
  // cooldown: no second deviation alert right away
  await t.db.q('update bookings set safety_checked_at=null where id=$1', [id]); await runSafetyChecks();
  assert.equal((await t.db.q1<any>('select count(*)::int n from safety_alerts where booking_id=$1', [id])).n, 1);
  // HELP on a new alert: incident + sensitive urgent case, never claims an agency was contacted
  await t.db.q("update safety_alerts set responded_at = now() - interval '1 hour' where id=$1", [al.id]);
  await t.db.q('update bookings set safety_checked_at=null where id=$1', [id]); await runSafetyChecks();
  const a2 = await t.db.q1<any>("select * from safety_alerts where booking_id=$1 and status='asked'", [id]); assert.ok(a2);
  assert.equal((await t.api('POST', `/bookings/${id}/safety-check/respond`, { token: p.token, body: { answer: 'help' } })).json.status, 'escalated');
  const esc = await t.db.q1<any>('select a.*, c.sensitive, c.priority, c.category, i.kind ikind from safety_alerts a join support_cases c on c.id=a.case_id join safety_incidents i on i.id=a.incident_id where a.id=$1', [a2.id]);
  assert.equal(esc.status, 'escalated'); assert.equal(esc.sensitive, true); assert.equal(esc.priority, 'urgent'); assert.equal(esc.category, 'safety'); assert.equal(esc.escalation_reason, 'help');
  const esn = await t.db.q1<any>("select body from notifications where user_id=$1 and template_key='safety_escalated' and channel='in_app'", [p.id]);
  assert.match(esn.body, /n'a encore confirmé/); assert.ok(!/police a été|agence a été/i.test(esn.body));
  // support console sees it and can resolve
  const list = (await t.api('GET', '/admin/safety/alerts', { token: lead.token })).json.alerts;
  assert.ok(list.some((x: any) => x.id === a2.id && x.status === 'escalated' && x.case_ref && x.incident_ref));
  assert.equal((await t.api('POST', `/admin/safety/alerts/${a2.id}/resolve`, { token: lead.token, body: { note: 'Called the passenger, fine' } })).status, 200);
  assert.equal((await t.api('GET', '/admin/safety/alerts', { token: (await t.staff('analyst')).token })).status, 403);
  await complete(d, id);
});

test('safety check: no answer escalates after the wait; long stop detected; per-trip switch and master switch disable checks; ended trip closes the alert', async () => {
  const { runSafetyChecks } = await import('../src/services/safety.ts');
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const id = await inProgress(p, d);
  // stationary for 12 minutes, away from the destination
  const mid = { lat: (KCC.lat + KIMIRONKO.lat) / 2, lng: (KCC.lng + KIMIRONKO.lng) / 2 };
  await t.db.q("update bookings set started_at = now() - interval '20 minutes' where id=$1", [id]);
  for (const m of [14, 12, 8, 4, 1]) await t.db.q("insert into driver_locations(driver_id,booking_id,lat,lng,recorded_at) values ($1,$2,$3,$4, now() - make_interval(mins => $5))", [d.id, id, mid.lat, mid.lng, m]);
  await t.db.q("update driver_profiles set last_lat=$2, last_lng=$3, last_location_at=now() where user_id=$1", [d.id, mid.lat, mid.lng]);
  await runSafetyChecks();
  const al = await t.db.q1<any>('select * from safety_alerts where booking_id=$1', [id]);
  assert.equal(al.kind, 'long_stop'); assert.equal(al.detail.stopped_min, 10);
  assert.match((await t.db.q1<any>("select body from notifications where user_id=$1 and template_key='safety_check_stop' and channel='in_app'", [p.id])).body, /Imodoka yawe imaze iminota nka 10/);
  // not answered in time
  await t.db.q("update safety_alerts set respond_by = now() - interval '1 minute' where id=$1", [al.id]);
  await runSafetyChecks();
  const e = await t.db.q1<any>('select status, escalation_reason, case_id, incident_id from safety_alerts where id=$1', [al.id]);
  assert.equal(e.status, 'escalated'); assert.equal(e.escalation_reason, 'no_answer'); assert.ok(e.case_id && e.incident_id);
  // a late OK is recorded for the agent but does not close the case
  assert.equal((await t.api('POST', `/bookings/${id}/safety-check/respond`, { token: p.token, body: { answer: 'ok' } })).json.case_open, true);
  assert.equal((await t.db.q1<any>('select count(*)::int n from case_events where case_id=$1', [e.case_id])).n >= 2, true);
  await complete(d, id);
  // trip ended while a check was waiting
  const p2 = await t.register(); const d2 = await t.driver({ vehicle: 'moto' }); const id2 = await inProgress(p2, d2);
  await t.db.q("update driver_profiles set last_lat=$2, last_lng=$3, last_location_at=now() where user_id=$1", [d2.id, KCC.lat + 0.06, KCC.lng]);
  await runSafetyChecks(); assert.equal((await t.db.q1<any>("select status from safety_alerts where booking_id=$1", [id2])).status, 'asked');
  await complete(d2, id2); await runSafetyChecks();
  assert.equal((await t.db.q1<any>("select status from safety_alerts where booking_id=$1", [id2])).status, 'trip_ended');
  // per-trip off
  const p3 = await t.register(); const d3 = await t.driver({ vehicle: 'moto' }); const id3 = await inProgress(p3, d3);
  assert.equal((await t.api('PATCH', `/bookings/${id3}/safety-settings`, { token: p3.token, body: { safety_checks: false } })).json.safety_checks, false);
  await t.db.q("update driver_profiles set last_lat=$2, last_lng=$3, last_location_at=now() where user_id=$1", [d3.id, KCC.lat + 0.06, KCC.lng]);
  await runSafetyChecks(); assert.equal((await t.db.q1<any>('select count(*)::int n from safety_alerts where booking_id=$1', [id3])).n, 0);
  // master switch
  await t.db.q("update bookings set safety_checks=true, safety_checked_at=null where id=$1", [id3]);
  await t.db.q("insert into system_settings(key,value) values ('safety.checks_enabled','false') on conflict (key) do update set value='false'");
  await runSafetyChecks(); assert.equal((await t.db.q1<any>('select count(*)::int n from safety_alerts where booking_id=$1', [id3])).n, 0);
  await t.db.q("delete from system_settings where key='safety.checks_enabled'");
  // geometry: on the line is zero excess and the limit grows with the road factor
  const { routeExcessM, deviationLimitM } = await import('../src/services/safety.ts');
  assert.ok(routeExcessM(mid, KCC, KIMIRONKO) < 5);
  assert.ok(deviationLimitM(10000, 700, 150) > deviationLimitM(10000, 700, 100));
});

// ---------------------------------------------------------------- 6. badges
test('badges are derived from approved documents and real data; training is admin-granted with reason and audit; Abasare tags', async () => {
  const d = await t.driver({ vehicle: 'moto' });
  const p = await t.register();
  const id = await inProgress(p, d); await complete(d, id);
  let card = (await t.api('GET', `/bookings/${id}`, { token: p.token })).json;
  // completed trip: the card only shows badges while the trip is active; check via the driver endpoint
  let fb = (await t.api('GET', '/drivers/me/feedback', { token: d.token })).json;
  const ids = (b: any[]) => b.map((x) => x.id);
  assert.ok(ids(fb.badges).includes('licence_verified') || !(await t.db.q1<any>("select 1 x from driver_documents where driver_id=$1 and doc_type='driving_licence'", [d.id])), 'licence badge only with an approved licence');
  assert.ok(!ids(fb.badges).includes('top_rated') && !ids(fb.badges).includes('training_completed') && !ids(fb.badges).includes('police_clearance_valid'), 'no false badges');
  void card;
  // top_rated needs >= 4.8 with >= 10 ratings; expired / unapproved docs remove document badges
  await t.db.q("update driver_profiles set rating_avg=4.9, rating_count=9, completed_count=120 where user_id=$1", [d.id]);
  assert.ok(!ids((await t.api('GET', '/drivers/me/feedback', { token: d.token })).json.badges).includes('top_rated'));
  await t.db.q("update driver_profiles set rating_count=10 where user_id=$1", [d.id]);
  fb = (await t.api('GET', '/drivers/me/feedback', { token: d.token })).json;
  assert.ok(ids(fb.badges).includes('top_rated')); assert.equal(fb.badges.find((b: any) => b.id === 'trips_completed').tier, 100);
  await t.db.q("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,'police_clearance','docs/x.jpg','image/jpeg',10,current_date + 30,'pending')", [d.id]);
  assert.ok(!ids((await t.api('GET', '/drivers/me/feedback', { token: d.token })).json.badges).includes('police_clearance_valid'), 'pending document gives no badge');
  await t.db.q("update driver_documents set review_status='approved' where driver_id=$1 and doc_type='police_clearance'", [d.id]);
  assert.ok(ids((await t.api('GET', '/drivers/me/feedback', { token: d.token })).json.badges).includes('police_clearance_valid'));
  await t.db.q("update driver_documents set expiry_date = current_date - 1 where driver_id=$1 and doc_type='police_clearance'", [d.id]);
  assert.ok(!ids((await t.api('GET', '/drivers/me/feedback', { token: d.token })).json.badges).includes('police_clearance_valid'), 'expired document removes the badge');
  // experience tier needs an approved licence AND the declared licence date
  await t.db.q("update driver_profiles set abasare_skills = coalesce(abasare_skills,'{}'::jsonb) || jsonb_build_object('licence_since', (current_date - 3000)::text) where user_id=$1", [d.id]);
  const exp = (await t.api('GET', '/drivers/me/feedback', { token: d.token })).json.badges.find((b: any) => b.id === 'experience');
  if (exp) assert.equal(exp.tier, 5);
  // training: admin only, reason mandatory, audited, revocable
  const ver = await t.staff('driver_verifier'); const sup = await t.staff('support_agent');
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/training`, { token: sup.token, body: { granted: true, reason: 'Completed safety course' } })).status, 403);
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/training`, { token: ver.token, body: { granted: true, reason: 'x' } })).status, 400);
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/training`, { token: ver.token, body: { granted: true, reason: 'Completed safety course 2026-10' } })).status, 200);
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/training`, { token: ver.token, body: { granted: true, reason: 'Completed safety course 2026-10' } })).json.error.code, 'already_granted');
  assert.ok(ids((await t.api('GET', '/drivers/me/feedback', { token: d.token })).json.badges).includes('training_completed'));
  assert.equal((await t.db.q1<any>("select count(*)::int n from audit_logs where action='driver.training_granted' and entity_id=$1", [d.id])).n, 1);
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/training`, { token: ver.token, body: { granted: false, reason: 'Certificate withdrawn' } })).status, 200);
  assert.ok(!ids((await t.api('GET', `/admin/drivers/${d.id}/badges`, { token: ver.token })).json.badges).includes('training_completed'));
  // suspended drivers show no badges
  await t.db.q("update driver_profiles set status='SUSPENDED' where user_id=$1", [d.id]);
  assert.deepEqual((await t.api('GET', `/admin/drivers/${d.id}/badges`, { token: ver.token })).json.badges, []);
  await t.db.q("update driver_profiles set status='APPROVED' where user_id=$1", [d.id]);
  // the passenger's booking view shows badges on the driver card during an active trip
  const p2 = await t.register(); const d2 = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p2.token); await t.api('POST', `/bookings/${res.json.booking.id}/accept`, { token: d2.token });
  const v = (await t.api('GET', `/bookings/${res.json.booking.id}`, { token: p2.token })).json;
  assert.ok(Array.isArray(v.driver.badges));
  // Abasare booking: abasare tags accepted, ride-only tags refused
  const { ABASARE_TAGS, invalidTags } = await import('../src/services/tags.ts');
  assert.deepEqual(invalidTags(['careful_driving', 'punctual', 'car_care', 'respectful', 'rude'], true), []);
  assert.deepEqual(invalidTags(['dirty_car', 'careful_driving'], true), ['dirty_car']);
  assert.equal(ABASARE_TAGS.length, 7);
});

// ---------------------------------------------------------------- 7. low data  8. navigation
test('low data: gzip, ETag/304 on booking polling and offers, lite payloads are smaller and keep the shape; navigation and live driver ETA', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  // offers: 304 + lite
  const off = await t.api('GET', '/drivers/me/offers', { token: d.token });
  assert.equal(off.json.offers.length, 1); const etag0 = off.headers.etag as string; assert.ok(etag0);
  assert.equal((await t.api('GET', '/drivers/me/offers', { token: d.token, headers: { 'if-none-match': etag0 } })).status, 304);
  const offLite = await t.api('GET', '/drivers/me/offers?lite=1', { token: d.token });
  assert.ok(offLite.raw.length <= off.raw.length && offLite.json.offers[0].booking_id === id);
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  await setLoc(d, KCC.lat + 0.02, KCC.lng);
  // passenger view: live ETA from the driver's location, badges, etag
  const full = await t.api('GET', `/bookings/${id}`, { token: p.token });
  assert.equal(full.json.driver_eta_target, 'pickup'); assert.ok(full.json.driver_eta_s > 0);
  const etag = full.headers.etag as string; assert.match(etag, /^W\//); assert.match(String(full.headers['cache-control']), /no-cache/);
  const nm = await t.api('GET', `/bookings/${id}`, { token: p.token, headers: { 'if-none-match': etag } });
  assert.equal(nm.status, 304); assert.equal(nm.raw, '');
  // ETA refreshes with the driver location -> new ETag and smaller eta
  await setLoc(d, KCC.lat + 0.005, KCC.lng);
  const moved = await t.api('GET', `/bookings/${id}`, { token: p.token, headers: { 'if-none-match': etag } });
  assert.equal(moved.status, 200); assert.ok(moved.json.driver_eta_s < full.json.driver_eta_s);
  // another user's etag is not valid for me
  assert.notEqual((await t.api('GET', `/bookings/${id}`, { token: d.token })).headers.etag, etag);
  // lite: same essential shape, fewer bytes
  const lite = await t.api('GET', `/bookings/${id}?lite=1`, { token: p.token });
  const lite2 = await t.api('GET', `/bookings/${id}`, { token: p.token, headers: { 'x-lite': '1' } });
  assert.equal(lite.json.lite, true); assert.equal(lite2.json.lite, true);
  for (const k of ['id', 'status', 'pickup', 'destination', 'driver_location', 'driver_eta_s', 'estimated_fare', 'payment_method']) assert.ok(k in lite.json || lite.json[k] === undefined && k === 'payment', k);
  assert.ok(!('fare_breakdown' in lite.json)); assert.ok(lite.raw.length < moved.raw.length);
  assert.notEqual(lite.headers.etag, moved.headers.etag);
  // estimate (nearby availability) lite
  const e1 = await t.api('POST', '/fares/estimate', { token: p.token, body: { pickup: KCC, dest: KIMIRONKO } });
  const e2 = await t.api('POST', '/fares/estimate?lite=1', { token: p.token, body: { pickup: KCC, dest: KIMIRONKO }, headers: { 'accept-language': 'fr' } });
  assert.ok(e2.raw.length < e1.raw.length * 0.6, `lite estimate ${e2.raw.length} vs ${e1.raw.length}`);
  assert.ok(e2.json.options[0].name && e2.json.options[0].fare.total === e1.json.options[0].fare.total);
  // gzip
  const gz = await t.app.inject({ method: 'GET', url: `/api/v1/bookings/${id}`, headers: { authorization: `Bearer ${p.token}`, 'accept-encoding': 'gzip' } });
  assert.equal(gz.headers['content-encoding'], 'gzip'); assert.equal(JSON.parse(gunzipSync(gz.rawPayload).toString()).id, id);
  console.log(`[payload sizes] booking full ${moved.raw.length} B, lite ${lite.raw.length} B, full+gzip ${gz.rawPayload.length} B; estimate full ${e1.raw.length} B, lite ${e2.raw.length} B; offers full ${off.raw.length} B, lite ${offLite.raw.length} B`);
  // driver navigation hand-off
  const dv = (await t.api('GET', `/bookings/${id}`, { token: d.token })).json;
  assert.equal(dv.navigation.target, 'pickup'); assert.ok(dv.navigation.eta_to_pickup_min >= 1);
  assert.match(dv.navigation.pickup.google_maps, /google\.com\/maps\/dir\/\?api=1&destination=-1\.954,30\.0927/); assert.match(dv.navigation.destination.waze, /waze\.com\/ul\?ll=-1\.9496,30\.1262&navigate=yes/);
  assert.match(dv.navigation.pickup.geo, /^geo:/);
  assert.ok(!('navigation' in full.json), 'passenger view has no navigation block');
});

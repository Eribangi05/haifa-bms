import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, makeJpeg, KCC, KIMIRONKO, type Ctx } from './helpers.ts';

let t: Ctx; let verifier: Awaited<ReturnType<Ctx['staff']>>;
before(async () => { t = await boot('rwanda_mobility_test'); verifier = await t.staff('driver_verifier'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const JPEG = makeJpeg();
const photo = () => { const b = '----ab' + Math.random().toString(16).slice(2); return { payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), JPEG, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } }; };

async function car(owner: { token: string }, extra: any = {}) {
  const plate = 'RAB' + Math.floor(100 + Math.random() * 899) + 'X';
  const r = await t.api('POST', '/users/me/cars', { token: owner.token, body: { plate, make: 'Toyota', model: 'RAV4', color: 'Silver', vehicle_class: 'suv', transmission: 'automatic', insurance_confirmed: true, ...extra } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json as { id: string; plate: string };
}

async function abasareDriver(o: { transmissions?: string[]; classes?: string[]; at?: { lat: number; lng: number }; online?: boolean; approve?: boolean; docs?: boolean } = {}) {
  const u = await t.register('driver');
  const a = await t.api('POST', '/abasare/apply', { token: u.token, body: { legal_name: 'Test Umusare', national_id: '1199080012345678', licence_since: '2015-01-01', years_experience: 8,
    transmissions: o.transmissions ?? ['manual', 'automatic'], classes: o.classes ?? ['car', 'suv', 'minivan', 'pickup'], return_mode: 'moto', payout_msisdn: '0788123456' } });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  if (o.docs !== false) for (const r of await t.db.q<any>("select doc_type, requires_expiry from document_requirements where vehicle_type='abasare' and mandatory"))
    await t.db.q("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [u.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
  await t.db.q("update driver_profiles set status='DOCUMENTS_SUBMITTED', zone_id='kigali' where user_id=$1", [u.id]);
  if (o.approve !== false) {
    const d = await t.api('POST', `/admin/drivers/${u.id}/abasare-decision`, { token: verifier.token, body: { decision: 'approve' } });
    assert.equal(d.status, 200, JSON.stringify(d.json));
    if (o.online !== false) {
      const on = await t.api('PATCH', '/drivers/me/availability', { token: u.token, body: { online: true, accepting: ['abasare'] } });
      assert.equal(on.status, 200, JSON.stringify(on.json));
      await t.api('POST', '/drivers/me/location', { token: u.token, body: o.at ?? KCC });
    }
  }
  return u;
}

async function bookAbasare(owner: { token: string }, carId: string, o: { hours?: number; scheduled_for?: string; method?: string; attested?: boolean; dest?: any } = {}) {
  const e = await t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, ...(o.hours ? {} : { dest: o.dest ?? KIMIRONKO }), abasare: { customer_vehicle_id: carId, hours: o.hours }, scheduled_for: o.scheduled_for } });
  assert.equal(e.status, 200, JSON.stringify(e.json));
  const opt = e.json.options[0]; if (!opt?.quote_id) return { e, opt, res: null as any };
  const res = await t.api('POST', '/bookings', { token: owner.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: opt.quote_id, payment_method: o.method ?? 'cash', customer_vehicle_id: carId, owner_attested: o.attested ?? true, pickup_name: 'Bar', dest_name: 'Home' } });
  return { e, opt, res };
}

async function checks(drv: { token: string }, bid: string, phase: 'pickup' | 'dropoff', data: any = {}) {
  for (let i = 0; i < 2; i++) assert.equal((await t.api('POST', `/bookings/${bid}/handover/photos?phase=${phase}`, { token: drv.token, ...photo() })).status, 200);
  return t.api('POST', `/bookings/${bid}/handover`, { token: drv.token, body: { phase, odometer_km: phase === 'pickup' ? 45210 : 45224, fuel_percent: phase === 'pickup' ? 50 : 45, notes: 'No visible damage', ...data } });
}

async function arrive(drv: { token: string }, bid: string) {
  assert.equal((await t.api('POST', `/bookings/${bid}/accept`, { token: drv.token })).status, 200);
  await t.api('POST', '/drivers/me/location', { token: drv.token, body: { lat: KCC.lat + 0.0001, lng: KCC.lng } });
  const a = await t.api('POST', `/bookings/${bid}/arrived`, { token: drv.token }); assert.equal(a.status, 200, JSON.stringify(a.json));
}

test('driver application: licence history, police clearance and approval are required; no vehicle needed', async () => {
  const u = await t.register('driver'); const base = { legal_name: 'Jean Umusare', national_id: '1199080012345678', years_experience: 3, transmissions: ['manual'], classes: ['car'], return_mode: 'moto' };
  const recent = await t.api('POST', '/abasare/apply', { token: u.token, body: { ...base, licence_since: new Date(Date.now() - 365 * 86400e3).toISOString().slice(0, 10) } });
  assert.equal(recent.status, 400); assert.equal(recent.json.error.code, 'licence_too_new');
  assert.equal((await t.api('POST', '/abasare/apply', { token: u.token, body: { ...base, licence_since: '2016-05-01', classes: [] } })).status, 400);
  assert.equal((await t.api('POST', '/abasare/apply', { token: u.token, body: { ...base, licence_since: '2016-05-01' } })).status, 200);
  assert.equal((await t.api('POST', '/abasare/apply', { token: u.token, body: { ...base, licence_since: '2016-05-01' } })).status, 409, 'cannot apply twice');
  const st = await t.api('GET', '/drivers/me/status', { token: u.token });
  assert.equal(st.json.abasare.status, 'pending');
  assert.ok(st.json.requirements.some((r: any) => r.doc_type === 'police_clearance' && r.mandatory && r.requires_expiry), 'police clearance is mandatory');
  assert.ok(!st.json.requirements.some((r: any) => r.doc_type === 'vehicle_registration'), 'no vehicle documents for Abasare-only');
  assert.equal((await t.api('PATCH', '/drivers/me/availability', { token: u.token, body: { online: true, accepting: ['abasare'] } })).status, 403);
  await t.db.q("update driver_profiles set status='DOCUMENTS_SUBMITTED' where user_id=$1", [u.id]);
  const noDocs = await t.api('POST', `/admin/drivers/${u.id}/abasare-decision`, { token: verifier.token, body: { decision: 'approve' } });
  assert.equal(noDocs.status, 409); assert.equal(noDocs.json.error.code, 'documents_not_approved');
  for (const r of await t.db.q<any>("select doc_type, requires_expiry from document_requirements where vehicle_type='abasare' and doc_type<>'police_clearance'"))
    await t.db.q("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [u.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
  const still = await t.api('POST', `/admin/drivers/${u.id}/abasare-decision`, { token: verifier.token, body: { decision: 'approve' } });
  assert.equal(still.status, 409); assert.ok(/police_clearance/.test(still.json.error.message));
  await t.db.q("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,'police_clearance','docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,'2099-01-01','approved')", [u.id]);
  assert.equal((await t.api('POST', `/admin/drivers/${u.id}/abasare-decision`, { token: u.token, body: { decision: 'approve' } })).status, 403, 'a driver cannot approve themselves');
  assert.equal((await t.api('POST', `/admin/drivers/${u.id}/abasare-decision`, { token: verifier.token, body: { decision: 'approve' } })).status, 200);
  const ride = await t.api('PATCH', '/drivers/me/availability', { token: u.token, body: { online: true, accepting: ['ride'] } });
  assert.equal(ride.status, 403, 'no vehicle: cannot accept ride-hailing');
  const on = await t.api('PATCH', '/drivers/me/availability', { token: u.token, body: { online: true, accepting: ['abasare'] } });
  assert.equal(on.status, 200); assert.deepEqual(on.json.accepting, ['abasare']);
  const hist = await t.db.q<any>('select to_status from driver_status_history where driver_id=$1', [u.id]); assert.ok(hist.some((h: any) => h.to_status === 'APPROVED'));
  assert.ok((await t.db.q<any>("select 1 from audit_logs where action='abasare.decision' and entity_id=$1", [u.id])).length === 1);
});

test('estimate: Abasare is quoted separately, only with the owner’s own car, and only when a skilled driver is really nearby', async () => {
  const owner = await t.register(); const myCar = await car(owner);
  const none = await t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, dest: KIMIRONKO, abasare: { customer_vehicle_id: myCar.id } } });
  assert.equal(none.json.options[0].available, false); assert.equal(none.json.options[0].reason, 'no_drivers_nearby'); assert.equal(none.json.options[0].quote_id, null);
  await abasareDriver();
  const e = await t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, dest: KIMIRONKO, abasare: { customer_vehicle_id: myCar.id } } });
  assert.equal(e.json.options.length, 1); assert.equal(e.json.options[0].service_id, 'abasare'); assert.equal(e.json.options[0].available, true);
  const lines = e.json.options[0].fare.lines.map((l: any) => l.code);
  assert.ok(lines.includes('base') && lines.includes('distance') && lines.includes('return_allowance'), lines.join());
  assert.ok(e.json.options[0].fare.total >= 4000);
  const ride = await t.estimate(owner.token);
  assert.ok(!ride.json.options.some((o: any) => String(o.service_id).startsWith('abasare')), 'ride-hailing list never shows Abasare');
  assert.ok(ride.json.options.every((o: any) => o.available === false), 'an Abasare driver is not a ride-hailing driver');
  const hourly = await t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, abasare: { customer_vehicle_id: myCar.id, hours: 4 } } });
  assert.equal(hourly.json.options[0].service_id, 'abasare_hourly'); assert.equal(hourly.json.options[0].fare.total >= 16000, true);
  assert.equal((await t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, abasare: { customer_vehicle_id: myCar.id, hours: 1 } } })).status, 400);
  const stranger = await t.register();
  assert.equal((await t.api('POST', '/fares/estimate', { token: stranger.token, body: { pickup: KCC, dest: KIMIRONKO, abasare: { customer_vehicle_id: myCar.id } } })).status, 404, 'cannot quote with someone else’s car');
  assert.equal((await t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, abasare: { customer_vehicle_id: myCar.id } } })).json.error.code, 'destination_required');
});

test('skill matching: a manual-only driver is never offered an automatic car, a car-only driver never a pickup or moto', async () => {
  const owner = await t.register(); const auto = await car(owner); const manual = await car(owner, { transmission: 'manual', vehicle_class: 'car' }); const bike = await car(owner, { vehicle_class: 'moto', transmission: 'manual' });
  await abasareDriver({ transmissions: ['manual'], classes: ['car'] });
  const q = (id: string) => t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, dest: KIMIRONKO, abasare: { customer_vehicle_id: id } } });
  assert.equal((await q(auto.id)).json.options[0].available, false);
  assert.equal((await q(bike.id)).json.options[0].available, false);
  assert.equal((await q(manual.id)).json.options[0].available, true);
  const d2 = await abasareDriver({ transmissions: ['automatic', 'manual'], classes: ['suv', 'car'], at: { lat: KCC.lat + 0.01, lng: KCC.lng } });
  assert.equal((await q(auto.id)).json.options[0].available, true);
  const { res } = await bookAbasare(owner, auto.id); const bid = res.json.booking.id;
  assert.equal((await t.api('GET', '/drivers/me/offers', { token: d2.token })).json.offers.length, 1, 'only the skilled driver gets the offer');
  const o = (await t.api('GET', '/drivers/me/offers', { token: d2.token })).json.offers[0];
  assert.equal(o.cv_class, 'suv'); assert.equal(o.cv_transmission, 'automatic'); assert.equal(o.hire_mode, 'point_to_point'); assert.ok(o.driver_net > 0);
  const disp = await t.staff('dispatcher'); const wrong = await abasareDriver({ transmissions: ['manual'], classes: ['car'], at: { lat: KCC.lat + 0.012, lng: KCC.lng } });
  const m = await t.api('POST', `/admin/bookings/${bid}/assign`, { token: disp.token, body: { driver_id: wrong.id, reason: 'try mismatching driver' } });
  assert.equal(m.status, 409); assert.equal(m.json.error.code, 'driver_skills_mismatch');
});

test('booking needs the owner’s attestation, a confirmed insurance and the same car as quoted', async () => {
  const owner = await t.register(); const uninsured = await car(owner, { insurance_confirmed: false }); const ok = await car(owner); await abasareDriver();
  const noIns = await bookAbasare(owner, uninsured.id); assert.equal(noIns.res.status, 400); assert.equal(noIns.res.json.error.code, 'insurance_confirmation_required');
  const noAtt = await bookAbasare(owner, ok.id, { attested: false }); assert.equal(noAtt.res.status, 400); assert.equal(noAtt.res.json.error.code, 'attestation_required');
  const q = (await t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, dest: KIMIRONKO, abasare: { customer_vehicle_id: ok.id } } })).json.options[0];
  const other = await car(owner);
  const swap = await t.api('POST', '/bookings', { token: owner.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: q.quote_id, payment_method: 'cash', customer_vehicle_id: other.id, owner_attested: true } });
  assert.equal(swap.json.error.code, 'vehicle_mismatch');
  const good = await t.api('POST', '/bookings', { token: owner.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: q.quote_id, payment_method: 'cash', owner_attested: true } });
  assert.equal(good.status, 201); assert.ok((await t.db.q1<any>('select owner_attested_at, customer_vehicle_id, hire_mode from bookings where id=$1', [good.json.booking.id])).owner_attested_at);
  const plain = await t.estimate(owner.token, { service_id: 'moto' }); void plain;
});

test('full Abasare trip: check-in with photos, PIN start, check-out, cash, commission, balanced ledger', async () => {
  const owner = await t.register(); const myCar = await car(owner); const drv = await abasareDriver();
  const { res, opt } = await bookAbasare(owner, myCar.id); assert.equal(res.status, 201, JSON.stringify(res.json)); const bid = res.json.booking.id;
  assert.equal(res.json.booking.status, 'SEARCHING_DRIVER');
  assert.equal((await t.api('POST', `/bookings/${bid}/accept`, { token: drv.token })).status, 200);
  await t.api('POST', '/drivers/me/location', { token: drv.token, body: { lat: KCC.lat + 0.0001, lng: KCC.lng } });
  assert.equal((await t.api('POST', `/bookings/${bid}/arrived`, { token: drv.token })).status, 200);
  const pin = (await t.api('GET', `/bookings/${bid}`, { token: owner.token })).json.trip_pin;
  // identity before handing over the keys
  const pv = (await t.api('GET', `/bookings/${bid}`, { token: owner.token })).json;
  assert.equal(pv.driver.abasare.years_experience, 8); assert.equal(pv.abasare.vehicle.plate, myCar.plate); assert.equal(pv.vehicle, undefined, 'no ride vehicle for Abasare');
  // start is blocked until the car is checked in
  const early = await t.api('POST', `/bookings/${bid}/start`, { token: drv.token, body: { pin } }); assert.equal(early.status, 409); assert.equal(early.json.error.code, 'handover_required');
  const noPhotos = await t.api('POST', `/bookings/${bid}/handover`, { token: drv.token, body: { phase: 'pickup', odometer_km: 45210, fuel_percent: 50 } });
  assert.equal(noPhotos.status, 400); assert.equal(noPhotos.json.error.code, 'photos_required');
  assert.equal((await t.api('POST', `/bookings/${bid}/handover/photos?phase=pickup`, { token: drv.token, payload: Buffer.from('<html>not an image</html>'), headers: { 'content-type': 'multipart/form-data; boundary=x' } })).status >= 400, true);
  assert.equal((await checks(drv, bid, 'pickup')).status, 200);
  assert.equal((await t.api('POST', `/bookings/${bid}/handover`, { token: drv.token, body: { phase: 'pickup', odometer_km: 1, fuel_percent: 1 } })).status, 409, 'cannot be submitted twice');
  // the owner sees the record, with expiring photo links, and confirms
  const seen = (await t.api('GET', `/bookings/${bid}`, { token: owner.token })).json.abasare.handovers[0];
  assert.equal(seen.phase, 'pickup'); assert.equal(seen.odometer_km, 45210); assert.equal(seen.photos.length, 2); assert.ok(seen.photos[0].includes('token='));
  const img = await t.api('GET', String(seen.photos[0]).replace('/api/v1', '')); assert.equal(img.status, 200);
  assert.equal((await t.api('POST', `/bookings/${bid}/handover/pickup/respond`, { token: owner.token, body: { response: 'ok' } })).status, 200);
  assert.ok((await t.api('GET', '/notifications', { token: owner.token })).json.notifications.some((n: any) => n.template_key === 'handover_submitted'));
  const st = await t.api('POST', `/bookings/${bid}/start`, { token: drv.token, body: { pin } }); assert.equal(st.status, 200, JSON.stringify(st.json));
  // completion needs the drop-off record, and the odometer can't run backwards
  const early2 = await t.api('POST', `/bookings/${bid}/complete`, { token: drv.token }); assert.equal(early2.status, 409); assert.equal(early2.json.error.code, 'handover_required');
  const back = await checks(drv, bid, 'dropoff', { odometer_km: 100 }); assert.equal(back.status, 400); assert.equal(back.json.error.code, 'odometer_decreased');
  assert.equal((await t.api('POST', `/bookings/${bid}/handover`, { token: drv.token, body: { phase: 'dropoff', odometer_km: 45224, fuel_percent: 45 } })).status, 200);
  const done = await t.api('POST', `/bookings/${bid}/complete`, { token: drv.token }); assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.final_fare, opt.fare.total, 'final fare equals the quote');
  assert.equal((await t.api('POST', `/bookings/${bid}/cash-collected`, { token: drv.token, body: { amount: done.json.final_fare } })).json.status, 'SUCCESS');
  const e = await t.db.q1<any>('select * from driver_earnings where booking_id=$1', [bid]);
  assert.equal(e.commission, Math.floor((e.commissionable * 1200 + 5000) / 10000)); assert.equal(e.net + e.commission, e.fare_subtotal);
  const bal = await t.db.q1<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries'); assert.equal(bal.d, bal.c);
  const rc = await t.api('GET', `/bookings/${bid}/receipt`, { token: owner.token }); assert.equal(rc.status, 200); assert.ok(rc.json.fare.lines.some((l: any) => l.code === 'return_allowance'));
  assert.equal((await t.api('POST', `/bookings/${bid}/ratings`, { token: owner.token, body: { score: 5 } })).status, 200);
  const dv = (await t.api('GET', `/bookings/${bid}`, { token: drv.token })).json; assert.equal(dv.abasare.vehicle.plate, myCar.plate);
});

test('owner disputes the car condition: urgent sensitive case with the booking attached; a pickup dispute blocks the start', async () => {
  const owner = await t.register(); const myCar = await car(owner); const drv = await abasareDriver(); const lead = await t.staff('support_lead');
  const { res } = await bookAbasare(owner, myCar.id); const bid = res.json.booking.id; await arrive(drv, bid);
  assert.equal((await checks(drv, bid, 'pickup')).status, 200);
  const pin = (await t.api('GET', `/bookings/${bid}`, { token: owner.token })).json.trip_pin;
  assert.equal((await t.api('POST', `/bookings/${bid}/handover/pickup/respond`, { token: owner.token, body: { response: 'issue' } })).status, 400, 'a note is required');
  const iss = await t.api('POST', `/bookings/${bid}/handover/pickup/respond`, { token: owner.token, body: { response: 'issue', note: 'There was a scratch on the left door before; photo missed it' } });
  assert.equal(iss.status, 200); assert.ok(iss.json.case);
  const blocked = await t.api('POST', `/bookings/${bid}/start`, { token: drv.token, body: { pin } }); assert.equal(blocked.status, 409); assert.equal(blocked.json.error.code, 'handover_disputed');
  const cs = await t.db.q1<any>('select priority, sensitive, category, booking_id from support_cases where ref=$1', [iss.json.case]);
  assert.equal(cs.priority, 'urgent'); assert.equal(cs.sensitive, true); assert.equal(cs.booking_id, bid);
  assert.ok((await t.api('GET', '/admin/support/cases', { token: lead.token })).json.cases.some((c: any) => c.ref === iss.json.case));
  assert.ok((await t.api('GET', '/notifications', { token: drv.token })).json.notifications.some((n: any) => n.template_key === 'handover_issue'));
  assert.equal((await t.api('POST', `/bookings/${bid}/handover/pickup/respond`, { token: (await t.register()).token, body: { response: 'ok' } })).status, 404, 'only the owner can respond');
  // owner re-checks and accepts: trip can start
  await t.api('POST', `/bookings/${bid}/handover/pickup/respond`, { token: owner.token, body: { response: 'ok' } });
  assert.equal((await t.api('POST', `/bookings/${bid}/start`, { token: drv.token, body: { pin } })).status, 200);
  assert.equal((await checks(drv, bid, 'dropoff')).status, 200);
  await t.db.q("update abasare_handovers set created_at = now() - interval '2 hours' where booking_id=$1 and phase='dropoff'", [bid]);
  const late = await t.api('POST', `/bookings/${bid}/handover/dropoff/respond`, { token: owner.token, body: { response: 'issue', note: 'Found a dent now' } });
  assert.equal(late.status, 409); assert.equal(late.json.error.code, 'window_closed');
});

test('hourly hire: booked hours are the quote; overtime is added in 30-minute blocks after the grace period', async () => {
  const owner = await t.register(); const myCar = await car(owner); const drv = await abasareDriver();
  const { res, opt } = await bookAbasare(owner, myCar.id, { hours: 2 }); assert.equal(res.status, 201, JSON.stringify(res.json)); const bid = res.json.booking.id;
  assert.equal(opt.service_id, 'abasare_hourly'); assert.ok(opt.fare.lines.some((l: any) => l.code === 'hourly'));
  await arrive(drv, bid); await checks(drv, bid, 'pickup');
  const pin = (await t.api('GET', `/bookings/${bid}`, { token: owner.token })).json.trip_pin;
  assert.equal((await t.api('POST', `/bookings/${bid}/start`, { token: drv.token, body: { pin } })).status, 200);
  await t.db.q("update bookings set started_at = now() - interval '2 hours 25 minutes' where id=$1", [bid]);       // 15 min over after the 10-min grace -> 1 block
  await checks(drv, bid, 'dropoff');
  const done = await t.api('POST', `/bookings/${bid}/complete`, { token: drv.token }); assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.final_fare, opt.fare.total + 2500);
  assert.equal((await t.db.q1<any>('select overtime_blocks, hours_booked from bookings where id=$1', [bid])).overtime_blocks, 1);
  const rc = await t.api('GET', `/bookings/${bid}/receipt`, { token: owner.token }); assert.ok(rc.json.fare.lines.some((l: any) => l.code === 'overtime' && l.amount === 2500));
  await t.api('POST', `/bookings/${bid}/cash-collected`, { token: drv.token, body: { amount: done.json.final_fare } });
  const bal = await t.db.q1<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries'); assert.equal(bal.d, bal.c);
});

test('police clearance expiry removes the driver from dispatch at once; scheduled Abasare is bookable and released later', async () => {
  const owner = await t.register(); const myCar = await car(owner); const drv = await abasareDriver();
  assert.equal((await t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, dest: KIMIRONKO, abasare: { customer_vehicle_id: myCar.id } } })).json.options[0].available, true);
  await t.db.q("update driver_documents set expiry_date = current_date - 1 where driver_id=$1 and doc_type='police_clearance'", [drv.id]);
  assert.equal((await t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, dest: KIMIRONKO, abasare: { customer_vehicle_id: myCar.id } } })).json.options[0].available, false);
  const st = await t.api('GET', '/drivers/me/status', { token: drv.token });
  assert.ok(st.json.abasare.permission.expired_documents.includes('police_clearance')); assert.equal(st.json.abasare.permission.can_work, false);
  await t.db.q("update driver_documents set expiry_date = '2099-01-01' where driver_id=$1 and doc_type='police_clearance'", [drv.id]);
  const when = new Date(Date.now() + 3 * 3600e3).toISOString();
  const sch = await bookAbasare(owner, myCar.id, { scheduled_for: when }); assert.equal(sch.res.status, 201); assert.equal(sch.res.json.booking.status, 'SCHEDULED');
  await t.db.q("update bookings set scheduled_for = now() + interval '10 minutes' where id=$1", [sch.res.json.booking.id]);
  const { dispatchSweep } = await import('../src/services/dispatch.ts'); await dispatchSweep();
  assert.equal((await t.db.q1<any>('select status from bookings where id=$1', [sch.res.json.booking.id])).status, 'SEARCHING_DRIVER');
});

test('night band applies by Kigali clock on scheduled bookings and is itemised', async () => {
  const owner = await t.register(); const myCar = await car(owner); await abasareDriver();
  const base = new Date(); base.setUTCDate(base.getUTCDate() + 2); base.setUTCHours(20, 30, 0, 0);   // 22:30 Kigali
  const noon = new Date(base); noon.setUTCHours(10, 0, 0, 0);                                         // 12:00 Kigali
  const q = (d: Date) => t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, dest: KIMIRONKO, scheduled_for: d.toISOString(), abasare: { customer_vehicle_id: myCar.id } } });
  const n = (await q(base)).json.options[0], d = (await q(noon)).json.options[0];
  assert.ok(n.fare.lines.some((l: any) => l.code === 'night_fee')); assert.ok(!d.fare.lines.some((l: any) => l.code === 'night_fee'));
  assert.equal(n.fare.total - d.fare.total, 1000);
});

test('handover is private to the owner, the assigned driver and staff; only for Abasare bookings', async () => {
  const owner = await t.register(); const myCar = await car(owner); const drv = await abasareDriver(); const other = await abasareDriver({ at: { lat: KCC.lat + 0.01, lng: KCC.lng } }); const stranger = await t.register();
  const { res } = await bookAbasare(owner, myCar.id); const bid = res.json.booking.id; await arrive(drv, bid); await checks(drv, bid, 'pickup');
  assert.equal((await t.api('POST', `/bookings/${bid}/handover/photos?phase=pickup`, { token: other.token, ...photo() })).status, 404, 'unassigned driver');
  assert.equal((await t.api('POST', `/bookings/${bid}/handover`, { token: other.token, body: { phase: 'pickup', odometer_km: 1, fuel_percent: 1 } })).status, 404);
  assert.equal((await t.api('GET', `/bookings/${bid}`, { token: stranger.token })).status, 404);
  assert.equal((await t.api('POST', `/bookings/${bid}/handover/photos?phase=pickup`, { token: owner.token, ...photo() })).status, 403, 'owners cannot upload as the driver');
  const rideDriver = await t.driver({ vehicle: 'moto' }); const p = await t.register(); const { res: r2 } = await t.book(p.token);
  assert.equal((await t.api('POST', `/bookings/${r2.json.booking.id}/accept`, { token: rideDriver.token })).status, 200);
  const nope = await t.api('POST', `/bookings/${r2.json.booking.id}/handover`, { token: rideDriver.token, body: { phase: 'pickup', odometer_km: 1, fuel_percent: 1 } });
  assert.equal(nope.status, 400); assert.equal(nope.json.error.code, 'not_an_abasare_booking');
  const staff = await t.staff('support_agent'); assert.equal((await t.api('GET', `/bookings/${bid}`, { token: staff.token })).json.abasare.handovers.length, 1);
});

test('companies can book Abasare on the company account within policy; an Abasare driver can ride home with Moto afterwards', async () => {
  const boss = await t.register(); const myCar = await car(boss); const drv = await abasareDriver(); const bm = await t.staff('business_manager');
  const corp = (await t.api('POST', '/businesses', { token: boss.token, body: { legal_name: 'Acme Ltd' } })).json.id;
  await t.api('POST', `/admin/businesses/${corp}/decision`, { token: bm.token, body: { status: 'active' } });
  await t.api('PATCH', `/businesses/${corp}/policy`, { token: boss.token, body: { allowed_services: ['moto'] } });
  const q = (await t.api('POST', '/fares/estimate', { token: boss.token, body: { pickup: KCC, dest: KIMIRONKO, abasare: { customer_vehicle_id: myCar.id } } })).json.options[0];
  const blocked = await t.api('POST', `/businesses/${corp}/bookings`, { token: boss.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: q.quote_id, customer_vehicle_id: myCar.id, owner_attested: true } });
  assert.equal(blocked.status, 403); assert.equal(blocked.json.error.code, 'corporate_service_not_allowed');
  await t.api('PATCH', `/businesses/${corp}/policy`, { token: boss.token, body: { allowed_services: [] } });
  const q2 = (await t.api('POST', '/fares/estimate', { token: boss.token, body: { pickup: KCC, dest: KIMIRONKO, abasare: { customer_vehicle_id: myCar.id } } })).json.options[0];
  const ok = await t.api('POST', `/businesses/${corp}/bookings`, { token: boss.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: q2.quote_id, customer_vehicle_id: myCar.id, owner_attested: true, cost_centre: 'EXEC' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json)); const bid = ok.json.id;
  await arrive(drv, bid); await checks(drv, bid, 'pickup');
  await t.api('POST', `/bookings/${bid}/handover/pickup/respond`, { token: boss.token, body: { response: 'ok' } });
  const pin = (await t.api('GET', `/bookings/${bid}`, { token: boss.token })).json.trip_pin;
  await t.api('POST', `/bookings/${bid}/start`, { token: drv.token, body: { pin } }); await checks(drv, bid, 'dropoff');
  const done = await t.api('POST', `/bookings/${bid}/complete`, { token: drv.token });
  assert.equal(done.json.status, 'PAYMENT_COMPLETED', 'billed to the company'); assert.ok((await t.db.q1<any>("select sum(debit)::int v from ledger_entries where account_code='CORPORATE_RECEIVABLE' and booking_id=$1", [bid])).v > 0);
  // return home: the same person is also a passenger and can book a Moto from the drop-off point
  const moto = await t.driver({ vehicle: 'moto', at: { lat: KIMIRONKO.lat + 0.002, lng: KIMIRONKO.lng } });
  const e = await t.api('POST', '/fares/estimate', { token: drv.token, body: { pickup: KIMIRONKO, dest: KCC, service_id: 'moto' } });
  assert.equal(e.json.options[0].available, true);
  const rb = await t.api('POST', '/bookings', { token: drv.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: e.json.options[0].quote_id, payment_method: 'cash' } });
  assert.equal(rb.status, 201); assert.ok(moto);
});

test('permissions: staff-only Abasare endpoints and cars are scoped to their owner', async () => {
  const owner = await t.register(); const other = await t.register(); const myCar = await car(owner); const analyst = await t.staff('analyst');
  assert.equal((await t.api('GET', '/admin/abasare/applications', { token: owner.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/abasare/applications', { token: analyst.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/abasare/applications', { token: verifier.token })).status, 200);
  assert.equal((await t.api('GET', '/users/me/cars', { token: other.token })).json.cars.length, 0);
  assert.equal((await t.api('DELETE', `/users/me/cars/${myCar.id}`, { token: other.token })).status, 200);
  assert.equal((await t.api('GET', '/users/me/cars', { token: owner.token })).json.cars.length, 1, 'someone else cannot remove my car');
  assert.equal((await t.api('POST', '/users/me/cars', { token: owner.token, body: { plate: 'AB', vehicle_class: 'car', transmission: 'manual', insurance_confirmed: true } })).status, 400);
  const drv = await abasareDriver(); const { res } = await bookAbasare(owner, myCar.id);
  assert.equal((await t.api('DELETE', `/users/me/cars/${myCar.id}`, { token: owner.token })).status, 409, 'car on an active booking');
  assert.ok(drv && res);
});

test('handover photos are purged after the retention period, unless a dispute is open', async () => {
  const { purgeHandoverPhotos } = await import('../src/jobs.ts'); const { readFileByKey } = await import('../src/services/storage.ts');
  const owner = await t.register(); const myCar = await car(owner); const drv = await abasareDriver();
  const { res } = await bookAbasare(owner, myCar.id); const bid = res.json.booking.id; await arrive(drv, bid);
  await t.api('POST', `/bookings/${bid}/handover/photos?phase=pickup`, { token: drv.token, ...photo() }); await t.api('POST', `/bookings/${bid}/handover/photos?phase=pickup`, { token: drv.token, ...photo() });
  const keys = (await t.db.q<any>('select file_key from handover_photos where booking_id=$1', [bid])).map((r: any) => r.file_key);
  assert.equal(keys.length, 2); await readFileByKey(keys[0]);
  assert.equal(await purgeHandoverPhotos(), 0, 'recent photos are kept');
  await t.db.q("update handover_photos set created_at = now() - interval '200 days' where booking_id=$1", [bid]);
  await t.db.q("insert into support_cases(ref, booking_id, reporter_id, category, subject, sla_due_at) values ('CS-KEEP', $1, $2, 'driver_complaint', 'open dispute', now() + interval '1 day')", [bid, owner.id]);
  assert.equal(await purgeHandoverPhotos(), 0, 'evidence is kept while a case is open');
  await t.db.q("update support_cases set status='closed' where ref='CS-KEEP'");
  assert.equal(await purgeHandoverPhotos(), 2);
  assert.equal((await t.db.q<any>('select 1 from handover_photos where booking_id=$1', [bid])).length, 0);
  await assert.rejects(() => readFileByKey(keys[0]), /ENOENT/);
});

// Shared Abasare journey helpers for the round-3 tests (cars, drivers, booking, full trip).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeJpeg, KCC, KIMIRONKO, type Ctx } from './helpers.ts';

const JPEG = makeJpeg();
export const photo = () => { const b = '----ab' + Math.random().toString(16).slice(2); return { payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), JPEG, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } }; };

export function abasareKit(t: Ctx, verifier: { token: string }) {
  async function car(owner: { token: string }) {
    const plate = 'RAB' + Math.floor(100 + Math.random() * 899) + 'X';
    const r = await t.api('POST', '/users/me/cars', { token: owner.token, body: { plate, make: 'Toyota', model: 'RAV4', color: 'Silver', vehicle_class: 'suv', transmission: 'automatic', insurance_confirmed: true } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json as { id: string; plate: string };
  }
  async function drvr() {
    const u = await t.register('driver');
    const a = await t.api('POST', '/abasare/apply', { token: u.token, body: { legal_name: 'Test Umusare', national_id: '1199080012345678', licence_since: '2015-01-01', years_experience: 8, transmissions: ['manual', 'automatic'], classes: ['car', 'suv', 'minivan', 'pickup'], return_mode: 'moto', payout_msisdn: '0788123456' } });
    assert.equal(a.status, 200, JSON.stringify(a.json));
    for (const r of await t.db.q<any>("select doc_type, requires_expiry from document_requirements where vehicle_type='abasare' and mandatory"))
      await t.db.q("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [u.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
    await t.db.q("update driver_profiles set status='DOCUMENTS_SUBMITTED', zone_id='kigali' where user_id=$1", [u.id]);
    assert.equal((await t.api('POST', `/admin/drivers/${u.id}/abasare-decision`, { token: verifier.token, body: { decision: 'approve' } })).status, 200);
    assert.equal((await t.api('PATCH', '/drivers/me/availability', { token: u.token, body: { online: true, accepting: ['abasare'] } })).status, 200);
    await t.api('POST', '/drivers/me/location', { token: u.token, body: KCC });
    return u;
  }
  async function book(owner: { token: string }, carId: string, method = 'cash', extra: any = {}) {
    const e = await t.api('POST', '/fares/estimate', { token: owner.token, body: { pickup: KCC, dest: KIMIRONKO, abasare: { customer_vehicle_id: carId } } });
    assert.equal(e.status, 200, JSON.stringify(e.json));
    const opt = e.json.options[0]; assert.ok(opt?.quote_id, JSON.stringify(e.json));
    const res = await t.api('POST', '/bookings', { token: owner.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: opt.quote_id, payment_method: method, customer_vehicle_id: carId, owner_attested: true, pickup_name: 'Bar', dest_name: 'Home', ...extra } });
    return { opt, res };
  }
  async function checks(drv: { token: string }, bid: string, phase: 'pickup' | 'dropoff') {
    for (let i = 0; i < 2; i++) assert.equal((await t.api('POST', `/bookings/${bid}/handover/photos?phase=${phase}`, { token: drv.token, ...photo() })).status, 200);
    const r = await t.api('POST', `/bookings/${bid}/handover`, { token: drv.token, body: { phase, odometer_km: phase === 'pickup' ? 45210 : 45224, fuel_percent: 50, notes: 'No visible damage' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  async function arrive(drv: { token: string }, bid: string) {
    assert.equal((await t.api('POST', `/bookings/${bid}/accept`, { token: drv.token })).status, 200);
    await t.api('POST', '/drivers/me/location', { token: drv.token, body: { lat: KCC.lat + 0.0001, lng: KCC.lng } });
    const a = await t.api('POST', `/bookings/${bid}/arrived`, { token: drv.token }); assert.equal(a.status, 200, JSON.stringify(a.json));
  }
  /** accept, arrive, check-in, start with the PIN, check-out, complete. Returns the completion body. */
  async function fullTrip(owner: { token: string }, drv: { token: string }, bid: string) {
    await arrive(drv, bid);
    await checks(drv, bid, 'pickup');
    const pin = (await t.api('GET', `/bookings/${bid}`, { token: owner.token })).json.trip_pin;
    assert.equal((await t.api('POST', `/bookings/${bid}/start`, { token: drv.token, body: { pin } })).status, 200);
    await checks(drv, bid, 'dropoff');
    const done = await t.api('POST', `/bookings/${bid}/complete`, { token: drv.token }); assert.equal(done.status, 200, JSON.stringify(done.json));
    return done.json;
  }
  return { car, drvr, book, checks, arrive, fullTrip };
}

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx, KCC, KIMIRONKO } from './helpers.ts';
let t: Ctx; let outbox: { to: string; text: string }[];
before(async () => { t = await boot(); outbox = (await import('../src/providers/sms.ts')).outbox; });
after(async () => { await t.close(); });

const guestPhone = () => `+25078${String(5000000 + Math.floor(Math.random() * 4000000))}`;

async function bookForGuest(token: string, guest: any, key = randomUUID()) {
  const e = await t.estimate(token, { service_id: 'moto' });
  const opt = e.json.options[0];
  return t.api('POST', '/bookings', { token, headers: { 'idempotency-key': key }, body: { quote_id: opt.quote_id, payment_method: 'cash', pickup_name: 'KCC', dest_name: 'Kimironko', for_guest: guest } });
}

test('guest ride: SMS on assignment and arrival (guest language), PIN, share link; booker pays', async () => {
  await t.reset();
  const { flushGuestSms } = await import('../src/services/guestRides.ts');
  const booker = await t.register('passenger');
  await t.db.q("update users set display_name='Alice Booker', preferred_language='fr' where id=$1", [booker.id]);
  const drv = await t.driver({ at: KCC });
  const gp = guestPhone();
  const r = await bookForGuest(booker.token, { name: 'Bob Guest', phone: gp });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.booking.guest.name, 'Bob Guest');
  assert.ok(!JSON.stringify(r.json).includes(gp), 'full guest phone is never returned');
  assert.equal(r.json.booking.guest.language, 'fr');           // booker's language by default
  const id = r.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: drv.token });
  await flushGuestSms();
  const sms1 = outbox.filter((m) => m.to === gp);
  assert.equal(sms1.length, 1);
  const pin = (await t.api('GET', `/bookings/${id}`, { token: booker.token })).json.trip_pin;
  assert.match(sms1[0].text, /a réservé une course pour vous/);
  assert.ok(sms1[0].text.includes(pin) && sms1[0].text.includes(drv.plate) && /\/share\//.test(sms1[0].text));
  assert.ok(!/Your|booked a ride|yagutumiye/.test(sms1[0].text), 'one language only');
  // the link works without sign-in
  const link = sms1[0].text.match(/https?:\/\/\S+\/share\/([\w-]+)/)![0].replace(/^https?:\/\/[^/]+/, '');
  assert.equal((await t.api('GET', link)).status, 200);
  // driver: guest first name, contact only after assignment
  const dv = await t.api('GET', `/bookings/${id}`, { token: drv.token });
  assert.equal(dv.json.guest.first_name, 'Bob'); assert.equal(dv.json.passenger.first_name, 'Bob'); assert.ok(!JSON.stringify(dv.json).includes(gp));
  const c = await t.api('POST', `/bookings/${id}/guest-contact`, { token: drv.token });
  assert.equal(c.status, 200); assert.equal(c.json.phone, gp);
  const other = await t.driver({ at: KCC });
  assert.equal((await t.api('POST', `/bookings/${id}/guest-contact`, { token: other.token })).status, 404);   // not the assigned driver
  await t.api('POST', '/drivers/me/location', { token: drv.token, body: { lat: KCC.lat + 0.0001, lng: KCC.lng } });
  await t.api('POST', `/bookings/${id}/arrived`, { token: drv.token });
  await flushGuestSms();
  assert.equal(outbox.filter((m) => m.to === gp).length, 2);
  assert.match(outbox.filter((m) => m.to === gp)[1].text, /est arrivé/);
  // PIN rules same as passenger: guest's PIN is the trip PIN; wrong PIN is refused
  const bad = await t.api('POST', `/bookings/${id}/start`, { token: drv.token, body: { pin: pin === '0000' ? '1111' : '0000' } });
  assert.equal(bad.status, 400);
  const st = await t.api('POST', `/bookings/${id}/start`, { token: drv.token, body: { pin } });
  assert.equal(st.status, 200);
  await t.api('POST', `/bookings/${id}/complete`, { token: drv.token });
  assert.equal((await t.api('POST', `/bookings/${id}/guest-contact`, { token: drv.token })).status, 409);   // trip over: no contact
  const b = (await t.db.q<any>('select passenger_id, payer_type from bookings where id=$1', [id]))[0];
  assert.equal(b.passenger_id, booker.id);
  // retention purges name and phone
  const { purgeGuestData } = await import('../src/services/guestRides.ts');
  await t.db.q("update bookings set status='PAYMENT_COMPLETED', completed_at=now() - interval '10 days' where id=$1", [id]);
  assert.equal(await purgeGuestData(), 1);
  const after = (await t.db.q<any>('select guest_name, guest_phone from bookings where id=$1', [id]))[0];
  assert.equal(after.guest_phone, null); assert.equal(after.guest_name, null);
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: booker.token })).json.guest.purged, true);
});

test('guest ride: cancellation SMS to the guest, fee goes to the booker', async () => {
  await t.reset();
  const { flushGuestSms } = await import('../src/services/guestRides.ts');
  const booker = await t.register('passenger'); const drv = await t.driver({ at: KCC });
  const gp = guestPhone();
  const r = await bookForGuest(booker.token, { name: 'Carol', phone: gp, language: 'rw' });
  const id = r.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: drv.token });
  await t.db.q("update bookings set assigned_at = now() - interval '10 minutes' where id=$1", [id]);
  const c = await t.api('POST', `/bookings/${id}/cancel`, { token: booker.token, body: { reason: 'changed_mind' } });
  assert.equal(c.status, 200); assert.ok(c.json.cancel_fee > 0);
  const debt = await t.db.q<any>('select user_id from passenger_debts where booking_id=$1', [id]);
  assert.equal(debt[0].user_id, booker.id);
  await flushGuestSms();
  const msgs = outbox.filter((m) => m.to === gp);
  assert.match(msgs.at(-1)!.text, /rwahagaritswe/); assert.match(msgs[0].text, /yagutumiye/);
});

test('guest ride: validation, own number, abuse limits', async () => {
  await t.reset();
  await t.driver({ at: KCC });
  const booker = await t.register('passenger');
  assert.equal((await bookForGuest(booker.token, { name: 'X', phone: '12345' })).status, 400);
  assert.equal((await bookForGuest(booker.token, { name: 'X', phone: booker.phone })).json.error.code, 'guest_same_as_booker');
  // per-phone limit (any booker)
  const gp = guestPhone();
  await t.db.q("update system_settings set value=value where false");
  await t.db.q("insert into system_settings(key,value) values ('guest.max_per_phone_per_day','2'),('guest.max_active_per_user','2') on conflict (key) do update set value=excluded.value");
  const b1 = await t.register('passenger'), b2 = await t.register('passenger'), b3 = await t.register('passenger');
  assert.equal((await bookForGuest(b1.token, { name: 'G', phone: gp })).status, 201);
  assert.equal((await bookForGuest(b2.token, { name: 'G', phone: gp })).status, 201);
  const third = await bookForGuest(b3.token, { name: 'G', phone: gp }, randomUUID());
  assert.equal(third.status, 409); assert.equal(third.json.error.code, 'guest_limit_phone');
  const fr = await t.api('POST', '/bookings', { token: b3.token, headers: { 'idempotency-key': randomUUID(), 'accept-language': 'fr' }, body: { quote_id: (await t.estimate(b3.token, { service_id: 'moto' })).json.options[0].quote_id, payment_method: 'cash', for_guest: { name: 'G', phone: gp } } });
  assert.match(fr.json.error.message, /déjà reçu/);
  // the failed attempt left nothing behind
  assert.equal((await t.db.q<any>("select count(*)::int n from bookings where passenger_id=$1", [b3.id]))[0].n, 0);
  await t.db.q("delete from system_settings where key in ('guest.max_per_phone_per_day','guest.max_active_per_user')");
});

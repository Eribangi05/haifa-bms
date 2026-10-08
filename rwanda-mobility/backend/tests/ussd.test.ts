import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';
import { abasareKit } from './helpersAbasare.ts';

const SECRET = 'test-ussd-shared-secret-123456';
let t: Ctx; let K: ReturnType<typeof abasareKit>; let analyst: any;
before(async () => {
  process.env.USSD_SHARED_SECRET = SECRET; delete process.env.USSD_ALLOWED_IPS;
  t = await boot('rwanda_mobility_test');
  K = abasareKit(t, await t.staff('driver_verifier')); analyst = await t.staff('analyst');
});
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); delete process.env.USSD_ALLOWED_IPS; process.env.USSD_SHARED_SECRET = SECRET; });

let seq = 0;
const newPhone = () => `+25079${String(5000000 + ++seq * 13 + Math.floor(Math.random() * 9)).slice(0, 7)}`;
const sid = () => `ATUid_${Date.now()}_${++seq}`;
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
async function raw(body: string, headers: Record<string, string> = {}, url = '/ussd/callback') {
  const r = await t.app.inject({ method: 'POST', url, payload: body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-ussd-secret': SECRET, ...headers } });
  return { status: r.statusCode, body: r.payload };
}
/** One dialogue as the aggregator sees it: cumulative text joined with '*'. */
function dialog(phone: string, sessionId = sid()) {
  const inputs: string[] = [];
  const step = async (input?: string) => {
    if (input !== undefined) inputs.push(input);
    const r = await raw(form({ sessionId, serviceCode: '*123#', phoneNumber: phone, text: inputs.join('*') }));
    assert.equal(r.status, 200, r.body);
    assert.match(r.body, /^(CON|END) /, r.body);
    const text = r.body.slice(4);
    assert.ok(text.length <= 160, `screen too long (${text.length}): ${text}`);
    return { end: r.body.startsWith('END'), text };
  };
  return { step, inputs, sessionId };
}
const bookingsOf = async (phone: string) => t.db.q<any>('select b.* from bookings b join users u on u.id=b.passenger_id where u.phone=$1 order by b.created_at', [phone]);
/** language 3 (English), accept terms: returns on the main menu */
async function signup(phone: string, lang = '3') {
  const d = dialog(phone);
  assert.match((await d.step()).text, /Kinyarwanda/);
  const terms = await d.step(lang); assert.equal(terms.end, false);
  const main = await d.step('1'); assert.equal(main.end, false);
  return main.text;
}

test('security: shared secret (header or query), optional IP allow-list, not configured => refused', async () => {
  const phone = newPhone(); const body = form({ sessionId: sid(), serviceCode: '*123#', phoneNumber: phone, text: '' });
  assert.equal((await raw(body, { 'x-ussd-secret': '' })).status, 401);
  assert.equal((await raw(body, { 'x-ussd-secret': 'wrong-secret-wrong-secret' })).status, 401);
  assert.equal((await raw(body, { 'x-ussd-secret': '' }, `/ussd/callback?secret=${SECRET}`)).status, 200);
  assert.equal((await raw(body)).status, 200);
  process.env.USSD_ALLOWED_IPS = '10.1.1.1, 192.168.0.0/16';
  assert.equal((await raw(form({ sessionId: sid(), serviceCode: '*123#', phoneNumber: phone, text: '' }))).status, 403);
  process.env.USSD_ALLOWED_IPS = '10.1.1.1,127.0.0.0/8';
  assert.equal((await raw(form({ sessionId: sid(), serviceCode: '*123#', phoneNumber: phone, text: '' }))).status, 200);
  delete process.env.USSD_ALLOWED_IPS; delete process.env.USSD_SHARED_SECRET;
  assert.equal((await raw(body)).status, 503);
  process.env.USSD_SHARED_SECRET = 'short';
  assert.equal((await raw(body)).status, 503, 'a weak secret is the same as none');
  process.env.USSD_SHARED_SECRET = SECRET;
  assert.equal((await raw(form({ sessionId: sid(), phoneNumber: 'abcde', text: '' }))).body.startsWith('END '), true);
});

test('unknown phone: language first, explicit terms step, decline creates nothing, accept creates a passenger once', async () => {
  const phone = newPhone();
  const d = dialog(phone);
  const lang = await d.step(); assert.equal(lang.end, false); assert.match(lang.text, /1 Kinyarwanda/);
  const bad = await d.step('7'); assert.match(bad.text, /Invalid choice/);
  const terms = await d.step('3'); assert.match(terms.text, /terms/i); assert.match(terms.text, /1 Accept/);
  assert.equal((await t.db.q('select 1 from users where phone=$1', [phone])).length, 0, 'no account before the terms are accepted');
  const no = await d.step('2'); assert.equal(no.end, true);
  assert.equal((await t.db.q('select 1 from users where phone=$1', [phone])).length, 0);

  const d2 = dialog(phone);
  const again = await d2.step(); assert.match(again.text, /terms/i, 'language is remembered per phone, terms asked again');
  const main = await d2.step('1'); assert.match(main.text, /1 Request a ride/);
  const u = await t.db.q1<any>('select id, preferred_language from users where phone=$1', [phone]);
  assert.equal(u.preferred_language, 'en');
  assert.deepEqual((await t.db.q<any>("select role from user_roles where user_id=$1", [u.id])).map((r) => r.role), ['passenger']);
  assert.ok((await t.db.q<any>("select kind from consents where user_id=$1", [u.id])).length >= 2);
  const d3 = dialog(phone); assert.match((await d3.step()).text, /1 Request a ride/, 'known phone goes straight to the menu');
  assert.equal((await t.db.q('select 1 from users where phone=$1', [phone])).length, 1);
});

test('complete journey: ride request, trip status with driver/plate/PIN, SMS, cancel; booking is flagged ussd and cash only', async () => {
  const phone = newPhone();
  const p1 = await t.db.q1<any>('select lat, lng from places order by designated_pickup desc, name_en limit 1');
  const drv = await t.driver({ vehicle: 'moto', at: { lat: p1.lat, lng: p1.lng } });
  await signup(phone);
  const d = dialog(phone); await d.step();
  const places = await d.step('1'); assert.match(places.text, /^Pickup:/); assert.match(places.text, /\n1 /);
  const dest = await d.step('1'); assert.match(dest.text, /^Destination:/);
  const fare = await d.step('2'); assert.match(fare.text, /^Fare \(cash\):/); assert.match(fare.text, /1 Moto \d+/);
  const conf = await d.step('1'); assert.match(conf.text, /cash\./); assert.match(conf.text, /1 Confirm/);
  const done = await d.step('1'); assert.equal(done.end, true); assert.match(done.text, /^Request RM-[A-Z0-9]+ sent/);
  const [b] = await bookingsOf(phone);
  assert.equal(b.channel, 'ussd'); assert.equal(b.payment_method, 'cash'); assert.equal(b.status, 'SEARCHING_DRIVER');

  // second booking blocked while a trip is active
  const again = dialog(phone); await again.step();
  const blocked = await again.step('1'); assert.equal(blocked.end, true); assert.match(blocked.text, /already have a trip/);

  // SMS for the booking (USSD template), then driver assigned with PIN visible in "My trip"
  const { flushSms } = await import('../src/services/notify.ts'); await flushSms();
  const sms1 = await t.db.q<any>("select body from notifications where user_id=$1 and channel='sms' and template_key='booking_confirmed'", [b.passenger_id]);
  assert.equal(sms1.length, 1); assert.match(sms1[0].body, /^Abasare: request RM-/); assert.ok(sms1[0].body.length <= 160);
  assert.equal((await t.api('POST', `/bookings/${b.id}/accept`, { token: drv.token })).status, 200);
  const sms2 = await t.db.q<any>("select body from notifications where user_id=$1 and channel='sms' and template_key='driver_assigned'", [b.passenger_id]);
  assert.match(sms2[0].body, /option 2/); assert.ok(!/app/.test(sms2[0].body), 'USSD riders are not told to look in the app'); assert.ok(sms2[0].body.length <= 160);
  const trip = dialog(phone); await trip.step();
  const my = await trip.step('2');
  const { tripPin } = await import('../src/services/bookings.ts');
  assert.match(my.text, new RegExp(`Trip ${b.ref}`)); assert.ok(my.text.includes(`PIN: ${tripPin(b.id)}`)); assert.ok(my.text.includes(drv.plate)); assert.match(my.text, /1 Cancel trip/);

  const ask = await trip.step('1'); assert.match(ask.text, /Cancel trip/); assert.match(ask.text, /1 Yes/);
  const kept = dialog(phone); await kept.step(); await kept.step('2'); await kept.step('1'); assert.match((await kept.step('2')).text, /not cancelled/);
  const fin = await trip.step('1'); assert.equal(fin.end, true); assert.match(fin.text, /cancelled/);
  assert.equal((await t.db.q1<any>('select status from bookings where id=$1', [b.id])).status, 'CANCELLED_BY_PASSENGER');
  const none = dialog(phone); await none.step(); const nt = await none.step('2'); assert.equal(nt.end, true); assert.match(nt.text, /no active trip/);
});

test('invalid input never advances or breaks the dialogue; back goes to the menu; declining the fare sends nothing', async () => {
  const phone = newPhone(); await t.driver({ vehicle: 'moto' });
  await signup(phone);
  const d = dialog(phone); await d.step();
  assert.match((await d.step('9')).text, /^Invalid choice\.\nAbasare\n1 Request a ride/);
  assert.match((await d.step('abc')).text, /^Invalid choice/);
  await d.step('1');
  assert.match((await d.step('99')).text, /^Invalid choice\.\nPickup:/);
  assert.match((await d.step('0')).text, /^Abasare\n1 Request a ride/);
  await d.step('1'); await d.step('1'); await d.step('1');
  assert.match((await d.step('7')).text, /^Invalid choice\.\nFare/);
  await d.step('1'); assert.match((await d.step('5')).text, /^Invalid choice/);
  const no = await d.step('2'); assert.equal(no.end, true); assert.match(no.text, /Not confirmed/);
  assert.equal((await bookingsOf(phone)).length, 0);
});

test('session expiry restarts the dialogue; an aggregator retry gets the same answer and does not double-book', async () => {
  const phone = newPhone(); await t.driver({ vehicle: 'moto' });
  await signup(phone);
  const d = dialog(phone); await d.step(); await d.step('1'); await d.step('1');
  await t.db.q("update ussd_sessions set expires_at = now() - interval '1 minute' where session_id=$1", [d.sessionId]);
  const r = await d.step('2');   // the user's "2" must NOT be applied to the old destination screen
  assert.match(r.text, /^Abasare\n1 Request a ride/, 'expired session shows the menu again');
  assert.equal((await t.db.q1<any>('select step from ussd_sessions where session_id=$1', [d.sessionId])).step, 'main');

  const e = dialog(phone); await e.step(); await e.step('1'); await e.step('1'); await e.step('1'); await e.step('1');
  const body = form({ sessionId: e.sessionId, serviceCode: '*123#', phoneNumber: phone, text: e.inputs.concat('1').join('*') });
  const a1 = await raw(body), a2 = await raw(body), a3 = await raw(body);
  assert.equal(a1.body, a2.body); assert.equal(a2.body, a3.body); assert.ok(a1.body.startsWith('END '));
  assert.equal((await bookingsOf(phone)).length, 1);
});

test('language switch (0) is remembered and never mixes languages; rw and fr menus', async () => {
  const phone = newPhone();
  await signup(phone);
  const d = dialog(phone); await d.step();
  assert.match((await d.step('0')).text, /Kinyarwanda/);
  const fr = await d.step('2'); assert.match(fr.text, /1 Demander une course/); assert.ok(!/Request|Language|Help/.test(fr.text));
  const d2 = dialog(phone); assert.match((await d2.step()).text, /Demander une course/, 'remembered');
  assert.equal((await t.db.q1<any>('select preferred_language l from users where phone=$1', [phone])).l, 'fr');
  await d2.step('0'); const rw = await d2.step('1'); assert.match(rw.text, /1 Saba urugendo/); assert.ok(!/Request|Demander/.test(rw.text));
  const pl = await d2.step('1'); assert.match(pl.text, /^Aho ugiye gufatirwa:/);
  const help = dialog(phone); await help.step(); const h = await help.step('4'); assert.equal(h.end, true); assert.match(h.text, /112/); assert.match(h.text, /912/); assert.match(h.text, /Ubufasha/);
  await help.step();
});

test('every screen text is single-language and under 160 characters', async () => {
  const { TXT, tx, ULANGS } = await import('../src/services/ussdText.ts');
  const english = /(?<![\p{L}])(the|your|you|request|trip|cancel|confirm|help|driver|please|invalid|choose|pickup|language|fare|accept|decline|back)(?![\p{L}])/iu;
  const vars = { ref: 'RM-ABCDEFGH', driver: 'Jean Claude M', plate: 'RAB123C', pin: '1234', fare: 15000, fee: 1000, svc: 'Standard car', h: 6, amount: 30000 };
  for (const key of Object.keys(TXT) as (keyof typeof TXT)[]) {
    for (const lang of ULANGS) {
      const s = tx(key, lang, vars);
      assert.ok(s.length <= 200, `${key}.${lang} ${s.length}`);   // list screens are trimmed to 160 at run time; static screens must fit by themselves
      if (key !== 'lang' && lang !== 'en') assert.ok(!english.test(s.replace(/Abasare|USSD|RWF|PIN|Moto/g, '')), `${key}.${lang} contains English: ${s}`);
    }
    if (key !== 'lang') assert.notEqual(TXT[key].en, TXT[key].rw);
  }
  for (const key of ['main', 'terms', 'hours', 'confirm', 'abasare_confirm', 'trip_driver', 'help'] as const) for (const lang of ULANGS) assert.ok(tx(key, lang, vars).length <= 160, `${key}.${lang}`);
});

test('JSON mode for other aggregators', async () => {
  const phone = newPhone(); const sessionId = sid();
  const post = (b: any, h: Record<string, string> = {}) => t.app.inject({ method: 'POST', url: '/ussd/callback', payload: b, headers: { 'x-ussd-secret': SECRET, ...h } });
  const bad = await post({ session_id: sessionId, phone }, { 'x-ussd-secret': 'nope' }); assert.equal(bad.statusCode, 401);
  let r = (await post({ session_id: sessionId, phone, new_session: true })).json();
  assert.equal(r.end, false); assert.equal(r.continue_session, true); assert.match(r.message, /Kinyarwanda/);
  r = (await post({ session_id: sessionId, phone, input: '2' })).json(); assert.match(r.message, /conditions/);
  r = (await post({ session_id: sessionId, phone, input: '2' })).json(); assert.equal(r.end, true); assert.equal(r.continue_session, false);
  assert.equal((await post({ session_id: sessionId, phone: '12345', input: '1' })).json().end, true);
  assert.equal((await post({ nonsense: true })).statusCode, 400);
});

test('Abasare over USSD: only users with a registered car; deposit prompt when a deposit is required', async () => {
  const phone = newPhone(); await signup(phone);
  const d0 = dialog(phone); await d0.step(); const nc = await d0.step('3'); assert.equal(nc.end, true); assert.match(nc.text, /Add your car/);
  const tok = await t.register('passenger', phone);   // same user, signed in through the app to register a car
  const c = await K.car(tok); await K.drvr();
  await t.db.q("insert into system_settings(key,value) values ('abasare.deposit_percent','30') on conflict (key) do update set value=excluded.value");
  const d = dialog(phone); await d.step();
  const cars = await d.step('3'); assert.match(cars.text, /^Choose car:/); assert.ok(cars.text.includes(c.plate));
  assert.match((await d.step('1')).text, /^Pickup:/);
  const hours = await d.step('1'); assert.match(hours.text, /^Hours:/);
  const conf = await d.step('2'); assert.match(conf.text, /Abasare .* 3h \d+ RWF cash\. This car is mine and insured/);
  const fin = await d.step('1'); assert.equal(fin.end, true); assert.match(fin.text, /deposit/);
  const [b] = await bookingsOf(phone);
  assert.equal(b.channel, 'ussd'); assert.ok(b.hire_mode); assert.equal(b.hours_booked, 3);
  const dep = await t.db.q1<any>('select status from booking_deposits where booking_id=$1', [b.id]); assert.equal(dep.status, 'paid', 'MoMo prompt was approved (simulated)');
  assert.equal((await t.db.q1<any>('select status from bookings where id=$1', [b.id])).status, 'SEARCHING_DRIVER');
});

test('safety rails: restricted accounts, per-phone burst limit, disabled service', async () => {
  const phone = newPhone(); await signup(phone);
  await t.db.q("update users set status='restricted' where phone=$1", [phone]);
  const d = dialog(phone); await d.step(); const r = await d.step('1'); assert.equal(r.end, true);
  const r0 = await d.step();   // fresh text '' => new dialogue, still blocked
  await t.db.q("update users set status='active' where phone=$1", [phone]); void r0;

  process.env.USSD_PHONE_RATE_MAX = '4';
  const p2 = newPhone(); const dd = dialog(p2); let busy = false;
  for (let i = 0; i < 8; i++) { const x = await dd.step(i === 0 ? undefined : '9'); if (x.end && /Too many/.test(x.text)) busy = true; }
  assert.equal(busy, true); delete process.env.USSD_PHONE_RATE_MAX;

  await t.db.q("insert into system_settings(key,value) values ('ussd.enabled','false') on conflict (key) do update set value=excluded.value");
  const off = await dialog(newPhone()).step(); assert.equal(off.end, true); assert.match(off.text, /not available/);
  await t.db.q("insert into system_settings(key,value) values ('ussd.enabled','true') on conflict (key) do update set value=excluded.value");
});

test('admin: session log (phones masked) and channel stats need ussd.view', async () => {
  const phone = newPhone(); await signup(phone);
  const s = await t.api('GET', '/admin/ussd/sessions', { token: analyst.token });
  assert.equal(s.status, 200); assert.ok(s.json.sessions.length > 0); assert.ok(s.json.sessions.every((x: any) => /\*\*\*/.test(x.phone)));
  const st = await t.api('GET', '/admin/ussd/stats', { token: analyst.token });
  assert.equal(st.status, 200); assert.ok(st.json.sessions.total > 0); assert.ok(Array.isArray(st.json.channels)); assert.ok(st.json.languages.length > 0);
  const p = await t.register(); assert.equal((await t.api('GET', '/admin/ussd/stats', { token: p.token })).status, 403);
});

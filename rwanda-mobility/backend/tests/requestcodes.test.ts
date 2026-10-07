import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, KCC, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

let n = 0;
const ip = () => ({ 'x-forwarded-for': `10.9.${Math.floor(++n / 250)}.${n % 250}` });
async function mk(admin: { token: string }, extra: any = {}) {
  const r = await t.api('POST', '/admin/request-codes', { token: admin.token, body: { label: 'Hotel des Mille Collines', lat: KCC.lat, lng: KCC.lng, pickup_note: 'Main entrance, ask the receptionist', ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}

test('create, list and permissions', async () => {
  const admin = await t.staff('super_admin'), analyst = await t.staff('analyst'), disp = await t.staff('dispatcher'), bm = await t.staff('business_manager');
  const c = await mk(admin);
  assert.match(c.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(c.default_service, 'ride'); assert.equal(c.scans, 0); assert.ok(c.url.endsWith('/r/' + c.code));
  const custom = await mk(bm, { code: 'abcd23', label: 'Bar <b>X</b>', default_service: 'abasare' });
  assert.equal(custom.code, 'ABCD23');
  const dup = await t.api('POST', '/admin/request-codes', { token: admin.token, body: { code: 'ABCD23', label: 'x', lat: KCC.lat, lng: KCC.lng } });
  assert.equal(dup.status, 409);
  const bad = await t.api('POST', '/admin/request-codes', { token: admin.token, body: { code: 'ABCDO1', label: 'x', lat: KCC.lat, lng: KCC.lng } });
  assert.equal(bad.status, 400);
  const out = await t.api('POST', '/admin/request-codes', { token: admin.token, body: { label: 'Paris', lat: 48.85, lng: 2.35 } });
  assert.equal(out.status, 400); assert.equal(out.json.error.code, 'outside_rwanda');

  const list = await t.api('GET', '/admin/request-codes', { token: analyst.token });
  assert.equal(list.status, 200);
  const row = list.json.codes.find((x: any) => x.id === c.id);
  assert.equal(row.bookings, 0); assert.equal(row.completed, 0); assert.equal(row.scans, 0);
  assert.equal((await t.api('POST', '/admin/request-codes', { token: analyst.token, body: { label: 'x', lat: KCC.lat, lng: KCC.lng } })).status, 403);
  assert.equal((await t.api('GET', '/admin/request-codes', { token: disp.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/request-codes')).status, 401);

  const p = await t.api('PATCH', `/admin/request-codes/${c.id}`, { token: admin.token, body: { label: 'Hotel B', default_service: 'abasare', pickup_note: null } });
  assert.equal(p.status, 200); assert.equal(p.json.label, 'Hotel B'); assert.equal(p.json.default_service, 'abasare'); assert.equal(p.json.pickup_note, null);
  const del = await t.api('DELETE', `/admin/request-codes/${c.id}`, { token: admin.token });
  assert.equal(del.status, 200);
  assert.equal((await t.db.q1<any>('select active from request_codes where id=$1', [c.id])).active, false);
  const audits = await t.db.q<any>("select action from audit_logs where entity_id=$1", [c.id]);
  assert.deepEqual(audits.map((a: any) => a.action).sort(), ['request_code.create', 'request_code.deactivate', 'request_code.update']);
});

test('public resolve: valid, unknown, inactive, expired; scans counted once per IP', async () => {
  const admin = await t.staff('super_admin');
  const c = await mk(admin);
  const r = await t.api('GET', `/request-codes/${c.code.toLowerCase()}`, { headers: ip() });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['code', 'default_service', 'label', 'lat', 'lng', 'partner_name', 'pickup_note', 'zone_ok']);
  assert.equal(r.json.label, 'Hotel des Mille Collines'); assert.equal(r.json.zone_ok, true); assert.equal(r.json.pickup_note, 'Main entrance, ask the receptionist');
  const same = { 'x-forwarded-for': '10.8.8.8' };
  await t.api('GET', `/request-codes/${c.code}`, { headers: same }); await t.api('GET', `/request-codes/${c.code}`, { headers: same });
  assert.equal((await t.db.q1<any>('select scans from request_codes where id=$1', [c.id])).scans, 2);   // first ip + same ip once
  const far = await mk(admin, { label: 'Far', lat: -2.5, lng: 28.9 });
  assert.equal((await t.api('GET', `/request-codes/${far.code}`, { headers: ip() })).json.zone_ok, false);

  const un = await t.api('GET', '/request-codes/ZZZZZZ', { headers: { ...ip(), 'accept-language': 'fr' } });
  assert.equal(un.status, 404); assert.equal(un.json.error.code, 'code_invalid'); assert.match(un.json.error.message, /code/i);
  const rw = await t.api('GET', '/request-codes/ZZZZZZ', { headers: { ...ip(), 'accept-language': 'rw' } });
  assert.match(rw.json.error.message, /kode/i);
  assert.equal((await t.api('GET', "/request-codes/1'%20or%20'1", { headers: ip() })).status, 404);
  await t.db.q("update request_codes set expires_at=now()-interval '1 minute' where id=$1", [c.id]);
  assert.equal((await t.api('GET', `/request-codes/${c.code}`, { headers: ip() })).status, 404);
  await t.db.q('update request_codes set expires_at=null where id=$1', [c.id]);
  await t.api('PATCH', `/admin/request-codes/${c.id}`, { token: admin.token, body: { active: false } });
  assert.equal((await t.api('GET', `/request-codes/${c.code}`, { headers: ip() })).status, 404);
});

test('landing page in rw / fr / en, XSS-safe, invalid code gives a localized 404 page', async () => {
  const admin = await t.staff('super_admin');
  const evil = '<script>alert(1)</script>"\'&';
  const c = await mk(admin, { label: evil, pickup_note: '<img src=x onerror=alert(2)>' });
  const get = (lang?: string, al?: string) => t.api('GET', `/r/${c.code}${lang ? '?lang=' + lang : ''}`, { headers: { ...ip(), ...(al ? { 'accept-language': al } : {}) } });
  const rw = await get(), fr = await get('fr'), en = await get('en'), viaHeader = await get(undefined, 'fr-FR,fr;q=0.9');
  for (const r of [rw, fr, en]) {
    assert.equal(r.status, 200); assert.match(r.headers['content-type'] as string, /text\/html/);
    assert.ok(!r.raw.includes('<script>alert(1)'), 'label must be escaped'); assert.ok(!r.raw.includes('<img src=x'), 'note must be escaped');
    assert.ok(r.raw.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(r.raw.includes(`intent://r/${c.code}?svc=ride#Intent;scheme=abasare;package=rw.abasare.app;end`));
    assert.ok(r.raw.includes(`intent://r/${c.code}?svc=abasare#Intent`)); assert.ok(r.raw.includes(`abasare://r/${c.code}?svc=ride`));
    assert.ok(r.raw.includes('#00A1DE') && r.raw.includes('#FAD201') && r.raw.includes('#20603D'));
  }
  assert.match(rw.raw, /lang="rw"/); assert.match(rw.raw, /Saba urugendo/); assert.ok(!/Request a ride|Demander/.test(rw.raw));
  assert.match(fr.raw, /lang="fr"/); assert.match(fr.raw, /Demander une course/); assert.ok(!/Request a ride|Saba urugendo/.test(fr.raw));
  assert.match(en.raw, /lang="en"/); assert.match(en.raw, /Request a ride/); assert.match(en.raw, /must be installed/); assert.ok(!/Saba urugendo|Demander/.test(en.raw));
  assert.match(viaHeader.raw, /lang="fr"/);

  const bad = await t.api('GET', '/r/NOPE22?lang=fr'), bad2 = await t.api('GET', '/r/%3Cscript%3E');
  assert.equal(bad.status, 404); assert.match(bad.raw, /n&#39;est pas valide/); assert.equal(bad2.status, 404); assert.ok(!bad2.raw.includes('<script>'));
  assert.match((await t.api('GET', '/r/NOPE22')).raw, /ntikora/);
  assert.match((await t.api('GET', '/r/NOPE22?lang=en')).raw, /not valid/);
});

test('booking attribution: stored, visible to admin, invalid code rejected; scans counted from the landing page', async () => {
  const admin = await t.staff('super_admin');
  const c = await mk(admin);
  await t.api('GET', `/r/${c.code}`, { headers: ip() });
  assert.equal((await t.db.q1<any>('select scans from request_codes where id=$1', [c.id])).scans, 1);
  await t.driver({ vehicle: 'moto' });
  const p = await t.register();
  const bad = await t.book(p.token, 'moto', 'cash', { body: { request_code: 'ZZZZZZ' }, estimate: {} });
  assert.equal(bad.res.status, 400); assert.equal(bad.res.json.error.code, 'code_invalid');
  const badFr = await t.book(p.token, 'moto', 'cash', { body: { request_code: 'ZZZZZZ' } });
  assert.ok(badFr.res.json.error.message);
  const ok = await t.book(p.token, 'moto', 'cash', { body: { request_code: c.code.toLowerCase() } });
  assert.equal(ok.res.status, 201, JSON.stringify(ok.res.json));
  const id = ok.res.json.booking.id;
  assert.equal((await t.db.q1<any>('select request_code_id from bookings where id=$1', [id])).request_code_id, c.id);
  const view = await t.api('GET', `/bookings/${id}`, { token: admin.token });
  assert.equal(view.json.request_code.code, c.code);
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: p.token })).json.request_code, undefined);
  const al = await t.api('GET', '/admin/bookings', { token: admin.token });
  assert.equal(al.json.bookings.find((b: any) => b.id === id).request_code, c.code);
  const list = await t.api('GET', '/admin/request-codes', { token: admin.token });
  assert.equal(list.json.codes.find((x: any) => x.id === c.id).bookings, 1);
  // an expired code is rejected too
  await t.db.q("update request_codes set expires_at=now()-interval '1 minute' where id=$1", [c.id]);
  await t.db.q("update bookings set status='CANCELLED_BY_SYSTEM' where id=$1", [id]);
  const p2 = await t.register();
  assert.equal((await t.book(p2.token, 'moto', 'cash', { body: { request_code: c.code } })).res.status, 400);
});

test('QR endpoints return SVG and a 1024px PNG for the landing URL; need permission', async () => {
  const admin = await t.staff('super_admin'), disp = await t.staff('dispatcher'), analyst = await t.staff('analyst');
  const c = await mk(admin);
  const svg = await t.api('GET', `/admin/request-codes/${c.id}/qr.svg`, { token: analyst.token });
  assert.equal(svg.status, 200); assert.match(svg.headers['content-type'] as string, /image\/svg\+xml/); assert.match(svg.raw, /^<\?xml|^<svg/);
  const png = await t.app.inject({ method: 'GET', url: `/api/v1/admin/request-codes/${c.id}/qr.png`, headers: { authorization: `Bearer ${admin.token}` } });
  assert.equal(png.statusCode, 200); assert.match(png.headers['content-type'] as string, /image\/png/);
  const buf = png.rawPayload; assert.equal(buf.subarray(1, 4).toString(), 'PNG'); assert.equal(buf.readUInt32BE(16), 1024); assert.equal(buf.readUInt32BE(20), 1024);
  assert.equal((await t.api('GET', `/admin/request-codes/${c.id}/qr.png`, { token: disp.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/request-codes/00000000-0000-4000-8000-000000000000/qr.svg', { token: admin.token })).status, 404);
});

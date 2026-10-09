import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });

test('OTP registration: valid +250 number, code verified once, session issued, passenger role only', async () => {
  const phone = '+250788300001';
  const o = await t.api('POST', '/auth/otp/request', { body: { phone: '0788 300 001' } });
  assert.equal(o.status, 200); assert.ok(o.json.dev_code);
  const bad = await t.api('POST', '/auth/otp/verify', { body: { phone, code: o.json.dev_code === '000000' ? '111111' : '000000' } });
  assert.equal(bad.status, 400);
  const v = await t.api('POST', '/auth/otp/verify', { body: { phone, code: o.json.dev_code } });
  assert.equal(v.status, 200);
  assert.deepEqual(v.json.roles, ['passenger']);
  const replay = await t.api('POST', '/auth/otp/verify', { body: { phone, code: o.json.dev_code } });
  assert.equal(replay.status, 400, 'an OTP can be used once');
  const me = await t.api('GET', '/users/me', { token: v.json.access_token });
  assert.equal(me.json.phone, phone);
});

test('OTP is never stored in plaintext and never appears in notification logs', async () => {
  const o = await t.api('POST', '/auth/otp/request', { body: { phone: '+250788300002' } });
  const rows = await t.db.q<any>('select code_hash from otp_challenges where phone=$1', ['+250788300002']);
  assert.ok(!rows[0].code_hash.includes(o.json.dev_code));
  assert.equal(rows[0].code_hash.length, 64);
  const n = await t.db.q<any>("select params, body from notifications where template_key='otp'");
  assert.equal(n.length, 0);
});

test('invalid numbers are rejected', async () => {
  for (const phone of ['12345', '+999722123456', '+2547', '0712345678', 'abc']) {
    const r = await t.api('POST', '/auth/otp/request', { body: { phone } });
    assert.equal(r.status, 400, phone);
  }
});

test('OTP expires, and wrong attempts lock the challenge', async () => {
  const phone = '+250788300003';
  const o = await t.api('POST', '/auth/otp/request', { body: { phone } });
  await t.db.q("update otp_challenges set expires_at = now() - interval '1 second' where phone=$1", [phone]);
  assert.equal((await t.api('POST', '/auth/otp/verify', { body: { phone, code: o.json.dev_code } })).status, 400);
  const o2 = await t.api('POST', '/auth/otp/request', { body: { phone } });
  const wrong = o2.json.dev_code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await t.api('POST', '/auth/otp/verify', { body: { phone, code: wrong } });
  const locked = await t.api('POST', '/auth/otp/verify', { body: { phone, code: o2.json.dev_code } });
  assert.equal(locked.status, 429, 'correct code no longer accepted after too many wrong attempts');
});

test('OTP abuse protection: resend cooldown, per-phone hourly cap, per-IP cap', async () => {
  await t.db.q("insert into system_settings(key,value) values ('otp.resend_cooldown_s','60') on conflict (key) do update set value='60'");
  const phone = '+250788300004';
  assert.equal((await t.api('POST', '/auth/otp/request', { body: { phone } })).status, 200);
  const again = await t.api('POST', '/auth/otp/request', { body: { phone } });
  assert.equal(again.status, 429); assert.equal(again.json.error.code, 'otp_cooldown');
  await t.db.q("insert into system_settings(key,value) values ('otp.resend_cooldown_s','0') on conflict (key) do update set value='0'");
  const p2 = '+250788300005';
  for (let i = 0; i < 5; i++) assert.equal((await t.api('POST', '/auth/otp/request', { body: { phone: p2 } })).status, 200);
  assert.equal((await t.api('POST', '/auth/otp/request', { body: { phone: p2 } })).status, 429, 'per-phone hourly cap');
  await t.db.q("insert into system_settings(key,value) values ('otp.max_per_hour_ip','3') on conflict (key) do update set value='3'");
  const r = await t.api('POST', '/auth/otp/request', { body: { phone: '+250788300006' } });
  assert.equal(r.status, 429, 'per-IP hourly cap');
  await t.db.q("insert into system_settings(key,value) values ('otp.max_per_hour_ip','1000000') on conflict (key) do update set value='1000000'");
});

test('suspicious registration: one device cannot mint unlimited accounts', async () => {
  const device = 'same-device-' + randomUUID();
  for (let i = 0; i < 3; i++) await t.register('passenger', undefined, device);
  const ph = t.phone();
  const o = await t.api('POST', '/auth/otp/request', { body: { phone: ph } });
  const v = await t.api('POST', '/auth/otp/verify', { body: { phone: ph, code: o.json.dev_code }, headers: { 'x-device-id': device } });
  assert.equal(v.status, 429); assert.equal(v.json.error.code, 'suspicious_registration');
});

test('refresh tokens rotate; reusing an old one revokes every session (theft detection)', async () => {
  const u = await t.register();
  const r1 = await t.api('POST', '/auth/refresh', { body: { refresh_token: u.refresh } });
  assert.equal(r1.status, 200);
  const reuse = await t.api('POST', '/auth/refresh', { body: { refresh_token: u.refresh } });
  assert.equal(reuse.status, 401);
  const after = await t.api('GET', '/users/me', { token: r1.json.access_token });
  assert.equal(after.status, 401, 'the legitimate session is also revoked after reuse');
});

test('logout ends the session; list and revoke devices', async () => {
  const u = await t.register();
  const s = await t.api('GET', '/users/me/sessions', { token: u.token });
  assert.equal(s.json.sessions.length, 1); assert.equal(s.json.sessions[0].current, true);
  await t.api('POST', '/auth/logout', { token: u.token });
  assert.equal((await t.api('GET', '/users/me', { token: u.token })).status, 401);
});

test('unauthenticated and forged tokens are rejected', async () => {
  assert.equal((await t.api('GET', '/users/me')).status, 401);
  assert.equal((await t.api('GET', '/users/me', { token: 'abc.def.ghi' })).status, 401);
  assert.equal((await t.api('GET', '/admin/dashboard')).status, 401);
});

test('staff sign-in requires password AND a valid TOTP; repeated failures lock the account', async () => {
  const s = await t.staff('finance_officer');
  const noTotp = await t.api('POST', '/auth/staff/login', { body: { email: s.email, password: s.password, totp: '000000' } });
  assert.equal(noTotp.status, 401);
  const wrongPw = await t.api('POST', '/auth/staff/login', { body: { email: s.email, password: 'nope-nope-nope', totp: t.crypto.totpAt(s.totpSecret) } });
  assert.equal(wrongPw.status, 401);
  assert.equal(noTotp.json.error.message, wrongPw.json.error.message, 'no hint which factor failed');
  for (let i = 0; i < 4; i++) await t.api('POST', '/auth/staff/login', { body: { email: s.email, password: 'bad', totp: '000000' } });
  const locked = await t.api('POST', '/auth/staff/login', { body: { email: s.email, password: s.password, totp: t.crypto.totpAt(s.totpSecret) } });
  assert.equal(locked.status, 423);
});

test('a passenger account can never sign in through the staff endpoint', async () => {
  const email = 'pass@test.local';
  const seed = await import('../src/seed.ts');
  const u = await seed.createStaff(email, 'CorrectHorse-Battery-9', 'passenger');
  const r = await t.api('POST', '/auth/staff/login', { body: { email, password: 'CorrectHorse-Battery-9', totp: t.crypto.totpAt(u.totpSecret) } });
  assert.equal(r.status, 401);
});

test('profile: language, notification prefs, saved places and emergency contacts; privacy requests', async () => {
  const u = await t.register();
  assert.equal((await t.api('PATCH', '/users/me', { token: u.token, body: { preferred_language: 'en', display_name: 'Aline', notif_prefs: { marketing: true } } })).status, 200);
  const me = await t.api('GET', '/users/me', { token: u.token });
  assert.equal(me.json.preferred_language, 'en'); assert.equal(me.json.notif_prefs.marketing, true); assert.equal(me.json.notif_prefs.sms, true);
  assert.equal((await t.api('PATCH', '/users/me', { token: u.token, body: { role: 'super_admin' } })).status, 400, 'unknown/privileged fields are rejected');
  assert.equal((await t.api('POST', '/users/me/places', { token: u.token, body: { label: 'home', name: 'Kimironko', lat: -1.95, lng: 30.12 } })).status, 200);
  assert.equal((await t.api('GET', '/users/me/places', { token: u.token })).json.places.length, 1);
  assert.equal((await t.api('POST', '/users/me/emergency-contacts', { token: u.token, body: { name: 'Mum', phone: '0788111222' } })).status, 200);
  const del = await t.api('POST', '/users/me/privacy-requests', { token: u.token, body: { kind: 'deletion' } });
  assert.equal(del.status, 200);
  assert.equal((await t.api('POST', '/users/me/privacy-requests', { token: u.token, body: { kind: 'deletion' } })).status, 409);
});

test('Kinyarwanda is the default language and notification templates render in it', async () => {
  const u = await t.register();
  const { notify } = await import('../src/services/notify.ts');
  await notify(u.id, 'booking_confirmed', { ref: 'RM-TEST' });
  const n = await t.api('GET', '/notifications', { token: u.token });
  assert.equal(n.json.notifications[0].body, 'Turimo gushakira umushoferi urugendo RM-TEST.');
  await t.api('PATCH', '/users/me', { token: u.token, body: { preferred_language: 'en' } });
  await notify(u.id, 'booking_confirmed', { ref: 'RM-TEST2' });
  const n2 = await t.api('GET', '/notifications', { token: u.token });
  assert.ok(n2.json.notifications.some((x: any) => x.body === 'We are finding a driver for booking RM-TEST2.'));
});

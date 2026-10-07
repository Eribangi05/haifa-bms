import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, makeJpeg, KCC, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const JPEG = makeJpeg();

function multipart(fields: Record<string, string>, file: { name: string; data: Buffer; type: string }) {
  const b = '----rm' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

test('driver onboarding end to end: apply, upload documents, submit, review, approve, go online', async () => {
  const d = await t.register('driver');
  const verifier = await t.staff('driver_verifier');
  const app = await t.api('POST', '/drivers/applications', { token: d.token, body: {
    legal_name: 'Jean Claude Habimana', national_id: '1199080012345678', zone_id: 'kigali', payout_msisdn: '0788123456',
    vehicle: { vehicle_type: 'moto', make: 'Bajaj', model: 'Boxer', color: 'Red', plate: 'RD 123 A', capacity: 1, comfort: false } } });
  assert.equal(app.status, 200);
  // cannot go online before approval
  const early = await t.api('PATCH', '/drivers/me/availability', { token: d.token, body: { online: true } });
  assert.equal(early.status, 403); assert.equal(early.json.error.code, 'not_permitted_to_work');
  // cannot submit with documents missing
  const tooSoon = await t.api('POST', '/drivers/applications/submit', { token: d.token });
  assert.equal(tooSoon.status, 400); assert.equal(tooSoon.json.error.code, 'documents_missing');
  // upload validation: expiry required, fake files rejected, past expiry rejected
  const m1 = multipart({ doc_type: 'national_id' }, { name: 'id.jpg', data: JPEG, type: 'image/jpeg' });
  assert.equal((await t.api('POST', '/drivers/documents', { token: d.token, ...m1 })).json.error.code, 'expiry_required');
  const m2 = multipart({ doc_type: 'national_id', expiry_date: '2099-01-01' }, { name: 'id.jpg', data: Buffer.from('<script>alert(1)</script>'), type: 'image/jpeg' });
  assert.equal((await t.api('POST', '/drivers/documents', { token: d.token, ...m2 })).json.error.code, 'unsupported_file');
  const m3 = multipart({ doc_type: 'national_id', expiry_date: '2001-01-01' }, { name: 'id.jpg', data: JPEG, type: 'image/jpeg' });
  assert.equal((await t.api('POST', '/drivers/documents', { token: d.token, ...m3 })).json.error.code, 'already_expired');
  for (const doc of ['national_id', 'driving_licence', 'vehicle_registration', 'insurance']) {
    const m = multipart({ doc_type: doc, expiry_date: '2099-01-01' }, { name: 'x.jpg', data: JPEG, type: 'image/jpeg' });
    assert.equal((await t.api('POST', '/drivers/documents', { token: d.token, ...m })).status, 200, doc);
  }
  const photo = multipart({ doc_type: 'profile_photo' }, { name: 'p.jpg', data: JPEG, type: 'image/jpeg' });
  assert.equal((await t.api('POST', '/drivers/documents', { token: d.token, ...photo })).status, 200);
  assert.equal((await t.api('POST', '/drivers/applications/submit', { token: d.token })).json.status, 'DOCUMENTS_SUBMITTED');
  // a driver cannot approve themselves, and a passenger cannot see the queue
  const pass = await t.register();
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/decision`, { token: d.token, body: { decision: 'approve' } })).status, 403);
  assert.equal((await t.api('GET', '/admin/drivers', { token: pass.token })).status, 403);
  // verifier: cannot approve while documents are unreviewed
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/start-review`, { token: verifier.token })).status, 200);
  const blocked = await t.api('POST', `/admin/drivers/${d.id}/decision`, { token: verifier.token, body: { decision: 'approve' } });
  assert.equal(blocked.status, 409); assert.equal(blocked.json.error.code, 'documents_not_approved');
  const detail = await t.api('GET', `/admin/drivers/${d.id}`, { token: verifier.token });
  assert.ok(detail.json.documents.every((x: any) => x.url.includes('token=')), 'documents are served via signed expiring links');
  // rejecting needs a note; resubmit request works
  const noNote = await t.api('POST', `/admin/documents/${detail.json.documents[0].id}/review`, { token: verifier.token, body: { decision: 'rejected' } });
  assert.equal(noNote.status, 400);
  for (const doc of detail.json.documents) assert.equal((await t.api('POST', `/admin/documents/${doc.id}/review`, { token: verifier.token, body: { decision: 'approved' } })).status, 200);
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/decision`, { token: verifier.token, body: { decision: 'approve' } })).status, 200);
  const on = await t.api('PATCH', '/drivers/me/availability', { token: d.token, body: { online: true } });
  assert.equal(on.status, 200);
  const hist = await t.db.q<any>('select to_status from driver_status_history where driver_id=$1 order by id', [d.id]);
  assert.deepEqual(hist.map((h: any) => h.to_status), ['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW', 'APPROVED']);
  const audit = await t.db.q1<any>("select count(*)::int n from audit_logs where entity_type='driver' and entity_id=$1", [d.id]);
  assert.ok(audit.n >= 3);
});

test('signed document links expire and cannot be forged', async () => {
  const { signFileToken, verifyFileToken } = await import('../src/util/crypto.ts');
  const key = 'docs/11111111-1111-1111-1111-111111111111.jpg';
  assert.ok(verifyFileToken(key, signFileToken(key, 60)));
  assert.ok(!verifyFileToken(key, signFileToken(key, -5)));
  assert.ok(!verifyFileToken('docs/22222222-2222-2222-2222-222222222222.jpg', signFileToken(key, 60)));
  const r = await t.api('GET', `/files/${key}?token=1.deadbeef`);
  assert.equal(r.status, 403);
  const traversal = await t.api('GET', `/files/..%2F..%2Fetc%2Fpasswd?token=1.x`);
  assert.ok([400, 403, 404].includes(traversal.status));
});

test('expired mandatory document makes a driver non-dispatchable immediately and forces them offline', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  assert.equal((await t.estimate(p.token, { service_id: 'moto' })).json.options[0].available, true);
  await t.db.q("update driver_documents set expiry_date = current_date - 1 where driver_id=$1 and doc_type='insurance'", [d.id]);
  const e = await t.estimate(p.token, { service_id: 'moto' });
  assert.equal(e.json.options[0].available, false, 'expired insurance: not dispatchable even though the driver is still online');
  const { refreshEligibility } = await import('../src/services/drivers.ts');
  await refreshEligibility(d.id);
  const st = await t.api('GET', '/drivers/me/status', { token: d.token });
  assert.equal(st.json.profile.status, 'EXPIRED_INELIGIBLE'); assert.equal(st.json.profile.is_online, false);
  assert.ok(st.json.permission.expired_documents.includes('insurance'));
  assert.equal((await t.api('PATCH', '/drivers/me/availability', { token: d.token, body: { online: true } })).status, 403);
  // new approved document restores eligibility
  await t.db.q("update driver_documents set expiry_date = '2099-01-01' where driver_id=$1 and doc_type='insurance'", [d.id]);
  await refreshEligibility(d.id);
  assert.equal((await t.api('GET', '/drivers/me/status', { token: d.token })).json.profile.status, 'APPROVED');
});

test('expiry reminders go out once per threshold', async () => {
  const d = await t.driver({ vehicle: 'moto', online: false });
  await t.db.q("update driver_documents set expiry_date = current_date + 6 where driver_id=$1 and doc_type='insurance'", [d.id]);
  const { expiryReminders } = await import('../src/services/drivers.ts');
  assert.equal(await expiryReminders(), 1);
  assert.equal(await expiryReminders(), 0, 'not repeated');
  const n = await t.api('GET', '/notifications', { token: d.token });
  assert.ok(n.json.notifications.some((x: any) => x.template_key === 'doc_expiry'));
});

test('suspended driver is removed from dispatch and cannot accept; reinstatement restores', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const admin = await t.staff('super_admin');
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/decision`, { token: admin.token, body: { decision: 'suspend' } })).status, 400, 'reason required');
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/decision`, { token: admin.token, body: { decision: 'suspend', reason: 'Safety complaint under investigation' } })).status, 200);
  const acc = await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  assert.ok([403, 409].includes(acc.status), 'pending offer was cancelled');
  assert.equal((await t.api('PATCH', '/drivers/me/availability', { token: d.token, body: { online: true } })).status, 403);
  assert.equal((await t.api('POST', `/admin/drivers/${d.id}/decision`, { token: admin.token, body: { decision: 'reinstate' } })).status, 200);
  assert.equal((await t.api('PATCH', '/drivers/me/availability', { token: d.token, body: { online: true } })).status, 200);
});

test('availability is not inferred from an old location: stale heartbeat means not dispatchable', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  assert.equal((await t.estimate(p.token, { service_id: 'moto' })).json.options[0].available, true);
  await t.db.q("update driver_profiles set last_seen_at = now() - interval '5 minutes', last_location_at = now() - interval '5 minutes' where user_id=$1", [d.id]);
  assert.equal((await t.estimate(p.token, { service_id: 'moto' })).json.options[0].available, false);
  assert.ok(d);
});

test('location updates: stale, future and teleporting points are rejected; going offline during a trip is blocked', async () => {
  const d = await t.driver({ vehicle: 'moto' });
  const old = await t.api('POST', '/drivers/me/location', { token: d.token, body: { ...KCC, recorded_at: new Date(Date.now() - 3600_000).toISOString() } });
  assert.equal(old.json.accepted, false);
  const future = await t.api('POST', '/drivers/me/location', { token: d.token, body: { ...KCC, recorded_at: new Date(Date.now() + 3600_000).toISOString() } });
  assert.equal(future.status, 400);
  const jump = await t.api('POST', '/drivers/me/location', { token: d.token, body: { lat: KCC.lat + 0.5, lng: KCC.lng } });
  assert.equal(jump.json.accepted, false); assert.equal(jump.json.reason, 'implausible_jump');
  const p = await t.register(); const { res } = await t.book(p.token);
  await t.api('POST', `/bookings/${res.json.booking.id}/accept`, { token: d.token });
  const off = await t.api('PATCH', '/drivers/me/availability', { token: d.token, body: { online: false } });
  assert.equal(off.status, 409);
});

test('vehicle suitability: a moto never receives a car job; capacity and comfort tier are respected', async () => {
  const p = await t.register(); await t.driver({ vehicle: 'moto' });
  const carOnly = await t.estimate(p.token, { service_id: 'standard' });
  assert.equal(carOnly.json.options[0].available, false);
  await t.driver({ vehicle: 'car', capacity: 4 });
  assert.equal((await t.estimate(p.token, { service_id: 'standard' })).json.options[0].available, true);
  await t.db.q("update service_categories set enabled=true where id='family'");
  await t.db.q("update zone_services set enabled=true where service_id='family'");
  assert.equal((await t.estimate(p.token, { service_id: 'family' })).json.options[0].available, false, 'no minivan with 6+ seats online');
  await t.driver({ vehicle: 'minivan', capacity: 7 });
  assert.equal((await t.estimate(p.token, { service_id: 'family' })).json.options[0].available, true);
  await t.db.q("update service_categories set enabled=false where id='family'");
});

test('dispatcher can manually assign and reassign; ineligible drivers are refused', async () => {
  const p = await t.register(); const d1 = await t.driver({ vehicle: 'moto' }); const d2 = await t.driver({ vehicle: 'moto', at: { lat: KCC.lat + 0.01, lng: KCC.lng } });
  const offline = await t.driver({ vehicle: 'moto', online: false });
  const disp = await t.staff('dispatcher'); const { res } = await t.book(p.token); const id = res.json.booking.id;
  const bad = await t.api('POST', `/admin/bookings/${id}/assign`, { token: disp.token, body: { driver_id: offline.id, reason: 'try offline driver' } });
  assert.equal(bad.status, 409);
  const okA = await t.api('POST', `/admin/bookings/${id}/assign`, { token: disp.token, body: { driver_id: d2.id, reason: 'Nearest driver declined by phone' } });
  assert.equal(okA.status, 200); assert.equal(okA.json.status, 'DRIVER_ASSIGNED');
  const re = await t.api('POST', `/admin/bookings/${id}/assign`, { token: disp.token, body: { driver_id: d1.id, reason: 'Driver 2 vehicle breakdown' } });
  assert.equal(re.status, 200);
  assert.equal((await t.db.q1<any>('select driver_id from bookings where id=$1', [id])).driver_id, d1.id);
  const ev = await t.db.q<any>("select reason from booking_events where booking_id=$1 and to_status='DRIVER_ASSIGNED'", [id]);
  assert.ok(ev.some((e: any) => /manual assignment/.test(e.reason)));
  assert.equal((await t.api('POST', `/admin/bookings/${id}/assign`, { token: p.token, body: { driver_id: d2.id, reason: 'hack attempt' } })).status, 403);
});

test('an existing passenger can enroll as a driver without gaining any dispatch rights', async () => {
  const u = await t.register();
  assert.equal((await t.api('GET', '/drivers/me/status', { token: u.token })).status, 403);
  assert.equal((await t.api('POST', '/drivers/enroll', { token: u.token })).status, 200);
  // role claims live in the JWT: sign in again to pick up the driver role
  const o = await t.api('POST', '/auth/otp/request', { body: { phone: u.phone } });
  const v = await t.api('POST', '/auth/otp/verify', { body: { phone: u.phone, code: o.json.dev_code } });
  assert.ok(v.json.roles.includes('driver') && v.json.roles.includes('passenger'));
  const st = await t.api('GET', '/drivers/me/status', { token: v.json.access_token });
  assert.equal(st.json.profile.status, 'APPLICATION_STARTED'); assert.equal(st.json.permission.can_work, false);
  assert.equal((await t.api('PATCH', '/drivers/me/availability', { token: v.json.access_token, body: { online: true } })).status, 403);
});

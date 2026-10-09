import { chromium } from 'playwright-core';
import { visibleOnly } from './visible.mjs';
import pg from 'pg';
// Round 5 end-to-end test through the real screens (react-native-web): rider <-> driver chat with unread badge and number privacy, in-app navigation,
// the saved-copy note with no signal, referral tiers, the remote off-switch banner, the daily goal, and the vehicle application of an approved Abasare driver.
// Usage: node e2e/round5-e2e.mjs <screenshot-dir>   (prerequisites as app-e2e.mjs; the API needs the road graph: MAP_PROVIDER does not matter for navigation)
const API = (process.env.API_ORIGIN ?? 'http://localhost:8080') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' }); await db.connect();
await db.query('delete from otp_challenges'); await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('SEARCHING_DRIVER','REQUESTED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','PAYMENT_PENDING')"); await db.query('update driver_profiles set is_online=false');
await db.query("insert into system_settings(key,value) values ('fraud.cancel_loop_count','1000') on conflict (key) do update set value=excluded.value");
const rnd = () => String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
const pphone = '+2507885' + rnd(), dphone = '+2507884' + rnd(), aphone = '+2507883' + rnd();
const reg = async (phone, role) => { const o = await call('POST', '/auth/otp/request', { body: { phone } }); const v = await call('POST', '/auth/otp/verify', { body: { phone, code: o.j.dev_code, role }, h: { 'x-device-id': 'r5-' + Math.random() } }); return { t: v.j.access_token, id: v.j.user.id }; };
const approve = async (u, vehicleType, plate) => {
  await db.query("update driver_profiles set status='APPROVED', legal_name='Round Five', zone_id='kigali' where user_id=$1", [u.id]); await db.query("update users set display_name='Round Five' where id=$1", [u.id]);
  if (vehicleType) await db.query("insert into vehicles(driver_id,vehicle_type,make,model,color,plate,capacity,status) values ($1,$2,'TVS','HLX','Blue',$3,1,'approved')", [u.id, vehicleType, plate]);
  for (const r of (await db.query("select doc_type, requires_expiry from document_requirements where vehicle_type=$1 and mandatory", [vehicleType ?? 'abasare'])).rows)
    await db.query("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [u.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
};
const passenger = await reg(pphone, 'passenger'), driver = await reg(dphone, 'driver'), abasareDriver = await reg(aphone, 'driver');
await approve(driver, 'moto', 'RE' + (100 + Math.floor(Math.random() * 899)) + 'R');
await approve(abasareDriver, null, null);
await db.query("update driver_profiles set abasare_status='approved', abasare_skills='{\"classes\":[\"car\"],\"transmissions\":[\"manual\"]}' where user_id=$1", [abasareDriver.id]);
await call('PATCH', '/drivers/me/availability', { t: driver.t, body: { online: true } });
await call('POST', '/drivers/me/location', { t: driver.t, body: { lat: -1.954, lng: 30.0927 } });

const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const mk = async () => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] }); const page = visibleOnly(await ctx.newPage()); return { ctx, page }; };
const P = await mk(), D = await mk(), A = await mk(); const errors = [];
for (const x of [P, D, A]) { x.page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); }
const shot = (x, n) => x.page.screenshot({ path: `${OUT}/r5-${n}.png` });
const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); await shot(P, 'FAIL-p-' + name.replace(/\W+/g, '_')); await shot(D, 'FAIL-d-' + name.replace(/\W+/g, '_')); await shot(A, 'FAIL-a-' + name.replace(/\W+/g, '_')); throw e; } };
const login = async (x, phone) => {
  await db.query('delete from otp_challenges'); const page = x.page; await page.goto(WEB); await page.getByText('English', { exact: true }).click(); await page.getByText('Continue', { exact: true }).click();
  await page.getByPlaceholder('07X XXX XXXX').fill('0' + phone.slice(4)); await page.getByText('Send code', { exact: true }).click();
  const code = (await page.getByText(/Test build: code: \d{6}/).textContent()).match(/\d{6}/)[0];
  await page.getByPlaceholder('••••••').fill(code); await page.getByText('Verify', { exact: true }).click(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 });
};
const driverMode = async (x) => { await x.page.getByTestId('tab-account').click(); await x.page.getByTestId('acc-mode').click(); await x.page.getByTestId('tab-home').waitFor({ timeout: 20000 }); };

await step('rider, driver and Abasare driver sign in through the UI', async () => { await login(P, pphone); await login(D, dphone); await driverMode(D); await login(A, aphone); await driverMode(A); });
let bid;
await step('a trip is booked and accepted (API); the driver screen shows the job', async () => {
  const e = await call('POST', '/fares/estimate', { t: passenger.t, body: { pickup: { lat: -1.954, lng: 30.0927 }, dest: { lat: -1.9496, lng: 30.1262 }, service_id: 'moto' } });
  const q = e.j.options[0]; if (!q.quote_id) throw new Error('moto not available: ' + JSON.stringify(q.reason));
  bid = (await call('POST', '/bookings', { t: passenger.t, h: { 'idempotency-key': 'r5-' + Date.now() }, body: { quote_id: q.quote_id, payment_method: 'cash', pickup_name: 'KCC', dest_name: 'Kimironko' } })).j.booking.id;
  await call('POST', `/bookings/${bid}/accept`, { t: driver.t });
  await D.page.getByTestId('drv-chat').waitFor({ timeout: 25000 }); await shot(D, '1-driver-job');
});
await step('rider opens the chat and sends a quick reply', async () => {
  await P.page.getByText('Open trip', { exact: true }).click({ timeout: 40000 });
  await P.page.getByTestId('pax-chat').waitFor({ timeout: 30000 }); await P.page.getByTestId('pax-chat').click();
  await P.page.getByText('I am coming', { exact: true }).click(); await P.page.getByText('I am coming', { exact: true }).nth(1).waitFor({ timeout: 15000 }).catch(() => {}); await shot(P, '2-rider-chat');
  const n = (await db.query('select count(*)::int n from trip_messages where booking_id=$1', [bid])).rows[0].n; if (n !== 1) throw new Error('messages stored: ' + n);
});
await step('driver sees the unread badge, opens the chat, replies and shares the number', async () => {
  await D.page.getByText(/Messages · 1 new|Chat · 1 new|1 new/).first().waitFor({ timeout: 20000 }); await shot(D, '3-driver-unread');
  await D.page.getByTestId('drv-chat').click(); await D.page.getByText('I am coming', { exact: false }).first().waitFor({ timeout: 10000 });
  await D.page.getByText('I am at the entrance', { exact: true }).click(); await D.page.waitForTimeout(800);
  await D.page.getByTestId('chat-share').click(); await D.page.waitForTimeout(800);
  const r = (await db.query('select driver_shared_phone, passenger_shared_phone from bookings where id=$1', [bid])).rows[0];
  if (!r.driver_shared_phone || r.passenger_shared_phone) throw new Error('sharing flags ' + JSON.stringify(r)); await shot(D, '4-driver-chat');
});
await step('rider now sees the driver number (and the driver still does not see the rider number)', async () => {
  await P.page.waitForTimeout(5000); await P.page.getByTestId('chat-call').waitFor({ timeout: 20000 }); await shot(P, '5-rider-call');
  const dv = await call('GET', `/bookings/${bid}`, { t: driver.t }); if (dv.j.contact_phone) throw new Error('driver sees the rider number');
});
await step('driver opens in-app navigation: next manoeuvre and time left', async () => {
  await D.page.getByText('Back', { exact: true }).last().click().catch(() => {}); await D.page.waitForTimeout(500);
  await call('POST', '/drivers/me/location', { t: driver.t, body: { lat: -1.9700, lng: 30.0620 } });   // about 4 km from the pickup so there is a route to follow
  await D.page.getByTestId('drv-nav').click(); await D.page.getByTestId('nav-banner').waitFor({ timeout: 30000 }); await D.page.getByTestId('nav-remaining').waitFor({ timeout: 10000 });
  const txt = await D.page.getByTestId('nav-banner').innerText(); if (!/Turn|Bear|Continue|Start|Sharp|U-turn|arrived|\d+ m|km/.test(txt)) throw new Error('banner text: ' + txt); await D.page.waitForTimeout(3000); await shot(D, '6-navigation');
});
await step('daily goal card fills as a goal is chosen', async () => {
  await D.page.getByText('Close', { exact: true }).first().click().catch(() => {}); await D.page.waitForTimeout(500);
  await D.page.getByTestId('goal-set').scrollIntoViewIfNeeded().catch(() => {}); await D.page.getByTestId('goal-set').click(); await D.page.getByText('5,000', { exact: false }).first().click();
  await D.page.getByTestId('goal-state').waitFor({ timeout: 10000 }); await shot(D, '7-goal');
});
await step('referral screen shows the ambassador level and progress', async () => {
  await P.page.getByText('Back', { exact: true }).last().click().catch(() => {}); await P.page.waitForTimeout(700);
  await P.page.getByText('Back', { exact: true }).last().click().catch(() => {}); await P.page.waitForTimeout(700);
  await P.page.getByTestId('tab-account').click(); await P.page.getByTestId('open-invite').click(); await P.page.getByText('Bronze ambassador').waitFor({ timeout: 20000 }); await shot(P, '8-referral');
  await P.page.getByText(/invitations to reach Silver ambassador/).waitFor({ timeout: 5000 });
});
await step('remote off-switch: paused requests show a banner on the booking tab', async () => {
  await db.query("update feature_flags set enabled=false, disabled_message='Back at 10:00.' where key='booking.requests'");
  try { await P.page.reload(); await P.page.getByText('Driver on the way', { exact: false }).first().waitFor({ timeout: 25000 }); await P.page.getByText('Back', { exact: true }).last().click(); await P.page.getByTestId('tab-book').click(); await P.page.getByText('Allow location', { exact: true }).click({ timeout: 8000 }).catch(() => {}); await P.page.getByText(/New ride requests are paused for now\. Back at 10:00\./).waitFor({ timeout: 20000 }); await shot(P, '9-paused'); }
  finally { await db.query("update feature_flags set enabled=true, disabled_message=null where key='booking.requests'"); }
});
await step('saved copy: with the API unreachable the Trips tab shows the last known list and a note', async () => {
  await P.page.reload(); await P.page.getByText('Driver on the way', { exact: false }).first().waitFor({ timeout: 25000 }); await P.page.getByText('Back', { exact: true }).last().click(); await P.page.getByTestId('tab-trips').click(); await P.page.getByText(/KCC|Kimironko|Cash|RWF|Moto/).first().waitFor({ timeout: 20000 }); await P.page.waitForTimeout(1500);
  await P.ctx.route('**/api/v1/**', (r) => r.abort());
  await P.page.reload(); await P.page.waitForTimeout(4000);
  await P.page.getByTestId('tab-trips').click({ timeout: 30000 }); await P.page.getByText(/Saved copy from/).first().waitFor({ timeout: 25000 }); await shot(P, '10-saved-copy');
  await P.ctx.unroute('**/api/v1/**');
});
await step('approved Abasare driver adds a vehicle: save, documents, send for review; staff approve', async () => {
  const pg = A.page; await pg.getByTestId('tab-car').click(); await pg.getByText('Vehicle', { exact: true }).first().click(); await pg.getByTestId('pf-add-vehicle').click(); await pg.getByText('Add my vehicle', { exact: true }).first().waitFor({ timeout: 20000 });
  await pg.getByText('Car', { exact: true }).first().click(); await pg.getByLabel('Make').fill('Toyota'); await pg.getByLabel('Model').fill('Vitz'); await pg.getByLabel('Colour').fill('White'); await pg.getByLabel('Plate number').fill('RAD' + (100 + Math.floor(Math.random() * 899)) + 'V');
  await pg.getByTestId('va-save').click(); await pg.getByText(/Details saved/).waitFor({ timeout: 20000 }); await shot(A, '11-vehicle-saved');
  for (const r of (await db.query("select doc_type, requires_expiry from document_requirements where vehicle_type='car' and mandatory")).rows)
    await db.query("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) select $1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'pending' where not exists (select 1 from driver_documents where driver_id=$1 and doc_type=$2 and not superseded)", [abasareDriver.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
  await pg.waitForTimeout(9000); await pg.getByTestId('va-submit').click(); await pg.getByText(/Being reviewed/).waitFor({ timeout: 20000 });
  const v = (await db.query('select id, review_requested_at from vehicles where driver_id=$1', [abasareDriver.id])).rows[0]; if (!v.review_requested_at) throw new Error('not sent for review');
  await db.query("update driver_documents set review_status='approved' where driver_id=$1", [abasareDriver.id]);
  await db.query("update vehicles set status='approved' where id=$1", [v.id]);
  await pg.waitForTimeout(9000); await shot(A, '12-vehicle-approved');
});
console.log('browser page errors:', JSON.stringify(errors));
await br.close(); await db.query("delete from system_settings where key='fraud.cancel_loop_count'"); await db.end();

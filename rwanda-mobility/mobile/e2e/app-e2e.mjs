import { chromium } from 'playwright-core';
import { visibleOnly } from './visible.mjs';
// End-to-end test of the real React Native screens (via react-native-web) against a running backend.
// Prereqs: backend running with OTP_DEV_ECHO=true MOMO_MODE=simulator on $API_ORIGIN (default http://localhost:8080),
//          web build served on $WEB_ORIGIN (default http://localhost:8081):
//   EXPO_PUBLIC_API_URL=http://localhost:8080 npx expo export --platform web --output-dir /tmp/rm-web && (cd /tmp/rm-web && python3 -m http.server 8081)
// Usage: node e2e/app-e2e.mjs <screenshot-dir>      (env: DATABASE_URL, CHROMIUM_PATH)
// NOTE: it inserts an approved test driver straight into the database (the approval path itself is covered by backend tests).
import pg from 'pg';
const API = (process.env.API_ORIGIN ?? 'http://localhost:8080') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' }); await db.connect();
await db.query("delete from otp_challenges"); await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('SEARCHING_DRIVER','REQUESTED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','PAYMENT_PENDING')"); await db.query("update driver_profiles set is_online=false");
const phone = '+2507889' + String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
// --- driver via API
const dph = '+2507888' + String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
const o = await call('POST', '/auth/otp/request', { body: { phone: dph } });
const v = await call('POST', '/auth/otp/verify', { body: { phone: dph, code: o.j.dev_code, role: 'driver' }, h: { 'x-device-id': 'e2e-drv-' + Math.random() } });
const drv = { t: v.j.access_token, id: v.j.user.id };
await db.query("update users set display_name='Eric Mugisha' where id=$1", [drv.id]);
await db.query("update driver_profiles set status='APPROVED', legal_name='Eric Mugisha', zone_id='kigali' where user_id=$1", [drv.id]);
await db.query("insert into vehicles(driver_id,vehicle_type,make,model,color,plate,capacity,status) values ($1,'moto','TVS','HLX','Blue',$2,1,'approved')", [drv.id, 'RE' + Math.floor(100 + Math.random() * 899) + 'B']);
const plate = (await db.query('select plate from vehicles where driver_id=$1', [drv.id])).rows[0].plate;
for (const r of (await db.query("select doc_type, requires_expiry from document_requirements where vehicle_type='moto' and mandatory")).rows)
  await db.query("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [drv.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
await call('PATCH', '/drivers/me/availability', { t: drv.t, body: { online: true } });
await call('POST', '/drivers/me/location', { t: drv.t, body: { lat: -1.954, lng: 30.0927 } });

const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] });
const page = visibleOnly(await ctx.newPage()); const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
const shot = (n) => page.screenshot({ path: `${OUT}/app-${n}.png` });
const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); await shot('FAIL-' + name.replace(/\W+/g, '_')); throw e; } };

await step('welcome (Kinyarwanda default)', async () => { await page.goto(WEB); await page.getByText('Hitamo ururimi').waitFor({ timeout: 20000 }); await shot('1-welcome'); });
await step('switch language to English and back', async () => { await page.getByText('English', { exact: true }).click(); await page.getByText('Choose your language').waitFor(); await page.getByText('Kinyarwanda', { exact: true }).click(); await page.getByText('Hitamo ururimi').waitFor(); });
await step('phone screen', async () => { await page.getByText('Komeza', { exact: true }).click(); await page.getByText('Nomero ya telefone').first().waitFor(); await page.getByPlaceholder('07X XXX XXXX').fill('0' + phone.slice(4)); await page.getByText('Ohereza kode', { exact: true }).click(); });
let code;
await step('otp screen shows test code and verifies', async () => { const t = await page.getByText(/Ikizamini: kode: \d{6}/).textContent(); code = t.match(/\d{6}/)[0]; await shot('2-otp'); await page.getByPlaceholder('••••••').fill(code); await page.getByText('Emeza', { exact: true }).click(); });
await step('location consent then home', async () => { await page.getByTestId('tabbar').waitFor({ timeout: 20000 }); await shot('3a-home-overview'); await page.getByTestId('tab-book').click(); await page.getByText('Uruhushya rwo kumenya aho uri').waitFor(); await shot('3-consent'); await page.getByText('Emera', { exact: true }).click(); await page.getByText('Ujya he?').waitFor(); await page.waitForTimeout(1500); await shot('4-home'); });
await step('pick destination from popular landmarks', async () => { await page.getByText('Isoko rya Kimironko', { exact: true }).last().click(); await page.waitForTimeout(400); await shot('5-dest'); });
await step('prices screen: moto available, honest unavailability for car, breakdown', async () => { await page.getByText('Reba ibiciro', { exact: true }).click(); await page.getByText('Hitamo urugendo').waitFor(); await page.getByText('Uko igiciro kigizwe').waitFor({ timeout: 20000 }); await page.getByText('Nta mushoferi uboneka').first().waitFor(); await shot('6-options'); });
await step('confirm request -> searching', async () => { await page.getByText('Emeza ubusabe', { exact: true }).click(); await page.getByText('Turimo gushaka umushoferi…').waitFor({ timeout: 20000 }); await shot('7-searching'); });
let bookingId;
await step('driver (API) sees offer with earnings and accepts', async () => { for (let i = 0; i < 20; i++) { const r = await call('GET', '/drivers/me/offers', { t: drv.t }); if (r.j.offers.length) { bookingId = r.j.offers[0].booking_id; if (!(r.j.offers[0].driver_net > 0)) throw new Error('no earnings shown'); break; } await new Promise((r) => setTimeout(r, 500)); } if (!bookingId) throw new Error('no offer'); const a = await call('POST', `/bookings/${bookingId}/accept`, { t: drv.t, body: {} }); if (a.s !== 200) throw new Error('accept ' + JSON.stringify(a.j)); });
let pin;
await step('passenger UI shows driver, plate and trip PIN', async () => { await page.getByText('Umushoferi yabonetse, ari mu nzira').waitFor({ timeout: 15000 }); await page.getByText(plate).first().waitFor(); const t = await page.getByText('PIN y\'urugendo').locator('xpath=following-sibling::*[1]').textContent(); pin = t.trim(); if (!/^\d{4}$/.test(pin)) throw new Error('pin not shown: ' + t); await shot('8-driver-assigned'); });
await step('driver arrives, starts with the PIN shown to the passenger', async () => { await call('POST', '/drivers/me/location', { t: drv.t, body: { lat: -1.9539, lng: 30.0927 } }); const ar = await call('POST', `/bookings/${bookingId}/arrived`, { t: drv.t, body: {} }); if (ar.s !== 200) throw new Error('arrive ' + JSON.stringify(ar.j)); await page.getByText('Umushoferi yahageze').first().waitFor({ timeout: 15000 }); const bad = await call('POST', `/bookings/${bookingId}/start`, { t: drv.t, body: { pin: pin === '1234' ? '4321' : '1234' } }); if (bad.s !== 400) throw new Error('wrong PIN accepted'); const st = await call('POST', `/bookings/${bookingId}/start`, { t: drv.t, body: { pin } }); if (st.s !== 200) throw new Error('start ' + JSON.stringify(st.j)); await page.getByText('Urugendo rurimo').first().waitFor({ timeout: 15000 }); await shot('9-in-progress'); });
await step('SOS modal: red actions and honest wording', async () => { await page.getByText('SOS', { exact: true }).first().click(); await page.getByText('Hamagara Polisi 112').waitFor(); await page.getByText('Ohereza SOS', { exact: true }).click(); await page.getByText(/Ntibiremezwa ko hari uwakuvugishije/).waitFor({ timeout: 15000 }); await shot('10-sos'); await page.getByText('Funga', { exact: true }).last().click(); });
let fare;
await step('driver completes; passenger sees final fare and cash due', async () => { const c = await call('POST', `/bookings/${bookingId}/complete`, { t: drv.t, body: {} }); if (c.s !== 200) throw new Error('complete ' + JSON.stringify(c.j)); fare = c.j.final_fare; await page.getByText('Igiciro cya nyuma').waitFor({ timeout: 15000 }); await page.getByText(/Ugomba kwishyura/).waitFor(); await shot('11-pay'); });
await step('driver confirms cash; passenger sees receipt and rates', async () => { const cs = await call('POST', `/bookings/${bookingId}/cash-collected`, { t: drv.t, body: { amount: fare } }); if (cs.j.status !== 'SUCCESS') throw new Error('cash ' + JSON.stringify(cs.j)); await page.getByText('Ubwishyu bwakiriwe').waitFor({ timeout: 15000 }); await page.getByLabel('Inyenyeri 5').click(); await page.getByTestId('cta').click(); await page.getByText('Murakoze! Amanota yawe yabitswe.').waitFor({ timeout: 15000 }); await shot('12-rated'); await page.getByLabel('Subira inyuma').first().click(); });
await step('rating reached the server through the outbox', async () => { await page.waitForTimeout(1500); const r = await db.query("select score from ratings where booking_id=$1", [bookingId]); if (r.rows[0]?.score !== 5) throw new Error('rating missing'); });
await step('history lists the trip', async () => { await page.getByText('Ongera usabe urugendo', { exact: true }).click(); await page.getByTestId('tabbar').waitFor(); await page.getByTestId('tab-trips').click(); await page.getByText(/RM-/).first().waitFor({ timeout: 15000 }); await shot('13-history'); });
await step('wallet and account tabs; profile screen renders', async () => { await page.getByTestId('tab-wallet').click(); await page.getByTestId('wal-row').first().waitFor({ timeout: 15000 }); await shot('14a-wallet'); await page.getByTestId('tab-account').click(); await page.getByTestId('acc-edit').click(); await page.getByText('Abantu wizeye').waitFor(); await shot('14-profile'); });
// offline recovery: booking submitted while the API is unreachable is queued and sent once
await step('offline: booking is queued as "not confirmed", then sent exactly once on reconnect', async () => {
  await page.getByLabel('Subira inyuma').click().catch(() => {}); await page.getByTestId('tab-book').click(); await page.getByText('Ujya he?').last().waitFor();
  await page.getByText('Isoko rya Kimironko', { exact: true }).last().click(); await page.getByText('Reba ibiciro', { exact: true }).click(); await page.getByText('Uko igiciro kigizwe').waitFor({ timeout: 20000 });
  await ctx.route('**/api/v1/bookings', (r) => (r.request().method() === 'POST' ? r.abort('failed') : r.continue()));
  await page.getByText('Emeza ubusabe', { exact: true }).click();
  await page.getByText(/Ntibiremezwa/).first().waitFor({ timeout: 30000 }); await shot('15-offline-pending');
  const before = (await db.query("select count(*)::int n from bookings where status='SEARCHING_DRIVER'")).rows[0].n;
  await ctx.unroute('**/api/v1/bookings');
  for (let i = 0; i < 40; i++) { const n = (await db.query("select count(*)::int n from bookings where status='SEARCHING_DRIVER'")).rows[0].n; if (n === before + 1) break; await page.waitForTimeout(1000); if (i === 39) throw new Error('queued booking never sent'); }
  await page.getByText('Turimo gushaka umushoferi…').waitFor({ timeout: 30000 }); await shot('16-after-reconnect');
  await page.waitForTimeout(2500); const n2 = (await db.query("select count(*)::int n from bookings where status='SEARCHING_DRIVER'")).rows[0].n; if (n2 !== before + 1) throw new Error('duplicate booking created');
});
console.log('browser errors (excluding map tiles / third-party):', JSON.stringify(errors.filter((e) => !/tile|leaflet|unpkg|ERR_|Failed to load resource|net::|Access-Control|CORS/i.test(e))));
await br.close(); await db.end();

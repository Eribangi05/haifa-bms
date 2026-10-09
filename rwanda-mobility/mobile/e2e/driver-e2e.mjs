// Driver-side end-to-end test through the real React Native screens (react-native-web). See app-e2e.mjs for prerequisites.
// Usage: node e2e/driver-e2e.mjs <screenshot-dir> <path-to-a-small.jpg>
import { pickDate, pickTime } from './pickers.mjs';
import { chromium } from 'playwright-core';
import { visibleOnly } from './visible.mjs';
import pg from 'pg';
const API = (process.env.API_ORIGIN ?? 'http://localhost:8080') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp', JPG = process.argv[3] ?? '/tmp/doc.jpg';
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' }); await db.connect();
await db.query('delete from otp_challenges'); await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('SEARCHING_DRIVER','REQUESTED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','PAYMENT_PENDING')"); await db.query('update driver_profiles set is_online=false');
const rnd = () => String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
const dphone = '+2507887' + rnd(), pphone = '+2507886' + rnd();
// staff verifier (via DB helper-free API: create through seed util is backend-only, so use an existing super admin when provided)
const reg = async (phone) => { const o = await call('POST', '/auth/otp/request', { body: { phone } }); const v = await call('POST', '/auth/otp/verify', { body: { phone, code: o.j.dev_code }, h: { 'x-device-id': 'e2e-' + Math.random() } }); return { t: v.j.access_token, id: v.j.user.id }; };
const passenger = await reg(pphone);

const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] });
const page = visibleOnly(await ctx.newPage()); const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 200)));
const shot = (n) => page.screenshot({ path: `${OUT}/drv-${n}.png` });
const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); await shot('FAIL-' + name.replace(/\W+/g, '_')); throw e; } };

await step('sign up through the UI (English)', async () => {
  await page.goto(WEB); await page.getByText('English', { exact: true }).click(); await page.getByText('Continue', { exact: true }).click();
  await page.getByPlaceholder('07X XXX XXXX').fill('0' + dphone.slice(4)); await page.getByText('Send code', { exact: true }).click();
  const code = (await page.getByText(/Test build: code: \d{6}/).textContent()).match(/\d{6}/)[0];
  await page.getByPlaceholder('••••••').fill(code); await page.getByText('Verify', { exact: true }).click();
  await page.getByTestId('tabbar').waitFor({ timeout: 20000 });
});
await step('profile -> Start driver application', async () => { await page.getByTestId('tab-account').click(); await page.getByTestId('acc-become').click(); await page.getByText('Driver application', { exact: true }).first().waitFor({ timeout: 20000 }); await shot('1-application'); });
const plate = 'RD' + (100 + Math.floor(Math.random() * 899)) + 'C';
await step('fill and save application', async () => {
  await page.getByTestId('choose-own').click(); await page.getByLabel('Full legal name').fill('Alice Uwimana'); await page.getByLabel('National ID number').fill('1199080012345678');
  await page.getByLabel('Make').fill('Bajaj'); await page.getByLabel('Model').fill('Boxer'); await page.getByLabel('Colour').fill('Red'); await page.getByLabel('Plate number').fill(plate);
  await page.getByLabel('Payout Mobile Money number').fill('0788123456'); await page.getByText('Save', { exact: true }).click(); await page.getByText('Documents', { exact: true }).waitFor({ timeout: 20000 }); await shot('2-docs');
});
await step('upload every required document through the file picker', async () => {
  const labels = ['National ID', 'Driving licence', 'Profile photo', 'Vehicle registration', 'Insurance'];
  for (const l of labels) {
    const row = page.locator('div', { has: page.getByText(l, { exact: false }) }).filter({ has: page.getByText('Upload', { exact: true }) }).last();
    await page.getByText(l + ' *', { exact: true }).locator('xpath=ancestor::div[.//div[text()="Upload"]][1]').getByText('Upload', { exact: true }).click();
    if (l !== 'Profile photo') await pickDate(page, 'doc-expiry', '2030-12-31');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose from gallery', { exact: true }).click()]);
    await chooser.setFiles(JPG); await page.waitForTimeout(1500);
  }
  await shot('3-uploaded');
  const n = (await db.query("select count(*)::int n from driver_documents d join users u on u.id=d.driver_id where u.phone=$1", [dphone])).rows[0].n; if (n < 5) throw new Error('documents stored: ' + n);
});
await step('submit for review', async () => { await page.getByText('Submit for review', { exact: true }).click(); await page.getByText('Submitted, waiting for review').waitFor({ timeout: 20000 }); await shot('4-submitted'); });
const driverId = (await db.query('select id from users where phone=$1', [dphone])).rows[0].id;
await step('review: documents + approval (as the verification officer would)', async () => {
  await db.query("update driver_documents set review_status='approved' where driver_id=$1", [driverId]);
  await db.query("update driver_profiles set status='APPROVED' where user_id=$1", [driverId]); await db.query("update vehicles set status='approved' where driver_id=$1", [driverId]);
  await page.getByText('Driver', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => {}); await page.waitForTimeout(11000); await shot('5-approved');
});
await step('driver home: consent, then go online', async () => {
  await page.getByText('Location while online').waitFor({ timeout: 20000 }); await page.getByText('I agree', { exact: true }).click();
  await page.getByText('Go online', { exact: true }).click(); await page.getByText('Online', { exact: true }).first().waitFor({ timeout: 15000 }); await shot('6-online');
  const on = (await db.query('select is_online from driver_profiles where user_id=$1', [driverId])).rows[0].is_online; if (!on) throw new Error('not online in DB');
});
await step('app reports its GPS position (heartbeat)', async () => { for (let i = 0; i < 20; i++) { const r = (await db.query('select last_lat, last_seen_at from driver_profiles where user_id=$1', [driverId])).rows[0]; if (r.last_lat != null) return; await page.waitForTimeout(500); } throw new Error('no location received'); });
let bid;
await step('offer appears with earnings; accept', async () => {
  const e = await call('POST', '/fares/estimate', { t: passenger.t, body: { pickup: { lat: -1.954, lng: 30.0927 }, dest: { lat: -1.9496, lng: 30.1262 }, service_id: 'moto' } });
  const q = e.j.options[0]; if (!q.quote_id) throw new Error('moto not available: ' + JSON.stringify(q.reason));
  const b = await call('POST', '/bookings', { t: passenger.t, h: { 'idempotency-key': 'drv-e2e-' + Date.now() }, body: { quote_id: q.quote_id, payment_method: 'cash', pickup_name: 'KCC', dest_name: 'Kimironko' } }); bid = b.j.booking.id;
  await page.getByText('You earn').waitFor({ timeout: 20000 }); if (!(await page.evaluate(() => (globalThis.__abasareSounds ?? []).some((e) => (e.k ?? e.kind ?? e) === 'offer' || JSON.stringify(e).includes('offer')))))  throw new Error('no offer sound was started'); await shot('7-offer'); await page.getByText('Accept', { exact: true }).click();
  await page.getByText('I am on my way', { exact: true }).waitFor({ timeout: 20000 });
});
await step('en route -> arrived (needs real GPS within 500 m) ', async () => { await page.getByText('I am on my way', { exact: true }).click(); await page.waitForTimeout(800); await page.getByText('I have arrived', { exact: true }).click(); await page.getByText('Enter passenger PIN').waitFor({ timeout: 20000 }); await shot('8-arrived'); });
await step('wrong PIN is refused, correct PIN starts the trip', async () => {
  const pin = (await call('GET', `/bookings/${bid}`, { t: passenger.t })).j.trip_pin; const wrong = pin === '1111' ? '2222' : '1111';
  await page.getByLabel('Enter passenger PIN').fill(wrong); await page.getByText('Start trip', { exact: true }).click(); await page.getByText(/Wrong PIN/).waitFor({ timeout: 10000 });
  await page.getByLabel('Enter passenger PIN').fill(pin); await page.getByText('Start trip', { exact: true }).click(); await page.getByText('Complete trip', { exact: true }).waitFor({ timeout: 20000 }); await shot('9-in-progress');
});
await step('complete and confirm cash', async () => { await page.getByText('Complete trip', { exact: true }).click(); await page.getByText('Confirm cash received', { exact: true }).waitFor({ timeout: 20000 }); await shot('10-collect'); await page.getByText('Confirm cash received', { exact: true }).click(); await page.waitForTimeout(2500);
  const b = (await db.query('select status from bookings where id=$1', [bid])).rows[0].status; if (b !== 'PAYMENT_COMPLETED') throw new Error('status ' + b); });
await step('earnings tab shows the trip, commission and wallet', async () => { await page.getByText('Earnings', { exact: true }).first().click(); await page.getByText('Net earnings').waitFor({ timeout: 20000 }); await page.getByText('Wallet', { exact: true }).first().waitFor(); await shot('11-earnings'); });
await step('go offline', async () => { await page.getByTestId('tab-home').click(); await page.getByText('Go offline', { exact: true }).click(); await page.getByText('Offline', { exact: true }).first().waitFor({ timeout: 15000 }); });
console.log('browser errors (excluding map tiles / third-party):', JSON.stringify(errors.filter((e) => !/tile|leaflet|unpkg|ERR_|Failed to load resource|net::|Access-Control|CORS/i.test(e))));
await br.close(); await db.end();

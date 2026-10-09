// Abasare end-to-end through the real screens (react-native-web): a driver applies and gets approved, an owner adds a car and books,
// the driver checks the car in and out with photos, the owner confirms, PIN start, completion and cash. See app-e2e.mjs for prerequisites.
// Usage: node e2e/abasare-e2e.mjs <screenshot-dir> <small.jpg>
import { chromium } from 'playwright-core';
import { visibleOnly } from './visible.mjs';
import pg from 'pg';
const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp', JPG = process.argv[3] ?? '/tmp/doc.jpg';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' }); await db.connect();
await db.query('delete from otp_challenges'); await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('SEARCHING_DRIVER','REQUESTED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS','PAYMENT_PENDING')"); await db.query('update driver_profiles set is_online=false');
const rnd = () => String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
const dph = '+2507884' + rnd(), oph = '+2507883' + rnd();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const mk = async (name) => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] }); const page = visibleOnly(await ctx.newPage()); const errors = []; page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text().slice(0, 200))); return { ctx, page, errors }; };
const D = await mk('driver'), O = await mk('owner');
const shot = (who, n) => who.page.screenshot({ path: `${OUT}/ab-${n}.png` });
const step = async (name, fn, who) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); if (who) await shot(who, 'FAIL-' + name.replace(/\W+/g, '_').slice(0, 40)); throw e; } };
const signUp = async ({ page }, phone) => {
  await page.goto(WEB); await page.getByText('English', { exact: true }).click(); await page.getByText('Continue', { exact: true }).click();
  await page.getByPlaceholder('07X XXX XXXX').fill('0' + phone.slice(4)); await page.getByText('Send code', { exact: true }).click();
  const code = (await page.getByText(/Test build: code: \d{6}/).textContent()).match(/\d{6}/)[0];
  await page.getByPlaceholder('••••••').fill(code); await page.getByText('Verify', { exact: true }).click();
  await page.getByTestId('tabbar').waitFor({ timeout: 20000 }); await page.getByTestId('tab-book').click(); await page.getByText('Location permission').waitFor(); await page.getByText('Allow location', { exact: true }).click(); await page.getByText('Where to?').waitFor();
};
const chooseFile = async (page, label) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByText(label, { exact: true }).first().click()]); await fc.setFiles(JPG); await page.waitForTimeout(1200); };

// ---------------- driver applies ----------------
await step('driver signs up and opens the Abasare application', async () => {
  await signUp(D, dph); await D.page.getByTestId('tab-account').click(); await D.page.getByTestId('acc-become').click();
  await D.page.getByTestId('choose-abasare').waitFor({ timeout: 20000 }); await shot(D, '1-chooser');
}, D);
await step('choose Abasare, fill skills, save', async () => {
  await D.page.getByTestId('choose-abasare').click();
  await D.page.getByLabel('Full legal name').fill('Eric Umusare'); await D.page.getByLabel('National ID number').fill('1198580012345678');
  await D.page.getByLabel('Driving licence issue date (YYYY-MM-DD)').fill('2016-04-12'); await D.page.getByLabel('Years of driving experience').fill('9');
  await D.page.getByText('Automatic', { exact: true }).click(); await D.page.getByText('SUV', { exact: true }).click();
  await shot(D, '2-abasare-form'); await D.page.getByText('Save Abasare details', { exact: true }).click();
  await D.page.getByText('Police clearance certificate').waitFor({ timeout: 20000 }); await shot(D, '3-docs');
}, D);
await step('upload the four required documents (no vehicle documents asked)', async () => {
  const labels = ['National ID', 'Driving licence', 'Profile photo', 'Police clearance certificate'];
  for (const l of labels) {
    await D.page.getByText(l + ' *', { exact: true }).locator('xpath=ancestor::div[.//div[text()="Upload"]][1]').getByText('Upload', { exact: true }).click();
    if (l !== 'Profile photo') await D.page.getByLabel('Expiry date (YYYY-MM-DD)').fill('2030-12-31');
    await chooseFile(D.page, 'Choose from gallery');
  }
  if ((await D.page.getByText('Vehicle registration').count()) > 0) throw new Error('vehicle documents should not be required');
  const n = (await db.query("select count(*)::int n from driver_documents d join users u on u.id=d.driver_id where u.phone=$1", [dph])).rows[0].n; if (n < 4) throw new Error('docs stored ' + n);
}, D);
await step('submit for review', async () => { await D.page.getByText('Submit for review', { exact: true }).click(); await D.page.getByText('Submitted, waiting for review').waitFor({ timeout: 20000 }); await shot(D, '4-submitted'); }, D);
const driverId = (await db.query('select id from users where phone=$1', [dph])).rows[0].id;
await step('verification officer approves (as in the console)', async () => {
  await db.query("update driver_documents set review_status='approved' where driver_id=$1", [driverId]);
  await db.query("update driver_profiles set status='APPROVED', abasare_status='approved', accepting='{ride,abasare}' where user_id=$1", [driverId]);
  await D.page.getByText('Accept jobs for').waitFor({ timeout: 25000 }); await shot(D, '5-approved');
}, D);
await step('driver goes online for Abasare', async () => {
  await D.page.getByText('I agree', { exact: true }).click(); await D.page.getByText('Go online', { exact: true }).click(); await D.page.getByText('Online', { exact: true }).first().waitFor({ timeout: 15000 });
  const r = (await db.query('select is_online, accepting from driver_profiles where user_id=$1', [driverId])).rows[0]; if (!r.is_online || !r.accepting.includes('abasare')) throw new Error(JSON.stringify(r));
  for (let i = 0; i < 20; i++) { if ((await db.query('select last_lat from driver_profiles where user_id=$1', [driverId])).rows[0].last_lat != null) return; await D.page.waitForTimeout(500); } throw new Error('no GPS heartbeat');
}, D);

// ---------------- owner books ----------------
await step('owner signs up, switches to Abasare and adds a car', async () => {
  await signUp(O, oph); await O.page.getByText('Abasare', { exact: true }).first().click(); await O.page.getByText('Abasare: a driver for your own car').waitFor(); await O.page.getByText('How Abasare works').waitFor(); await shot(O, '6-owner-abasare');
  await O.page.getByText('Got it', { exact: true }).click(); await O.page.getByText('How Abasare works').waitFor({ state: 'detached' }); await O.page.reload(); await O.page.getByTestId('tab-book').click(); await O.page.getByText('Abasare: a driver for your own car').waitFor(); if (await O.page.getByText('How Abasare works').count()) throw new Error('explainer came back after dismiss');
  await O.page.getByText('Add a car', { exact: true }).click(); await O.page.getByText('Add a car', { exact: true }).click();
  await O.page.getByLabel('Plate number').fill('RAE456D'); await O.page.getByLabel('Make').fill('Toyota'); await O.page.getByLabel('Model').fill('RAV4'); await O.page.getByLabel('Colour').fill('Silver');
  await O.page.getByText('SUV', { exact: true }).click(); await O.page.getByText('Automatic', { exact: true }).click(); await O.page.getByText(/My insurance covers/).click(); await shot(O, '7-add-car');
  await O.page.getByText('Save car', { exact: true }).click(); await O.page.getByText('RAE456D', { exact: true }).waitFor({ timeout: 15000 });
  await O.page.getByLabel('Back').click(); await O.page.getByText('Abasare: a driver for your own car').waitFor();
}, O);
await step('Drive me home: pick a destination and see the honest price breakdown', async () => {
  await O.page.getByText('Kimironko Market', { exact: true }).first().click().catch(async () => { await O.page.getByText('Isoko rya Kimironko', { exact: true }).first().click(); });
  await O.page.getByText('See prices', { exact: true }).click(); await O.page.getByText('Your Umusare').waitFor({ timeout: 20000 });
  await O.page.getByText('Driver return allowance').waitFor({ timeout: 20000 }); await shot(O, '8-options');
  if (!(await O.page.getByText('Please confirm to continue').count())) throw new Error('confirm must be blocked until the owner attests');
}, O);
await step('attest and confirm the request', async () => { await O.page.getByText(/I own this car/).click(); await O.page.getByText('Confirm request', { exact: true }).click(); await O.page.getByText('Finding your driver…').waitFor({ timeout: 20000 }); await shot(O, '9-searching'); }, O);

// ---------------- driver accepts and works ----------------
await step('driver sees the Abasare offer with earnings and the owner\'s car, accepts', async () => {
  await D.page.getByText('ABASARE', { exact: true }).waitFor({ timeout: 25000 }); await D.page.getByText(/SUV, Automatic/).waitFor(); await D.page.getByText('You earn').waitFor(); await shot(D, '10-offer');
  await D.page.getByText('Accept', { exact: true }).click(); await D.page.getByText('I am on my way', { exact: true }).waitFor({ timeout: 20000 });
}, D);
await step('owner sees the driver\'s profile, years of experience and their own plate', async () => {
  await O.page.getByText('Check the driver\'s photo and name before handing over your keys.').waitFor({ timeout: 20000 }); await O.page.getByText('RAE456D', { exact: true }).waitFor(); await O.page.getByText(/years driving/).waitFor(); await shot(O, '11-owner-driver');
}, O);
await step('driver arrives; PIN is not enough: the car must be checked in first', async () => {
  await D.page.getByText('I am on my way', { exact: true }).click(); await D.page.waitForTimeout(700); await D.page.getByText('I have arrived', { exact: true }).click();
  await D.page.getByText('Record the car\'s condition before you drive').waitFor({ timeout: 20000 }); if (await D.page.getByText('Enter passenger PIN').count()) throw new Error('PIN field must not show before check-in'); await shot(D, '12-checkin');
}, D);
await step('check-in: two photos, odometer, fuel, notes', async () => {
  const disabled = async () => (await D.page.getByText('Save check', { exact: true }).locator('xpath=ancestor::*[@role="button"][1]').getAttribute('aria-disabled')) === 'true';
  await D.page.getByLabel('Odometer (km)').fill('45210'); await D.page.getByText('50%', { exact: true }).click(); await D.page.getByLabel('Notes (scratches, dents, items inside)').fill('Small scratch on rear bumper, phone charger inside');
  if (!(await disabled())) throw new Error('save must be disabled without photos');
  await chooseFile(D.page, 'Choose photo'); await chooseFile(D.page, 'Choose photo'); await D.page.getByText(/Photos: 2 \/ 2/).waitFor({ timeout: 15000 });
  await D.page.getByText('Save check', { exact: true }).click(); await D.page.getByText('Enter passenger PIN').waitFor({ timeout: 20000 }); await shot(D, '13-after-checkin');
}, D);
await step('owner reviews the recorded condition with photos and confirms', async () => {
  await O.page.getByText('Car check-in', { exact: true }).waitFor({ timeout: 20000 }); await O.page.getByText(/45,210 km/).waitFor(); await O.page.getByText(/Small scratch on rear bumper/).waitFor();
  if ((await O.page.getByLabel(/^Photo \d/).count()) < 2) throw new Error('owner should see the check-in photos'); await shot(O, '14-owner-review');
  await O.page.getByText('Looks right', { exact: true }).click(); await O.page.getByText('You confirmed this record').waitFor({ timeout: 15000 });
}, O);
await step('driver starts with the PIN shown to the owner', async () => {
  const pin = (await O.page.getByText('Your trip PIN').locator('xpath=following-sibling::*[1]').textContent()).trim(); if (!/^\d{4}$/.test(pin)) throw new Error('pin ' + pin);
  await D.page.getByLabel('Enter passenger PIN').fill(pin); await D.page.getByText('Start trip', { exact: true }).click(); await D.page.getByText('Record the car\'s condition at drop-off').waitFor({ timeout: 20000 }); await shot(D, '15-in-progress');
}, D);
await step('cannot complete before the drop-off check; check-out with photos then complete', async () => {
  if (await D.page.getByText('Complete trip', { exact: true }).count()) throw new Error('complete must be hidden before check-out');
  await D.page.getByLabel('Odometer (km)').fill('45224'); await D.page.getByText('50%', { exact: true }).click();
  await chooseFile(D.page, 'Choose photo'); await chooseFile(D.page, 'Choose photo'); await D.page.getByText(/Photos: 2 \/ 2/).waitFor({ timeout: 15000 });
  await D.page.getByText('Save check', { exact: true }).click(); await D.page.getByText('Complete trip', { exact: true }).waitFor({ timeout: 20000 });
  await D.page.getByText('Complete trip', { exact: true }).click(); await D.page.getByText('Confirm cash received', { exact: true }).waitFor({ timeout: 20000 }); await shot(D, '16-collect');
}, D);
await step('driver sees the one-tap Moto ride home; cash is confirmed; owner pays and sees the check-out', async () => {
  await D.page.getByText('Ride home with Moto', { exact: true }).waitFor();
  await D.page.getByText('Confirm cash received', { exact: true }).click();
  await O.page.getByText('Car check-out', { exact: true }).waitFor({ timeout: 25000 }); await O.page.getByText(/Payment received/).waitFor({ timeout: 25000 }); await shot(O, '17-owner-done');
  const b = (await db.query("select b.status, b.final_fare, e.commission, e.net from bookings b join driver_earnings e on e.booking_id=b.id where b.hire_mode='point_to_point' and b.driver_id=$1 order by b.created_at desc limit 1", [driverId])).rows[0];
  if (b.status !== 'PAYMENT_COMPLETED' || b.commission + b.net !== b.final_fare - 0 && b.commission + b.net > b.final_fare) throw new Error(JSON.stringify(b));
  const l = (await db.query('select sum(debit)::int d, sum(credit)::int c from ledger_entries')).rows[0]; if (l.d !== l.c) throw new Error('ledger unbalanced');
}, O);
const errs = [...D.errors, ...O.errors].filter((e) => !/tile|leaflet|unpkg|ERR_|Failed to load resource|net::|Access-Control|CORS/i.test(e));
console.log('browser errors (excluding map tiles / third-party):', JSON.stringify(errs));
await br.close(); await db.end();

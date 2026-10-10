import { chromium } from 'playwright-core';
import pg from 'pg';
import { visibleOnly } from './visible.mjs';
import { pickDate, pickTime } from './pickers.mjs';
// Date and time pickers through the real screens: schedule a ride by calendar and clock (no typing), set a hire length with the stepper,
// change the text size and the clock format in Settings. Usage: node e2e/pickers-e2e.mjs <screenshot-dir>   (prerequisites as app-e2e.mjs)
const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' }); await db.connect();
const national = '772' + String(100000 + Math.floor(Math.random() * 899999));   // a Ugandan number: the whole sign-in goes through the country picker
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] });
const page = visibleOnly(await ctx.newPage()); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/pk-FAIL-${name.replace(/\W+/g, '_')}.png` }); } };
const kigaliDay = (plus) => new Date(Date.now() + 2 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10);

await step('rider signs in with a Ugandan number chosen from the country list', async () => {
  await db.query('delete from otp_challenges'); await page.goto(WEB); await page.getByText('English', { exact: true }).click(); await page.getByText('Continue', { exact: true }).click();
  await page.getByTestId('phone-input-country').click(); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/pk-countries.png` }); await page.getByTestId('country-search').fill('uganda'); await page.getByTestId('country-UG').click();
  const shown = await page.getByTestId('phone-input-country').innerText(); if (!/\+256/.test(shown)) throw new Error('country not chosen: ' + shown);
  await page.getByPlaceholder('Phone number').fill(national); await page.getByText('Send code', { exact: true }).click();
  const code = (await page.getByText(/Test build: code: \d{6}/).textContent()).match(/\d{6}/)[0];
  await page.getByPlaceholder('••••••').fill(code); await page.getByText('Verify', { exact: true }).click(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 });
  const row = await db.query('select phone from users where phone=$1', ['+256' + national]); if (row.rowCount !== 1) throw new Error('account not created with the +256 number');
});
await step('choose a ride time with the calendar and the clock (nothing typed)', async () => {
  await page.evaluate(() => localStorage.setItem('rm_loc_consent', '1')); await page.reload(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 }); await page.getByTestId('tab-book').click();
  await page.getByTestId('when-pick').waitFor({ timeout: 25000 }); await page.getByTestId('when-pick').click();
  const day = kigaliDay(3); await pickDate(page, 'when-date', day); await pickTime(page, 'when-time', '14:30');
  const shown = await page.getByTestId('when-time').innerText(); if (!/14:30/.test(shown)) throw new Error('time not shown: ' + shown);
  const dshown = await page.getByTestId('when-date').innerText(); if (!new RegExp(String(Number(day.slice(8)))).test(dshown)) throw new Error('date not shown: ' + dshown);
  await page.screenshot({ path: `${OUT}/pk-schedule.png` });
});
await step('a day before the shortest notice cannot be chosen', async () => {
  await page.getByTestId('when-date').click(); await page.waitForTimeout(700); const yesterday = kigaliDay(-1); const cell = page.getByTestId(`cal-day-${yesterday}`);
  await page.screenshot({ path: `${OUT}/pk-calendar.png` }); if (await cell.count()) { if (!(await cell.isDisabled())) throw new Error('yesterday can be chosen'); } await page.keyboard.press('Escape');
});
await step('the clock can show 12-hour time and the text size can be larger (stored preferences)', async () => {
  await page.evaluate(() => localStorage.setItem('rm_appearance', JSON.stringify({ timeFormat: '12h', textScale: 1.5, weekStart: 0 }))); await page.reload(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 }); await page.getByTestId('tab-book').click();
  await page.getByTestId('when-pick').waitFor({ timeout: 25000 }); await page.getByTestId('when-pick').click(); await page.getByTestId('when-time').click(); const t = await page.getByTestId('time-shown').innerText(); if (!/AM|PM|--:--/.test(t)) throw new Error('not 12-hour: ' + t);
  await page.screenshot({ path: `${OUT}/pk-12h-large.png` });
});
await step('online drivers near the pickup are counted on the rider home screen (blurred, no names)', async () => {
  const dphone = '+2507887' + String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5); await db.query('delete from otp_challenges');
  const call = async (m, p2, body, t) => (await fetch((process.env.API_ORIGIN ?? 'http://localhost:8080') + '/api/v1' + p2, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}), 'x-device-id': 'nb-' + Math.random() }, body: body ? JSON.stringify(body) : undefined })).json();
  const o = await call('POST', '/auth/otp/request', { phone: dphone }); const v = await call('POST', '/auth/otp/verify', { phone: dphone, code: o.dev_code, role: 'driver' });
  await db.query("update driver_profiles set status='APPROVED', legal_name='Near Driver', zone_id='kigali' where user_id=$1", [v.user.id]);
  await db.query("insert into vehicles(driver_id,vehicle_type,make,model,color,plate,capacity,status) values ($1,'moto','TVS','HLX','Blue',$2,1,'approved')", [v.user.id, 'RNB' + Math.floor(100 + Math.random() * 899) + 'X']);
  for (const r of (await db.query("select doc_type, requires_expiry from document_requirements where vehicle_type='moto' and mandatory")).rows) await db.query("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [v.user.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
  await call('PATCH', '/drivers/me/availability', { online: true }, v.access_token); await call('POST', '/drivers/me/location', { lat: -1.9545, lng: 30.0930 }, v.access_token);
  await page.reload(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 }); await page.getByTestId('tab-book').click();
  await page.getByTestId('nearby-line').waitFor({ timeout: 30000 }); const txt = await page.getByTestId('nearby-line').innerText(); if (!/drivers? nearby/.test(txt)) throw new Error('no nearby line: ' + txt);
  await page.getByTestId('wide-toggle').click(); await page.waitForFunction(() => /drivers? available on the map/.test(document.body.innerText), null, { timeout: 20000 });
  await page.getByTestId('wide-toggle').click(); await page.waitForFunction(() => /drivers? nearby/.test(document.body.innerText), null, { timeout: 20000 });
  await page.waitForTimeout(2500); let icons = 0; for (const f of page.frames()) icons += await f.locator('.i').count().catch(() => 0); if (!icons) throw new Error('no car icon on the map'); await page.screenshot({ path: `${OUT}/pk-nearby.png` });
});
await step('pickup stays flexible: a ride for someone else never assumes your own location; any place can be searched and chosen', async () => {
  await page.reload(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 }); await page.getByTestId('tab-book').click(); await page.getByTestId('pickup-name').waitFor({ timeout: 25000 });
  await page.waitForFunction(() => /Near|My location|Hafi|Aho ndi|Près|Ma position/.test(document.body.innerText), null, { timeout: 20000 });      // the phone's location was taken as a first suggestion
  await page.getByText('someone else', { exact: false }).first().click(); await page.getByText(/Choose where your guest will be picked up/).waitFor({ timeout: 10000 });
  const cleared = await page.getByTestId('pickup-name').innerText(); if (/Near|My location/.test(cleared)) throw new Error('own location was kept for a guest: ' + cleared);
  await page.getByTestId('pickup-q').fill('Kigali'); await page.getByTestId('pickup-result').first().waitFor({ timeout: 20000 });
  const picked = (await page.getByTestId('pickup-result').first().innerText()).replace('📍', '').trim(); await page.getByTestId('pickup-result').first().click();
  const shown = await page.getByTestId('pickup-name').innerText(); if (!shown.includes(picked.slice(0, 8))) throw new Error('pickup not changed: ' + shown + ' vs ' + picked);
  if (await page.getByText(/Choose where your guest will be picked up/).count()) throw new Error('the notice stays after a place was chosen');
  if (!(await page.getByText('Chosen place').count())) throw new Error('source label missing');
  await page.screenshot({ path: `${OUT}/pk-pickup.png` });
});
console.log(errors.length ? 'page errors: ' + errors.slice(0, 3).join(' | ') : 'no page errors'); await br.close(); await db.end();

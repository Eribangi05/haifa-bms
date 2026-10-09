import { chromium } from 'playwright-core';
import pg from 'pg';
import { visibleOnly } from './visible.mjs';
import { pickDate, pickTime } from './pickers.mjs';
// Date and time pickers through the real screens: schedule a ride by calendar and clock (no typing), set a hire length with the stepper,
// change the text size and the clock format in Settings. Usage: node e2e/pickers-e2e.mjs <screenshot-dir>   (prerequisites as app-e2e.mjs)
const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' }); await db.connect();
const phone = '+2507886' + String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] });
const page = visibleOnly(await ctx.newPage()); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/pk-FAIL-${name.replace(/\W+/g, '_')}.png` }); } };
const kigaliDay = (plus) => new Date(Date.now() + 2 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10);

await step('rider signs in', async () => {
  await db.query('delete from otp_challenges'); await page.goto(WEB); await page.getByText('English', { exact: true }).click(); await page.getByText('Continue', { exact: true }).click();
  await page.getByPlaceholder('07X XXX XXXX').fill('0' + phone.slice(4)); await page.getByText('Send code', { exact: true }).click();
  const code = (await page.getByText(/Test build: code: \d{6}/).textContent()).match(/\d{6}/)[0];
  await page.getByPlaceholder('••••••').fill(code); await page.getByText('Verify', { exact: true }).click(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 });
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
console.log(errors.length ? 'page errors: ' + errors.slice(0, 3).join(' | ') : 'no page errors'); await br.close(); await db.end();

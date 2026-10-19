import { chromium } from 'playwright-core';
import pg from 'pg';
// Abasare Business portal end to end in a real browser: sign in by phone code, company (overview, team, rules, statement, CSV, language switch) and fleet (drivers, vehicles, earnings, invite).
// Prerequisite: API on :8080 (OTP_DEV_ECHO=true) and its database in DATABASE_URL. Usage: DATABASE_URL=... node e2e/business-e2e.mjs <screenshot-dir>
const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8080', OUT = process.argv[2] ?? '/tmp';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rm_biz' }); await db.connect();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true, locale: 'en-GB' });
const page = await ctx.newPage(); const errors = [];
page.on('response', async (r) => { if (r.url().includes('/members') && r.request().method() === 'POST') console.log('   POST members', r.status(), (await r.text()).slice(0, 160)); });
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { const b = await page.locator('.banner').allInnerTexts().catch(() => []); await page.screenshot({ path: `${OUT}/biz-fail.png` }).catch(() => {}); console.log('FAIL', name, '-', e.message.split('\n')[0], b.length ? '| page says: ' + b.join(' / ') : ''); } };
await db.query('delete from otp_challenges');   // the scratch database is reused: forget earlier codes so the per-network hourly limit does not trip
const phone = '+250788' + String(Math.floor(100000 + Math.random() * 899999)), other = '+250788' + String(Math.floor(100000 + Math.random() * 899999));
const text = () => page.locator('body').innerText();

await step('sign in with a phone code', async () => {
  await page.goto(ORIGIN + '/business/'); await page.waitForSelector('input[type=tel]');
  await page.locator('select').selectOption('en');
  await page.fill('input[type=tel]', phone);
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().includes('/auth/otp/request')), page.getByText('Send code', { exact: true }).click()]);
  const code = (await resp.json()).dev_code; if (!code) throw new Error('no dev code (start the API with OTP_DEV_ECHO=true)');
  await page.waitForSelector('.banner.ok'); if ((await page.inputValue('input[inputmode=numeric]')) !== code) throw new Error('the test code is not shown and filled in');
  await page.getByText('Verify and sign in', { exact: true }).click();
  await page.getByText('Your accounts', { exact: true }).waitFor({ timeout: 10000 });
});
await step('register a company and a fleet; both wait for verification', async () => {
  await page.getByPlaceholder('Legal name').fill('Akagera Tours Ltd'); await page.getByText('Create', { exact: true }).first().click();
  await page.getByText(/Pending/).first().waitFor({ timeout: 8000 });
  await page.getByPlaceholder('Fleet name').fill('Kigali Cabs'); await page.getByText('Create', { exact: true }).last().click();
  await page.getByText('Kigali Cabs', { exact: true }).waitFor({ timeout: 8000 });
});
await db.query("update corporate_accounts set status='active' where legal_name='Akagera Tours Ltd'"); await db.query("update fleets set status='active' where name='Kigali Cabs'");
await step('company overview opens with the month totals and budget', async () => {
  await page.reload(); await page.getByText('Akagera Tours Ltd', { exact: true }).waitFor({ timeout: 8000 });
  await page.getByText('Open', { exact: true }).first().click();
  await page.getByText('Spent this month').waitFor({ timeout: 8000 }); await page.screenshot({ path: `${OUT}/biz-company.png` });
});
await step('team: add an employee with a limit and cost centre, then see them listed', async () => {
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await page.getByPlaceholder('07xx xxx xxx').fill('0788123456'); await page.locator('label.f:has-text("Name") input').fill('Aline Uwase');
  await page.locator('label.f:has-text("Spending limit") input').fill('15000'); await page.locator('label.f:has-text("Cost centre") input').fill('Sales');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Aline Uwase').waitFor({ timeout: 8000 }); const t = await text(); if (!/15,000/.test(t) || !/Sales/.test(t)) throw new Error('limit or cost centre missing');
});
await step('rules: save a fare ceiling and a monthly budget', async () => {
  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  await page.locator('label.f:has-text("Highest fare") input').fill('20000'); await page.locator('label.f:has-text("Monthly budget") input').fill('500000');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText('Saved', { exact: true }).waitFor({ timeout: 8000 });
  const r = await db.query("select monthly_budget, policy from corporate_accounts where legal_name='Akagera Tours Ltd'"); if (r.rows[0].monthly_budget !== 500000 || r.rows[0].policy.max_fare !== 20000) throw new Error(JSON.stringify(r.rows[0]));
});
await step('statement: month totals, CSV download that cannot run as a spreadsheet formula', async () => {
  await db.query("update users set display_name='=cmd|x' where phone='+250788123456'");
  await page.getByRole('button', { name: 'Monthly statement', exact: true }).click(); await page.getByText(/Total:/).waitFor({ timeout: 8000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('Download CSV', { exact: true }).click()]);
  if (!/^statement-\d{4}-\d{2}\.csv$/.test(dl.suggestedFilename())) throw new Error(dl.suggestedFilename());
});
await step('book a ride: place search lists places and prices appear (or "Not available now")', async () => {
  await page.getByRole('button', { name: 'Book a ride', exact: true }).click();
  page.on('response', async (r) => { if (r.url().includes('/places/search')) console.log('   places/search', r.status(), (await r.text()).slice(0, 120)); });
  await page.locator('input[placeholder*="place or landmark"]').first().fill('Kigali Convention'); await page.locator('.hit:visible').first().waitFor({ timeout: 8000 }); await page.locator('.hit:visible').first().click();
  await page.locator('input[placeholder*="place or landmark"]').nth(1).fill('Kimironko'); await page.locator('.hit:visible').first().waitFor({ timeout: 8000 }); await page.locator('.hit:visible').first().click();
  await page.getByText('See prices', { exact: true }).click(); await page.waitForTimeout(1500);
  const t = await text(); if (!/RWF per km|Not available now|RWF/.test(t)) throw new Error('no prices shown'); await page.screenshot({ path: `${OUT}/biz-book.png` });
});
await step('language switch: Kinyarwanda and French show no English labels', async () => {
  for (const [l, must, mustNot] of [['rw', 'Abasare', /Monthly statement|Book a ride/], ['fr', 'Aperçu', /Monthly statement|Book a ride|Overview/]]) {
    await page.locator('header select').selectOption(l); await page.waitForTimeout(300);
    const t = await text(); if (!t.includes(must) && l === 'fr') throw new Error(l + ' missing ' + must); if (mustNot.test(t)) throw new Error(l + ' still has English');
  }
  await page.screenshot({ path: `${OUT}/biz-fr.png` }); await page.locator('header select').selectOption('en');
});
await step('fleet: drivers, vehicles, trips, earnings and an invitation', async () => {
  await page.getByText('Back', { exact: true }).first().click(); await page.getByText('Kigali Cabs', { exact: true }).waitFor();
  await page.locator('tr:has-text("Kigali Cabs") button').click(); await page.getByRole('button', { name: 'Vehicles', exact: true }).click(); await page.getByText('Plate').waitFor({ timeout: 8000 }).catch(() => {});
  for (const n of ['Drivers', 'Trips', 'Earnings']) { await page.getByRole('button', { name: n, exact: true }).click(); await page.waitForTimeout(400); }
  await page.getByText('Gross fares').waitFor({ timeout: 8000 }); if (/NaN/.test(await text())) throw new Error('a number shows as NaN');
  await page.getByRole('button', { name: 'Invite a driver', exact: true }).click(); await page.getByPlaceholder('07xx xxx xxx').fill('0788777666'); await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await page.getByText('Invitation sent').waitFor({ timeout: 8000 }); await page.screenshot({ path: `${OUT}/biz-fleet.png` });
});
await step('another person cannot open this company (server-side ownership)', async () => {
  const id = (await db.query("select id from corporate_accounts where legal_name='Akagera Tours Ltd'")).rows[0].id;
  const o = await (await fetch(ORIGIN + '/api/v1/auth/otp/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: other }) })).json();
  const v = await (await fetch(ORIGIN + '/api/v1/auth/otp/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: other, code: o.dev_code, role: 'passenger' }) })).json();
  if (!v.access_token) throw new Error('second sign-in failed: ' + JSON.stringify(v).slice(0, 160));
  const r = await fetch(`${ORIGIN}/api/v1/businesses/${id}/members`, { headers: { authorization: 'Bearer ' + v.access_token } }); if (r.status !== 404) throw new Error('status ' + r.status);
});
await step('no script errors in the browser', async () => { if (errors.length) throw new Error(errors.slice(0, 3).join(' | ')); });
await br.close(); await db.end();

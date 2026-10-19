import { chromium } from 'playwright-core';
import pg from 'pg';
import { visibleOnly } from './visible.mjs';
const db = new pg.Client({ connectionString: 'postgres://rm:rm@localhost:5432/rm_brochure' }); await db.connect(); await db.query('delete from otp_challenges');
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] });
const page = visibleOnly(await ctx.newPage());
await page.goto('http://localhost:8081'); await page.getByText('English', { exact: true }).click(); await page.getByText('Continue', { exact: true }).click();
await page.getByPlaceholder('07X XXX XXXX').fill('0788' + String(100000 + Math.floor(Math.random() * 899999)).slice(0, 6)); await page.getByText('Send code', { exact: true }).click();
const code = (await page.getByText(/Test build: code: \d{6}/).textContent()).match(/\d{6}/)[0];
await page.getByPlaceholder('••••••').fill(code); await page.getByText('Verify', { exact: true }).click(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 });
await page.getByTestId('tab-book').click();
try { await page.getByText('Location permission').waitFor({ timeout: 4000 }); await page.getByText('Allow location', { exact: true }).click(); } catch {}
await page.getByText('Where to?').waitFor({ timeout: 15000 }); await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/brochure/app/n12-web-desktop.png' });
await page.getByText('Kimironko Market', { exact: true }).last().click(); await page.getByText('See prices', { exact: true }).click(); await page.getByText('Fare breakdown').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/brochure/app/n13-web-prices.png' });
await br.close(); await db.end();

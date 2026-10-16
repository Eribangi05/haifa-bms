import { chromium } from 'playwright-core';
import pg from 'pg';
// Demo data end to end through the real screens (react-native-web): a demo driver reads and shares the weekly statement, a demo rider shares a trip receipt
// and the public receipt page opens. Prerequisite: demo data loaded (console "Demo data" or services/demo.ts) in the scratch database, API on :8080, web build on :8081.
// Usage: DATABASE_URL=... node e2e/demo-e2e.mjs <screenshot-dir>
const API = (process.env.API_ORIGIN ?? 'http://localhost:8080'), WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' }); await db.connect();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
const mk = async (lang) => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'] }); const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); return { ctx, page, lang }; };
const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); } };
const LABELS = { English: { cont: 'Continue', send: 'Send code', verify: 'Verify' } };
const login = async (x, phone) => {
  await db.query('delete from otp_challenges'); const page = x.page; await page.goto(WEB); await page.getByText('English', { exact: true }).click(); await page.getByText('Continue', { exact: true }).click();
  await page.getByPlaceholder('07X XXX XXXX').fill('0' + phone.slice(4)); await page.getByText('Send code', { exact: true }).click();
  const code = (await page.getByText(/Test build: code: \d{6}/).textContent()).match(/\d{6}/)[0];
  await page.getByPlaceholder('••••••').fill(code); await page.getByText('Verify', { exact: true }).click(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 });
};
const demo = (await db.query("select count(*)::int n from users where device_fingerprint='demo'")).rows[0].n; if (!demo) throw new Error('load demo data first');
await db.query("update users set preferred_language='en' where phone in ('+250788991001','+250788990001')");
const D = await mk('en'), P = await mk('en');

await step('demo driver signs in and opens Earnings: the weekly statement shows totals', async () => {
  await login(D, '+250788991001'); await D.page.getByTestId('tab-account').click(); await D.page.getByTestId('acc-mode').click(); await D.page.getByTestId('tab-home').waitFor({ timeout: 20000 });
  await D.page.getByTestId('tab-earn').click(); await D.page.getByTestId('statement').waitFor({ timeout: 25000 });
  const txt = await D.page.getByTestId('statement').textContent(); if (!/Your earnings/.test(txt) || !/Fares collected/.test(txt) || !/RWF/.test(txt)) throw new Error('statement text: ' + txt.slice(0, 200));
  await D.page.screenshot({ path: `${OUT}/demo-statement.png`, fullPage: true });
});
await step('last week can be opened and shared (copied to the clipboard on the web)', async () => {
  await D.page.getByText('Last week', { exact: true }).click(); await D.page.waitForTimeout(1200);
  await D.page.getByTestId('statement-share').click(); await D.page.waitForTimeout(700);
  const clip = await D.page.evaluate(() => navigator.clipboard.readText()); if (!/Abasare weekly statement/.test(clip) || !/Your earnings: [\d,]+ RWF/.test(clip)) throw new Error('clipboard: ' + clip.slice(0, 200));
});
let url;
await step('demo rider opens Trips and shares a receipt link', async () => {
  await login(P, '+250788990001'); await P.page.getByTestId('tab-trips').click();
  const ref = (await db.query("select b.ref from bookings b join users u on u.id=b.passenger_id where u.phone='+250788990001' and b.status='PAYMENT_COMPLETED' order by b.completed_at desc limit 1")).rows[0].ref;
  await P.page.getByTestId(`receipt-share-${ref}`).waitFor({ timeout: 25000 }); await P.page.getByTestId(`receipt-share-${ref}`).click(); await P.page.waitForTimeout(1500);
  const clip = await P.page.evaluate(() => navigator.clipboard.readText()); url = clip.match(/https?:\/\/\S+/)?.[0]; if (!url || !clip.includes(ref)) throw new Error('clipboard: ' + clip.slice(0, 200));
  await P.page.screenshot({ path: `${OUT}/demo-receipt-share.png` });
});
await step('the public receipt page opens without signing in, in the rider language', async () => {
  const r = await fetch(url.replace(/^https?:\/\/[^/]+/, API) + ''); const html = await r.text();
  if (r.status !== 200 || !/Trip receipt/.test(html) || !/RWF/.test(html)) throw new Error(r.status + ' ' + html.slice(0, 100));
});
if (errors.length) console.log('FAIL page errors -', errors.slice(0, 3).join(' | '));
await br.close(); await db.end();

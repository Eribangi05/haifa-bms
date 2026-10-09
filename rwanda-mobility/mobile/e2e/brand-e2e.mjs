import { chromium } from 'playwright-core';
import { visibleOnly } from './visible.mjs';
// Branding, icons, invitation sharing and the support contact. Usage: node e2e/brand-e2e.mjs <screenshot-dir>  (prereqs as app-e2e.mjs)
// External apps are not launched in a browser: window.open is replaced by a recorder so the exact deep link of each share button can be asserted.
const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const phone = '+2507886' + String(10000 + Math.floor(Math.random() * 89999));
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'] });
await ctx.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
let page = visibleOnly(await ctx.newPage()); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
let failed = false;
const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { failed = true; console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/brand-FAIL-${name.replace(/\W+/g, '_').slice(0, 40)}.png` }); } };
const last = () => page.evaluate(() => window.__opened[window.__opened.length - 1]);
const shot = (n) => page.screenshot({ path: `${OUT}/brand-${n}.png` });

await step('welcome: logo, name and translated tagline; language switch changes the tagline', async () => {
  await page.goto(WEB); await page.getByTestId('welcome-hero').waitFor({ timeout: 25000 });
  if (!/Genda · Kora · Sura/.test(await page.getByTestId('welcome-tagline').innerText())) throw new Error('rw tagline');
  await page.getByText('English', { exact: true }).click(); await page.getByText('Ride · Work · Explore').waitFor(); await page.getByText('Français', { exact: true }).click(); await page.getByText('Roulez · Travaillez · Explorez').waitFor();
  await page.getByText('English', { exact: true }).click(); await shot('1-welcome');
});
await step('sign in', async () => {
  await page.getByText('Continue', { exact: true }).click(); await page.getByPlaceholder('07X XXX XXXX').fill('0' + phone.slice(4)); await page.getByText('Send code', { exact: true }).click();
  const code = (await page.getByText(/Test build: code: \d{6}/).textContent()).match(/\d{6}/)[0]; await page.getByPlaceholder('••••••').fill(code); await page.getByText('Verify', { exact: true }).click(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 });
});
await step('home: brand bar with the name and a working RW/FR/EN switch', async () => {
  await page.getByTestId('header').getByText('Abasare', { exact: true }).waitFor(); await page.getByTestId('lang-fr').click(); await page.getByText('Où allez-vous ?').first().waitFor({ timeout: 10000 }); await page.getByTestId('lang-en').click(); await page.getByText('Where to?').first().waitFor(); await shot('2-home');
});
await step('icons: every image in the tab bar and quick actions loaded', async () => {
  const bad = await page.evaluate(() => [...document.querySelectorAll('[data-testid="tabbar"] img, [data-testid^="qa-"] img')].filter((i) => !(i.complete && i.naturalWidth > 0)).length); if (bad) throw new Error(bad + ' images failed');
  const n = await page.evaluate(() => document.querySelectorAll('[data-testid="tabbar"] img').length); if (n !== 5) throw new Error('tab icons ' + n);
});
await step('invite: code, share tiles and the exact links', async () => {
  await page.getByTestId('tab-account').click(); await page.getByTestId('open-invite').click(); await page.getByTestId('inv-code').waitFor({ timeout: 15000 });
  const code = (await page.getByTestId('inv-code').innerText()).trim(); if (!/^[A-Z0-9]{4,12}$/.test(code)) throw new Error('code ' + code);
  await page.getByTestId('inv-whatsapp').click(); let u = await last(); if (!u.startsWith('https://wa.me/?text=') || !decodeURIComponent(u).includes(code)) throw new Error('whatsapp ' + u);
  await page.getByTestId('inv-sms').click(); u = await last(); if (!/^sms:\??&?body=/.test(u) || !decodeURIComponent(u).includes(code)) throw new Error('sms ' + u);
  await page.getByTestId('inv-email').click(); u = await last(); if (!u.startsWith('mailto:?subject=') || !decodeURIComponent(u).includes(code)) throw new Error('mail ' + u);
  await page.getByTestId('inv-copy-btn').click(); await page.getByText('Code copied').waitFor({ timeout: 8000 }); const clip = await page.evaluate(() => navigator.clipboard.readText()); if (clip !== code) throw new Error('clipboard ' + clip);
  await shot('3-invite');
  await page.getByTestId('inv-call').click(); await page.getByText(/dialer/).waitFor();   // tel: links navigate the page itself on web, so only the hint is asserted here (the exact link is unit-tested)

});
await step('support: contact card with name, number and exact call / WhatsApp / message links', async () => {
  page = visibleOnly(await ctx.newPage()); page.on('pageerror', (e) => errors.push(e.message)); await page.goto(WEB); await page.getByTestId('tabbar').waitFor({ timeout: 25000 }); await page.getByTestId('tab-account').click(); await page.getByTestId('open-help').click(); await page.getByTestId('support-contact').waitFor({ timeout: 15000 });
  if (!/Jean Paul INGABIRE/.test(await page.getByTestId('support-name').innerText())) throw new Error('name'); if (!/\+250 786 880 880/.test(await page.getByTestId('support-phone').innerText())) throw new Error('phone');
  let u;
  await page.getByTestId('support-whatsapp').click(); u = await last(); if (!u.startsWith('https://wa.me/250786880880?text=')) throw new Error('wa ' + u);
  await page.getByTestId('support-sms').click(); u = await last(); if (!u.startsWith('sms:+250786880880')) throw new Error('sms ' + u); await shot('4-support');
  await page.getByTestId('support-call').click(); await page.waitForTimeout(400); if (await page.getByText(/Could not open/).count()) throw new Error('call failed');
});
console.log('browser page errors:', JSON.stringify(errors.filter((e) => !/tile|leaflet|unpkg|ERR_|Failed to load resource|net::|Access-Control|CORS/i.test(e))));
await br.close(); process.exit(failed ? 1 : 0);

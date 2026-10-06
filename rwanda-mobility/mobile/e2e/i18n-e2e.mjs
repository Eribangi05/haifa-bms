import { chromium } from 'playwright-core';
// Language-purity check: walk the main screens in French and Kinyarwanda and fail if English UI phrases leak.
// Usage: node e2e/i18n-e2e.mjs <screenshot-dir>   (backend with OTP_DEV_ECHO=true + web build served; see app-e2e.mjs)
const API = (process.env.API_ORIGIN ?? 'http://localhost:8080') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const ENGLISH = /\b(Continue|Choose your language|Where to\??|Pickup|Profile|Help|Sign out|Cancel|Confirm|Save|Language|Mobile number|Verification code|Saved places|Emergency contacts|Become a driver|My trips|See prices|Search place|Drag the map|Fare breakdown|Payment|Cash|Support|Contact support|Common questions|Loading|Something went wrong|Try again|Back|Driver photo)\b/;
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let failed = false;
for (const L of [{ code: 'fr', label: 'Français', cont: 'Continuer', where: 'Où allez-vous', ok: 'Autoriser' }, { code: 'rw', label: 'Kinyarwanda', cont: 'Komeza', where: 'Ujya he', ok: 'Emera' }]) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] });
  const page = await ctx.newPage(); const phone = '+2507886' + String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
  const check = async (name) => { const txt = await page.evaluate(() => document.body.innerText); const m = txt.match(ENGLISH); await page.screenshot({ path: `${OUT}/i18n-${L.code}-${name}.png` }); if (m) { failed = true; console.log('FAIL', L.code, name, 'English leak:', m[0]); } else console.log('OK  ', L.code, name); };
  await page.goto(WEB); await page.getByText(L.label, { exact: true }).click(); await page.waitForTimeout(400); await check('welcome');
  await page.getByText(L.cont, { exact: true }).click(); await page.getByPlaceholder('07X XXX XXXX').fill('0' + phone.slice(4)); await page.getByText(L.cont === 'Komeza' ? 'Ohereza kode' : 'Envoyer le code', { exact: true }).click();
  const dev = await page.getByText(/(?:code|kode): \d{6}/).first().textContent(); await page.getByPlaceholder('••••••').fill(dev.match(/: (\d{6})/)[1]);
  const verify = page.getByRole('button').filter({ hasText: L.code === 'fr' ? /Vérifier|Valider/ : /Emeza/ }).first(); await verify.click();
  await page.getByText(L.ok, { exact: true }).waitFor({ timeout: 20000 }).catch(async (e) => { await page.screenshot({ path: OUT + '/i18n-fail.png' }); throw e; }); await check('consent'); await page.getByText(L.ok, { exact: true }).click();
  await page.getByText(new RegExp(L.where)).first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800); await check('home');
  await page.getByText(L.code === 'fr' ? 'Profil' : 'Umwirondoro', { exact: true }).first().click(); await page.waitForTimeout(800); await check('profile');
  await page.getByLabel(L.code === 'fr' ? 'Retour' : 'Subira inyuma').click(); await page.waitForTimeout(400);
  await page.getByText(L.code === 'fr' ? 'Aide' : 'Ubufasha', { exact: true }).first().click(); await page.waitForTimeout(1200); await check('support');
  await ctx.close();
}
await br.close(); process.exit(failed ? 1 : 0);

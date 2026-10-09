import { chromium } from 'playwright-core';
import { visibleOnly } from './visible.mjs';
// E2E for QR request codes (web build; the camera and the Android deep link are NOT exercised here, only the flow after a code is known).
// Prereqs as app-e2e.mjs (backend with OTP_DEV_ECHO=true MOMO_MODE=simulator on :8080, web build served on :8081).
// Usage: node e2e/scan-e2e.mjs <screenshot-dir> [rw|fr|en]     (env: DATABASE_URL, CHROMIUM_PATH, API_ORIGIN, WEB_ORIGIN)
// Inserts a request code and an approved online driver straight into the database. Web equivalent of the deep link is  /?code=CODE[&svc=ride|abasare].
import pg from 'pg';
import fs from 'node:fs';
// The locale modules import each other without file extensions (fine for the bundler, not for node), so read the strings from the files.
const loadDict = (lang) => { const m = {}; for (const f of [`${lang}.ts`, `r1.${lang}.ts`, `r2.${lang}.ts`, `r3.${lang}.ts`, `r4.${lang}.ts`]) { const p = new URL('../src/lib/locales/' + f, import.meta.url); if (!fs.existsSync(p)) continue; for (const mm of fs.readFileSync(p, 'utf8').matchAll(/'([\w.]+)': '((?:[^'\\]|\\.)*)'/g)) m[mm[1]] = mm[2].replace(/\\'/g, "'"); } return m; };
const en = loadDict('en'), rw = loadDict('rw'), fr = loadDict('fr');
const OUT = process.argv[2] ?? '/tmp', LANG = process.argv[3] ?? 'rw'; const T = { en, rw, fr }[LANG]; const t = (k) => T[k];
const API = (process.env.API_ORIGIN ?? 'http://localhost:8080') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081';
const call = async (m, p, { t: tk, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(tk ? { authorization: 'Bearer ' + tk } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' }); await db.connect();
await db.query("delete from otp_challenges"); await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('SEARCHING_DRIVER','REQUESTED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','PAYMENT_PENDING')"); await db.query("update driver_profiles set is_online=false");
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const CODE = Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
const LABEL = 'Hotel Test Gisimenti', NOTE = LANG === 'fr' ? 'Porte A, près de la réception' : 'Door A near reception';
const rc = (await db.query("insert into request_codes(code,label,partner_name,lat,lng,pickup_note,default_service) values ($1,$2,'Test partner',-1.9536,30.0927,$3,'ride') returning id", [CODE, LABEL, NOTE])).rows[0];
const phone = '+2507889' + String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
// --- online driver so a booking can be matched
const dph = '+2507888' + String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
const o = await call('POST', '/auth/otp/request', { body: { phone: dph } });
const v = await call('POST', '/auth/otp/verify', { body: { phone: dph, code: o.j.dev_code, role: 'driver' }, h: { 'x-device-id': 'e2e-drv-' + Math.random() } });
const drv = { t: v.j.access_token, id: v.j.user.id };
await db.query("update driver_profiles set status='APPROVED', legal_name='Scan Driver', zone_id='kigali' where user_id=$1", [drv.id]);
await db.query("insert into vehicles(driver_id,vehicle_type,make,model,color,plate,capacity,status) values ($1,'moto','TVS','HLX','Blue',$2,1,'approved')", [drv.id, 'RS' + Math.floor(100 + Math.random() * 899) + 'B']);
for (const r of (await db.query("select doc_type, requires_expiry from document_requirements where vehicle_type='moto' and mandatory")).rows)
  await db.query("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [drv.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
const av = await call('PATCH', '/drivers/me/availability', { t: drv.t, body: { online: true } }); if (av.s !== 200) console.log('driver online failed', JSON.stringify(av.j));
await call('POST', '/drivers/me/location', { t: drv.t, body: { lat: -1.954, lng: 30.0927 } });
const badMsg = (await call('GET', '/request-codes/ZZZZZZ', { h: { 'accept-language': LANG } })).j.error.message;
const popular = (await call('GET', `/places/popular?lang=${LANG}`)).j.places[0].name;

const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.99, longitude: 30.2 }, permissions: ['geolocation'] });   // GPS deliberately far away: the venue must win
await ctx.addInitScript((l) => { try { if (!localStorage.getItem('rm_lang')) localStorage.setItem('rm_lang', l); } catch {} }, LANG);
const page = visibleOnly(await ctx.newPage()); const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
const shot = (n) => page.screenshot({ path: `${OUT}/scan-${LANG}-${n}.png` });
const step = async (name, fn) => { try { await fn(); console.log('OK  ', `[${LANG}]`, name); } catch (e) { console.log('FAIL', `[${LANG}]`, name, '-', e.message.split('\n')[0]); await shot('FAIL-' + name.replace(/\W+/g, '_')); throw e; } };
const text = (k) => page.getByText(t(k), { exact: true });

await step('signed out: code in the link is remembered through phone + OTP', async () => {
  await page.goto(`${WEB}/?code=${CODE.toLowerCase()}`); await page.getByPlaceholder(t('auth.phone.hint')).waitFor({ timeout: 20000 });
  await page.getByPlaceholder(t('auth.phone.hint')).fill('0' + phone.slice(4)); await text('auth.sendcode').click();
  const dev = await page.getByText(new RegExp(String.raw`${t('auth.dev')}: \d{6}`)).textContent(); await page.getByPlaceholder('••••••').fill(dev.match(/\d{6}/)[0]); await text('auth.verify').click();
});
await step('after sign-in the venue card is shown (name, note, pickup set)', async () => {
  await page.getByText(LABEL, { exact: true }).waitFor({ timeout: 20000 }); await page.getByText(NOTE, { exact: true }).waitFor(); await text('scan.found').or(page.getByText(t('scan.found'))).first().waitFor(); await shot('1-card');
});
await step('continue -> location consent -> Home with pickup = venue, note prefilled, destination empty', async () => {
  await text('scan.go').click(); await text('loc.allow').click(); await text('home.where').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);   // GPS must not override the venue
  await page.getByText(LABEL, { exact: true }).first().waitFor(); const note = await page.getByPlaceholder(t('home.pickupnote')).inputValue(); if (note !== NOTE) throw new Error('note not prefilled: ' + note);
  await page.getByPlaceholder(t('home.search')).waitFor(); await shot('2-home');
});
await step('typed bad code -> localized server error; garbage -> localized parser error', async () => {
  await page.getByText(t('scan.title')).first().click(); await page.getByPlaceholder(t('scan.type.ph')).fill('ZZZZZZ'); await text('common.continue').click();
  await page.getByText(badMsg, { exact: true }).waitFor({ timeout: 15000 }); await shot('3-bad');
  await page.getByPlaceholder(t('scan.type.ph')).fill('hello world'); await page.waitForTimeout(1300); await text('common.continue').click(); await text('scan.bad').waitFor();
});
await step('typed full URL of a valid code works and returns to Home', async () => {
  await page.getByPlaceholder(t('scan.type.ph')).fill(`https://abasare-api.onrender.com/r/${CODE}/`); await page.waitForTimeout(1300); await text('common.continue').click();
  await page.getByText(LABEL, { exact: true }).waitFor({ timeout: 15000 }); await text('scan.go').click(); await text('home.where').first().waitFor();
});
let bookingId;
await step('book: destination, prices, confirm -> bookings.request_code_id is the code', async () => {
  await page.getByText(popular, { exact: true }).first().click(); await text('home.seeprices').click(); await text('opt.breakdown').waitFor({ timeout: 20000 });
  await text('opt.confirm').click(); await page.getByText(t('trip.searching'), { exact: true }).waitFor({ timeout: 20000 }); await shot('4-searching');
  const r = await db.query("select b.id, b.request_code_id, b.pickup_name from bookings b join users u on u.id=b.passenger_id where u.phone=$1 order by b.created_at desc limit 1", [phone]);
  bookingId = r.rows[0]?.id; if (r.rows[0]?.request_code_id !== rc.id) throw new Error('request_code_id not stored: ' + JSON.stringify(r.rows[0])); if (r.rows[0].pickup_name !== LABEL) throw new Error('pickup_name ' + r.rows[0].pickup_name);
});
console.log('browser errors (excluding map tiles / third-party):', JSON.stringify(errors.filter((e) => !/tile|leaflet|unpkg|ERR_|Failed to load resource|net::|Access-Control|CORS|404/i.test(e))));
await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where id=$1", [bookingId]); await db.query("update driver_profiles set is_online=false where user_id=$1", [drv.id]);
await br.close(); await db.end();

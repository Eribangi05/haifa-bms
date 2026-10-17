import { chromium } from 'playwright-core';
import pg from 'pg';
import fs from 'node:fs';
const API = 'http://localhost:8080/api/v1', WEB = 'http://localhost:8081', OUT = '/tmp/brochure/app', LANG = process.env.LANG_ ?? 'en';
const db = new pg.Client({ connectionString: 'postgres://rm:rm@localhost:5432/rm_brochure' }); await db.connect();
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h ?? {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
const reg = async (phone, role) => { await db.query('delete from otp_challenges'); const o = await call('POST', '/auth/otp/request', { body: { phone } }); const v = await call('POST', '/auth/otp/verify', { body: { phone, code: o.j.dev_code, role }, h: { 'x-device-id': 'bro-' + phone } }); return { t: v.j.access_token, id: v.j.user.id }; };
await db.query("update users set preferred_language=$1 where phone in ('+250788990001','+250788991001')", [LANG]);
// a real, approved moto driver for the live trip
const dphone = '+250788770011'; let drv = await db.query('select id from users where phone=$1', [dphone]).then((r) => r.rows[0]);
const d = await reg(dphone, 'driver');
await db.query("update users set display_name='Jean Paul Habimana', preferred_language=$2 where id=$1", [d.id, LANG]);
await db.query("update driver_profiles set status='APPROVED', legal_name='Jean Paul Habimana', zone_id='kigali', rating_avg=4.8, rating_count=212, completed_count=640 where user_id=$1", [d.id]);
if (!(await db.query('select 1 from vehicles where driver_id=$1', [d.id])).rows.length) await db.query("insert into vehicles(driver_id,vehicle_type,make,model,color,year,plate,capacity,status) values ($1,'moto','TVS','HLX 125','Blue',2021,'RE 482 K',1,'approved')", [d.id]);
await db.query('delete from driver_documents where driver_id=$1', [d.id]);
for (const r of (await db.query("select doc_type, requires_expiry from document_requirements where vehicle_type='moto' and mandatory")).rows) await db.query("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [d.id, r.doc_type, r.requires_expiry ? '2028-01-01' : null]);
const dtok = (await reg(dphone, 'driver')).t;
await call('PATCH', '/drivers/me/availability', { t: dtok, body: { online: true } }); await call('POST', '/drivers/me/location', { t: dtok, body: { lat: -1.9545, lng: 30.0932 } });
await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS','PAYMENT_PENDING','COMPLETED') and (passenger_id=(select id from users where phone='+250788990001') or driver_id=$1)", [d.id]);
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const mk = async () => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'], locale: LANG === 'en' ? 'en-GB' : LANG }); return { ctx, page: await ctx.newPage() }; };
const sfx = LANG === 'en' ? '' : '-' + LANG;
const shot = async (x, n) => { await x.page.waitForTimeout(900); await x.page.screenshot({ path: `${OUT}/${n}${sfx}.png` }); console.log('shot', n); };
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); } };
const T = { en: { cont: 'Continue', send: 'Send code', verify: 'Verify', lang: 'English' }, rw: { cont: 'Komeza', send: 'Ohereza kode', verify: 'Emeza', lang: 'Kinyarwanda' }, fr: { cont: 'Continuer', send: 'Envoyer le code', verify: 'Vérifier', lang: 'Français' } }[LANG];
const login = async (x, phone, shotWelcome) => {
  await db.query('delete from otp_challenges'); const page = x.page; await page.goto(WEB); await page.getByText(T.lang, { exact: true }).first().click();
  if (shotWelcome) await shot(x, 'a01-welcome'); await page.getByText(T.cont, { exact: true }).click();
  await page.getByPlaceholder('07X XXX XXXX').fill('0' + phone.slice(4)); if (shotWelcome) await shot(x, 'a02-phone'); await page.getByText(T.send, { exact: true }).click();
  const code = (await page.getByText(/(code|kode)\s*:\s*\d{6}/i).first().textContent()).match(/(\d{6})$/)[1]; await page.evaluate(() => { for (const el of document.querySelectorAll('div')) if (/(code|kode)\s*:\s*\d{6}/i.test(el.textContent) && el.children.length <= 1 && el.textContent.length < 40) el.style.visibility = 'hidden'; }); if (shotWelcome) await shot(x, 'a03-otp');
  await page.getByPlaceholder('••••••').fill(code); await page.getByText(T.verify, { exact: true }).click(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 });
};

const loadL = (lg) => { const d = 'src/lib/locales/'; const files = [d + lg + '.ts', ...fs.readdirSync(d + 'features').filter((f) => f.endsWith('.' + lg + '.ts')).map((f) => d + 'features/' + f)]; const o = {}; for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/'([a-zA-Z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)'/g)) o[m[1]] = m[2].replace(/\\'/g, "'"); return o; };
const L = loadL(LANG); const t = (k) => L[k]; if (!L['loc.allow']) throw new Error('locale');
const PLACE = { en: 'Kimironko Market', rw: 'Isoko rya Kimironko', fr: 'Marché de Kimironko' }[LANG];
const click = (x, text, o = {}) => x.page.getByText(text, { exact: true, ...o }).first().click({ timeout: 20000 });


const rider = await reg('+250788990001', 'passenger');
await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS','PAYMENT_PENDING','COMPLETED') and (passenger_id=$1 or driver_id=$2)", [rider.id, d.id]);
const D = await mk();
await step('driver login', async () => { await login(D, dphone, false); await D.page.getByTestId('tab-account').click(); await D.page.getByTestId('acc-mode').click(); await D.page.getByTestId('tab-home').waitFor({ timeout: 20000 }); await shot(D, 'd01-home'); });
const book = async () => { const e = await call('POST', '/fares/estimate', { t: rider.t, body: { pickup: { lat: -1.954, lng: 30.0927 }, dest: { lat: -1.9496, lng: 30.1262 }, service_id: 'moto' } }); const q = e.j.options[0]; return (await call('POST', '/bookings', { t: rider.t, h: { 'idempotency-key': 'b3-' + Date.now() }, body: { quote_id: q.quote_id, payment_method: 'cash', pickup_name: 'Kigali Heights', dest_name: 'Kimironko Market' } })).j.booking.id; };
const down = async (loc) => { await D.page.locator(loc).first().scrollIntoViewIfNeeded().catch(() => {}); await D.page.waitForTimeout(700); };
let bid;
await step('offer', async () => { bid = await book(); const acc = D.page.getByText(t('drv.accept'), { exact: true }).first(); await acc.waitFor({ timeout: 45000 }); await acc.scrollIntoViewIfNeeded(); await D.page.waitForTimeout(800); await shot(D, 'd02-offer'); });
await step('accept', async () => { await D.page.getByText(t('drv.accept'), { exact: true }).first().click(); await D.page.getByTestId('drv-chat').waitFor({ timeout: 40000 }); await D.page.getByTestId('drv-chat').scrollIntoViewIfNeeded(); await D.page.mouse.wheel(0, -120); await shot(D, 'd03-assigned'); await D.page.mouse.move(195, 430); await D.page.mouse.wheel(0, 450); await shot(D, 'd03b-assigned'); });
await step('navigation', async () => { await D.page.getByTestId('drv-nav').click({ timeout: 8000 }); await D.page.waitForTimeout(3500); await shot(D, 'd07-navigation'); await D.page.getByText(t('common.back'), { exact: true }).last().click({ timeout: 5000 }).catch(() => {}); await D.page.waitForTimeout(1200); });
await step('arrive', async () => { await call('POST', '/drivers/me/location', { t: dtok, body: { lat: -1.9541, lng: 30.0928 } }); await call('POST', `/bookings/${bid}/en-route`, { t: dtok }); await call('POST', `/bookings/${bid}/arrived`, { t: dtok }); await D.page.waitForTimeout(12000); await D.page.getByTestId('drv-chat').scrollIntoViewIfNeeded().catch(() => {}); await D.page.mouse.wheel(0, -120); await shot(D, 'd04-arrived'); await D.page.mouse.move(195, 430); await D.page.mouse.wheel(0, 500); await shot(D, 'd04b-arrived'); });
await step('start', async () => { const pv = await call('GET', `/bookings/${bid}`, { t: rider.t }); await call('POST', `/bookings/${bid}/start`, { t: dtok, body: { pin: pv.j.trip_pin } }); await D.page.waitForTimeout(12000); await D.page.getByTestId('drv-chat').scrollIntoViewIfNeeded().catch(() => {}); await D.page.mouse.wheel(0, -120); await shot(D, 'd05-in-progress'); await D.page.mouse.move(195, 430); await D.page.mouse.wheel(0, 500); await shot(D, 'd05b-in-progress'); });
await step('complete', async () => { const c = await call('POST', `/bookings/${bid}/complete`, { t: dtok, body: {} }); await D.page.waitForTimeout(12000); await D.page.mouse.move(195, 300); await D.page.mouse.wheel(0, -2000); await D.page.mouse.wheel(0, 300); await shot(D, 'd06-complete'); await D.page.mouse.wheel(0, 500); await shot(D, 'd06b-complete'); });
await br.close(); await db.end();

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
const car = await call('POST', '/users/me/cars', { t: rider.t, body: { plate: 'RAD 245 K', make: 'Toyota', model: 'Corolla', color: 'Silver', year: 2017, vehicle_class: 'car', transmission: 'automatic', insurance_confirmed: true, insurance_expiry: '2027-06-30' } }); console.log('car', car.s, JSON.stringify(car.j).slice(0, 80));
const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
for (const b of [{ label: 'School run', service_id: 'standard', pickup: { lat: -1.9441, lng: 30.126, name: 'Kimironko' }, dest: { lat: -1.9358, lng: 30.064, name: 'Kacyiru' }, days_of_week: [1, 2, 3, 4, 5], local_time: '07:15', start_date: today, payment_method: 'cash' }, { label: 'Saturday market', service_id: 'moto', pickup: { lat: -1.9441, lng: 30.126, name: 'Kimironko' }, dest: { lat: -1.9395, lng: 30.043, name: 'Nyabugogo' }, days_of_week: [6], local_time: '09:00', start_date: today, payment_method: 'mtn_momo' }]) { const r = await call('POST', '/ride-schedules', { t: rider.t, body: b }); console.log('sched', r.s, JSON.stringify(r.j).slice(0, 100)); }
const P = await mk();
await step('login', () => login(P, '+250788990001', false));
const goto = async (tab) => { await P.page.goto(WEB); await P.page.getByTestId('tabbar').waitFor({ timeout: 25000 }); if (tab) await P.page.getByTestId(tab).click(); await P.page.waitForTimeout(2500); };
const scrollShots = async (x, name, n = 2, dy = 620) => { await x.page.mouse.move(195, 430); for (let k = 0; k < n; k++) { await x.page.mouse.wheel(0, dy); await shot(x, `${name}${k + 1}`); } };
await step('schedules', async () => { await goto(); await P.page.getByText(t('ov.qa.schedule'), { exact: true }).first().click(); await P.page.waitForTimeout(3500); await shot(P, 'a26-schedules'); await scrollShots(P, 'a26b-schedules', 1); });
await step('cars', async () => { await goto('tab-account'); await P.page.getByText(t('ab.cars.title'), { exact: true }).first().click({ timeout: 10000 }); await P.page.waitForTimeout(3000); await shot(P, 'a37-cars'); });
await step('abasare', async () => { await goto(); await P.page.getByText(t('ov.qa.abasare'), { exact: true }).first().click(); await P.page.waitForTimeout(2500);
  await P.page.getByText(t('loc.allow'), { exact: true }).first().click({ timeout: 3000 }).catch(() => {}); await P.page.waitForTimeout(3500); await shot(P, 'a36-abasare-form'); await scrollShots(P, 'a36b-abasare-form', 3, 480);
  await P.page.mouse.wheel(0, 3000); await shot(P, 'a38-abasare-more'); });
await step('trips upcoming', async () => { await goto('tab-trips'); await shot(P, 'a40-trips'); });
await br.close(); await db.end();

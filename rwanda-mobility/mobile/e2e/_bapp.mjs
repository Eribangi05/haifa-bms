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
const P = await mk(), D = await mk();
await step('login', () => login(P, '+250788990001', true));
await step('home', async () => { await P.page.waitForTimeout(2500); await shot(P, 'a04-home'); await P.page.mouse.wheel(0, 700); await shot(P, 'a04b-home-scroll'); await P.page.mouse.wheel(0, -1500); });
await step('book tab', async () => { await P.page.getByTestId('tab-book').click(); await click(P, t('loc.allow')); await P.page.waitForTimeout(4500); await shot(P, 'a05-book-map'); });
await step('destination', async () => { await P.page.getByText(PLACE, { exact: true }).last().click({ timeout: 20000 }); await P.page.waitForTimeout(800); await shot(P, 'a06-destination'); });
await step('options', async () => { await click(P, t('home.seeprices')); await P.page.getByText(t('opt.title')).first().waitFor({ timeout: 25000 }); await shot(P, 'a07-options'); await P.page.mouse.wheel(0, 650); await shot(P, 'a08-options-pay'); await P.page.mouse.wheel(0, 900); await shot(P, 'a08b-options-more'); await P.page.mouse.wheel(0, -3000); });
let bid;
await step('confirm', async () => { await P.page.getByTestId('cta').click(); await P.page.getByText(t('trip.searching')).first().waitFor({ timeout: 25000 }); await shot(P, 'a09-searching'); bid = (await db.query("select id from bookings where passenger_id=(select id from users where phone='+250788990001') and status in ('SEARCHING_DRIVER','REQUESTED') order by created_at desc limit 1")).rows[0]?.id; console.log('booking', bid); });

const back = async (x) => { await x.page.getByText(t('common.back'), { exact: true }).last().click({ timeout: 8000 }).catch(() => x.page.getByTestId('back').first().click({ timeout: 4000 }).catch(() => {})); await x.page.waitForTimeout(1500); };
const scrollShots = async (x, name, n = 2, dy = 620) => { await x.page.mouse.move(195, 430); for (let k = 0; k < n; k++) { await x.page.mouse.wheel(0, dy); await shot(x, `${name}${k + 1}`); } await x.page.mouse.wheel(0, -dy * n - 400); };
const driveTrip = async (id, method) => {
  await call('POST', `/bookings/${id}/accept`, { t: dtok }).then((r) => console.log('accept', r.s));
  await call('POST', '/drivers/me/location', { t: dtok, body: { lat: -1.9541, lng: 30.0928 } }); await call('POST', `/bookings/${id}/en-route`, { t: dtok });
};
await step('driver login', async () => { await login(D, dphone, false); await D.page.getByTestId('tab-account').click(); await D.page.getByTestId('acc-mode').click(); await D.page.getByTestId('tab-home').waitFor({ timeout: 20000 }); await shot(D, 'd01-home'); });
await step('driver offer', async () => { await D.page.getByText(t('drv.accept'), { exact: true }).first().waitFor({ timeout: 40000 }); await shot(D, 'd02-offer'); });
await step('accept', async () => { await call('POST', `/bookings/${bid}/accept`, { t: dtok }); await P.page.getByText(/RE 482 K/).first().waitFor({ timeout: 30000 }); await shot(P, 'a10-driver-found'); await D.page.getByTestId('drv-chat').waitFor({ timeout: 30000 }); await shot(D, 'd03-assigned'); });
await step('chat', async () => { await P.page.getByTestId('pax-chat').click(); await P.page.waitForTimeout(1500); await click(P, L['chat.q.coming'] ?? 'I am coming').catch(() => {}); await shot(P, 'a11-chat'); await back(P); });
await step('arrive', async () => { await call('POST', '/drivers/me/location', { t: dtok, body: { lat: -1.9541, lng: 30.0928 } }); await call('POST', `/bookings/${bid}/en-route`, { t: dtok }); await call('POST', `/bookings/${bid}/arrived`, { t: dtok }); await P.page.waitForTimeout(12000); await shot(P, 'a12-arrived'); await P.page.mouse.move(195, 500); await P.page.mouse.wheel(0, 500); await shot(P, 'a12b-pin'); await shot(D, 'd04-arrived'); });
await step('start', async () => { const pv = await call('GET', `/bookings/${bid}`, { t: (await reg('+250788990001', 'passenger')).t }); const st = await call('POST', `/bookings/${bid}/start`, { t: dtok, body: { pin: pv.j.trip_pin } }); await P.page.waitForTimeout(12000); await P.page.mouse.wheel(0, -900); await shot(P, 'a13-in-progress'); await shot(D, 'd05-in-progress'); });
await step('sos', async () => { await P.page.getByText('SOS', { exact: true }).first().click({ timeout: 10000 }); await shot(P, 'a14-sos'); await P.page.getByText(t('common.close'), { exact: true }).first().click({ timeout: 4000 }).catch(() => P.page.keyboard.press('Escape')); });
await step('share', async () => { await P.page.getByText(t('trip.share'), { exact: true }).first().click({ timeout: 8000 }); await P.page.waitForTimeout(1200); await shot(P, 'a14b-share'); await back(P); });
await step('complete', async () => { const c = await call('POST', `/bookings/${bid}/complete`, { t: dtok, body: {} }); await P.page.waitForTimeout(12000); await shot(P, 'a15-complete'); await shot(D, 'd06-complete'); const fare = c.j?.final_fare ?? c.j?.booking?.final_fare; await call('POST', `/bookings/${bid}/cash-collected`, { t: dtok, body: { amount: fare } }); await P.page.waitForTimeout(10000); await shot(P, 'a16-rate'); await P.page.mouse.move(195, 430); await P.page.mouse.wheel(0, 600); await shot(P, 'a16b-rate'); });
await step('rate', async () => { await P.page.getByText('★', { exact: false }).nth(4).click({ timeout: 4000 }).catch(() => {}); await shot(P, 'a17-rated'); });
// second trip paid with mobile money
await step('momo trip', async () => {
  await P.page.goto(WEB); await P.page.getByTestId('tabbar').waitFor({ timeout: 25000 }); await P.page.getByTestId('tab-book').click(); await P.page.waitForTimeout(3500);
  await P.page.getByText(PLACE, { exact: true }).last().click({ timeout: 20000 }); await click(P, t('home.seeprices')); await P.page.getByText(t('opt.title')).first().waitFor({ timeout: 25000 });
  await P.page.mouse.move(195, 430); await P.page.mouse.wheel(0, 900); await click(P, t('opt.momo.sim')).catch(() => click(P, t('opt.momo'))); await shot(P, 'a18-pay-choice');
  await P.page.mouse.wheel(0, -1500); await P.page.getByTestId('cta').click(); await P.page.getByText(t('trip.searching')).first().waitFor({ timeout: 25000 });
  const id2 = (await db.query("select id from bookings where passenger_id=(select id from users where phone='+250788990001') and status in ('SEARCHING_DRIVER','REQUESTED') order by created_at desc limit 1")).rows[0].id;
  await call('POST', `/bookings/${id2}/accept`, { t: dtok }); await call('POST', '/drivers/me/location', { t: dtok, body: { lat: -1.9541, lng: 30.0928 } }); await call('POST', `/bookings/${id2}/en-route`, { t: dtok }); await call('POST', `/bookings/${id2}/arrived`, { t: dtok });
  const pv = await call('GET', `/bookings/${id2}`, { t: (await reg('+250788990001', 'passenger')).t }); await call('POST', `/bookings/${id2}/start`, { t: dtok, body: { pin: pv.j.trip_pin } }); await call('POST', `/bookings/${id2}/complete`, { t: dtok, body: {} });
  await P.page.waitForTimeout(14000); await shot(P, 'a19-momo-due'); await P.page.mouse.move(195, 500); await P.page.mouse.wheel(0, 500); await shot(P, 'a19b-momo-due');
  await click(P, t('trip.pay.momo')); await P.page.waitForTimeout(2500); await shot(P, 'a20-momo-waiting'); await P.page.waitForTimeout(12000); await shot(P, 'a21-momo-done');
});
// the rest of the rider app
const tabShot = async (tab, name, extra) => { await P.page.goto(WEB); await P.page.getByTestId('tabbar').waitFor({ timeout: 25000 }); await P.page.getByTestId(tab).click(); await P.page.waitForTimeout(3500); await shot(P, name); if (extra) await extra(); };
await step('trips', () => tabShot('tab-trips', 'a22-trips', () => scrollShots(P, 'a22b-trips', 1)));
await step('wallet', () => tabShot('tab-wallet', 'a23-wallet', () => scrollShots(P, 'a23b-wallet', 1)));
await step('account', () => tabShot('tab-account', 'a24-account', () => scrollShots(P, 'a24b-account', 2)));
const quick = async (key, name, more) => { await P.page.goto(WEB); await P.page.getByTestId('tabbar').waitFor({ timeout: 25000 }); await P.page.waitForTimeout(1500); await click(P, t(key)); await P.page.waitForTimeout(3000); await shot(P, name); if (more) await more(); };
await step('abasare', () => quick('ov.qa.abasare', 'a25-abasare', () => scrollShots(P, 'a25b-abasare', 1)));
await step('schedules', () => quick('ov.qa.schedule', 'a26-schedules'));
await step('places', () => quick('ov.qa.places', 'a27-places'));
await step('scan', () => quick('ov.qa.scan', 'a28-scan'));
const accItem = async (key, name, more) => { await P.page.goto(WEB); await P.page.getByTestId('tabbar').waitFor({ timeout: 25000 }); await P.page.getByTestId('tab-account').click(); await P.page.waitForTimeout(2000); await P.page.getByText(t(key), { exact: true }).first().click({ timeout: 12000 }); await P.page.waitForTimeout(3000); await shot(P, name); if (more) await more(); };
await step('settings', () => accItem('r1.set.title', 'a29-settings', () => scrollShots(P, 'a29b-settings', 2)));
await step('safety', () => accItem('r1.md.title', 'a30-safety'));
await step('invite', () => accItem('acc.invite', 'a31-invite'));
await step('credit', () => accItem('cr.title', 'a32-credit', () => scrollShots(P, 'a32b-credit', 1)));
await step('claims', () => accItem('cl.title', 'a33-claims'));
await step('recurring', () => accItem('r2.sch.title', 'a34-recurring'));
await step('help', () => accItem('acc.help', 'a35-help'));
// driver app
const dtab = async (tab, name, more) => { await D.page.goto(WEB); await D.page.getByTestId('tabbar').waitFor({ timeout: 25000 }); await D.page.getByTestId(tab).click(); await D.page.waitForTimeout(3500); await shot(D, name); if (more) await more(); };
await step('driver tabs', async () => { await dtab('tab-trips', 'd07-trips'); await dtab('tab-earn', 'd08-earnings', () => scrollShots(D, 'd08b-earnings', 2)); await dtab('tab-car', 'd09-car', () => scrollShots(D, 'd09b-car', 1)); await dtab('tab-account', 'd10-profile', () => scrollShots(D, 'd10b-profile', 1)); });
const AP = await mk();
await step('applicant', async () => { await login(AP, '+250788992005', false); await AP.page.getByTestId('tab-account').click(); await AP.page.getByTestId('acc-mode').click(); await AP.page.waitForTimeout(4000); await shot(AP, 'd11-onboarding'); await scrollShots(AP, 'd11b-onboarding', 2); });
await br.close(); await db.end();

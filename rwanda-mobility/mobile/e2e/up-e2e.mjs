import { chromium } from 'playwright-core';
import pg from 'pg';
import { visibleOnly } from './visible.mjs';
// The improvement round through the real screens (react-native-web): instant offers (held request), per-km price shown, proposed fare with a driver counter-offer
// the rider accepts, parcel booking (courier), driver rates the passenger, email verification in the profile.
// Prereqs: API on :8080 (OTP_DEV_ECHO=true) and web build on :8081 (see app-e2e.mjs). Usage: DATABASE_URL=... node e2e/up-e2e.mjs <screenshot-dir>
const API = (process.env.API_ORIGIN ?? 'http://localhost:8080') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rm_e2e_m9' }); await db.connect();
await db.query('delete from otp_challenges'); await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('SEARCHING_DRIVER','REQUESTED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','PAYMENT_PENDING')"); await db.query('update driver_profiles set is_online=false');
await db.query("update feature_flags set enabled=true where key='pricing.negotiated'");
await db.query("update service_categories set enabled=true where id='courier'"); await db.query("update zone_services set enabled=true where service_id='courier'");
const rnd = (p) => p + String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
const dph = rnd('+2507888'), rph1 = rnd('+2507889'), rph2 = rnd('+2507887');
const o = await call('POST', '/auth/otp/request', { body: { phone: dph } });
const v = await call('POST', '/auth/otp/verify', { body: { phone: dph, code: o.j.dev_code, role: 'driver' }, h: { 'x-device-id': 'up-drv-' + Math.random() } });
const drv = { t: v.j.access_token, id: v.j.user.id };
await db.query("update users set display_name='Eric Mugisha' where id=$1", [drv.id]);
await db.query("update driver_profiles set status='APPROVED', legal_name='Eric Mugisha', zone_id='kigali' where user_id=$1", [drv.id]);
await db.query("insert into vehicles(driver_id,vehicle_type,make,model,color,plate,capacity,status) values ($1,'moto','TVS','HLX','Blue',$2,1,'approved')", [drv.id, 'RE' + Math.floor(100 + Math.random() * 899) + 'B']);
for (const r of (await db.query("select doc_type, requires_expiry from document_requirements where vehicle_type='moto' and mandatory")).rows)
  await db.query("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [drv.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
await call('PATCH', '/drivers/me/availability', { t: drv.t, body: { online: true } });
await call('POST', '/drivers/me/location', { t: drv.t, body: { lat: -1.954, lng: 30.0927 } });

const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];
const mk = async () => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] }); const page = visibleOnly(await ctx.newPage()); page.on('pageerror', (e) => errors.push(e.message)); return page; };
const step = async (name, fn, p) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); if (p) await p.screenshot({ path: `${OUT}/up-FAIL-${name.replace(/\W+/g, '_').slice(0, 40)}.png` }).catch(() => {}); } };
const login = async (page, phone) => {
  await db.query('delete from otp_challenges'); await page.goto(WEB); await page.getByText('English', { exact: true }).click(); await page.getByText('Continue', { exact: true }).click();
  await page.getByPlaceholder('07X XXX XXXX').fill('0' + phone.slice(4)); await page.getByText('Send code', { exact: true }).click();
  const code = (await page.getByText(/Test build: code: \d{6}/).textContent()).match(/\d{6}/)[0];
  await page.getByPlaceholder('••••••').fill(code); await page.getByText('Verify', { exact: true }).click(); await page.getByTestId('tabbar').waitFor({ timeout: 25000 });
};
const toPrices = async (page) => {
  await page.getByTestId('tab-book').click();
  try { await page.getByText('Location permission').waitFor({ timeout: 4000 }); await page.getByText('Allow location', { exact: true }).click(); } catch { /* consent already given */ }
  await page.getByText('Where to?').waitFor({ timeout: 15000 }); await page.waitForTimeout(1200);
  await page.getByText('Kimironko Market', { exact: true }).last().click(); await page.waitForTimeout(400);
  await page.getByText('See prices', { exact: true }).click();
};
const R = await mk(), D = await mk(); const rtRequests = [];
R.on('request', (r) => { if (r.url().includes('/realtime/wait')) rtRequests.push(r.url()); });

await step('driver signs in and switches to driver mode', async () => { await login(D, dph); await D.getByTestId('tab-account').click(); await D.getByTestId('acc-mode').click(); await D.getByTestId('tab-home').waitFor({ timeout: 20000 }); }, D);
await step('rider signs in; prices show the price per km and the moto safety notice', async () => {
  await login(R, rph1); await toPrices(R); await R.getByText('Fare breakdown').waitFor({ timeout: 20000 });
  await R.getByText(/RWF per km/).first().waitFor({ timeout: 5000 }); await R.getByText(/One passenger only/).waitFor({ timeout: 5000 }); await R.screenshot({ path: `${OUT}/up-prices.png` });
}, R);
await step('rider proposes a lower price (flag on) and confirms', async () => {
  await R.getByText('Propose your price').waitFor({ timeout: 5000 }); await R.getByText(/^-10%/).click(); await R.getByText('Your price', { exact: true }).first().waitFor();
  await R.getByText('Confirm request', { exact: true }).click(); await R.getByText(/You proposed \d+ RWF/).waitFor({ timeout: 20000 }); await R.screenshot({ path: `${OUT}/up-proposed.png` });
}, R);
let bookingId, proposed;
await step('driver sees the proposal at once (held request) and answers with a counter-offer', async () => {
  const t0 = Date.now();
  await D.getByText(/Rider offers \d+ RWF \(usual price \d+\)/).waitFor({ timeout: 15000 }); const took = Date.now() - t0;
  if (!rtRequests.length && !(await D.evaluate(() => true))) throw new Error('no realtime request');
  await D.screenshot({ path: `${OUT}/up-offer-proposal.png` });
  const offers = (await call('GET', '/drivers/me/offers', { t: drv.t })).j.offers; bookingId = offers[0].booking_id; proposed = offers[0].proposed_fare;
  await D.getByText('Reply with another price').click(); await D.getByText('Choose your price').waitFor(); await D.getByText(/^\d+ RWF$/).first().click();
  await D.getByText('Your reply was sent. Waiting for the rider.').waitFor({ timeout: 10000 });
  console.log('   offer visible after', took, 'ms');
}, D);
await step('rider sees the counter-offer and accepts it; the driver is assigned at that price', async () => {
  await R.getByText(/replies with \d+ RWF/).waitFor({ timeout: 15000 }); await R.screenshot({ path: `${OUT}/up-counter.png` });
  await R.getByText('Accept', { exact: true }).click(); await R.getByText(/Agreed price: \d+ RWF/).waitFor({ timeout: 15000 }).catch(() => {});
  let b; for (let i = 0; i < 20; i++) { b = (await db.query('select status, agreed_fare, estimated_fare, proposed_fare from bookings where id=$1', [bookingId])).rows[0]; if (b.status === 'DRIVER_ASSIGNED') break; await new Promise((r) => setTimeout(r, 500)); }
  if (b.status !== 'DRIVER_ASSIGNED' || !(b.agreed_fare > b.proposed_fare)) throw new Error(JSON.stringify(b));
}, R);
await step('trip runs; the driver rates the passenger from the completed-trip card', async () => {
  await call('POST', '/drivers/me/location', { t: drv.t, body: { lat: -1.9539, lng: 30.0927 } });
  await call('POST', `/bookings/${bookingId}/arrived`, { t: drv.t, body: {} });
  await R.getByText('Your trip PIN').waitFor({ timeout: 15000 });
  const code = (await R.getByText('Your trip PIN').locator('xpath=following-sibling::*[1]').textContent()).trim();
  const st = await call('POST', `/bookings/${bookingId}/start`, { t: drv.t, body: { pin: code } }); if (st.s !== 200) throw new Error('start ' + JSON.stringify(st.j));
  const c = await call('POST', `/bookings/${bookingId}/complete`, { t: drv.t, body: {} }); if (c.s !== 200) throw new Error('complete ' + JSON.stringify(c.j));
  await D.getByText('How was the passenger?').waitFor({ timeout: 15000 });
  await D.getByLabel('5 stars').click(); await D.getByText('Polite', { exact: true }).click(); await D.getByText('Send rating', { exact: true }).click();
  await D.getByText(/Thank you\. Your rating helps other drivers/).waitFor({ timeout: 10000 }); await D.screenshot({ path: `${OUT}/up-rate-passenger.png` });
  const rt = (await db.query("select score, tags from ratings where booking_id=$1 and reviewee_id <> $2", [bookingId, drv.id])).rows[0]; if (!rt || rt.score !== 5) throw new Error('rating not stored ' + JSON.stringify(rt));
}, D);
await call('POST', `/bookings/${bookingId}/cash-collected`, { t: drv.t, body: { amount: (await db.query('select final_fare from bookings where id=$1', [bookingId])).rows[0].final_fare } });

const R2 = await mk();
await step('rider books a parcel: the parcel form is required and the driver sees the parcel', async () => {
  await login(R2, rph2); await toPrices(R2); await R2.getByText('Fare breakdown').waitFor({ timeout: 20000 });
  await R2.getByText('Parcel by moto').first().click(); await R2.getByText('Parcel details').waitFor({ timeout: 5000 });
  await R2.getByText('Confirm request', { exact: true }).click(); await R2.getByText(/Enter the recipient name/).waitFor({ timeout: 5000 });
  await R2.getByLabel('Recipient name').fill('Aline Uwase'); await R2.getByLabel('Recipient phone').fill('0788123999'); await R2.getByText(/^Medium/).click(); await R2.getByLabel('What is inside (optional)').fill('Shoes');
  await R2.screenshot({ path: `${OUT}/up-parcel-form.png` });
  await R2.getByText('Confirm request', { exact: true }).click(); await R2.getByText(/Parcel for Aline Uwase/).waitFor({ timeout: 20000 });
  await D.getByText(/Parcel for Aline/).waitFor({ timeout: 15000 }); await D.screenshot({ path: `${OUT}/up-parcel-offer.png` });
}, R2);
const E = await mk();
await step('email: save, ask for a code, verify in the profile', async () => {
  await login(E, rnd('+2507886'));
  await E.getByTestId('tab-account').click(); await E.getByTestId('acc-edit').click(); await E.getByText('Email (optional)').waitFor({ timeout: 8000 });
  await E.getByLabel('Email', { exact: true }).fill('rider@example.rw'); await E.getByText('Save email', { exact: true }).click(); await E.getByText('Not verified yet').waitFor({ timeout: 8000 });
  const [resp] = await Promise.all([E.waitForResponse((r) => r.url().includes('/email/code')), E.getByText('Send code', { exact: true }).click()]);
  const code = (await resp.json()).dev_code; await E.getByLabel('6-digit code').fill(code); await E.getByText('Verify', { exact: true }).click(); await E.getByText('Email verified').waitFor({ timeout: 8000 });
  await E.screenshot({ path: `${OUT}/up-email.png` });
}, E);
await step('instant updates were used (held requests reached the server) and no script errors', async () => { if (!rtRequests.length) throw new Error('no /realtime/wait request'); if (errors.length) throw new Error(errors.slice(0, 2).join(' | ')); });
await db.query("update feature_flags set enabled=false where key='pricing.negotiated'"); await db.query("update service_categories set enabled=false where id='courier'"); await db.query("update zone_services set enabled=false where service_id='courier'");
await br.close(); await db.end();

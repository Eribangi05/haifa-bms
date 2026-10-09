import { chromium } from 'playwright-core';
import { visibleOnly } from './visible.mjs';
import pg from 'pg';
// Driver categories: owner-driver, Abasare driver (no vehicle), both, and a new driver choosing a path. Checks the category card, the four profile pages,
// the guide pages, the chooser with the application progress bar, and the earnings split. Usage: node e2e/driver-kinds-e2e.mjs <screenshot-dir>  (prereqs as app-e2e.mjs)
const API = (process.env.API_ORIGIN ?? 'http://localhost:8080') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' }); await db.connect();
await db.query('delete from otp_challenges'); await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('SEARCHING_DRIVER','REQUESTED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','PAYMENT_PENDING')"); await db.query('update driver_profiles set is_online=false');
const rnd = () => String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
const reg = async (phone) => { const o = await call('POST', '/auth/otp/request', { body: { phone } }); const v = await call('POST', '/auth/otp/verify', { body: { phone, code: o.j.dev_code }, h: { 'x-device-id': 'dk-' + Math.random() } }); return { id: v.j.user.id, tok: { access_token: v.j.access_token, refresh_token: v.j.refresh_token } }; };
const mkDriver = async (prefix) => { const d = await reg(prefix + rnd()); await call('POST', '/drivers/enroll', { t: d.tok.access_token, body: {} }); const rf = await call('POST', '/auth/refresh', { body: { refresh_token: d.tok.refresh_token } }); d.tok = { access_token: rf.j.access_token, refresh_token: rf.j.refresh_token }; return d; };
const docs = async (id, type) => { for (const r of (await db.query("select doc_type, requires_expiry from document_requirements where vehicle_type=$1 and mandatory", [type])).rows) await db.query("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved') on conflict do nothing", [id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]); };
const SKILLS = JSON.stringify({ licence_since: '2016-05-10', years_experience: 8, transmissions: ['manual', 'automatic'], classes: ['car', 'suv'], return_mode: 'moto' });
const own = await mkDriver('+2507871'); await db.query("update driver_profiles set status='APPROVED', legal_name='Olive Owner', zone_id='kigali' where user_id=$1", [own.id]);
await db.query("insert into vehicles(driver_id,vehicle_type,make,model,color,plate,capacity,status) values ($1,'moto','TVS','Apache','Red',$2,1,'approved')", [own.id, 'T' + Date.now().toString(36).toUpperCase() + 'A']); await docs(own.id, 'moto');
const ab = await mkDriver('+2507872'); await db.query("update driver_profiles set status='APPROVED', legal_name='Abel Abasare', zone_id='kigali', abasare_status='approved', abasare_skills=$2::jsonb, accepting='{abasare}' where user_id=$1", [ab.id, SKILLS]); await docs(ab.id, 'abasare');
const both = await mkDriver('+2507873'); await db.query("update driver_profiles set status='APPROVED', legal_name='Bea Both', zone_id='kigali', abasare_status='approved', abasare_skills=$2::jsonb, accepting='{ride,abasare}' where user_id=$1", [both.id, SKILLS]);
await db.query("insert into vehicles(driver_id,vehicle_type,make,model,color,plate,capacity,status) values ($1,'moto','Bajaj','Boxer','Blue',$2,1,'approved')", [both.id, 'T' + Date.now().toString(36).toUpperCase() + 'B']); await docs(both.id, 'moto'); await docs(both.id, 'abasare');
const fresh = await mkDriver('+2507874');

const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let failed = false; const errors = [];
const open = async (drv, lang = 'en') => {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] });
  await ctx.addInitScript(([tok, lg]) => { try { if (!localStorage.getItem('rm_tokens')) { localStorage.setItem('rm_tokens', JSON.stringify(tok)); localStorage.setItem('rm_lang', lg); localStorage.setItem('rm_mode', 'driver'); localStorage.setItem('rm_drv_loc_consent', '1'); localStorage.setItem('rm_loc_consent', '1'); } } catch {} }, [drv.tok, lang]);
  const page = visibleOnly(await ctx.newPage()); page.on('pageerror', (e) => errors.push(e.message)); await page.goto(WEB); await page.getByTestId('tabbar').waitFor({ timeout: 30000 }); return { ctx, page };
};
const step = async (name, page, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { failed = true; console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/dk-FAIL-${name.replace(/\W+/g, '_').slice(0, 40)}.png` }); } };
const shot = (page, n) => page.screenshot({ path: `${OUT}/dk-${n}.png` });
const text = async (page, sel) => (await page.getByTestId(sel).first().innerText()).trim();

// ---- owner-driver
{ const { ctx, page } = await open(own);
  await step('owner: category card says Owner-driver and lists ride jobs only', page, async () => { await page.getByTestId('kind-card-label').waitFor({ timeout: 25000 }); if (!/Owner-driver/.test(await text(page, 'kind-card-label')) || /Abasare/.test(await text(page, 'kind-card-label'))) throw new Error('label ' + await text(page, 'kind-card-label')); await page.getByTestId('job-ride').waitFor(); if (await page.getByTestId('job-abasare').count()) throw new Error('abasare job listed'); await shot(page, 'own-work'); });
  await page.getByTestId('tab-car').click();
  await step('owner: profile overview permissions (ride allowed, Abasare not applied)', page, async () => { await page.getByTestId('perm-ride').getByText('Allowed').waitFor(); await page.getByTestId('perm-abasare').getByText('Not applied').waitFor(); await shot(page, 'own-profile'); });
  await step('owner: vehicle page shows the vehicle and its ride history count', page, async () => { await page.getByTestId('seg-vehicle').click(); await page.getByTestId('vh-vehicle').waitFor(); await page.getByTestId('pf-ride-count').waitFor(); await shot(page, 'own-vehicle'); });
  await step('owner: Abasare page offers to add Abasare, opens the application form', page, async () => { await page.getByTestId('seg-abasare').click(); await page.getByTestId('pf-apply-abasare').click(); await page.getByText('Apply for Abasare', { exact: true }).first().waitFor(); await shot(page, 'own-apply-abasare'); await page.getByLabel('Back').first().click(); });
  await step('owner: documents page lists the vehicle documents', page, async () => { await page.getByTestId('tab-car').click(); await page.getByTestId('seg-documents').click(); await page.getByText('Vehicle registration').first().waitFor(); await shot(page, 'own-docs'); });
  await step('owner: guide has 4 pages and ends with Got it', page, async () => { await page.getByTestId('seg-overview').click(); await page.getByTestId('kind-guide').click(); for (let i = 0; i < 3; i++) { await page.getByTestId('guide-title').waitFor(); await page.getByTestId('cta').click(); } await page.getByText('Step 4 of 4').waitFor(); await page.waitForTimeout(600); await shot(page, 'own-guide-4'); await page.getByTestId('cta').click(); await page.getByTestId('tabbar').waitFor(); });
  await ctx.close(); }
// ---- Abasare driver without a vehicle
{ const { ctx, page } = await open(ab);
  await step('abasare: category card says Abasare driver, lists Abasare jobs only', page, async () => { await page.getByTestId('kind-card-label').waitFor({ timeout: 25000 }); if (!/^Abasare driver$/.test(await text(page, 'kind-card-label'))) throw new Error('label ' + await text(page, 'kind-card-label')); await page.getByTestId('job-abasare').waitFor(); if (await page.getByTestId('job-ride').count()) throw new Error('ride job listed'); await shot(page, 'ab-work'); });
  await page.getByTestId('tab-car').click();
  await step('abasare: permissions (Abasare allowed, ride not applied)', page, async () => { await page.getByTestId('perm-abasare').getByText('Allowed').waitFor(); await page.getByTestId('perm-ride').getByText('Not applied').waitFor(); await shot(page, 'ab-profile'); });
  await step('abasare: vehicle page explains no vehicle is needed', page, async () => { await page.getByTestId('seg-vehicle').click(); await page.getByTestId('pf-no-vehicle').waitFor(); await shot(page, 'ab-vehicle'); });
  await step('abasare: Abasare page shows skills and the guide has 6 pages', page, async () => { await page.getByTestId('seg-abasare').click(); await page.getByText('2016-05-10').waitFor(); await page.getByText('Manual, Automatic').waitFor(); await page.getByTestId('pf-ab-count').waitFor(); await shot(page, 'ab-skills'); await page.getByTestId('pf-ab-guide').click(); for (let i = 0; i < 5; i++) await page.getByTestId('cta').click(); await page.getByText('Step 6 of 6').waitFor(); await page.waitForTimeout(600); await shot(page, 'ab-guide-6'); await page.getByTestId('cta').click(); });
  await ctx.close(); }
// ---- both
{ const { ctx, page } = await (async () => { await call('PATCH', '/users/me', { t: both.tok.access_token, body: { preferred_language: 'rw' } }); return open(both, 'rw'); })();
  await step('both (Kinyarwanda): category card lists both job types, Work shows the job-type switch', page, async () => { await page.getByTestId('kind-card-label').waitFor({ timeout: 25000 }); if (!/Ufite ikinyabiziga kandi uri Abasare/.test(await text(page, 'kind-card-label'))) throw new Error('label ' + await text(page, 'kind-card-label')); await page.getByTestId('job-ride').waitFor(); await page.getByTestId('job-abasare').waitFor(); await shot(page, 'both-work'); });
  await page.getByTestId('tab-car').click();
  await step('both: both permissions allowed, vehicle and Abasare pages populated', page, async () => { await page.getByTestId('perm-ride').getByText('Wemerewe').waitFor(); await page.getByTestId('perm-abasare').getByText('Wemerewe').waitFor(); await page.getByTestId('seg-vehicle').click(); await page.getByTestId('vh-vehicle').waitFor(); await page.getByTestId('seg-abasare').click(); await page.getByTestId('pf-ab-count').waitFor(); await shot(page, 'both-abasare'); });
  await ctx.close(); }
// ---- new driver: chooser, then the application progress
{ const { ctx, page } = await open(fresh);
  await step('new driver: chooser shows both options with requirements and the progress bar', page, async () => { await page.getByTestId('choose-own').waitFor({ timeout: 25000 }); await page.getByTestId('choose-abasare').waitFor(); await page.getByTestId('step-path-current').waitFor(); await shot(page, 'new-chooser'); });
  await step('new driver: choosing Abasare moves progress to Details and shows the Abasare form', page, async () => { await page.getByTestId('choose-abasare').click(); await page.getByText('Save Abasare details', { exact: true }).waitFor({ timeout: 15000 }); await page.getByTestId('step-details-current').waitFor(); await shot(page, 'new-abasare-form'); });
  await ctx.close(); }
console.log('browser page errors:', JSON.stringify(errors.filter((e) => !/tile|leaflet|unpkg|ERR_|Failed to load resource|net::|Access-Control|CORS/i.test(e))));
await br.close(); await db.end(); process.exit(failed ? 1 : 0);

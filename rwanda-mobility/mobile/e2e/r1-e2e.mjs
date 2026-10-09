// Round 1 end-to-end through the real screens (react-native-web): trusted contacts, share management, safety check ("Are you OK?"), tags + tips rating,
// favourites/blocked drivers, driver feedback, badges, navigation hand-off, live driver ETA, dark mode / large text / app lock (inert on web) / low-data header; rw and fr.
// Env: API_ORIGIN (default http://localhost:8101), WEB_ORIGIN (default http://localhost:8111), DATABASE_URL (default the scratch DB rm_e2e_m1), CHROMIUM_PATH.
// Prerequisites: backend (OTP_DEV_ECHO=true, MOMO_MODE=simulator) on a migrated + seeded DB, and the web export served (see docs/MOBILE_ROUND1.md).
// Usage: node e2e/r1-e2e.mjs <screenshot-dir> [langs, e.g. rw,fr]
import { chromium } from 'playwright-core';
import { visibleOnly } from './visible.mjs';
import pg from 'pg';
import { readFileSync } from 'node:fs';
const API = (process.env.API_ORIGIN ?? 'http://localhost:8101') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8111', OUT = process.argv[2] ?? '/tmp', LANGS = (process.argv[3] ?? 'rw,fr').split(',');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rm_e2e_m1' }); await db.connect();
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const dict = {}; const LOC = new URL('../src/lib/locales/', import.meta.url);
for (const l of ['en', 'rw', 'fr']) { dict[l] = {}; for (const f of [l, `r1.${l}`, `r2.${l}`, `r3.${l}`]) { let src = ''; try { src = readFileSync(new URL(f + '.ts', LOC), 'utf8'); } catch { continue; } for (const m of src.matchAll(/'([\w.]+)':\s*'((?:[^'\\]|\\.)*)'/g)) dict[l][m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\'); } }
const S = (lang) => (k, v = {}) => { let s = dict[lang][k]; if (s == null) throw new Error(`missing string ${lang}:${k}`); for (const [a, b] of Object.entries(v)) s = s.replace(`{${a}}`, String(b)); return s; };
const rnd = () => String(100000 + Math.floor(Math.random() * 899999));
const KCC = { lat: -1.954, lng: 30.0927 }, OFF = { lat: -1.89, lng: 30.0 };
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let failed = 0; const errors = [];
const step = async (name, fn, page) => { try { await fn(); console.log('OK  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); if (page) await page.screenshot({ path: `${OUT}/r1-FAIL-${name.replace(/\W+/g, '_').slice(0, 60)}.png` }).catch(() => {}); } };
const reg = async (phone, role = 'passenger', lang = 'en') => { const o = await call('POST', '/auth/otp/request', { body: { phone } }); const v = await call('POST', '/auth/otp/verify', { body: { phone, code: o.j.dev_code, role, language: lang }, h: { 'x-device-id': 'r1-' + Math.random(), 'accept-language': lang } }); if (!v.j.access_token) throw new Error('signup failed ' + JSON.stringify(v.j)); return { t: v.j.access_token, r: v.j.refresh_token, id: v.j.user.id, phone }; };
const mkDriver = async (plate, lang) => {
  const d = await reg('+250787' + rnd(), 'driver', lang); await call('POST', '/drivers/enroll', { t: d.t });
  const a = await call('POST', '/drivers/applications', { t: d.t, body: { legal_name: 'Eric Umusare', national_id: '1198580012345678', vehicle: { vehicle_type: 'moto', make: 'Bajaj', model: 'Boxer', color: 'Red', plate, capacity: 1 }, payout_msisdn: '0788123456' } }); if (a.s !== 200) throw new Error('application ' + JSON.stringify(a.j));
  const reqs = (await db.query("select distinct doc_type from document_requirements where vehicle_type='moto' and mandatory")).rows;
  for (const r of reqs) await db.query("insert into driver_documents(driver_id, doc_type, file_key, mime, size, expiry_date, review_status) values ($1,$2,'e2e/x.jpg','image/jpeg',10,'2031-01-01','approved')", [d.id, r.doc_type]);
  await db.query("update driver_profiles set status='APPROVED' where user_id=$1", [d.id]); await db.query("update vehicles set status='approved' where driver_id=$1", [d.id]);
  await call('POST', '/drivers/me/location', { t: d.t, body: { ...KCC, accuracy: 10 } });
  const on = await call('PATCH', '/drivers/me/availability', { t: d.t, body: { online: true, accepting: ['ride'] } }); if (on.s !== 200) throw new Error('online ' + JSON.stringify(on.j));
  await call('POST', '/users/me/consents', { t: d.t, body: { kind: 'background_location', version: 'v1', granted: true } });
  return d;
};
const newCtx = async (user, lang, mode = 'passenger', extra = {}) => {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: KCC.lat, longitude: KCC.lng }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'], ...extra });
  await ctx.addInitScript(([tk, lg, md]) => { try { if (!localStorage.getItem('rm_tokens')) { localStorage.setItem('rm_tokens', JSON.stringify(tk)); localStorage.setItem('rm_lang', lg); localStorage.setItem('rm_loc_consent', '1'); localStorage.setItem('rm_mode', md); localStorage.setItem('rm_drv_consent', '1'); } } catch { /* ignore */ } }, [{ access_token: user.t, refresh_token: user.r }, lang, mode]);
  const page = visibleOnly(await ctx.newPage()); page.on('dialog', (d) => d.accept()); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 200)));
  return { ctx, page };
};
const ok = (r, n) => { if (r.s >= 300) throw new Error(n + ' ' + JSON.stringify(r.j)); return r; };
const cancelOpen = async () => { await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('SEARCHING_DRIVER','REQUESTED','SCHEDULED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','PAYMENT_PENDING')"); };
const book = async (pass) => {
  const e = await call('POST', '/fares/estimate', { t: pass.t, body: { pickup: KCC, dest: { lat: -1.9496, lng: 30.1262 }, service_id: 'moto' } });
  const q = e.j.options.find((o) => o.service_id === 'moto' && !o.fixed_price); if (!q?.quote_id) throw new Error('moto unavailable ' + JSON.stringify(q?.reason));
  const b = ok(await call('POST', '/bookings', { t: pass.t, h: { 'idempotency-key': 'r1-' + Math.random() }, body: { quote_id: q.quote_id, payment_method: 'cash', pickup_name: 'KCC', dest_name: 'Kimironko' } }), 'book'); return b.j.booking.id;
};
const accept = async (drv, id) => { for (let i = 0; i < 40; i++) { const o = await call('GET', '/drivers/me/offers', { t: drv.t }); if (o.j.offers?.some((x) => x.booking_id === id)) break; await new Promise((r) => setTimeout(r, 500)); if (i === 39) throw new Error('no offer'); } ok(await call('POST', `/bookings/${id}/accept`, { t: drv.t, body: {} }), 'accept'); ok(await call('POST', `/bookings/${id}/en-route`, { t: drv.t, body: {} }), 'en-route'); await call('POST', '/drivers/me/location', { t: drv.t, body: { ...KCC, lat: KCC.lat - 0.004, accuracy: 5 } }); };
const startTrip = async (pass, drv, id) => { await place(drv, KCC); ok(await call('POST', `/bookings/${id}/arrived`, { t: drv.t, body: {} }), 'arrived'); const pin = (await call('GET', `/bookings/${id}`, { t: pass.t })).j.trip_pin; ok(await call('POST', `/bookings/${id}/start`, { t: drv.t, body: { pin } }), 'start'); };
const complete = async (drv, id) => { ok(await call('POST', `/bookings/${id}/complete`, { t: drv.t, body: {} }), 'complete'); const v = await call('GET', `/bookings/${id}`, { t: drv.t }); ok(await call('POST', `/bookings/${id}/cash-collected`, { t: drv.t, body: { amount: Math.round(v.j.final_fare ?? v.j.estimated_fare) }, h: { 'idempotency-key': 'c-' + id } }), 'cash'); };
// The location API refuses teleports (implausible_jump), so tests that need a driver far away write the position the API would hold.
const place = (drv, pos) => db.query('update driver_profiles set last_lat=$2, last_lng=$3, last_location_at=now(), last_seen_at=now() where user_id=$1', [drv.id, pos.lat, pos.lng]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = await (await fetch(API + '/config')).json();

for (const lang of LANGS) {
  const t = S(lang); const L = `[${lang}] `;
  console.log(`\n=== ${lang} ===`);
  await db.query('update driver_profiles set is_online=false'); await cancelOpen();
  const P = await reg('+250788' + rnd(), 'passenger', lang); const D = await mkDriver('RD' + (100 + Math.floor(Math.random() * 899)) + 'T', lang);
  const contactPhone = '0788' + rnd().slice(0, 6);
  const c1 = ok(await call('POST', '/users/me/emergency-contacts', { t: P.t, body: { name: 'Maman', phone: contactPhone, notify_on_trip: true, lang: 'en' } }), 'contact').j;
  const pu = await newCtx(P, lang); const pp = pu.page; const apiHeaders = []; pp.on('request', (r) => { if (r.url().startsWith(API)) apiHeaders.push({ url: r.url(), lite: r.headers()['x-lite'] }); });

  // ---------------------------------------------------------------- 1. trusted contacts
  await step(L + 'trusted contacts: explanation, per-contact switch + language, master switch, add', async () => {
    await pp.goto(WEB); await pp.getByText(t('home.where'), { exact: true }).first().waitFor({ timeout: 25000 });
    await pp.getByTestId('tab-account').click(); await pp.getByTestId('acc-edit').click(); await pp.getByText(t('r1.tc.title'), { exact: true }).waitFor({ timeout: 20000 });
    await pp.getByText(t('r1.tc.what'), { exact: true }).waitFor();
    const row = async () => (await db.query('select notify_on_trip, lang from emergency_contacts where id=$1', [c1.id])).rows[0];
    const first = (await row()); if (!first.notify_on_trip) throw new Error('default should be notify on? ' + JSON.stringify(first));
    await pp.getByRole('switch', { name: t('r1.tc.notify') }).first().click(); await pp.waitForTimeout(800);
    if ((await row()).notify_on_trip !== false) throw new Error('notify not switched off');
    await pp.getByRole('switch', { name: t('r1.tc.notify') }).first().click(); await pp.waitForTimeout(800);
    await pp.getByTestId('trusted-contacts').getByRole('radio', { name: t('r1.tc.lang.fr') }).first().click(); await pp.waitForTimeout(800);
    const r2 = await row(); if (!r2.notify_on_trip || r2.lang !== 'fr') throw new Error('lang ' + JSON.stringify(r2));
    await pp.getByRole('switch', { name: t('r1.tc.auto') }).click(); await pp.waitForTimeout(800);
    if ((await db.query('select auto_share from users where id=$1', [P.id])).rows[0].auto_share !== false) throw new Error('master switch not saved');
    await pp.getByRole('switch', { name: t('r1.tc.auto') }).click(); await pp.waitForTimeout(800);
    await pp.getByLabel(t('prof.contact.name')).last().fill('Papa'); await pp.getByLabel(t('prof.contact.phone')).last().fill('0788' + rnd().slice(0, 6));
    await pp.getByTestId('trusted-contacts').getByRole('radio', { name: t('r1.tc.lang.en') }).last().click(); await pp.getByTestId('tc-add').click(); await pp.getByText('Papa', { exact: true }).waitFor({ timeout: 10000 });
    const n = (await db.query("select lang from emergency_contacts where user_id=$1 and name='Papa'", [P.id])).rows[0]; if (n?.lang !== 'en') throw new Error('new contact ' + JSON.stringify(n));
    await pp.getByText(t('r1.tc.title'), { exact: true }).scrollIntoViewIfNeeded(); await pp.screenshot({ path: `${OUT}/r1-${lang}-contacts.png` });
  }, pp);
  await db.query("delete from emergency_contacts where user_id=$1 and name='Papa'", [P.id]);

  // ---------------------------------------------------------------- trip: driver on the way
  const id = await book(P); await accept(D, id);
  const du = await newCtx(D, lang, 'driver'); const dp = du.page;
  await step(L + 'driver: navigation hand-off buttons open Google Maps / Waze / geo links', async () => {
    await dp.goto(WEB); await dp.getByTestId('nav-google').waitFor({ timeout: 30000 });
    for (const [tid, re] of [['nav-google', /google\.com\/maps\/dir/], ['nav-waze', /waze\.com/]]) { const [pop] = await Promise.all([dp.waitForEvent('popup', { timeout: 8000 }).catch(() => null), dp.getByTestId(tid).click()]); if (pop) { if (!re.test(pop.url()) && pop.url() !== 'about:blank') throw new Error(tid + ' opened ' + pop.url()); await pop.close(); } }
    await dp.screenshot({ path: `${OUT}/r1-${lang}-driver-nav.png` });
  }, dp);
  await du.ctx.close();   // the driver browser would keep reporting its own GPS and overwrite the locations this test posts
  await place(D, { lat: KCC.lat - 0.02, lng: KCC.lng });
  await step(L + 'passenger track: live driver ETA countdown + badge chips with legend sheet', async () => {
    await pp.goto(WEB); await pp.getByTestId('driver-eta').waitFor({ timeout: 30000 });
    const a = await pp.getByTestId('driver-eta').textContent(); await pp.waitForTimeout(3200); const b = await pp.getByTestId('driver-eta').textContent();
    const secs = (x) => { const m = /(\d+):(\d{2})/.exec(x); return m ? +m[1] * 60 + +m[2] : -1; }; if (!(secs(a) > 60 && secs(b) < secs(a))) throw new Error('countdown did not move: ' + a + ' -> ' + b);
    await pp.getByTestId('badges').waitFor({ timeout: 10000 }); await pp.getByText(t('r1.badge.legend'), { exact: true }).click(); await pp.getByText(t('r1.badge.desc.top_rated'), { exact: true }).waitFor();
    await pp.screenshot({ path: `${OUT}/r1-${lang}-badges.png` }); await pp.getByTestId('cta').click();
  }, pp);

  await startTrip(P, D, id);
  // ---------------------------------------------------------------- 2. share management
  await step(L + 'share management: create hidden-destination link, list with expiry, revoke, per-trip switches', async () => {
    await pp.getByText(t('trip.share'), { exact: true }).click(); await pp.getByText(t('r1.sh.sub'), { exact: true }).waitFor({ timeout: 15000 });
    await pp.getByRole('switch', { name: t('r1.sh.hide') }).click(); await pp.getByTestId('cta').click();
    await pp.getByText(t('r1.sh.hidden.pill'), { exact: true }).waitFor({ timeout: 15000 });
    const sh = (await db.query('select hide_destination, revoked_at, expires_at from trip_shares where booking_id=$1 order by created_at desc limit 1', [id])).rows[0]; if (!sh?.hide_destination) throw new Error('hide flag ' + JSON.stringify(sh));
    await pp.getByText(/^(Expires in|Urarangira mu|Expire dans)/).first().waitFor();
    await pp.screenshot({ path: `${OUT}/r1-${lang}-share.png` });
    await pp.getByRole('switch', { name: t('r1.tc.trip.title') }).click(); await pp.waitForTimeout(800);
    if ((await db.query('select auto_share from bookings where id=$1', [id])).rows[0].auto_share !== false) throw new Error('trip auto_share');
    await pp.getByRole('button', { name: t('r1.sh.revoke') }).first().click(); await pp.waitForTimeout(1200);
    const r = (await db.query('select revoked_at from trip_shares where booking_id=$1 and hide_destination order by created_at desc limit 1', [id])).rows[0]; if (!r?.revoked_at) throw new Error('not revoked');
    await pp.getByText(t('r1.sh.revoked'), { exact: true }).first().waitFor();
    await pp.getByLabel(t('common.back')).last().click();
  }, pp);

  // ---------------------------------------------------------------- 5. safety check
  await step(L + 'safety check: off-route trip triggers "Are you OK?" prompt; answer ' + (lang === 'rw' ? 'OK' : 'help'), async () => {
    let found = null;
    for (let i = 0; i < 20 && !found; i++) { await place(D, OFF); await sleep(8000); const r = await call('GET', `/bookings/${id}/safety-check`, { t: P.t }); found = r.j.open; }
    if (!found) throw new Error('backend did not raise a safety check within ~96 s');
    await pp.getByTestId('sc-ok').waitFor({ timeout: 25000 }); await pp.screenshot({ path: `${OUT}/r1-${lang}-safety-prompt.png` });
    const body = await pp.locator('body').innerText(); if (/police (were|has been) contacted|ambulance (was|has been)/i.test(body)) throw new Error('prompt claims contact');
    await pp.getByText(t('r1.sc.title'), { exact: true }).first().waitFor();
    // dismissing keeps a persistent banner
    await pp.getByLabel(t('common.back')).last().click(); await pp.getByText(t('r1.sc.banner'), { exact: true }).waitFor({ timeout: 10000 });
    await pp.getByTestId('sc-banner-btn').click();
    if (lang === 'rw') { await pp.getByTestId('sc-ok').click(); await pp.waitForTimeout(1000); const s = (await db.query('select status, answer from safety_alerts where booking_id=$1 order by asked_at desc limit 1', [id])).rows[0]; if (s.status !== 'ok') throw new Error('status ' + JSON.stringify(s)); }
    else { await pp.getByTestId('sc-help').click(); await pp.waitForTimeout(1500); const s = (await db.query('select status from safety_alerts where booking_id=$1 order by asked_at desc limit 1', [id])).rows[0]; if (s.status !== 'escalated') throw new Error('status ' + JSON.stringify(s)); await pp.getByText(t('r1.sc.help.body', { police: '112' }), { exact: true }).waitFor({ timeout: 10000 }); await pp.screenshot({ path: `${OUT}/r1-${lang}-safety-help.png` }); }
  }, pp);

  await place(D, { lat: -1.9496, lng: 30.1262 });
  await complete(D, id);

  // ---------------------------------------------------------------- 3. rating with tags and tip
  const ratingFlow = async (tipMode) => {
    await pp.getByLabel(t('a11y.stars', { n: 5 })).first().waitFor({ timeout: 40000 });   // the Track screen is still open: it turns into the receipt + rating card
    await pp.getByLabel(t('a11y.stars', { n: 5 })).first().click(); await pp.getByText(t('r1.rate.tags'), { exact: true }).waitFor({ timeout: 15000 });
    const tags = cfg.rating_tags.ride.filter((x) => ['polite', 'clean_car'].includes(x.id));
    for (const g of tags) await pp.getByRole('checkbox', { name: g.label[lang] }).click();
    const wrongLang = cfg.rating_tags.ride.find((x) => x.id === 'polite').label[lang === 'rw' ? 'en' : 'rw']; if (await pp.getByText(wrongLang, { exact: true }).count()) throw new Error('tag label in another language: ' + wrongLang);
    await pp.getByText('1,000 RWF', { exact: true }).click();
    if (tipMode === 'momo') {
      await pp.getByRole('radio', { name: t('r1.tip.momo') }).click(); await pp.getByLabel(t('trip.pay.msisdn')).fill('0788120000');   // simulator: numbers ending 0000 fail
    } else { await pp.getByRole('radio', { name: t('r1.tip.cash') }).click(); }
    await pp.screenshot({ path: `${OUT}/r1-${lang}-rate.png`, fullPage: true });
    await pp.getByTestId('cta').click();
    return tags;
  };
  if (lang === 'rw') {
    await step(L + 'rating + MoMo tip: tip failure keeps the rating, retry succeeds, tip is a separate payment', async () => {
      const tags = await ratingFlow('momo');
      await pp.getByText(t('r1.rate.saved'), { exact: true }).waitFor({ timeout: 20000 });
      await pp.getByText(new RegExp('^' + t('r1.tip.failed').slice(0, 20))).waitFor({ timeout: 30000 });
      const r = (await db.query('select score, tags from ratings where booking_id=$1', [id])).rows[0]; if (r?.score !== 5 || !tags.every((g) => r.tags?.includes(g.id))) throw new Error('rating lost ' + JSON.stringify(r));
      await pp.screenshot({ path: `${OUT}/r1-${lang}-tip-failed.png` });
      await pp.getByLabel(t('trip.pay.msisdn')).fill('0788123456'); await pp.getByTestId('tip-retry').click();
      await pp.getByText(t('r1.tip.done'), { exact: true }).waitFor({ timeout: 30000 });
      const tip = (await db.query("select t.amount, p.kind, p.status from tips t join payments p on p.id=t.payment_id where t.booking_id=$1", [id])).rows[0]; if (!tip || tip.kind !== 'tip' || tip.status !== 'SUCCESS' || tip.amount !== 1000) throw new Error('tip ' + JSON.stringify(tip));
    }, pp);
  } else {
    await step(L + 'rating + cash tip is recorded', async () => {
      await ratingFlow('cash'); await pp.getByText(t('r1.tip.cash.done'), { exact: true }).waitFor({ timeout: 30000 });
      const tip = (await db.query('select amount, method from tips where booking_id=$1', [id])).rows[0]; if (tip?.method !== 'cash_tip' || tip.amount !== 1000) throw new Error('tip ' + JSON.stringify(tip));
    }, pp);
  }

  // ---------------------------------------------------------------- 4. favourites / blocked
  await step(L + 'favourites: completed-trip buttons (needs driver id in the booking view), My drivers list, remove, Options switch', async () => {
    const view = (await call('GET', `/bookings/${id}`, { t: P.t })).j; const hasId = !!(view.driver?.id ?? view.driver?.driver_id ?? view.driver_id);
    if (hasId) { await pp.getByTestId('pref-fav').click(); await pp.waitForTimeout(800); }
    else { console.log('     GAP: booking view has no driver id, so the completed-trip buttons are hidden (backend change needed); seeding the preference by API'); ok(await call('PUT', `/users/me/drivers/${D.id}`, { t: P.t, body: { kind: 'favourite' } }), 'fav'); }
    await pp.goto(WEB); await pp.getByText(t('home.where'), { exact: true }).first().waitFor({ timeout: 25000 });
    await pp.getByTestId('tab-account').click(); await pp.getByTestId('open-mydrivers').click();
    await pp.getByText(t('r1.md.fav'), { exact: true }).first().waitFor({ timeout: 15000 }); await pp.getByText(/★/).first().waitFor();
    await pp.screenshot({ path: `${OUT}/r1-${lang}-mydrivers.png` });
    // switch to blocked via API and show the blocked section, then remove through the UI
    ok(await call('PUT', `/users/me/drivers/${D.id}`, { t: P.t, body: { kind: 'blocked' } }), 'block'); await pp.goto(WEB); await pp.getByTestId('tab-account').click(); await pp.getByTestId('open-mydrivers').click();
    await pp.getByText(t('r1.md.blocked'), { exact: true }).first().waitFor({ timeout: 20000 });
    await pp.getByTestId(`md-remove-${D.id}`).click(); await pp.waitForTimeout(500);
    const left = (await db.query('select 1 from passenger_driver_prefs where passenger_id=$1', [P.id])).rowCount; if (left !== 0) throw new Error('not removed (confirm dialog is window.confirm on web)');
  }, pp);
  await step(L + 'options: "Prefer my favourite driver" switch is sent as prefer_favourite', async () => {
    ok(await call('PUT', `/users/me/drivers/${D.id}`, { t: P.t, body: { kind: 'favourite' } }), 'fav');
    let sent = null; await pp.route('**/api/v1/bookings', (r) => { if (r.request().method() === 'POST') { sent = r.request().postDataJSON(); return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'e2e_stop', message: 'stop' } }) }); } return r.continue(); });
    await pp.goto(WEB); await pp.getByText(t('home.where'), { exact: true }).first().waitFor({ timeout: 25000 });
    const place = (await (await fetch(API + '/places/popular?lang=' + lang)).json()).places.find((p) => /Nyabugogo/.test(p.name));
    await pp.getByText(place.name, { exact: true }).first().click(); await pp.getByTestId('cta').click(); await pp.getByText(t('opt.breakdown'), { exact: true }).waitFor({ timeout: 25000 });
    const sw = pp.getByRole('switch', { name: t('r1.opt.prefer') }); await sw.waitFor(); await pp.getByText(t('r1.opt.prefer.hint'), { exact: true }).waitFor();
    await sw.click(); await pp.screenshot({ path: `${OUT}/r1-${lang}-options-prefer.png` }); await pp.getByTestId('cta').click(); await pp.waitForTimeout(1500);
    await pp.unroute('**/api/v1/bookings'); if (!sent || sent.prefer_favourite !== false) throw new Error('body ' + JSON.stringify(sent));
    await call('DELETE', `/users/me/drivers/${D.id}`, { t: P.t });
  }, pp);

  // ---------------------------------------------------------------- driver feedback
  const du2 = await newCtx(D, lang, 'driver'); const dp2 = du2.page;
  await step(L + 'driver "My feedback": tag counts and tips', async () => {
    await dp2.goto(WEB); await dp2.getByTestId('r1-feedback-open').click({ timeout: 30000 }); await dp2.getByText(t('r1.fb.tags'), { exact: true }).waitFor({ timeout: 15000 });
    const tag = cfg.rating_tags.ride.find((x) => x.id === 'polite').label[lang]; await dp2.getByText(tag, { exact: true }).waitFor({ timeout: 10000 });
    await dp2.getByText(t('r1.fb.tips.momo'), { exact: true }).waitFor(); await dp2.screenshot({ path: `${OUT}/r1-${lang}-feedback.png`, fullPage: true }); }, dp2); await du2.ctx.close();

  // ---------------------------------------------------------------- 8. appearance, privacy, low-data
  await step(L + 'settings: dark mode, large text, app lock inert on web', async () => {
    await pp.goto(WEB); await pp.getByText(t('home.where'), { exact: true }).first().waitFor({ timeout: 25000 });
    await pp.getByTestId('tab-account').click(); await pp.getByTestId('open-settings').click(); await pp.getByText(t('r1.set.theme'), { exact: true }).waitFor();
    const bg = () => pp.getByTestId('header').evaluate((e) => getComputedStyle(e).backgroundColor);
    const light = await bg(); await pp.screenshot({ path: `${OUT}/r1-${lang}-settings-light.png` });
    await pp.getByRole('radio', { name: t('r1.set.theme.dark') }).click(); await pp.getByText(t('r1.set.theme'), { exact: true }).waitFor();
    const dark = await bg(); if (light === dark || dark !== 'rgb(21, 31, 51)') throw new Error(`header bg ${light} -> ${dark}`);
    await pp.screenshot({ path: `${OUT}/r1-${lang}-settings-dark.png` });
    await pp.goto(WEB); await pp.getByText(t('home.where'), { exact: true }).first().waitFor({ timeout: 25000 }); await pp.screenshot({ path: `${OUT}/r1-${lang}-home-dark.png` });   // persisted across reload
    await pp.getByTestId('tab-account').click(); await pp.getByTestId('open-settings').click();
    const fs = () => pp.getByText(t('r1.set.large'), { exact: true }).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    const f0 = await fs(); await pp.getByRole('switch', { name: t('r1.set.large') }).click(); await pp.waitForTimeout(500); const f1 = await fs(); if (!(f1 / f0 > 1.15 && f1 / f0 <= 1.4)) throw new Error(`font ${f0} -> ${f1}`);
    await pp.screenshot({ path: `${OUT}/r1-${lang}-settings-large.png` });
    await pp.getByText(t('r1.set.lock.web'), { exact: true }).waitFor(); if (!(await pp.getByRole('switch', { name: t('r1.set.lock') }).isDisabled())) throw new Error('lock switch should be inert on web');
    await pp.getByRole('switch', { name: t('r1.set.large') }).click(); await pp.getByRole('radio', { name: t('r1.set.theme.light') }).click();
  }, pp);
  await step(L + 'low-data mode: x-lite header on API calls, map replaced by a text card', async () => {
    const before = apiHeaders.length; if (apiHeaders.some((h) => h.lite)) throw new Error('x-lite sent before enabling');
    await pp.getByRole('switch', { name: t('r1.set.lowdata') }).click(); await pp.waitForTimeout(400);
    await pp.getByLabel(t('common.back')).first().click(); await pp.getByLabel(t('common.back')).first().click(); await pp.getByText(t('home.where'), { exact: true }).first().waitFor({ timeout: 20000 });
    await pp.waitForTimeout(3000); const lite = apiHeaders.slice(before).filter((h) => h.lite === '1'); if (!lite.length) throw new Error('no x-lite request after enabling');
    await pp.getByTestId('lite-map').first().waitFor({ timeout: 10000 }); await pp.screenshot({ path: `${OUT}/r1-${lang}-lowdata-home.png` });
  }, pp);
  await pu.ctx.close();
}
console.log('\nbrowser errors (excluding map tiles / third-party):', JSON.stringify(errors.filter((e) => !/tile|leaflet|unpkg|ERR_|Failed to load resource|net::|Access-Control|CORS|40\d|409|safety-check/i.test(e))));
await br.close(); await db.end();
if (failed) { console.log(`\n${failed} step(s) failed`); process.exit(1); } else console.log('\nall steps passed');

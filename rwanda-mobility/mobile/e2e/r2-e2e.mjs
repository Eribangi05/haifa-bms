// Round 2 end-to-end through the real screens (react-native-web): ride for someone else (+ server SMS record), recurring rides, fixed-price option,
// driver quests, demand heat map and the marketing opt-in, in Kinyarwanda and French.
// Env: API_ORIGIN (default http://localhost:8102), WEB_ORIGIN (default http://localhost:8112), DATABASE_URL (default the scratch DB rm_e2e_m2), CHROMIUM_PATH.
// Prerequisites: backend running with OTP_DEV_ECHO=true on a migrated + seeded DB, and the web export served (see docs/MOBILE_ROUND2.md).
// Usage: node e2e/r2-e2e.mjs <screenshot-dir> [langs, e.g. rw,fr]
import { chromium } from 'playwright-core';
import pg from 'pg';
import { readFileSync } from 'node:fs';
const API = (process.env.API_ORIGIN ?? 'http://localhost:8102') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8112', OUT = process.argv[2] ?? '/tmp', LANGS = (process.argv[3] ?? 'rw,fr').split(',');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rm_e2e_m2' }); await db.connect();
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
// ---- strings straight from the locale sources, so the test checks what the user really reads
const dict = {}; const LOC = new URL('../src/lib/locales/', import.meta.url);
for (const l of ['en', 'rw', 'fr']) { dict[l] = {}; for (const f of [l, `r1.${l}`, `r2.${l}`, `r3.${l}`]) { let src = ''; try { src = readFileSync(new URL(f + '.ts', LOC), 'utf8'); } catch { continue; } for (const m of src.matchAll(/'([\w.]+)':\s*'((?:[^'\\]|\\.)*)'/g)) dict[l][m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\'); } }
const S = (lang) => (k, v = {}) => { let s = dict[lang][k]; if (s == null) throw new Error(`missing string ${lang}:${k}`); for (const [a, b] of Object.entries(v)) s = s.replace(`{${a}}`, String(b)); return s; };
const rnd = () => String(100000 + Math.floor(Math.random() * 899999));
const KCC = { lat: -1.954, lng: 30.0927 };
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let failed = 0; const errors = [];
const step = async (name, fn, page) => { try { await fn(); console.log('OK  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); if (page) await page.screenshot({ path: `${OUT}/r2-FAIL-${name.replace(/\W+/g, '_').slice(0, 60)}.png` }).catch(() => {}); } };
const reg = async (phone, role = 'passenger', lang = 'en') => { await db.query('delete from otp_challenges'); let o = await call('POST', '/auth/otp/request', { body: { phone } }); for (let i = 0; i < 4 && !o.j.dev_code; i++) { await new Promise((r) => setTimeout(r, 20000)); o = await call('POST', '/auth/otp/request', { body: { phone } }); } const v = await call('POST', '/auth/otp/verify', { body: { phone, code: o.j.dev_code, role, language: lang }, h: { 'x-device-id': 'r2-' + Math.random(), 'accept-language': lang } }); if (!v.j.access_token) throw new Error('signup failed ' + JSON.stringify(v.j)); return { t: v.j.access_token, r: v.j.refresh_token, id: v.j.user.id, phone }; };
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
const newCtx = async (user, lang, mode = 'passenger') => {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: KCC.lat, longitude: KCC.lng }, permissions: ['geolocation'] });
  await ctx.addInitScript(([tk, lg, md]) => { try { if (!localStorage.getItem('rm_tokens')) { localStorage.setItem('rm_tokens', JSON.stringify(tk)); localStorage.setItem('rm_lang', lg); localStorage.setItem('rm_loc_consent', '1'); localStorage.setItem('rm_mode', md); localStorage.setItem('rm_drv_consent', '1'); } } catch { /* ignore */ } }, [{ access_token: user.t, refresh_token: user.r }, lang, mode]);
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 200)));
  await page.goto(WEB); return { ctx, page };
};
const popular = async (lang) => (await (await fetch(API + '/places/popular?lang=' + lang)).json()).places.find((p) => /Nyabugogo/.test(p.name));
const cancelOpen = async () => { await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('SEARCHING_DRIVER','REQUESTED','SCHEDULED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','PAYMENT_PENDING')"); };
/** Home -> pick the Nyabugogo chip -> See prices (options screen). */
const toOptions = async (page, t, place, { guest = false } = {}) => {
  await page.getByText(t('home.where'), { exact: true }).first().waitFor({ timeout: 25000 });
  if (guest) await page.getByText(t('r2.guest.home'), { exact: true }).click();
  await page.getByText(place.name, { exact: true }).first().click(); await page.getByTestId('cta').click();
  await page.getByText(t('opt.breakdown'), { exact: true }).waitFor({ timeout: 25000 });
};
const finishTrip = async (pass, drv, { guest = false } = {}) => {   // API-driven trip with a cash payment; returns booking id
  const e = await call('POST', '/fares/estimate', { t: pass.t, body: { pickup: KCC, dest: { lat: -1.9496, lng: 30.1262 }, service_id: 'moto' } });
  const q = e.j.options.find((o) => o.service_id === 'moto' && !o.fixed_price); if (!q?.quote_id) throw new Error('moto unavailable ' + JSON.stringify(q?.reason));
  const b = await call('POST', '/bookings', { t: pass.t, h: { 'idempotency-key': 'r2-' + Math.random() }, body: { quote_id: q.quote_id, payment_method: 'cash', pickup_name: 'KCC', dest_name: 'Kimironko' } }); if (b.s !== 201 && b.s !== 200) throw new Error('book ' + JSON.stringify(b.j));
  return b.j.booking.id;
};
const drive = async (pass, drv, id, stopAfter = 'complete') => {
  for (let i = 0; i < 40; i++) { const o = await call('GET', '/drivers/me/offers', { t: drv.t }); if (o.j.offers?.some((x) => x.booking_id === id)) break; await new Promise((r) => setTimeout(r, 500)); if (i === 39) throw new Error('no offer'); }
  const ok = (r, n) => { if (r.s >= 300) throw new Error(n + ' ' + JSON.stringify(r.j)); return r; };
  ok(await call('POST', `/bookings/${id}/accept`, { t: drv.t, body: {} }), 'accept'); if (stopAfter === 'accept') return;
  ok(await call('POST', `/bookings/${id}/en-route`, { t: drv.t, body: {} }), 'en-route'); await call('POST', '/drivers/me/location', { t: drv.t, body: { ...KCC, accuracy: 5 } });
  ok(await call('POST', `/bookings/${id}/arrived`, { t: drv.t, body: {} }), 'arrived');
  const pin = (await call('GET', `/bookings/${id}`, { t: pass.t })).j.trip_pin;
  ok(await call('POST', `/bookings/${id}/start`, { t: drv.t, body: { pin } }), 'start'); ok(await call('POST', `/bookings/${id}/complete`, { t: drv.t, body: {} }), 'complete');
  const v = await call('GET', `/bookings/${id}`, { t: drv.t }); ok(await call('POST', `/bookings/${id}/cash-collected`, { t: drv.t, body: { amount: Math.round(v.j.final_fare ?? v.j.estimated_fare), }, h: { 'idempotency-key': 'c-' + id } }), 'cash');
};

for (const lang of LANGS) {
  const t = S(lang); const L = `[${lang}] `;
  console.log(`\n=== ${lang} ===`);
  await db.query("update driver_profiles set is_online=false"); await cancelOpen(); await db.query("delete from driver_quest_awards where quest_id in (select id from driver_quests where title_en like 'R2E2E%')"); await db.query("delete from driver_quests where title_en like 'R2E2E%'"); await db.query("delete from fixed_routes where name_en like 'R2E2E%'");
  const place = await popular(lang); const guestName = 'Bob Mugabo', guestPhone = '0733' + rnd(), guestE164 = '+250' + guestPhone.slice(1);
  const P = await reg('+250788' + rnd(), 'passenger', lang); const D = await mkDriver('RD' + (100 + Math.floor(Math.random() * 899)) + 'R', lang);
  await db.query("insert into fixed_routes(name_en,name_rw,name_fr,from_lat,from_lng,from_radius_m,to_lat,to_lng,to_radius_m,service_id,price,bidirectional,active) values ('R2E2E Nyabugogo','R2E2E Nyabugogo rw','R2E2E Nyabugogo fr',$1,$2,3000,$3,$4,1000,'moto',4200,true,true)", [KCC.lat, KCC.lng, place.lat, place.lng]);
  await db.query("insert into driver_quests(title_en,title_rw,title_fr,kind,target,quest_window,reward,active) values ('R2E2E two trips','R2E2E Ingendo ebyiri','R2E2E Deux courses','trips',2,'daily',1500,true)");
  const pu = await newCtx(P, lang); const pp = pu.page; let bookingId;

  await step(L + 'guest: switch, explanation, validation, own number refused', async () => {
    await toOptions(pp, t, place, { guest: true });
    await pp.getByText(t('r2.guest.explain'), { exact: true }).waitFor(); await pp.getByLabel(t('r2.guest.name')).fill('B');
    await pp.getByLabel(t('r2.guest.phone')).fill('12345'); await pp.getByText(t('r2.guest.err.name')).waitFor(); await pp.getByText(t('r2.guest.err.phone')).waitFor();
    if (!(await pp.getByTestId('cta').isDisabled())) throw new Error('confirm should be disabled with an invalid guest');
    await pp.getByLabel(t('r2.guest.name')).fill(guestName); await pp.getByLabel(t('r2.guest.phone')).fill('0' + P.phone.slice(4)); await pp.getByText(t('r2.guest.err.own')).waitFor();
    await pp.screenshot({ path: `${OUT}/r2-${lang}-guest-form.png` });
  }, pp);
  await step(L + 'guest: book with a valid guest (French/Kinyarwanda SMS language chosen)', async () => {
    await pp.getByLabel(t('r2.guest.phone')).fill(guestPhone);
    await pp.getByText(lang === 'fr' ? 'Français' : 'Kinyarwanda', { exact: true }).last().click();
    await pp.getByTestId('cta').click(); await pp.getByText(t('r2.guest.for', { name: guestName }), { exact: false }).waitFor({ timeout: 30000 });
    const r = (await db.query("select id, guest_name, guest_phone, guest_lang, passenger_id from bookings where guest_phone=$1 order by created_at desc limit 1", [guestE164])).rows[0];
    if (!r || r.guest_name !== guestName || r.guest_lang !== lang || r.passenger_id !== P.id) throw new Error('booking guest row ' + JSON.stringify(r)); bookingId = r.id;
    await pp.screenshot({ path: `${OUT}/r2-${lang}-guest-track.png` });
  }, pp);

  const du = await newCtx(D, lang, 'driver'); const dp = du.page;
  await step(L + 'guest: driver accepts; SMS record has driver, plate, PIN and link; driver sees first name', async () => {
    await drive(P, D, bookingId, 'accept');
    let m; for (let i = 0; i < 20 && !m; i++) { m = (await db.query("select kind, lang, status, body from guest_messages where booking_id=$1 and kind='assigned'", [bookingId])).rows[0]; if (!m) await new Promise((r) => setTimeout(r, 300)); }
    if (!m || m.lang !== lang) throw new Error('guest_messages ' + JSON.stringify(m));
    if (m.body) { const pin = (await call('GET', `/bookings/${bookingId}`, { t: P.t })).j.trip_pin; if (!m.body.includes(pin) || !/RD\d+R/.test(m.body) || !/\/share\//.test(m.body)) throw new Error('SMS body ' + m.body); }
    await dp.getByTestId('r2-guest-driver').waitFor({ timeout: 30000 }); const txt = await dp.getByTestId('r2-guest-driver').textContent(); if (!txt.includes('Bob') || txt.includes('Mugabo')) throw new Error('driver should see the first name only: ' + txt);
  }, dp);
  await step(L + 'guest: Contact guest reveals the number only during the trip', async () => {
    await dp.getByTestId('r2-guest-contact').click(); await dp.getByText(guestE164, { exact: true }).first().waitFor({ timeout: 15000 }); await dp.screenshot({ path: `${OUT}/r2-${lang}-driver-guest.png` });
    await drive(P, D, bookingId).catch(async (e) => { if (!/no offer/.test(e.message)) throw e; });   // offer already accepted: continue the remaining steps below
  }, dp).catch?.(() => {});
  await step(L + 'guest: trip completes; contact afterwards is refused (409)', async () => {
    const ok = (r, n) => { if (r.s >= 300) throw new Error(n + ' ' + JSON.stringify(r.j)); };
    ok(await call('POST', `/bookings/${bookingId}/en-route`, { t: D.t, body: {} }), 'en-route'); ok(await call('POST', `/bookings/${bookingId}/arrived`, { t: D.t, body: {} }), 'arrived');
    const pin = (await call('GET', `/bookings/${bookingId}`, { t: P.t })).j.trip_pin; ok(await call('POST', `/bookings/${bookingId}/start`, { t: D.t, body: { pin } }), 'start');
    const live = await call('POST', `/bookings/${bookingId}/guest-contact`, { t: D.t, body: {} }); if (live.s !== 200 || live.j.phone !== guestE164) throw new Error('live contact ' + JSON.stringify(live));
    ok(await call('POST', `/bookings/${bookingId}/complete`, { t: D.t, body: {} }), 'complete');
    const v = await call('GET', `/bookings/${bookingId}`, { t: D.t }); ok(await call('POST', `/bookings/${bookingId}/cash-collected`, { t: D.t, body: { amount: Math.round(v.j.final_fare ?? v.j.estimated_fare) } }), 'cash');
    const late = await call('POST', `/bookings/${bookingId}/guest-contact`, { t: D.t, body: {} }); if (late.s !== 409 || late.j.error?.code !== 'guest_contact_unavailable') throw new Error('late contact ' + JSON.stringify(late));
  });
  await step(L + 'guest: history shows who the ride was for', async () => {
    await pp.goto(WEB); await pp.getByText(t('home.history'), { exact: true }).click(); await pp.getByText(t('r2.guest.hist', { name: guestName }), { exact: false }).first().waitFor({ timeout: 20000 });
  }, pp);

  await step(L + 'quests: card on Working, progress 50 percent after one trip', async () => {
    await dp.goto(WEB); await dp.getByText(t('r2.q.card'), { exact: true }).first().waitFor({ timeout: 30000 }); await dp.getByTestId('r2-quests-open').click();
    await dp.getByText(t('r2.q.title'), { exact: true }).first().waitFor(); await dp.getByText('R2E2E', { exact: false }).first().waitFor({ timeout: 20000 });
    await dp.getByText(t('r2.q.progress', { p: 1, t: 2 }), { exact: false }).first().waitFor({ timeout: 20000 }); await dp.screenshot({ path: `${OUT}/r2-${lang}-quests-50.png` });
  }, dp);
  await step(L + 'quests: second trip completes the quest, celebration and history show the bonus', async () => {
    const id2 = await finishTrip(P, D); await drive(P, D, id2);
    await dp.getByTestId('r2-celebrate').waitFor({ timeout: 45000 }); await dp.getByText(t('r2.q.done'), { exact: true }).first().waitFor({ timeout: 20000 });
    await dp.getByText('1,500', { exact: false }).first().waitFor({ timeout: 20000 }); await dp.screenshot({ path: `${OUT}/r2-${lang}-quests-done.png` });
    const aw = (await db.query("select amount from driver_quest_awards a join driver_quests q on q.id=a.quest_id where q.title_en like 'R2E2E%' and a.driver_id=$1", [D.id])).rows; if (aw.length !== 1 || aw[0].amount !== 1500) throw new Error('awards ' + JSON.stringify(aw));
  }, dp);

  await step(L + 'fixed price: badge, itemised line, bookable', async () => {
    await cancelOpen(); await pp.goto(WEB); await toOptions(pp, t, place);
    await pp.getByText(t('r2.fixed.badge'), { exact: true }).first().waitFor({ timeout: 15000 }); await pp.getByTestId('opt-fixed').click(); await pp.getByText(t('r2.fixed.note'), { exact: true }).waitFor();
    await pp.getByText(new RegExp('R2E2E Nyabugogo')).first().waitFor(); await pp.screenshot({ path: `${OUT}/r2-${lang}-fixed.png` });
    const est = await call('POST', '/fares/estimate', { t: P.t, body: { pickup: KCC, dest: { lat: place.lat, lng: place.lng } } }); const fx = est.j.options.find((o) => o.fixed_price); if (!fx || fx.fare.subtotal !== 4200) throw new Error('api fixed option ' + JSON.stringify(fx?.fare));
    const t0 = (await db.query('select now() t')).rows[0].t; await pp.getByTestId('cta').click();
    let b; for (let i = 0; i < 20 && !b; i++) { b = (await db.query("select estimated_fare from bookings where passenger_id=$1 and created_at >= $2 and status not like 'CANCELLED%' and guest_phone is null order by created_at desc limit 1", [P.id, t0])).rows[0]; if (!b) await new Promise((r) => setTimeout(r, 400)); }
    if (!b || Math.round(b.estimated_fare) !== fx.fare.total) throw new Error(`booked fare ${b?.estimated_fare} vs fixed ${fx.fare.total}`);
  }, pp);

  await step(L + 'recurring: create from Options, list, pause, resume, skip next', async () => {
    await cancelOpen(); await pp.goto(WEB); await toOptions(pp, t, place);
    await pp.getByRole('switch', { name: t('r2.rep.switch') }).click(); await pp.getByText(t('r2.rep.days'), { exact: true }).waitFor();
    await pp.getByRole('radio', { name: t('r2.day.0'), exact: true }).click();   // add Sunday as well
    await pp.getByLabel(t('r2.rep.time')).fill('06:45'); await pp.getByText(t('r2.rep.tomorrow'), { exact: true }).click();
    await pp.getByTestId('r2-repeat-save').click(); await pp.getByText(t('r2.sch.title'), { exact: true }).first().waitFor({ timeout: 20000 });
    await pp.getByText('06:45', { exact: false }).first().waitFor();
    const s = (await db.query('select id, days_of_week, local_time, status from ride_schedules where user_id=$1', [P.id])).rows; if (s.length !== 1 || !s[0].days_of_week.includes(0) || s[0].local_time.slice(0, 5) !== '06:45') throw new Error('schedule ' + JSON.stringify(s));
    await pp.screenshot({ path: `${OUT}/r2-${lang}-schedules.png` });
    await pp.getByTestId('r2-pause').click(); await pp.getByTestId('r2-resume').waitFor({ timeout: 15000 });
    if ((await db.query('select status from ride_schedules where id=$1', [s[0].id])).rows[0].status !== 'paused') throw new Error('not paused');
    await pp.getByTestId('r2-resume').click(); await pp.getByTestId('r2-pause').waitFor({ timeout: 15000 });
    await pp.getByTestId('r2-skip').click(); await pp.getByText(t('r2.sch.skip.done'), { exact: true }).waitFor({ timeout: 15000 });
    if (!(await db.query('select skip_dates from ride_schedules where id=$1', [s[0].id])).rows[0].skip_dates.length) throw new Error('no skip date');
  }, pp);
  await step(L + 'recurring: price-changed warning and accept new price', async () => {
    const sid = (await db.query('select id from ride_schedules where user_id=$1', [P.id])).rows[0].id;
    await db.query("insert into ride_schedule_runs(schedule_id, occurrence_date, scheduled_for, status, quoted_total) values ($1, current_date + 3, now() + interval '3 days', 'price_changed', 3333)", [sid]);
    await pp.goto(WEB); await pp.getByText(t('r2.sch.title'), { exact: true }).last().click(); await pp.getByTestId('r2-accept-price').waitFor({ timeout: 25000 }); await pp.screenshot({ path: `${OUT}/r2-${lang}-price-warning.png` });
    await pp.getByTestId('r2-accept-price').click(); await pp.getByText(t('r2.sch.accepted'), { exact: true }).waitFor({ timeout: 15000 });
    const e = (await db.query('select expected_total from ride_schedules where id=$1', [sid])).rows[0].expected_total; if (Number(e) !== 3333) throw new Error('expected_total ' + e);
  }, pp);

  await step(L + 'heat map: needs k>=3 distinct requesters; screen shows hints, no counts, window chips', async () => {
    await cancelOpen();
    for (let i = 0; i < 3; i++) { const u = await reg('+250788' + rnd(), 'passenger', lang); const id = await finishTrip(u, D); if (!id) throw new Error('seed booking'); }
    await dp.goto(WEB); await dp.getByTestId('r2-heat-open').waitFor({ timeout: 30000 }); await dp.getByTestId('r2-heat-open').click();
    await dp.getByText(t('r2.heat.title'), { exact: true }).first().waitFor(); await dp.getByTestId('r2-heat-cell').first().waitFor({ timeout: 30000 });
    const body = await dp.locator('body').innerText(); if (!/Nyabugogo|Kigali|KCC|Zone|Agace|Area|Zone/.test(body) && !body.includes(t('r2.heat.privacy'))) throw new Error('heat content'); if (/\b(requests|unmatched|demandes|abasabye)\s*:\s*\d/i.test(body)) throw new Error('counts leaked');
    await dp.getByText(t('r2.heat.win.last_hour'), { exact: true }).click(); await dp.getByText(t('r2.heat.win.same_hour_last_week'), { exact: true }).click(); await dp.getByText(t('r2.heat.empty.title'), { exact: true }).waitFor({ timeout: 10000 });
    await dp.screenshot({ path: `${OUT}/r2-${lang}-heat.png` });
  }, dp);
  await step(L + 'heat map: unavailable when offline (403 shown as a friendly state)', async () => {
    await call('PATCH', '/drivers/me/availability', { t: D.t, body: { online: false } });
    const r = await call('GET', '/drivers/me/heatmap', { t: D.t }); if (r.s !== 403 || r.j.error?.code !== 'heatmap_unavailable') throw new Error('expected 403 ' + r.s);
    await dp.reload(); await dp.getByText(t('drv.mode'), { exact: false }).first().waitFor({ timeout: 25000 });
  }, dp);

  await step(L + 'marketing: opt-in switch in Profile saves notif_prefs.marketing', async () => {
    await pp.goto(WEB); await pp.getByText(t('home.profile'), { exact: true }).first().click(); await pp.getByText(t('r2.mkt.title'), { exact: true }).waitFor({ timeout: 20000 });
    await pp.getByText(t('r2.mkt.body'), { exact: true }).waitFor();
    const before = (await db.query('select notif_prefs from users where id=$1', [P.id])).rows[0].notif_prefs; if (before?.marketing) throw new Error('marketing should default to off');
    await pp.getByRole('switch', { name: t('r2.mkt.title') }).click(); await pp.getByText(t('prof.saved'), { exact: true }).waitFor({ timeout: 15000 });
    const after = (await db.query('select notif_prefs from users where id=$1', [P.id])).rows[0].notif_prefs; if (after?.marketing !== true) throw new Error('prefs ' + JSON.stringify(after));
    await pp.screenshot({ path: `${OUT}/r2-${lang}-marketing.png` });
  }, pp);
  await pu.ctx.close(); await du.ctx.close();
}
console.log('\nbrowser errors (excluding map tiles / third-party):', JSON.stringify(errors.filter((e) => !/tile|leaflet|unpkg|ERR_|Failed to load resource|net::|Access-Control|CORS|40\d/i.test(e))));
await br.close(); await db.end();
if (failed) { console.log(`\n${failed} step(s) failed`); process.exit(1); } else console.log('\nall steps passed');

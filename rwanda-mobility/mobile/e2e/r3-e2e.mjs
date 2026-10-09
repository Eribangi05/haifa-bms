// Round 3 end-to-end through the real screens (react-native-web): credit + loyalty, booking paid with credit (full / partial),
// Abasare deposit gating (failure, retry, credit, refund on cancel), claim filing with a photo, the driver's reply, a staff decision.
// Prereqs: backend on $API_ORIGIN (default http://localhost:8103) started with OTP_DEV_ECHO=true MOMO_MODE=simulator and DATABASE_URL=$DATABASE_URL
//   (scratch db rm_e2e_m3), web build on $WEB_ORIGIN (default http://localhost:8113):
//   EXPO_PUBLIC_API_URL=http://localhost:8103 EXPO_PUBLIC_ALLOW_CLEARTEXT=1 npx expo export --clear --platform web --output-dir /tmp/rm-web-r3
// Usage: node e2e/r3-e2e.mjs <screenshot-dir>     (env: API_ORIGIN, WEB_ORIGIN, DATABASE_URL, CHROMIUM_PATH, JPG)
// Staff steps (review/decision/settlement) and credit/loyalty seeding run through the backend services via e2e/r3-seed.mts.
import { chromium } from 'playwright-core';
import { visibleOnly } from './visible.mjs';
import pg from 'pg';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_O = process.env.API_ORIGIN ?? 'http://localhost:8103', API = API_O + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8113', OUT = process.argv[2] ?? '/tmp', JPG = process.env.JPG ?? '/tmp/doc.jpg';
const DBURL = process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rm_e2e_m3';
fs.mkdirSync(OUT, { recursive: true });
const db = new pg.Client({ connectionString: DBURL }); await db.connect();

// ---- strings straight from the locale modules (so the script follows the wording)
const load = (lang) => { const m = {}; for (const f of [`${lang}.ts`, `r3.${lang}.ts`, `r4.${lang}.ts`]) { const txt = fs.readFileSync(path.join(HERE, '../src/lib/locales/' + f), 'utf8'); for (const mm of txt.matchAll(/'([\w.]+)': '((?:[^'\\]|\\.)*)'/g)) m[mm[1]] = mm[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\'); } return m; };
const D = { en: load('en'), rw: load('rw'), fr: load('fr') };
const tr = (lang, key, vars = {}) => { let s = D[lang][key]; if (s == null) throw new Error('no string ' + key); for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v)); return s; };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* empty */ } return { s: r.status, j }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
const KCC = { lat: -1.954, lng: 30.0927 }, KIM = { lat: -1.9496, lng: 30.1262 };
const seed = (o) => execFileSync('node', ['--import', 'tsx', path.join(HERE, 'r3-seed.mts'), JSON.stringify(o)], { cwd: path.join(HERE, '../../backend'), env: { ...process.env, DATABASE_URL: DBURL }, stdio: ['ignore', 'pipe', 'inherit'] });
const user = async (role, lang) => {
  const phone = '+250788' + (role === 'driver' ? '5' : String(6 + Math.floor(Math.random() * 3))) + rnd(); let o; for (let k = 0; k < 8; k++) { await db.query('delete from otp_challenges'); o = await call('POST', '/auth/otp/request', { body: { phone } }); if (o.j?.dev_code) break; await sleep(8000); }   // auth endpoints allow ~10 requests a minute per IP
  const v = await call('POST', '/auth/otp/verify', { body: { phone, code: o.j.dev_code, role }, h: { 'x-device-id': 'r3-' + Math.random() } });
  if (!v.j?.access_token) throw new Error('signup failed ' + JSON.stringify(v));
  const u = { t: v.j.access_token, r: v.j.refresh_token, id: v.j.user.id, phone };
  await call('PATCH', '/users/me', { t: u.t, body: { preferred_language: lang, display_name: 'E2E ' + role } }); return u;
};
const photoForm = () => { const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(JPG)], { type: 'image/jpeg' }), 'p.jpg'); return fd; };
const upload = async (p, t) => { const r = await fetch(API + p, { method: 'POST', headers: { authorization: 'Bearer ' + t }, body: photoForm() }); return { s: r.status, j: await r.json().catch(() => null) }; };

// ---- drivers
await db.query('delete from otp_challenges'); await db.query("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('SEARCHING_DRIVER','REQUESTED','SCHEDULED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','PAYMENT_PENDING')"); await db.query('update driver_profiles set is_online=false');
const mkMoto = async () => {
  const d = await user('driver', 'rw');
  await db.query("update driver_profiles set status='APPROVED', legal_name='Eric Mugisha', zone_id='kigali' where user_id=$1", [d.id]);
  await db.query("insert into vehicles(driver_id,vehicle_type,make,model,color,plate,capacity,status) values ($1,'moto','TVS','HLX','Blue',$2,1,'approved')", [d.id, 'RE' + Math.floor(100 + Math.random() * 899) + 'B']);
  for (const r of (await db.query("select doc_type, requires_expiry from document_requirements where vehicle_type='moto' and mandatory")).rows) await db.query("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [d.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
  await call('PATCH', '/drivers/me/availability', { t: d.t, body: { online: true, accepting: ['ride'] } }); await call('POST', '/drivers/me/location', { t: d.t, body: KCC }); return d;
};
const mkAbasare = async () => {
  const d = await user('driver', 'rw');
  const a = await call('POST', '/abasare/apply', { t: d.t, body: { legal_name: 'Test Umusare', national_id: '1199080012345678', licence_since: '2015-01-01', years_experience: 8, transmissions: ['manual', 'automatic'], classes: ['car', 'suv', 'minivan', 'pickup'], return_mode: 'moto', payout_msisdn: '0788123456' } });
  if (a.s !== 200) throw new Error('abasare apply ' + JSON.stringify(a.j));
  for (const r of (await db.query("select doc_type, requires_expiry from document_requirements where vehicle_type='abasare' and mandatory")).rows) await db.query("insert into driver_documents(driver_id,doc_type,file_key,mime,size,expiry_date,review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [d.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
  await db.query("update driver_profiles set status='APPROVED', abasare_status='approved', zone_id='kigali', legal_name='Test Umusare' where user_id=$1", [d.id]);
  const av = await call('PATCH', '/drivers/me/availability', { t: d.t, body: { online: true, accepting: ['abasare'] } }); if (av.s !== 200) throw new Error('availability ' + JSON.stringify(av.j));
  await call('POST', '/drivers/me/location', { t: d.t, body: KCC }); return d;
};

// ---- browser
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = []; let failed = 0;
const open = async (u, lang, name, mode) => {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] });
  await ctx.addInitScript(([tok, l, m]) => { try { localStorage.setItem('rm_tokens', JSON.stringify({ access_token: tok.t, refresh_token: tok.r })); localStorage.setItem('rm_lang', l); localStorage.setItem('rm_loc_consent', '1'); if (m) localStorage.setItem('rm_mode', m); } catch { /* */ } }, [u, lang, mode ?? null]);
  const page = visibleOnly(await ctx.newPage()); page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => d.accept());   // window.confirm used by showAlert on web
  await page.goto(WEB); return { page, ctx, name, lang };
};
const shot = (w, n) => w.page.screenshot({ path: `${OUT}/r3-${w.name}-${n}.png` });
const step = async (name, fn, w) => { try { await fn(); console.log('OK  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); if (w) await shot(w, 'FAIL-' + name.replace(/\W+/g, '_').slice(0, 40)).catch(() => {}); } };
const must = (c, m) => { if (!c) throw new Error(m); };
const T = (w, key, vars) => tr(w.lang, key, vars);
const text = (w, key, vars) => w.page.getByText(T(w, key, vars), { exact: true });
const waitText = (w, key, vars, ms = 20000) => text(w, key, vars).first().waitFor({ timeout: ms });
/** No English from the r3 module may show on a rw/fr screen (long strings only; shared words/numbers excluded). */
const noEnglish = async (w) => { if (w.lang === 'en') return; const body = await w.page.locator('body').innerText(); for (const [k, v] of Object.entries(D.en)) if (/^(cr|dp|cl|us)\./.test(k) && v.length > 18 && !v.includes('{') && D[w.lang][k] !== v && body.includes(v)) throw new Error('English leaked: ' + k); };
const goHome = async (w) => { await w.page.getByTestId('tab-book').click({ timeout: 25000 }); await w.page.getByTestId('cta').first().waitFor({ timeout: 25000 }); };
const popular = async (lang) => (await call('GET', `/places/popular?lang=${lang}`, {})).j;
const driverTrip = async (drv, bid, { cash } = {}) => {
  for (let i = 0; i < 30; i++) { const r = await call('GET', '/drivers/me/offers', { t: drv.t }); if (r.j?.offers?.some((o) => o.booking_id === bid)) break; await sleep(500); if (i === 29) throw new Error('driver never got the offer'); }
  const a = await call('POST', `/bookings/${bid}/accept`, { t: drv.t, body: {} }); must(a.s === 200, 'accept ' + JSON.stringify(a.j));
  await call('POST', '/drivers/me/location', { t: drv.t, body: { lat: KCC.lat + 0.0001, lng: KCC.lng } });
  must((await call('POST', `/bookings/${bid}/arrived`, { t: drv.t, body: {} })).s === 200, 'arrive');
  return {};
};
const startAndComplete = async (drv, pass, bid) => {
  const pin = (await call('GET', `/bookings/${bid}`, { t: pass.t })).j.trip_pin;
  must((await call('POST', `/bookings/${bid}/start`, { t: drv.t, body: { pin } })).s === 200, 'start');
  const c = await call('POST', `/bookings/${bid}/complete`, { t: drv.t, body: {} }); must(c.s === 200, 'complete ' + JSON.stringify(c.j)); return c.j;
};

try {
  const moto = await mkMoto();

  // ================= 1. credit screen, statement, redeem (rw) =================
  const P1 = await user('passenger', 'rw');
  seed({ credit: [{ user_id: P1.id, amount: 5000 }], loyalty: [{ user_id: P1.id, points: 700, lifetime: 2500 }], settings: { 'abasare.deposit_percent': 0 } });
  const w1 = await open(P1, 'rw', 'p1');
  await step('rw: Home shows the credit chip with the balance', async () => { await goHome(w1); await w1.page.getByTestId('credit-chip').waitFor({ timeout: 15000 }); must(/5,000/.test(await w1.page.getByTestId('credit-chip').innerText()), 'balance not on chip'); await shot(w1, '1-home-chip'); }, w1);
  await step('rw: credit screen lists balance, statement row, tier, perks and the no-cash note', async () => {
    await w1.page.getByTestId('credit-chip').click(); await w1.page.getByTestId('credit-balance').waitFor({ timeout: 15000 });
    must(/5,000/.test(await w1.page.getByTestId('credit-balance').innerText()), 'balance');
    await w1.page.getByTestId('stmt-row').first().waitFor({ timeout: 15000 }); must((await w1.page.getByTestId('stmt-row').count()) >= 1, 'no statement rows');
    await waitText(w1, 'cr.src.adjustment'); await waitText(w1, 'cr.note'); await waitText(w1, 'cr.tier', { tier: tr('rw', 'cr.tier.silver') });
    must(/700/.test(await w1.page.getByTestId('loyalty-points').innerText()), 'points'); await noEnglish(w1); await shot(w1, '2-credit');
  }, w1);
  await step('rw: redeem 500 points -> confirmation -> credit added (server state)', async () => {
    await w1.page.getByText('500', { exact: true }).first().click(); await w1.page.getByTestId('redeem-btn').click();
    await waitText(w1, 'cr.redeem.done', { n: 500 }, 15000);
    const wal = (await call('GET', '/wallet', { t: P1.t })).j, loy = (await call('GET', '/loyalty', { t: P1.t })).j;
    must(wal.available === 5500 && loy.points === 200, `server says available=${wal.available} points=${loy.points}`);
    await w1.page.waitForFunction(() => /5,500/.test(document.body.innerText), null, { timeout: 15000 });
    await waitText(w1, 'cr.src.loyalty'); await shot(w1, '3-redeemed');
  }, w1);
  await step('rw: remaining 200 points cannot be redeemed (minimum shown)', async () => { await waitText(w1, 'cr.redeem.min', { n: 500, s: 100 }); }, w1);

  // ================= 2. book paid fully with credit (rw) =================
  const pick = async (w, name) => { await w.page.getByText(name, { exact: true }).first().click(); };
  const bookViaUi = async (w, { creditMode, amount }) => {
    await w.page.getByTestId('back').click(); await goHome(w);
    const pop = await popular(w.lang); const nm = (pop.places ?? pop)[0]?.name ?? ''; must(nm, 'no popular place');
    await w.page.getByText(nm, { exact: true }).first().click(); await sleep(300); await w.page.getByTestId('cta').click();
    await w.page.getByTestId('use-credit').waitFor({ timeout: 25000 });
    if (creditMode) { await w.page.getByTestId('use-credit').click(); if (amount) { await w.page.getByText(T(w, 'cr.use.part'), { exact: true }).click(); await w.page.getByTestId('credit-amount').fill(String(amount)); } await w.page.getByTestId('credit-breakdown').waitFor(); }
  };
  let b2;
  await step('rw: Options -> use my credit (full) shows the breakdown and books with credit', async () => {
    await bookViaUi(w1, { creditMode: true });
    await waitText(w1, 'cr.break.full'); await noEnglish(w1); await shot(w1, '4-options-credit');
    await w1.page.getByTestId('cta').click(); await w1.page.getByTestId('credit-chip').waitFor({ state: 'detached', timeout: 1 }).catch(() => {});
    for (let i = 0; i < 40 && !b2; i++) { const r = (await db.query("select id, payment_method, wallet_mode, wallet_reserved from bookings where passenger_id=$1 order by requested_at desc limit 1", [P1.id])).rows[0]; if (r) b2 = r; else await sleep(500); }
    must(b2 && b2.payment_method === 'wallet' && b2.wallet_mode === 'full' && b2.wallet_reserved > 0, 'booking not reserved with credit: ' + JSON.stringify(b2));
    const wal = (await call('GET', '/wallet', { t: P1.t })).j; must(wal.reserved > 0 && wal.available < 5500, 'credit not reserved ' + JSON.stringify(wal));
  }, w1);
  await step('rw: driver completes; Done shows credit applied, nothing else to pay', async () => {
    await driverTrip(moto, b2.id); await startAndComplete(moto, P1, b2.id);
    await w1.page.getByTestId('paid-lines').first().waitFor({ timeout: 25000 }); await w1.page.getByTestId('line-credit').waitFor();
    await waitText(w1, 'cr.paid.credit'); await noEnglish(w1); await shot(w1, '5-done-credit');
    const pay = (await db.query("select method, status from payments where booking_id=$1 and kind='fare'", [b2.id])).rows[0]; must(pay?.method === 'wallet' && pay.status === 'SUCCESS', 'server payment ' + JSON.stringify(pay));
  }, w1);

  // ================= 3. partial credit, remainder cash (fr) =================
  const P2 = await user('passenger', 'fr');
  seed({ credit: [{ user_id: P2.id, amount: 300 }] });
  const w2 = await open(P2, 'fr', 'p2'); await goHome(w2);
  let b3;
  await step('fr: partial credit (300) with cash remainder, breakdown before confirming', async () => {
    await w2.page.getByTestId('credit-chip').waitFor({ timeout: 15000 });
    const pop = await popular('fr'); const nm = (pop.places ?? pop)[0]?.name; await w2.page.getByText(nm, { exact: true }).first().click(); await sleep(300); await w2.page.getByTestId('cta').click();
    await w2.page.getByTestId('use-credit').waitFor({ timeout: 25000 }); await w2.page.getByTestId('use-credit').click(); await w2.page.getByTestId('credit-breakdown').waitFor();
    const bd = await w2.page.getByTestId('credit-breakdown').innerText(); must(/300/.test(bd) && bd.includes(T(w2, 'cr.break.credit')), 'breakdown: ' + bd);
    await noEnglish(w2); await shot(w2, '1-options-partial'); await w2.page.getByTestId('cta').click();
    for (let i = 0; i < 40 && !b3; i++) { const r = (await db.query("select id, payment_method, wallet_mode, wallet_reserved from bookings where passenger_id=$1 order by requested_at desc limit 1", [P2.id])).rows[0]; if (r) b3 = r; else await sleep(500); }
    must(b3 && b3.wallet_mode === 'partial' && b3.wallet_reserved === 300 && b3.payment_method === 'cash', 'booking ' + JSON.stringify(b3));
  }, w2);
  await step('fr: after the trip the remainder is cash and the receipt shows credit + remainder', async () => {
    await driverTrip(moto, b3.id); const done = await startAndComplete(moto, P2, b3.id);
    await w2.page.getByTestId('paid-lines').first().waitFor({ timeout: 25000 }); const lines = await w2.page.getByTestId('paid-lines').first().innerText();
    must(/300/.test(lines) && lines.includes(T(w2, 'cr.applied')), 'lines: ' + lines); await shot(w2, '2-pay-partial');
    const pay = (await db.query("select amount from payments where booking_id=$1 and kind='fare'", [b3.id])).rows[0]; must(pay && pay.amount === done.final_fare - 300, 'remainder ' + JSON.stringify(pay) + ' fare ' + done.final_fare);
    const cs = await call('POST', `/bookings/${b3.id}/cash-collected`, { t: moto.t, body: { amount: pay.amount } }); must(cs.j?.status === 'SUCCESS', 'cash ' + JSON.stringify(cs.j));
    await w2.page.getByTestId('line-credit').waitFor({ timeout: 20000 }); await noEnglish(w2); await shot(w2, '3-done-partial');
  }, w2);
  await step('fr: insufficient credit at booking time is mapped to a localized message (no raw code)', async () => {
    // credit was just spent: a stale "full credit" attempt must be refused by the server
    const e = await call('POST', '/fares/estimate', { t: P2.t, body: { pickup: KCC, dest: KIM } }); const opt = e.j.options.find((o) => o.available);
    const r = await call('POST', '/bookings', { t: P2.t, h: { 'idempotency-key': 'r3-' + Math.random() }, body: { quote_id: opt.quote_id, payment_method: 'wallet', pickup_name: 'A', dest_name: 'B' } });
    must(r.s === 409 && r.j.error.code === 'insufficient_credit', JSON.stringify(r)); must(!/insufficient_credit/.test(r.j.error.message), 'raw code in message');
  });

  // ================= 4. Abasare deposit =================
  seed({ settings: { 'abasare.deposit_percent': 30 } });
  const abd = await mkAbasare();
  const O = await user('passenger', 'rw'); const O2 = await user('passenger', 'fr');
  seed({ credit: [{ user_id: O2.id, amount: 20000 }] });
  const carOf = async (o) => { const r = await call('POST', '/users/me/cars', { t: o.t, body: { plate: 'RAB' + Math.floor(100 + Math.random() * 899) + 'X', make: 'Toyota', model: 'RAV4', color: 'Silver', vehicle_class: 'suv', transmission: 'automatic', insurance_confirmed: true } }); must(r.s === 200, 'car ' + JSON.stringify(r.j)); return r.j; };
  const abBook = async (o, car, method = 'cash') => {
    const e = await call('POST', '/fares/estimate', { t: o.t, body: { pickup: KCC, dest: KIM, abasare: { customer_vehicle_id: car.id } } }); const opt = e.j.options[0]; must(opt?.quote_id, 'estimate ' + JSON.stringify(e.j));
    const r = await call('POST', '/bookings', { t: o.t, h: { 'idempotency-key': 'r3-' + Math.random() }, body: { quote_id: opt.quote_id, payment_method: method, customer_vehicle_id: car.id, owner_attested: true, pickup_name: 'Bar', dest_name: 'Home' } });
    must(r.s === 201 || r.s === 200, 'book ' + JSON.stringify(r.j)); return r.j.booking;
  };
  const car = await carOf(O); const ab1 = await abBook(O, car);
  must(ab1.awaiting_deposit === true && ab1.deposit?.status === 'awaiting_payment', 'deposit not required: ' + JSON.stringify(ab1.deposit));
  const wo = await open(O, 'rw', 'owner');
  await step('rw: Track shows the deposit step, amount and the "we will look for your driver" message; no dispatch yet', async () => {
    await wo.page.getByText(T(wo, 'dp.title')).first().waitFor({ timeout: 20000 }); await waitText(wo, 'dp.wait'); await noEnglish(wo);
    const body = await wo.page.locator('body').innerText(); must(body.includes(ab1.deposit.amount.toLocaleString('en-US')), 'amount missing');
    const off = await call('GET', '/drivers/me/offers', { t: abd.t }); must(!off.j.offers.some((x) => x.booking_id === ab1.id), 'dispatched before deposit'); await shot(wo, '1-deposit');
  }, wo);
  await step('rw: MoMo failure (number ending 0000) is shown, nothing dispatched, then retry succeeds', async () => {
    const f = wo.page.getByTestId('deposit-msisdn'); await f.fill('0788120000'); await wo.page.getByTestId('deposit-momo').click();
    await waitText(wo, 'dp.failed', {}, 25000); await shot(wo, '2-deposit-failed');
    must((await call('GET', '/drivers/me/offers', { t: abd.t })).j.offers.every((x) => x.booking_id !== ab1.id), 'dispatched after failure');
    await f.fill('0788123456'); await wo.page.getByTestId('deposit-momo').click();
    await waitText(wo, 'dp.paid', {}, 30000); await shot(wo, '3-deposit-paid');
    const bk = (await call('GET', `/bookings/${ab1.id}`, { t: O.t })).j; must(bk.deposit.status === 'paid' || bk.deposit.status === 'captured', 'server deposit ' + bk.deposit.status);
    for (let i = 0; i < 20; i++) { if ((await call('GET', '/drivers/me/offers', { t: abd.t })).j.offers.some((x) => x.booking_id === ab1.id)) return; await sleep(500); } throw new Error('driver never offered after the deposit was paid');
  }, wo);
  // second owner (fr): pay the deposit with credit, then cancel before assignment: full refund as credit
  const car2 = await carOf(O2); const ab2 = await abBook(O2, car2);
  const wo2 = await open(O2, 'fr', 'owner2');
  await step('fr: deposit paid with credit, then cancel -> refunded to credit (server + message)', async () => {
    await wo2.page.getByTestId('deposit-credit').waitFor({ timeout: 25000 }); await noEnglish(wo2); await wo2.page.getByTestId('deposit-credit').click();
    await waitText(wo2, 'dp.paid', {}, 30000);
    const before = (await call('GET', '/wallet', { t: O2.t })).j.available;
    const c = await call('POST', `/bookings/${ab2.id}/cancel`, { t: O2.t, body: { reason: 'changed_mind' } }); must(c.s === 200, 'cancel ' + JSON.stringify(c.j));
    const after = (await call('GET', '/wallet', { t: O2.t })).j.available; must(after - before === ab2.deposit.amount, `refund ${after - before} vs ${ab2.deposit.amount}`);
    await wo2.page.waitForFunction((n) => document.body.innerText.includes(n), ab2.deposit.amount.toLocaleString('en-US'), { timeout: 20000 }); await shot(wo2, '1-deposit-refunded');
  }, wo2);
  await step('pending MoMo deposit stays pending (9999) and a late settle dispatches the trip', async () => {
    const O3 = await user('passenger', 'rw'); const car3 = await carOf(O3); const ab3 = await abBook(O3, car3);
    const p = await call('POST', `/bookings/${ab3.id}/deposit/pay`, { t: O3.t, body: { method: 'mtn_momo', msisdn: '0788129999' } }); must(p.s === 200 && p.j.deposit.status === 'pending', 'pending expected ' + JSON.stringify(p.j));
    const p2 = await call('POST', `/bookings/${ab3.id}/deposit/pay`, { t: O3.t, body: { method: 'mtn_momo', msisdn: '0788129999' } }); must(p2.s === 200 && p2.j.deposit.status === 'pending', 'repeat while in flight');
    const wo3 = await open(O3, 'rw', 'owner3'); await waitText(wo3, 'dp.pending', {}, 25000); await shot(wo3, '1-deposit-pending');
    must((await call('GET', '/drivers/me/offers', { t: abd.t })).j.offers.every((x) => x.booking_id !== ab3.id), 'dispatched while pending');
    await call('POST', `/bookings/${ab3.id}/cancel`, { t: O3.t, body: { reason: 'changed_mind' } }); await wo3.ctx.close();
  });
  seed({ settings: { 'abasare.deposit_percent': 0 } });

  // ================= 5. claims =================
  // ab1 was dispatched after the deposit: run it as a full trip, then file the claim from the app
  const bid = ab1.id; let claimId;
  await step('setup: Abasare trip with handover photos completes and the deposit is applied', async () => {
    await driverTrip(abd, bid);
    for (const phase of ['pickup', 'dropoff']) {
      if (phase === 'dropoff') { const pin = (await call('GET', `/bookings/${bid}`, { t: O.t })).j.trip_pin; must((await call('POST', `/bookings/${bid}/start`, { t: abd.t, body: { pin } })).s === 200, 'start'); }
      for (let i = 0; i < 2; i++) must((await upload(`/bookings/${bid}/handover/photos?phase=${phase}`, abd.t)).s === 200, 'handover photo');
      const r = await call('POST', `/bookings/${bid}/handover`, { t: abd.t, body: { phase, odometer_km: phase === 'pickup' ? 45210 : 45224, fuel_percent: 50, notes: 'No visible damage' } }); must(r.s === 200, 'handover ' + JSON.stringify(r.j));
    }
    must((await call('POST', `/bookings/${bid}/complete`, { t: abd.t, body: {} })).s === 200, 'complete');
    const pay = (await db.query("select amount from payments where booking_id=$1 and kind='fare'", [bid])).rows[0]; if (pay && pay.amount > 0) must((await call('POST', `/bookings/${bid}/cash-collected`, { t: abd.t, body: { amount: pay.amount } })).j?.status === 'SUCCESS', 'cash');
    const bk = (await call('GET', `/bookings/${bid}`, { t: O.t })).j; must(bk.deposit && bk.deposit.applied > 0, 'deposit not applied ' + JSON.stringify(bk.deposit));
  });
  await step('rw: trip view shows the deposit used on the receipt and offers "report a problem"', async () => {
    await wo.page.getByTestId('report-claim').waitFor({ timeout: 40000 }); await wo.page.getByTestId('line-deposit').waitFor({ timeout: 15000 }); await noEnglish(wo); await shot(wo, '4-done-deposit');
  }, wo);
  await step('rw: file a claim with a photo (type, description, amount, upload)', async () => {
    await wo.page.getByTestId('report-claim').click(); await waitText(wo, 'cl.new.intro');
    await wo.page.getByText(T(wo, 'cl.type.damage'), { exact: true }).click();
    await wo.page.getByTestId('claim-desc').fill('Scratch on the rear left door after the trip'); await wo.page.getByTestId('claim-amount').fill('40000');
    const [fc] = await Promise.all([wo.page.waitForEvent('filechooser'), wo.page.getByText(D.rw['drv.photo.pick'], { exact: true }).first().click()]); await fc.setFiles(JPG);
    await wo.page.getByLabel(T(wo, 'cl.photo.n', { n: 1 }), { exact: true }).waitFor({ timeout: 10000 }); await noEnglish(wo); await shot(wo, '5-claim-form');
    await wo.page.getByTestId('cta').click();
    await wo.page.getByTestId('claim-event').first().waitFor({ timeout: 30000 });
    const cl = (await call('GET', '/claims', { t: O.t })).j.claims[0]; claimId = cl.id; const full = (await call('GET', `/claims/${claimId}`, { t: O.t })).j;
    must(full.evidence.filter((e) => e.source === 'upload').length === 1 && full.evidence.filter((e) => e.source === 'handover').length >= 4, 'evidence ' + JSON.stringify(full.evidence.map((e) => e.source)));
    must(full.claimed_amount === 40000 && full.type === 'damage' && full.comparison, 'claim body');
    await waitText(wo, 'cl.compare'); await noEnglish(wo); await shot(wo, '6-claim-detail');
  }, wo);
  await step('fr: driver sees "claims about me" and replies (right of reply)', async () => {
    await call('PATCH', '/users/me', { t: abd.t, body: { preferred_language: 'fr' } });
    const wd = await open(abd, 'fr', 'driver', 'driver');
    await wd.page.getByText(D.fr['drv.mode'], { exact: false }).first().waitFor({ timeout: 25000 });
    await wd.page.getByText(T(wd, 'cl.title.about'), { exact: true }).first().click();
    await wd.page.getByTestId('claim-row').first().click(); await wd.page.getByTestId('claim-msg').waitFor({ timeout: 20000 });
    await waitText(wd, 'cl.reply.hint'); await noEnglish(wd); await shot(wd, '1-claim-reply');
    await wd.page.getByTestId('claim-msg').fill('La rayure etait deja la au depart, voir les photos'); await wd.page.getByTestId('claim-send').click();
    await waitText(wd, 'cl.reply.done', {}, 20000); await shot(wd, '2-replied');
    const full = (await call('GET', `/claims/${claimId}`, { t: abd.t })).j; must(full.replied === true && full.events.some((e) => e.kind === 'reply'), 'reply not recorded');
    must(full.you_are === 'respondent', 'role');
    const n = (await db.query("select count(*)::int n from notifications where user_id=$1 and template_key='claim_received'", [abd.id])).rows[0].n; must(n >= 1, 'no claim_received notification');
    await wd.ctx.close();
  });
  await step('staff decision (partly accepted) is visible to the owner in the app and via the API', async () => {
    seed({ claims: [{ action: 'review', id: claimId, staff_id: abd.id, mode: 'start' }, { action: 'decide', id: claimId, staff_id: abd.id, outcome: 'partially_accepted', amount: 15000, reason: 'Part of the damage was already noted at pickup' }] });
    const full = (await call('GET', `/claims/${claimId}`, { t: O.t })).j; must(full.status === 'partially_accepted' && full.decision?.amount === 15000, 'API ' + JSON.stringify(full.decision) + full.status);
    await wo.page.reload(); await wo.page.getByTestId('tab-account').click(); await wo.page.getByTestId('open-claims').click();
    await wo.page.getByTestId('claim-row').first().waitFor({ timeout: 20000 }); await wo.page.getByText(T(wo, 'cl.st.partially_accepted'), { exact: true }).first().waitFor();
    await wo.page.getByTestId('claim-row').first().click(); await wo.page.getByTestId('decision-amount').waitFor({ timeout: 20000 });
    must(/15,000/.test(await wo.page.getByTestId('decision-amount').innerText()), 'amount'); must((await wo.page.getByTestId('decision-reason').innerText()).includes('already noted'), 'reason');
    await waitText(wo, 'cl.settlement.none'); await noEnglish(wo); await shot(wo, '7-decision');
  }, wo);
  await step('settlement as credit shows in the claim and in the credit balance', async () => {
    const before = (await call('GET', '/wallet', { t: O.t })).j.available;
    seed({ claims: [{ action: 'settle', id: claimId, staff_id: abd.id, amount: 15000 }] });
    const after = (await call('GET', '/wallet', { t: O.t })).j.available; must(after - before === 15000, `credit ${after - before}`);
    await wo.page.reload(); await wo.page.getByTestId('tab-account').click(); await wo.page.getByTestId('open-claims').click(); await wo.page.getByTestId('claim-row').first().click();
    await waitText(wo, 'cl.settlement.credit', { n: '15,000' }, 20000); await shot(wo, '8-settled');
  }, wo);
  await step('rw: USSD card in Profile (no shortcode in /config -> generic text)', async () => {
    await wo.page.reload(); await wo.page.getByTestId('tab-account').click(); await wo.page.getByTestId('ussd-card').waitFor({ timeout: 15000 });
    const cfg = (await call('GET', '/config', {})).j; must(!cfg.ussd?.shortcode, 'unexpected shortcode in config');
    await waitText(wo, 'us.code.generic'); await noEnglish(wo); await shot(wo, '9-ussd-profile');
  }, wo);
  await step('rw: History shows credit used on the credit trip and a report link', async () => {
    await w1.page.getByTestId('back').click().catch(() => {}); await w1.page.reload(); await goHome(w1);
    await w1.page.getByTestId('tab-trips').click(); await w1.page.getByText(/Credit [\d,]+ RWF/).first().waitFor({ timeout: 20000 });
    await waitText(w1, 'cl.history.report'); await shot(w1, '6-history');
  }, w1);
} catch (e) { failed++; console.log('FATAL', e.stack?.split('\n').slice(0, 3).join(' | ')); }
console.log('browser errors (excluding map tiles / third-party):', JSON.stringify(errors.filter((e) => !/tile|leaflet|unpkg|ERR_|Failed to load resource|net::|Access-Control|CORS|status of 4\d\d/i.test(e))));
await br.close(); await db.end();
console.log(failed ? `${failed} FAILED` : 'ALL OK'); process.exit(failed ? 1 : 0);

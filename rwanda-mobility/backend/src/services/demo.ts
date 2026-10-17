import { randomUUID } from 'node:crypto';
import { pool, q, q1 } from '../db.js';
import { encode as gh } from '../util/geohash.js';
import { computeFare, activeRule, kigaliHour, kigaliDow, type Rule, type Breakdown } from './pricing.js';
import { resolveCommission, calcCommission } from './commission.js';
import { haversineM } from '../util/geo.js';
import { createHash } from 'node:crypto';
import { loadExtras } from './demoExtras.js';

/**
 * Demo data for presentations: about a week of believable activity (drivers, riders, trips, payments, earnings, ledger entries, ratings, a few scheduled
 * rides) generated through the same tables the real app uses, so every console page and both apps show real-looking numbers.
 *  - Everything demo is tagged users.device_fingerprint = 'demo' (and ledger memos start with "demo:"), so `clearDemo` removes exactly that and nothing else.
 *  - Deterministic (seeded) so the same options give the same picture. Phones: riders +25078899xxxx, drivers +25078899xxxx (see DEMO_PHONES).
 *  - While demo drivers exist, `keepDemoDriversAlive` (a background job) keeps the online ones moving on the live map.
 */
export const DEMO_TAG = 'demo';
export const DEMO_PHONES = { first_rider: '+250788990001', first_driver: '+250788991001' };

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const FIRST = ['Jean', 'Eric', 'Patrick', 'Claude', 'Emmanuel', 'Olivier', 'Samuel', 'Innocent', 'Fabrice', 'Didier', 'Alexis', 'Theogene', 'Jean Paul', 'Aimable', 'Celestin', 'Vincent', 'Eugene', 'Pacifique', 'Gilbert', 'Bonaventure',
  'Diane', 'Grace', 'Chantal', 'Aline', 'Sandrine', 'Josiane', 'Divine', 'Clarisse', 'Beatrice', 'Solange', 'Marie', 'Jeannette', 'Esperance', 'Francine', 'Ange', 'Peace', 'Liliane', 'Yvonne', 'Valentine', 'Carine'];
const LAST = ['Mugisha', 'Niyonzima', 'Habimana', 'Uwimana', 'Nsengiyumva', 'Mukamana', 'Ndayisaba', 'Irakoze', 'Hakizimana', 'Uwase', 'Nshimiyimana', 'Mutesi', 'Bizimana', 'Ingabire', 'Twagirayezu', 'Kamanzi', 'Iradukunda', 'Mukeshimana', 'Rugamba', 'Nkurunziza',
  'Tuyisenge', 'Munyaneza', 'Uwizeye', 'Gasana', 'Kayitesi', 'Ishimwe', 'Havugimana', 'Murekatete', 'Kalisa', 'Umutoni'];
const AREAS: [string, number, number][] = [['Nyarugenge', -1.9500, 30.0588], ['Kimironko', -1.9441, 30.1260], ['Remera', -1.9570, 30.1127], ['Kacyiru', -1.9358, 30.0640], ['Gisozi', -1.9190, 30.0560], ['Nyamirambo', -1.9770, 30.0420],
  ['Kicukiro Centre', -1.9930, 30.1020], ['Gikondo', -1.9760, 30.0770], ['Nyabugogo', -1.9395, 30.0430], ['Kigali Heights', -1.9535, 30.0930], ['Kibagabaga', -1.9250, 30.1180], ['Gatenga', -2.0150, 30.0870], ['Kanombe', -1.9686, 30.1395],
  ['Kisimenti', -1.9500, 30.1040], ['Nyabisindu', -1.9300, 30.0870], ['Rebero', -2.0000, 30.0750], ['Kinyinya', -1.9040, 30.0870], ['Gahanga', -2.0300, 30.1300]];
const HOUR_W = [0.4, 0.2, 0.15, 0.15, 0.3, 0.8, 2, 3.4, 3.8, 2.6, 2, 2.2, 2.4, 2.2, 2, 2.2, 2.8, 3.6, 3.8, 3, 2.2, 1.6, 1.1, 0.7];   // Kigali hours: morning and evening peaks
const COMMENTS: Record<string, string[]> = {
  rw: ['Yatinze cyane kugera aho nari ndi.', 'Imodoka yari yanduye.', 'Atwara nabi, nagize ubwoba.', 'Inzira yahisemo ntiyari nziza.'],
  fr: ['Le chauffeur est arrivé très en retard.', 'La voiture n\'était pas propre.', 'Conduite trop rapide, je n\'étais pas à l\'aise.', 'Mauvais choix d\'itinéraire.'],
  en: ['The driver arrived very late.', 'The car was not clean.', 'Driving felt unsafe.', 'Poor choice of route.'],
};
const NEG_TAGS = ['late', 'dirty_car', 'unsafe', 'bad_route', 'rude'], POS_TAGS = ['polite', 'clean_car', 'safe_driving', 'knows_route', 'on_time', 'helpful'];
const PLATE_L = 'ABCDEFGHJKLMNPRSTUVWXYZ';

export type DemoOptions = { drivers?: number; riders?: number; days?: number };
export type DemoSummary = { drivers: number; riders: number; trips: number; completed: number; ratings: number; scheduled: number; revenue_commission: number; days: number };

type Col = [string, string];
async function bulk(db: { query: (t: string, v?: any[]) => Promise<any> }, table: string, cols: Col[], rows: Record<string, unknown>[], exprs?: Record<string, string>, chunk = 400) {
  const list = cols.map(([n]) => n).join(', '), def = cols.map(([n, t]) => `${n} ${t}`).join(', '), sel = cols.map(([n]) => exprs?.[n] ?? `x.${n}`).join(', ');
  for (let i = 0; i < rows.length; i += chunk)
    await db.query(`insert into ${table}(${list}) select ${sel} from json_to_recordset($1::json) as x(${def})`, [JSON.stringify(rows.slice(i, i + chunk))]);
}

export async function demoStatus() {
  const r = await q1<any>(`select (select count(*) from users where device_fingerprint=$1 and exists (select 1 from user_roles r where r.user_id=users.id and r.role='driver'))::int drivers,
      (select count(*) from users where device_fingerprint=$1 and not exists (select 1 from user_roles r where r.user_id=users.id and r.role='driver'))::int riders,
      (select count(*) from bookings b join users u on u.id=b.passenger_id where u.device_fingerprint=$1)::int trips`, [DEMO_TAG]);
  return { loaded: r.drivers > 0 || r.riders > 0, ...r, sample_rider_phone: DEMO_PHONES.first_rider, sample_driver_phone: DEMO_PHONES.first_driver };
}

export async function loadDemo(opts: DemoOptions = {}): Promise<DemoSummary> {
  const nDrivers = Math.max(5, Math.min(150, Math.floor(opts.drivers ?? 40))), nRiders = Math.max(10, Math.min(500, Math.floor(opts.riders ?? 90))), days = Math.max(1, Math.min(31, Math.floor(opts.days ?? 14)));
  if ((await demoStatus()).loaded) await clearDemo();
  const rnd = rng(20260101 + nDrivers * 7 + nRiders * 13 + days);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const now = Date.now(), DAY = 864e5, kigaliMidnight = (t: number) => Math.floor((t + 2 * 3600e3) / DAY) * DAY - 2 * 3600e3;
  const rules = new Map<string, Rule>(), comm = new Map<string, any>();
  for (const s of ['moto', 'standard', 'abasare', 'airport']) {
    try { rules.set(s, await activeRule(s, 'kigali')); comm.set(s, await resolveCommission(s, '00000000-0000-0000-0000-000000000000', null)); } catch { /* service without a price: skipped */ }
  }
  if (!rules.size) throw new Error('No active prices found. Run the first-time setup (seed) before loading demo data.');
  const services = [...rules.keys()];

  // ---- people ----
  const users: any[] = [], roles: any[] = [], profiles: any[] = [], vehicles: any[] = [];
  const name = () => `${pick(FIRST)} ${pick(LAST)}`;
  const jitter = (n: number) => (rnd() - 0.5) * n;
  const driverRows: { id: string; kind: 'moto' | 'car'; activity: number; weak: boolean; abasare: boolean; area: [string, number, number]; online: boolean }[] = [];
  const plates = new Set<string>();
  const plate = (moto: boolean) => { for (;;) { const p = `${moto ? 'RE' : 'RA'}${pick([...PLATE_L])} ${100 + Math.floor(rnd() * 900)} ${pick([...PLATE_L])}`; if (!plates.has(p)) { plates.add(p); return p; } } };
  const earliest = new Date(now - (days + 25) * DAY).toISOString();
  for (let i = 0; i < nDrivers; i++) {
    const id = randomUUID(), kind: 'moto' | 'car' = i % 5 < 2 ? 'moto' : 'car', abasare = kind === 'car' && i % 9 === 0, area = pick(AREAS), weak = i % 17 === 5;
    const online = createHash('md5').update(id).digest('hex')[0] < '8', lat = area[1] + jitter(0.012), lng = area[2] + jitter(0.012);
    driverRows.push({ id, kind, activity: 0.45 + rnd() * 1.1, weak, abasare, area, online });
    users.push({ id, phone: `+25078899${1001 + i}`, device_fingerprint: DEMO_TAG, display_name: name(), preferred_language: pick(['rw', 'rw', 'fr', 'en']), created_at: new Date(now - (days + 20 - Math.floor(rnd() * 14)) * DAY).toISOString() });
    roles.push({ user_id: id, role: 'driver' }, { user_id: id, role: 'passenger' });
    profiles.push({ user_id: id, legal_name: users[users.length - 1].display_name, is_online: online, last_lat: lat, last_lng: lng, gh6: gh(lat, lng, 6), gh5: gh(lat, lng, 5), gh4: gh(lat, lng, 4), abasare_status: abasare ? 'approved' : 'none',
      accepting: abasare ? '{ride,abasare}' : '{ride}', submitted_at: users[users.length - 1].created_at, decided_at: users[users.length - 1].created_at, created_at: users[users.length - 1].created_at });
    const car = kind === 'car';
    vehicles.push({ id: randomUUID(), driver_id: id, vehicle_type: car ? 'car' : 'moto', comfort: car && i % 4 === 0, make: car ? pick(['Toyota', 'Suzuki', 'Hyundai', 'Kia', 'Nissan']) : pick(['TVS', 'Bajaj', 'Honda', 'Boxer']),
      model: car ? pick(['Corolla', 'Vitz', 'Swift', 'Accent', 'Rio', 'Note']) : pick(['HLX', 'Boxer 150', 'CG 125']), color: pick(['White', 'Silver', 'Black', 'Blue', 'Red']), year: 2012 + Math.floor(rnd() * 11), plate: plate(!car), capacity: car ? 4 : 1 });
  }
  const riderIds: string[] = [], riderLang = new Map<string, string>();
  for (let i = 0; i < nRiders; i++) {
    const id = randomUUID(), lang = pick(['rw', 'rw', 'rw', 'fr', 'en']);
    riderIds.push(id); riderLang.set(id, lang);
    users.push({ id, phone: `+25078899${String(i + 1).padStart(4, '0')}`, device_fingerprint: DEMO_TAG, display_name: name(), preferred_language: lang, created_at: new Date(now - (days + 25 - Math.floor(rnd() * (days + 24))) * DAY).toISOString() });
    roles.push({ user_id: id, role: 'passenger' });
  }
  // the first two phones are easy to remember for a live demo: rider +250788990001, driver +250788991001

  // ---- trips ----
  const quotes: any[] = [], bookings: any[] = [], payments: any[] = [], earnings: any[] = [], ledger: any[] = [], ratings: any[] = [];
  const stat = new Map<string, { done: number; cancels: number; last: string; sum: number; n: number }>(); for (const d of driverRows) stat.set(d.id, { done: 0, cancels: 0, last: '', sum: 0, n: 0 });
  const hourTotal = HOUR_W.reduce((a, b) => a + b, 0);
  const pickHour = () => { let r = rnd() * hourTotal; for (let h = 0; h < 24; h++) { r -= HOUR_W[h]; if (r <= 0) return h; } return 12; };
  const refSeen = new Set<string>(); const newRef = () => { for (;;) { const r = 'DM-' + Math.floor(rnd() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0'); if (!refSeen.has(r)) { refSeen.add(r); return r; } } };
  const weightedDriver = (pool: typeof driverRows) => { const tot = pool.reduce((a, d) => a + d.activity, 0); let r = rnd() * tot; for (const d of pool) { r -= d.activity; if (r <= 0) return d; } return pool[0]; };
  const motoDrivers = driverRows.filter((d) => d.kind === 'moto'), carDrivers = driverRows.filter((d) => d.kind === 'car'), abasareDrivers = driverRows.filter((d) => d.abasare);
  const midnight0 = kigaliMidnight(now) - (days - 1) * DAY;
  let completed = 0, ratingN = 0, commissionSum = 0, seq = 0;

  const trip = (reqAt: number, svc: string, status: 'PAYMENT_COMPLETED' | 'CANCELLED_BY_PASSENGER' | 'CANCELLED_BY_DRIVER' | 'NO_DRIVER_FOUND' | 'SCHEDULED' | 'IN_PROGRESS' | 'SEARCHING_DRIVER', o: { area?: [string, number, number]; jit?: number; passenger?: string; driver?: (typeof driverRows)[number] } = {}) => {
    const rule = rules.get(svc)!, a = o.area ?? pick(AREAS); let b = pick(AREAS); while (b === a) b = pick(AREAS);
    const jt = o.jit ?? 0.006, p = { lat: a[1] + jitter(jt), lng: a[2] + jitter(jt) }, d = { lat: b[1] + jitter(0.006), lng: b[2] + jitter(0.006) };
    const distance_m = Math.round(Math.max(900, haversineM(p, d) * 1.3)), duration_s = Math.round(distance_m / (svc === 'moto' ? 8.2 : 6.4)) + 120;
    const when = new Date(reqAt);
    let bd: Breakdown;
    try { bd = computeFare(rule, { distance_m, duration_s, local_hour: kigaliHour(when), local_dow: kigaliDow(when), airport: svc === 'airport', hours: svc === 'abasare_hourly' ? 3 : undefined }); }
    catch { const sub = Math.max(rule.minimum_fare, Math.round((rule.base_fare + (rule.per_km * distance_m) / 1000) / 100) * 100); bd = { lines: [{ code: 'fare', label_en: 'Fare', label_rw: 'Igiciro', label_fr: 'Tarif', amount: sub }], subtotal: sub, discount: 0, tax: 0, total: sub, passthrough: 0, commissionable: sub, currency: 'RWF' }; }
    const passenger = o.passenger ?? riderIds[Math.min(riderIds.length - 1, Math.floor(rnd() ** 1.6 * riderIds.length))];
    const quoteId = randomUUID(), bookingId = randomUUID(), ref = newRef();
    const pool = svc === 'moto' ? motoDrivers : svc === 'abasare' && abasareDrivers.length ? abasareDrivers : carDrivers;
    const drv = status === 'NO_DRIVER_FOUND' || status === 'SCHEDULED' || status === 'SEARCHING_DRIVER' ? null : o.driver ?? weightedDriver(pool.length ? pool : driverRows);
    const veh = drv ? vehicles.find((v) => v.driver_id === drv.id) : null;
    const iso = (ms: number) => new Date(ms).toISOString();
    const method = rnd() < 0.55 ? 'cash' : 'mtn_momo';
    const assigned = reqAt + (25 + rnd() * 70) * 1000, arrived = assigned + (3 + rnd() * 6) * 60000, started = arrived + (1 + rnd() * 2.5) * 60000, done = started + duration_s * 1000;
    quotes.push({ id: quoteId, passenger_id: passenger, service_id: svc, zone_id: 'kigali', pickup_lat: p.lat, pickup_lng: p.lng, dest_lat: d.lat, dest_lng: d.lng, distance_m, duration_s, route_source: 'demo', rule_id: rule.id, rule_version: rule.version,
      breakdown: bd, total: bd.total, expires_at: iso(reqAt + 600000), used_booking_id: bookingId, created_at: iso(reqAt - 20000) });
    const row: any = { id: bookingId, ref, passenger_id: passenger, driver_id: drv?.id ?? null, vehicle_id: veh?.id ?? null, service_id: svc, zone_id: 'kigali', status, pickup_lat: p.lat, pickup_lng: p.lng, pickup_name: a[0], dest_lat: d.lat, dest_lng: d.lng, dest_name: b[0],
      quote_id: quoteId, estimated_fare: bd.total, final_fare: null, fare_breakdown: null, distance_m, duration_s, payment_method: method, idempotency_key: `demo-${++seq}-${ref}`, requested_at: iso(reqAt), created_at: iso(reqAt), updated_at: iso(reqAt),
      scheduled_for: null, safety_checks: false, auto_share: false, assigned_at: null, arrived_at: null, started_at: null, completed_at: null, cancelled_at: null, cancel_by: null, cancel_reason: null };
    if (status === 'SCHEDULED') { row.scheduled_for = iso(reqAt); row.requested_at = iso(now - rnd() * 3 * 3600e3); row.created_at = row.requested_at; row.updated_at = row.requested_at; }
    else if (status === 'NO_DRIVER_FOUND') { row.updated_at = iso(reqAt + 90000); }
    else if (status === 'SEARCHING_DRIVER') { row.updated_at = iso(reqAt + 20000); }
    else if (status === 'IN_PROGRESS') {
      Object.assign(row, { assigned_at: iso(reqAt + 40000), arrived_at: iso(reqAt + 6 * 60000), started_at: iso(reqAt + 8 * 60000) }); row.updated_at = row.started_at;
      const pf = profiles.find((q) => q.user_id === drv!.id); if (pf) { pf.last_lat = (p.lat + d.lat) / 2; pf.last_lng = (p.lng + d.lng) / 2; pf.gh6 = gh(pf.last_lat, pf.last_lng, 6); pf.gh5 = gh(pf.last_lat, pf.last_lng, 5); pf.gh4 = gh(pf.last_lat, pf.last_lng, 4); pf.is_online = true; }
    }
    else if (status.startsWith('CANCELLED')) {
      Object.assign(row, { assigned_at: iso(assigned), cancelled_at: iso(assigned + (1 + rnd() * 4) * 60000), cancel_by: status.endsWith('PASSENGER') ? 'passenger' : 'driver', cancel_reason: status.endsWith('PASSENGER') ? 'changed_my_mind' : 'vehicle_problem' });
      row.updated_at = row.cancelled_at; if (status === 'CANCELLED_BY_DRIVER') stat.get(drv!.id)!.cancels += 1;
    } else if (status === 'PAYMENT_COMPLETED') {
      Object.assign(row, { final_fare: bd.total, fare_breakdown: bd, assigned_at: iso(assigned), arrived_at: iso(arrived), started_at: iso(started), completed_at: iso(done), pin_verified_at: iso(started) });
      row.updated_at = row.completed_at;
      const rule2 = comm.get(svc), commission = calcCommission(rule2, bd.commissionable), net = bd.subtotal - commission, paid = bd.subtotal + bd.tax - bd.discount;
      const payId = randomUUID(), cash = method === 'cash', txn = randomUUID(), memo = `demo: trip ${ref} settlement (${method})`;
      payments.push({ id: payId, booking_id: bookingId, payer_user_id: passenger, method, provider: method === 'cash' ? 'cash' : 'mtn_momo', amount: paid, status: 'SUCCESS', reference: `DEMO-${ref}`, provider_reference: cash ? null : `MOMO${Math.floor(rnd() * 1e9)}`,
        msisdn_masked: cash ? null : '+25078****' + String(Math.floor(rnd() * 90 + 10)), amount_collected: cash ? paid : null, settlement_status: cash ? 'unsettled' : 'settled', created_at: iso(done), completed_at: iso(done + 20000) });
      earnings.push({ booking_id: bookingId, driver_id: drv!.id, fare_subtotal: bd.subtotal, discount: bd.discount, tax: bd.tax, passthrough: bd.passthrough, commissionable: bd.commissionable, commission, fleet_share: 0, net, commission_rule_id: rule2.id, payment_method: method, collected_by: cash ? 'driver' : 'platform', created_at: iso(done + 25000) });
      const L = (account_code: string, debit: number, credit: number, owner: string | null) => ({ txn_id: txn, account_code, owner_user_id: owner, booking_id: bookingId, payment_id: payId, debit, credit, memo, created_at: iso(done + 25000) });
      ledger.push(L(cash ? 'CASH_WITH_DRIVERS' : 'PROVIDER_CLEARING', paid, 0, cash ? drv!.id : null), L('PROMO_EXPENSE', bd.discount, 0, null), L('DRIVER_PAYABLE', 0, net, drv!.id), L('COMMISSION_REVENUE', 0, commission, null), L('TAX_PAYABLE', 0, bd.tax, null));
      completed++; commissionSum += commission;
      const st = stat.get(drv!.id)!; st.done += 1; if (iso(done) > st.last) st.last = iso(done);
      // ratings: riders rate most trips; a few drivers are clearly weaker so the staff flags have something to show
      if (rnd() < 0.72) {
        const r = rnd(); const cut = drv!.weak ? [0.25, 0.55, 0.75, 0.9] : [0.68, 0.92, 0.97, 0.99]; const score = r < cut[0] ? 5 : r < cut[1] ? 4 : r < cut[2] ? 3 : r < cut[3] ? 2 : 1;
        const lang = riderLang.get(passenger) ?? 'rw', low = score <= 2, why = Math.floor(rnd() * 4);
        ratings.push({ booking_id: bookingId, reviewer_id: passenger, reviewee_id: drv!.id, score, comment: low ? COMMENTS[lang][why] : rnd() < 0.2 ? pick(['Merci', 'Murakoze cyane', 'Great driver']) : null,
          tags: JSON.stringify(low ? [NEG_TAGS[why]] : score >= 4 && rnd() < 0.6 ? [pick(POS_TAGS)] : []), created_at: iso(done + 120000 + rnd() * 600000) });
        st.sum += score; st.n += 1; ratingN++;
      }
      if (rnd() < 0.35) ratings.push({ booking_id: bookingId, reviewer_id: drv!.id, reviewee_id: passenger, score: rnd() < 0.9 ? 5 : 4, comment: null, tags: '[]', created_at: iso(done + 90000) });
    }
    bookings.push(row);
  };

  for (let day = 0; day < days; day++) {
    const dayStart = midnight0 + day * DAY, dow = kigaliDow(new Date(dayStart + 12 * 3600e3));
    const perDriver = 2.1 * (dow === 5 ? 1.25 : dow === 6 ? 1.15 : dow === 0 ? 0.8 : 1) * (0.55 + 0.45 * (day / Math.max(1, days - 1)));   // Friday busiest, Sunday quiet, steady growth so the week-on-week change is positive
    const n = Math.round(nDrivers * perDriver * (0.9 + rnd() * 0.2));
    for (let k = 0; k < n; k++) {
      const reqAt = dayStart + (pickHour() * 3600 + Math.floor(rnd() * 3600)) * 1000;
      if (reqAt > now - 20 * 60000) continue;
      const r = rnd(), svc = rnd() < 0.42 ? 'moto' : rnd() < 0.82 ? 'standard' : rnd() < 0.6 && rules.has('abasare') ? 'abasare' : rules.has('airport') ? 'airport' : 'standard';
      trip(reqAt, rules.has(svc) ? svc : services[0], r < 0.865 ? 'PAYMENT_COMPLETED' : r < 0.93 ? 'CANCELLED_BY_PASSENGER' : r < 0.95 ? 'CANCELLED_BY_DRIVER' : 'NO_DRIVER_FOUND');
    }
  }
  const tomorrow = kigaliMidnight(now) + DAY; let scheduled = 0;
  for (const hh of [6.5, 8, 14.25]) { trip(tomorrow + hh * 3600e3, rules.has('standard') ? 'standard' : services[0], 'SCHEDULED'); scheduled++; }

  // busy right now: the last hour has requests clustered in three areas (feeds the demand map), four trips are on the road and two riders are waiting for a driver
  const hot = [AREAS[1], AREAS[2], AREAS[8]];
  for (const [ai, area] of hot.entries()) for (let k = 0; k < 7; k++) {
    trip(now - (14 + k * 6 + ai) * 60000, ai === 2 ? 'moto' : 'standard', 'PAYMENT_COMPLETED', { area, jit: 0.0018, passenger: riderIds[(ai * 9 + k * 4 + 2) % riderIds.length] });
    trip(now - 7 * DAY - (8 + k * 6 + ai) * 60000, ai === 2 ? 'moto' : 'standard', 'PAYMENT_COMPLETED', { area, jit: 0.0018, passenger: riderIds[(ai * 9 + k * 4 + 3) % riderIds.length] });
  }
  const onlineRows = driverRows.filter((d) => d.online), busy = new Set<string>();
  for (const [i, d] of onlineRows.filter((q) => q.kind === 'car').slice(0, 2).concat(onlineRows.filter((q) => q.kind === 'moto').slice(0, 2)).entries()) {
    trip(now - (6 + i * 2) * 60000, d.kind === 'moto' ? 'moto' : 'standard', 'IN_PROGRESS', { driver: d, passenger: riderIds[riderIds.length - 1 - i] }); busy.add(d.id);
  }
  for (let i = 0; i < 2; i++) trip(now - 25000 - i * 15000, 'standard', 'SEARCHING_DRIVER', { passenger: riderIds[riderIds.length - 10 - i] });

  // ---- write everything in one transaction ----
  const c = await pool.connect();
  try {
    await c.query('begin');
    await bulk(c, 'users', [['id', 'uuid'], ['phone', 'text'], ['device_fingerprint', 'text'], ['display_name', 'text'], ['preferred_language', 'text'], ['created_at', 'timestamptz']], users);
    await bulk(c, 'user_roles', [['user_id', 'uuid'], ['role', 'text']], roles);
    await bulk(c, 'driver_profiles', [['user_id', 'uuid'], ['legal_name', 'text'], ['status', 'text'], ['zone_id', 'text'], ['is_online', 'boolean'], ['last_lat', 'float8'], ['last_lng', 'float8'], ['last_location_at', 'timestamptz'], ['last_seen_at', 'timestamptz'],
      ['gh6', 'text'], ['gh5', 'text'], ['gh4', 'text'], ['abasare_status', 'text'], ['accepting', 'text'], ['submitted_at', 'timestamptz'], ['decided_at', 'timestamptz'], ['created_at', 'timestamptz'], ['payout_provider', 'text']],
      profiles.map((p) => ({ ...p, status: 'APPROVED', zone_id: 'kigali', last_location_at: new Date(now).toISOString(), last_seen_at: new Date(now).toISOString(), payout_provider: 'mtn_momo' })),
      { accepting: 'x.accepting::text[]', last_seen_at: 'case when x.is_online then x.last_seen_at else x.last_seen_at - interval \'3 hours\' end' });
    await bulk(c, 'vehicles', [['id', 'uuid'], ['driver_id', 'uuid'], ['vehicle_type', 'text'], ['comfort', 'boolean'], ['make', 'text'], ['model', 'text'], ['color', 'text'], ['year', 'int'], ['plate', 'text'], ['capacity', 'int'], ['status', 'text']], vehicles.map((v) => ({ ...v, status: 'approved' })));
    await bulk(c, 'fare_quotes', [['id', 'uuid'], ['passenger_id', 'uuid'], ['service_id', 'text'], ['zone_id', 'text'], ['pickup_lat', 'float8'], ['pickup_lng', 'float8'], ['dest_lat', 'float8'], ['dest_lng', 'float8'], ['distance_m', 'int'], ['duration_s', 'int'], ['route_source', 'text'],
      ['rule_id', 'uuid'], ['rule_version', 'int'], ['breakdown', 'jsonb'], ['total', 'int'], ['expires_at', 'timestamptz'], ['used_booking_id', 'uuid'], ['created_at', 'timestamptz']], quotes);
    await bulk(c, 'bookings', [['id', 'uuid'], ['ref', 'text'], ['passenger_id', 'uuid'], ['driver_id', 'uuid'], ['vehicle_id', 'uuid'], ['service_id', 'text'], ['zone_id', 'text'], ['status', 'text'], ['pickup_lat', 'float8'], ['pickup_lng', 'float8'], ['pickup_name', 'text'],
      ['dest_lat', 'float8'], ['dest_lng', 'float8'], ['dest_name', 'text'], ['quote_id', 'uuid'], ['estimated_fare', 'int'], ['final_fare', 'int'], ['fare_breakdown', 'jsonb'], ['distance_m', 'int'], ['duration_s', 'int'], ['payment_method', 'text'], ['idempotency_key', 'text'],
      ['scheduled_for', 'timestamptz'], ['requested_at', 'timestamptz'], ['assigned_at', 'timestamptz'], ['arrived_at', 'timestamptz'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz'], ['cancelled_at', 'timestamptz'], ['cancel_by', 'text'], ['cancel_reason', 'text'],
      ['safety_checks', 'boolean'], ['auto_share', 'boolean'], ['created_at', 'timestamptz'], ['updated_at', 'timestamptz']], bookings);
    await bulk(c, 'payments', [['id', 'uuid'], ['booking_id', 'uuid'], ['payer_user_id', 'uuid'], ['method', 'text'], ['provider', 'text'], ['amount', 'int'], ['status', 'text'], ['reference', 'text'], ['provider_reference', 'text'], ['msisdn_masked', 'text'], ['amount_collected', 'int'],
      ['settlement_status', 'text'], ['created_at', 'timestamptz'], ['completed_at', 'timestamptz']], payments);
    await bulk(c, 'driver_earnings', [['booking_id', 'uuid'], ['driver_id', 'uuid'], ['fare_subtotal', 'int'], ['discount', 'int'], ['tax', 'int'], ['passthrough', 'int'], ['commissionable', 'int'], ['commission', 'int'], ['fleet_share', 'int'], ['net', 'int'], ['commission_rule_id', 'uuid'],
      ['payment_method', 'text'], ['collected_by', 'text'], ['created_at', 'timestamptz']], earnings);
    await bulk(c, 'ledger_entries', [['txn_id', 'uuid'], ['account_code', 'text'], ['owner_user_id', 'uuid'], ['booking_id', 'uuid'], ['payment_id', 'uuid'], ['debit', 'bigint'], ['credit', 'bigint'], ['memo', 'text'], ['created_at', 'timestamptz']], ledger.filter((e) => e.debit > 0 || e.credit > 0));
    await bulk(c, 'ratings', [['booking_id', 'uuid'], ['reviewer_id', 'uuid'], ['reviewee_id', 'uuid'], ['score', 'int'], ['comment', 'text'], ['tags', 'text'], ['created_at', 'timestamptz']], ratings, { tags: "array(select jsonb_array_elements_text(x.tags::jsonb))" });
    await loadExtras(c, { now, rnd, pick, name, riders: riderIds, drivers: driverRows.map((d) => ({ id: d.id, kind: d.kind, abasare: d.abasare })), tag: DEMO_TAG,
      done: bookings.filter((b) => b.status === 'PAYMENT_COMPLETED').map((b) => ({ id: b.id, ref: b.ref, passenger_id: b.passenger_id, driver_id: b.driver_id, fare: b.final_fare, payment_id: payments.find((pm) => pm.booking_id === b.id)!.id })) });
    for (const [id, s] of stat) {
      await c.query(`update driver_profiles set completed_count=$2, cancel_count=$3, accepted_count=$4, offers_count=$5, rating_count=$6, rating_avg=$7, last_trip_at=nullif($8,'')::timestamptz where user_id=$1`,
        [id, s.done, s.cancels, s.done + s.cancels, s.done + s.cancels + Math.round(s.done * 0.25), s.n, s.n ? Math.round((s.sum / s.n) * 100) / 100 : 0, s.last]);
    }
    await c.query('commit');
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  return { drivers: nDrivers, riders: nRiders, trips: bookings.length, completed, ratings: ratingN, scheduled, revenue_commission: commissionSum, days };
}

/** Deletes `table` rows matching `cond`, children first, following every single-column foreign key (anything the app created for a demo person, such as quest awards or notifications, goes too). */
async function purge(c: { query: (t: string, v?: any[]) => Promise<any> }, table: string, cond: string, params: unknown[], fks: Map<string, any[]>, depth = 0): Promise<void> {
  if (depth > 8) throw new Error(`demo cleanup: foreign keys nested too deeply at ${table}: ${cond.slice(0, 600)}`);
  if (!fks.has(table)) {
    const r = await c.query(`select c.conrelid::regclass::text child, a.attname childcol, af.attname refcol, a.attnotnull notnull from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.contype = 'f' and c.confrelid = $1::regclass and array_length(c.conkey, 1) = 1`, [table]);
    fks.set(table, r.rows);
  }
  for (const f of fks.get(table)!) {
    const sub = `${f.childcol} in (select ${f.refcol} from ${table} where ${cond})`;
    if (f.child === table) { if (!f.notnull) await c.query(`update ${table} set ${f.childcol} = null where ${sub}`, params); continue; }
    if ((await c.query(`select 1 from ${f.child} where ${sub} limit 1`, params)).rowCount) await purge(c, f.child, sub, params, fks, depth + 1);   // only follow tables that really hold rows for these people
  }
  await c.query(`delete from ${table} where ${cond}`, params);
}

/** Remove exactly the demo rows. Ledger entries are append-only, so the delete briefly lifts that guard inside one transaction (no-op when nothing is tagged). */
export async function clearDemo(): Promise<{ removed_users: number; ledger_removed: boolean }> {
  const ids = (await q<any>('select id from users where device_fingerprint=$1', [DEMO_TAG])).map((r) => r.id);
  if (!ids.length && !(await q1("select 1 from promotions where code like 'DEMO-%'"))) return { removed_users: 0, ledger_removed: true };
  let ledgerRemoved = true;
  const c = await pool.connect();
  try {
    await c.query('begin');
    try {
      await c.query('savepoint lg');
      await c.query('alter table ledger_entries disable trigger ledger_immutable');
      await c.query("delete from ledger_entries where memo like 'demo:%'");
      await c.query('alter table ledger_entries enable trigger ledger_immutable');
    } catch { await c.query('rollback to savepoint lg'); ledgerRemoved = false; }
    await c.query('delete from admin_alerts where actor_id = any($1::uuid[]) or acknowledged_by = any($1::uuid[])', [ids]);
    await c.query('delete from risk_events where user_id = any($1::uuid[])', [ids]);
    for (const t of ['request_codes', 'partners', 'campaigns', 'driver_quests', 'fixed_routes', 'corporate_accounts']) await purge(c, t, 'created_by = any($1::uuid[])', [ids], new Map());
    await purge(c, 'fleets', 'owner_user_id = any($1::uuid[])', [ids], new Map());
    await purge(c, 'promotions', "code like 'DEMO-%'", [], new Map());
    await purge(c, 'users', 'id = any($1::uuid[])', [ids], new Map());
    await c.query('commit');
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  return { removed_users: ids.length, ledger_removed: ledgerRemoved };
}

/** Background job: keeps the online demo drivers "fresh" and drifting on the live map while demo data exists (so the Live map and the rider map are alive during a presentation). */
export async function keepDemoDriversAlive() {
  await q(`update driver_profiles d set is_online=true, last_seen_at=now(), last_location_at=now(),
      last_lat = d.last_lat + (random() - 0.5) * 0.0008, last_lng = d.last_lng + (random() - 0.5) * 0.0008
    from users u where u.id=d.user_id and u.device_fingerprint=$1 and d.status='APPROVED' and left(md5(d.user_id::text),1) < '8'`, [DEMO_TAG]);
}

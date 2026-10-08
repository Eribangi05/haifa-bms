import { createHash } from 'node:crypto';
import { q, q1, tx as dbtx } from '../db.js';
import { AppError } from '../errors.js';
import { normalizePhone } from '../util/phone.js';
import { getSetting } from './settings.js';
import { localizeError } from './errmsg.js';
import { estimate, createBooking, cancelBooking, bookingView } from './bookings.js';
import { payDeposit } from './deposit.js';
import { randomToken } from '../util/crypto.js';
import { tx as T, MAX_SCREEN, type ULang, type TxtKey } from './ussdText.js';

/**
 * USSD booking gateway state machine. Transport-independent: routes/ussd.ts maps Africa's Talking form posts and the generic JSON mode onto handleUssd().
 * The phone number comes from the telecom and is treated as verified (no OTP). State lives in ussd_sessions so any API instance can answer.
 * Rides over USSD are CASH ONLY. The main menu is: 1 ride, 2 my trip, 3 Abasare (own car), 4 help, 0 language.
 */
export type UssdIn = { sessionId: string; phone: string; serviceCode?: string; input: string | null; fullText?: string | null; provider?: string; newSession?: boolean };
export type UssdOut = { message: string; end: boolean };
type Item = { name: string; lat?: number; lng?: number; id?: string };
type St = { step: string; lang?: ULang; data: Record<string, any> };

const ACTIVE = ['REQUESTED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS', 'COMPLETED', 'PAYMENT_PENDING', 'SCHEDULED'];
const CANCELLABLE = ['REQUESTED', 'SEARCHING_DRIVER', 'SCHEDULED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'];
const HOURS = [2, 3, 4, 6];
const buckets = new Map<string, number[]>();
/** Per-phone burst limit (a handset cannot legitimately send more than ~30 screens a minute). */
export function phoneLimited(phone: string, max = Number(process.env.USSD_PHONE_RATE_MAX ?? 40)): boolean {
  const now = Date.now(), a = (buckets.get(phone) ?? []).filter((x) => now - x < 60_000);
  a.push(now); buckets.set(phone, a);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((x) => now - x < 60_000)) buckets.delete(k);
  return a.length > max;
}
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '.' : s);
/** Keeps a screen within the telecom limit by dropping numbered list lines from the end, never by cutting a sentence. */
export function fit(lines: string[], listFrom = -1): string {
  const L = [...lines];
  while (L.join('\n').length > MAX_SCREEN && listFrom >= 0 && L.length > listFrom + 2) L.splice(L.length - 2, 1);   // keep the final "0 Back" line
  const s = L.join('\n');
  return s.length > MAX_SCREEN ? s.slice(0, MAX_SCREEN) : s;
}
const con = (message: string): UssdOut => ({ message, end: false });
const end = (message: string): UssdOut => ({ message, end: true });

async function placesFor(userId: string, lang: ULang, exclude?: Item | null): Promise<Item[]> {
  const saved = await q<any>('select name, lat, lng from saved_places where user_id=$1 order by created_at limit 3', [userId]);
  const pop = await q<any>('select id, name_en, name_rw, name_fr, lat, lng from places order by designated_pickup desc, name_en limit 12');
  const out: Item[] = saved.map((s) => ({ name: cut(s.name, 16), lat: s.lat, lng: s.lng }));
  for (const p of pop) {
    const nm = (lang === 'rw' ? p.name_rw : lang === 'fr' ? p.name_fr : null) || p.name_en;
    out.push({ name: cut(nm, 16), lat: p.lat, lng: p.lng, id: p.id });
  }
  return out.filter((i) => !exclude || i.lat !== exclude.lat || i.lng !== exclude.lng).slice(0, 5);
}
const listScreen = (header: string, items: Item[], back: string) => fit([header, ...items.map((it, i) => `${i + 1} ${it.name}`), back], 1);

async function ensureUser(phone: string, lang: ULang): Promise<string> {
  const u = await q1<any>('select id from users where phone=$1', [phone]);
  if (u) return u.id;
  return dbtx(async (c) => {
    const r = await q1<any>(`insert into users(phone, preferred_language, referral_code) values ($1,$2,$3) on conflict (phone) do update set phone=excluded.phone returning id`,
      [phone, lang, 'RM' + randomToken(5).replace(/[^A-Za-z0-9]/g, 'X').toUpperCase().slice(0, 6)], c);
    await q("insert into user_roles values ($1,'passenger') on conflict do nothing", [r.id], c);
    await q("insert into consents(user_id,kind,version,granted) values ($1,'terms','ussd-v1',true),($1,'privacy','ussd-v1',true)", [r.id], c);
    return r.id as string;
  });
}

async function activeBooking(userId: string) {
  return q1<any>(`select * from bookings where passenger_id=$1 and status = any($2) order by created_at desc limit 1`, [userId, ACTIVE]);
}

async function tripScreen(userId: string, lang: ULang, st: St): Promise<UssdOut> {
  const b = await activeBooking(userId);
  if (!b) return end(T('no_trip', lang));
  const v = await bookingView(b, 'passenger');
  const cancellable = CANCELLABLE.includes(b.status);
  let head: string;
  if (['REQUESTED', 'SEARCHING_DRIVER', 'SCHEDULED'].includes(b.status)) head = T('trip_search', lang, { ref: b.ref });
  else if (['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'].includes(b.status))
    head = T('trip_driver', lang, { ref: b.ref, driver: cut(v.driver?.name ?? '', 14), plate: v.vehicle?.plate ?? v.abasare?.vehicle?.plate ?? '', pin: v.trip_pin ?? '' });
  else if (b.status === 'IN_PROGRESS') head = T('trip_going', lang, { ref: b.ref });
  else return end(T('trip_done', lang, { ref: b.ref, fare: b.final_fare ?? b.estimated_fare }));
  st.step = 'trip'; st.data = { bookingId: b.id, ref: b.ref };
  return con(cancellable ? fit([head, T('trip_cancel_opt', lang)]) : head);
}

const startStep = async (phone: string): Promise<{ lang?: ULang; step: string; userId?: string }> => {
  const p = await q1<any>('select language from ussd_phones where phone=$1', [phone]);
  const u = await q1<any>('select id, status, preferred_language from users where phone=$1', [phone]);
  const lang = (p?.language ?? undefined) as ULang | undefined;
  if (!lang) return { step: 'lang', userId: u?.id };
  if (!u) return { lang, step: 'terms' };
  return { lang, step: 'main', userId: u.id };
};

async function estimateRide(userId: string, lang: ULang, pickup: Item, dest: Item, st: St): Promise<UssdOut> {
  let e: any;
  try { e = await estimate(userId, { pickup: { lat: pickup.lat!, lng: pickup.lng! }, dest: { lat: dest.lat!, lng: dest.lng! } }); }
  catch (err: any) { if (err instanceof AppError) return end(cut(localizeError(err.code, lang, err.message, err.details), MAX_SCREEN)); throw err; }
  const opts = (e.options as any[]).filter((o) => o.available && o.quote_id && o.kind === 'ride').slice(0, 3);
  if (!opts.length) return end(T('no_drivers', lang));
  st.step = 'fare'; st.data.options = opts.map((o) => ({ quote: o.quote_id, name: cut((lang === 'rw' ? o.name_rw : lang === 'fr' ? o.name_fr : o.name_en) ?? o.service_id, 14), fare: o.fare.total }));
  return con(fit([T('fares', lang), ...st.data.options.map((o: any, i: number) => `${i + 1} ${o.name} ${o.fare}`), T('back', lang)], 1));
}

/** Core dialogue. `st` is mutated to the next state. */
async function step(inp: UssdIn, st: St, input: string, fresh: boolean): Promise<{ out: UssdOut; outcome?: string; bookingId?: string }> {
  const phone = normalizePhone(inp.phone)!;
  const lang = st.lang;
  const reply = (out: UssdOut, extra: { outcome?: string; bookingId?: string } = {}) => ({ out, ...extra });
  const invalid = (screen: string, l: ULang) => con(fit([T('invalid', l), screen]));

  // --- language and terms
  if (st.step === 'lang') {
    if (fresh) return reply(con(T('lang', 'en')));
    const pick = ({ '1': 'rw', '2': 'fr', '3': 'en' } as Record<string, ULang>)[input];
    if (!pick) return reply(con(fit([T('invalid', 'en'), T('lang', 'en')])));
    await q(`insert into ussd_phones(phone, language) values ($1,$2) on conflict (phone) do update set language=excluded.language, last_seen_at=now()`, [phone, pick]);
    await q('update users set preferred_language=$2 where phone=$1', [phone, pick]);
    st.lang = pick;
    const s = await startStep(phone);
    st.step = s.step; st.data = {};
    return reply(con(s.step === 'terms' ? T('terms', pick) : T('main', pick)));
  }
  if (!lang) { st.step = 'lang'; return reply(con(T('lang', 'en'))); }
  if (st.step === 'terms') {
    if (fresh) return reply(con(T('terms', lang)));
    if (input === '1') {
      await ensureUser(phone, lang);
      await q('update ussd_phones set terms_accepted_at=now(), user_id=(select id from users where phone=$1) where phone=$1', [phone]);
      st.step = 'main'; st.data = {};
      return reply(con(T('main', lang)));
    }
    if (input === '2') return reply(end(T('terms_declined', lang)), { outcome: 'declined' });
    return reply(invalid(T('terms', lang), lang));
  }
  const u = await q1<any>('select id, status from users where phone=$1', [phone]);
  if (!u) { st.step = 'terms'; return reply(con(T('terms', lang))); }
  if (u.status !== 'active') return reply(end(T('blocked', lang)), { outcome: 'blocked' });
  const userId = u.id as string;

  const toMain = () => { st.step = 'main'; st.data = {}; return con(T('main', lang)); };
  if (fresh && st.step === 'main') return reply(con(T('main', lang)));

  switch (st.step) {
    case 'main': {
      if (input === '0') { st.step = 'lang'; return reply(con(T('lang', 'en'))); }
      if (input === '4') return reply(end(T('help', lang)), { outcome: 'help' });
      if (input === '2') return reply(await tripScreen(userId, lang, st));
      if (input === '1' || input === '3') {
        if (await activeBooking(userId)) return reply(end(T('has_trip', lang)));
        if (input === '3') {
          const cars = await q<any>('select id, plate, make, model, vehicle_class from customer_vehicles where owner_id=$1 and active order by created_at limit 3', [userId]);
          if (!cars.length) return reply(end(T('no_car', lang)), { outcome: 'no_car' });
          st.step = 'a_car'; st.data = { cars: cars.map((c) => ({ id: c.id, plate: c.plate, name: cut(`${c.plate} ${c.make ?? ''}`.trim(), 18) })) };
          return reply(con(fit([T('car', lang), ...st.data.cars.map((c: any, i: number) => `${i + 1} ${c.name}`), T('back', lang)], 1)));
        }
        const items = await placesFor(userId, lang);
        if (!items.length) return reply(end(T('no_places', lang)));
        st.step = 'pickup'; st.data = { items };
        return reply(con(listScreen(T('pickup', lang), items, T('back', lang))));
      }
      return reply(invalid(T('main', lang), lang));
    }
    case 'pickup': case 'dest': case 'a_pickup': {
      const items: Item[] = st.data.items;
      const screen = listScreen(T(st.step === 'dest' ? 'dest' : 'pickup', lang), items, T('back', lang));
      if (fresh) return reply(con(screen));
      if (input === '0') return reply(toMain());
      const it = items[Number(input) - 1];
      if (!/^\d+$/.test(input) || !it) return reply(con(fit([T('invalid', lang), screen], 1)));
      if (st.step === 'pickup') {
        st.data.pickup = it; st.step = 'dest'; st.data.items = await placesFor(userId, lang, it);
        return reply(con(listScreen(T('dest', lang), st.data.items, T('back', lang))));
      }
      if (st.step === 'dest') { st.data.dest = it; return reply(await estimateRide(userId, lang, st.data.pickup, it, st)); }
      // Abasare: pickup chosen, now hours
      st.data.pickup = it; st.step = 'a_hours';
      return reply(con(T('hours', lang)));
    }
    case 'fare': {
      const opts = st.data.options as any[];
      if (input === '0') return reply(toMain());
      const o = opts[Number(input) - 1];
      if (!/^\d+$/.test(input) || !o) return reply(con(fit([T('invalid', lang), T('fares', lang), ...opts.map((x, i) => `${i + 1} ${x.name} ${x.fare}`), T('back', lang)], 2)));
      st.data.choice = o; st.step = 'confirm';
      return reply(con(T('confirm', lang, { svc: o.name, fare: o.fare })));
    }
    case 'confirm': {
      if (input === '2') return reply(end(T('cancelled_end', lang)), { outcome: 'declined_fare' });
      if (input !== '1') return reply(invalid(T('confirm', lang, { svc: st.data.choice.name, fare: st.data.choice.fare }), lang));
      try {
        const { booking } = await createBooking(userId, { quote_id: st.data.choice.quote, payment_method: 'cash', idempotency_key: 'ussd-' + createHash('sha256').update(inp.sessionId + st.data.choice.quote).digest('hex').slice(0, 40),
          pickup_name: st.data.pickup.name, dest_name: st.data.dest?.name, channel: 'ussd' });
        return reply(end(T('booked', lang, { ref: booking.ref })), { outcome: 'booked', bookingId: booking.id });
      } catch (err: any) {
        if (err instanceof AppError) return reply(end(cut(localizeError(err.code, lang, err.message, err.details), MAX_SCREEN)), { outcome: 'error' });
        throw err;
      }
    }
    case 'trip': {
      if (input === '0') return reply(toMain());
      if (input === '1') {
        const b = await q1<any>('select ref, status from bookings where id=$1 and passenger_id=$2', [st.data.bookingId, userId]);
        if (!b || !CANCELLABLE.includes(b.status)) return reply(end(T('cancel_late', lang)));
        st.step = 'cancel'; return reply(con(T('cancel_ask', lang, { ref: b.ref })));
      }
      return reply(invalid(T('trip_cancel_opt', lang), lang));
    }
    case 'cancel': {
      if (input === '2') return reply(end(T('cancel_kept', lang)));
      if (input !== '1') return reply(invalid(T('cancel_ask', lang, { ref: st.data.ref }), lang));
      try {
        const b = await cancelBooking(userId, st.data.bookingId, 'ussd_cancel', 'passenger');
        return reply(end(b.cancel_fee > 0 ? T('cancel_fee', lang, { fee: b.cancel_fee }) : T('cancel_done', lang)), { outcome: 'cancelled', bookingId: b.id });
      } catch (err: any) {
        if (err instanceof AppError && err.status === 409) return reply(end(T('cancel_late', lang)));
        throw err;
      }
    }
    case 'a_car': {
      const cars = st.data.cars as any[];
      if (input === '0') return reply(toMain());
      const c = cars[Number(input) - 1];
      if (!/^\d+$/.test(input) || !c) return reply(con(fit([T('invalid', lang), T('car', lang), ...cars.map((x, i) => `${i + 1} ${x.name}`), T('back', lang)], 2)));
      st.data.car = c; st.step = 'a_pickup'; st.data.items = await placesFor(userId, lang);
      return reply(con(listScreen(T('pickup', lang), st.data.items, T('back', lang))));
    }
    case 'a_hours': {
      if (input === '0') return reply(toMain());
      const h = HOURS[Number(input) - 1];
      if (!/^\d+$/.test(input) || !h) return reply(invalid(T('hours', lang), lang));
      let e: any;
      try { e = await estimate(userId, { pickup: { lat: st.data.pickup.lat, lng: st.data.pickup.lng }, abasare: { customer_vehicle_id: st.data.car.id, hours: h } }); }
      catch (err: any) { if (err instanceof AppError) return reply(end(cut(localizeError(err.code, lang, err.message, err.details), MAX_SCREEN))); throw err; }
      const o = (e.options as any[]).find((x) => x.available && x.quote_id);
      if (!o) return reply(end(T('no_drivers', lang)));
      st.data.hours = h; st.data.quote = o.quote_id; st.data.fare = o.fare.total; st.step = 'a_confirm';
      return reply(con(T('abasare_confirm', lang, { plate: st.data.car.plate, h, fare: o.fare.total })));
    }
    case 'a_confirm': {
      if (input === '2') return reply(end(T('cancelled_end', lang)), { outcome: 'declined_fare' });
      if (input !== '1') return reply(invalid(T('abasare_confirm', lang, { plate: st.data.car.plate, h: st.data.hours, fare: st.data.fare }), lang));
      try {
        const { booking } = await createBooking(userId, { quote_id: st.data.quote, payment_method: 'cash', idempotency_key: 'ussd-' + createHash('sha256').update(inp.sessionId + st.data.quote).digest('hex').slice(0, 40),
          pickup_name: st.data.pickup.name, customer_vehicle_id: st.data.car.id, owner_attested: true, channel: 'ussd' });
        const dep = await q1<any>("select amount, status from booking_deposits where booking_id=$1", [booking.id]);
        if (dep && dep.status === 'awaiting_payment') {
          try { await payDeposit(userId, booking.id, { method: 'mtn_momo', msisdn: phone }); return reply(end(T('abasare_deposit', lang, { ref: booking.ref, amount: dep.amount })), { outcome: 'booked', bookingId: booking.id }); }
          catch { return reply(end(T('abasare_deposit_pay', lang, { ref: booking.ref, amount: dep.amount })), { outcome: 'booked', bookingId: booking.id }); }
        }
        return reply(end(T('abasare_booked', lang, { ref: booking.ref })), { outcome: 'booked', bookingId: booking.id });
      } catch (err: any) {
        if (err instanceof AppError) return reply(end(cut(localizeError(err.code, lang, err.message, err.details), MAX_SCREEN)), { outcome: 'error' });
        throw err;
      }
    }
  }
  return reply(toMain());
}

export async function handleUssd(inp: UssdIn): Promise<UssdOut> {
  const phone = normalizePhone(inp.phone);
  if (!phone) return end(T('bad_phone', 'en'));
  if (!(await getSetting('ussd.enabled'))) return end(T('disabled', 'en'));
  const ph0 = await q1<any>('select language from ussd_phones where phone=$1', [phone]);
  const l0 = (ph0?.language ?? 'en') as ULang;
  if (phoneLimited(phone)) return end(T('busy', l0));
  const ttl = await getSetting('ussd.session_ttl_s');
  const row = await q1<any>('select * from ussd_sessions where session_id=$1', [inp.sessionId]);
  const expired = !!row && new Date(row.expires_at) < new Date();
  // an aggregator retry of the same request must get the same answer and must not advance the dialogue
  if (row && (!expired || row.outcome) && inp.fullText != null && inp.fullText === row.last_text && row.last_response) return JSON.parse(row.last_response);
  const isNew = !row || expired || !!inp.newSession || (inp.fullText === '' || inp.input === null);
  try {
    let st: St;
    let out: { out: UssdOut; outcome?: string; bookingId?: string };
    if (isNew) {
      const s = await startStep(phone);
      st = { step: s.step, lang: s.lang, data: {} };
      out = await step(inp, st, '', true);
      if (row) await q('delete from ussd_sessions where session_id=$1', [inp.sessionId]);
      await q(`insert into ussd_sessions(session_id, phone, provider, service_code, step, state, language, last_text, last_response, screens, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,1, now() + make_interval(secs => $10))`,
        [inp.sessionId, phone, inp.provider ?? 'africastalking', inp.serviceCode ?? null, st.step, JSON.stringify(st.data), st.lang ?? null, inp.fullText ?? null, JSON.stringify(out.out), ttl]);
    } else {
      st = { step: row.step, lang: row.language ?? undefined, data: row.state ?? {} };
      out = await step(inp, st, String(inp.input ?? '').trim(), false);
      await q(`update ussd_sessions set step=$2, state=$3, language=$4, last_text=$5, last_response=$6, screens=screens+1, outcome=coalesce($7,outcome), booking_id=coalesce($8,booking_id),
        expires_at = now() + make_interval(secs => $9), updated_at=now() where session_id=$1`, [inp.sessionId, st.step, JSON.stringify(st.data), st.lang ?? null, inp.fullText ?? null, JSON.stringify(out.out), out.outcome ?? null, out.bookingId ?? null, ttl]);
    }
    if (out.out.end) await q("update ussd_sessions set expires_at = now(), outcome = coalesce(outcome, 'completed') where session_id=$1", [inp.sessionId]);
    return out.out;
  } catch (e: any) {
    await q("update ussd_sessions set outcome='error' where session_id=$1", [inp.sessionId]).catch(() => {});
    if (process.env.QUIET !== '1') console.error('ussd error', e?.message);
    return end(T('error', l0));
  }
}

/** Retention: sessions are an operational log, not an archive. */
export async function purgeUssdSessions(days = 30) {
  const r = await q("delete from ussd_sessions where created_at < now() - make_interval(days => $1) returning 1", [days]);
  return r.length;
}

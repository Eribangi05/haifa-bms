import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';

export type Ctx = Awaited<ReturnType<typeof boot>>;
let counter = 0;

export const KCC = { lat: -1.954, lng: 30.0927 };           // pickup
export const KIMIRONKO = { lat: -1.9496, lng: 30.1262 };    // destination (~4-5 km)

export async function boot(dbName = 'rwanda_mobility_test') {
  process.env.NODE_ENV = 'test';
  process.env.QUIET = '1';
  process.env.OTP_DEV_ECHO = 'true';
  process.env.MOMO_MODE = 'simulator';
  process.env.RATE_LIMIT_MAX = '1000000';
  process.env.AUTH_RATE_MAX = '1000000';
  for (const k of ['UPLOAD_RATE_MAX', 'BOOKING_RATE_MAX', 'PAYMENT_RATE_MAX', 'ESTIMATE_RATE_MAX', 'CLIENT_ERR_RATE_MAX']) process.env[k] = '1000000';
  process.env.STORAGE_DIR = `/tmp/rm-test-storage-${process.pid}`;
  process.env.DATABASE_URL = `postgres://rm:rm@localhost:5432/${process.env.TEST_DB_NAME ?? dbName}`; // TEST_DB_NAME lets parallel workers use separate databases
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query('drop schema public cascade; create schema public;');
  await admin.end();
  const db = await import('../src/db.js');
  const { migrate } = await import('../src/migrate.js');
  const seed = await import('../src/seed.js');
  const { buildApp } = await import('../src/app.js');
  const crypto = await import('../src/util/crypto.js');
  await migrate(false);
  await seed.seedCore();
  await db.q("insert into system_settings(key,value) values ('otp.max_per_hour_ip','1000000'),('otp.resend_cooldown_s','0') on conflict (key) do update set value=excluded.value");
  const routes: { method: string; url: string }[] = [];
  const app = await buildApp({ onRoute: (r) => { for (const m of ([] as string[]).concat(r.method as any)) if (m !== 'HEAD' && m !== 'OPTIONS') routes.push({ method: m, url: r.url }); } });
  await app.ready();

  const api = async (method: string, url: string, o: { token?: string; body?: any; headers?: Record<string, string>; payload?: any } = {}) => {
    const r = await app.inject({
      method: method as any, url: /^\/(share\/|r\/|health|ready)/.test(url) ? url : `/api/v1${url}`,
      headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.headers ?? {}) },
      payload: o.payload ?? o.body,
    });
    let json: any = null; try { json = r.json(); } catch { /* not json */ }
    return { status: r.statusCode, json, raw: r.payload, headers: r.headers };
  };

  const phone = () => `+25078${String(1000000 + ++counter * 7 + Math.floor(Math.random() * 5)).slice(-7)}`.replace(/^(\+250\d{9}).*/, '$1');
  async function register(role: 'passenger' | 'driver' = 'passenger', ph = phone(), device = `dev-${randomUUID()}`) {
    const o = await api('POST', '/auth/otp/request', { body: { phone: ph } });
    if (o.status !== 200) throw new Error('otp request failed ' + JSON.stringify(o.json));
    const v = await api('POST', '/auth/otp/verify', { body: { phone: ph, code: o.json.dev_code, role }, headers: { 'x-device-id': device } });
    if (v.status !== 200) throw new Error('otp verify failed ' + JSON.stringify(v.json));
    return { token: v.json.access_token as string, refresh: v.json.refresh_token as string, id: v.json.user.id as string, phone: ph };
  }

  async function staff(role: string) {
    const email = `${role}-${randomUUID().slice(0, 6)}@test.local`;
    const pw = 'CorrectHorse-Battery-9';
    const s = await seed.createStaff(email, pw, role);
    const l = await api('POST', '/auth/staff/login', { body: { email, password: pw, totp: crypto.totpAt(s.totpSecret) } });
    if (l.status !== 200) throw new Error('staff login failed ' + JSON.stringify(l.json));
    return { token: l.json.access_token as string, id: s.id as string, email, password: pw, totpSecret: s.totpSecret as string };
  }

  /** Creates an approved, dispatchable driver (documents inserted as already reviewed). */
  async function driver(opts: { vehicle?: 'moto' | 'car' | 'minivan'; at?: { lat: number; lng: number }; online?: boolean; capacity?: number; comfort?: boolean; fleetId?: string } = {}) {
    const u = await register('driver');
    const vt = opts.vehicle ?? 'moto';
    const plate = `R${vt === 'moto' ? 'D' : 'A'}${String(Math.floor(Math.random() * 900) + 100)}${'ABCDEFGHJKLMNP'[Math.floor(Math.random() * 14)]}`;
    await db.q("update users set display_name=$2 where id=$1", [u.id, 'Test Driver ' + plate]);
    await db.q("update driver_profiles set status='APPROVED', legal_name='Test Driver', zone_id='kigali', payout_msisdn='+250788000001', fleet_id=$2 where user_id=$1", [u.id, opts.fleetId ?? null]);
    await db.q("insert into vehicles(driver_id, vehicle_type, comfort, make, model, color, plate, capacity, status, fleet_id) values ($1,$2,$3,'Toyota','Test','White',$4,$5,'approved',$6)", [u.id, vt, opts.comfort ?? false, plate, opts.capacity ?? (vt === 'moto' ? 1 : vt === 'minivan' ? 7 : 4), opts.fleetId ?? null]);
    const reqs = await db.q('select doc_type, requires_expiry from document_requirements where vehicle_type=$1 and mandatory', [vt]);
    for (const r of reqs)
      await db.q("insert into driver_documents(driver_id, doc_type, file_key, mime, size, expiry_date, review_status) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',10,$3,'approved')", [u.id, r.doc_type, r.requires_expiry ? '2099-01-01' : null]);
    if (opts.online !== false) {
      const a = await api('PATCH', '/drivers/me/availability', { token: u.token, body: { online: true } });
      if (a.status !== 200) throw new Error('go online failed ' + JSON.stringify(a.json));
      await api('POST', '/drivers/me/location', { token: u.token, body: opts.at ?? KCC });
    }
    return { ...u, plate };
  }

  async function estimate(token: string, extra: any = {}) {
    return api('POST', '/fares/estimate', { token, body: { pickup: KCC, dest: KIMIRONKO, ...extra } });
  }
  async function book(token: string, service = 'moto', method = 'cash', extra: any = {}) {
    const e = await estimate(token, { service_id: service, ...(extra.estimate ?? {}) });
    const opt = e.json?.options?.[0];
    if (!opt?.quote_id) throw new Error('no quote: ' + JSON.stringify(e.json));
    const r = await api('POST', '/bookings', { token, headers: { 'idempotency-key': extra.key ?? randomUUID() }, body: { quote_id: opt.quote_id, payment_method: method, pickup_name: 'KCC', dest_name: 'Kimironko', ...(extra.body ?? {}) } });
    return { res: r, quote: opt };
  }

  /** Drive a booking through the whole trip. Returns the final booking view for the driver. */
  async function runTrip(passenger: { token: string }, drv: { token: string }, bookingId: string) {
    const a = await api('POST', `/bookings/${bookingId}/accept`, { token: drv.token });
    if (a.status !== 200) throw new Error('accept failed ' + JSON.stringify(a.json));
    await api('POST', '/drivers/me/location', { token: drv.token, body: { lat: KCC.lat + 0.0001, lng: KCC.lng } });
    await api('POST', `/bookings/${bookingId}/en-route`, { token: drv.token });
    const ar = await api('POST', `/bookings/${bookingId}/arrived`, { token: drv.token });
    if (ar.status !== 200) throw new Error('arrive failed ' + JSON.stringify(ar.json));
    const pv = await api('GET', `/bookings/${bookingId}`, { token: passenger.token });
    const st = await api('POST', `/bookings/${bookingId}/start`, { token: drv.token, body: { pin: pv.json.trip_pin } });
    if (st.status !== 200) throw new Error('start failed ' + JSON.stringify(st.json));
    const c = await api('POST', `/bookings/${bookingId}/complete`, { token: drv.token });
    if (c.status !== 200) throw new Error('complete failed ' + JSON.stringify(c.json));
    return c.json;
  }

  /** Test isolation: take every driver offline and close open bookings, keep users/ledger. */
  const reset = async () => {
    await db.q("insert into system_settings(key,value) values ('fraud.cancel_loop_count','1000') on conflict (key) do update set value=excluded.value");   // tests cancel many times on purpose; R5-03 turns the rule on again
    await db.q("update dispatch_offers set status='cancelled' where status='pending'");
    await db.q("update bookings set status='CANCELLED_BY_SYSTEM' where status in ('REQUESTED','SEARCHING_DRIVER','SCHEDULED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS')");
    await db.q('update driver_profiles set is_online=false');
  };
  const close = async () => { await app.close(); await db.pool.end(); };
  return { app, api, routes, reset, register, staff, driver, estimate, book, runTrip, db, close, crypto, phone };
}

/** Minimal but structurally valid files for upload tests (the upload scanner is strict). */
export function makeJpeg(w = 64, h = 64): Buffer {
  const seg = (m: number, body: Buffer) => Buffer.concat([Buffer.from([0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const sof = Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const sos = Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), seg(0xc0, sof), seg(0xda, sos), Buffer.alloc(300, 0x11), Buffer.from([0xff, 0xd9])]);
}
export function makePng(w = 64, h = 64): Buffer {
  const chunk = (type: string, data: Buffer) => { const t = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(t)); return Buffer.concat([len, t, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h); for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;   // incompressible-ish so the file is realistically sized
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const makePdf = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${extra}>>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);

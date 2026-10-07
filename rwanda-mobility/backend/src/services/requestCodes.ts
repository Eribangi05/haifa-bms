import { randomBytes } from 'node:crypto';
import { q, q1 } from '../db.js';
import { config } from '../config.js';
import { AppError, badRequest } from '../errors.js';
import { zoneFor } from './bookings.js';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0 O 1 I
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6,8}$/;
export const RWANDA = { latMin: -2.9, latMax: -1.0, lngMin: 28.8, lngMax: 30.95 };
export const inRwanda = (lat: number, lng: number) => lat >= RWANDA.latMin && lat <= RWANDA.latMax && lng >= RWANDA.lngMin && lng <= RWANDA.lngMax;
export const landingUrl = (code: string) => `${config.publicBaseUrl.replace(/\/+$/, '')}/r/${code}`;
export const newCode = (len = 6) => Array.from(randomBytes(len), (b) => CODE_ALPHABET[b % 32]).join('');

export type RequestCodeRow = {
  id: string; code: string; label: string; partner_name: string | null; lat: number; lng: number; address_note: string | null;
  default_service: 'ride' | 'abasare'; pickup_note: string | null; active: boolean; expires_at: Date | null; scans: number;
};

/** Active, unexpired code or null. Input is normalised (trim, upper-case) and never reaches SQL unless it matches the alphabet. */
export async function findUsable(raw: string): Promise<RequestCodeRow | null> {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return null;
  return q1<RequestCodeRow>('select * from request_codes where code=$1 and active and (expires_at is null or expires_at > now())', [code]).then((r) => r ?? null);
}
export async function requireUsable(raw: string) {
  const r = await findUsable(raw);
  if (!r) throw new AppError(404, 'code_invalid', 'This request code is not valid');
  return r;
}

// At most one counted scan per IP per code per 10 minutes (in memory; resets on restart, which is fine for a popularity counter).
const seen = new Map<string, number>();
export async function countScan(ip: string, row: RequestCodeRow) {
  const now = Date.now(), key = `${ip}|${row.code}`;
  if (seen.size > 20000) for (const [k, t] of seen) if (now - t > 600_000) seen.delete(k);
  const last = seen.get(key);
  if (last && now - last < 600_000) return;
  seen.set(key, now);
  await q('update request_codes set scans = scans + 1 where id=$1', [row.id]);
}

export async function publicView(row: RequestCodeRow) {
  return {
    code: row.code, label: row.label, partner_name: row.partner_name, lat: row.lat, lng: row.lng, pickup_note: row.pickup_note,
    default_service: row.default_service, zone_ok: !!(await zoneFor({ lat: row.lat, lng: row.lng })),
  };
}

export async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const c = newCode(i < 6 ? 6 : 7);
    if (!(await q1('select 1 from request_codes where code=$1', [c]))) return c;
  }
  throw badRequest('code_exists', 'Could not generate a unique code');
}

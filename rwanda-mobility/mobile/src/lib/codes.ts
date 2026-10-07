// Request codes (printed QR codes at venues): parsing, public lookup, and the "pending code" memory.
// Platform-free (no React Native imports) so it is unit-tested with plain Node.
import type { Client, KV } from './net';

export type Svc = 'ride' | 'abasare';
export type ParsedCode = { code: string; svc?: Svc };
export type RequestCodeInfo = { code: string; label: string; partner_name?: string | null; lat: number; lng: number; pickup_note?: string | null; default_service: Svc; zone_ok: boolean };

/** Same alphabet as the backend (no I, O, 0, 1): 6-8 characters. */
const CODE_RE = /^[A-HJ-NP-Z2-9]{6,8}$/;

/** Accepts a full URL (any host, ending in /r/CODE, optional trailing slash, ?query, #hash), an `abasare://r/CODE` link, or a bare code (any case). Returns null for anything else. */
export function parseCode(input: unknown): ParsedCode | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || s.length > 2048) return null;
  const m = /(?:^|\/)r\/([A-Za-z0-9]+)\/?(?:[?#](.*))?$/.exec(s);
  let raw: string | undefined; let query = '';
  if (m) { raw = m[1]; query = (m[2] ?? '').split('#')[0]; }
  else if (/^[A-Za-z0-9]+$/.test(s)) raw = s;
  if (!raw) return null;
  const code = raw.toUpperCase();
  if (!CODE_RE.test(code)) return null;
  const sv = /(?:^|&)svc=([^&]*)/.exec(query)?.[1];
  return sv === 'ride' || sv === 'abasare' ? { code, svc: sv } : { code };
}

/** Public lookup; throws ApiError (code_invalid -> 404 with a localised message, status 0 when offline). */
export const fetchRequestCode = (client: Client, code: string): Promise<RequestCodeInfo> =>
  client.get<RequestCodeInfo>(`/request-codes/${encodeURIComponent(code)}`);

// ---- pending code: remembered while the user signs in (OTP screens, consent) ----
const PENDING_KEY = 'rm_pending_code';
const PENDING_TTL_MS = 24 * 3600 * 1000;
export const savePending = (kv: KV, p: ParsedCode, now = Date.now()) => kv.set(PENDING_KEY, JSON.stringify({ ...p, at: now }));
/** Returns and clears the pending code (null if none or older than 24 h). */
export async function takePending(kv: KV, now = Date.now()): Promise<ParsedCode | null> {
  let raw: string | null = null;
  try { raw = await kv.get(PENDING_KEY); } catch { return null; }
  if (!raw) return null;
  await kv.del(PENDING_KEY);
  try { const j = JSON.parse(raw); if (now - Number(j.at) > PENDING_TTL_MS) return null; return parseCode(j.svc ? `r/${j.code}?svc=${j.svc}` : j.code); } catch { return null; }
}

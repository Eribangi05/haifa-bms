import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmac = (secret: string, s: string) => createHmac('sha256', secret).update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const randomDigits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join('');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) { await scrypt(pw, Buffer.alloc(16), 64); return false; } // equalise timing
  const [, s, h] = stored.split('$');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), 64);
  return timingSafeEqual(got, Buffer.from(h, 'base64'));
}

const key = () => createHash('sha256').update(config.dataEncKey).digest();
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/** Short-lived signed token for private file access. */
export function signFileToken(fileKey: string, ttlS = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  const sig = hmac(config.fileSigningSecret, `${fileKey}.${exp}`);
  return `${exp}.${sig}`;
}
export function verifyFileToken(fileKey: string, token: string): boolean {
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, hmac(config.fileSigningSecret, `${fileKey}.${exp}`));
}

// ---- TOTP (RFC 6238, SHA-1, 6 digits, 30s) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret(): string {
  return Array.from(randomBytes(20), (b) => B32[b % 32]).join('');
}
function b32decode(s: string): Buffer {
  let bits = '';
  for (const ch of s.replace(/=+$/, '')) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function totpAt(secret: string, t = Date.now()): string {
  const counter = Math.floor(t / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
export function verifyTotp(secret: string, code: string, t = Date.now()): boolean {
  return [-1, 0, 1].some((w) => safeEqual(totpAt(secret, t + w * 30000), code));
}
export const totpUri = (secret: string, account: string) =>
  `otpauth://totp/RwandaMobility:${encodeURIComponent(account)}?secret=${secret}&issuer=RwandaMobility`;

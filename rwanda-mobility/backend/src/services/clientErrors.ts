import { q } from '../db.js';

/** Remove obvious secrets and personal data from client-supplied diagnostics before they are stored. */
export function scrub(s: string): string {
  return s
    .replace(/(Exponent|Expo)PushToken\[[^\]]*\]/g, '[push-token]')
    .replace(/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g, '[jwt]')                                  // JWTs
    .replace(/\b(bearer|token|authorization|secret|password|pin|otp|code|key|apikey|api_key)(["']?\s*[:=]\s*["']?)([^\s"',;&}]{3,})/gi, '$1$2[redacted]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hex]')                                               // long hex secrets / hashes
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[secret]')                                    // long opaque base64/url-safe strings
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(?:\+|00)?250[\s.-]?7\d(?:[\s.-]?\d){7}\b/g, '[phone]')                         // +250 7XX XXX XXX
    .replace(/\b07\d(?:[\s.-]?\d){7}\b/g, '[phone]')                                          // 07X XXX XXXX
    .replace(/\b\d{9,}\b/g, '[number]')                                                      // ids, national id numbers, cards
    .replace(/\b1\d{15}\b/g, '[number]');
}

export type ClientErrorIn = { message: string; stack?: string; app_version?: string; platform?: string; screen?: string; lang?: string };

/** Global ceiling on stored reports per hour: a flood from many addresses can never fill the table (excess reports are acknowledged and dropped). */
const MAX_PER_HOUR = Number(process.env.CLIENT_ERR_MAX_PER_HOUR ?? 5000);

export async function recordClientError(userId: string | null, e: ClientErrorIn) {
  const recent = await q<{ n: number }>("select count(*)::int n from client_errors where created_at > now() - interval '1 hour'");
  if (recent[0].n >= MAX_PER_HOUR) return 0;
  const s = (v?: string, n = 80) => (v ? scrub(v).slice(0, n) : null);
  const r = await q<{ id: number }>(
    `insert into client_errors(user_id, message, stack, app_version, platform, screen, lang) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [userId, scrub(e.message).slice(0, 500), e.stack ? scrub(e.stack).slice(0, 4000) : null, s(e.app_version, 40), s(e.platform, 40), s(e.screen, 120), s(e.lang, 10)]);
  return r[0].id;
}

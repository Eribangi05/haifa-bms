import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const isLite = (req: FastifyRequest): boolean => {
  const qv = String((req.query as any)?.lite ?? '');
  return qv === '1' || qv === 'true' || String(req.headers['x-lite'] ?? '') === '1';
};

const drop = (o: any, keys: string[]) => { for (const k of keys) delete o[k]; return o; };
const dropNulls = (o: any, keys: string[]) => { for (const k of keys) if (o[k] == null) delete o[k]; return o; };

/** Slim booking view for slow links: no itemised fare, no signed photo URL, no empty timestamps. Same keys otherwise. */
export function liteBooking(v: any) {
  if (!v || typeof v !== 'object') return v;
  drop(v, ['fare_breakdown']);
  dropNulls(v, ['cancelled_at', 'cancel_by', 'cancel_reason', 'cancel_fee', 'scheduled_for', 'final_fare', 'assigned_at', 'started_at', 'completed_at']);
  if (v.pickup) dropNulls(v.pickup, ['note', 'name']);
  if (v.destination) dropNulls(v.destination, ['name']);
  if (v.driver) { drop(v.driver, ['photo_url']); }
  if (v.payment) dropNulls(v.payment, ['failure_reason']);
  if (v.abasare) for (const h of v.abasare.handovers ?? []) { drop(h, ['photos', 'notes', 'owner_note']); }
  v.lite = true;
  return v;
}
export function liteOffers(rows: any[]) {
  return rows.map((r) => { drop(r, ['cv_make', 'cv_model', 'cv_color', 'cv_transmission', 'trip_duration_s']); return dropNulls(r, ['pickup_note', 'pickup_name', 'dest_name', 'cv_class', 'hire_mode', 'hours_booked']); });
}
export function liteEstimate(e: any, lang: 'rw' | 'fr' | 'en') {
  for (const o of e.options ?? []) {
    o.name = o[`name_${lang}`] ?? o.name_en;
    drop(o, ['name_en', 'name_rw', 'name_fr']);
    if (o.fare) o.fare = { total: o.fare.total, subtotal: o.fare.subtotal, tax: o.fare.tax, discount: o.fare.discount, debt: o.fare.debt };
  }
  e.lite = true;
  return e;
}

const TOKEN_RE = /token=[^"&]+/g;
/**
 * Conditional GET. The ETag covers the payload with signed-URL tokens normalised, plus a 2-minute bucket so a cached body never keeps a photo link
 * (valid 5 min) for longer than it is valid. Returns true when a 304 was sent (caller must return reply).
 */
export function sendConditional(req: FastifyRequest, reply: FastifyReply, payload: unknown, variant = ''): { notModified: boolean } {
  const body = JSON.stringify(payload).replace(TOKEN_RE, 'token=');
  const etag = `W/"${createHash('sha1').update(body + '|' + variant + '|' + Math.floor(Date.now() / 120e3)).digest('base64url').slice(0, 22)}"`;
  reply.header('etag', etag).header('cache-control', 'private, no-cache').header('vary', 'authorization, accept-encoding, x-lite');
  const inm = String(req.headers['if-none-match'] ?? '');
  if (inm && inm.split(',').map((s) => s.trim()).includes(etag)) { reply.code(304); return { notModified: true }; }
  return { notModified: false };
}

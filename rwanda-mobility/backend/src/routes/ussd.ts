import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requirePerm } from '../guards.js';
import { q } from '../db.js';
import { handleUssd } from '../services/ussd.js';

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
/** IPv4 exact match or CIDR (a.b.c.d/n). IPv6 entries match exactly. */
function ipAllowed(ip: string, list: string[]): boolean {
  const norm = ip.replace(/^::ffff:/, '');
  const toN = (s: string) => s.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  return list.some((e) => {
    if (!e.includes('/')) return e.replace(/^::ffff:/, '') === norm;
    const [base, bits] = e.split('/'); const m = Number(bits);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(norm) || !/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false;
    const mask = m === 0 ? 0 : (~0 << (32 - m)) >>> 0;
    return (toN(norm) & mask) === (toN(base) & mask);
  });
}
const maskPhone = (p: string) => p.replace(/^(\+250\d{3})\d{3}(\d{3})$/, '$1***$2');

/**
 * USSD gateway (public, outside /api/v1): POST /ussd/callback.
 * Mode 1, Africa's Talking style: form fields sessionId, serviceCode, phoneNumber, text ("1*2*1"); the reply is text/plain starting "CON " or "END ".
 * Mode 2, generic JSON: {session_id, phone, input, service_code, new_session}; the reply is {message, end, continue_session}.
 * Auth: shared secret in header x-ussd-secret or ?secret= (env USSD_SHARED_SECRET), optional IP allow-list (env USSD_ALLOWED_IPS, comma separated, CIDR ok).
 */
export async function ussdRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(String(body)))); } catch (e) { done(e as Error, undefined); }
  });
  const gate = async (req: FastifyRequest) => {
    const secret = process.env.USSD_SHARED_SECRET ?? '';
    if (secret.length < 16) return { status: 503, code: 'ussd_not_configured' };
    const given = String(req.headers['x-ussd-secret'] || (req.query as any)?.secret || '');
    if (!given || !same(given, secret)) return { status: 401, code: 'unauthorized' };
    const allow = (process.env.USSD_ALLOWED_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allow.length && !ipAllowed(req.ip, allow)) return { status: 403, code: 'forbidden' };
    return null;
  };
  app.post('/ussd/callback', { config: { rateLimit: { max: Number(process.env.USSD_RATE_MAX ?? 600), timeWindow: '1 minute', keyGenerator: (req: any) => `ussd:${req.ip}` } } }, async (req, reply) => {
    const bad = await gate(req);
    if (bad) return reply.code(bad.status).send({ error: { code: bad.code, message: bad.code === 'unauthorized' ? 'Invalid USSD credentials' : 'USSD gateway refused the request' } });
    const body: any = req.body ?? {};
    const json = String(req.headers['content-type'] ?? '').includes('json');
    if (json) {
      const b = parse(z.object({ session_id: z.string().min(1).max(120), phone: z.string().min(5).max(20), input: z.string().max(60).nullable().optional(), text: z.string().max(400).optional(), service_code: z.string().max(30).optional(), new_session: z.boolean().optional(), provider: z.string().max(30).optional() }), body);
      const text = b.text ?? null;
      const input = b.input !== undefined ? b.input : text == null ? null : text === '' ? '' : text.split('*').pop()!;
      const out = await handleUssd({ sessionId: b.session_id, phone: b.phone, serviceCode: b.service_code, input: input === '' ? null : input, fullText: text, provider: b.provider ?? 'generic', newSession: b.new_session });
      return { message: out.message, end: out.end, continue_session: !out.end };
    }
    const b = parse(z.object({ sessionId: z.string().min(1).max(120), phoneNumber: z.string().min(5).max(20), serviceCode: z.string().max(30).optional(), text: z.string().max(400).default('') }), body);
    const out = await handleUssd({ sessionId: b.sessionId, phone: b.phoneNumber, serviceCode: b.serviceCode, input: b.text === '' ? null : b.text.split('*').pop()!, fullText: b.text, provider: 'africastalking' });
    reply.header('content-type', 'text/plain; charset=utf-8');
    return `${out.end ? 'END' : 'CON'} ${out.message}`;
  });
}

/** Staff views of the USSD channel (permission ussd.view). Phone numbers are masked. */
export async function ussdAdminRoutes(app: FastifyInstance) {
  const view = requirePerm('ussd.view');
  app.get('/admin/ussd/sessions', { preHandler: view }, async (req) => {
    const b = parse(z.object({ outcome: z.string().max(30).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    const rows = await q<any>(`select s.session_id, s.phone, s.provider, s.step, s.language, s.screens, s.outcome, s.created_at, s.updated_at, bk.ref booking_ref, bk.status booking_status
      from ussd_sessions s left join bookings bk on bk.id=s.booking_id where ($1::text is null or s.outcome=$1) order by s.created_at desc limit $2`, [b.outcome ?? null, b.limit]);
    return { sessions: rows.map((r) => ({ ...r, phone: maskPhone(r.phone) })) };
  });
  app.get('/admin/ussd/stats', { preHandler: view }, async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const [sessions, outcomes, channels, daily, phones] = await Promise.all([
      q(`select count(*)::int total, count(*) filter (where outcome='booked')::int booked, count(*) filter (where outcome='error')::int errors, round(avg(screens),1)::float avg_screens from ussd_sessions where created_at > now() - make_interval(days => $1)`, [days]),
      q(`select coalesce(outcome,'open') outcome, count(*)::int n from ussd_sessions where created_at > now() - make_interval(days => $1) group by 1 order by 2 desc`, [days]),
      q(`select channel, count(*)::int bookings, count(*) filter (where status in ('COMPLETED','PAYMENT_PENDING','PAYMENT_COMPLETED'))::int completed,
         count(*) filter (where status like 'CANCELLED%')::int cancelled from bookings where created_at > now() - make_interval(days => $1) group by channel order by channel`, [days]),
      q(`select (created_at at time zone 'Africa/Kigali')::date as day, count(*)::int sessions, count(*) filter (where outcome='booked')::int booked from ussd_sessions where created_at > now() - make_interval(days => $1) group by 1 order by 1`, [days]),
      q(`select language, count(*)::int n from ussd_phones group by 1 order by 2 desc`),
    ]);
    return { days, sessions: sessions[0], outcomes, channels, daily, languages: phones };
  });
}

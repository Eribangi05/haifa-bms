// Venue partners: admin management (partners.manage) and the restricted partner-facing portal (partner.portal).
// Isolation rule: a portal handler never takes a partner id from the request; it resolves the partner from the signed-in user's partner_users row.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requirePerm, actorOf, routeLimit } from '../guards.js';
import { q, q1 } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { config } from '../config.js';
import { audit } from '../services/audit.js';
import { randomToken, sha256 } from '../util/crypto.js';
import * as P from '../services/partners.js';

const idp = z.object({ id: z.string().uuid() });
const month = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
const terms = z.object({
  cycle: z.literal('monthly').default('monthly'), payment_days: z.number().int().min(0).max(120).optional(), monthly_cap: z.number().int().min(0).max(1_000_000_000).optional(),
  max_fare: z.number().int().min(0).max(10_000_000).optional(), notes: z.string().max(500).optional(),
}).strict();

export async function partnerRoutes(app: FastifyInstance) {
  const adm = { preHandler: requirePerm('partners.manage') };

  // ================= admin =================
  app.get('/admin/partners', adm, async () => ({
    partners: await q(`select p.*, (select count(*)::int from request_codes c where c.partner_id=p.id) codes, (select count(*)::int from partner_users u where u.partner_id=p.id) managers,
      (select count(*)::int from bookings b where b.partner_id=p.id) requests from partners p order by p.created_at desc`),
  }));
  app.post('/admin/partners', adm, async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(2).max(120), contact_name: z.string().max(120).optional(), contact_phone: z.string().max(30).optional(), contact_email: z.string().email().optional(),
      billing_terms: terms.optional(), status: z.enum(['pending', 'active']).default('active') }), req.body);
    return P.createPartner(actorOf(req), b);
  });
  app.get('/admin/partners/:id', adm, async (req) => {
    const { id } = parse(idp, req.params);
    const p = await q1<any>('select * from partners where id=$1', [id]); if (!p) throw notFound('partner');
    return { partner: p, codes: await P.partnerCodes(id),
      managers: await q('select u.id, u.display_name, u.email, u.status from partner_users pu join users u on u.id=pu.user_id where pu.partner_id=$1', [id]),
      invites: await q('select id, email, display_name, expires_at from staff_invites where partner_id=$1 and used_at is null and revoked_at is null and expires_at > now()', [id]) };
  });
  app.patch('/admin/partners/:id', adm, async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), contact_name: z.string().max(120).nullable().optional(), contact_phone: z.string().max(30).nullable().optional(),
      contact_email: z.string().email().nullable().optional(), billing_terms: terms.optional(), status: z.enum(['pending', 'active', 'suspended']).optional() }), req.body);
    return P.updatePartner(actorOf(req), parse(idp, req.params).id, b);
  });
  app.post('/admin/partners/:id/codes', adm, async (req) => {
    const b = parse(z.object({ code_id: z.string().uuid(), bill_to_partner: z.boolean().default(false) }), req.body);
    await P.linkCode(actorOf(req), parse(idp, req.params).id, b.code_id, b.bill_to_partner); return { ok: true };
  });
  app.delete('/admin/partners/:id/codes/:codeId', adm, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), codeId: z.string().uuid() }), req.params);
    await P.unlinkCode(actorOf(req), p.id, p.codeId); return { ok: true };
  });
  // invitation through the staff invite flow (same table, same activation page); the partner binding is written when the invitee activates
  app.post('/admin/partners/:id/invite', { ...adm, config: routeLimit('INVITE_RATE_MAX', 15) }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ email: z.string().email(), name: z.string().min(2).max(80) }), req.body);
    const p = await q1<any>('select id, status from partners where id=$1', [id]); if (!p) throw notFound('partner');
    const email = b.email.trim().toLowerCase();
    if (await q1('select 1 from users where lower(email)=$1', [email])) throw conflict('email_in_use', 'Email already registered');
    await q('update staff_invites set revoked_at=now() where lower(email)=$1 and used_at is null and revoked_at is null', [email]);
    const token = randomToken(32), expires = new Date(Date.now() + 48 * 3600_000);
    const inv = await q1<{ id: string }>("insert into staff_invites(email, display_name, role, token_hash, invited_by, expires_at, partner_id) values ($1,$2,'partner_manager',$3,$4,$5,$6) returning id", [email, b.name, sha256(token), req.auth!.id, expires, id]);
    await audit(actorOf(req), 'partner.manager_invited', 'partner', id, undefined, { email });
    return { id: inv!.id, invite_url: `${(config.publicBaseUrl || '').replace(/\/$/, '')}/admin/#activate=${token}`, expires_at: expires.toISOString(), note: 'Shown once. Send it only to the invitee.' };
  });
  app.get('/admin/partners/:id/statement', adm, async (req) => P.partnerStatement(parse(idp, req.params).id, parse(month, req.query).month));
  app.post('/admin/partners/:id/invoice', adm, async (req) => P.invoicePartner(actorOf(req), parse(idp, req.params).id, parse(month, req.body).month));

  // ================= partner portal (own partner only) =================
  const portal = { preHandler: requirePerm('partner.portal') };
  app.get('/partner/me', portal, async (req) => {
    const p = await P.partnerOfUser(req.auth!.id);
    return { partner: { id: p.id, name: p.name, status: p.status, contact_name: p.contact_name, billing_terms: p.billing_terms } };
  });
  app.get('/partner/codes', portal, async (req) => ({ codes: await P.partnerCodes((await P.activePartnerOfUser(req.auth!.id)).id) }));
  app.get('/partner/requests', portal, async (req) => {
    const b = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(100), before: z.string().datetime().optional() }), req.query);
    return { requests: await P.partnerRequests((await P.activePartnerOfUser(req.auth!.id)).id, b.limit, b.before) };
  });
  app.get('/partner/statement', portal, async (req) => P.partnerStatement((await P.activePartnerOfUser(req.auth!.id)).id, parse(month, req.query).month));
}

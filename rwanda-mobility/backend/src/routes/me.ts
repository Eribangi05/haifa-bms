import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, lat, lng } from '../util/validate.js';
import { normalizePhone } from '../util/phone.js';
import { anyAuth, actorOf } from '../guards.js';
import { q, q1 } from '../db.js';
import { notFound, conflict } from '../errors.js';
import { audit } from '../services/audit.js';

export async function meRoutes(app: FastifyInstance) {
  const pre = { preHandler: anyAuth };

  app.get('/users/me', pre, async (req) => {
    const u = await q1<any>('select id, phone, email, display_name, preferred_language, notif_prefs, referral_code, status, (photo_key is not null) as has_photo, created_at from users where id=$1', [req.auth!.id]);
    return { ...u, roles: req.auth!.roles };
  });

  app.patch('/users/me', pre, async (req) => {
    const b = parse(z.object({
      display_name: z.string().min(1).max(80).optional(),
      email: z.string().email().optional(),
      preferred_language: z.enum(['rw', 'fr', 'en']).optional(),
      notif_prefs: z.object({ push: z.boolean(), sms: z.boolean(), email: z.boolean(), marketing: z.boolean() }).partial().optional(),
    }).strict(), req.body);
    const cur = await q1<any>('select notif_prefs from users where id=$1', [req.auth!.id]);
    try {
      await q(`update users set display_name=coalesce($2,display_name), email=coalesce($3,email), preferred_language=coalesce($4,preferred_language),
               notif_prefs=$5, updated_at=now() where id=$1`,
        [req.auth!.id, b.display_name ?? null, b.email ?? null, b.preferred_language ?? null, JSON.stringify({ ...cur.notif_prefs, ...(b.notif_prefs ?? {}) })]);
    } catch (e: any) { if (e.code === '23505') throw conflict('email_in_use', 'Email already registered'); throw e; }
    return { ok: true };
  });

  // saved places
  app.get('/users/me/places', pre, async (req) => ({ places: await q('select id,label,name,lat,lng,note from saved_places where user_id=$1 order by created_at', [req.auth!.id]) }));
  app.post('/users/me/places', pre, async (req) => {
    const b = parse(z.object({ label: z.enum(['home', 'work', 'school', 'other']), name: z.string().min(1).max(120), lat, lng, note: z.string().max(200).optional() }), req.body);
    const n = await q1<any>('select count(*)::int n from saved_places where user_id=$1', [req.auth!.id]);
    if (n.n >= 20) throw conflict('limit', 'Too many saved places');
    return q1('insert into saved_places(user_id,label,name,lat,lng,note) values ($1,$2,$3,$4,$5,$6) returning id,label,name,lat,lng,note', [req.auth!.id, b.label, b.name, b.lat, b.lng, b.note ?? null]);
  });
  app.delete('/users/me/places/:id', pre, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await q('delete from saved_places where id=$1 and user_id=$2', [id, req.auth!.id]);
    return { ok: true };
  });

  // emergency contacts
  app.get('/users/me/emergency-contacts', pre, async (req) => ({ contacts: await q('select id,name,phone from emergency_contacts where user_id=$1', [req.auth!.id]) }));
  app.post('/users/me/emergency-contacts', pre, async (req) => {
    const b = parse(z.object({ name: z.string().min(1).max(80), phone: z.string() }), req.body);
    const phone = normalizePhone(b.phone);
    if (!phone) throw conflict('invalid_phone', 'Invalid phone');
    const n = await q1<any>('select count(*)::int n from emergency_contacts where user_id=$1', [req.auth!.id]);
    if (n.n >= 5) throw conflict('limit', 'Maximum 5 emergency contacts');
    return q1('insert into emergency_contacts(user_id,name,phone) values ($1,$2,$3) returning id,name,phone', [req.auth!.id, b.name, phone]);
  });
  app.delete('/users/me/emergency-contacts/:id', pre, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await q('delete from emergency_contacts where id=$1 and user_id=$2', [id, req.auth!.id]);
    return { ok: true };
  });

  // consent + privacy
  app.post('/users/me/consents', pre, async (req) => {
    const b = parse(z.object({ kind: z.enum(['terms', 'privacy', 'location', 'background_location', 'marketing']), version: z.string().max(20), granted: z.boolean() }), req.body);
    await q('insert into consents(user_id,kind,version,granted) values ($1,$2,$3,$4)', [req.auth!.id, b.kind, b.version, b.granted]);
    return { ok: true };
  });
  app.post('/users/me/privacy-requests', pre, async (req) => {
    const b = parse(z.object({ kind: z.enum(['access', 'correction', 'deletion', 'deactivation']), notes: z.string().max(1000).optional() }), req.body);
    const open = await q1("select 1 from privacy_requests where user_id=$1 and kind=$2 and status in ('open','in_progress')", [req.auth!.id, b.kind]);
    if (open) throw conflict('already_open', 'You already have an open request of this type');
    const r = await q1<any>("insert into privacy_requests(user_id,kind,notes,due_at) values ($1,$2,$3, now() + interval '30 days') returning id, kind, status, due_at", [req.auth!.id, b.kind, b.notes ?? null]);
    await audit(actorOf(req), 'privacy.request', 'privacy_request', r.id, undefined, { kind: b.kind });
    return r;
  });

  // notifications
  app.get('/notifications', pre, async (req) => ({
    notifications: await q("select id, template_key, title, body, read_at, created_at from notifications where user_id=$1 and channel='in_app' order by created_at desc limit 50", [req.auth!.id]),
  }));
  app.post('/notifications/read', pre, async (req) => { await q("update notifications set read_at=now() where user_id=$1 and channel='in_app' and read_at is null", [req.auth!.id]); return { ok: true }; });

  // referral
  app.get('/users/me/referral', pre, async (req) => {
    const u = await q1<any>('select referral_code from users where id=$1', [req.auth!.id]);
    const r = await q1<any>("select count(*)::int total, count(*) filter (where status='rewarded')::int rewarded from referrals where referrer_id=$1", [req.auth!.id]);
    const vouchers = await q('select code, value, valid_to, (select count(*) from promotion_redemptions pr where pr.promotion_id=promotions.id)::int used from promotions where user_id=$1 and active', [req.auth!.id]);
    return { code: u.referral_code, ...r, vouchers };
  });
}

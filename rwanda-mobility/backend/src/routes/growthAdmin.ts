// Admin endpoints of the growth round: fixed-price routes (maker-checker), driver quests, campaigns, demand map, recurring rides overview.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requirePerm, actorOf, authenticate, routeLimit } from '../guards.js';
import { q, q1 } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { audit } from '../services/audit.js';
import { can, isStaff } from '../rbac.js';
import { getSetting } from '../services/settings.js';
import { adminQuests, QCOLS } from '../services/quests.js';
import * as C from '../services/campaigns.js';
import { heatmapView } from '../services/heatmap.js';

const idp = z.object({ id: z.string().uuid() });
const circle = z.object({ place_id: z.string().uuid().optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), radius_m: z.number().int().min(100).max(50000).default(1500) });
const names = { name_en: z.string().trim().min(2).max(120), name_rw: z.string().trim().min(2).max(120), name_fr: z.string().trim().min(2).max(120) };

async function centre(c: z.infer<typeof circle>) {
  if (c.place_id) { const p = await q1<any>('select id, lat, lng from places where id=$1', [c.place_id]); if (!p) throw notFound('place'); return { place_id: p.id, lat: p.lat, lng: p.lng, radius_m: c.radius_m }; }
  if (c.lat == null || c.lng == null) throw badRequest('validation_error', 'Give a place or coordinates');
  return { place_id: null, lat: c.lat, lng: c.lng, radius_m: c.radius_m };
}

export async function growthAdminRoutes(app: FastifyInstance) {
  const viewRoutes = async (req: any, reply: any) => {
    await authenticate(req, reply);
    if (!isStaff(req.auth!.roles) || !(can(req.auth!.roles, 'pricing.manage') || can(req.auth!.roles, 'pricing.approve'))) throw forbidden('missing permission pricing.manage or pricing.approve');
  };

  // ================= fixed-price routes =================
  app.get('/admin/fixed-routes', { preHandler: viewRoutes }, async () => ({
    routes: await q('select r.*, u.display_name proposed_by_name from fixed_routes r left join users u on u.id=r.proposed_by order by r.placeholder, r.name_en'),
    self_approval: await getSetting('pricing.self_approval'),
  }));
  app.post('/admin/fixed-routes', { preHandler: requirePerm('pricing.manage') }, async (req) => {
    const b = parse(z.object({ ...names, from: circle, to: circle, service_id: z.string().max(40), price_rwf: z.number().int().min(1).max(10_000_000), bidirectional: z.boolean().default(true),
      valid_from: z.string().datetime().nullable().optional(), valid_to: z.string().datetime().nullable().optional(), activate: z.boolean().default(false) }), req.body);
    if (!(await q1("select 1 from service_categories where id=$1 and kind='ride'", [b.service_id]))) throw badRequest('service_unavailable');
    const f = await centre(b.from), t = await centre(b.to);
    const r = await q1<any>(`insert into fixed_routes(name_en,name_rw,name_fr,from_place_id,from_lat,from_lng,from_radius_m,to_place_id,to_lat,to_lng,to_radius_m,service_id,price,bidirectional,valid_from,valid_to,created_by,pending,proposed_by,proposed_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`,
      [b.name_en, b.name_rw, b.name_fr, f.place_id, f.lat, f.lng, f.radius_m, t.place_id, t.lat, t.lng, t.radius_m, b.service_id, b.price_rwf, b.bidirectional, b.valid_from ?? null, b.valid_to ?? null, req.auth!.id,
       b.activate ? JSON.stringify({ active: true }) : null, b.activate ? req.auth!.id : null, b.activate ? new Date() : null]);
    await audit(actorOf(req), 'fixed_route.created', 'fixed_route', r.id, undefined, { name_en: b.name_en, price: b.price_rwf, activation_requested: b.activate });
    return r;
  });
  app.patch('/admin/fixed-routes/:id', { preHandler: requirePerm('pricing.manage') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ name_en: names.name_en.optional(), name_rw: names.name_rw.optional(), name_fr: names.name_fr.optional(), from: circle.optional(), to: circle.optional(), bidirectional: z.boolean().optional(),
      valid_from: z.string().datetime().nullable().optional(), valid_to: z.string().datetime().nullable().optional(), price_rwf: z.number().int().min(1).max(10_000_000).optional(), active: z.boolean().optional() }), req.body);
    const cur = await q1<any>('select * from fixed_routes where id=$1', [id]); if (!cur) throw notFound('fixed route');
    const f = b.from ? await centre(b.from) : null, t = b.to ? await centre(b.to) : null;
    // price changes and activation need a second person (like fares); deactivation and descriptive edits apply at once
    const pending = (b.price_rwf != null || b.active === true) ? { ...(cur.pending ?? {}), ...(b.price_rwf != null ? { price: b.price_rwf } : {}), ...(b.active === true ? { active: true } : {}) } : cur.pending;
    const r = await q1<any>(`update fixed_routes set name_en=coalesce($2,name_en), name_rw=coalesce($3,name_rw), name_fr=coalesce($4,name_fr),
        from_place_id=case when $5::boolean then $6 else from_place_id end, from_lat=coalesce($7,from_lat), from_lng=coalesce($8,from_lng), from_radius_m=coalesce($9,from_radius_m),
        to_place_id=case when $10::boolean then $11 else to_place_id end, to_lat=coalesce($12,to_lat), to_lng=coalesce($13,to_lng), to_radius_m=coalesce($14,to_radius_m),
        bidirectional=coalesce($15,bidirectional), valid_from=case when $16::boolean then $17 else valid_from end, valid_to=case when $18::boolean then $19 else valid_to end,
        active = case when $20::boolean is false then false else active end, pending=$21, proposed_by=case when $22::boolean then $23::uuid else proposed_by end, proposed_at=case when $22::boolean then now() else proposed_at end, updated_at=now()
      where id=$1 returning *`,
      [id, b.name_en ?? null, b.name_rw ?? null, b.name_fr ?? null, !!f, f?.place_id ?? null, f?.lat ?? null, f?.lng ?? null, f?.radius_m ?? null, !!t, t?.place_id ?? null, t?.lat ?? null, t?.lng ?? null, t?.radius_m ?? null,
       b.bidirectional ?? null, 'valid_from' in b, b.valid_from ?? null, 'valid_to' in b, b.valid_to ?? null, b.active ?? null, pending ? JSON.stringify(pending) : null, pending !== cur.pending, req.auth!.id]);
    await audit(actorOf(req), 'fixed_route.updated', 'fixed_route', id, { price: cur.price, active: cur.active }, { ...b });
    return r;
  });
  app.post('/admin/fixed-routes/:id/approve', { preHandler: requirePerm('pricing.approve') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ confirm_placeholder_price: z.boolean().default(false) }), req.body);
    const r = await q1<any>('select * from fixed_routes where id=$1', [id]); if (!r) throw notFound('fixed route');
    if (!r.pending) throw conflict('nothing_pending', 'Nothing is waiting for approval');
    if (r.proposed_by === req.auth!.id && !(await getSetting('pricing.self_approval'))) throw forbidden('Maker-checker: you cannot approve your own change');
    const price = r.pending.price ?? r.price;
    if (r.placeholder && r.pending.active && r.pending.price == null && !b.confirm_placeholder_price)
      throw badRequest('placeholder_price', 'This route still has an example (placeholder) price. Set the real price or confirm it explicitly.');
    const out = await q1<any>("update fixed_routes set price=$2, active=coalesce($3, active), placeholder=false, pending=null, approved_by=$4, updated_at=now() where id=$1 returning *", [id, price, r.pending.active ?? null, req.auth!.id]);
    await audit(actorOf(req), 'fixed_route.approved', 'fixed_route', id, { price: r.price, active: r.active }, { price, active: out.active });
    return out;
  });
  app.post('/admin/fixed-routes/:id/reject', { preHandler: requirePerm('pricing.approve') }, async (req) => {
    const { id } = parse(idp, req.params);
    const r = await q1("update fixed_routes set pending=null, updated_at=now() where id=$1 and pending is not null returning id", [id]);
    if (!r) throw notFound('pending change');
    await audit(actorOf(req), 'fixed_route.rejected', 'fixed_route', id); return { ok: true };
  });

  // ================= driver quests =================
  const questBody = z.object({
    title_en: z.string().trim().min(2).max(100), title_rw: z.string().trim().min(2).max(100), title_fr: z.string().trim().min(2).max(100),
    desc_en: z.string().trim().max(300).default(''), desc_rw: z.string().trim().max(300).default(''), desc_fr: z.string().trim().max(300).default(''),
    kind: z.enum(['trips', 'earnings', 'streak', 'peak_hours']), target: z.number().int().min(1).max(100_000_000), window: z.enum(['daily', 'weekly']),
    reward: z.number().int().min(1).max(1_000_000), service_ids: z.array(z.string().max(40)).max(20).nullable().optional(),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    budget_cap: z.number().int().min(0).max(1_000_000_000).nullable().optional(), active: z.boolean().default(false),
  }).refine((b) => b.kind !== 'streak' || b.window === 'weekly', { message: 'A streak quest needs a weekly window' })
    .refine((b) => !b.starts_on || !b.ends_on || b.ends_on >= b.starts_on, { message: 'The end date is before the start date' });
  app.get('/admin/quests', { preHandler: requirePerm('growth.manage') }, async () => ({ quests: await adminQuests() }));
  app.post('/admin/quests', { preHandler: requirePerm('growth.manage') }, async (req) => {
    const b = parse(questBody, req.body);
    const r = await q1<any>(`insert into driver_quests(title_en,title_rw,title_fr,desc_en,desc_rw,desc_fr,kind,target,quest_window,reward,service_ids,starts_on,ends_on,budget_cap,active,created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning ${QCOLS}`,
      [b.title_en, b.title_rw, b.title_fr, b.desc_en, b.desc_rw, b.desc_fr, b.kind, b.target, b.window, b.reward, b.service_ids ?? null, b.starts_on ?? null, b.ends_on ?? null, b.budget_cap ?? null, b.active, req.auth!.id]);
    await audit(actorOf(req), 'quest.created', 'driver_quest', r.id, undefined, { kind: b.kind, target: b.target, reward: b.reward, budget_cap: b.budget_cap, active: b.active });
    return r;
  });
  app.patch('/admin/quests/:id', { preHandler: requirePerm('growth.manage') }, async (req) => {
    const { id } = parse(idp, req.params);
    const cur = await q1<any>(`select ${QCOLS} from driver_quests where id=$1`, [id]); if (!cur) throw notFound('quest');
    const n = parse(questBody, { ...cur, ...(req.body as object), service_ids: (req.body as any)?.service_ids ?? cur.service_ids });
    if ((req.body as any)?.budget_cap != null && n.budget_cap != null && n.budget_cap < cur.spent) throw badRequest('budget_below_spent', 'The budget cannot be lower than what is already spent', { spent: cur.spent });
    const r = await q1<any>(`update driver_quests set title_en=$2,title_rw=$3,title_fr=$4,desc_en=$5,desc_rw=$6,desc_fr=$7,kind=$8,target=$9,quest_window=$10,reward=$11,service_ids=$12,starts_on=$13,ends_on=$14,budget_cap=$15,active=$16,
        placeholder=case when $17::boolean then false else placeholder end, updated_at=now() where id=$1 returning ${QCOLS}`,
      [id, n.title_en, n.title_rw, n.title_fr, n.desc_en, n.desc_rw, n.desc_fr, n.kind, n.target, n.window, n.reward, n.service_ids ?? null, n.starts_on ?? null, n.ends_on ?? null, n.budget_cap ?? null, n.active, (req.body as any)?.placeholder === false]);
    await audit(actorOf(req), 'quest.updated', 'driver_quest', id, { reward: cur.reward, target: cur.target, active: cur.active, budget_cap: cur.budget_cap }, { reward: n.reward, target: n.target, active: n.active, budget_cap: n.budget_cap });
    return r;
  });
  app.get('/admin/quests/:id/awards', { preHandler: requirePerm('growth.manage') }, async (req) => ({
    awards: await q('select a.id, a.driver_id, u.display_name driver, a.period_key, a.amount, a.progress, a.created_at from driver_quest_awards a join users u on u.id=a.driver_id where a.quest_id=$1 order by a.created_at desc limit 200', [parse(idp, req.params).id]),
  }));

  // ================= campaigns =================
  const gm = { preHandler: requirePerm('growth.manage') };
  app.get('/admin/campaigns', gm, async () => ({ campaigns: await C.listCampaigns() }));
  app.post('/admin/campaigns', gm, async (req) => C.createCampaign(actorOf(req), parse(C.campaignSchema, req.body)));
  app.post('/admin/campaigns/preview', gm, async (req) => {
    const b = parse(z.object({ channel: z.enum(['sms', 'push', 'inapp']), segment: C.segmentSchema }), req.body);
    return C.previewAudience(b.channel, b.segment);
  });
  app.get('/admin/campaigns/:id', gm, async (req) => C.campaignDetail(parse(idp, req.params).id));
  app.patch('/admin/campaigns/:id', gm, async (req) => C.updateCampaign(actorOf(req), parse(idp, req.params).id, parse(C.campaignSchema, req.body)));
  app.post('/admin/campaigns/:id/schedule', gm, async (req) => {
    const b = parse(z.object({ scheduled_at: z.string().datetime().optional() }), req.body);
    return C.scheduleCampaign(actorOf(req), parse(idp, req.params).id, b.scheduled_at ? new Date(b.scheduled_at) : new Date());
  });
  app.post('/admin/campaigns/:id/cancel', gm, async (req) => C.cancelCampaign(actorOf(req), parse(idp, req.params).id));
  app.post('/admin/campaigns/:id/test-send', { ...gm, config: routeLimit('CAMPAIGN_TEST_RATE_MAX', 10) }, async (req) => {
    const b = parse(z.object({ lang: z.enum(['rw', 'fr', 'en']) }), req.body);
    return C.testSend(actorOf(req), parse(idp, req.params).id, b.lang);
  });

  // ================= demand map, recurring rides overview =================
  app.get('/admin/heatmap', { preHandler: requirePerm('analytics.view') }, async () => heatmapView('admin'));
  app.get('/admin/ride-schedules', gm, async () => ({
    schedules: await q(`select s.id, s.service_id, s.status, s.days_of_week, s.local_time, to_char(s.start_date,'YYYY-MM-DD') start_date, to_char(s.end_date,'YYYY-MM-DD') end_date, s.expected_total,
      (select count(*)::int from ride_schedule_runs r where r.schedule_id=s.id and r.status='booked') booked,
      (select count(*)::int from ride_schedule_runs r where r.schedule_id=s.id and r.status in ('price_changed','no_coverage','failed')) held_back from ride_schedules s order by s.created_at desc limit 300`),
  }));
}

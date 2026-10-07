import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requirePerm, requireRole, actorOf, authenticate } from '../guards.js';
import { q, q1, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { audit } from '../services/audit.js';
import * as Dr from '../services/drivers.js';
import * as D from '../services/dispatch.js';
import * as B from '../services/bookings.js';
import { transition } from '../services/bookingMachine.js';
import { dashboard, analytics } from '../services/reports.js';
import { allSettings, setSetting, resetSetting, getSetting } from '../services/settings.js';
import { SETTING_DEFAULTS } from '../config.js';
import { SETTING_META, SETTING_GROUPS, metaFor, validateSetting } from '../services/settingsMeta.js';
import { computeFare, activeRule, type Rule } from '../services/pricing.js';
import { signFileToken } from '../util/crypto.js';
import { notify } from '../services/notify.js';
import { exportUserData, executeDeletion } from '../services/privacy.js';
import { createStaff } from '../seed.js';
import { totpUri } from '../util/crypto.js';
import { ROLE_PERMISSIONS, STAFF_ROLES, can, isStaff } from '../rbac.js';
import { config } from '../config.js';
import { refOf } from '../util/ids.js';

const timeWindow = z.object({ label: z.string().trim().min(1).max(40), days: z.array(z.number().int().min(0).max(6)).max(7).default([]), start_hour: z.number().int().min(0).max(23), end_hour: z.number().int().min(1).max(24), percent: z.number().int().min(-50).max(100) })
  .refine((w) => w.start_hour !== w.end_hour, { message: 'Start and end hour must differ' });
/** Fare-rule fields shared by "propose" and "preview" so the live calculator can never validate differently from the real proposal. */
const ruleSchema = z.object({
      service_id: z.string(), zone_id: z.string().nullable().default('kigali'), model: z.enum(['fixed', 'platform']).default('platform'),
      base_fare: z.number().int().min(0).max(10_000_000), per_km: z.number().int().min(0).max(10_000_000), per_min: z.number().int().min(0).max(10_000_000), minimum_fare: z.number().int().min(0).max(10_000_000),
      booking_fee: z.number().int().min(0).max(10_000_000).default(0), wait_per_min: z.number().int().min(0).max(10_000_000).default(0), free_wait_min: z.number().int().min(0).max(10_000_000).default(3),
      airport_fee: z.number().int().min(0).max(10_000_000).default(0), scheduled_fee: z.number().int().min(0).max(10_000_000).default(0), tax_bps: z.number().int().min(0).max(10_000_000).max(5000).default(0), rounding: z.number().int().min(1).max(1000).default(50),
      effective_from: z.string().datetime().optional(),
      // Abasare
      billing: z.enum(['distance', 'hourly']).default('distance'), return_per_km: z.number().int().min(0).max(10_000_000).default(0),
      night_start_hour: z.number().int().min(0).max(10_000_000).max(23).nullable().default(null), night_end_hour: z.number().int().min(0).max(10_000_000).max(24).nullable().default(null), night_fee: z.number().int().min(0).max(10_000_000).default(0),
      hourly_rate: z.number().int().min(0).max(10_000_000).default(0), min_hours: z.number().int().min(1).default(2), max_hours: z.number().int().min(1).default(12),
      long_hire_hours: z.number().int().min(1).nullable().default(null), long_hire_rate: z.number().int().min(0).max(10_000_000).nullable().default(null),
      overtime_per_30min: z.number().int().min(0).max(10_000_000).default(0), overtime_grace_min: z.number().int().min(0).max(10_000_000).default(10),
  time_multipliers: z.array(timeWindow).max(6).default([]),
}).superRefine((r, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if ((r.night_start_hour == null) !== (r.night_end_hour == null)) bad('night_end_hour', 'Set both the night start and end hour, or neither');
  if (r.min_hours > r.max_hours) bad('min_hours', 'Minimum hours cannot exceed maximum hours');
  if ((r.long_hire_hours == null) !== (r.long_hire_rate == null)) bad('long_hire_rate', 'Set both the long-hire hours and rate, or neither');
});
const tripSchema = z.object({
  distance_km: z.number().min(0).max(500).default(0), duration_min: z.number().min(0).max(1440).default(0),
  local_hour: z.number().int().min(0).max(23).optional(), local_dow: z.number().int().min(0).max(6).optional(),
  hours: z.number().int().min(1).max(24).optional(), airport: z.boolean().default(false), scheduled: z.boolean().default(false),
});
type RuleInput = z.infer<typeof ruleSchema>;
const previewRule = (b: RuleInput): Rule => ({ id: 'preview', version: 0, long_distance_km: null, long_distance_per_km: null, surge_enabled: false, surge_cap_bps: 15000, ...b } as Rule);

/** Maker-checker gate. The proposer may only approve their own change when the super-admin-controlled setting allows it; returns whether that happened. */
async function checkerGate(proposer: string | null, actor: string, what: string): Promise<boolean> {
  if (proposer !== actor) return false;
  if (!(await getSetting('pricing.self_approval'))) throw forbidden(`Maker-checker: you cannot approve your own ${what}`);
  return true;
}

const idp = z.object({ id: z.string().uuid() });

export async function adminRoutes(app: FastifyInstance) {
  // ---------- overview ----------
  app.get('/admin/dashboard', { preHandler: requirePerm('analytics.view') }, async (req) =>
    dashboard(parse(z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), service_id: z.string().optional(), zone_id: z.string().optional() }), req.query)));
  app.get('/admin/analytics', { preHandler: requirePerm('analytics.view') }, async () => analytics());

  app.get('/admin/live', { preHandler: requirePerm('bookings.view_all') }, async () => ({
    bookings: await q(`select b.id, b.ref, b.status, b.pickup_lat, b.pickup_lng, b.dest_lat, b.dest_lng, b.service_id, b.driver_id from bookings b where b.status in ('SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS')`),
    drivers: await q(`select user_id, last_lat lat, last_lng lng, last_seen_at from driver_profiles where is_online and last_seen_at > now() - interval '60 seconds' and last_lat is not null`),
  }));

  // ---------- drivers ----------
  app.get('/admin/drivers', { preHandler: requirePerm('drivers.view') }, async (req) => {
    const b = parse(z.object({ status: z.string().optional(), q: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    return { drivers: await q(`select dp.user_id, u.display_name, u.phone, dp.status, dp.is_online, dp.rating_avg, dp.completed_count, dp.cancel_count, dp.submitted_at, v.plate, v.vehicle_type
      from driver_profiles dp join users u on u.id=dp.user_id left join vehicles v on v.driver_id=dp.user_id and v.status<>'rejected'
      where ($1::text is null or dp.status=$1) and ($2::text is null or u.display_name ilike $3 or u.phone like $3 or v.plate ilike $3) order by dp.submitted_at desc nulls last limit $4`, [b.status ?? null, b.q ?? null, `%${b.q ?? ''}%`, b.limit]) };
  });
  app.get('/admin/drivers/:id', { preHandler: requirePerm('drivers.view') }, async (req) => {
    const { id } = parse(idp, req.params);
    const dp = await q1<any>('select dp.user_id, dp.status, dp.status_reason, dp.abasare_status, dp.abasare_skills, dp.accepting, dp.legal_name, dp.zone_id, dp.fleet_id, dp.is_online, dp.rating_avg, dp.rating_count, dp.accepted_count, dp.rejected_count, dp.cancel_count, dp.completed_count, dp.payout_msisdn, u.phone, u.display_name from driver_profiles dp join users u on u.id=dp.user_id where dp.user_id=$1', [id]);
    if (!dp) throw notFound('driver');
    const docs = await q<any>('select * from driver_documents where driver_id=$1 order by created_at desc', [id]);
    await audit(actorOf(req), 'driver.viewed', 'driver', id);
    return {
      profile: dp, permission: await Dr.driverPermission(id),
      vehicles: await q('select * from vehicles where driver_id=$1', [id]),
      documents: docs.map((d) => ({ id: d.id, doc_type: d.doc_type, review_status: d.review_status, review_note: d.review_note, expiry_date: d.expiry_date, superseded: d.superseded, created_at: d.created_at,
        url: `/api/v1/files/${d.file_key}?token=${signFileToken(d.file_key, 300)}` })),   // 5-minute signed link
      history: await q('select from_status, to_status, reason, created_at from driver_status_history where driver_id=$1 order by id desc', [id]),
    };
  });
  app.post('/admin/drivers/:id/start-review', { preHandler: requirePerm('drivers.review') }, async (req) => {
    const { id } = parse(idp, req.params);
    await tx((c) => Dr.setDriverStatus(c, id, 'UNDER_REVIEW', actorOf(req)));
    return { ok: true };
  });
  app.post('/admin/documents/:id/review', { preHandler: requirePerm('drivers.review') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ decision: z.enum(['approved', 'rejected', 'resubmit']), note: z.string().max(500).optional() }), req.body);
    if (b.decision !== 'approved' && !b.note) throw badRequest('note_required', 'Explain what is wrong so the driver can fix it');
    return tx(async (c) => {
      const d = await q1<any>('select * from driver_documents where id=$1 for update', [id], c);
      if (!d) throw notFound('document');
      await q('update driver_documents set review_status=$2, review_note=$3, reviewer_id=$4, reviewed_at=now() where id=$1', [id, b.decision, b.note ?? null, req.auth!.id], c);
      if (b.decision === 'approved') await q('update driver_documents set superseded=true where driver_id=$1 and doc_type=$2 and id<>$3 and not superseded', [d.driver_id, d.doc_type, id], c);
      await audit(actorOf(req), 'document.review', 'driver_document', id, { status: d.review_status }, b, c);
      return { ok: true };
    }).then(async (r) => { await Dr.refreshEligibility((await q1<any>('select driver_id from driver_documents where id=$1', [id]))!.driver_id); return r; });
  });
  app.post('/admin/drivers/:id/decision', { preHandler: requirePerm('drivers.review') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ decision: z.enum(['approve', 'reject', 'info_required', 'suspend', 'reinstate', 'deactivate']), reason: z.string().max(500).optional() }), req.body);
    if (['reject', 'info_required', 'suspend', 'deactivate'].includes(b.decision) && !b.reason) throw badRequest('reason_required', 'A reason is required');
    const to = { approve: 'APPROVED', reject: 'REJECTED', info_required: 'INFO_REQUIRED', suspend: 'SUSPENDED', reinstate: 'APPROVED', deactivate: 'DEACTIVATED' }[b.decision];
    await tx(async (c) => {
      if (b.decision === 'approve' || b.decision === 'reinstate') {
        const veh = await q1<any>("select id, vehicle_type from vehicles where driver_id=$1 and status in ('pending','approved') order by created_at desc limit 1", [id], c);
        const abs = await q1<any>("select 1 from driver_profiles where user_id=$1 and abasare_status in ('pending','approved')", [id], c);
        if (!veh && !abs) throw conflict('no_vehicle', 'No vehicle (or Abasare application) to approve');
        if (veh && b.decision === 'approve') await q("update vehicles set status='approved' where id=$1", [veh.id], c);
        const need = await q<any>(`select distinct r.doc_type from document_requirements r where r.vehicle_type = any($2) and r.mandatory and not exists (
            select 1 from driver_documents d where d.driver_id=$1 and d.doc_type=r.doc_type and not d.superseded and d.review_status='approved' and (d.expiry_date is null or d.expiry_date >= current_date))`, [id, [...(veh ? [veh.vehicle_type] : []), ...(abs ? ['abasare'] : [])]], c);
        if (need.length) throw conflict('documents_not_approved', `Approve all mandatory documents first (${need.map((n: any) => n.doc_type).join(', ')})`);
      }
      await Dr.setDriverStatus(c, id, to, actorOf(req), b.reason);
      if (b.decision === 'suspend' || b.decision === 'deactivate') await q("update dispatch_offers set status='cancelled' where driver_id=$1 and status='pending'", [id], c);
    });
    await notify(id, 'driver_decision', { status: to, reason: b.reason ?? '' });
    return { ok: true, status: to };
  });

  // ---------- passengers / users ----------
  app.get('/admin/users', { preHandler: requirePerm('users.view') }, async (req) => {
    const b = parse(z.object({ q: z.string().min(2).max(60) }), req.query);
    return { users: await q(`select u.id, u.display_name, u.phone, u.email, u.status, u.created_at, array(select role from user_roles r where r.user_id=u.id) roles from users u where u.display_name ilike $1 or u.phone like $1 or u.email ilike $1 limit 50`, [`%${b.q}%`]) };
  });
  app.get('/admin/users/:id', { preHandler: requirePerm('users.view') }, async (req) => {
    const { id } = parse(idp, req.params);
    const u = await q1<any>('select id, display_name, phone, email, status, created_at, risk_score from users where id=$1', [id]);
    if (!u) throw notFound('user');
    await audit(actorOf(req), 'user.viewed', 'user', id);
    return { user: u, bookings: await q('select id, ref, status, final_fare, estimated_fare, created_at from bookings where passenger_id=$1 order by created_at desc limit 50', [id]) };
  });
  app.post('/admin/users/:id/status', { preHandler: requirePerm('users.restrict') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ status: z.enum(['active', 'restricted', 'deactivated']), reason: z.string().min(5).max(300) }), req.body);
    const before = await q1<any>('select status from users where id=$1', [id]); if (!before) throw notFound('user');
    await q('update users set status=$2 where id=$1', [id, b.status]);
    if (b.status !== 'active') await q('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [id]);
    await audit(actorOf(req), 'user.status', 'user', id, before, b);
    return { ok: true };
  });
  app.post('/admin/safety-blocks', { preHandler: requirePerm('safety.respond') }, async (req) => {
    const b = parse(z.object({ passenger_id: z.string().uuid(), driver_id: z.string().uuid(), reason: z.string().min(5) }), req.body);
    await q('insert into safety_blocks(passenger_id, driver_id, reason, created_by) values ($1,$2,$3,$4) on conflict do nothing', [b.passenger_id, b.driver_id, b.reason, req.auth!.id]);
    await audit(actorOf(req), 'safety.block', 'user', b.passenger_id, undefined, b);
    return { ok: true };
  });

  // ---------- bookings ----------
  app.get('/admin/bookings', { preHandler: requirePerm('bookings.view_all') }, async (req) => {
    const b = parse(z.object({ status: z.string().optional(), q: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    return { bookings: await q(`select b.id, b.ref, b.status, b.service_id, b.estimated_fare, b.final_fare, b.payment_method, b.created_at, pu.display_name passenger, pu.phone passenger_phone, du.display_name driver, rc.code request_code, rc.label request_code_label
      from bookings b join users pu on pu.id=b.passenger_id left join users du on du.id=b.driver_id left join request_codes rc on rc.id=b.request_code_id
      where ($1::text is null or b.status=$1) and ($2::text is null or b.ref ilike $3 or pu.phone like $3 or pu.display_name ilike $3 or b.id::text = $2 or exists (select 1 from payments p where p.booking_id=b.id and p.reference=$2))
      order by b.created_at desc limit $4`, [b.status ?? null, b.q ?? null, `%${b.q ?? ''}%`, b.limit]) };
  });
  app.post('/admin/bookings/:id/assign', { preHandler: requirePerm('bookings.dispatch') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ driver_id: z.string().uuid(), reason: z.string().min(5) }), req.body);
    const row = await D.manualAssign(req.auth!.id, id, b.driver_id, b.reason);
    await audit(actorOf(req), 'booking.manual_assign', 'booking', id, undefined, b);
    return B.bookingView(row, 'staff');
  });
  app.post('/admin/bookings/:id/restart-search', { preHandler: requirePerm('bookings.dispatch') }, async (req) => {
    const { id } = parse(idp, req.params);
    await D.startSearch(id); await audit(actorOf(req), 'booking.restart_search', 'booking', id);
    return { ok: true };
  });
  app.post('/admin/bookings/:id/pin-override', { preHandler: requirePerm('bookings.dispatch') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ reason: z.string().min(10).max(300) }), req.body);
    const row = await B.overridePin(req.auth!.id, id, b.reason);
    await audit(actorOf(req), 'booking.pin_override', 'booking', id, undefined, b);
    return B.bookingView(row, 'staff');
  });
  app.post('/admin/bookings/:id/cancel', { preHandler: requirePerm('bookings.dispatch') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ reason: z.string().min(5).max(200) }), req.body);
    const row = await tx((c) => transition(c, id, 'CANCELLED_BY_SYSTEM', { id: req.auth!.id, role: 'staff' }, { reason: b.reason, patch: { cancelled_at: new Date(), cancel_by: 'system', cancel_reason: b.reason, cancel_fee: 0 } }));
    await audit(actorOf(req), 'booking.cancel', 'booking', id, undefined, b);
    await notify(row.passenger_id, 'booking_cancelled', { ref: row.ref, reason: '' });
    return B.bookingView(row, 'staff');
  });
  /** Authorised extra (e.g. toll receipt). Disclosed on the receipt; applies when the trip completes. */
  app.post('/admin/bookings/:id/extra-charge', { preHandler: requirePerm('bookings.dispatch') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ code: z.string().max(30), label: z.string().max(80), amount: z.number().int().positive().max(100000), passthrough: z.boolean().default(true), reason: z.string().min(5) }), req.body);
    const r = await q1<any>("update bookings set extra_charges = extra_charges || $2::jsonb, updated_at=now() where id=$1 and status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS') returning id", [id, JSON.stringify([{ code: b.code, label: b.label, amount: b.amount, passthrough: b.passthrough }])]);
    if (!r) throw conflict('invalid_state', 'Extras can only be added before the trip completes');
    await audit(actorOf(req), 'booking.extra_charge', 'booking', id, undefined, b);
    return { ok: true };
  });
  app.post('/admin/bookings/:id/dispute', { preHandler: requirePerm('support.handle') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ reason: z.string().min(5) }), req.body);
    const row = await tx((c) => transition(c, id, 'DISPUTED', { id: req.auth!.id, role: 'staff' }, { reason: b.reason }));
    await audit(actorOf(req), 'booking.disputed', 'booking', id, undefined, b);
    return B.bookingView(row, 'staff');
  });

  // ---------- pricing & commission (maker-checker) ----------
  // Approvers (pricing.approve) must be able to see what they are approving, so reading is open to either permission.
  const viewPricing = async (req: any, reply: any) => {
    await authenticate(req, reply);
    if (!isStaff(req.auth!.roles) || !(can(req.auth!.roles, 'pricing.manage') || can(req.auth!.roles, 'pricing.approve'))) throw forbidden('missing permission pricing.manage or pricing.approve');
  };
  app.get('/admin/pricing', { preHandler: viewPricing }, async () => ({
    services: await q('select id, name_en, kind, enabled from service_categories order by sort'),
    zones: await q('select id, name, active from service_zones order by name'),
    rules: await q('select r.*, u.display_name created_by_name from pricing_rules r left join users u on u.id=r.created_by order by r.service_id, r.version desc'),
    commissions: await q('select c.*, u.display_name created_by_name from commission_rules c left join users u on u.id=c.created_by order by c.created_at desc'),
    self_approval: await getSetting('pricing.self_approval'),
  }));
  app.post('/admin/pricing', { preHandler: requirePerm('pricing.manage') }, async (req) => {
    const b = parse(ruleSchema, req.body);
    const prev = await q1<any>('select coalesce(max(version),0) v from pricing_rules where service_id=$1', [b.service_id]);
    const r = await q1<any>(`insert into pricing_rules(service_id,zone_id,model,base_fare,per_km,per_min,minimum_fare,booking_fee,wait_per_min,free_wait_min,airport_fee,scheduled_fee,tax_bps,rounding,version,effective_from,status,created_by,
        billing,return_per_km,night_start_hour,night_end_hour,night_fee,hourly_rate,min_hours,max_hours,long_hire_hours,long_hire_rate,overtime_per_30min,overtime_grace_min,time_multipliers)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,coalesce($16, now()),'pending_approval',$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) returning *`,
      [b.service_id, b.zone_id, b.model, b.base_fare, b.per_km, b.per_min, b.minimum_fare, b.booking_fee, b.wait_per_min, b.free_wait_min, b.airport_fee, b.scheduled_fee, b.tax_bps, b.rounding, prev.v + 1, b.effective_from ?? null, req.auth!.id,
       b.billing, b.return_per_km, b.night_start_hour, b.night_end_hour, b.night_fee, b.hourly_rate, b.min_hours, b.max_hours, b.long_hire_hours, b.long_hire_rate, b.overtime_per_30min, b.overtime_grace_min, JSON.stringify(b.time_multipliers)]);
    await audit(actorOf(req), 'pricing.proposed', 'pricing_rule', r.id, undefined, r);
    return r;
  });
  // Live calculator: same schema and the same computeFare as real quotes; nothing is stored.
  app.post('/admin/pricing/preview', { preHandler: requirePerm('pricing.manage') }, async (req) => {
    const b = parse(z.object({ rule: ruleSchema, trip: tripSchema.default({}) }), req.body);
    const input = { distance_m: Math.round(b.trip.distance_km * 1000), duration_s: Math.round(b.trip.duration_min * 60), airport: b.trip.airport, scheduled: b.trip.scheduled, hours: b.trip.hours, local_hour: b.trip.local_hour, local_dow: b.trip.local_dow };
    const proposed = computeFare(previewRule(b.rule), input);
    let current = null, current_rule_id = null, current_error: string | undefined;
    try {
      const cur = await activeRule(b.rule.service_id, b.rule.zone_id ?? 'kigali');
      current_rule_id = cur.id;
      current = computeFare(cur, input);
    } catch (e: any) { current_error = e.message; }
    return { proposed, current, current_rule_id, current_error };
  });
  app.post('/admin/pricing/:id/approve', { preHandler: requirePerm('pricing.approve') }, async (req) => {
    const { id } = parse(idp, req.params);
    return tx(async (c) => {
      const r = await q1<any>('select * from pricing_rules where id=$1 for update', [id], c);
      if (!r || r.status !== 'pending_approval') throw conflict('invalid_state', 'Not awaiting approval');
      const selfApproved = await checkerGate(r.created_by, req.auth!.id, 'price change');
      await q("update pricing_rules set status='retired', effective_to=$3 where service_id=$1 and status='active' and (zone_id is not distinct from $2) and id<>$4", [r.service_id, r.zone_id, r.effective_from, id], c);
      await q("update pricing_rules set status='active', approved_by=$2 where id=$1", [id, req.auth!.id], c);
      await audit(actorOf(req), 'pricing.approved', 'pricing_rule', id, r, { status: 'active', self_approved: selfApproved }, c);
      return { ok: true };
    });
  });
  app.post('/admin/pricing/:id/reject', { preHandler: requirePerm('pricing.approve') }, async (req) => {
    const { id } = parse(idp, req.params);
    await q("update pricing_rules set status='retired' where id=$1 and status='pending_approval'", [id]);
    await audit(actorOf(req), 'pricing.rejected', 'pricing_rule', id);
    return { ok: true };
  });
  app.post('/admin/commissions', { preHandler: requirePerm('pricing.manage') }, async (req) => {
    const b = parse(z.object({ service_id: z.string().nullable().optional(), fleet_id: z.string().uuid().nullable().optional(), driver_id: z.string().uuid().nullable().optional(),
      kind: z.enum(['percent', 'fixed']), percent_bps: z.number().int().min(0).max(10000).optional(), fixed_amount: z.number().int().min(0).optional(), exempt_until: z.string().datetime().optional(), note: z.string().max(200).optional(), effective_from: z.string().datetime().optional() }), req.body);
    if (b.kind === 'percent' && b.percent_bps == null) throw badRequest('percent_required');
    if (b.kind === 'fixed' && b.fixed_amount == null) throw badRequest('fixed_required');
    const r = await q1<any>(`insert into commission_rules(service_id,fleet_id,driver_id,kind,percent_bps,fixed_amount,exempt_until,note,effective_from,created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,now()),$10) returning *`, [b.service_id ?? null, b.fleet_id ?? null, b.driver_id ?? null, b.kind, b.percent_bps ?? null, b.fixed_amount ?? null, b.exempt_until ?? null, b.note ?? null, b.effective_from ?? null, req.auth!.id]);
    await audit(actorOf(req), 'commission.proposed', 'commission_rule', r.id, undefined, r);
    return r;
  });
  app.post('/admin/commissions/:id/approve', { preHandler: requirePerm('pricing.approve') }, async (req) => {
    const { id } = parse(idp, req.params);
    const r = await q1<any>("select * from commission_rules where id=$1", [id]);
    if (!r || r.status !== 'pending_approval') throw conflict('invalid_state', 'Not awaiting approval');
    const selfApproved = await checkerGate(r.created_by, req.auth!.id, 'commission change');
    await q("update commission_rules set status='retired', effective_to=now() where status='active' and service_id is not distinct from $1 and fleet_id is not distinct from $2 and driver_id is not distinct from $3 and id<>$4", [r.service_id, r.fleet_id, r.driver_id, id]);
    await q("update commission_rules set status='active', approved_by=$2 where id=$1", [id, req.auth!.id]);
    await audit(actorOf(req), 'commission.approved', 'commission_rule', id, r, { status: 'active', self_approved: selfApproved });
    return { ok: true };
  });

  // ---------- catalogue, zones, promotions ----------
  app.get('/admin/services', { preHandler: requirePerm('pricing.manage') }, async () => ({ services: await q('select * from service_categories order by sort'), zone_services: await q('select * from zone_services') }));
  app.patch('/admin/services/:id', { preHandler: requirePerm('pricing.manage') }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const b = parse(z.object({ enabled: z.boolean().optional(), name_en: z.string().trim().min(2).max(60).optional(), name_rw: z.string().trim().min(2).max(60).optional(), name_fr: z.string().trim().min(2).max(60).optional(), passenger_capacity: z.number().int().min(1).max(60).optional(), luggage: z.string().max(60).optional(), restrictions: z.record(z.any()).optional() }), req.body);
    const before = await q1<any>('select * from service_categories where id=$1', [id]); if (!before) throw notFound('service');
    if (b.enabled) { const rule = await q1("select 1 from pricing_rules where service_id=$1 and status='active'", [id]); if (!rule) throw conflict('no_pricing_rule', 'Create and approve a price before enabling this service'); }
    await q('update service_categories set enabled=coalesce($2,enabled), passenger_capacity=coalesce($3,passenger_capacity), luggage=coalesce($4,luggage), restrictions=coalesce($5,restrictions), name_en=coalesce($6,name_en), name_rw=coalesce($7,name_rw), name_fr=coalesce($8,name_fr) where id=$1', [id, b.enabled ?? null, b.passenger_capacity ?? null, b.luggage ?? null, b.restrictions ? JSON.stringify(b.restrictions) : null, b.name_en ?? null, b.name_rw ?? null, b.name_fr ?? null]);
    await audit(actorOf(req), 'service.updated', 'service', id, before, b);
    return { ok: true };
  });
  // Enable or disable one service in one zone (the service must also be enabled globally to be bookable).
  app.put('/admin/services/:id/zones/:zone', { preHandler: requirePerm('pricing.manage') }, async (req) => {
    const { id, zone } = parse(z.object({ id: z.string(), zone: z.string() }), req.params);
    const b = parse(z.object({ enabled: z.boolean() }), req.body);
    if (!(await q1('select 1 from service_categories where id=$1', [id])) || !(await q1('select 1 from service_zones where id=$1', [zone]))) throw notFound('service or zone');
    if (b.enabled && !(await q1("select 1 from pricing_rules where service_id=$1 and status='active' and (zone_id=$2 or zone_id is null)", [id, zone]))) throw conflict('no_pricing_rule', 'Create and approve a price for this zone before enabling the service there');
    const before = await q1<any>('select enabled from zone_services where service_id=$1 and zone_id=$2', [id, zone]);
    await q('insert into zone_services(zone_id,service_id,enabled) values ($1,$2,$3) on conflict (zone_id,service_id) do update set enabled=excluded.enabled', [zone, id, b.enabled]);
    await audit(actorOf(req), 'service.zone_changed', 'service', id, { zone, enabled: before?.enabled ?? false }, { zone, enabled: b.enabled });
    return { ok: true };
  });
  app.get('/admin/zones', { preHandler: requirePerm('pricing.manage') }, async () => ({ zones: await q('select * from service_zones') }));
  app.put('/admin/zones/:id', { preHandler: requirePerm('pricing.manage') }, async (req) => {
    const { id } = parse(z.object({ id: z.string().regex(/^[a-z0-9_-]{2,30}$/) }), req.params);
    const b = parse(z.object({ name: z.string().min(2).max(60), polygon: z.array(z.tuple([z.number(), z.number()])).min(4), active: z.boolean().default(true) }), req.body);
    const ring = b.polygon; if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) throw badRequest('polygon_not_closed');
    await q('insert into service_zones(id,name,polygon,active) values ($1,$2,$3,$4) on conflict (id) do update set name=excluded.name, polygon=excluded.polygon, active=excluded.active', [id, b.name, JSON.stringify(ring), b.active]);
    await audit(actorOf(req), 'zone.upserted', 'zone', id, undefined, { name: b.name, points: ring.length });
    return { ok: true };
  });
  app.get('/admin/promotions', { preHandler: requirePerm('promotions.manage') }, async () => ({ promotions: await q('select * from promotions order by created_at desc limit 100') }));
  app.post('/admin/promotions', { preHandler: requirePerm('promotions.manage') }, async (req) => {
    const b = parse(z.object({ code: z.string().min(3).max(20).regex(/^[A-Za-z0-9_-]+$/), kind: z.enum(['percent', 'fixed']), value: z.number().int().positive(), max_discount: z.number().int().positive().optional(), min_fare: z.number().int().min(0).default(0),
      valid_from: z.string().datetime().optional(), valid_to: z.string().datetime().optional(), usage_limit: z.number().int().positive().optional(), per_user_limit: z.number().int().positive().default(1), budget: z.number().int().positive().optional(), service_ids: z.array(z.string()).optional(), zone_ids: z.array(z.string()).optional(), first_ride_only: z.boolean().default(false),
      segment: z.enum(['all', 'first_ride', 'corporate', 'referred', 'phones']).default('all'), segment_phones: z.array(z.string().regex(/^\+250[0-9]{9}$/)).max(500).optional() }), req.body);
    if (b.kind === 'percent' && b.value > 100) throw badRequest('invalid_percent');
    if (b.segment === 'phones' && !b.segment_phones?.length) throw badRequest('segment_phones_required', 'Add at least one phone number for this audience');
    if (b.valid_from && b.valid_to && b.valid_to <= b.valid_from) throw badRequest('invalid_dates', 'The end date must be after the start date');
    try {
      const r = await q1<any>(`insert into promotions(code,kind,value,max_discount,min_fare,valid_from,valid_to,usage_limit,per_user_limit,budget,service_ids,zone_ids,first_ride_only,segment,segment_phones) values ($1,$2,$3,$4,$5,coalesce($6,now()),$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
        [b.code.toUpperCase(), b.kind, b.value, b.max_discount ?? null, b.min_fare, b.valid_from ?? null, b.valid_to ?? null, b.usage_limit ?? null, b.per_user_limit, b.budget ?? null, b.service_ids ?? null, b.zone_ids ?? null, b.first_ride_only || b.segment === 'first_ride', b.segment, b.segment === 'phones' ? b.segment_phones : null]);
      await audit(actorOf(req), 'promotion.created', 'promotion', r.id, undefined, r); return r;
    } catch (e: any) { if (e.code === '23505') throw conflict('code_exists', 'Code already exists'); throw e; }
  });
  app.patch('/admin/promotions/:id', { preHandler: requirePerm('promotions.manage') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ active: z.boolean().optional(), budget: z.number().int().positive().nullable().optional(), valid_from: z.string().datetime().optional(), valid_to: z.string().datetime().nullable().optional(), usage_limit: z.number().int().positive().nullable().optional() }), req.body);
    if (!Object.keys(b).length) throw badRequest('validation_error', 'Nothing to change');
    const before = await q1<any>('select * from promotions where id=$1', [id]); if (!before) throw notFound('promotion');
    if (b.budget != null && b.budget < before.spent) throw badRequest('invalid_budget', `The budget cannot be below what has already been spent (${before.spent} RWF)`);
    const m = { ...before, ...b };
    if (m.valid_to && new Date(m.valid_to) <= new Date(m.valid_from)) throw badRequest('invalid_dates', 'The end date must be after the start date');
    await q('update promotions set active=$2, budget=$3, valid_from=$4, valid_to=$5, usage_limit=$6 where id=$1', [id, m.active, m.budget, m.valid_from, m.valid_to, m.usage_limit]);
    await audit(actorOf(req), 'promotion.updated', 'promotion', id, { active: before.active, budget: before.budget, valid_from: before.valid_from, valid_to: before.valid_to, usage_limit: before.usage_limit }, b); return { ok: true };
  });

  // ---------- support & safety consoles ----------
  app.get('/admin/support/cases', { preHandler: requirePerm('support.handle') }, async (req) => {
    const b = parse(z.object({ status: z.string().optional(), q: z.string().max(60).optional() }), req.query);
    const sens = (await import('../rbac.js')).can(req.auth!.roles, 'support.sensitive');
    return { cases: await q(`select c.id, c.ref, c.category, c.priority, c.status, c.subject, c.assigned_to, c.sla_due_at, c.sla_due_at < now() and c.status in ('open','in_progress','awaiting_user') as overdue, c.created_at, c.sensitive, u.display_name reporter
      from support_cases c join users u on u.id=c.reporter_id left join bookings bk on bk.id=c.booking_id
      where ($1::text is null or c.status=$1) and ($2 or not c.sensitive) and ($3::text is null or c.ref ilike $4 or bk.ref ilike $4 or u.phone like $4 or u.display_name ilike $4 or exists (select 1 from payments p where p.booking_id=c.booking_id and p.reference=$3))
      order by (c.priority='urgent') desc, c.sla_due_at limit 100`, [b.status ?? null, sens, b.q ?? null, `%${b.q ?? ''}%`]) };
  });
  app.get('/admin/support/cases/:id', { preHandler: requirePerm('support.handle') }, async (req) => {
    const { id } = parse(idp, req.params);
    const c = await q1<any>('select * from support_cases where id=$1', [id]); if (!c) throw notFound('case');
    if (c.sensitive && !(await import('../rbac.js')).can(req.auth!.roles, 'support.sensitive')) throw notFound('case');
    await audit(actorOf(req), 'support.case_viewed', 'support_case', id);
    return { case: c, events: await q('select * from case_events where case_id=$1 order by id', [id]) };
  });
  app.post('/admin/support/cases/:id/update', { preHandler: requirePerm('support.handle') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ status: z.enum(['open', 'in_progress', 'awaiting_user', 'resolved', 'closed']).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), assign_to_me: z.boolean().optional(), reply: z.string().max(2000).optional(), internal_note: z.string().max(2000).optional(), resolution: z.string().max(1000).optional() }), req.body);
    const c = await q1<any>('select * from support_cases where id=$1', [id]); if (!c) throw notFound('case');
    if (c.sensitive && !(await import('../rbac.js')).can(req.auth!.roles, 'support.sensitive')) throw notFound('case');
    if (['resolved', 'closed'].includes(b.status ?? '') && !(b.resolution ?? c.resolution)) throw badRequest('resolution_required');
    await tx(async (cx) => {
      await q('update support_cases set status=coalesce($2,status), priority=coalesce($3,priority), assigned_to=case when $4 then $5 else assigned_to end, resolution=coalesce($6,resolution), updated_at=now() where id=$1', [id, b.status ?? null, b.priority ?? null, !!b.assign_to_me, req.auth!.id, b.resolution ?? null], cx);
      if (b.reply) await q("insert into case_events(case_id,author_id,kind,body,visibility) values ($1,$2,'message',$3,'public')", [id, req.auth!.id, b.reply], cx);
      if (b.internal_note) await q("insert into case_events(case_id,author_id,kind,body,visibility) values ($1,$2,'internal_note',$3,'internal')", [id, req.auth!.id, b.internal_note], cx);
      if (b.status) await q("insert into case_events(case_id,author_id,kind,body) values ($1,$2,'status',$3)", [id, req.auth!.id, b.status], cx);
      await audit(actorOf(req), 'support.case_updated', 'support_case', id, { status: c.status }, b, cx);
    });
    if (b.reply || b.status) await notify(c.reporter_id, 'case_update', { ref: c.ref, status: b.status ?? c.status });
    return { ok: true };
  });
  app.get('/admin/safety/incidents', { preHandler: requirePerm('safety.respond') }, async () => ({
    incidents: await q(`select i.*, u.display_name reporter from safety_incidents i join users u on u.id=i.reporter_id order by (i.status='open') desc, i.created_at desc limit 100`),
  }));
  app.post('/admin/safety/incidents/:id/update', { preHandler: requirePerm('safety.respond') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ status: z.enum(['acknowledged', 'resolved']), resolution: z.string().max(1000).optional() }), req.body);
    if (b.status === 'resolved' && !b.resolution) throw badRequest('resolution_required');
    await q('update safety_incidents set status=$2, resolution=coalesce($3,resolution), acknowledged_by=coalesce(acknowledged_by,$4), acknowledged_at=coalesce(acknowledged_at, now()) where id=$1', [id, b.status, b.resolution ?? null, req.auth!.id]);
    await audit(actorOf(req), 'safety.incident_updated', 'safety_incident', id, undefined, b);
    return { ok: true };
  });

  // ---------- privacy ----------
  app.get('/admin/privacy-requests', { preHandler: requirePerm('privacy.handle') }, async () => ({ requests: await q("select r.*, u.display_name from privacy_requests r join users u on u.id=r.user_id order by (r.status in ('open','in_progress')) desc, r.due_at limit 100") }));
  app.post('/admin/privacy-requests/:id/execute', { preHandler: requirePerm('privacy.handle') }, async (req) => {
    const { id } = parse(idp, req.params);
    const r = await q1<any>('select * from privacy_requests where id=$1', [id]); if (!r) throw notFound('request');
    if (r.kind === 'deletion') return executeDeletion(actorOf(req), id);
    if (r.kind === 'access') { const data = await exportUserData(r.user_id); await q("update privacy_requests set status='completed', handled_by=$2, resolved_at=now() where id=$1", [id, req.auth!.id]); await audit(actorOf(req), 'privacy.access_export', 'user', r.user_id); return data; }
    await q("update privacy_requests set status='completed', handled_by=$2, resolved_at=now() where id=$1", [id, req.auth!.id]);
    if (r.kind === 'deactivation') await q("update users set status='deactivated' where id=$1", [r.user_id]);
    await audit(actorOf(req), `privacy.${r.kind}`, 'user', r.user_id); return { ok: true };
  });

  // ---------- business / fleet verification ----------
  app.get('/admin/businesses', { preHandler: requirePerm('corporate.manage') }, async () => ({ businesses: await q('select * from corporate_accounts order by created_at desc'), fleets: await q('select * from fleets order by created_at desc') }));
  app.post('/admin/businesses/:id/decision', { preHandler: requirePerm('corporate.manage') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ status: z.enum(['active', 'suspended']), billing_mode: z.enum(['prepaid', 'payg', 'credit']).optional(), credit_limit: z.number().int().min(0).optional() }), req.body);
    if (b.billing_mode === 'credit' && !b.credit_limit) throw badRequest('credit_limit_required', 'Credit terms need a credit limit (manual approval)');
    await q('update corporate_accounts set status=$2, billing_mode=coalesce($3,billing_mode), credit_limit=coalesce($4,credit_limit) where id=$1', [id, b.status, b.billing_mode ?? null, b.credit_limit ?? null]);
    await audit(actorOf(req), 'corporate.decision', 'corporate', id, undefined, b); return { ok: true };
  });
  app.post('/admin/fleets/:id/decision', { preHandler: requirePerm('fleet.manage') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ status: z.enum(['active', 'suspended']), revenue_share_bps: z.number().int().min(0).max(10000).optional() }), req.body);
    await q('update fleets set status=$2, revenue_share_bps=coalesce($3,revenue_share_bps) where id=$1', [id, b.status, b.revenue_share_bps ?? null]);
    await audit(actorOf(req), 'fleet.decision', 'fleet', id, undefined, b); return { ok: true };
  });
  app.post('/admin/businesses/:id/invoice', { preHandler: requirePerm('corporate.manage') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), req.body);
    const [y, m] = b.month.split('-').map(Number);
    const start = `${b.month}-01`, end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const t = await q1<any>(`select count(*)::int n, coalesce(sum(final_fare),0)::bigint s from bookings where corporate_id=$1 and status in ('PAYMENT_COMPLETED','PARTIALLY_REFUNDED') and to_char(completed_at at time zone 'Africa/Kigali','YYYY-MM')=$2`, [id, b.month]);
    if (!t.n) throw conflict('nothing_to_invoice', 'No completed trips in that month');
    try {
      const inv = await q1<any>('insert into corporate_invoices(corporate_id, period_start, period_end, total_amount, trip_count) values ($1,$2,$3,$4,$5) returning *', [id, start, end, t.s, t.n]);
      await audit(actorOf(req), 'invoice.issued', 'corporate_invoice', inv.id, undefined, inv); return inv;
    } catch (e: any) { if (e.code === '23505') throw conflict('already_invoiced', 'Invoice for this period already exists'); throw e; }
  });

  // ---------- settings, flags, templates, audit, staff ----------
  app.get('/admin/settings', { preHandler: requirePerm('settings.manage') }, async () => {
    const [settings, rows, last] = await Promise.all([
      allSettings(),
      q<any>('select s.key, s.updated_at, u.display_name updated_by_name from system_settings s left join users u on u.id=s.updated_by'),
      q<any>(`select distinct on (a.entity_id) a.entity_id key, a.action, a.before, a.after, a.created_at, u.display_name actor_name
              from audit_logs a left join users u on u.id=a.actor_id where a.entity_type='setting' order by a.entity_id, a.id desc`),
    ]);
    const stored = new Map(rows.map((r: any) => [r.key, r])), lastBy = new Map(last.map((r: any) => [r.key, r]));
    const items = Object.entries(settings).map(([key, value]) => {
      const m = metaFor(key), known = key in SETTING_DEFAULTS, l = lastBy.get(key), st = stored.get(key);
      return { key, ...m, group: m.group, value, default: known ? (SETTING_DEFAULTS as any)[key] : null, has_default: known, is_default: known && !st,
        last_change: l ? { by: l.actor_name ?? 'system', at: l.created_at, action: l.action, before: l.before, after: l.after } : st ? { by: st.updated_by_name ?? 'system', at: st.updated_at, action: 'setting.changed' } : null };
    });
    return { settings, groups: SETTING_GROUPS, items, flags: await q('select * from feature_flags order by key'), templates: await q('select * from notification_templates order by key, lang') };
  });
  app.put('/admin/settings/:key', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const { key } = parse(z.object({ key: z.string() }), req.params);
    const b = parse(z.object({ value: z.any() }), req.body);
    if (b.value === undefined) throw badRequest('invalid_setting', 'A value is required');
    if (SETTING_META[key as keyof typeof SETTING_META]?.superAdminOnly && !req.auth!.roles.includes('super_admin')) throw forbidden('Only a super admin can change this setting');
    const err = validateSetting(key, b.value); if (err) throw badRequest('invalid_setting', err, { key });
    const before = (await allSettings())[key];
    try { await setSetting(key, b.value, req.auth!.id); } catch { throw badRequest('unknown_setting'); }
    await audit(actorOf(req), 'setting.changed', 'setting', key, before, b.value); return { ok: true };
  });
  app.delete('/admin/settings/:key', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const { key } = parse(z.object({ key: z.string() }), req.params);
    if (SETTING_META[key as keyof typeof SETTING_META]?.superAdminOnly && !req.auth!.roles.includes('super_admin')) throw forbidden('Only a super admin can change this setting');
    const before = (await allSettings())[key];
    if (!(await q1('select 1 from system_settings where key=$1', [key]))) { if (key in SETTING_DEFAULTS) return { ok: true, value: (SETTING_DEFAULTS as any)[key] }; throw badRequest('unknown_setting'); }
    await resetSetting(key);
    const after = (SETTING_DEFAULTS as any)[key] ?? null;
    await audit(actorOf(req), 'setting.reset', 'setting', key, before, after); return { ok: true, value: after };
  });
  app.put('/admin/flags/:key', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const { key } = parse(z.object({ key: z.string() }), req.params);
    const b = parse(z.object({ enabled: z.boolean() }), req.body);
    const before = await q1<any>('select enabled from feature_flags where key=$1', [key]); if (!before) throw notFound('flag');
    if (b.enabled && ['pricing.surge', 'pricing.negotiated', 'payments.wallet'].includes(key) && !req.auth!.roles.includes('super_admin')) throw forbidden('Only a super admin can enable this regulated feature');
    await q('update feature_flags set enabled=$2, updated_by=$3, updated_at=now() where key=$1', [key, b.enabled, req.auth!.id]);
    await audit(actorOf(req), 'flag.changed', 'flag', key, before, b); return { ok: true };
  });
  app.put('/admin/templates/:key/:lang', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const p = parse(z.object({ key: z.string(), lang: z.enum(['rw', 'en', 'fr', 'sw']) }), req.params);
    const b = parse(z.object({ title: z.string().min(1).max(100), body: z.string().min(1).max(500) }), req.body);
    if (/\{\{\s*(password|secret|token|key)\s*\}\}/i.test(b.body)) throw badRequest('forbidden_placeholder', 'Templates must never carry credentials');
    await q('insert into notification_templates(key,lang,title,body) values ($1,$2,$3,$4) on conflict (key,lang) do update set title=excluded.title, body=excluded.body', [p.key, p.lang, b.title, b.body]);
    await audit(actorOf(req), 'template.changed', 'template', `${p.key}:${p.lang}`, undefined, b); return { ok: true };
  });
  app.get('/admin/audit', { preHandler: requirePerm('audit.view') }, async (req) => {
    const b = parse(z.object({ entity_type: z.string().optional(), entity_id: z.string().optional(), actor_id: z.string().uuid().optional(), action: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return { logs: await q(`select a.*, u.display_name actor_name from audit_logs a left join users u on u.id=a.actor_id where ($1::text is null or a.entity_type=$1) and ($2::text is null or a.entity_id=$2) and ($3::uuid is null or a.actor_id=$3) and ($4::text is null or a.action like $4) order by a.id desc limit $5`, [b.entity_type ?? null, b.entity_id ?? null, b.actor_id ?? null, b.action ? `${b.action}%` : null, b.limit]) };
  });
  app.get('/admin/staff', { preHandler: requirePerm('users.manage') }, async () => ({
    staff: await q(`select u.id, u.email, u.display_name, u.status, array(select role from user_roles r where r.user_id=u.id) roles from users u where exists (select 1 from user_roles r where r.user_id=u.id and r.role = any($1))`, [STAFF_ROLES]),
    roles: Object.fromEntries(Object.entries(ROLE_PERMISSIONS).filter(([r]) => STAFF_ROLES.includes(r))),
  }));
  app.post('/admin/staff/:id/sessions/revoke', { preHandler: requirePerm('users.manage') }, async (req) => {
    const { id } = parse(idp, req.params);
    await q('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [id]); await audit(actorOf(req), 'staff.sessions_revoked', 'user', id); return { ok: true };
  });

  app.get('/admin/integration-status', { preHandler: requirePerm('settings.manage') }, async () => ({
    integrations: [
      { name: 'SMS / OTP delivery', status: config.smsProvider === 'console' ? 'SIMULATED (console log only)' : 'IMPLEMENTED (generic HTTP gateway; verify with your aggregator)' },
      { name: 'MTN MoMo collections', status: config.momo.mode === 'simulator' ? 'SIMULATED (local simulator)' : config.momo.mode === 'sandbox' ? 'IMPLEMENTED against MTN sandbox; needs your subscription key, API user/key' : 'LIVE (needs MTN production approval)' },
      { name: 'Airtel Money', status: 'PENDING INTEGRATION' },
      { name: 'MoMo disbursements (automated payouts)', status: 'PENDING INTEGRATION (payouts are approved and released manually)' },
      { name: 'Maps / routing', status: config.mapProvider === 'osrm' ? 'IMPLEMENTED (OSRM + Nominatim; evaluate for Kigali)' : 'ESTIMATE ONLY (straight-line x road factor)' },
      { name: 'Push notifications (FCM)', status: 'PENDING INTEGRATION (notifications stored in-app; SMS used for critical events)' },
      { name: 'Masked calling', status: 'PENDING INTEGRATION (in-app chat implemented)' },
      { name: 'Identity/licence verification API', status: 'PENDING INTEGRATION (manual document review implemented)' },
      { name: 'Object storage', status: 'IMPLEMENTED on local private disk; use S3-compatible bucket in production' },
      { name: 'Google / Apple sign-in', status: 'PENDING INTEGRATION' },
    ],
  }));
}

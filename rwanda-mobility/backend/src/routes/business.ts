import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { anyAuth, requireRole, actorOf } from '../guards.js';
import { q, q1, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { normalizePhone } from '../util/phone.js';
import { flag } from '../services/settings.js';
import * as B from '../services/bookings.js';
import { requestPayout } from '../services/finance.js';
import { driverBalance } from '../services/ledger.js';
import { audit } from '../services/audit.js';

const idp = z.object({ id: z.string().uuid() });

/** Object-level checks: every corporate/fleet endpoint passes through one of these. */
export async function corpMember(userId: string, corpId: string, adminOnly = false) {
  const m = await q1<any>('select * from corporate_members where corporate_id=$1 and user_id=$2 and active', [corpId, userId]);
  if (!m || (adminOnly && m.role !== 'admin')) throw notFound('business account');   // do not reveal other businesses
  return m;
}
export async function fleetMember(userId: string, fleetId: string) {
  const m = await q1<any>('select * from fleet_members where fleet_id=$1 and user_id=$2', [fleetId, userId]);
  if (!m) throw notFound('fleet');
  return m;
}

export async function businessRoutes(app: FastifyInstance) {
  const pre = { preHandler: anyAuth };

  // ================= corporate =================
  app.post('/businesses', pre, async (req) => {
    if (!(await flag('corporate.enabled'))) throw badRequest('corporate_disabled');
    const b = parse(z.object({ legal_name: z.string().min(2).max(160), tin: z.string().max(30).optional() }), req.body);
    return tx(async (c) => {
      const a = (await q<any>('insert into corporate_accounts(legal_name, tin, created_by) values ($1,$2,$3) returning id, legal_name, status', [b.legal_name, b.tin ?? null, req.auth!.id], c))[0];
      await q("insert into corporate_members(corporate_id,user_id,role) values ($1,$2,'admin')", [a.id, req.auth!.id], c);
      await q("insert into user_roles values ($1,'corporate_admin') on conflict do nothing", [req.auth!.id], c);
      return { ...a, note: 'Pending manual verification by our team before bookings are allowed.' };
    });
  });
  app.get('/businesses/mine', pre, async (req) => ({
    businesses: await q(`select a.id, a.legal_name, a.status, a.billing_mode, a.monthly_budget, a.policy, m.role, m.spending_limit, m.cost_centre
      from corporate_members m join corporate_accounts a on a.id=m.corporate_id where m.user_id=$1 and m.active`, [req.auth!.id]),
  }));
  app.patch('/businesses/:id/policy', pre, async (req) => {
    const { id } = parse(idp, req.params); await corpMember(req.auth!.id, id, true);
    const b = parse(z.object({ max_fare: z.number().int().positive().nullable().optional(), allowed_services: z.array(z.string()).optional(), start_hour: z.number().int().min(0).max(23).nullable().optional(), end_hour: z.number().int().min(1).max(24).nullable().optional(), monthly_budget: z.number().int().positive().nullable().optional() }), req.body);
    const { monthly_budget, ...policy } = b;
    const cur = await q1<any>('select policy from corporate_accounts where id=$1', [id]);
    await q('update corporate_accounts set policy=$2, monthly_budget = case when $3::boolean then $4 else monthly_budget end where id=$1', [id, JSON.stringify({ ...cur.policy, ...policy }), 'monthly_budget' in b, monthly_budget ?? null]);
    await audit(actorOf(req), 'corporate.policy', 'corporate', id, cur.policy, b);
    return { ok: true };
  });
  app.get('/businesses/:id/members', pre, async (req) => {
    const { id } = parse(idp, req.params); await corpMember(req.auth!.id, id, true);
    return { members: await q(`select m.user_id, u.display_name, u.phone, m.role, m.spending_limit, m.cost_centre, m.active from corporate_members m join users u on u.id=m.user_id where m.corporate_id=$1`, [id]) };
  });
  app.post('/businesses/:id/members', pre, async (req) => {
    const { id } = parse(idp, req.params); await corpMember(req.auth!.id, id, true);
    const b = parse(z.object({ phone: z.string(), role: z.enum(['admin', 'booker', 'employee']).default('employee'), spending_limit: z.number().int().positive().optional(), cost_centre: z.string().max(60).optional(), name: z.string().max(80).optional() }), req.body);
    const phone = normalizePhone(b.phone); if (!phone) throw badRequest('invalid_phone');
    return tx(async (c) => {
      let u = await q1<any>('select id from users where phone=$1', [phone], c);
      if (!u) { u = await q1<any>('insert into users(phone, display_name) values ($1,$2) returning id', [phone, b.name ?? null], c); await q("insert into user_roles values ($1,'passenger')", [u.id], c); }
      await q(`insert into corporate_members(corporate_id,user_id,role,spending_limit,cost_centre) values ($1,$2,$3,$4,$5)
               on conflict (corporate_id,user_id) do update set role=excluded.role, spending_limit=excluded.spending_limit, cost_centre=excluded.cost_centre, active=true`, [id, u.id, b.role, b.spending_limit ?? null, b.cost_centre ?? null], c);
      if (b.role !== 'employee') await q("insert into user_roles values ($1,$2) on conflict do nothing", [u.id, b.role === 'admin' ? 'corporate_admin' : 'corporate_booker'], c);
      await audit(actorOf(req), 'corporate.member_added', 'corporate', id, undefined, { phone, role: b.role }, c);
      return { ok: true, user_id: u.id };
    });
  });
  app.delete('/businesses/:id/members/:uid', pre, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), uid: z.string().uuid() }), req.params); await corpMember(req.auth!.id, p.id, true);
    if (p.uid === req.auth!.id) throw conflict('self_remove', 'You cannot remove yourself');
    await q('update corporate_members set active=false where corporate_id=$1 and user_id=$2', [p.id, p.uid]);
    return { ok: true };
  });
  // company-funded ride (same booking engine; policy and spending limits enforced server-side)
  app.post('/businesses/:id/bookings', pre, async (req, reply) => {
    const { id } = parse(idp, req.params); await corpMember(req.auth!.id, id);
    const key = (req.headers['idempotency-key'] as string) ?? '';
    if (key.length < 8) throw badRequest('idempotency_key_required');
    const b = parse(z.object({ quote_id: z.string().uuid(), pickup_name: z.string().max(160).optional(), pickup_note: z.string().max(300).optional(), dest_name: z.string().max(160).optional(), cost_centre: z.string().max(60).optional(), po_ref: z.string().max(60).optional(), rider_name: z.string().max(80).optional(), rider_phone: z.string().max(20).optional(), customer_vehicle_id: z.string().uuid().optional(), owner_attested: z.boolean().optional() }), req.body);
    const { booking, replay } = await B.createBooking(req.auth!.id, { ...b, payment_method: 'corporate', corporate_id: id, idempotency_key: key });
    reply.code(replay ? 200 : 201);
    return B.bookingView(booking, 'corporate');
  });
  app.get('/businesses/:id/bookings', pre, async (req) => {
    const { id } = parse(idp, req.params); const m = await corpMember(req.auth!.id, id);
    const rows = await q<any>(`select * from bookings where corporate_id=$1 and ($2 or passenger_id=$3) order by created_at desc limit 100`, [id, m.role === 'admin', req.auth!.id]);
    return { bookings: await Promise.all(rows.map((r) => B.bookingView(r, m.role === 'admin' ? 'corporate' : 'passenger'))) };
  });
  app.get('/businesses/:id/statement', pre, async (req) => {
    const { id } = parse(idp, req.params); await corpMember(req.auth!.id, id, true);
    const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), req.query);
    const trips = await q(`select b.ref, b.completed_at, b.pickup_name, b.dest_name, b.final_fare, b.cost_centre, b.po_ref, u.display_name employee
      from bookings b join users u on u.id=b.passenger_id where b.corporate_id=$1 and b.status in ('PAYMENT_COMPLETED','PARTIALLY_REFUNDED') and to_char(b.completed_at at time zone 'Africa/Kigali','YYYY-MM')=$2 order by b.completed_at`, [id, month]);
    const total = trips.reduce((s: number, t: any) => s + t.final_fare, 0);
    const byCc: Record<string, number> = {}; trips.forEach((t: any) => { byCc[t.cost_centre ?? 'unassigned'] = (byCc[t.cost_centre ?? 'unassigned'] ?? 0) + t.final_fare; });
    return { month, currency: 'RWF', trip_count: trips.length, total, by_cost_centre: byCc, trips };
  });
  app.get('/businesses/:id/invoices', pre, async (req) => {
    const { id } = parse(idp, req.params); await corpMember(req.auth!.id, id, true);
    return { invoices: await q('select * from corporate_invoices where corporate_id=$1 order by period_start desc', [id]) };
  });

  // ================= fleets =================
  app.post('/fleets', pre, async (req) => {
    if (!(await flag('fleet.enabled'))) throw badRequest('fleet_disabled');
    const b = parse(z.object({ name: z.string().min(2).max(120) }), req.body);
    return tx(async (c) => {
      const f = (await q<any>('insert into fleets(name, owner_user_id) values ($1,$2) returning id, name, status', [b.name, req.auth!.id], c))[0];
      await q("insert into fleet_members(fleet_id,user_id,role) values ($1,$2,'owner')", [f.id, req.auth!.id], c);
      await q("insert into user_roles values ($1,'fleet_manager') on conflict do nothing", [req.auth!.id], c);
      return { ...f, note: 'Pending verification by our team.' };
    });
  });
  app.get('/fleets/mine', pre, async (req) => ({ fleets: await q('select f.id, f.name, f.status, f.revenue_share_bps, m.role from fleet_members m join fleets f on f.id=m.fleet_id where m.user_id=$1', [req.auth!.id]) }));
  app.post('/fleets/:id/invites', pre, async (req) => {
    const { id } = parse(idp, req.params); await fleetMember(req.auth!.id, id);
    const b = parse(z.object({ phone: z.string() }), req.body);
    const phone = normalizePhone(b.phone); if (!phone) throw badRequest('invalid_phone');
    const f = await q1<any>('select status from fleets where id=$1', [id]);
    if (f.status !== 'active') throw forbidden('Fleet must be verified before inviting drivers');
    return q1("insert into fleet_invites(fleet_id, phone) values ($1,$2) on conflict (fleet_id, phone) do update set status='pending' returning id, phone, status", [id, phone]);
  });
  app.get('/fleets/:id/drivers', pre, async (req) => {
    const { id } = parse(idp, req.params); await fleetMember(req.auth!.id, id);
    return { drivers: await q(`select dp.user_id, u.display_name, dp.status, dp.is_online, dp.rating_avg, dp.completed_count, dp.cancel_count,
        v.plate, v.vehicle_type, v.status vehicle_status from driver_profiles dp join users u on u.id=dp.user_id left join vehicles v on v.driver_id=dp.user_id and v.status<>'rejected' where dp.fleet_id=$1`, [id]) };
  });
  app.get('/fleets/:id/vehicles', pre, async (req) => {
    const { id } = parse(idp, req.params); await fleetMember(req.auth!.id, id);
    const rows = await q<any>('select v.id, v.plate, v.vehicle_type, v.make, v.model, v.status, v.driver_id from vehicles v where v.fleet_id=$1', [id]);
    const exp = await q<any>(`select d.driver_id, d.doc_type, d.expiry_date from driver_documents d join driver_profiles dp on dp.user_id=d.driver_id where dp.fleet_id=$1 and not d.superseded and d.expiry_date is not null and d.expiry_date < current_date + 30 order by d.expiry_date`, [id]);
    return { vehicles: rows, expiring_documents: exp };
  });
  app.patch('/fleets/:id/vehicles/:vid', pre, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), vid: z.string().uuid() }), req.params); await fleetMember(req.auth!.id, p.id);
    const b = parse(z.object({ status: z.enum(['approved', 'suspended']) }), req.body);
    const r = await q("update vehicles set status=$3 where id=$1 and fleet_id=$2 and status in ('approved','suspended') returning id", [p.vid, p.id, b.status]);
    if (!r.length) throw notFound('vehicle');
    return { ok: true };
  });
  app.get('/fleets/:id/trips', pre, async (req) => {
    const { id } = parse(idp, req.params); await fleetMember(req.auth!.id, id);
    return { trips: await q(`select b.ref, b.status, b.driver_id, b.final_fare, b.completed_at, b.service_id from bookings b join driver_profiles dp on dp.user_id=b.driver_id where dp.fleet_id=$1 order by b.created_at desc limit 100`, [id]) };
  });
  app.get('/fleets/:id/earnings', pre, async (req) => {
    const { id } = parse(idp, req.params); const m = await fleetMember(req.auth!.id, id);
    const f = await q1<any>('select owner_user_id from fleets where id=$1', [id]);
    const t = await q1<any>('select count(*)::int trips, coalesce(sum(fare_subtotal),0)::int gross, coalesce(sum(commission),0)::int commission, coalesce(sum(fleet_share),0)::int fleet_share, coalesce(sum(net),0)::int driver_net from driver_earnings where fleet_id=$1', [id]);
    return { ...t, fleet_balance: m.role === 'owner' ? await driverBalance(f.owner_user_id) : undefined };
  });
  app.post('/fleets/:id/payouts', pre, async (req) => {
    const { id } = parse(idp, req.params); const m = await fleetMember(req.auth!.id, id);
    if (m.role !== 'owner') throw forbidden('Only the fleet owner can request payouts');
    const b = parse(z.object({ amount: z.number().int().positive() }), req.body);
    return requestPayout(req.auth!.id, b.amount, 'fleet');
  });
}

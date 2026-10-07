import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { anyAuth, requireRole, requirePerm, actorOf, routeLimit } from '../guards.js';
import { q, q1 } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { normalizePhone } from '../util/phone.js';
import * as A from '../services/abasare.js';

const idp = z.object({ id: z.string().uuid() });
const phase = z.enum(['pickup', 'dropoff']);

export async function abasareRoutes(app: FastifyInstance) {
  // ---- the customer's cars ----
  app.get('/users/me/cars', { preHandler: anyAuth }, async (req) => ({
    cars: await q('select id, plate, make, model, color, year, vehicle_class, transmission, insurance_confirmed, insurance_expiry from customer_vehicles where owner_id=$1 and active order by created_at', [req.auth!.id]),
  }));
  app.post('/users/me/cars', { preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({
      plate: z.string().min(4).max(12), make: z.string().max(40).optional(), model: z.string().max(40).optional(), color: z.string().max(30).optional(), year: z.number().int().min(1980).max(2100).optional(),
      vehicle_class: z.enum(A.CLASSES), transmission: z.enum(A.TRANSMISSIONS), insurance_confirmed: z.boolean(), insurance_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }), req.body);
    const n = await q1<any>('select count(*)::int n from customer_vehicles where owner_id=$1 and active', [req.auth!.id]);
    if (n.n >= 5) throw conflict('limit', 'Maximum 5 cars');
    const plate = b.plate.toUpperCase().replace(/\s+/g, '');
    try {
      return await q1(`insert into customer_vehicles(owner_id, plate, make, model, color, year, vehicle_class, transmission, insurance_confirmed, insurance_expiry)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (owner_id, plate) do update set make=excluded.make, model=excluded.model, color=excluded.color, year=excluded.year, vehicle_class=excluded.vehicle_class,
          transmission=excluded.transmission, insurance_confirmed=excluded.insurance_confirmed, insurance_expiry=excluded.insurance_expiry, active=true
        returning id, plate, make, model, color, year, vehicle_class, transmission, insurance_confirmed, insurance_expiry`,
        [req.auth!.id, plate, b.make ?? null, b.model ?? null, b.color ?? null, b.year ?? null, b.vehicle_class, b.transmission, b.insurance_confirmed, b.insurance_expiry ?? null]);
    } catch (e: any) { throw e; }
  });
  app.delete('/users/me/cars/:id', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const busy = await q1("select 1 from bookings where customer_vehicle_id=$1 and status in ('REQUESTED','SEARCHING_DRIVER','SCHEDULED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS')", [id]);
    if (busy) throw conflict('car_in_use', 'This car is on an active booking');
    await q('update customer_vehicles set active=false where id=$1 and owner_id=$2', [id, req.auth!.id]);
    return { ok: true };
  });

  // ---- driver application ----
  app.post('/abasare/apply', { preHandler: requireRole('driver') }, async (req) => {
    const b = parse(z.object({
      legal_name: z.string().min(3).max(120), national_id: z.string().min(8).max(20), payout_msisdn: z.string().optional(),
      licence_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), years_experience: z.number().int().min(0).max(60),
      transmissions: z.array(z.enum(A.TRANSMISSIONS)).min(1), classes: z.array(z.enum(A.CLASSES)).min(1), return_mode: z.enum(A.RETURN_MODES),
    }), req.body);
    const msisdn = b.payout_msisdn ? normalizePhone(b.payout_msisdn) : null;
    if (b.payout_msisdn && !msisdn) throw badRequest('invalid_phone', 'Invalid payout number');
    return A.applyAbasare(req.auth!.id, { ...b, payout_msisdn: msisdn });
  });

  // ---- check-in / check-out of the customer's car ----
  app.post('/bookings/:id/handover/photos', { config: routeLimit('UPLOAD_RATE_MAX', 20), preHandler: requireRole('driver') }, async (req) => {
    const { id } = parse(idp, req.params);
    const { phase: ph } = parse(z.object({ phase }), req.query);
    let buf: Buffer | null = null;
    for await (const p of req.parts({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } })) if (p.type === 'file') { buf = await p.toBuffer(); if ((p as any).file.truncated) throw badRequest('file_too_large', 'Maximum file size is 5 MB'); }
    if (!buf) throw badRequest('file_required');
    return A.addHandoverPhoto(req.auth!.id, id, ph, buf);
  });
  app.post('/bookings/:id/handover', { preHandler: requireRole('driver') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ phase, odometer_km: z.number().int().min(0).max(2_000_000), fuel_percent: z.number().int().min(0).max(100), notes: z.string().max(500).optional(), damage_noted: z.boolean().optional() }), req.body);
    return A.submitHandover(req.auth!.id, id, b.phase, b);
  });
  app.post('/bookings/:id/handover/:phase/respond', { preHandler: anyAuth }, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), phase }), req.params);
    const b = parse(z.object({ response: z.enum(['ok', 'issue']), note: z.string().max(500).optional() }), req.body);
    return A.respondHandover(req.auth!.id, p.id, p.phase, b.response, b.note);
  });

  // ---- staff ----
  app.get('/admin/abasare/applications', { preHandler: requirePerm('drivers.view') }, async (req) => {
    const b = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'suspended']).default('pending') }), req.query);
    return { applications: await q(`select dp.user_id, u.display_name, u.phone, dp.status account_status, dp.abasare_status, dp.abasare_skills, dp.abasare_applied_at, dp.abasare_reason, dp.completed_count, dp.rating_avg
      from driver_profiles dp join users u on u.id=dp.user_id where dp.abasare_status=$1 order by dp.abasare_applied_at`, [b.status]) };
  });
  app.post('/admin/drivers/:id/abasare-decision', { preHandler: requirePerm('drivers.review') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ decision: z.enum(['approve', 'reject', 'suspend', 'reinstate']), reason: z.string().max(500).optional() }), req.body);
    return A.decideAbasare(actorOf(req), id, b.decision, b.reason);
  });
}

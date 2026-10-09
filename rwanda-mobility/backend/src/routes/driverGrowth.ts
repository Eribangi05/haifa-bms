import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requireRole, requirePerm, actorOf } from '../guards.js';
import { q, q1, tx } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';
import { getSetting } from '../services/settings.js';
import { refreshEligibility } from '../services/drivers.js';

const idp = z.object({ id: z.string().uuid() });
const vehicleBody = z.object({
  vehicle_type: z.enum(['moto', 'car', 'minivan', 'pickup', 'truck']), make: z.string().trim().min(1).max(40), model: z.string().trim().min(1).max(40), color: z.string().trim().min(1).max(30),
  year: z.number().int().min(1990).max(2100).optional(), plate: z.string().trim().min(4).max(12), capacity: z.number().int().min(1).max(60), comfort: z.boolean().default(false),
});

/** What a vehicle of this type needs, and what the driver has uploaded so far. */
async function vehicleChecklist(driverId: string, vehicleType: string) {
  const reqs = await q<any>('select doc_type, mandatory, requires_expiry from document_requirements where vehicle_type=$1 order by mandatory desc, doc_type', [vehicleType]);
  const docs = await q<any>('select doc_type, review_status, review_note, expiry_date from driver_documents where driver_id=$1 and not superseded order by created_at desc', [driverId]);
  const byType = new Map<string, any>(); for (const d of docs) if (!byType.has(d.doc_type)) byType.set(d.doc_type, d);
  return reqs.map((r) => ({ doc_type: r.doc_type, mandatory: r.mandatory, requires_expiry: r.requires_expiry, status: byType.get(r.doc_type)?.review_status ?? 'missing', note: byType.get(r.doc_type)?.review_note ?? null }));
}

/** Round 5: vehicle application for an approved driver, the driver onboarding tracker, and the console review queue with its time target. */
export async function driverGrowthRoutes(app: FastifyInstance) {
  const drv = { preHandler: requireRole('driver') };

  // ---------- approved driver (typically an Abasare driver who bought a car) applies to ride with a vehicle ----------
  app.get('/drivers/me/vehicle-application', drv, async (req) => {
    const id = req.auth!.id;
    const dp = await q1<any>('select status, abasare_status from driver_profiles where user_id=$1', [id]);
    const veh = await q1<any>("select id, vehicle_type, make, model, color, year, plate, capacity, comfort, status, review_requested_at, review_note from vehicles where driver_id=$1 order by (status='approved') desc, created_at desc limit 1", [id]);
    const sla = await getSetting('onboarding.review_sla_hours');
    return {
      can_apply: dp?.status === 'APPROVED' && (!veh || ['rejected', 'pending'].includes(veh.status)),
      driver_status: dp?.status, vehicle: veh ?? null,
      stage: !veh ? 'none' : veh.status === 'approved' ? 'approved' : veh.status === 'rejected' ? 'rejected' : veh.review_requested_at ? 'in_review' : 'draft',
      checklist: veh ? await vehicleChecklist(id, veh.vehicle_type) : [], review_target_hours: sla,
    };
  });
  app.post('/drivers/me/vehicle-application', drv, async (req) => {
    const id = req.auth!.id;
    const v = parse(vehicleBody, req.body);
    const plate = v.plate.toUpperCase().replace(/\s+/g, '');
    await tx(async (c) => {
      const dp = await q1<any>('select status from driver_profiles where user_id=$1 for update', [id], c);
      if (dp?.status !== 'APPROVED') throw conflict('not_approved_driver', 'Only an approved driver can add a vehicle this way');
      const cur = await q1<any>("select id, status, review_requested_at from vehicles where driver_id=$1 order by (status='approved') desc, created_at desc limit 1", [id], c);
      if (cur?.status === 'approved') throw conflict('vehicle_not_editable', 'You already have an approved vehicle');
      if (cur?.status === 'pending' && cur.review_requested_at) throw conflict('vehicle_already_pending', 'Your vehicle is already being reviewed');
      try {
        if (cur) await q("update vehicles set vehicle_type=$2, comfort=$3, make=$4, model=$5, color=$6, year=$7, plate=$8, capacity=$9, status='pending', review_note=null where id=$1", [cur.id, v.vehicle_type, v.comfort, v.make, v.model, v.color, v.year ?? null, plate, v.capacity], c);
        else await q('insert into vehicles(driver_id, vehicle_type, comfort, make, model, color, year, plate, capacity) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, v.vehicle_type, v.comfort, v.make, v.model, v.color, v.year ?? null, plate, v.capacity], c);
      } catch (e: any) { if (e.code === '23505') throw conflict('plate_in_use', 'This plate is already registered'); throw e; }
      await audit(actorOf(req), 'vehicle.application_saved', 'driver', id, undefined, { plate, vehicle_type: v.vehicle_type }, c);
    });
    return { ok: true };
  });
  app.post('/drivers/me/vehicle-application/submit', drv, async (req) => {
    const id = req.auth!.id;
    await tx(async (c) => {
      const veh = await q1<any>("select id, vehicle_type, review_requested_at from vehicles where driver_id=$1 and status='pending' order by created_at desc limit 1", [id], c);
      if (!veh) throw badRequest('application_incomplete', 'Save your vehicle details first');
      if (veh.review_requested_at) throw conflict('vehicle_already_pending', 'Your vehicle is already being reviewed');
      const missing = await q<any>(`select r.doc_type from document_requirements r where r.vehicle_type=$1 and r.mandatory and not exists (
        select 1 from driver_documents d where d.driver_id=$2 and d.doc_type=r.doc_type and not d.superseded and d.review_status in ('pending','approved'))`, [veh.vehicle_type, id], c);
      if (missing.length) throw badRequest('documents_missing', 'Upload all required documents', missing.map((m: any) => m.doc_type));
      await q('update vehicles set review_requested_at=now() where id=$1', [veh.id], c);
      await audit(actorOf(req), 'vehicle.application_submitted', 'vehicle', veh.id, undefined, undefined, c);
    });
    return { ok: true };
  });

  // ---------- driver onboarding tracker: where am I, what is next, how long will it take ----------
  app.get('/drivers/me/onboarding', drv, async (req) => {
    const id = req.auth!.id;
    const dp = await q1<any>('select status, status_reason, submitted_at, abasare_status, legal_name from driver_profiles where user_id=$1', [id]);
    const veh = await q1<any>("select id, vehicle_type, status from vehicles where driver_id=$1 and status in ('pending','approved') order by created_at desc limit 1", [id]);
    const types = [...(veh ? [veh.vehicle_type] : []), ...(dp.abasare_status && dp.abasare_status !== 'none' ? ['abasare'] : [])];
    const reqs = types.length ? await q<any>('select doc_type, bool_or(mandatory) mandatory from document_requirements where vehicle_type = any($1) group by doc_type', [types]) : [];
    const docs = await q<any>('select doc_type, review_status, review_note from driver_documents where driver_id=$1 and not superseded order by created_at desc', [id]);
    const latest = new Map<string, any>(); for (const d of docs) if (!latest.has(d.doc_type)) latest.set(d.doc_type, d);
    const items = reqs.filter((r) => r.mandatory).map((r) => ({ doc_type: r.doc_type, status: latest.get(r.doc_type)?.review_status ?? 'missing', note: latest.get(r.doc_type)?.review_note ?? null }));
    const sla = await getSetting('onboarding.review_sla_hours');
    const waitingH = dp.submitted_at && ['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW'].includes(dp.status) ? (Date.now() - new Date(dp.submitted_at).getTime()) / 3_600_000 : null;
    const todo = items.filter((i) => ['missing', 'rejected'].includes(i.status));
    return {
      status: dp.status, reason: dp.status_reason,
      percent: items.length ? Math.round((items.filter((i) => i.status !== 'missing' && i.status !== 'rejected').length / items.length) * 100) : 0,
      documents: items, next_action: todo.length ? { kind: 'upload', doc_type: todo[0].doc_type, remaining: todo.length } : dp.status === 'APPLICATION_STARTED' || dp.status === 'INFO_REQUIRED' || dp.status === 'REJECTED' ? { kind: 'submit' } : null,
      review: { target_hours: sla, waiting_hours: waitingH == null ? null : Math.round(waitingH * 10) / 10, late: waitingH != null && waitingH > sla, prioritised: waitingH != null && waitingH > sla },
    };
  });

  // ---------- console: review queue (driver applications + vehicle applications), oldest first, with the time target ----------
  app.get('/admin/review-queue', { preHandler: requirePerm('drivers.view') }, async () => {
    const sla = await getSetting('onboarding.review_sla_hours');
    const drivers = await q<any>(`select dp.user_id id, u.display_name, u.phone, dp.legal_name, dp.status, dp.submitted_at, dp.abasare_status, v.vehicle_type, v.plate,
        (select count(*)::int from driver_documents d where d.driver_id=dp.user_id and not d.superseded and d.review_status='pending') docs_pending,
        (select count(*)::int from driver_documents d where d.driver_id=dp.user_id and not d.superseded and d.review_status='rejected') docs_rejected
      from driver_profiles dp join users u on u.id=dp.user_id left join vehicles v on v.driver_id=dp.user_id and v.status in ('pending','approved')
      where dp.status in ('DOCUMENTS_SUBMITTED','UNDER_REVIEW') order by dp.submitted_at nulls last`);
    const vehicles = await q<any>(`select v.id, v.driver_id, u.display_name, u.phone, v.vehicle_type, v.plate, v.make, v.model, v.review_requested_at,
        (select count(*)::int from driver_documents d where d.driver_id=v.driver_id and not d.superseded and d.review_status='pending') docs_pending
      from vehicles v join users u on u.id=v.driver_id where v.status='pending' and v.review_requested_at is not null order by v.review_requested_at`);
    const age = (t: string | null) => (t ? Math.round(((Date.now() - new Date(t).getTime()) / 3_600_000) * 10) / 10 : null);
    const row = (kind: 'driver' | 'vehicle', r: any, at: string | null) => ({ kind, ...r, waiting_hours: age(at), late: (age(at) ?? 0) > sla });
    return { target_hours: sla, driver_applications: drivers.map((r) => row('driver', r, r.submitted_at)), vehicle_applications: vehicles.map((r) => row('vehicle', r, r.review_requested_at)) };
  });
  app.post('/admin/vehicles/:id/review', { preHandler: requirePerm('drivers.review') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional() }), req.body);
    if (b.decision === 'reject' && !b.note) throw badRequest('reason_required', 'A reason is required');
    const v = await tx(async (c) => {
      const veh = await q1<any>("select id, driver_id, plate, vehicle_type, status from vehicles where id=$1 for update", [id], c);
      if (!veh) throw notFound('vehicle');
      if (veh.status !== 'pending') throw conflict('vehicle_not_editable', `Vehicle is ${veh.status}`);
      if (b.decision === 'approve') {
        const need = await q<any>(`select distinct r.doc_type from document_requirements r where r.vehicle_type=$1 and r.mandatory and not exists (
          select 1 from driver_documents d where d.driver_id=$2 and d.doc_type=r.doc_type and not d.superseded and d.review_status='approved' and (d.expiry_date is null or d.expiry_date >= current_date))`, [veh.vehicle_type, veh.driver_id], c);
        if (need.length) throw conflict('documents_not_approved', `Approve all mandatory documents first (${need.map((n: any) => n.doc_type).join(', ')})`);
      }
      await q('update vehicles set status=$2, review_note=$3 where id=$1', [id, b.decision === 'approve' ? 'approved' : 'rejected', b.note ?? null], c);
      await audit(actorOf(req), `vehicle.${b.decision}`, 'vehicle', id, { status: veh.status }, b, c);
      return veh;
    });
    await refreshEligibility(v.driver_id);
    await notify(v.driver_id, b.decision === 'approve' ? 'vehicle_approved' : 'vehicle_rejected', { plate: v.plate, reason: b.note ?? '' });
    return { ok: true };
  });
}

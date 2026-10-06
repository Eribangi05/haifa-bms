import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, lat, lng } from '../util/validate.js';
import { requireRole, anyAuth, actorOf } from '../guards.js';
import { q, q1, tx } from '../db.js';
import { badRequest, conflict, notFound, forbidden } from '../errors.js';
import { normalizePhone } from '../util/phone.js';
import { encrypt, signFileToken, verifyFileToken } from '../util/crypto.js';
import { saveFile, readFileByKey } from '../services/storage.js';
import * as Dr from '../services/drivers.js';
import { driverBalance } from '../services/ledger.js';
import { requestPayout } from '../services/finance.js';
import { audit } from '../services/audit.js';

const KNOWN_DOCS = ['national_id', 'driving_licence', 'profile_photo', 'vehicle_registration', 'insurance', 'transport_permit', 'inspection', 'ownership_authorisation'];

export async function driverRoutes(app: FastifyInstance) {
  const drv = { preHandler: requireRole('driver') };

  /** An existing passenger starts the (separate, gated) driver onboarding. Grants no permission to receive trips. */
  app.post('/drivers/enroll', { preHandler: anyAuth }, async (req) => {
    await tx(async (c) => {
      await q("insert into user_roles values ($1,'driver') on conflict do nothing", [req.auth!.id], c);
      await q('insert into driver_profiles(user_id) values ($1) on conflict do nothing', [req.auth!.id], c);
    });
    return { ok: true, note: 'Complete your application and documents. You cannot receive trips until you are approved.' };
  });

  app.post('/drivers/applications', drv, async (req) => {
    const b = parse(z.object({
      legal_name: z.string().min(3).max(120), national_id: z.string().min(8).max(20),
      vehicle: z.object({ vehicle_type: z.enum(['moto', 'car', 'minivan', 'pickup', 'truck']), make: z.string().max(40), model: z.string().max(40), color: z.string().max(30), year: z.number().int().min(1990).max(2100).optional(), plate: z.string().min(4).max(12), capacity: z.number().int().min(1).max(60), comfort: z.boolean().default(false) }),
      zone_id: z.string().default('kigali'), payout_msisdn: z.string().optional(), payout_provider: z.enum(['mtn_momo', 'airtel_money']).default('mtn_momo'),
      preferred_hours: z.object({ start: z.number().min(0).max(23), end: z.number().min(0).max(24) }).optional(),
      emergency_contact: z.object({ name: z.string().max(80), phone: z.string() }).optional(),
    }), req.body);
    const msisdn = b.payout_msisdn ? normalizePhone(b.payout_msisdn) : null;
    if (b.payout_msisdn && !msisdn) throw badRequest('invalid_phone', 'Invalid payout number');
    const id = req.auth!.id;
    const plate = b.vehicle.plate.toUpperCase().replace(/\s+/g, '');
    await tx(async (c) => {
      const dp = await q1<any>('select status from driver_profiles where user_id=$1 for update', [id], c);
      if (!['APPLICATION_STARTED', 'INFO_REQUIRED', 'REJECTED'].includes(dp.status)) throw conflict('not_editable', `Application is ${dp.status}`);
      await q(`update driver_profiles set legal_name=$2, national_id_enc=$3, zone_id=$4, payout_msisdn=$5, payout_provider=$6, preferred_hours=$7, emergency_contact_enc=$8 where user_id=$1`,
        [id, b.legal_name, encrypt(b.national_id), b.zone_id, msisdn, b.payout_provider, b.preferred_hours ? JSON.stringify(b.preferred_hours) : null, b.emergency_contact ? encrypt(JSON.stringify(b.emergency_contact)) : null], c);
      await q("update users set display_name=coalesce(display_name,$2) where id=$1", [id, b.legal_name], c);
      const v = b.vehicle;
      const existing = await q1<any>("select id from vehicles where driver_id=$1 and status in ('pending','rejected') order by created_at desc limit 1", [id], c);
      try {
        if (existing) await q('update vehicles set vehicle_type=$2, comfort=$3, make=$4, model=$5, color=$6, year=$7, plate=$8, capacity=$9, status=\'pending\' where id=$1', [existing.id, v.vehicle_type, v.comfort, v.make, v.model, v.color, v.year ?? null, plate, v.capacity], c);
        else await q('insert into vehicles(driver_id, vehicle_type, comfort, make, model, color, year, plate, capacity) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, v.vehicle_type, v.comfort, v.make, v.model, v.color, v.year ?? null, plate, v.capacity], c);
      } catch (e: any) { if (e.code === '23505') throw conflict('plate_in_use', 'This plate is already registered'); throw e; }
    });
    return { ok: true };
  });

  app.post('/drivers/documents', drv, async (req) => {
    const parts = req.parts({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
    const f: Record<string, string> = {}; let buf: Buffer | null = null;
    for await (const p of parts) {
      if (p.type === 'file') { buf = await p.toBuffer(); if ((p as any).file.truncated) throw badRequest('file_too_large', 'Maximum file size is 5 MB'); }
      else f[p.fieldname] = String(p.value);
    }
    const body = parse(z.object({ doc_type: z.enum(KNOWN_DOCS as [string, ...string[]]), expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), f);
    if (!buf) throw badRequest('file_required');
    const veh = await q1<any>("select vehicle_type from vehicles where driver_id=$1 order by created_at desc limit 1", [req.auth!.id]);
    const reqRow = veh ? await q1<any>('select requires_expiry from document_requirements where vehicle_type=$1 and doc_type=$2', [veh.vehicle_type, body.doc_type]) : null;
    if (reqRow?.requires_expiry && !body.expiry_date) throw badRequest('expiry_required', 'This document needs an expiry date');
    if (body.expiry_date && new Date(body.expiry_date) < new Date(new Date().toISOString().slice(0, 10))) throw badRequest('already_expired', 'This document has already expired');
    const saved = await saveFile(buf, body.doc_type === 'profile_photo' ? 'photos' : 'docs');
    const d = await q1<any>(`insert into driver_documents(driver_id, doc_type, file_key, mime, size, expiry_date) values ($1,$2,$3,$4,$5,$6) returning id, doc_type, review_status, expiry_date`,
      [req.auth!.id, body.doc_type, saved.key, saved.mime, saved.size, body.expiry_date ?? null]);
    if (body.doc_type === 'profile_photo') await q('update users set photo_key=$2 where id=$1', [req.auth!.id, saved.key]);
    return d;
  });

  app.get('/drivers/me/status', drv, async (req) => {
    const id = req.auth!.id;
    const dp = await q1<any>('select status, status_reason, is_online, zone_id, rating_avg, rating_count, completed_count, cancel_count, accepted_count, payout_msisdn, legal_name, fleet_id from driver_profiles where user_id=$1', [id]);
    const veh = await q1<any>('select id, vehicle_type, make, model, color, plate, capacity, status from vehicles where driver_id=$1 order by (status=\'approved\') desc, created_at desc limit 1', [id]);
    const docs = await q('select id, doc_type, review_status, review_note, expiry_date, created_at from driver_documents where driver_id=$1 and not superseded order by created_at desc', [id]);
    const reqs = veh ? await q('select doc_type, mandatory, requires_expiry from document_requirements where vehicle_type=$1', [veh.vehicle_type]) : [];
    const invites = await q("select fi.id, f.name from fleet_invites fi join fleets f on f.id=fi.fleet_id join users u on u.phone=fi.phone where u.id=$1 and fi.status='pending'", [id]);
    return { profile: dp, vehicle: veh, documents: docs, requirements: reqs, permission: await Dr.driverPermission(id), fleet_invites: invites };
  });

  app.post('/drivers/applications/submit', drv, async (req) => {
    const id = req.auth!.id;
    await tx(async (c) => {
      const veh = await q1<any>("select vehicle_type from vehicles where driver_id=$1 and status in ('pending','approved') limit 1", [id], c);
      const dp = await q1<any>('select legal_name, national_id_enc from driver_profiles where user_id=$1', [id], c);
      if (!veh || !dp?.legal_name || !dp.national_id_enc) throw badRequest('application_incomplete', 'Complete your profile and vehicle details first');
      const missing = await q<any>(`select r.doc_type from document_requirements r where r.vehicle_type=$1 and r.mandatory and not exists (
        select 1 from driver_documents d where d.driver_id=$2 and d.doc_type=r.doc_type and not d.superseded and d.review_status in ('pending','approved'))`, [veh.vehicle_type, id], c);
      if (missing.length) throw badRequest('documents_missing', 'Upload all required documents', missing.map((m: any) => m.doc_type));
      await q("update driver_profiles set submitted_at=now() where user_id=$1", [id], c);
      await Dr.setDriverStatus(c, id, 'DOCUMENTS_SUBMITTED', { id, role: 'driver' });
    });
    return { ok: true, status: 'DOCUMENTS_SUBMITTED' };
  });

  app.post('/drivers/me/fleet/accept', drv, async (req) => {
    const b = parse(z.object({ invite_id: z.string().uuid() }), req.body);
    return tx(async (c) => {
      const inv = await q1<any>("select fi.* from fleet_invites fi join users u on u.phone=fi.phone where fi.id=$1 and u.id=$2 and fi.status='pending' for update", [b.invite_id, req.auth!.id], c);
      if (!inv) throw notFound('invite');
      await q("update fleet_invites set status='accepted' where id=$1", [inv.id], c);
      await q('update driver_profiles set fleet_id=$2 where user_id=$1', [req.auth!.id, inv.fleet_id], c);
      await q('update vehicles set fleet_id=$2 where driver_id=$1', [req.auth!.id, inv.fleet_id], c);
      return { ok: true };
    });
  });

  app.patch('/drivers/me/availability', drv, async (req) => {
    const b = parse(z.object({ online: z.boolean() }), req.body);
    await Dr.setOnline(req.auth!.id, b.online);
    return { online: b.online, permission: await Dr.driverPermission(req.auth!.id) };
  });
  app.post('/drivers/me/location', drv, async (req) => {
    const b = parse(z.object({ lat, lng, accuracy: z.number().min(0).optional(), speed: z.number().min(0).optional(), recorded_at: z.string().datetime().optional() }), req.body);
    return Dr.updateLocation(req.auth!.id, b);
  });
  app.patch('/drivers/me/payout-account', drv, async (req) => {
    const b = parse(z.object({ msisdn: z.string(), provider: z.enum(['mtn_momo', 'airtel_money']).default('mtn_momo') }), req.body);
    const m = normalizePhone(b.msisdn); if (!m) throw badRequest('invalid_phone');
    await q('update driver_profiles set payout_msisdn=$2, payout_provider=$3 where user_id=$1', [req.auth!.id, m, b.provider]);
    await audit(actorOf(req), 'driver.payout_account_changed', 'driver', req.auth!.id);
    return { ok: true };
  });

  // earnings
  app.get('/drivers/me/earnings', drv, async (req) => {
    const b = parse(z.object({ period: z.enum(['day', 'week', 'month']).default('day') }), req.query);
    const trunc = b.period;
    const since = trunc === 'day' ? "date_trunc('day', now() at time zone 'Africa/Kigali')" : trunc === 'week' ? "date_trunc('week', now() at time zone 'Africa/Kigali')" : "date_trunc('month', now() at time zone 'Africa/Kigali')";
    const t = await q1<any>(`select count(*)::int trips, coalesce(sum(fare_subtotal+tax-discount),0)::int total_fares, coalesce(sum(commission),0)::int commission, coalesce(sum(net),0)::int net,
        coalesce(sum(fare_subtotal+tax-discount) filter (where payment_method='cash'),0)::int cash_collected,
        coalesce(sum(fare_subtotal+tax-discount) filter (where payment_method in ('mtn_momo','airtel_money')),0)::int mobile_money_collected,
        coalesce(sum(discount),0)::int platform_funded_discounts
      from driver_earnings where driver_id=$1 and (created_at at time zone 'Africa/Kigali') >= ${since}`, [req.auth!.id]);
    const daily = await q(`select to_char(created_at at time zone 'Africa/Kigali','YYYY-MM-DD') day, count(*)::int trips, sum(net)::int net, sum(commission)::int commission
      from driver_earnings where driver_id=$1 and created_at > now() - interval '31 days' group by 1 order by 1 desc`, [req.auth!.id]);
    const dp = await q1<any>('select completed_count, cancel_count, accepted_count, rating_avg from driver_profiles where user_id=$1', [req.auth!.id]);
    return { period: b.period, ...t, daily, completed_trips: dp.completed_count, cancellations: dp.cancel_count, rating: Number(dp.rating_avg), balance: await driverBalance(req.auth!.id) };
  });
  app.get('/drivers/me/wallet', drv, async (req) => ({
    balance: await driverBalance(req.auth!.id),
    transactions: await q(`select e.id, e.account_code, e.debit, e.credit, e.memo, e.created_at from ledger_entries e where e.owner_user_id=$1 and e.account_code in ('DRIVER_PAYABLE','CASH_WITH_DRIVERS') order by e.id desc limit 100`, [req.auth!.id]),
  }));
  app.get('/drivers/me/payouts', drv, async (req) => ({ payouts: await q('select id, amount, fee, status, requested_at, paid_at from payouts where owner_user_id=$1 order by requested_at desc limit 50', [req.auth!.id]) }));
  app.post('/drivers/me/payouts', drv, async (req) => {
    const b = parse(z.object({ amount: z.number().int().positive() }), req.body);
    return requestPayout(req.auth!.id, b.amount, 'driver');
  });

  // signed private file access (links minted only for authorised staff)
  app.get('/files/*', async (req, reply) => {
    const key = (req.params as any)['*'] as string;
    const token = String((req.query as any).token ?? '');
    if (!verifyFileToken(key, token)) throw forbidden('link expired or invalid');
    const buf = await readFileByKey(key);
    reply.header('content-type', key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.png') ? 'image/png' : 'image/jpeg');
    reply.header('cache-control', 'private, no-store');
    reply.header('content-disposition', 'inline');
    return reply.send(buf);
  });
}

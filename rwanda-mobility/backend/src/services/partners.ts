// Venue partners: restricted staff role (partner_manager) bound to ONE partner through partner_users; request codes linked to a partner;
// optional billing of rides requested from a code to the partner, through the corporate invoice engine (hidden corporate account per partner).
import type { PoolClient } from 'pg';
import { q, q1, tx } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { getSetting } from './settings.js';
import { findUsable } from './requestCodes.js';
import { audit, type Actor } from './audit.js';

/** The partner of a signed-in partner manager. The ONLY way a portal request learns which partner it may see. */
export async function partnerOfUser(userId: string) {
  const p = await q1<any>('select p.* from partner_users pu join partners p on p.id=pu.partner_id where pu.user_id=$1', [userId]);
  if (!p) throw new AppError(403, 'no_partner', 'This account is not linked to a partner');
  return p;
}
export async function activePartnerOfUser(userId: string) {
  const p = await partnerOfUser(userId);
  if (p.status === 'suspended') throw new AppError(403, 'partner_suspended', 'This partner account is suspended');
  return p;
}

export async function createPartner(actor: Actor, b: { name: string; contact_name?: string; contact_phone?: string; contact_email?: string; billing_terms?: Record<string, unknown>; status?: 'pending' | 'active' }) {
  try {
    return await tx(async (c) => {
      const status = b.status ?? 'active';
      const p = (await q<any>('insert into partners(name,contact_name,contact_phone,contact_email,status,billing_terms,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *',
        [b.name, b.contact_name ?? null, b.contact_phone ?? null, b.contact_email ?? null, status, JSON.stringify(b.billing_terms ?? {}), actor.id], c))[0];
      const corp = await q1<any>("insert into corporate_accounts(legal_name, status, billing_mode, partner_id, created_by) values ($1,$2,'payg',$3,$4) returning id",
        [`${b.name} (venue partner)`, status === 'active' ? 'active' : 'pending', p.id, actor.id], c);
      await q('update partners set corporate_id=$2 where id=$1', [p.id, corp!.id], c);
      await audit(actor, 'partner.created', 'partner', p.id, undefined, { name: b.name, status }, c);
      return { ...p, corporate_id: corp!.id };
    });
  } catch (e: any) { if (e.code === '23505') throw conflict('partner_exists', 'A partner with this name already exists'); throw e; }
}
export async function updatePartner(actor: Actor, id: string, b: Record<string, any>) {
  const cur = await q1<any>('select * from partners where id=$1', [id]);
  if (!cur) throw notFound('partner');
  const n = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
  await tx(async (c) => {
    await q('update partners set name=$2,contact_name=$3,contact_phone=$4,contact_email=$5,status=$6,billing_terms=$7,updated_at=now() where id=$1',
      [id, n.name, n.contact_name, n.contact_phone, n.contact_email, n.status, JSON.stringify(n.billing_terms ?? {})], c);
    if (cur.corporate_id) await q('update corporate_accounts set status=$2 where id=$1', [cur.corporate_id, n.status === 'active' ? 'active' : 'suspended'], c);
    await audit(actor, 'partner.updated', 'partner', id, { status: cur.status, billing_terms: cur.billing_terms }, { status: n.status, billing_terms: n.billing_terms }, c);
  });
  return q1<any>('select * from partners where id=$1', [id]);
}

export async function linkCode(actor: Actor, partnerId: string, codeId: string, billToPartner: boolean) {
  const p = await q1<any>('select name, corporate_id from partners where id=$1', [partnerId]);
  if (!p) throw notFound('partner');
  const code = await q1<any>('select id, partner_id from request_codes where id=$1', [codeId]);
  if (!code) throw notFound('request code');
  if (code.partner_id && code.partner_id !== partnerId) throw conflict('code_linked_elsewhere', 'This code already belongs to another partner');
  await q('update request_codes set partner_id=$2, bill_to_partner=$3, partner_name=$4, updated_at=now() where id=$1', [codeId, partnerId, billToPartner, p.name]);
  await audit(actor, 'partner.code_linked', 'partner', partnerId, undefined, { code_id: codeId, bill_to_partner: billToPartner });
}
export async function unlinkCode(actor: Actor, partnerId: string, codeId: string) {
  const r = await q1("update request_codes set partner_id=null, bill_to_partner=false, updated_at=now() where id=$1 and partner_id=$2 returning id", [codeId, partnerId]);
  if (!r) throw notFound('request code');
  await audit(actor, 'partner.code_unlinked', 'partner', partnerId, undefined, { code_id: codeId });
}

// ---------- billing a ride to the partner ----------
/** At booking time: the code must be usable, linked to an active partner with billing switched on. */
export async function resolvePartnerBilling(userId: string, rawCode?: string) {
  const code = rawCode ? await findUsable(rawCode) : null;
  if (!code || !(code as any).partner_id || !(code as any).bill_to_partner) throw badRequest('partner_billing_unavailable', 'This code cannot be charged to a venue partner');
  const p = await q1<any>('select p.id, p.status, p.corporate_id, c.status corp_status from partners p join corporate_accounts c on c.id=p.corporate_id where p.id=$1', [(code as any).partner_id]);
  if (!p || p.status !== 'active' || p.corp_status !== 'active') throw badRequest('partner_billing_unavailable', 'This code cannot be charged to a venue partner');
  return { partner_id: p.id as string, corporate_id: p.corporate_id as string };
}
/** Inside the booking transaction, once the fare is known: per-ride cap, monthly cap, per-person daily cap. Serialised per partner. */
export async function assertPartnerBillable(c: PoolClient, partnerId: string, userId: string, fare: number) {
  await q('select pg_advisory_xact_lock(hashtext($1))', ['partner:' + partnerId], c);
  const p = (await q1<any>('select billing_terms from partners where id=$1', [partnerId], c))!;
  const t = p.billing_terms ?? {};
  if (t.max_fare && fare > t.max_fare) throw new AppError(403, 'partner_max_fare', `Fare exceeds the venue limit of ${t.max_fare} RWF`, { max: t.max_fare });
  const perDay = await getSetting('partner.max_billed_per_user_per_day');
  const d = await q1<any>("select count(*)::int n from bookings where passenger_id=$1 and partner_billed and created_at > now() - interval '1 day' and status not in ('CANCELLED_BY_PASSENGER','CANCELLED_BY_SYSTEM','CANCELLED_BY_DRIVER','NO_DRIVER_FOUND')", [userId], c);
  if (d.n >= perDay) throw new AppError(403, 'partner_daily_limit', 'Daily limit of rides charged to venues reached', { max: perDay });
  if (t.monthly_cap) {
    const m = await q1<any>(`select coalesce(sum(coalesce(final_fare, estimated_fare)),0)::int s from bookings where partner_id=$1 and partner_billed
      and status not in ('CANCELLED_BY_PASSENGER','CANCELLED_BY_SYSTEM','CANCELLED_BY_DRIVER','NO_DRIVER_FOUND') and to_char(created_at at time zone 'Africa/Kigali','YYYY-MM') = to_char(now() at time zone 'Africa/Kigali','YYYY-MM')`, [partnerId], c);
    if (m.s + fare > t.monthly_cap) throw new AppError(403, 'partner_cap_reached', 'The venue monthly limit has been reached', { max: t.monthly_cap });
  }
}

// ---------- reporting (every query is bound to the partner id the CALLER resolved from the session) ----------
const DONE = "('PAYMENT_COMPLETED','PARTIALLY_REFUNDED')";
export const partnerCodes = (partnerId: string) => q(
  `select rc.id, rc.code, rc.label, rc.active, rc.bill_to_partner, rc.scans, rc.expires_at,
          (select count(*)::int from bookings b where b.request_code_id=rc.id) requests
     from request_codes rc where rc.partner_id=$1 order by rc.created_at desc`, [partnerId]);
/** Requests/trips from the partner's codes. No rider or guest identity, no phone numbers, no driver details. */
export const partnerRequests = (partnerId: string, limit = 100, before?: string) => q(
  `select b.ref, b.status, b.created_at, b.service_id, b.pickup_name, b.dest_name, coalesce(b.final_fare, b.estimated_fare) fare, b.partner_billed billed_to_partner, rc.label code_label, rc.code
     from bookings b join request_codes rc on rc.id=b.request_code_id
    where b.partner_id=$1 and ($3::timestamptz is null or b.created_at < $3) order by b.created_at desc limit $2`, [partnerId, limit, before ?? null]);
export async function partnerStatement(partnerId: string, month: string) {
  const trips = await q<any>(
    `select b.ref, b.completed_at, b.pickup_name, b.dest_name, b.final_fare, b.status, rc.label code_label, b.partner_billed billed_to_partner
       from bookings b join request_codes rc on rc.id=b.request_code_id
      where b.partner_id=$1 and b.status in ${DONE} and to_char(b.completed_at at time zone 'Africa/Kigali','YYYY-MM')=$2 order by b.completed_at`, [partnerId, month]);
  const billed = trips.filter((t) => t.billed_to_partner);
  const funnel = await q1<any>(`select count(*)::int requests, count(*) filter (where status in ${DONE} or status in ('COMPLETED','PAYMENT_PENDING'))::int completed
       from bookings where partner_id=$1 and to_char(created_at at time zone 'Africa/Kigali','YYYY-MM')=$2`, [partnerId, month]);
  const inv = await q1<any>(`select i.* from corporate_invoices i join partners p on p.corporate_id=i.corporate_id where p.id=$1 and to_char(i.period_start,'YYYY-MM')=$2`, [partnerId, month]);
  return { month, currency: 'RWF', requests: funnel.requests, completed_trips: funnel.completed, billed_trip_count: billed.length, billed_total: billed.reduce((s, t) => s + t.final_fare, 0), trips, invoice: inv ?? null };
}
/** Monthly invoice through the existing corporate invoice table (unique per period): only partner-billed completed trips. */
export async function invoicePartner(actor: Actor, partnerId: string, month: string) {
  const p = await q1<any>('select corporate_id from partners where id=$1', [partnerId]);
  if (!p) throw notFound('partner');
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`, end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const t = (await q1<any>(`select count(*)::int n, coalesce(sum(final_fare),0)::bigint s from bookings where partner_id=$1 and partner_billed and status in ${DONE} and to_char(completed_at at time zone 'Africa/Kigali','YYYY-MM')=$2`, [partnerId, month]))!;
  if (!t.n) throw conflict('nothing_to_invoice', 'No completed trips in that month');
  try {
    const inv = await q1<any>('insert into corporate_invoices(corporate_id, period_start, period_end, total_amount, trip_count) values ($1,$2,$3,$4,$5) returning *', [p.corporate_id, start, end, t.s, t.n]);
    await audit(actor, 'invoice.issued', 'corporate_invoice', inv.id, undefined, { partner_id: partnerId, ...inv });
    return inv;
  } catch (e: any) { if (e.code === '23505') throw conflict('already_invoiced', 'Invoice for this period already exists'); throw e; }
}
void forbidden;

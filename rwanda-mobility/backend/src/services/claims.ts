import type { PoolClient } from 'pg';
import { q, q1, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { getSetting } from './settings.js';
import { saveFile } from './storage.js';
import { signFileToken } from '../util/crypto.js';
import { refOf } from '../util/ids.js';
import { audit, type Actor } from './audit.js';
import { notify } from './notify.js';
import { post } from './ledger.js';
import { grantCredit } from './credit.js';
import { PUSH_EVENTS } from './notify.js';
import { can } from '../rbac.js';

/**
 * Damage / loss / injury claims. Parties (booking passenger/owner and driver) and staff only.
 * Status machine: submitted -> under_review <-> info_requested -> accepted | partially_accepted | rejected -> settled -> closed (withdrawn by the claimant before a decision).
 * Settlement is either customer credit (CLAIMS_EXPENSE -> WALLET_CREDIT) or a manual payout RECORD (the transfer itself is made outside the platform).
 * Insurer fields are for a future partnership: nothing is sent to any insurer (PENDING INTEGRATION).
 */
export type ClaimStatus = 'submitted' | 'under_review' | 'info_requested' | 'accepted' | 'partially_accepted' | 'rejected' | 'settled' | 'closed' | 'withdrawn';
export const CLAIM_TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
  submitted: ['under_review', 'info_requested', 'withdrawn'],
  under_review: ['info_requested', 'accepted', 'partially_accepted', 'rejected', 'withdrawn'],
  info_requested: ['under_review', 'withdrawn'],
  accepted: ['settled'], partially_accepted: ['settled'], rejected: ['closed'], settled: ['closed'], closed: [], withdrawn: [],
};
const OPEN: ClaimStatus[] = ['submitted', 'under_review', 'info_requested'];
for (const k of ['claim_received', 'claim_info_requested', 'claim_accepted', 'claim_partially_accepted', 'claim_rejected', 'claim_settled', 'claim_reply_added']) PUSH_EVENTS.add(k);

const ev = (c: PoolClient, claimId: string, author: { id: string | null; role: string }, kind: string, body: string | null, o: { visibility?: 'public' | 'internal'; meta?: any } = {}) =>
  q('insert into claim_events(claim_id, author_id, author_role, kind, visibility, body, meta) values ($1,$2,$3,$4,$5,$6,$7)', [claimId, author.id, author.role, kind, o.visibility ?? 'public', body, JSON.stringify(o.meta ?? {})], c);

async function move(c: PoolClient, cl: any, to: ClaimStatus, author: { id: string | null; role: string }, note?: string, patch = '') {
  if (!CLAIM_TRANSITIONS[cl.status as ClaimStatus]?.includes(to)) throw conflict('claim_transition', `Claim is ${cl.status}`);
  const row = (await q<any>(`update claims set status=$2, updated_at=now()${patch} where id=$1 returning *`, [cl.id, to], c))[0];
  await ev(c, cl.id, author, 'status', note ?? null, { meta: { from: cl.status, to } });
  return row;
}

// ---------------- filing ----------------
export async function fileClaim(userId: string, bookingId: string, inp: { type: 'damage' | 'loss' | 'injury' | 'other'; description: string; claimed_amount?: number }) {
  const [window, slaH, replyH] = await Promise.all([getSetting('claims.filing_window_hours'), getSetting('claims.sla_hours'), getSetting('claims.reply_hours')]);
  const out = await tx(async (c) => {
    const b = await q1<any>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b || (b.passenger_id !== userId && b.driver_id !== userId)) throw notFound('booking');
    if (!b.started_at && !b.completed_at) throw badRequest('invalid_state', 'A claim can only be filed once the trip has started');
    const end = b.completed_at ?? b.cancelled_at ?? null;
    if (end && Date.now() - new Date(end).getTime() > window * 3600_000) throw conflict('claim_window_closed', 'The filing period is over', { hours: window });
    const mine = b.driver_id === userId ? 'driver' : b.hire_mode ? 'owner' : 'passenger';
    const other = mine === 'driver' ? (b.hire_mode ? 'owner' : 'passenger') : 'driver';
    const respondent = mine === 'driver' ? b.passenger_id : b.driver_id;
    let cl: any;
    try {
      cl = (await q<any>(`insert into claims(ref, booking_id, claim_type, filed_by, filer_role, respondent_id, respondent_role, description, claimed_amount, sla_due_at, reply_due_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + make_interval(hours => $10), case when $6::uuid is null then null else now() + make_interval(hours => $11) end) returning *`,
        [refOf('CL'), bookingId, inp.type, userId, mine, respondent, respondent ? other : null, inp.description.trim(), inp.claimed_amount ?? 0, slaH, replyH], c))[0];
    } catch (e: any) { if (e.code === '23505') throw conflict('claim_exists', 'You already have an open claim of this type for this trip'); throw e; }
    await ev(c, cl.id, { id: userId, role: mine }, 'filed', inp.description.trim(), { meta: { type: inp.type, claimed_amount: inp.claimed_amount ?? 0 } });
    if (b.hire_mode)   // before / after photos from the car check-in and check-out become evidence automatically
      await q(`insert into claim_evidence(claim_id, uploaded_by, source, handover_phase, file_key) select $1, uploaded_by, 'handover', phase, file_key from handover_photos where booking_id=$2 on conflict do nothing`, [cl.id, bookingId], c);
    await notify(userId, 'claim_filed', { ref: cl.ref, hours: slaH }, { db: c });
    if (respondent) await notify(respondent, 'claim_received', { ref: cl.ref, hours: replyH }, { db: c });
    return cl;
  });
  return out;
}

// ---------------- reading ----------------
const link = (k: string) => `/api/v1/files/${k}?token=${signFileToken(k, 300)}`;
async function partsOf(cl: any, staff: boolean) {
  const events = await q<any>(`select e.id, e.author_role, e.kind, e.visibility, e.body, e.meta, e.created_at, ${staff ? 'e.author_id, u.display_name author_name' : 'null::uuid author_id, null author_name'}
    from claim_events e left join users u on u.id=e.author_id where e.claim_id=$1 ${staff ? '' : "and e.visibility='public'"} order by e.id`, [cl.id]);
  const evidence = await q<any>('select id, source, handover_phase, file_key, caption, uploaded_by, created_at from claim_evidence where claim_id=$1 order by created_at, id', [cl.id]);
  const b = await q1<any>('select ref, hire_mode, status, pickup_name, dest_name, completed_at, customer_vehicle_id from bookings where id=$1', [cl.booking_id]);
  let comparison: any = null;
  if (b?.hire_mode) {
    const hs = await q<any>('select phase, odometer_km, fuel_percent, notes, damage_noted, owner_response, owner_note, created_at from abasare_handovers where booking_id=$1', [cl.booking_id]);
    const side = (ph: string) => ({ record: hs.find((h) => h.phase === ph) ?? null, photos: evidence.filter((e) => e.source === 'handover' && e.handover_phase === ph).map((e) => link(e.file_key)) });
    comparison = { pickup: side('pickup'), dropoff: side('dropoff') };
  }
  return { events, evidence: evidence.map((e) => ({ id: e.id, source: e.source, phase: e.handover_phase, caption: e.caption, at: e.created_at, url: link(e.file_key) })), booking: b && { ref: b.ref, pickup: b.pickup_name, destination: b.dest_name, completed_at: b.completed_at, abasare: !!b.hire_mode }, comparison };
}
const brief = (cl: any, userId: string) => ({
  id: cl.id, ref: cl.ref, booking_id: cl.booking_id, type: cl.claim_type, status: cl.status, claimed_amount: cl.claimed_amount, description: cl.description,
  you_are: cl.filed_by === userId ? 'claimant' : 'respondent', claimant_role: cl.filer_role, respondent_role: cl.respondent_role,
  reply_due_at: cl.respondent_id === userId || cl.filed_by === userId ? cl.reply_due_at : null, replied: !!cl.replied_at, info_due_at: cl.info_due_at,
  decision: ['accepted', 'partially_accepted', 'rejected', 'settled', 'closed'].includes(cl.status) && cl.decided_at ? { amount: cl.decision_amount, reason: cl.decision_reason, at: cl.decided_at } : null,
  settlement: cl.settlement_status === 'done' ? { kind: cl.settlement_kind, amount: cl.settlement_amount, at: cl.settled_at } : null,
  created_at: cl.created_at, updated_at: cl.updated_at,
});
export async function myClaims(userId: string) {
  const rows = await q<any>('select * from claims where filed_by=$1 or respondent_id=$1 order by created_at desc limit 100', [userId]);
  return rows.map((r) => brief(r, userId));
}
async function partyClaim(userId: string, id: string) {
  const cl = await q1<any>('select * from claims where id=$1', [id]);
  if (!cl || (cl.filed_by !== userId && cl.respondent_id !== userId)) throw notFound('claim');   // privacy: strangers cannot tell a claim exists
  return cl;
}
export async function claimForParty(userId: string, id: string) {
  const cl = await partyClaim(userId, id);
  return { ...brief(cl, userId), ...(await partsOf(cl, false)) };
}
export async function claimForStaff(id: string) {
  const cl = await q1<any>(`select c.*, f.display_name filer_name, f.phone filer_phone, r.display_name respondent_name, a.display_name assigned_name from claims c join users f on f.id=c.filed_by
    left join users r on r.id=c.respondent_id left join users a on a.id=c.assigned_to where c.id=$1`, [id]);
  if (!cl) throw notFound('claim');
  return { ...cl, sla_overdue: OPEN.includes(cl.status) && cl.status === 'submitted' && new Date(cl.sla_due_at) < new Date(), ...(await partsOf(cl, true)) };
}
export async function listClaims(f: { status?: string; type?: string; assigned?: string; overdue?: boolean; q?: string; limit: number }, staffId: string) {
  return q<any>(`select c.id, c.ref, c.claim_type, c.status, c.claimed_amount, c.decision_amount, c.filer_role, c.assigned_to, a.display_name assigned_name, c.sla_due_at, c.created_at, c.settlement_status, c.insurer_status, b.ref booking_ref,
      (c.status = 'submitted' and c.sla_due_at < now()) sla_overdue
    from claims c join bookings b on b.id=c.booking_id left join users a on a.id=c.assigned_to
    where ($1::text is null or c.status=$1) and ($2::text is null or c.claim_type=$2)
      and ($3::text is null or ($3='me' and c.assigned_to=$5) or ($3='unassigned' and c.assigned_to is null))
      and (not $4 or (c.status = 'submitted' and c.sla_due_at < now())) and ($6::text is null or c.ref ilike $6 or b.ref ilike $6)
    order by (c.status in ('submitted','under_review','info_requested')) desc, c.sla_due_at asc limit 200`,
    [f.status ?? null, f.type ?? null, f.assigned ?? null, !!f.overdue, staffId, f.q ? `%${f.q}%` : null]);
}

// ---------------- party actions ----------------
export async function postMessage(userId: string, id: string, body: string) {
  const info = await tx(async (c) => {
    const cl = await q1<any>('select * from claims where id=$1 for update', [id], c);
    if (!cl || (cl.filed_by !== userId && cl.respondent_id !== userId)) throw notFound('claim');
    if (!OPEN.includes(cl.status)) throw conflict('claim_closed', 'This claim can no longer receive messages');
    const claimant = cl.filed_by === userId;
    await ev(c, id, { id: userId, role: claimant ? cl.filer_role : cl.respondent_role }, claimant ? 'message' : 'reply', body.trim());
    if (!claimant) {
      if (!cl.replied_at) await q('update claims set replied_at=now(), updated_at=now() where id=$1', [id], c);
      await notify(cl.filed_by, 'claim_reply_added', { ref: cl.ref }, { db: c });
    } else if (cl.status === 'info_requested') await move(c, cl, 'under_review', { id: userId, role: cl.filer_role }, 'Information provided', ', info_due_at=null');
    return cl;
  });
  return { ok: true, ref: info.ref };
}
export async function addEvidence(who: { id: string; staff?: boolean }, id: string, buf: Buffer, caption?: string) {
  const cl = await q1<any>('select * from claims where id=$1', [id]);
  if (!cl || (!who.staff && cl.filed_by !== who.id && cl.respondent_id !== who.id)) throw notFound('claim');
  if (!OPEN.includes(cl.status)) throw conflict('claim_closed', 'This claim can no longer receive evidence');
  const max = await getSetting('claims.max_evidence');
  const n = await q1<any>("select count(*)::int n from claim_evidence where claim_id=$1 and source='upload'", [id]);
  if (n.n >= max) throw conflict('too_many_evidence', 'Too many files', { max });
  const f = await saveFile(buf, 'evidence');   // same scanner and private storage as the Abasare handover photos
  return tx(async (c) => {
    const e = (await q<any>("insert into claim_evidence(claim_id, uploaded_by, source, file_key, caption) values ($1,$2,'upload',$3,$4) returning id", [id, who.id, f.key, caption?.slice(0, 200) ?? null], c))[0];
    await ev(c, id, { id: who.id, role: who.staff ? 'staff' : who.id === cl.filed_by ? cl.filer_role : cl.respondent_role }, 'evidence', caption?.slice(0, 200) ?? null, { meta: { evidence_id: e.id } });
    return { ok: true, evidence_id: e.id };
  });
}
export async function withdrawClaim(userId: string, id: string) {
  return tx(async (c) => {
    const cl = await q1<any>('select * from claims where id=$1 for update', [id], c);
    if (!cl || cl.filed_by !== userId) throw notFound('claim');
    const r = await move(c, cl, 'withdrawn', { id: userId, role: cl.filer_role }, 'Withdrawn by the claimant', ', closed_at=now()');
    return brief(r, userId);
  });
}

// ---------------- staff actions ----------------
const staffAuthor = (s: Actor) => ({ id: s.id, role: 'staff' });
export async function assignClaim(staff: Actor, id: string, assigneeId: string | null) {
  return tx(async (c) => {
    const cl = await q1<any>('select * from claims where id=$1 for update', [id], c);
    if (!cl) throw notFound('claim');
    if (assigneeId) {
      const roles = (await q<any>('select role from user_roles where user_id=$1', [assigneeId], c)).map((r) => r.role);
      if (!can(roles, 'claims.handle')) throw badRequest('invalid_assignee', 'That person cannot handle claims');
    }
    await q('update claims set assigned_to=$2, updated_at=now() where id=$1', [id, assigneeId], c);
    await ev(c, id, staffAuthor(staff), 'assignment', null, { visibility: 'internal', meta: { assigned_to: assigneeId } });
    await audit(staff, 'claim.assigned', 'claim', id, { assigned_to: cl.assigned_to }, { assigned_to: assigneeId }, c);
    return { ok: true };
  });
}
export async function internalNote(staff: Actor, id: string, body: string) {
  const cl = await q1<any>('select id from claims where id=$1', [id]);
  if (!cl) throw notFound('claim');
  await tx(async (c) => { await ev(c, id, staffAuthor(staff), 'internal_note', body.trim(), { visibility: 'internal' }); });
  return { ok: true };
}
/** Start the review, or ask the claimant for more information. */
export async function reviewClaim(staff: Actor, id: string, action: 'start' | 'request_info', message?: string) {
  const hrs = await getSetting('claims.info_reply_hours');
  return tx(async (c) => {
    const cl = await q1<any>('select * from claims where id=$1 for update', [id], c);
    if (!cl) throw notFound('claim');
    if (action === 'start') {
      const r = await move(c, cl, 'under_review', staffAuthor(staff), 'Review started');
      if (!cl.assigned_to) await q('update claims set assigned_to=$2 where id=$1', [id, staff.id], c);
      await audit(staff, 'claim.review_started', 'claim', id, undefined, undefined, c);
      return r;
    }
    if (!message || message.trim().length < 5) throw badRequest('reason_required', 'Say what information is needed');
    const r = await move(c, cl, 'info_requested', staffAuthor(staff), 'Information requested', ', info_due_at = now() + interval \'1 hour\' * ' + Number(hrs) + ', info_reminded_at=null');
    await ev(c, id, staffAuthor(staff), 'info_request', message.trim());
    await notify(cl.filed_by, 'claim_info_requested', { ref: cl.ref }, { db: c });
    await audit(staff, 'claim.info_requested', 'claim', id, undefined, { message }, c);
    return r;
  });
}
export async function decideClaim(staff: Actor, id: string, d: { outcome: 'accepted' | 'partially_accepted' | 'rejected'; amount?: number; reason: string; skip_reply_window?: boolean }) {
  if (!d.reason || d.reason.trim().length < 10) throw badRequest('reason_required', 'Give a reason of at least 10 characters');
  const done = await tx(async (c) => {
    let cl = await q1<any>('select * from claims where id=$1 for update', [id], c);
    if (!cl) throw notFound('claim');
    if (cl.status === 'submitted') cl = await move(c, cl, 'under_review', staffAuthor(staff), 'Review started');
    if (cl.status !== 'under_review') throw conflict('claim_transition', `Claim is ${cl.status}`);
    if (cl.respondent_id && !cl.replied_at && cl.reply_due_at && new Date(cl.reply_due_at) > new Date() && !d.skip_reply_window) throw conflict('reply_window_open', 'The other party can still reply');
    let amount = 0;
    if (d.outcome !== 'rejected') {
      amount = d.amount ?? (d.outcome === 'accepted' ? cl.claimed_amount : 0);
      if (!Number.isInteger(amount) || amount <= 0) throw badRequest('invalid_amount', 'Enter the amount granted');
      if (cl.claimed_amount > 0 && amount > cl.claimed_amount) throw badRequest('invalid_amount', 'More than claimed');
      if (d.outcome === 'accepted' && cl.claimed_amount > 0 && amount !== cl.claimed_amount) throw badRequest('invalid_amount', 'Use partially accepted for a lower amount');
      if (d.outcome === 'partially_accepted' && cl.claimed_amount > 0 && amount >= cl.claimed_amount) throw badRequest('invalid_amount', 'Use accepted for the full amount');
    }
    await move(c, cl, d.outcome, staffAuthor(staff), d.reason.trim());
    const r = (await q<any>('update claims set decision_amount=$2, decision_reason=$3, decided_by=$4, decided_at=now() where id=$1 returning *', [id, amount, d.reason.trim(), staff.id], c))[0];
    await ev(c, id, staffAuthor(staff), 'decision', d.reason.trim(), { meta: { outcome: d.outcome, amount, skipped_reply_window: !!d.skip_reply_window } });
    await audit(staff, 'claim.decided', 'claim', id, { status: cl.status }, { outcome: d.outcome, amount, reason: d.reason, skipped_reply_window: !!d.skip_reply_window }, c);
    const key = d.outcome === 'accepted' ? 'claim_accepted' : d.outcome === 'partially_accepted' ? 'claim_partially_accepted' : 'claim_rejected';
    await notify(cl.filed_by, key, { ref: cl.ref, amount }, { db: c });
    if (cl.respondent_id) await notify(cl.respondent_id, key, { ref: cl.ref, amount }, { db: c });
    return r;
  });
  return done;
}

async function executeSettlement(c: PoolClient, cl: any, by: string) {
  const amount = cl.settlement_amount as number;
  if (cl.settlement_kind === 'credit') {
    await grantCredit(c, cl.filed_by, amount, 'claim', { memo: `Claim ${cl.ref}`, refType: 'claim', refId: cl.id, idemKey: `claim:${cl.id}`, by, enforceCap: false, notifyUser: false });
  } else {
    await post(c, [{ account: 'CLAIMS_EXPENSE', debit: amount }, { account: 'PLATFORM_BANK', credit: amount }], { memo: `claim ${cl.ref} payout recorded (${cl.settlement_reference})` });
  }
  const r = await move(c, cl, 'settled', { id: by, role: 'staff' }, `Settled: ${amount} RWF (${cl.settlement_kind === 'credit' ? 'credit' : 'manual payout recorded'})`, ", settlement_status='done', settled_at=now()");
  await ev(c, cl.id, { id: by, role: 'staff' }, 'settlement', null, { meta: { kind: cl.settlement_kind, amount } });
  await notify(cl.filed_by, 'claim_settled', { ref: cl.ref, amount }, { db: c });
  return r;
}
export async function requestSettlement(staff: Actor, id: string, s: { kind: 'credit' | 'manual_payout'; amount?: number; reference?: string }) {
  const threshold = await getSetting('claims.settlement_approval_threshold');
  return tx(async (c) => {
    const cl = await q1<any>('select * from claims where id=$1 for update', [id], c);
    if (!cl) throw notFound('claim');
    if (!['accepted', 'partially_accepted'].includes(cl.status)) throw conflict('no_settlement_due', `Claim is ${cl.status}`);
    if (cl.settlement_status === 'pending_approval') throw conflict('settlement_pending', 'Waiting for approval');
    const amount = s.amount ?? cl.decision_amount;
    if (!Number.isInteger(amount) || amount <= 0) throw badRequest('invalid_amount');
    if (amount > cl.decision_amount) throw conflict('settlement_exceeds', 'More than the amount granted', { max: cl.decision_amount });
    if (s.kind === 'manual_payout' && (!s.reference || s.reference.trim().length < 3)) throw badRequest('reference_required', 'Enter the payment reference');
    const upd = (await q<any>(`update claims set settlement_kind=$2, settlement_amount=$3::int, settlement_reference=$4, settlement_requested_by=$5,
      settlement_status = case when $3::int >= $6::int then 'pending_approval' else 'none' end where id=$1 returning *`, [id, s.kind, amount, s.reference?.trim() ?? null, staff.id, threshold], c))[0];
    await audit(staff, 'claim.settlement_requested', 'claim', id, undefined, { kind: s.kind, amount, reference: s.reference }, c);
    if (amount >= threshold) { await ev(c, id, staffAuthor(staff), 'settlement', 'Waiting for a second approver', { visibility: 'internal', meta: { amount } }); return { ...brief(upd, staff.id!), needs_approval: true }; }
    const r = await executeSettlement(c, upd, staff.id!);
    await audit(staff, 'claim.settled', 'claim', id, undefined, { kind: s.kind, amount }, c);
    return { ...brief(r, staff.id!), needs_approval: false };
  });
}
export async function decideSettlement(approver: Actor, id: string, approve: boolean) {
  return tx(async (c) => {
    const cl = await q1<any>('select * from claims where id=$1 for update', [id], c);
    if (!cl) throw notFound('claim');
    if (cl.settlement_status !== 'pending_approval') throw conflict('no_settlement_due', 'Nothing waits for approval');
    if (cl.settlement_requested_by === approver.id) throw forbidden('Maker-checker: the requester cannot approve their own settlement');
    if (!approve) {
      await q("update claims set settlement_status='rejected', updated_at=now() where id=$1", [id], c);
      await ev(c, id, staffAuthor(approver), 'settlement', 'Settlement not approved', { visibility: 'internal' });
      await audit(approver, 'claim.settlement_rejected', 'claim', id, cl, undefined, c);
      return { ok: true, settled: false };
    }
    await q('update claims set settlement_approved_by=$2 where id=$1', [id, approver.id], c);
    await executeSettlement(c, { ...cl, settlement_approved_by: approver.id }, approver.id!);
    await audit(approver, 'claim.settled', 'claim', id, undefined, { kind: cl.settlement_kind, amount: cl.settlement_amount, requested_by: cl.settlement_requested_by }, c);
    return { ok: true, settled: true };
  });
}
export async function setInsurer(staff: Actor, id: string, f: { policy_ref?: string | null; insurer_claim_ref?: string | null; insurer_status?: string }) {
  return tx(async (c) => {
    const cl = await q1<any>('select * from claims where id=$1 for update', [id], c);
    if (!cl) throw notFound('claim');
    await q('update claims set policy_ref=coalesce($2,policy_ref), insurer_claim_ref=coalesce($3,insurer_claim_ref), insurer_status=coalesce($4,insurer_status), updated_at=now() where id=$1', [id, f.policy_ref ?? null, f.insurer_claim_ref ?? null, f.insurer_status ?? null], c);
    await ev(c, id, staffAuthor(staff), 'insurer', null, { visibility: 'internal', meta: f });
    await audit(staff, 'claim.insurer_updated', 'claim', id, { policy_ref: cl.policy_ref, insurer_claim_ref: cl.insurer_claim_ref, insurer_status: cl.insurer_status }, f, c);
    return { ok: true };
  });
}
export async function closeClaim(staff: Actor, id: string) {
  return tx(async (c) => {
    const cl = await q1<any>('select * from claims where id=$1 for update', [id], c);
    if (!cl) throw notFound('claim');
    const r = await move(c, cl, 'closed', staffAuthor(staff), 'Closed', ', closed_at=now()');
    await audit(staff, 'claim.closed', 'claim', id, undefined, undefined, c);
    return r;
  });
}

// ---------------- job ----------------
/** SLA warnings, reminders to the people who owe a reply, and automatic closing. Idempotent: each reminder is sent once per claim. */
export async function claimsSweep() {
  const [slaH, closeDays] = await Promise.all([getSetting('claims.sla_hours'), getSetting('claims.auto_close_days')]);
  let n = 0;
  const sla = await q<any>("select * from claims where status='submitted' and sla_warned_at is null and created_at + make_interval(secs => $1 * 3600 * 0.75) < now()", [slaH]);
  for (const cl of sla) {
    const staff = cl.assigned_to ? [{ user_id: cl.assigned_to }] : await q<any>("select distinct ur.user_id from user_roles ur where ur.role in ('support_lead','super_admin')");
    await tx(async (c) => {
      await q('update claims set sla_warned_at=now() where id=$1 and sla_warned_at is null', [cl.id], c);
      await ev(c, cl.id, { id: null, role: 'system' }, 'reminder', 'First-response target is close', { visibility: 'internal' });
      for (const s of staff) await notify(s.user_id, 'claim_sla_warning', { ref: cl.ref }, { db: c });
    });
    n++;
  }
  const rep = await q<any>("select * from claims where status in ('submitted','under_review','info_requested') and respondent_id is not null and replied_at is null and reply_reminded_at is null and reply_due_at is not null and reply_due_at - (reply_due_at - created_at) / 2 < now() and reply_due_at > now()");
  for (const cl of rep) { await q('update claims set reply_reminded_at=now() where id=$1', [cl.id]); await notify(cl.respondent_id, 'claim_reminder_reply', { ref: cl.ref }); n++; }
  const inf = await q<any>("select * from claims where status='info_requested' and info_reminded_at is null and info_due_at is not null and info_due_at - interval '24 hours' < now()");
  for (const cl of inf) { await q('update claims set info_reminded_at=now() where id=$1', [cl.id]); await notify(cl.filed_by, 'claim_reminder_info', { ref: cl.ref }); n++; }
  const old = await q<any>("select * from claims where (status='settled' and settled_at < now() - make_interval(days => $1)) or (status='rejected' and decided_at < now() - make_interval(days => $1))", [closeDays]);
  for (const cl of old) await tx(async (c) => { const row = await q1<any>('select * from claims where id=$1 for update', [cl.id], c); if (row && ['settled', 'rejected'].includes(row.status)) { await move(c, row, 'closed', { id: null, role: 'system' }, 'Closed automatically', ', closed_at=now()'); n++; } });
  return { actions: n };
}

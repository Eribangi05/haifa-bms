import { q, q1, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { encrypt } from '../util/crypto.js';
import { getSetting } from './settings.js';
import { saveFile } from './storage.js';
import { logEvent, type BookingRow } from './bookingMachine.js';
import { notify } from './notify.js';
import { refOf } from '../util/ids.js';
import { audit, type Actor } from './audit.js';
import { setDriverStatus } from './drivers.js';

export const CLASSES = ['car', 'suv', 'minivan', 'pickup', 'moto'] as const;
export const TRANSMISSIONS = ['manual', 'automatic'] as const;
export const RETURN_MODES = ['moto', 'taxi', 'own', 'walk'] as const;

export type ApplyIn = {
  legal_name: string; national_id: string; payout_msisdn?: string | null;
  licence_since: string; years_experience: number; transmissions: string[]; classes: string[]; return_mode: string;
};

/** A driver applies to drive customers' cars. Separate from (and optional alongside) ride-hailing with their own vehicle. */
export async function applyAbasare(userId: string, a: ApplyIn) {
  const minYears = await getSetting('abasare.min_licence_years');
  const since = new Date(a.licence_since);
  if (Number.isNaN(since.getTime()) || since > new Date()) throw badRequest('invalid_licence_date');
  const years = (Date.now() - since.getTime()) / (365.25 * 86400e3);
  if (years < minYears) throw badRequest('licence_too_new', `You need to have held a driving licence for at least ${minYears} years`);
  if (!a.transmissions.length || !a.classes.length) throw badRequest('skills_required');
  return tx(async (c) => {
    const dp = await q1<any>('select status, abasare_status from driver_profiles where user_id=$1 for update', [userId], c);
    if (!dp) throw notFound('driver profile');
    if (['pending', 'approved'].includes(dp.abasare_status) && dp.status !== 'INFO_REQUIRED') throw conflict('already_applied', `Abasare status is ${dp.abasare_status}`);
    if (['SUSPENDED', 'DEACTIVATED'].includes(dp.status) || dp.abasare_status === 'suspended') throw forbidden('Your account cannot apply right now');
    await q(`update driver_profiles set legal_name=$2, national_id_enc=$3, payout_msisdn=coalesce($4,payout_msisdn), abasare_status='pending', abasare_applied_at=now(),
             abasare_skills=$5 where user_id=$1`,
      [userId, a.legal_name, encrypt(a.national_id), a.payout_msisdn ?? null,
       JSON.stringify({ licence_since: a.licence_since, years_experience: a.years_experience, transmissions: a.transmissions, classes: a.classes, return_mode: a.return_mode })], c);
    await q('update users set display_name=coalesce(display_name,$2) where id=$1', [userId, a.legal_name], c);
    return { ok: true, abasare_status: 'pending' };
  });
}

/** Verifier decision. Approval needs every mandatory Abasare document approved and unexpired (incl. police clearance). */
export async function decideAbasare(staff: Actor, driverId: string, decision: 'approve' | 'reject' | 'suspend' | 'reinstate', reason?: string) {
  const to = { approve: 'approved', reject: 'rejected', suspend: 'suspended', reinstate: 'approved' }[decision];
  await tx(async (c) => {
    const dp = await q1<any>('select status, abasare_status from driver_profiles where user_id=$1 for update', [driverId], c);
    if (!dp) throw notFound('driver');
    if (dp.abasare_status === 'none') throw conflict('not_applied', 'This driver has not applied for Abasare');
    if (decision === 'approve' || decision === 'reinstate') {
      const need = await q<any>(`select r.doc_type from document_requirements r where r.vehicle_type='abasare' and r.mandatory and not exists (
        select 1 from driver_documents d where d.driver_id=$1 and d.doc_type=r.doc_type and not d.superseded and d.review_status='approved' and (d.expiry_date is null or d.expiry_date >= current_date))`, [driverId], c);
      if (need.length) throw conflict('documents_not_approved', `Approve all mandatory documents first (${need.map((n: any) => n.doc_type).join(', ')})`);
      if (['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW'].includes(dp.status)) await setDriverStatus(c, driverId, 'APPROVED', staff, 'Abasare application approved');
      else if (dp.status !== 'APPROVED') throw conflict('account_not_approvable', `Driver account is ${dp.status}`);
    } else if (!reason) throw badRequest('reason_required', 'A reason is required');
    await q(`update driver_profiles set abasare_status=$2, abasare_reason=$3, abasare_decided_at=now(),
             accepting = case when $2='approved' then (select array(select distinct unnest(accepting || '{abasare}'::text[]))) else array_remove(accepting,'abasare') end,
             is_online = case when $2 in ('rejected','suspended') and not exists (select 1 from vehicles v where v.driver_id=$1 and v.status='approved') then false else is_online end
             where user_id=$1`, [driverId, to, reason ?? null], c);
    if (to !== 'approved') await q("update dispatch_offers set status='cancelled' where driver_id=$1 and status='pending'", [driverId], c);
    await audit(staff, 'abasare.decision', 'driver', driverId, { status: dp.abasare_status }, { status: to, reason }, c);
  });
  await notify(driverId, 'driver_decision', { status: `Abasare ${to}`, reason: reason ?? '' });
  return { ok: true, abasare_status: to };
}

// ---------------- car check-in / check-out ----------------
type Phase = 'pickup' | 'dropoff';
const PHASE_STATES: Record<Phase, string[]> = { pickup: ['DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'], dropoff: ['IN_PROGRESS'] };

async function ownAbasareTrip(driverId: string, bookingId: string, phase: Phase, c?: any): Promise<BookingRow> {
  const b = await q1<BookingRow>('select * from bookings where id=$1' + (c ? ' for update' : ''), [bookingId], c);
  if (!b || b.driver_id !== driverId) throw notFound('booking');
  if (!b.hire_mode) throw badRequest('not_an_abasare_booking');
  if (!PHASE_STATES[phase].includes(b.status)) throw conflict('invalid_state', phase === 'pickup' ? 'Record the car at pickup after you arrive and before starting' : 'Record the car at drop-off while the trip is in progress');
  return b;
}

export async function addHandoverPhoto(driverId: string, bookingId: string, phase: Phase, buf: Buffer) {
  await ownAbasareTrip(driverId, bookingId, phase);
  const n = await q1<{ n: number }>('select count(*)::int n from handover_photos where booking_id=$1 and phase=$2', [bookingId, phase]);
  if (n!.n >= 8) throw conflict('too_many_photos', 'Maximum 8 photos per check');
  if (await q1('select 1 from abasare_handovers where booking_id=$1 and phase=$2', [bookingId, phase])) throw conflict('already_submitted', 'This check was already submitted');
  const f = await saveFile(buf, 'evidence');
  await q('insert into handover_photos(booking_id, phase, file_key, uploaded_by) values ($1,$2,$3,$4)', [bookingId, phase, f.key, driverId]);
  return { ok: true, photos: n!.n + 1 };
}

export async function submitHandover(driverId: string, bookingId: string, phase: Phase, d: { odometer_km: number; fuel_percent: number; notes?: string; damage_noted?: boolean }) {
  const minPhotos = await getSetting('abasare.min_photos');
  const b = await tx(async (c) => {
    const b = await ownAbasareTrip(driverId, bookingId, phase, c);
    const n = await q1<{ n: number }>('select count(*)::int n from handover_photos where booking_id=$1 and phase=$2', [bookingId, phase], c);
    if (n!.n < minPhotos) throw badRequest('photos_required', `Take at least ${minPhotos} photos of the car`);
    if (phase === 'dropoff') {
      const pu = await q1<any>("select odometer_km from abasare_handovers where booking_id=$1 and phase='pickup'", [bookingId], c);
      if (pu?.odometer_km != null && d.odometer_km < pu.odometer_km) throw badRequest('odometer_decreased', 'Drop-off odometer cannot be lower than at pickup');
    }
    try {
      await q('insert into abasare_handovers(booking_id, phase, odometer_km, fuel_percent, notes, damage_noted, submitted_by) values ($1,$2,$3,$4,$5,$6,$7)',
        [bookingId, phase, d.odometer_km, d.fuel_percent, d.notes ?? null, !!d.damage_noted, driverId], c);
    } catch (e: any) { if (e.code === '23505') throw conflict('already_submitted', 'This check was already submitted'); throw e; }
    await logEvent(c, bookingId, 'handover_submitted', { id: driverId, role: 'driver' }, { phase, odometer_km: d.odometer_km, fuel_percent: d.fuel_percent, photos: n!.n });
    return b;
  });
  await notify(b.passenger_id, 'handover_submitted', { phase: phase === 'pickup' ? 'pickup' : 'drop-off' });
  return { ok: true };
}

/** The owner confirms or disputes the recorded condition. A dispute opens an urgent, sensitive support case with the evidence attached to the booking. */
export async function respondHandover(ownerId: string, bookingId: string, phase: Phase, response: 'ok' | 'issue', note?: string) {
  if (response === 'issue' && (!note || note.trim().length < 5)) throw badRequest('note_required', 'Describe the issue');
  const window = await getSetting('abasare.issue_window_min');
  const out = await tx(async (c) => {
    const b = await q1<BookingRow>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b || b.passenger_id !== ownerId) throw notFound('booking');
    if (!b.hire_mode) throw badRequest('not_an_abasare_booking');
    const h = await q1<any>('select * from abasare_handovers where booking_id=$1 and phase=$2 for update', [bookingId, phase], c);
    if (!h) throw conflict('not_recorded_yet', 'The driver has not recorded this check yet');
    if (h.owner_response === 'ok') throw conflict('already_confirmed', 'You already confirmed this record');
    if (phase === 'dropoff' && Date.now() - new Date(h.created_at).getTime() > window * 60000) throw conflict('window_closed', `Issues can be reported within ${window} minutes of drop-off. Contact support.`);
    await q('update abasare_handovers set owner_response=$3, owner_note=$4, owner_responded_at=now() where booking_id=$1 and phase=$2', [bookingId, phase, response, note ?? null], c);
    await logEvent(c, bookingId, 'handover_response', { id: ownerId, role: 'passenger' }, { phase, response }, note);
    let caseRef: string | null = null;
    if (response === 'issue') {
      const cs = await q1<any>(`insert into support_cases(ref, booking_id, reporter_id, category, priority, subject, sensitive, sla_due_at)
        values ($1,$2,$3,'driver_complaint','urgent',$4,true, now() + interval '2 hours') returning id, ref`, [refOf('CS'), bookingId, ownerId, `Car condition issue (${phase}) ${b.ref}`], c);
      await q("insert into case_events(case_id, author_id, kind, body) values ($1,$2,'message',$3)", [cs.id, ownerId, note], c);
      caseRef = cs.ref;
    }
    return { b, caseRef };
  });
  if (response === 'issue' && out.b.driver_id) await notify(out.b.driver_id, 'handover_issue', { phase, ref: out.b.ref });
  return { ok: true, case: out.caseRef };
}

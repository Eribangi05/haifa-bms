import { q, q1, tx } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { audit, type Actor } from './audit.js';

/** Export of everything we hold about a user, for access requests. Excludes other people's data and internal staff notes. */
export async function exportUserData(userId: string) {
  const user = await q1('select id, phone, email, display_name, preferred_language, notif_prefs, created_at, status from users where id=$1', [userId]);
  return {
    user,
    bookings: await q('select ref, status, pickup_name, dest_name, estimated_fare, final_fare, payment_method, created_at, completed_at from bookings where passenger_id=$1 or driver_id=$1', [userId]),
    saved_places: await q('select label, name, lat, lng from saved_places where user_id=$1', [userId]),
    emergency_contacts: await q('select name, phone from emergency_contacts where user_id=$1', [userId]),
    consents: await q('select kind, version, granted, created_at from consents where user_id=$1', [userId]),
    support_cases: await q('select ref, category, subject, status, created_at from support_cases where reporter_id=$1', [userId]),
    notifications: await q("select template_key, title, body, created_at from notifications where user_id=$1 and channel='in_app'", [userId]),
    ratings_given: await q('select booking_id, score, comment from ratings where reviewer_id=$1', [userId]),
  };
}

/**
 * Deletion: personal identifiers are erased/anonymised; financial records (ledger, payments, earnings) are retained
 * for legal/accounting reasons and keep only the anonymised user id. Blocked while money or trips are outstanding.
 */
export async function executeDeletion(staff: Actor, requestId: string) {
  return tx(async (c) => {
    const r = await q1<any>("select * from privacy_requests where id=$1 and kind='deletion' for update", [requestId], c);
    if (!r) throw notFound('privacy request');
    if (r.status === 'completed') throw conflict('already_done', 'Already completed');
    const active = await q1("select 1 from bookings where (passenger_id=$1 or driver_id=$1) and status in ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS','COMPLETED','PAYMENT_PENDING','DISPUTED')", [r.user_id], c);
    if (active) throw conflict('active_trips', 'User has active or unpaid trips');
    const owed = await q1("select coalesce(sum(case when account_code='DRIVER_PAYABLE' then credit-debit else 0 end),0)::int p from ledger_entries where owner_user_id=$1", [r.user_id], c);
    if (owed && owed.p !== 0) throw conflict('outstanding_balance', 'Settle the driver balance before deletion');
    await q(`update users set phone=null, email=null, password_hash=null, display_name='Deleted user', photo_key=null, mfa_secret_enc=null, mfa_enabled=false, referral_code=null,
             device_fingerprint=null, status='deleted', updated_at=now() where id=$1`, [r.user_id], c);
    await q('delete from saved_places where user_id=$1', [r.user_id], c);
    await q('delete from emergency_contacts where user_id=$1', [r.user_id], c);
    await q('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [r.user_id], c);
    await q('delete from driver_documents where driver_id=$1', [r.user_id], c);    // file objects are purged by the retention worker
    await q("update driver_profiles set legal_name=null, national_id_enc=null, emergency_contact_enc=null, payout_msisdn=null, status='DEACTIVATED', is_online=false where user_id=$1", [r.user_id], c);
    await q("update privacy_requests set status='completed', handled_by=$2, resolved_at=now() where id=$1", [requestId, staff.id], c);
    await audit(staff, 'privacy.deletion_executed', 'user', r.user_id, undefined, { request: requestId }, c);
    return { ok: true };
  });
}

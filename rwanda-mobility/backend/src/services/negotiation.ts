import type { PoolClient } from 'pg';
import { q, q1, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { getSetting } from './settings.js';
import { flagFor } from './settings.js';
import { logEvent } from './bookingMachine.js';
import { notify } from './notify.js';
import { roundTo } from '../util/money.js';
import type { Breakdown } from './pricing.js';

/**
 * Passenger-proposed fares (flag pricing.negotiated, off by default).
 * The rider proposes a price at or below the platform price, never lower than the allowed discount. A driver may accept it, decline it, or
 * counter once with a price between the proposal and the platform price. The rider accepts or declines that counter. Nothing is agreed until
 * one side explicitly accepts the other's number, and the platform price (the quote) is never altered: the booking gets one visible line.
 */
export const negotiationSettings = async () => ({
  maxDiscountPct: Number(await getSetting('negotiation.max_discount_pct')),
  counterWaitS: Number(await getSetting('negotiation.counter_wait_s')),
  step: 50,
});

/** The lowest price a rider may propose for a platform price. */
export const lowestProposal = (total: number, pct: number, step = 50) => Math.min(total, Math.ceil(Math.ceil((total * (100 - pct)) / 100) / step) * step);

/** Validate a rider's proposal when booking. Returns the amount to store, or null when the proposal is the platform price itself. */
export async function checkProposal(c: PoolClient, passengerId: string, svc: { kind: string }, bd: Breakdown, amount: number, ctx: { corporate: boolean; partner: boolean; guest: boolean; wallet: boolean }): Promise<number | null> {
  if (!(await flagFor('pricing.negotiated', passengerId))) throw badRequest('negotiation_unavailable', 'Proposing a price is not available');
  if (svc.kind !== 'ride' || ctx.corporate || ctx.partner || ctx.guest || ctx.wallet || bd.discount > 0 || (bd.debt ?? 0) > 0 || bd.tax > 0)
    throw badRequest('negotiation_unavailable', 'You cannot propose a price for this booking');
  const s = await negotiationSettings();
  const min = lowestProposal(bd.total, s.maxDiscountPct, s.step);
  if (!Number.isInteger(amount) || amount < min || amount > bd.total) throw badRequest('proposal_out_of_range', `Propose between ${min} and ${bd.total} RWF`, { min, max: bd.total });
  void c;
  return amount === bd.total ? null : amount;
}

const L = (code: string, en: string, rw: string, fr: string, amount: number) => ({ code, label_en: en, label_rw: rw, label_fr: fr, amount });

/** Write the agreed price into the booking: one disclosed line, totals and commission base follow from it. */
export async function applyAgreed(c: PoolClient, b: any, amount: number, by: 'driver_accepted_proposal' | 'passenger_accepted_counter') {
  const bd: Breakdown = b.fare_breakdown;
  const adj = amount - bd.total;
  if (adj === 0) return;
  const lines = [...bd.lines, L('negotiated', adj < 0 ? 'Agreed price (below the usual fare)' : 'Agreed price', adj < 0 ? 'Igiciro mwumvikanye (kiri munsi y\'igisanzwe)' : 'Igiciro mwumvikanye', adj < 0 ? 'Prix convenu (inférieur au tarif habituel)' : 'Prix convenu', adj)];
  const subtotal = bd.subtotal + adj;
  const next: Breakdown = { ...bd, lines, subtotal, total: bd.total + adj, commissionable: subtotal - bd.passthrough };
  await q('update bookings set fare_breakdown=$2, estimated_fare=$3, agreed_fare=$3, agreed_by=$4 where id=$1', [b.id, JSON.stringify(next), amount, by], c);
  await logEvent(c, b.id, 'fare_agreed', { id: null, role: 'system' }, { amount, platform_price: bd.total, by });
}

/** A driver with a pending offer for a proposed fare answers with one higher price (never above the platform price). */
export async function counter(driverId: string, bookingId: string, amount: number) {
  const out = await tx(async (c) => {
    const b = await q1<any>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b) throw notFound('booking');
    if (b.status !== 'SEARCHING_DRIVER' || !b.proposed_fare) throw conflict('not_negotiable', 'This trip has no proposed price');
    const o = await q1<any>("select * from dispatch_offers where booking_id=$1 and driver_id=$2 and status='pending' for update", [bookingId, driverId], c);
    if (!o || new Date(o.expires_at) < new Date()) throw conflict('offer_not_found', 'No pending offer for you');
    if (o.counter_amount) throw conflict('already_countered', 'You already made a counter-offer');
    if (!Number.isInteger(amount) || amount <= b.proposed_fare || amount > b.estimated_fare) throw badRequest('counter_out_of_range', `Counter between ${b.proposed_fare + 1} and ${b.estimated_fare} RWF`, { min: b.proposed_fare + 1, max: b.estimated_fare });
    const { counterWaitS } = await negotiationSettings();
    await q("update dispatch_offers set counter_amount=$2, countered_at=now(), expires_at = now() + make_interval(secs => $3) where id=$1", [o.id, amount, counterWaitS], c);
    const f = await q1<any>("insert into fare_offers(booking_id, offer_id, driver_id, side, amount) values ($1,$2,$3,'driver',$4) returning id", [bookingId, o.id, driverId, amount], c);
    await logEvent(c, bookingId, 'fare_counter', { id: driverId, role: 'driver' }, { amount, proposed: b.proposed_fare });
    return { id: f.id as string, passenger: b.passenger_id as string, ref: b.ref as string, wait: counterWaitS };
  });
  await notify(out.passenger, 'fare_counter', { ref: out.ref, amount }, { critical: true });
  return { ok: true, counter_id: out.id, expires_in_s: out.wait };
}

/** Rider's answer to a counter. Accepting assigns that driver at the counter price; declining frees the driver (no penalty) and the search goes on. */
export async function answerCounter(passengerId: string, bookingId: string, counterId: string, accept: boolean) {
  const f = await q1<any>("select f.*, b.passenger_id, b.status booking_status from fare_offers f join bookings b on b.id=f.booking_id where f.id=$1 and f.booking_id=$2 and f.side='driver'", [counterId, bookingId]);
  if (!f || f.passenger_id !== passengerId) throw notFound('counter-offer');
  if (f.status !== 'open') throw conflict('counter_closed', 'This counter-offer is no longer open');
  if (accept) {
    const { acceptOffer } = await import('./dispatch.js');
    const row = await acceptOffer(f.driver_id, bookingId, { counterId, amount: f.amount });
    return { ok: true, booking_status: row.status };
  }
  const { runRound } = await import('./dispatch.js');
  await tx(async (c) => {
    await q("update fare_offers set status='declined', decided_at=now() where id=$1 and status='open'", [counterId], c);
    await q("update dispatch_offers set status='rejected', responded_at=now(), reject_reason='fare_declined', excused=true where id=$1 and status='pending'", [f.offer_id], c);
    await logEvent(c, bookingId, 'fare_counter_declined', { id: passengerId, role: 'passenger' }, { amount: f.amount });
  });
  await runRound(bookingId);
  return { ok: true, booking_status: 'SEARCHING_DRIVER' };
}

/** What the rider sees on a trip that is being negotiated. */
export async function negotiationView(b: any) {
  if (!b.proposed_fare) return undefined;
  const open = b.status === 'SEARCHING_DRIVER' ? await q<any>("select f.id, f.amount, o.expires_at, u.display_name from fare_offers f join dispatch_offers o on o.id=f.offer_id join users u on u.id=f.driver_id where f.booking_id=$1 and f.status='open' and o.expires_at > now() order by f.created_at", [b.id]) : [];
  return { proposed_fare: b.proposed_fare, platform_price: b.agreed_fare ? undefined : b.estimated_fare, agreed_fare: b.agreed_fare ?? null, agreed_by: b.agreed_by ?? null,
    counters: open.map((r: any) => ({ id: r.id, amount: r.amount, driver_first_name: String(r.display_name ?? '').split(' ')[0] || null, expires_at: r.expires_at })) };
}
void forbidden;

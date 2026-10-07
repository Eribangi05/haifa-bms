import type { PoolClient } from 'pg';
import { q, q1 } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { releaseDebts, reattachDebts } from './debts.js';

export type Status =
  | 'DRAFT' | 'FARE_ESTIMATED' | 'SCHEDULED' | 'REQUESTED' | 'SEARCHING_DRIVER' | 'DRIVER_ASSIGNED' | 'DRIVER_ARRIVING'
  | 'DRIVER_ARRIVED' | 'AWAITING_PASSENGER_VERIFICATION' | 'IN_PROGRESS' | 'COMPLETED' | 'PAYMENT_PENDING'
  | 'PAYMENT_COMPLETED' | 'CANCELLATION_REQUESTED' | 'CANCELLED_BY_PASSENGER' | 'CANCELLED_BY_DRIVER'
  | 'CANCELLED_BY_SYSTEM' | 'DISPUTED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'PAYMENT_REVERSED' | 'NO_DRIVER_FOUND';

const CANCELS: Status[] = ['CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_SYSTEM'];

/** The single source of truth for legal transitions. Everything else is rejected. */
export const TRANSITIONS: Record<Status, Status[]> = {
  DRAFT: ['FARE_ESTIMATED', 'REQUESTED', 'CANCELLED_BY_PASSENGER'],
  FARE_ESTIMATED: ['REQUESTED', 'SCHEDULED', 'CANCELLED_BY_PASSENGER'],
  SCHEDULED: ['REQUESTED', 'SEARCHING_DRIVER', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_SYSTEM'],
  REQUESTED: ['SEARCHING_DRIVER', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_SYSTEM'],
  SEARCHING_DRIVER: ['DRIVER_ASSIGNED', 'NO_DRIVER_FOUND', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_SYSTEM'],
  DRIVER_ASSIGNED: ['DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'SEARCHING_DRIVER', 'CANCELLATION_REQUESTED', ...CANCELS],
  DRIVER_ARRIVING: ['DRIVER_ARRIVED', 'SEARCHING_DRIVER', 'CANCELLATION_REQUESTED', ...CANCELS],
  DRIVER_ARRIVED: ['AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS', 'SEARCHING_DRIVER', 'CANCELLATION_REQUESTED', ...CANCELS],
  AWAITING_PASSENGER_VERIFICATION: ['IN_PROGRESS', 'SEARCHING_DRIVER', 'CANCELLATION_REQUESTED', ...CANCELS],
  IN_PROGRESS: ['COMPLETED', 'DISPUTED', 'CANCELLED_BY_SYSTEM'],
  COMPLETED: ['PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'DISPUTED'],
  PAYMENT_PENDING: ['PAYMENT_COMPLETED', 'DISPUTED'],
  PAYMENT_COMPLETED: ['DISPUTED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'PAYMENT_REVERSED'],
  CANCELLATION_REQUESTED: ['DRIVER_ASSIGNED', 'SEARCHING_DRIVER', ...CANCELS],
  DISPUTED: ['PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'PAYMENT_REVERSED'],
  PARTIALLY_REFUNDED: ['REFUNDED', 'DISPUTED'],
  CANCELLED_BY_PASSENGER: [], CANCELLED_BY_DRIVER: [], CANCELLED_BY_SYSTEM: [],
  REFUNDED: [], PAYMENT_REVERSED: [], NO_DRIVER_FOUND: ['SEARCHING_DRIVER'],
};

export const ACTIVE_TRIP: Status[] = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS'];
export const canTransition = (from: Status, to: Status) => TRANSITIONS[from]?.includes(to) ?? false;

export type Actor = { id: string | null; role: string };
export type BookingRow = Record<string, any> & { id: string; status: Status; version: number };

/**
 * Lock the booking row, validate the transition and apply it with an event, atomically.
 * `patch` columns are whitelisted by the caller (never user-supplied keys).
 */
export async function transition(
  c: PoolClient, bookingId: string, to: Status, actor: Actor,
  opts: { reason?: string; meta?: Record<string, unknown>; patch?: Record<string, unknown>; expectFrom?: Status[]; expectedVersion?: number } = {},
): Promise<BookingRow> {
  const cur = await q1<BookingRow>('select * from bookings where id=$1 for update', [bookingId], c);
  if (!cur) throw notFound('booking');
  if (opts.expectedVersion != null && cur.version !== opts.expectedVersion) throw conflict('stale_version', 'Booking changed; refresh and retry');
  if (opts.expectFrom && !opts.expectFrom.includes(cur.status)) throw conflict('invalid_state', `Booking is ${cur.status}`);
  if (!canTransition(cur.status, to)) throw conflict('invalid_transition', `${cur.status} -> ${to} is not allowed`);
  const patch = opts.patch ?? {};
  const keys = Object.keys(patch);
  const sets = ['status=$2', 'version=version+1', 'updated_at=now()', ...keys.map((k, i) => `${k}=$${i + 3}`)];
  const row = (await q<BookingRow>(`update bookings set ${sets.join(', ')} where id=$1 returning *`, [bookingId, to, ...keys.map((k) => patch[k])], c))[0];
  await q(`insert into booking_events(booking_id,type,from_status,to_status,actor_id,actor_role,reason,meta) values ($1,'status_change',$2,$3,$4,$5,$6,$7)`,
    [bookingId, cur.status, to, actor.id, actor.role, opts.reason ?? null, JSON.stringify(opts.meta ?? {})], c);
  // a booking that ends unpaid (cancelled, or no driver found) hands any carried cancellation fee back to the passenger's open balance
  if (CANCELS.includes(to) || to === 'NO_DRIVER_FOUND') await releaseDebts(c, bookingId);
  if (cur.status === 'NO_DRIVER_FOUND' && to === 'SEARCHING_DRIVER') return (await reattachDebts(c, row as any)) ?? row;
  return row;
}

export async function logEvent(c: PoolClient, bookingId: string, type: string, actor: Actor, meta: Record<string, unknown> = {}, reason?: string) {
  await q('insert into booking_events(booking_id,type,actor_id,actor_role,reason,meta) values ($1,$2,$3,$4,$5,$6)', [bookingId, type, actor.id, actor.role, reason ?? null, JSON.stringify(meta)], c);
}

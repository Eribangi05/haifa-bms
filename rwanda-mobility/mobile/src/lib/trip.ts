// Pure trip-status helpers shared by Home, Track and History (unit-tested in tests/trip.test.ts).
export const LIVE = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS'] as const;
export const SEARCHING = ['REQUESTED', 'SEARCHING_DRIVER'] as const;
export const PAYABLE = ['COMPLETED', 'PAYMENT_PENDING'] as const;
export const PAID = ['PAYMENT_COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
export const CANCEL_FEE_STATES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'] as const;
const has = (list: readonly string[], s: string) => list.includes(s);
export const isLive = (s: string) => has(LIVE, s);
export const isSearching = (s: string) => has(SEARCHING, s);
export const isPayable = (s: string) => has(PAYABLE, s);
export const isPaid = (s: string) => has(PAID, s);
export const isCancelled = (s: string) => s.startsWith('CANCELLED');
/** Statuses where the passenger still has something to do (shown as "resume" on Home). */
export const isOpen = (s: string) => isLive(s) || isSearching(s) || isPayable(s);

/** 0-based index on the Request > Driver > Pickup > Trip > Done stepper. */
export const STEP: Record<string, number> = { REQUESTED: 0, SEARCHING_DRIVER: 0, SCHEDULED: 0, DRIVER_ASSIGNED: 1, DRIVER_ARRIVING: 1, DRIVER_ARRIVED: 2, AWAITING_PASSENGER_VERIFICATION: 2, IN_PROGRESS: 3, COMPLETED: 4, PAYMENT_PENDING: 4, PAYMENT_COMPLETED: 4 };

export type Tone = 'ok' | 'warn' | 'bad';
export const statusTone = (s: string): Tone => (isCancelled(s) || s === 'NO_DRIVER_FOUND' || s === 'DISPUTED' || s === 'PAYMENT_REVERSED' ? 'bad' : s === 'PAYMENT_COMPLETED' || s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED' ? 'ok' : 'warn');
export const statusGlyph = (s: string): string => (isCancelled(s) || s === 'NO_DRIVER_FOUND' ? '✕' : s === 'PAYMENT_COMPLETED' ? '✓' : s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED' ? '↺' : s === 'SCHEDULED' ? '⏰' : isSearching(s) ? '…' : isLive(s) ? '🚗' : isPayable(s) ? '💳' : '•');

/** Header title key for the live trip screen (every status maps somewhere sensible; refunds are NOT "cancelled"). */
export function tripTitleKey(s: string): 'trip.searching' | 'trip.assigned' | 'trip.arriving' | 'trip.arrived' | 'trip.inprogress' | 'trip.completed' | 'trip.nodriver' | 'trip.scheduled' | 'trip.refunded' | 'trip.cancelled' {
  if (isSearching(s)) return 'trip.searching';
  switch (s) {
    case 'DRIVER_ASSIGNED': return 'trip.assigned'; case 'DRIVER_ARRIVING': return 'trip.arriving';
    case 'DRIVER_ARRIVED': case 'AWAITING_PASSENGER_VERIFICATION': return 'trip.arrived'; case 'IN_PROGRESS': return 'trip.inprogress';
    case 'COMPLETED': case 'PAYMENT_PENDING': case 'PAYMENT_COMPLETED': return 'trip.completed';
    case 'REFUNDED': case 'PARTIALLY_REFUNDED': return 'trip.refunded';
    case 'NO_DRIVER_FOUND': return 'trip.nodriver'; case 'SCHEDULED': return 'trip.scheduled'; default: return 'trip.cancelled';
  }
}

/** MoMo payment UI state derived ONLY from server data: never "success" unless the server says SUCCESS. `waitedMs` = time since we started waiting on PENDING. */
export type PayUi = 'idle' | 'pending' | 'slow' | 'failed' | 'success';
export const PAY_SLOW_MS = 90_000;
export function payUi(status: string | undefined | null, waitedMs: number): PayUi {
  if (status === 'SUCCESS') return 'success';
  if (status === 'FAILED' || status === 'EXPIRED' || status === 'CANCELLED') return 'failed';
  if (status === 'PENDING' || status === 'INITIATED') return waitedMs >= PAY_SLOW_MS ? 'slow' : 'pending';
  return 'idle';
}

/** Share location only for a driver in driver mode who accepted the disclosure and is online or on a trip. */
export const shouldTrack = (o: { mode: string; consent: boolean; online: boolean; onTrip: boolean }) => o.mode === 'driver' && o.consent && (o.online || o.onTrip);

import { q1 } from '../db.js';
import type { Db } from '../db.js';
import { pool } from '../db.js';

/** True while an Abasare deposit is required but not yet paid: the booking must not be dispatched. */
export async function depositBlocks(bookingId: string, db: Db = pool): Promise<boolean> {
  const d = await q1<any>("select status from booking_deposits where booking_id=$1", [bookingId], db);
  return !!d && ['awaiting_payment', 'pending', 'failed', 'expired', 'cancelled'].includes(d.status);
}

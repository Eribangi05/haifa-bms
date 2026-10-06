import { q1, type Db, pool } from '../db.js';
import { bps } from '../util/money.js';

export type CommissionRule = { id: string; kind: 'percent' | 'fixed'; percent_bps: number | null; fixed_amount: number | null; exempt_until: Date | null };

/** Most specific active rule wins: driver > fleet > service > platform default. */
export async function resolveCommission(serviceId: string, driverId: string, fleetId: string | null, at = new Date(), db: Db = pool): Promise<CommissionRule> {
  const r = await q1<CommissionRule>(
    `select * from commission_rules where status='active' and effective_from <= $4 and (effective_to is null or effective_to > $4)
       and (driver_id = $2 or driver_id is null) and (fleet_id = $3 or fleet_id is null) and (service_id = $1 or service_id is null)
       and (driver_id is null or driver_id = $2) and (fleet_id is null or fleet_id = $3)
     order by (driver_id is not null) desc, (fleet_id is not null) desc, (service_id is not null) desc, effective_from desc limit 1`,
    [serviceId, driverId, fleetId, at], db);
  if (!r) throw new Error('no commission rule configured');
  return r;
}
export function calcCommission(rule: CommissionRule, commissionable: number, at = new Date()): number {
  if (rule.exempt_until && new Date(rule.exempt_until) > at) return 0;
  if (rule.kind === 'percent') return bps(commissionable, rule.percent_bps!);
  return Math.min(rule.fixed_amount!, commissionable);
}

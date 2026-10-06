import { q, q1, type Db, pool } from '../db.js';
import { bps, roundTo } from '../util/money.js';
import { badRequest } from '../errors.js';

export type Rule = {
  id: string; service_id: string; zone_id: string | null; model: 'fixed' | 'platform' | 'negotiated';
  base_fare: number; per_km: number; per_min: number; minimum_fare: number; booking_fee: number;
  wait_per_min: number; free_wait_min: number; airport_fee: number; scheduled_fee: number;
  long_distance_km: number | null; long_distance_per_km: number | null;
  tax_bps: number; rounding: number; surge_enabled: boolean; surge_cap_bps: number; version: number;
};
export type Line = { code: string; label_en: string; label_rw: string; amount: number; passthrough?: boolean };
export type Breakdown = {
  lines: Line[]; subtotal: number; discount: number; tax: number; total: number;
  passthrough: number; commissionable: number; currency: 'RWF'; promo_code?: string;
};
export type FareInput = {
  distance_m: number; duration_s: number; airport?: boolean; scheduled?: boolean;
  extras?: { code: string; label: string; amount: number; passthrough?: boolean }[];
  surge_bps?: number;                 // only honoured if rule.surge_enabled; capped
  promo?: { code: string; discount: number };
};

const L = (code: string, en: string, rw: string, amount: number, passthrough = false): Line => ({ code, label_en: en, label_rw: rw, amount, passthrough });

/** Pure, deterministic fare computation. Integer RWF only. */
export function computeFare(rule: Rule, inp: FareInput): Breakdown {
  if (inp.distance_m < 0 || inp.duration_s < 0) throw badRequest('invalid_route');
  const lines: Line[] = [];
  const dist = Math.round((rule.per_km * inp.distance_m) / 1000);
  const time = Math.round((rule.per_min * inp.duration_s) / 60);
  let core = rule.base_fare + dist + time;
  lines.push(L('base', 'Base fare', 'Igiciro fatizo', rule.base_fare));
  lines.push(L('distance', `Distance (${(inp.distance_m / 1000).toFixed(1)} km)`, `Intera (${(inp.distance_m / 1000).toFixed(1)} km)`, dist));
  if (rule.per_min > 0) lines.push(L('time', `Time (${Math.round(inp.duration_s / 60)} min)`, `Igihe (${Math.round(inp.duration_s / 60)} min)`, time));
  if (rule.long_distance_km && rule.long_distance_per_km != null && inp.distance_m > rule.long_distance_km * 1000) {
    const extra = Math.round(((rule.long_distance_per_km - rule.per_km) * (inp.distance_m - rule.long_distance_km * 1000)) / 1000);
    if (extra !== 0) { core += extra; lines.push(L('long_distance', 'Long-distance rate', 'Urugendo rurerure', extra)); }
  }
  if (rule.surge_enabled && inp.surge_bps && inp.surge_bps > 10000) {
    const m = Math.min(inp.surge_bps, rule.surge_cap_bps);
    const s = bps(core, m - 10000);
    core += s; lines.push(L('surge', 'High-demand adjustment', 'Izamuka ry\'igiciro (abantu benshi)', s));
  }
  if (core < rule.minimum_fare) {
    lines.push(L('minimum', 'Minimum fare adjustment', 'Igiciro gito', rule.minimum_fare - core));
    core = rule.minimum_fare;
  }
  let fees = 0;
  const addFee = (code: string, en: string, rw: string, amt: number) => { if (amt > 0) { fees += amt; lines.push(L(code, en, rw, amt)); } };
  addFee('booking_fee', 'Booking fee', 'Amafaranga yo gutumiza', rule.booking_fee);
  if (inp.airport) addFee('airport_fee', 'Airport fee', 'Ikibuga cy\'indege', rule.airport_fee);
  if (inp.scheduled) addFee('scheduled_fee', 'Scheduled booking', 'Urugendo rwateguwe', rule.scheduled_fee);

  const pre = core + fees;
  const rounded = roundTo(pre, rule.rounding);
  if (rounded !== pre) lines.push(L('rounding', 'Rounding', 'Kuzuza', rounded - pre));
  let subtotal = rounded, passthrough = 0;
  for (const e of inp.extras ?? []) {
    if (!Number.isInteger(e.amount) || e.amount < 0) throw badRequest('invalid_extra');
    subtotal += e.amount;
    if (e.passthrough) passthrough += e.amount;
    lines.push(L(e.code, e.label, e.label, e.amount, !!e.passthrough));
  }
  const discount = Math.min(inp.promo?.discount ?? 0, rounded);
  if (discount > 0) lines.push(L('discount', `Promo ${inp.promo!.code}`, `Igabanywa ${inp.promo!.code}`, -discount));
  const tax = bps(subtotal - discount, rule.tax_bps);
  if (tax > 0) lines.push(L('tax', 'Tax', 'Umusoro', tax));
  const total = subtotal - discount + tax;
  return { lines, subtotal, discount, tax, total, passthrough, commissionable: subtotal - passthrough, currency: 'RWF', promo_code: inp.promo?.code };
}

/**
 * Final fare = accepted quote, plus only disclosed adjustments (waiting beyond the free period, authorised extras).
 * With no adjustments the estimate is returned unchanged, so there is no second, drifting calculation.
 */
export function finalizeFare(rule: Rule, quote: Breakdown, adj: { waiting_min: number; extras: { code: string; label: string; amount: number; passthrough?: boolean }[] }): Breakdown {
  const waitBillable = Math.max(0, adj.waiting_min - rule.free_wait_min);
  const waitAmt = waitBillable * rule.wait_per_min;
  if (waitAmt === 0 && adj.extras.length === 0) return quote;
  const lines = quote.lines.filter((l) => l.code !== 'tax' && l.code !== 'discount');
  let subtotal = quote.subtotal, passthrough = quote.passthrough;
  if (waitAmt > 0) { subtotal += waitAmt; lines.push(L('waiting', `Waiting (${waitBillable} min)`, `Gutegereza (${waitBillable} min)`, waitAmt)); }
  for (const e of adj.extras) {
    if (!Number.isInteger(e.amount) || e.amount < 0) throw badRequest('invalid_extra');
    subtotal += e.amount; if (e.passthrough) passthrough += e.amount;
    lines.push(L(e.code, e.label, e.label, e.amount, !!e.passthrough));
  }
  if (quote.discount > 0) lines.push(L('discount', `Promo ${quote.promo_code}`, `Igabanywa ${quote.promo_code}`, -quote.discount));
  const tax = bps(subtotal - quote.discount, rule.tax_bps);
  if (tax > 0) lines.push(L('tax', 'Tax', 'Umusoro', tax));
  return { ...quote, lines, subtotal, tax, passthrough, commissionable: subtotal - passthrough, total: subtotal - quote.discount + tax };
}

export async function activeRule(serviceId: string, zoneId: string, at = new Date(), db: Db = pool): Promise<Rule> {
  const r = await q1<Rule>(
    `select * from pricing_rules where service_id=$1 and status='active' and (zone_id=$2 or zone_id is null)
       and effective_from <= $3 and (effective_to is null or effective_to > $3)
     order by (zone_id is not null) desc, effective_from desc limit 1`, [serviceId, zoneId, at], db);
  if (!r) throw badRequest('no_pricing_rule', 'No active price for this service in this zone');
  return r;
}

export async function ruleById(id: string, db: Db = pool): Promise<Rule> {
  const r = await q1<Rule>('select * from pricing_rules where id=$1', [id], db);
  if (!r) throw badRequest('no_pricing_rule');
  return r;
}

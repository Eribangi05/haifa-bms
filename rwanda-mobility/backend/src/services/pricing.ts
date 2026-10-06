import { q, q1, type Db, pool } from '../db.js';
import { bps, roundTo } from '../util/money.js';
import { badRequest } from '../errors.js';

export type Rule = {
  id: string; service_id: string; zone_id: string | null; model: 'fixed' | 'platform' | 'negotiated';
  base_fare: number; per_km: number; per_min: number; minimum_fare: number; booking_fee: number;
  wait_per_min: number; free_wait_min: number; airport_fee: number; scheduled_fee: number;
  long_distance_km: number | null; long_distance_per_km: number | null;
  tax_bps: number; rounding: number; surge_enabled: boolean; surge_cap_bps: number; version: number;
  // Abasare (driver for the customer's own car)
  billing?: 'distance' | 'hourly'; return_per_km?: number; night_start_hour?: number | null; night_end_hour?: number | null; night_fee?: number;
  hourly_rate?: number; min_hours?: number; max_hours?: number; long_hire_hours?: number | null; long_hire_rate?: number | null; overtime_per_30min?: number; overtime_grace_min?: number;
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
  hours?: number;                     // hourly billing: booked hours
  local_hour?: number;                // hour of day (Africa/Kigali) the service starts, for the night band
  promo?: { code: string; discount: number };
};

const L = (code: string, en: string, rw: string, amount: number, passthrough = false): Line => ({ code, label_en: en, label_rw: rw, amount, passthrough });

/** Hour of day in Africa/Kigali (UTC+2, no DST). */
export const kigaliHour = (d: Date) => (d.getUTCHours() + 2) % 24;
export const inNightBand = (hour: number, start?: number | null, end?: number | null) =>
  start != null && end != null && (start < end ? hour >= start && hour < end : hour >= start || hour < end);

/** Pure, deterministic fare computation. Integer RWF only. */
export function computeFare(rule: Rule, inp: FareInput): Breakdown {
  if (inp.distance_m < 0 || inp.duration_s < 0) throw badRequest('invalid_route');
  const lines: Line[] = [];
  if (rule.billing === 'hourly') return computeHourly(rule, inp);
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
  if (rule.return_per_km) addFee('return_allowance', 'Driver return allowance', 'Amafaranga yo kugaruka k\'umushoferi', Math.round((rule.return_per_km * inp.distance_m) / 1000));
  if (inp.local_hour != null && inNightBand(inp.local_hour, rule.night_start_hour, rule.night_end_hour)) addFee('night_fee', 'Night service', 'Serivisi y\'ijoro', rule.night_fee ?? 0);

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

function computeHourly(rule: Rule, inp: FareInput): Breakdown {
  const hours = inp.hours ?? 0;
  const min = rule.min_hours ?? 2, max = rule.max_hours ?? 12;
  if (!Number.isInteger(hours) || hours < min || hours > max) throw badRequest('invalid_hours', `Book between ${min} and ${max} hours`);
  const long = rule.long_hire_hours != null && rule.long_hire_rate != null && hours >= rule.long_hire_hours;
  const rate = long ? (rule.long_hire_rate as number) : (rule.hourly_rate ?? 0);
  const lines: Line[] = [L('hourly', `Driver ${hours} h x ${rate}${long ? ' (long-hire rate)' : ''}`, `Umushoferi ${hours} h x ${rate}${long ? ' (igiciro cy\'igihe kirekire)' : ''}`, hours * rate)];
  let fees = 0;
  const add = (code: string, en: string, rw: string, amt: number) => { if (amt > 0) { fees += amt; lines.push(L(code, en, rw, amt)); } };
  add('booking_fee', 'Booking fee', 'Amafaranga yo gutumiza', rule.booking_fee);
  if (inp.scheduled) add('scheduled_fee', 'Scheduled booking', 'Urugendo rwateguwe', rule.scheduled_fee);
  if (inp.local_hour != null && inNightBand(inp.local_hour, rule.night_start_hour, rule.night_end_hour)) add('night_fee', 'Night service', 'Serivisi y\'ijoro', rule.night_fee ?? 0);
  const pre = hours * rate + fees;
  const rounded = roundTo(pre, rule.rounding);
  if (rounded !== pre) lines.push(L('rounding', 'Rounding', 'Kuzuza', rounded - pre));
  const discount = Math.min(inp.promo?.discount ?? 0, rounded);
  if (discount > 0) lines.push(L('discount', `Promo ${inp.promo!.code}`, `Igabanywa ${inp.promo!.code}`, -discount));
  const tax = bps(rounded - discount, rule.tax_bps);
  if (tax > 0) lines.push(L('tax', 'Tax', 'Umusoro', tax));
  return { lines, subtotal: rounded, discount, tax, total: rounded - discount + tax, passthrough: 0, commissionable: rounded, currency: 'RWF', promo_code: inp.promo?.code };
}

/** Overtime for hourly hires: whole 30-minute blocks beyond the booked time plus a grace period. Disclosed on the quote rules. */
export function overtimeBlocks(rule: Rule, bookedHours: number, elapsedMin: number): number {
  const over = elapsedMin - bookedHours * 60 - (rule.overtime_grace_min ?? 10);
  return over > 0 ? Math.ceil(over / 30) : 0;
}

/**
 * Final fare = accepted quote, plus only disclosed adjustments (waiting beyond the free period, authorised extras).
 * With no adjustments the estimate is returned unchanged, so there is no second, drifting calculation.
 */
export function finalizeFare(rule: Rule, quote: Breakdown, adj: { waiting_min: number; extras: { code: string; label: string; amount: number; passthrough?: boolean }[]; overtime_blocks?: number }): Breakdown {
  const otAmt = (adj.overtime_blocks ?? 0) * (rule.overtime_per_30min ?? 0);
  const waitBillable = Math.max(0, adj.waiting_min - rule.free_wait_min);
  const waitAmt = waitBillable * rule.wait_per_min;
  if (waitAmt === 0 && adj.extras.length === 0 && otAmt === 0) return quote;
  const lines = quote.lines.filter((l) => l.code !== 'tax' && l.code !== 'discount');
  let subtotal = quote.subtotal, passthrough = quote.passthrough;
  if (otAmt > 0) { subtotal += otAmt; lines.push(L('overtime', `Overtime (${adj.overtime_blocks} x 30 min)`, `Igihe cy'inyongera (${adj.overtime_blocks} x 30 min)`, otAmt)); }
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

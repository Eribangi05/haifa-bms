// Fixed-price routes (airport, intercity). A matching pickup/destination gets an extra, labelled fare option at the fixed price.
// Price = fare subtotal: tax (rule.tax_bps) is added and commission is taken on it exactly as for metered fares.
import { q, q1 } from '../db.js';
import { haversineM, type LatLng } from '../util/geo.js';
import { bps } from '../util/money.js';
import { activeRule, type Breakdown, type Line } from './pricing.js';
import { route } from './maps.js';
import { checkPromo } from './promos.js';
import { withDebt } from './debts.js';
import { getSetting } from './settings.js';
import { nearbyAvailable, schedulableSupply } from './bookings.js';

export type FixedRoute = {
  id: string; name_en: string; name_rw: string; name_fr: string; from_lat: number; from_lng: number; from_radius_m: number; to_lat: number; to_lng: number; to_radius_m: number;
  service_id: string; price: number; bidirectional: boolean; active: boolean; valid_from: Date | null; valid_to: Date | null; placeholder: boolean;
};

export function routeMatches(r: FixedRoute, pickup: LatLng, dest: LatLng): boolean {
  const inFrom = (p: LatLng) => haversineM(p, { lat: r.from_lat, lng: r.from_lng }) <= r.from_radius_m;
  const inTo = (p: LatLng) => haversineM(p, { lat: r.to_lat, lng: r.to_lng }) <= r.to_radius_m;
  if (inFrom(pickup) && inTo(dest)) return true;
  // reverse direction: the "from" and "to" circles swap roles
  const revFrom = (p: LatLng) => haversineM(p, { lat: r.to_lat, lng: r.to_lng }) <= r.to_radius_m;
  const revTo = (p: LatLng) => haversineM(p, { lat: r.from_lat, lng: r.from_lng }) <= r.from_radius_m;
  return r.bidirectional && revFrom(pickup) && revTo(dest);
}

export async function matchingRoutes(pickup: LatLng, dest: LatLng, at: Date): Promise<FixedRoute[]> {
  const rows = await q<FixedRoute>(
    `select * from fixed_routes where active and (valid_from is null or valid_from <= $1) and (valid_to is null or valid_to > $1) order by price`, [at]);
  return rows.filter((r) => routeMatches(r, pickup, dest));
}

const L = (code: string, en: string, rw: string, fr: string, amount: number, passthrough = false): Line => ({ code, label_en: en, label_rw: rw, label_fr: fr, amount, passthrough });

/** Pure fare for a fixed route (itemised, labelled in all three languages). */
export function fixedFare(r: Pick<FixedRoute, 'name_en' | 'name_rw' | 'name_fr' | 'price'>, taxBps: number, promo?: { code: string; discount: number }): Breakdown {
  const lines: Line[] = [L('fixed_route', `Fixed price: ${r.name_en}`, `Igiciro kidahinduka: ${r.name_rw}`, `Prix fixe : ${r.name_fr}`, r.price)];
  const discount = Math.min(promo?.discount ?? 0, r.price);
  if (discount > 0) lines.push(L('discount', `Promo ${promo!.code}`, `Igabanywa ${promo!.code}`, `Promo ${promo!.code}`, -discount));
  const tax = bps(r.price - discount, taxBps);
  if (tax > 0) lines.push(L('tax', 'Tax', 'Umusoro', 'Taxe', tax));
  return { lines, subtotal: r.price, discount, tax, total: r.price - discount + tax, passthrough: 0, commissionable: r.price, currency: 'RWF', promo_code: promo?.code };
}

/** Called by estimate() after the metered options: adds one fixed-price option per ride service whose route matches. Mutates `options`. */
export async function injectFixedOptions(c: { passengerId: string; pickup: LatLng; dest: LatLng; promoCode?: string; scheduled: Date | null; zoneId: string; owed: number; ttl: number; options: any[] }) {
  const at = c.scheduled ?? new Date();
  const matches = await matchingRoutes(c.pickup, c.dest, at);
  const done = new Set<string>();
  for (const r of matches) {
    if (done.has(r.service_id)) continue;      // cheapest route per service
    const s = await q1<any>(
      `select s.* from service_categories s join zone_services zs on zs.service_id=s.id and zs.zone_id=$1 and zs.enabled where s.enabled and s.kind='ride' and s.id=$2`, [c.zoneId, r.service_id]);
    if (!s) continue;
    done.add(r.service_id);
    const rule = await activeRule(s.id, c.zoneId, at);
    const promo = c.promoCode ? await checkPromo(c.promoCode, c.passengerId, s.id, c.zoneId, r.price) : null;
    const bd = withDebt(fixedFare(r, rule.tax_bps, promo?.ok ? { code: promo.code, discount: promo.discount } : undefined), c.owed);
    const rt = await route(c.pickup, c.dest, s.vehicle_types[0]);
    const [hb, radius] = [await getSetting('dispatch.heartbeat_max_age_s'), await getSetting('dispatch.max_radius_km')];
    let near: number[] = [], available: boolean, reason: string | undefined;
    if (c.scheduled) { available = (await schedulableSupply(s)) > 0; if (!available) reason = 'no_vehicles_for_service'; }
    else { near = await nearbyAvailable(s, c.zoneId, c.pickup, radius * 1000, hb); available = near.length > 0; if (!available) reason = 'no_drivers_nearby'; }
    let quoteId: string | null = null;
    if (available) {
      quoteId = (await q1<{ id: string }>(
        `insert into fare_quotes(passenger_id, service_id, zone_id, pickup_lat, pickup_lng, dest_lat, dest_lng, distance_m, duration_s, route_source, rule_id, rule_version, promo_code, breakdown, total, scheduled_for, expires_at, meta)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now() + make_interval(secs => $17), $18) returning id`,
        [c.passengerId, s.id, c.zoneId, c.pickup.lat, c.pickup.lng, c.dest.lat, c.dest.lng, rt.distance_m, rt.duration_s, rt.source, rule.id, rule.version,
         promo?.ok ? promo.code : null, JSON.stringify(bd), bd.total, c.scheduled, c.ttl, JSON.stringify({ fixed_route_id: r.id })]))!.id;
    }
    const opt = {
      service_id: s.id, kind: s.kind, hours: null, name_en: s.name_en, name_rw: s.name_rw, name_fr: s.name_fr ?? s.name_en, capacity: s.passenger_capacity, luggage: s.luggage,
      available, reason, quote_id: quoteId, fare: bd, distance_m: rt.distance_m, duration_s: rt.duration_s, route_source: rt.source,
      pickup_eta_s: near.length ? Math.round((Math.min(...near) * 1.5) / 1000 / 24 * 3600) : null, nearby_drivers: c.scheduled ? undefined : near.length,
      promo: promo ? (promo.ok ? { code: promo.code, discount: promo.discount } : { error: promo.reason }) : undefined, is_estimate: false,
      fixed_price: true, fixed_route: { id: r.id, name_en: r.name_en, name_rw: r.name_rw, name_fr: r.name_fr },
    };
    const at2 = c.options.reduce((last, o, i) => (o.service_id === s.id && !o.fixed_price ? i : last), -1);
    if (at2 >= 0) c.options.splice(at2 + 1, 0, opt); else c.options.push(opt);
  }
}

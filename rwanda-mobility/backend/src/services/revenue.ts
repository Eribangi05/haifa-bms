import { q, q1 } from '../db.js';
import { badRequest } from '../errors.js';

/**
 * Owner revenue report: trips, money, commission, active drivers and a daily or weekly trend for any Kigali date range, with the previous period of the
 * same length for comparison. Revenue is the platform commission; "gross" is what customers paid for completed trips (fare + tax - discount).
 * All days are Kigali days (UTC+2 all year). Money is integer RWF.
 */
export type RevenueQuery = { from: string; to: string; group: 'day' | 'week' };
const DAY = 864e5;
const DONE = ['COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
export const kigaliToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
const startOf = (day: string) => new Date(`${day}T00:00:00+02:00`);

export function revenueRange(from?: string, to?: string): { from: string; to: string } {
  const t = to ?? kigaliToday();
  const f = from ?? new Date(startOf(t).getTime() - 6 * DAY + 2 * 3600e3).toISOString().slice(0, 10);   // default: the last 7 days including today
  if (f > t) throw badRequest('bad_range', 'The start date is after the end date');
  if ((startOf(t).getTime() - startOf(f).getTime()) / DAY > 366) throw badRequest('range_too_long', 'Choose at most one year');
  return { from: f, to: t };
}

async function totals(a: Date, b: Date) {
  const e = await q1<any>(`select count(*)::int trips, coalesce(sum(fare_subtotal+tax-discount),0)::bigint gross, coalesce(sum(commission),0)::bigint commission,
      coalesce(sum(net),0)::bigint driver_net, coalesce(sum(fleet_share),0)::bigint fleet_share, coalesce(sum(discount),0)::bigint discounts,
      coalesce(sum(fare_subtotal+tax-discount) filter (where payment_method='cash'),0)::bigint cash,
      coalesce(sum(fare_subtotal+tax-discount) filter (where payment_method in ('mtn_momo','airtel_money')),0)::bigint mobile_money,
      coalesce(sum(fare_subtotal+tax-discount) filter (where payment_method not in ('cash','mtn_momo','airtel_money')),0)::bigint other_methods,
      count(distinct driver_id)::int active_drivers
    from driver_earnings where created_at >= $1 and created_at < $2`, [a, b]);
  const t = await q1<any>(`select count(*)::int requested,
      count(*) filter (where status = any($3))::int completed,
      count(*) filter (where status like 'CANCELLED%')::int cancelled,
      count(*) filter (where status='NO_DRIVER_FOUND')::int no_driver,
      count(distinct passenger_id) filter (where status = any($3))::int active_riders
    from bookings where coalesce(requested_at, created_at) >= $1 and coalesce(requested_at, created_at) < $2`, [a, b, DONE]);
  const nu = await q1<any>(`select count(*)::int n from users u where created_at >= $1 and created_at < $2 and exists (select 1 from user_roles r where r.user_id=u.id and r.role='passenger')`, [a, b]);
  const rt = await q1<any>(`select coalesce(avg(score),0)::numeric(3,2) avg, count(*)::int n from ratings where created_at >= $1 and created_at < $2`, [a, b]);
  const gross = Number(e.gross), commission = Number(e.commission);
  return {
    requested: t.requested, completed: t.completed, cancelled: t.cancelled, no_driver: t.no_driver,
    completion_rate_pct: t.requested ? Math.round((t.completed / t.requested) * 1000) / 10 : 0,
    gross, commission, driver_net: Number(e.driver_net), fleet_share: Number(e.fleet_share), discounts: Number(e.discounts),
    cash: Number(e.cash), mobile_money: Number(e.mobile_money), other_methods: Number(e.other_methods),
    avg_fare: e.trips ? Math.round(gross / e.trips) : 0, take_rate_pct: gross ? Math.round((commission / gross) * 1000) / 10 : 0,
    paid_trips: e.trips, active_drivers: e.active_drivers, active_riders: t.active_riders, new_riders: nu.n,
    rating_avg: Number(rt.avg), rating_count: rt.n,
  };
}

const delta = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export async function revenueReport(query: RevenueQuery) {
  const a = startOf(query.from), b = new Date(startOf(query.to).getTime() + DAY);
  const span = b.getTime() - a.getTime(), pa = new Date(a.getTime() - span);
  const [cur, prev] = await Promise.all([totals(a, b), totals(pa, a)]);
  const bucket = query.group === 'week' ? "date_trunc('week', e.created_at at time zone 'Africa/Kigali')" : "date_trunc('day', e.created_at at time zone 'Africa/Kigali')";
  const [trend, services, methods, drivers, hours, online] = await Promise.all([
    q<any>(`select to_char(${bucket}, 'YYYY-MM-DD') as day, count(*)::int trips, coalesce(sum(e.fare_subtotal+e.tax-e.discount),0)::bigint gross,
              coalesce(sum(e.commission),0)::bigint commission, coalesce(sum(e.net),0)::bigint driver_net, count(distinct e.driver_id)::int drivers
            from driver_earnings e where e.created_at >= $1 and e.created_at < $2 group by 1 order by 1`, [a, b]),
    q<any>(`select b.service_id, coalesce(s.name_en, b.service_id) name_en, count(*)::int trips, coalesce(sum(e.fare_subtotal+e.tax-e.discount),0)::bigint gross, coalesce(sum(e.commission),0)::bigint commission
            from driver_earnings e join bookings b on b.id=e.booking_id left join service_categories s on s.id=b.service_id
            where e.created_at >= $1 and e.created_at < $2 group by 1,2 order by gross desc`, [a, b]),
    q<any>(`select e.payment_method method, count(*)::int trips, coalesce(sum(e.fare_subtotal+e.tax-e.discount),0)::bigint gross
            from driver_earnings e where e.created_at >= $1 and e.created_at < $2 group by 1 order by gross desc`, [a, b]),
    q<any>(`select e.driver_id, coalesce(u.display_name, 'Driver') name, count(*)::int trips, coalesce(sum(e.fare_subtotal+e.tax-e.discount),0)::bigint gross,
              coalesce(sum(e.commission),0)::bigint commission, coalesce(sum(e.net),0)::bigint driver_net, dp.rating_avg::float rating
            from driver_earnings e join users u on u.id=e.driver_id join driver_profiles dp on dp.user_id=e.driver_id
            where e.created_at >= $1 and e.created_at < $2 group by 1,2,dp.rating_avg order by gross desc limit 10`, [a, b]),
    q<any>(`select extract(hour from e.created_at at time zone 'Africa/Kigali')::int as hour, count(*)::int trips from driver_earnings e
            where e.created_at >= $1 and e.created_at < $2 group by 1 order by 1`, [a, b]),
    q1<any>(`select count(*)::int n from driver_profiles where is_online and last_seen_at > now() - interval '2 minutes'`),
  ]);
  const n = (k: keyof typeof cur) => [cur[k] as number, prev[k] as number] as const;
  const changes = Object.fromEntries((['completed', 'gross', 'commission', 'driver_net', 'active_drivers', 'active_riders', 'new_riders', 'paid_trips'] as const).map((k) => [k, delta(...n(k))]));
  return {
    range: { from: query.from, to: query.to, group: query.group, days: Math.round(span / DAY) },
    generated_at: new Date().toISOString(), totals: cur, previous: prev, change_pct: changes,
    trend, by_service: services, by_method: methods, top_drivers: drivers, busy_hours: hours, drivers_online_now: online.n,
    note: 'Revenue is the platform commission. Gross is what customers paid for completed trips (fare + tax - discount).',
  };
}
export type RevenueReport = Awaited<ReturnType<typeof revenueReport>>;

// ---------- CSV (trend rows, then a summary block) ----------
const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function revenueCsv(r: RevenueReport): string {
  const L = (...c: unknown[]) => c.map(cell).join(',');
  const out = [L(r.range.group === 'week' ? 'week_start' : 'day', 'paid_trips', 'gross_rwf', 'commission_rwf', 'driver_net_rwf', 'active_drivers'),
    ...r.trend.map((t: any) => L(t.day, t.trips, t.gross, t.commission, t.driver_net, t.drivers)), '',
    L('summary', 'value'), L('from', r.range.from), L('to', r.range.to),
    ...Object.entries(r.totals).map(([k, v]) => L(k, v)), '', L('service', 'trips', 'gross_rwf', 'commission_rwf'),
    ...r.by_service.map((s: any) => L(s.name_en, s.trips, s.gross, s.commission)), '', L('driver', 'trips', 'gross_rwf', 'commission_rwf', 'driver_net_rwf'),
    ...r.top_drivers.map((d: any) => L(d.name, d.trips, d.gross, d.commission, d.driver_net))];
  return '﻿' + out.join('\r\n') + '\r\n';
}

// ---------- printable report (save as PDF from the browser's print dialog) ----------
type Lang = 'rw' | 'fr' | 'en';
const T: Record<string, [string, string, string]> = {   // en, fr, rw
  title: ['Revenue report', 'Rapport de revenus', 'Raporo y\'amafaranga yinjiye'],
  period: ['Period', 'Période', 'Igihe'], prev: ['Previous period', 'Période précédente', 'Igihe cyabanje'],
  revenue: ['Platform revenue (commission)', 'Revenus de la plateforme (commission)', 'Amafaranga ya Abasare (komisiyo)'],
  gross: ['Customer spend on completed trips', 'Dépenses clients sur les courses terminées', 'Amafaranga abagenzi bishyuye ingendo zarangiye'],
  net: ['Paid to drivers', 'Versé aux chauffeurs', 'Yahawe abashoferi'],
  trips: ['Completed trips', 'Courses terminées', 'Ingendo zarangiye'], requested: ['Requests', 'Demandes', 'Ibisabwa'],
  drivers: ['Active drivers', 'Chauffeurs actifs', 'Abashoferi bakoze'], riders: ['Active riders', 'Passagers actifs', 'Abagenzi bakoresheje'],
  newRiders: ['New riders', 'Nouveaux passagers', 'Abagenzi bashya'], avg: ['Average fare', 'Prix moyen', 'Igiciro rusange'], take: ['Commission rate', 'Taux de commission', 'Ijanisha rya komisiyo'],
  completion: ['Completion rate', 'Taux de réalisation', 'Ijanisha ry\'ingendo zarangiye'], rating: ['Average rating', 'Note moyenne', 'Amanota rusange'],
  trend: ['Trend', 'Évolution', 'Uko byagiye bihinduka'], day: ['Day', 'Jour', 'Umunsi'], week: ['Week starting', 'Semaine du', 'Icyumweru gitangira'],
  commission: ['Commission', 'Commission', 'Komisiyo'], service: ['Service', 'Service', 'Serivisi'], method: ['Payment', 'Paiement', 'Uburyo bwo kwishyura'],
  topDrivers: ['Top drivers', 'Meilleurs chauffeurs', 'Abashoferi ba mbere'], name: ['Driver', 'Chauffeur', 'Umushoferi'],
  cash: ['Cash', 'Espèces', 'Amafaranga mu ntoki'], momo: ['Mobile money', 'Mobile money', 'Mobile money'], other: ['Other', 'Autre', 'Ibindi'],
  vs: ['vs previous period', 'vs période précédente', 'ugereranyije n\'igihe cyabanje'],
  note: ['Revenue is the commission kept by the platform. Amounts in Rwandan francs (RWF).', 'Le revenu est la commission conservée par la plateforme. Montants en francs rwandais (RWF).', 'Amafaranga ya Abasare ni komisiyo isigarana. Ingano ni mu mafaranga y\'u Rwanda (RWF).'],
  print: ['Print or save as PDF', 'Imprimer ou enregistrer en PDF', 'Capa cyangwa ubike nka PDF'], generated: ['Generated', 'Généré le', 'Byakozwe'],
};
const LI: Record<Lang, number> = { en: 0, fr: 1, rw: 2 };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const SVC: Record<string, [string, string, string]> = {
  moto: ['Moto', 'Moto', 'Moto'], standard: ['Standard car', 'Voiture standard', 'Imodoka isanzwe'], comfort: ['Comfort', 'Confort', 'Imodoka y\'icyubahiro'],
  airport: ['Airport transfer', 'Transfert aéroport', 'Ikibuga cy\'indege'], abasare: ['Abasare (trip)', 'Abasare (course)', 'Abasare (urugendo)'], abasare_hourly: ['Abasare (hourly)', 'Abasare (à l\'heure)', 'Abasare (ku isaha)'],
};
const METHOD: Record<string, string> = { cash: 'cash', mtn_momo: 'momo', airtel_money: 'momo' };

export function renderRevenueHtml(r: RevenueReport, lang: Lang): string {
  const i = LI[lang], tt = (k: string) => T[k][i];
  const nf = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US'), rwf = (n: number | string) => `${nf.format(Number(n))} RWF`;
  const svc = (id: string, fallback: string) => (SVC[id]?.[i] ?? fallback);
  const t = r.totals, ch = r.change_pct as Record<string, number | null>;
  const dl = (k: string) => (ch[k] == null ? '' : `<small class="${ch[k]! >= 0 ? 'up' : 'dn'}">${ch[k]! >= 0 ? '+' : ''}${ch[k]}% ${esc(tt('vs'))}</small>`);
  const kpi = (label: string, val: string, d = '') => `<div class="k"><span>${esc(label)}</span><b>${esc(val)}</b>${d}</div>`;
  const max = Math.max(1, ...r.trend.map((x: any) => Number(x.commission)));
  const bars = r.trend.map((x: any) => `<div class="bar"><i style="height:${Math.round((Number(x.commission) / max) * 100)}%"></i><em>${esc(String(x.day).slice(5))}</em></div>`).join('');
  const rows = (cols: string[], body: string[][]) => `<table><thead><tr>${cols.map((c, n) => `<th${n ? ' class="r"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${body.map((b) => `<tr>${b.map((c, n) => `<td${n ? ' class="r"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const methodTotals = { cash: 0, momo: 0, other: 0 };
  for (const m of r.by_method) methodTotals[(METHOD[m.method] ?? 'other') as 'cash'] += Number(m.gross);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tt('title'))} ${esc(r.range.from)} - ${esc(r.range.to)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:0;color:#14281d;background:#fff}main{max-width:900px;margin:0 auto;padding:24px}h1{margin:0 0 2px;font-size:24px}h2{margin:26px 0 8px;font-size:16px;border-bottom:2px solid #0077B0;padding-bottom:4px}
.sub{color:#567}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:14px}.k{border:1px solid #d9e3dc;border-radius:10px;padding:10px 12px}.k span{display:block;color:#567;font-size:12px}.k b{font-size:20px}.k small{display:block;font-size:11px}
.up{color:#1a7f37}.dn{color:#b42318}table{width:100%;border-collapse:collapse;margin-top:6px}th,td{padding:5px 8px;border-bottom:1px solid #e5ebe7;text-align:left}th{font-size:12px;color:#567}.r{text-align:right}
.bars{display:flex;align-items:flex-end;gap:4px;height:120px;border-bottom:1px solid #9ab;padding-top:6px}.bar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}.bar i{display:block;width:100%;background:#0077B0;border-radius:3px 3px 0 0;min-height:2px}.bar em{font-size:10px;color:#567;font-style:normal;margin-top:2px}
button{margin:10px 0;padding:8px 14px;border:0;border-radius:8px;background:#0077B0;color:#fff;font:inherit;cursor:pointer}footer{margin-top:24px;color:#567;font-size:12px}@media print{button{display:none}main{padding:0}}</style></head>
<body><main><h1>Abasare - ${esc(tt('title'))}</h1><div class="sub">${esc(tt('period'))}: ${esc(r.range.from)} - ${esc(r.range.to)} (${r.range.days} d)</div>
<div class="g">${kpi(tt('revenue'), rwf(t.commission), dl('commission'))}${kpi(tt('gross'), rwf(t.gross), dl('gross'))}${kpi(tt('net'), rwf(t.driver_net), dl('driver_net'))}${kpi(tt('trips'), nf.format(t.completed), dl('completed'))}
${kpi(tt('drivers'), nf.format(t.active_drivers), dl('active_drivers'))}${kpi(tt('riders'), nf.format(t.active_riders), dl('active_riders'))}${kpi(tt('newRiders'), nf.format(t.new_riders), dl('new_riders'))}${kpi(tt('avg'), rwf(t.avg_fare))}
${kpi(tt('take'), `${t.take_rate_pct}%`)}${kpi(tt('completion'), `${t.completion_rate_pct}%`)}${kpi(tt('rating'), t.rating_count ? `${t.rating_avg} / 5` : '-')}${kpi(tt('requested'), nf.format(t.requested))}</div>
<h2>${esc(tt('trend'))} - ${esc(tt('commission'))}</h2><div class="bars">${bars}</div>
${rows([tt(r.range.group === 'week' ? 'week' : 'day'), tt('trips'), tt('gross'), tt('commission'), tt('net')], r.trend.map((x: any) => [x.day, nf.format(x.trips), rwf(x.gross), rwf(x.commission), rwf(x.driver_net)]))}
<h2>${esc(tt('service'))}</h2>${rows([tt('service'), tt('trips'), tt('gross'), tt('commission')], r.by_service.map((s: any) => [svc(s.service_id, s.name_en), nf.format(s.trips), rwf(s.gross), rwf(s.commission)]))}
<h2>${esc(tt('method'))}</h2>${rows([tt('method'), tt('gross')], [[tt('cash'), rwf(methodTotals.cash)], [tt('momo'), rwf(methodTotals.momo)], [tt('other'), rwf(methodTotals.other)]])}
<h2>${esc(tt('topDrivers'))}</h2>${rows([tt('name'), tt('trips'), tt('gross'), tt('commission'), tt('net')], r.top_drivers.map((d: any) => [d.name, nf.format(d.trips), rwf(d.gross), rwf(d.commission), rwf(d.driver_net)]))}
<footer>${esc(tt('note'))}<br>${esc(tt('generated'))}: ${esc(new Date(r.generated_at).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: 'Africa/Kigali' }))}</footer></main></body></html>`;
}

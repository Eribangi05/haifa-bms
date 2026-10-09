'use strict';
// Operations views: overview, live map, bookings, drivers, Abasare applications, passengers, support, safety.
// A view is `V.name = async (el, state) => { ...append to el...; return optionalAfterShown }`. The shell shows a loading state until it resolves.
const V = {};

// ---- service / zone names (public endpoints, loaded once) so tables show names instead of ids ----
const CAT = { services: {}, zones: {}, ready: null };
function catalog() {
  const get = (p) => fetch(API + p, { signal: AbortSignal.timeout(6000) }).then((r) => r.json());   // names are a nicety: never hold a page back for more than a few seconds
  CAT.ready ||= Promise.all([get('/services'), get('/coverage')]).then(([s, z]) => {
    for (const x of s.services || []) CAT.services[x.id] = x.name_en;
    for (const x of z.zones || []) CAT.zones[x.id] = x.name;
  }).catch(() => {});
  return CAT.ready;
}
const svcLabel = (id) => CAT.services[id] || human(id);
const zoneLabel = (id) => CAT.zones[id] || human(id);
const METHODS = { cash: 'Cash', mtn_momo: 'MTN MoMo', airtel_money: 'Airtel Money', wallet: 'Wallet', corporate: 'Corporate account' };
const methodName = (m) => METHODS[m] || human(m);

/** Filter bar: pressing Enter in any field applies. */
function filterBar(...kids) { return h('form', { class: 'row filters', onsubmit: (e) => e.preventDefault() }, ...kids); }
const note = (text, cls = '') => h('div', { class: 'banner ' + cls }, text);
function limitNote(n, limit, what) { return n >= limit ? note(`Showing the latest ${n} ${what}. The API returns at most 200 per request: narrow the search to see older ones.`) : null; }

// =============================================================== OVERVIEW
const KIGALI_MS = 2 * 3600e3;
function dayBuckets(n) {
  const today = Math.floor((Date.now() + KIGALI_MS) / 864e5) * 864e5 - KIGALI_MS;      // Kigali midnight
  return Array.from({ length: n }, (_, i) => { const s = today - (n - 1 - i) * 864e5; return { from: new Date(s), to: new Date(s + 864e5 - 1), label: new Date(s + KIGALI_MS).toISOString().slice(5, 10) }; });
}
const qs = (a, b) => `?from=${encodeURIComponent(a.toISOString())}&to=${encodeURIComponent(b.toISOString())}`;
const pctDelta = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : null);
const secs = (n) => (n > 0 ? (n >= 120 ? Math.round(n / 60) + ' min' : n + ' s') : '-');

V.dashboard = async (el, state = {}) => {
  const custom = state.from && state.to ? { from: state.from, to: state.to } : null, days = Number(state.days) || 30;
  let to = new Date(), from = new Date(to - days * 864e5);
  if (custom) { from = dayStart(custom.from); to = dayEnd(custom.to); if (to > Date.now()) to = new Date(); }   // a range that ends today stops at this moment
  const pfrom = new Date(from - (to - from));
  const [d, prev, an] = await Promise.all([api('GET', '/admin/dashboard' + qs(from, to)), api('GET', '/admin/dashboard' + qs(pfrom, new Date(from - 1))), api('GET', '/admin/analytics').catch(() => null), catalog()]);
  const b = d.bookings, p = d.payments, r = d.revenue, pb = prev.bookings, pr = prev.revenue;
  const slots = {}; const spark = (key) => (slots[key] = h('span', { class: 'slot' }, sparkline(null)));
  const range = periodControl({ value: days, options: [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']], range: custom, onQuick: (v) => go('dashboard', { days: v }), onRange: (f, t) => go('dashboard', { from: f, to: t }) });
  const attention = [
    ['Drivers waiting for verification', d.drivers.pending, 'drivers', d.drivers.pending > 10 ? 'bad' : d.drivers.pending > 0 ? 'warn' : '', can('drivers.view')],
    ['Refunds awaiting approval', d.refunds.pending_refunds, 'finance', d.refunds.pending_refunds > 0 ? 'warn' : '', can('finance.view')],
    ['Support cases past SLA', d.support.overdue, 'support', d.support.overdue > 0 ? 'bad' : '', can('support.handle')],
    ['Open safety incidents', d.safety_incidents.open, 'safety', d.safety_incidents.open > 0 ? 'bad' : '', can('safety.respond')],
    ['Disputed trips', d.disputes, 'bookings', d.disputes > 0 ? 'warn' : '', can('bookings.view_all')],
    ['Requests with no driver found', b.no_driver, 'bookings', b.no_driver > 0 ? 'warn' : '', can('bookings.view_all')],
  ];
  const allClear = attention.every((a) => !a[1]);
  const f = an?.funnel;
  el.append(h('h1', {}, 'Operations overview'),
    h('div', { class: 'row spread' }, h('div', { class: 'muted' }, `${dateOnly(from)} to ${dateOnly(to)} (Kigali time). Gross booking value is customer spend; platform revenue is commission only.`), h('div', { class: 'row' }, range, h('button', { class: 'b sec', onclick: () => go('dashboard') }, 'Refresh'))),
    h('h2', {}, 'Needs attention'), allClear ? h('div', { class: 'alert ok' }, 'Nothing needs attention right now.') : null,
    h('div', { class: 'grid' }, attention.filter((a) => a[1] || !allClear).map(([l, v, tab, tone, show]) => kpi(l, nfmt(v), { tone, to: show ? tab : null }))),
    h('h2', {}, 'Right now'),
    h('div', { class: 'grid' }, kpi('Drivers online', nfmt(d.drivers.online), { hint: 'seen in the last 60 s' }), kpi('Active bookings', nfmt(b.active), { hint: 'created in this period and not finished' }), kpi('Avg. time to assign a driver', secs(b.avg_assign_s)), kpi('Avg. driver arrival', secs(b.avg_arrival_s))),
    h('h2', {}, 'Demand and fulfilment'),
    h('div', { class: 'grid' }, kpi('Requests', nfmt(b.requested), { delta: pctDelta(b.requested, pb.requested), spark: spark('requested') }), kpi('Completed trips', nfmt(b.completed), { delta: pctDelta(b.completed, pb.completed), spark: spark('completed') }),
      kpi('Cancelled', nfmt(b.cancelled), { delta: pctDelta(b.cancelled, pb.cancelled), spark: spark('cancelled') }), kpi('Fulfilment rate', b.fulfilment_rate_pct == null ? '-' : b.fulfilment_rate_pct + '%', { hint: 'completed / requested' }),
      kpi('Cancellation rate', b.cancellation_rate_pct == null ? '-' : b.cancellation_rate_pct + '%')),
    h('h2', {}, 'Money'),
    h('div', { class: 'grid' }, kpi('Gross booking value', money(r.gross_booking_value), { delta: pctDelta(Number(r.gross_booking_value), Number(pr.gross_booking_value)), spark: spark('gbv'), hint: 'paid trips, before commission' }),
      kpi('Platform commission', money(r.platform_commission_revenue), { delta: pctDelta(Number(r.platform_commission_revenue), Number(pr.platform_commission_revenue)), spark: spark('commission') }),
      kpi('Cash collected by drivers', money(r.cash_collected), { spark: spark('cash') }), kpi('Driver earnings payable', money(d.driver_earnings_payable), { hint: 'owed to drivers now (ledger)' }),
      kpi('Payment success rate', p.success_rate_pct == null ? '-' : p.success_rate_pct + '%', { tone: p.success_rate_pct != null && p.success_rate_pct < 85 ? 'warn' : '', hint: 'successful / (successful + failed)' })),
    h('h2', {}, 'People'),
    h('div', { class: 'grid' }, kpi('Registered passengers', nfmt(d.passengers)), kpi('Drivers (all)', nfmt(d.drivers.total)), kpi('Verified drivers', nfmt(d.drivers.verified)),
      f ? kpi('Passengers who requested a ride', nfmt(f.requested_a_ride), { hint: nfmt(f.completed_a_ride) + ' completed one' }) : null,
      an ? kpi('Repeat riders', an.repeat_booking_rate_pct == null ? '-' : an.repeat_booking_rate_pct + '%', { hint: 'paid 2+ trips' }) : null,
      an ? kpi('Average driver rating', Number(an.ratings.driver_avg) ? an.ratings.driver_avg : '-', { hint: 'out of 5' }) : null),
    h('h2', {}, 'Zone performance'),
    table([{ h: 'Zone', f: (z) => zoneLabel(z.zone_id), s: (z) => zoneLabel(z.zone_id) }, { h: 'Requests', k: 'requests', cls: 'num' }, { h: 'Completed', k: 'completed', cls: 'num' },
      { h: 'Completion', f: (z) => (z.requests ? Math.round((z.completed / z.requests) * 100) + '%' : '-'), s: (z) => (z.requests ? z.completed / z.requests : 0), cls: 'num' }, moneyCol('Gross booking value', 'gbv')], d.zones, null, 'No bookings in this period.', { csv: 'zones' }));
  return async () => {   // runs after the page is shown: 7-day trend per KPI (one dashboard call per Kigali day, in parallel)
    const bk = dayBuckets(7);
    const my = S.nav;
    try {
      const days7 = []; for (let i = 0; i < bk.length; i += 3) {          // 3 at a time, and stop as soon as the user leaves the page
        if (my !== S.nav) return;
        days7.push(...await Promise.all(bk.slice(i, i + 3).map((x) => api('GET', '/admin/dashboard' + qs(x.from, x.to)))));
      }
      if (my !== S.nav) return;
      const series = { requested: (x) => x.bookings.requested, completed: (x) => x.bookings.completed, cancelled: (x) => x.bookings.cancelled, gbv: (x) => Number(x.revenue.gross_booking_value), commission: (x) => Number(x.revenue.platform_commission_revenue), cash: (x) => Number(x.revenue.cash_collected) };
      const names = { requested: 'Requests per day', completed: 'Completed per day', cancelled: 'Cancelled per day', gbv: 'Booking value per day', commission: 'Commission per day', cash: 'Cash collected per day' };
      for (const [k, fn] of Object.entries(series)) slots[k]?.replaceChildren(h('span', { class: 'sparkcap' }, 'last 7 days'), sparkline(days7.map(fn), { label: names[k] + ' (' + bk[0].label + ' to ' + bk[6].label + ')' }));
    } catch { Object.values(slots).forEach((s) => s.replaceChildren(h('span', { class: 'muted' }, 'Trend unavailable'))); }
  };
};

// =============================================================== LIVE MAP
V.live = async (el) => {
  await catalog();
  const names = {}; try { for (const x of (await api('GET', '/admin/drivers?status=APPROVED&limit=200')).drivers) names[x.user_id] = x.display_name || x.phone; } catch { /* drivers.view not needed to see the map */ }
  const info = h('div', { class: 'row spread' }), notice = h('div'), mapEl = h('div', { id: 'map', role: 'application', 'aria-label': 'Live map of drivers and active bookings' }), lists = h('div');
  el.append(h('h1', {}, 'Live operations'), info, notice, mapEl, lists);
  return () => {
    const token = S.nav; let tileErrors = 0, m = null, layer = null, fitted = false, timer = null;
    if (window.L) {
      m = L.map(mapEl).setView([-1.9536, 30.0927], 12);
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(m);
      tiles.on('tileerror', () => { if (++tileErrors === 3) notice.replaceChildren(note('Map tiles could not be loaded (offline, or tile.openstreetmap.org is blocked on this network). Driver and booking positions are still listed below.', 'warn')); });
      tiles.on('tileload', () => { if (tileErrors >= 3) { tileErrors = 0; notice.replaceChildren(); } });
      layer = L.layerGroup().addTo(m);
    } else { mapEl.hidden = true; notice.replaceChildren(note('The map library could not be loaded. Positions are listed below.', 'warn')); }
    const draw = (data) => {
      lists.replaceChildren(h('h2', {}, `Active bookings (${data.bookings.length})`),
        table([{ h: 'Ref', f: (x) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); bookingDetail(x.id).catch((er) => toast(er.message, true)); } }, x.ref), s: (x) => x.ref }, { h: 'Status', f: (x) => pill(x.status), s: (x) => x.status }, { h: 'Service', f: (x) => svcLabel(x.service_id), s: (x) => svcLabel(x.service_id) },
          { h: 'Driver', f: (x) => (x.driver_id ? names[x.driver_id] || short(x.driver_id) : '-'), s: (x) => names[x.driver_id] || '' }, { h: 'Pickup', f: (x) => osmLink(x.pickup_lat, x.pickup_lng) }], data.bookings, null, 'No active bookings.', { csv: 'live-bookings' }),
        h('h2', {}, `Drivers online (${data.drivers.length})`),
        table([{ h: 'Driver', f: (x) => names[x.user_id] || short(x.user_id), s: (x) => names[x.user_id] || '' }, { h: 'Last seen', f: (x) => ago(x.last_seen_at), s: (x) => -Date.parse(x.last_seen_at) }, { h: 'Position', f: (x) => osmLink(x.lat, x.lng) }], data.drivers, null, 'No drivers online.', { csv: 'live-drivers' }));
      if (layer) {
        layer.clearLayers(); const pts = [];
        data.drivers.forEach((x) => { pts.push([x.lat, x.lng]); L.circleMarker([x.lat, x.lng], { radius: 7, color: '#005a87', fillColor: '#00a1de', fillOpacity: 0.9, weight: 2 }).bindTooltip('Driver: ' + (names[x.user_id] || short(x.user_id))).addTo(layer); });
        data.bookings.forEach((x) => { pts.push([x.pickup_lat, x.pickup_lng]); L.circleMarker([x.pickup_lat, x.pickup_lng], { radius: 7, color: '#8a6500', fillColor: '#fad201', fillOpacity: 0.95, weight: 2 }).bindTooltip(`${x.ref} · ${human(x.status)} · ${svcLabel(x.service_id)}`).addTo(layer); });
        if (!fitted && pts.length) { fitted = true; m.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }); }
      }
    };
    const tick = async () => {
      if (token !== S.nav) { m?.remove(); return; }                         // user left the tab: stop polling
      if (!document.hidden) {
        try { const data = await api('GET', '/admin/live'); if (token !== S.nav) { m?.remove(); return; }
          info.replaceChildren(h('span', {}, h('b', {}, data.drivers.length), ' drivers online · ', h('b', {}, data.bookings.length), ' active bookings'), h('span', { class: 'muted' }, 'Updated ' + clock() + ' · refreshes every ' + liveSecs() + ' s')); draw(data); }
        catch (e) { if (token === S.nav) info.replaceChildren(h('span', { class: 'err' }, e.message + ' Retrying…')); }
      }
      timer = setTimeout(tick, liveSecs() * 1000);
    };
    tick();
  };
};
const osmLink = (lat, lng) => (lat != null && lng != null ? h('a', { href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`, target: '_blank', rel: 'noopener' }, `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`) : '-');

// =============================================================== BOOKINGS
const BOOKING_STATUSES = ['REQUESTED', 'SCHEDULED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS', 'COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'DISPUTED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'NO_DRIVER_FOUND', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_SYSTEM'];
V.bookings = async (el, state = {}) => {
  const q = state.q || '', st = state.status || '', limit = Number(state.limit) || 100;
  await catalog();
  const data = await api('GET', `/admin/bookings?limit=${limit}${q ? '&q=' + encodeURIComponent(q) : ''}${st ? '&status=' + encodeURIComponent(st) : ''}`);
  const inp = h('input', { type: 'search', placeholder: 'Search booking ref, phone, name, payment reference', 'aria-label': 'Search bookings', value: q, style: 'min-width:min(100%,340px)' });
  const sel = h('select', { 'aria-label': 'Status' }, [''].concat(BOOKING_STATUSES).map((s) => h('option', { value: s, selected: s === st }, s ? human(s) : 'Any status')));
  const lim = h('select', { 'aria-label': 'Rows' }, [50, 100, 200].map((n) => h('option', { value: n, selected: n === limit }, n + ' rows')));
  const apply = () => go('bookings', { q: inp.value.trim(), status: sel.value, limit: lim.value });
  el.append(h('h1', {}, 'Bookings'), filterBar(inp, sel, lim, h('button', { type: 'submit', class: 'b', onclick: apply }, 'Search'), (q || st) ? h('button', { type: 'button', class: 'b sec', onclick: () => go('bookings', {}) }, 'Clear') : null), limitNote(data.bookings.length, limit, 'bookings'),
    table([{ h: 'Ref', k: 'ref', cls: 'nowrap' }, { h: 'Status', f: (r) => pill(r.status), s: (r) => r.status, csv: (r) => r.status }, { h: 'Service', f: (r) => svcLabel(r.service_id), s: (r) => svcLabel(r.service_id) }, { h: 'Passenger', f: (r) => r.passenger || r.passenger_phone, s: (r) => r.passenger || r.passenger_phone },
      { h: 'Driver', f: (r) => r.driver || '-', s: (r) => r.driver || '' }, { h: 'Fare', f: (r) => money(r.final_fare ?? r.estimated_fare), s: (r) => Number(r.final_fare ?? r.estimated_fare ?? 0), csv: (r) => r.final_fare ?? r.estimated_fare ?? '', cls: 'num' },
      { h: 'Paid by', f: (r) => methodName(r.payment_method), s: (r) => methodName(r.payment_method) }, { h: 'Code', f: (r) => r.request_code_label || r.request_code || '', s: (r) => r.request_code_label || r.request_code || '' }, dateCol('Created', 'created_at')], data.bookings, (r) => bookingDetail(r.id), 'No bookings match.', { csv: 'bookings', search: true, sortBy: 8, sortDir: -1 }));
};
async function bookingDetail(id) {
  await catalog();
  const [b, ev] = await Promise.all([api('GET', '/bookings/' + id), api('GET', `/bookings/${id}/events`)]);
  let dlg;
  const refresh = () => { dlg.close(); return bookingDetail(id).catch((e) => toast(e.message, true)); };
  const row = (label, val) => h('div', { class: 'kv' }, h('span', { class: 'k' }, label), h('span', {}, val));
  const content = h('div', {},
    h('div', { class: 'kvgrid' }, row('Service', svcLabel(b.service_id)), row('Fare', `${money(b.final_fare ?? b.estimated_fare)} ${b.fare_is_final ? '(final)' : '(estimate)'}`), row('Paid by', methodName(b.payment_method)), row('Distance', (b.distance_m / 1000).toFixed(1) + ' km'),
      row('From', b.pickup.name || `${b.pickup.lat}, ${b.pickup.lng}`), row('To', b.destination.name || `${b.destination.lat}, ${b.destination.lng}`),
      b.request_code ? row('Request code', `${b.request_code.code} · ${b.request_code.label}`) : null, b.driver ? row('Driver', `${b.driver.name}${b.vehicle?.plate ? ' · ' + b.vehicle.plate : ''}`) : null,
      b.payment ? row('Payment', [pill(b.payment.status), ' ref ' + b.payment.reference]) : null),
    b.abasare ? h('div', { class: 'card' }, h('b', {}, `Abasare · ${b.abasare.mode === 'hourly' ? b.abasare.hours + ' h hire' : 'drive me home'}`),
      h('div', {}, `Customer car: ${b.abasare.vehicle.plate} · ${[b.abasare.vehicle.color, b.abasare.vehicle.make, b.abasare.vehicle.model].filter(Boolean).join(' ')} · ${b.abasare.vehicle.vehicle_class}, ${b.abasare.vehicle.transmission}`),
      b.abasare.overtime_blocks ? h('div', {}, `Overtime blocks: ${b.abasare.overtime_blocks}`) : null,
      b.abasare.handovers.length ? b.abasare.handovers.map((x) => h('div', { class: 'handover' }, h('b', {}, `${human(x.phase)} check`), ` · odometer ${x.odometer_km} km · fuel ${x.fuel_percent}% · owner: `, pill(x.owner_response || 'not yet', x.owner_response === 'issue' ? 'bad' : ''),
        x.notes ? h('div', {}, 'Driver notes: ' + x.notes) : null, x.owner_note ? h('div', { class: 'err' }, 'Owner note: ' + x.owner_note) : null,
        h('div', { class: 'row' }, x.photos.map((u, i) => h('a', { href: u, target: '_blank', rel: 'noopener' }, 'photo ' + (i + 1)))))) : h('div', { class: 'muted' }, 'No car check recorded yet.')) : null,
    h('div', { class: 'row' },
      can('bookings.dispatch') && h('button', { class: 'b sec', onclick: async () => {
        let drivers = []; try { drivers = (await api('GET', '/admin/drivers?status=APPROVED&limit=200')).drivers; } catch (e) { toast('Could not load drivers: ' + e.message, true); return; }
        if (!drivers.length) { toast('There are no approved drivers to assign.', true); return; }
        drivers.sort((a, c) => (c.is_online - a.is_online) || String(a.display_name).localeCompare(c.display_name));
        const a = await ask('Assign a driver', { reason: true, confirmText: 'Assign', fields: [{ name: 'driver_id', label: 'Driver', type: 'select', required: true, options: [{ value: '', label: 'Choose a driver…' }].concat(drivers.map((d) => ({ value: d.user_id, label: `${d.is_online ? '● ' : '○ '}${d.display_name || d.phone} · ${d.phone}${d.plate ? ' · ' + d.plate : ''}` }))), help: '● online now, ○ offline. The driver must be eligible to work.' }] });
        if (a) act(() => api('POST', `/admin/bookings/${id}/assign`, { driver_id: a.driver_id, reason: a.reason }), refresh); } }, 'Assign / reassign'),
      can('bookings.dispatch') && h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/bookings/${id}/restart-search`), refresh) }, 'Restart search'),
      can('bookings.dispatch') && h('button', { class: 'b sec', onclick: async () => { const a = await ask('PIN override (logged exception)', { reason: true, danger: true, confirmText: 'Override', message: 'Only use this when the passenger cannot read out the trip PIN. It is recorded in the audit log.' }); if (a) act(() => api('POST', `/admin/bookings/${id}/pin-override`, { reason: a.reason }), refresh); } }, 'PIN override'),
      can('bookings.dispatch') && h('button', { class: 'b red', onclick: async () => { const a = await ask('Cancel this booking?', { reason: true, danger: true, confirmText: 'Cancel booking' }); if (a) act(() => api('POST', `/admin/bookings/${id}/cancel`, { reason: a.reason }), refresh); } }, 'Cancel booking'),
      can('support.handle') && h('button', { class: 'b sec', onclick: async () => { const a = await ask('Mark as disputed', { reason: true }); if (a) act(() => api('POST', `/admin/bookings/${id}/dispute`, { reason: a.reason }), refresh); } }, 'Mark disputed'),
      can('finance.refund.request') && h('button', { class: 'b sec', onclick: async () => {
        const fare = Number(b.final_fare ?? b.estimated_fare ?? 0);
        const a = await ask('Request refund (needs a second person to approve)', { reason: true, confirmText: 'Request refund', fields: [{ name: 'amount', label: 'Refund amount (RWF)', type: 'number', integer: true, required: true, min: 1, max: fare || undefined, help: fare ? 'The trip cost ' + money(fare) + '.' : null }, { name: 'driver_clawback', label: 'Take back from the driver (RWF, 0 if none)', type: 'number', integer: true, min: 0, value: 0 }] });
        if (a) act(() => api('POST', '/admin/finance/refunds', { booking_id: id, amount: a.amount, reason: a.reason, driver_clawback: a.driver_clawback || 0 })); } }, 'Request refund')),
    h('h2', {}, 'Timeline'), table([dateCol('When', 'created_at'), { h: 'Event', f: (e) => (e.type === 'status_change' ? `${human(e.from_status || '')} → ${human(e.to_status)}` : human(e.type)) }, { h: 'By', f: (e) => human(e.actor_role) }, { h: 'Reason', k: 'reason' }], ev.events, null, 'No events.', { sort: false }));
  dlg = openDialog([`${b.ref} `, pill(b.status)], content, { width: 860, key: 'booking' });
}

// =============================================================== DRIVERS
const DRIVER_STATUSES = ['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUIRED', 'APPROVED', 'SUSPENDED', 'EXPIRED_INELIGIBLE', 'REJECTED', 'DEACTIVATED', 'APPLICATION_STARTED'];
V.drivers = async (el, state = {}) => {
  const st = state.status ?? 'DOCUMENTS_SUBMITTED', q = state.q || '';
  const data = await api('GET', `/admin/drivers?limit=200${st ? '&status=' + st : ''}${q ? '&q=' + encodeURIComponent(q) : ''}`);
  const sel = h('select', { 'aria-label': 'Status', onchange: () => go('drivers', { status: sel.value, q: inp.value.trim() }) }, [''].concat(DRIVER_STATUSES).map((s) => h('option', { value: s, selected: s === st }, s ? human(s) : 'All statuses')));
  const inp = h('input', { type: 'search', placeholder: 'Name or phone', 'aria-label': 'Search drivers', value: q });
  el.append(h('h1', {}, 'Drivers'), filterBar(sel, inp, h('button', { type: 'submit', class: 'b', onclick: () => go('drivers', { status: sel.value, q: inp.value.trim() }) }, 'Search')), limitNote(data.drivers.length, 200, 'drivers'),
    table([{ h: 'Name', k: 'display_name' }, { h: 'Phone', k: 'phone', cls: 'nowrap' }, { h: 'Status', f: (r) => pill(r.status), s: (r) => r.status, csv: (r) => r.status }, { h: 'Vehicle', f: (r) => [r.plate, human(r.vehicle_type)].filter((x) => x && x !== '').join(' · ') || '-', s: (r) => r.plate || '' },
      { h: 'Online', f: (r) => (r.is_online ? pill('online', 'ok') : h('span', { class: 'muted' }, 'offline')), s: (r) => (r.is_online ? 1 : 0), csv: (r) => (r.is_online ? 'yes' : 'no') }, { h: 'Rating', k: 'rating_avg', cls: 'num' }, { h: 'Trips', k: 'completed_count', cls: 'num' }, dateCol('Submitted', 'submitted_at')], data.drivers, (r) => driverDetail(r.user_id), 'No drivers with this status.', { csv: 'drivers', search: true }));
};
async function driverDetail(id) {
  const x = await api('GET', '/admin/drivers/' + id);
  let dlg; const refresh = () => { dlg.close(); return driverDetail(id).catch((e) => toast(e.message, true)); };
  const status = x.profile.status, review = can('drivers.review');
  const decide = (decision, title, needReason, danger, confirmText) => async () => { const a = await ask(title, { reason: needReason, danger, confirmText }); if (a) act(() => api('POST', `/admin/drivers/${id}/decision`, { decision, reason: a.reason }), refresh); };
  const btn = (show, cls, label, fn) => (review && show ? h('button', { class: 'b ' + cls, onclick: fn }, label) : null);
  const content = h('div', {},
    h('div', {}, `${x.profile.phone} · rating ${x.profile.rating_avg} (${x.profile.rating_count}) · completed ${x.profile.completed_count} · cancelled ${x.profile.cancel_count}`),
    x.profile.status_reason ? h('div', { class: 'muted' }, 'Last reason: ' + x.profile.status_reason) : null,
    h('div', { class: 'alert ' + (x.permission.can_work ? 'ok' : 'bad') }, x.permission.can_work ? 'Permitted to work' : 'Not dispatchable: ' + x.permission.reasons.join(', ').replace(/_/g, ' ') + (x.permission.missing_documents.length ? ' · missing or unapproved: ' + x.permission.missing_documents.map(human).join(', ') : '') + (x.permission.expired_documents.length ? ' · expired: ' + x.permission.expired_documents.map(human).join(', ') : '')),
    x.profile.abasare_status && x.profile.abasare_status !== 'none' ? h('div', { class: 'card' }, h('h2', {}, 'Umusare application ', pill(x.profile.abasare_status)),
      h('div', {}, `Licence since ${x.profile.abasare_skills.licence_since} · ${x.profile.abasare_skills.years_experience} yrs experience · returns by ${x.profile.abasare_skills.return_mode}`),
      h('div', {}, `Can drive: ${(x.profile.abasare_skills.classes || []).join(', ')} · ${(x.profile.abasare_skills.transmissions || []).join(', ')}`),
      review ? h('div', { class: 'row' }, ...[['approve', 'Approve as Umusare', false, 'b', ['pending']], ['reject', 'Reject', true, 'b red', ['pending']], ['suspend', 'Suspend', true, 'b red', ['approved']], ['reinstate', 'Reinstate', false, 'b sec', ['suspended']]].filter((a) => a[4].includes(x.profile.abasare_status))
        .map(([dec, label, need, cls]) => h('button', { class: cls, onclick: async () => { const a = await ask(label + '?', { reason: need, danger: need }); if (a) act(() => api('POST', `/admin/drivers/${id}/abasare-decision`, { decision: dec, reason: a.reason }), refresh); } }, label))) : null) : null,
    h('h2', {}, 'Vehicle'), table([{ h: 'Plate', k: 'plate' }, { h: 'Type', f: (v) => human(v.vehicle_type) }, { h: 'Make', f: (v) => [v.make, v.model, v.color].filter(Boolean).join(' ') }, { h: 'Seats', k: 'capacity' }, { h: 'Status', f: (v) => pill(v.status) }], x.vehicles, null, 'No vehicle registered.', { sort: false }),
    h('h2', {}, 'Documents (links expire in 5 minutes)'),
    table([{ h: 'Type', f: (r) => human(r.doc_type), s: (r) => r.doc_type }, { h: 'Status', f: (r) => [pill(r.review_status), r.superseded ? h('span', { class: 'muted' }, ' replaced') : null], s: (r) => r.review_status },
      { h: 'Expiry', f: (r) => (r.expiry_date ? [dateOnly(r.expiry_date), new Date(r.expiry_date) < new Date() ? [' ', pill('expired', 'bad')] : null] : '-'), s: (r) => (r.expiry_date ? Date.parse(r.expiry_date) : 0) }, { h: 'Note', k: 'review_note' }, { h: 'File', f: (r) => h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'View') },
      { h: '', f: (r) => review && !r.superseded ? h('span', { class: 'row' }, r.review_status !== 'approved' ? h('button', { class: 'b', onclick: () => act(() => api('POST', `/admin/documents/${r.id}/review`, { decision: 'approved' }), refresh) }, 'Approve') : null,
        h('button', { class: 'b sec', onclick: async () => { const a = await ask('Reject document or ask for a new upload', { reason: true, confirmText: 'Send to driver', message: 'The reason is shown to the driver so they know what to fix.', fields: [{ name: 'decision', label: 'What should happen?', type: 'select', value: 'resubmit', options: [{ value: 'resubmit', label: 'Ask the driver to upload a new file' }, { value: 'rejected', label: 'Reject permanently' }] }] }); if (a) act(() => api('POST', `/admin/documents/${r.id}/review`, { decision: a.decision, note: a.reason }), refresh); } }, 'Reject')) : '' }], x.documents, null, 'No documents uploaded.', { sort: false }),
    h('div', { class: 'row' },
      btn(status === 'DOCUMENTS_SUBMITTED', 'sec', 'Start review', () => act(() => api('POST', `/admin/drivers/${id}/start-review`), refresh)),
      btn(['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW'].includes(status), '', 'Approve driver', decide('approve', 'Approve this driver?', false, false, 'Approve')),
      btn(['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW'].includes(status), 'sec', 'Need more info', decide('info_required', 'Ask for more information', true, false, 'Send request')),
      btn(['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUIRED'].includes(status), 'red', 'Reject', decide('reject', 'Reject application', true, true, 'Reject')),
      btn(['APPROVED', 'EXPIRED_INELIGIBLE'].includes(status), 'red', 'Suspend', decide('suspend', 'Suspend driver', true, true, 'Suspend')),
      btn(['SUSPENDED', 'EXPIRED_INELIGIBLE'].includes(status), 'sec', 'Reinstate', decide('reinstate', 'Reinstate driver', false, false, 'Reinstate'))),
    h('h2', {}, 'Status history'), table([dateCol('When', 'created_at'), { h: 'From', f: (r) => human(r.from_status) }, { h: 'To', f: (r) => human(r.to_status) }, { h: 'Reason', k: 'reason' }], x.history, null, 'No history.', { sort: false }));
  dlg = openDialog([`${x.profile.display_name || x.profile.legal_name || 'Driver'} `, pill(status)], content, { width: 900, key: 'driver' });
}
V.abasare = async (el, state = {}) => {
  const st = state.status || 'pending';
  const d = await api('GET', '/admin/abasare/applications?status=' + st);
  const sel = h('select', { 'aria-label': 'Status', onchange: () => go('abasare', { status: sel.value }) }, ['pending', 'approved', 'rejected', 'suspended'].map((s) => h('option', { value: s, selected: s === st }, human(s))));
  el.append(h('h1', {}, 'Abasare applications'), note('Abasare drivers drive customers in the customer\'s own car. Approve only after the driving licence (held 2+ years), national ID, photo and a valid police clearance are verified. Open a driver to review documents.'),
    filterBar(h('label', {}, 'Status ', sel)),
    table([{ h: 'Name', k: 'display_name' }, { h: 'Phone', k: 'phone', cls: 'nowrap' }, { h: 'Account', f: (r) => pill(r.account_status), s: (r) => r.account_status }, { h: 'Licence since', f: (r) => r.abasare_skills.licence_since, s: (r) => String(r.abasare_skills.licence_since) },
      { h: 'Experience', f: (r) => r.abasare_skills.years_experience + ' yrs', s: (r) => Number(r.abasare_skills.years_experience), cls: 'num' }, { h: 'Cars', f: (r) => (r.abasare_skills.classes || []).join(', ') + ' / ' + (r.abasare_skills.transmissions || []).join(', ') }, dateCol('Applied', 'abasare_applied_at')], d.applications, (r) => driverDetail(r.user_id), 'No applications with this status.', { csv: 'abasare-applications' }));
};

// =============================================================== PASSENGERS
V.users = async (el, state = {}) => {
  const inp = h('input', { type: 'search', placeholder: 'Name, phone or email (min 2 chars)', 'aria-label': 'Search passengers', value: state.q || '', style: 'min-width:min(100%,300px)' }), out = h('div');
  const go1 = async () => {
    const q = inp.value.trim(); S.state = { q };
    if (q.length < 2) { out.replaceChildren(note('Type at least 2 characters.')); return; }
    out.replaceChildren(loading('Searching'));
    try { const d = await api('GET', '/admin/users?q=' + encodeURIComponent(q)); out.replaceChildren(table([{ h: 'Name', k: 'display_name' }, { h: 'Phone', k: 'phone', cls: 'nowrap' }, { h: 'Email', k: 'email' }, { h: 'Status', f: (u) => pill(u.status), s: (u) => u.status }, { h: 'Roles', f: (u) => u.roles.map(human).join(', ') }], d.users, userDetail, 'Nobody matches this search.', { csv: 'users' })); }
    catch (e) { out.replaceChildren(errorPanel(e, go1)); }
  };
  el.append(h('h1', {}, 'Passengers and users'), filterBar(inp, h('button', { type: 'submit', class: 'b', onclick: go1 }, 'Search')), out);
  if (state.q) go1(); else out.append(h('div', { class: 'empty' }, 'Search by name, phone number or email to find an account.'));
};
async function userDetail(u) {
  const x = await api('GET', '/admin/users/' + u.id); let dlg;
  const content = h('div', {}, h('div', {}, [x.user.phone || '', ' · status ', pill(x.user.status)]), h('h2', {}, 'Recent bookings'),
    table([{ h: 'Ref', k: 'ref', cls: 'nowrap' }, { h: 'Status', f: (r) => pill(r.status) }, moneyCol('Fare', 'final_fare'), dateCol('Date', 'created_at')], x.bookings.map((r) => ({ ...r, final_fare: r.final_fare ?? r.estimated_fare })), null, 'No bookings yet.', { sort: false }),
    h('div', { class: 'row' }, can('users.restrict') && h('button', { class: 'b red', onclick: async () => {
      const a = await ask('Change account status', { reason: true, danger: true, confirmText: 'Change status', fields: [{ name: 'status', label: 'New status', type: 'select', value: x.user.status === 'active' ? 'restricted' : 'active', options: [{ value: 'restricted', label: 'Restricted (cannot book)' }, { value: 'deactivated', label: 'Deactivated' }, { value: 'active', label: 'Active' }] }] });
      if (a) act(() => api('POST', `/admin/users/${u.id}/status`, { status: a.status, reason: a.reason }), () => dlg.close()); } }, 'Change account status')));
  dlg = openDialog(x.user.display_name || x.user.phone || 'Account', content, { width: 700, key: 'user' });
}

// =============================================================== SUPPORT
V.support = async (el, state = {}) => {
  const q = state.q || '', st = state.status || '';
  const data = await api('GET', '/admin/support/cases?x=1' + (q ? '&q=' + encodeURIComponent(q) : '') + (st ? '&status=' + st : ''));
  const inp = h('input', { type: 'search', placeholder: 'Case, booking ref, payment reference, phone', 'aria-label': 'Search cases', value: q, style: 'min-width:min(100%,320px)' });
  const sel = h('select', { 'aria-label': 'Status' }, ['', 'open', 'in_progress', 'awaiting_user', 'resolved', 'closed'].map((s) => h('option', { value: s, selected: s === st }, s ? human(s) : 'Any status')));
  const apply = () => go('support', { q: inp.value.trim(), status: sel.value });
  el.append(h('h1', {}, 'Support cases'), filterBar(inp, sel, h('button', { type: 'submit', class: 'b', onclick: apply }, 'Search')), limitNote(data.cases.length, 100, 'cases'),
    table([{ h: 'Case', k: 'ref', cls: 'nowrap' }, { h: 'Priority', f: (c) => pill(c.priority), s: (c) => ({ urgent: 0, high: 1, normal: 2, low: 3 })[c.priority] ?? 4, csv: (c) => c.priority }, { h: 'Status', f: (c) => pill(c.status), s: (c) => c.status, csv: (c) => c.status }, { h: 'Category', f: (c) => human(c.category), s: (c) => c.category }, { h: 'Subject', k: 'subject' }, { h: 'Reporter', k: 'reporter' },
      { h: 'SLA due', f: (c) => h('span', { class: c.overdue ? 'late' : '' }, when(c.sla_due_at), c.overdue ? ' (overdue)' : ''), s: (c) => Date.parse(c.sla_due_at), csv: (c) => c.sla_due_at }, { h: '', f: (c) => (c.sensitive ? pill('sensitive', 'bad') : ''), csv: (c) => (c.sensitive ? 'sensitive' : '') }], data.cases, (c) => caseDetail(c.id), 'No cases match.', { csv: 'support-cases', search: true }));
};
async function caseDetail(id) {
  const x = await api('GET', '/admin/support/cases/' + id); let dlg;
  const reply = h('textarea', { rows: 3, placeholder: 'Reply to customer (visible to them)', 'aria-label': 'Reply to customer', style: 'width:100%' }), note1 = h('textarea', { rows: 2, placeholder: 'Internal note (staff only)', 'aria-label': 'Internal note', style: 'width:100%' });
  const status = h('select', { 'aria-label': 'New status' }, ['', 'in_progress', 'awaiting_user', 'resolved', 'closed'].map((s) => h('option', { value: s }, s ? human(s) : 'Status unchanged'))), res = h('input', { placeholder: 'Resolution (required when resolving)', 'aria-label': 'Resolution', style: 'flex:1;min-width:200px' }), err = h('div', { class: 'ferr', role: 'alert' });
  const save = () => {
    err.textContent = '';
    if (['resolved', 'closed'].includes(status.value) && !res.value.trim()) { err.textContent = 'Write the resolution before resolving or closing the case.'; res.focus(); return; }
    if (!reply.value.trim() && !note1.value.trim() && !status.value && !res.value.trim()) { err.textContent = 'Nothing to save yet.'; return; }
    return act(() => api('POST', `/admin/support/cases/${id}/update`, { reply: reply.value.trim() || undefined, internal_note: note1.value.trim() || undefined, status: status.value || undefined, resolution: res.value.trim() || undefined, assign_to_me: true }), () => { dlg.close(); caseDetail(id).catch((e) => toast(e.message, true)); });
  };
  const content = h('div', {}, h('div', {}, [pill(x.case.priority), ' ', pill(x.case.status), ` ${human(x.case.category)} · SLA due ${when(x.case.sla_due_at)}`]),
    h('div', { class: 'thread' }, x.events.map((e) => h('div', { class: 'msg' + (e.visibility === 'internal' ? ' internal' : '') }, h('div', { class: 'muted' }, human(e.kind) + (e.visibility === 'internal' ? ' (internal, staff only)' : '') + ' · ' + when(e.created_at)), h('div', {}, e.body || (e.file_key ? 'Evidence attached' : ''))))),
    reply, note1, h('div', { class: 'row' }, status, res), err, h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => dlg.close() }, 'Close'), h('button', { class: 'b', onclick: save }, 'Save')));
  dlg = openDialog(x.case.ref + ' · ' + x.case.subject, content, { width: 760, key: 'case' });
}

// =============================================================== SAFETY
V.safety = async (el) => {
  const d = await api('GET', '/admin/safety/incidents'); const respond = can('safety.respond');
  el.append(h('h1', {}, 'Safety incidents'), note('SOS alerts are recorded here. The platform never reports that police or ambulance were contacted: record in the resolution what you actually did.', 'danger'),
    table([{ h: 'Ref', k: 'ref', cls: 'nowrap' }, { h: 'Kind', f: (i) => pill(i.kind, i.kind === 'sos' ? 'bad' : ''), s: (i) => i.kind, csv: (i) => i.kind }, { h: 'Status', f: (i) => pill(i.status), s: (i) => i.status, csv: (i) => i.status }, { h: 'Reporter', k: 'reporter' }, { h: 'Location', f: (i) => osmLink(i.lat, i.lng), csv: (i) => (i.lat != null ? `${i.lat},${i.lng}` : '') }, dateCol('When', 'created_at'),
      { h: '', f: (i) => respond && i.status !== 'resolved' ? h('span', { class: 'row' }, i.status === 'open' && h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/safety/incidents/${i.id}/update`, { status: 'acknowledged' }), () => go('safety')) }, 'Acknowledge'),
        h('button', { class: 'b', onclick: async () => { const a = await ask('Resolve incident ' + i.ref, { reason: true, confirmText: 'Resolve', message: 'Describe what was done, e.g. who you called and when.' }); if (a) act(() => api('POST', `/admin/safety/incidents/${i.id}/update`, { status: 'resolved', resolution: a.reason }), () => go('safety')); } }, 'Resolve')) : '' }], d.incidents, null, 'No safety incidents.', { csv: 'safety-incidents' }));
};

// =============================================================== PASSENGER USERS: nothing else here

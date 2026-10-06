'use strict';
// Rwanda Mobility operations console. No framework, no build step. All dynamic text is inserted with textContent (XSS-safe).
const API = '/api/v1';
const S = { access: sessionStorage.getItem('rm_a'), refresh: sessionStorage.getItem('rm_r'), roles: JSON.parse(sessionStorage.getItem('rm_roles') || '[]'), tab: 'dashboard' };
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const money = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US') + ' RWF');
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Kigali' }) : '-');
const pill = (t, cls = '') => h('span', { class: 'pill ' + cls }, String(t).replace(/_/g, ' '));
const statusCls = (s) => (/CANCEL|REJECT|SUSPEND|FAIL|NO_DRIVER|EXPIRED|open|urgent/i.test(s) ? 'bad' : /PENDING|REVIEW|INFO|SEARCH|REQUEST|pending/i.test(s) ? 'warn' : '');

async function api(method, path, body, retry = true) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(S.access ? { authorization: 'Bearer ' + S.access } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && retry && S.refresh) { if (await doRefresh()) return api(method, path, body, false); logout(); throw new Error('Session expired'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data?.error?.message || 'Request failed (' + r.status + ')');
  return data;
}
async function doRefresh() {
  try {
    const r = await fetch(API + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: S.refresh }) });
    if (!r.ok) return false; save(await r.json()); return true;
  } catch { return false; }
}
function save(t) { S.access = t.access_token; S.refresh = t.refresh_token; S.roles = t.roles || S.roles; sessionStorage.setItem('rm_a', S.access); sessionStorage.setItem('rm_r', S.refresh); sessionStorage.setItem('rm_roles', JSON.stringify(S.roles)); }
function logout() { if (S.access) fetch(API + '/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + S.access } }).catch(() => {}); sessionStorage.clear(); S.access = S.refresh = null; render(); }
const can = (...roles) => S.roles.includes('super_admin') || roles.some((r) => S.roles.includes(r));

// ---- confirm dialog with optional reason (destructive actions need typed intent) ----
function ask(title, { reason = false, confirmText = 'Confirm', danger = false, fields = [] } = {}) {
  return new Promise((res) => {
    const d = h('dialog', {});
    const inputs = {};
    const rs = reason ? h('textarea', { rows: 3, placeholder: 'Reason (required, kept in the audit log)', style: 'width:100%' }) : null;
    const f = fields.map((x) => { inputs[x.name] = h(x.type === 'select' ? 'select' : 'input', { placeholder: x.label, type: x.type === 'number' ? 'number' : 'text', style: 'width:100%;margin:4px 0' }, x.options?.map((o) => h('option', { value: o }, o))); return h('label', {}, x.label, inputs[x.name]); });
    const err = h('div', { class: 'err' });
    d.append(h('h2', {}, title), ...f, rs, err, h('div', { class: 'row' },
      h('button', { class: 'b ' + (danger ? 'red' : ''), onclick: () => {
        if (reason && (!rs.value || rs.value.trim().length < 5)) { err.textContent = 'Please give a reason (min 5 characters).'; return; }
        const out = { reason: rs?.value.trim() }; for (const x of fields) out[x.name] = x.type === 'number' ? Number(inputs[x.name].value) : inputs[x.name].value;
        d.close(); d.remove(); res(out);
      } }, confirmText),
      h('button', { class: 'b sec', onclick: () => { d.close(); d.remove(); res(null); } }, 'Cancel')));
    document.body.append(d); d.showModal();
  });
}
async function act(fn, after) { try { await fn(); toast('Done'); if (after) after(); } catch (e) { toast(e.message, true); } }
function toast(msg, bad) { const t = h('div', { class: bad ? 'err' : 'ok', style: 'position:fixed;right:16px;bottom:16px;background:var(--card);border:1px solid var(--line);padding:10px 14px;border-radius:10px;z-index:99;max-width:360px' }, msg); document.body.append(t); setTimeout(() => t.remove(), 4000); }

function table(cols, rows, onRow) {
  return h('div', { class: 'tbl' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c.h)))),
    h('tbody', {}, rows.length ? rows.map((r) => h('tr', { class: onRow ? 'click' : '', onclick: onRow ? () => onRow(r) : null }, cols.map((c) => h('td', {}, c.f ? c.f(r) : r[c.k] ?? '-')))) : h('tr', {}, h('td', { colspan: cols.length }, 'Nothing here yet.')))));
}
const kpi = (l, v, warn) => h('div', { class: 'card kpi' + (warn ? ' warn' : '') }, h('div', { class: 'v' }, v ?? '-'), h('div', { class: 'l' }, l));

// ---------------- views ----------------
const TABS = [
  ['dashboard', 'Overview', ['analytics.view']], ['live', 'Live map', ['dispatcher']], ['bookings', 'Bookings', ['dispatcher', 'support_agent', 'support_lead']],
  ['drivers', 'Drivers', ['driver_verifier', 'dispatcher', 'support_agent', 'support_lead', 'finance_officer']], ['abasare', 'Abasare', ['driver_verifier']], ['users', 'Passengers', ['support_agent', 'support_lead']],
  ['support', 'Support', ['support_agent', 'support_lead']], ['safety', 'Safety', ['support_lead', 'dispatcher']],
  ['pricing', 'Pricing', ['business_manager', 'finance_approver']], ['promos', 'Promotions', ['business_manager']],
  ['finance', 'Finance', ['finance_officer', 'finance_approver']], ['business', 'Business & fleets', ['business_manager']],
  ['privacy', 'Privacy', ['support_lead']], ['settings', 'Settings', []], ['audit', 'Audit log', []], ['staff', 'Staff', []],
];
const V = {};
V.dashboard = async (el) => {
  const d = await api('GET', '/admin/dashboard'); const b = d.bookings, p = d.payments, r = d.revenue;
  el.append(h('h1', {}, 'Operations overview'), h('div', { class: 'banner' }, 'Last 30 days. Gross booking value is customer spend; platform revenue is commission only.'),
    h('div', { class: 'grid' }, kpi('Registered passengers', d.passengers), kpi('Drivers (total)', d.drivers.total), kpi('Verified drivers', d.drivers.verified), kpi('Pending verification', d.drivers.pending, d.drivers.pending > 10),
      kpi('Online now', d.drivers.online), kpi('Active bookings', b.active), kpi('Completed', b.completed), kpi('Cancelled', b.cancelled), kpi('No driver found', b.no_driver, b.no_driver > 0),
      kpi('Fulfilment rate', b.fulfilment_rate_pct == null ? '-' : b.fulfilment_rate_pct + '%'), kpi('Avg. time to assign', b.avg_assign_s + 's'), kpi('Avg. driver arrival', b.avg_arrival_s + 's'),
      kpi('Payment success', p.success_rate_pct == null ? '-' : p.success_rate_pct + '%'), kpi('Gross booking value', money(r.gross_booking_value)), kpi('Platform commission', money(r.platform_commission_revenue)),
      kpi('Cash collected', money(r.cash_collected)), kpi('Driver earnings payable', money(d.driver_earnings_payable)), kpi('Refunds pending', d.refunds.pending_refunds, d.refunds.pending_refunds > 0),
      kpi('Disputed trips', d.disputes, d.disputes > 0), kpi('Support backlog', d.support.backlog), kpi('Support overdue', d.support.overdue, d.support.overdue > 0), kpi('Open safety incidents', d.safety_incidents.open, d.safety_incidents.open > 0)),
    h('h2', {}, 'Zone performance'), table([{ h: 'Zone', k: 'zone_id' }, { h: 'Requests', k: 'requests' }, { h: 'Completed', k: 'completed' }, { h: 'Gross booking value', f: (z) => money(z.gbv) }], d.zones));
};
V.live = async (el) => {
  el.append(h('h1', {}, 'Live operations'), h('div', { id: 'map' }), h('div', { id: 'liveinfo', class: 'row' }));
  if (!window.L) { el.append(h('div', { class: 'banner' }, 'Map library not reachable (offline?). Showing a table instead.')); }
  const m = window.L ? L.map('map').setView([-1.9536, 30.0927], 12) : null;
  if (m) L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(m);
  const layer = m ? L.layerGroup().addTo(m) : null;
  async function tick() {
    if (S.tab !== 'live') return; try {
      const d = await api('GET', '/admin/live'); $('#liveinfo').textContent = `${d.drivers.length} drivers online · ${d.bookings.length} active bookings`;
      if (layer) { layer.clearLayers(); d.drivers.forEach((x) => L.circleMarker([x.lat, x.lng], { radius: 6, color: '#00704a' }).bindTooltip('driver ' + x.user_id.slice(0, 6)).addTo(layer)); d.bookings.forEach((x) => L.marker([x.pickup_lat, x.pickup_lng]).bindTooltip(x.ref + ' · ' + x.status).addTo(layer)); }
    } catch (e) { $('#liveinfo').textContent = e.message; }
    setTimeout(tick, 5000);
  } tick();
};
V.bookings = async (el, state = {}) => {
  const q = state.q || ''; const st = state.status || '';
  const data = await api('GET', `/admin/bookings?limit=100${q ? '&q=' + encodeURIComponent(q) : ''}${st ? '&status=' + st : ''}`);
  const inp = h('input', { placeholder: 'Search booking ref, phone, name, payment reference', value: q, style: 'min-width:320px' });
  const sel = h('select', {}, ['', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'IN_PROGRESS', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'DISPUTED', 'NO_DRIVER_FOUND', 'CANCELLED_BY_PASSENGER'].map((s) => h('option', { value: s, selected: s === st }, s || 'any status')));
  const go = () => { $('#view').replaceChildren(); V.bookings($('#view'), { q: inp.value, status: sel.value }); };
  el.append(h('h1', {}, 'Bookings'), h('div', { class: 'row' }, inp, sel, h('button', { class: 'b', onclick: go }, 'Search')),
    table([{ h: 'Ref', k: 'ref' }, { h: 'Status', f: (r) => pill(r.status, statusCls(r.status)) }, { h: 'Service', k: 'service_id' }, { h: 'Passenger', f: (r) => r.passenger || r.passenger_phone }, { h: 'Driver', f: (r) => r.driver || '-' }, { h: 'Fare', f: (r) => money(r.final_fare ?? r.estimated_fare) }, { h: 'Pay', k: 'payment_method' }, { h: 'Created', f: (r) => when(r.created_at) }], data.bookings, (r) => bookingDetail(r.id)));
};
async function bookingDetail(id) {
  const [b, ev] = await Promise.all([api('GET', '/bookings/' + id), api('GET', `/bookings/${id}/events`)]);
  const d = h('dialog', { style: 'max-width:760px' });
  const close = () => { d.close(); d.remove(); };
  const refresh = () => { close(); bookingDetail(id); };
  d.append(h('h2', {}, `${b.ref} · `, pill(b.status, statusCls(b.status))),
    h('div', {}, `Fare ${money(b.final_fare ?? b.estimated_fare)} ${b.fare_is_final ? '(final)' : '(estimate)'} · ${b.payment_method} · ${(b.distance_m / 1000).toFixed(1)} km`),
    h('div', {}, `From: ${b.pickup.name || b.pickup.lat + ',' + b.pickup.lng}  →  ${b.destination.name || b.destination.lat + ',' + b.destination.lng}`),
    b.driver ? h('div', {}, `Driver: ${b.driver.name} · ${b.vehicle?.plate || ''}`) : null,
    b.payment ? h('div', {}, `Payment: ${b.payment.status} · ref ${b.payment.reference}`) : null,
    b.abasare ? h('div', { class: 'card' }, h('b', {}, `Abasare · ${b.abasare.mode === 'hourly' ? b.abasare.hours + ' h hire' : 'drive me home'}`),
      h('div', {}, `Customer car: ${b.abasare.vehicle.plate} · ${[b.abasare.vehicle.color, b.abasare.vehicle.make, b.abasare.vehicle.model].filter(Boolean).join(' ')} · ${b.abasare.vehicle.vehicle_class}, ${b.abasare.vehicle.transmission}`),
      b.abasare.overtime_blocks ? h('div', {}, `Overtime blocks: ${b.abasare.overtime_blocks}`) : null,
      b.abasare.handovers.length ? b.abasare.handovers.map((x) => h('div', { style: 'margin-top:8px' }, h('b', {}, `${x.phase} check`), ` · odometer ${x.odometer_km} km · fuel ${x.fuel_percent}% · owner: `, pill(x.owner_response || 'not yet', x.owner_response === 'issue' ? 'bad' : ''),
        x.notes ? h('div', {}, 'Driver notes: ' + x.notes) : null, x.owner_note ? h('div', { class: 'err' }, 'Owner note: ' + x.owner_note) : null,
        h('div', { class: 'row' }, x.photos.map((u, i) => h('a', { href: u, target: '_blank', rel: 'noopener' }, 'photo ' + (i + 1)))))) : h('div', { class: 'muted' }, 'No car check recorded yet.')) : null,
    h('div', { class: 'row' },
      can('dispatcher') && h('button', { class: 'b sec', onclick: async () => { const a = await ask('Assign a driver', { reason: true, fields: [{ name: 'driver_id', label: 'Driver user id' }] }); if (a) act(() => api('POST', `/admin/bookings/${id}/assign`, { driver_id: a.driver_id, reason: a.reason }), refresh); } }, 'Assign / reassign'),
      can('dispatcher') && h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/bookings/${id}/restart-search`), refresh) }, 'Restart search'),
      can('dispatcher') && h('button', { class: 'b sec', onclick: async () => { const a = await ask('PIN override (logged exception)', { reason: true, danger: true, confirmText: 'Override' }); if (a) act(() => api('POST', `/admin/bookings/${id}/pin-override`, { reason: a.reason }), refresh); } }, 'PIN override'),
      can('dispatcher') && h('button', { class: 'b red', onclick: async () => { const a = await ask('Cancel this booking?', { reason: true, danger: true, confirmText: 'Cancel booking' }); if (a) act(() => api('POST', `/admin/bookings/${id}/cancel`, { reason: a.reason }), refresh); } }, 'Cancel booking'),
      can('support_agent', 'support_lead') && h('button', { class: 'b sec', onclick: async () => { const a = await ask('Mark as disputed', { reason: true }); if (a) act(() => api('POST', `/admin/bookings/${id}/dispute`, { reason: a.reason }), refresh); } }, 'Mark disputed'),
      can('support_lead', 'finance_officer') && h('button', { class: 'b sec', onclick: async () => { const a = await ask('Request refund (needs a second person to approve)', { reason: true, fields: [{ name: 'amount', label: 'Amount RWF', type: 'number' }, { name: 'driver_clawback', label: 'Driver clawback RWF (0 if none)', type: 'number' }] }); if (a) act(() => api('POST', '/admin/finance/refunds', { booking_id: id, amount: a.amount, reason: a.reason, driver_clawback: a.driver_clawback || 0 })); } }, 'Request refund')),
    h('h2', {}, 'Timeline'), table([{ h: 'When', f: (e) => when(e.created_at) }, { h: 'Event', f: (e) => e.type === 'status_change' ? `${e.from_status || ''} → ${e.to_status}` : e.type }, { h: 'By', k: 'actor_role' }, { h: 'Reason', k: 'reason' }], ev.events),
    h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: close }, 'Close')));
  document.body.append(d); d.showModal();
}
V.drivers = async (el, state = {}) => {
  const st = state.status ?? 'DOCUMENTS_SUBMITTED';
  const data = await api('GET', `/admin/drivers?limit=100${st ? '&status=' + st : ''}${state.q ? '&q=' + encodeURIComponent(state.q) : ''}`);
  const sel = h('select', { onchange: () => { $('#view').replaceChildren(); V.drivers($('#view'), { status: sel.value }); } }, ['', 'DOCUMENTS_SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUIRED', 'APPROVED', 'SUSPENDED', 'EXPIRED_INELIGIBLE', 'REJECTED'].map((s) => h('option', { value: s, selected: s === st }, s || 'all')));
  el.append(h('h1', {}, 'Drivers'), h('div', { class: 'row' }, 'Status:', sel),
    table([{ h: 'Name', k: 'display_name' }, { h: 'Phone', k: 'phone' }, { h: 'Status', f: (r) => pill(r.status, statusCls(r.status)) }, { h: 'Vehicle', f: (r) => (r.plate || '-') + ' ' + (r.vehicle_type || '') }, { h: 'Online', f: (r) => (r.is_online ? 'yes' : 'no') }, { h: 'Rating', k: 'rating_avg' }, { h: 'Trips', k: 'completed_count' }, { h: 'Submitted', f: (r) => when(r.submitted_at) }], data.drivers, (r) => driverDetail(r.user_id)));
};
async function driverDetail(id) {
  const x = await api('GET', '/admin/drivers/' + id);
  const d = h('dialog', { style: 'max-width:820px' }); const close = () => { d.close(); d.remove(); }; const refresh = () => { close(); driverDetail(id); };
  const decide = (decision, title, needReason, danger) => async () => { const a = await ask(title, { reason: needReason, danger }); if (a) act(() => api('POST', `/admin/drivers/${id}/decision`, { decision, reason: a.reason }), refresh); };
  d.append(h('h2', {}, `${x.profile.display_name || x.profile.legal_name || 'Driver'} · `, pill(x.profile.status, statusCls(x.profile.status))),
    h('div', {}, `${x.profile.phone} · rating ${x.profile.rating_avg} (${x.profile.rating_count}) · completed ${x.profile.completed_count} · cancelled ${x.profile.cancel_count}`),
    h('div', { class: x.permission.can_work ? 'ok' : 'err' }, x.permission.can_work ? 'Permitted to work' : 'Not dispatchable: ' + x.permission.reasons.join(', ') + (x.permission.missing_documents.length ? ' · missing/unapproved: ' + x.permission.missing_documents.join(', ') : '') + (x.permission.expired_documents.length ? ' · expired: ' + x.permission.expired_documents.join(', ') : '')),
    x.profile.abasare_status && x.profile.abasare_status !== 'none' ? h('div', { class: 'card' }, h('h2', {}, 'Abasare application ', pill(x.profile.abasare_status, statusCls(x.profile.abasare_status))),
      h('div', {}, `Licence since ${x.profile.abasare_skills.licence_since} · ${x.profile.abasare_skills.years_experience} yrs experience · returns by ${x.profile.abasare_skills.return_mode}`),
      h('div', {}, `Can drive: ${(x.profile.abasare_skills.classes || []).join(', ')} · ${(x.profile.abasare_skills.transmissions || []).join(', ')}`),
      can('driver_verifier') ? h('div', { class: 'row' },
        ...[['approve', 'Approve Abasare', false, 'b'], ['reject', 'Reject', true, 'b red'], ['suspend', 'Suspend', true, 'b red'], ['reinstate', 'Reinstate', false, 'b sec']].map(([dec, label, need, cls]) => h('button', { class: cls, onclick: async () => { const a = await ask(label + '?', { reason: need, danger: need }); if (a) act(() => api('POST', `/admin/drivers/${id}/abasare-decision`, { decision: dec, reason: a.reason }), refresh); } }, label))) : null) : null,
    h('h2', {}, 'Vehicle'), table([{ h: 'Plate', k: 'plate' }, { h: 'Type', k: 'vehicle_type' }, { h: 'Make', f: (v) => `${v.make} ${v.model} ${v.color}` }, { h: 'Seats', k: 'capacity' }, { h: 'Status', k: 'status' }], x.vehicles),
    h('h2', {}, 'Documents (links expire in 5 minutes)'),
    table([{ h: 'Type', k: 'doc_type' }, { h: 'Status', f: (r) => pill(r.review_status, statusCls(r.review_status)) }, { h: 'Expiry', k: 'expiry_date' }, { h: 'Note', k: 'review_note' }, { h: 'File', f: (r) => h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'view') },
      { h: '', f: (r) => can('driver_verifier') && !r.superseded ? h('span', { class: 'row' }, h('button', { class: 'b', onclick: () => act(() => api('POST', `/admin/documents/${r.id}/review`, { decision: 'approved' }), refresh) }, 'Approve'),
        h('button', { class: 'b sec', onclick: async () => { const a = await ask('Reject / request new upload', { reason: true, fields: [{ name: 'decision', label: 'rejected or resubmit', type: 'select', options: ['resubmit', 'rejected'] }] }); if (a) act(() => api('POST', `/admin/documents/${r.id}/review`, { decision: a.decision, note: a.reason }), refresh); } }, 'Reject')) : '' }], x.documents),
    h('div', { class: 'row' }, can('driver_verifier') && h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/drivers/${id}/start-review`), refresh) }, 'Start review'),
      can('driver_verifier') && h('button', { class: 'b', onclick: decide('approve', 'Approve this driver?', false) }, 'Approve driver'),
      can('driver_verifier') && h('button', { class: 'b sec', onclick: decide('info_required', 'Ask for more information', true) }, 'Need more info'),
      can('driver_verifier') && h('button', { class: 'b red', onclick: decide('reject', 'Reject application', true, true) }, 'Reject'),
      can('driver_verifier') && h('button', { class: 'b red', onclick: decide('suspend', 'Suspend driver', true, true) }, 'Suspend'),
      can('driver_verifier') && h('button', { class: 'b sec', onclick: decide('reinstate', 'Reinstate driver', false) }, 'Reinstate')),
    h('h2', {}, 'Status history'), table([{ h: 'When', f: (r) => when(r.created_at) }, { h: 'From', k: 'from_status' }, { h: 'To', k: 'to_status' }, { h: 'Reason', k: 'reason' }], x.history),
    h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: close }, 'Close')));
  document.body.append(d); d.showModal();
}
V.abasare = async (el, state = {}) => {
  const st = state.status || 'pending';
  const d = await api('GET', '/admin/abasare/applications?status=' + st);
  const sel = h('select', { onchange: () => { $('#view').replaceChildren(); V.abasare($('#view'), { status: sel.value }); } }, ['pending', 'approved', 'rejected', 'suspended'].map((s) => h('option', { value: s, selected: s === st }, s)));
  el.append(h('h1', {}, 'Abasare (drivers for customers\' own cars)'), h('div', { class: 'banner' }, 'Approve only after the driving licence (held 2+ years), national ID, photo and a valid police clearance are verified. Open a driver to review documents.'),
    h('div', { class: 'row' }, 'Status:', sel),
    table([{ h: 'Name', k: 'display_name' }, { h: 'Phone', k: 'phone' }, { h: 'Account', k: 'account_status' }, { h: 'Licence since', f: (r) => r.abasare_skills.licence_since }, { h: 'Experience', f: (r) => r.abasare_skills.years_experience + ' yrs' },
      { h: 'Cars', f: (r) => (r.abasare_skills.classes || []).join(', ') + ' / ' + (r.abasare_skills.transmissions || []).join(', ') }, { h: 'Applied', f: (r) => when(r.abasare_applied_at) }], d.applications, (r) => driverDetail(r.user_id)));
};
V.users = async (el) => {
  const inp = h('input', { placeholder: 'Name, phone or email (min 2 chars)', style: 'min-width:280px' }); const out = h('div');
  const go = async () => { out.replaceChildren(table([{ h: 'Name', k: 'display_name' }, { h: 'Phone', k: 'phone' }, { h: 'Email', k: 'email' }, { h: 'Status', f: (u) => pill(u.status, statusCls(u.status)) }, { h: 'Roles', f: (u) => u.roles.join(', ') }], (await api('GET', '/admin/users?q=' + encodeURIComponent(inp.value))).users, userDetail)); };
  el.append(h('h1', {}, 'Passengers & users'), h('div', { class: 'row' }, inp, h('button', { class: 'b', onclick: () => act(go) }, 'Search')), out);
};
async function userDetail(u) {
  const x = await api('GET', '/admin/users/' + u.id); const d = h('dialog', {}); const close = () => { d.close(); d.remove(); };
  d.append(h('h2', {}, x.user.display_name || x.user.phone), h('div', {}, `${x.user.phone || ''} · status ${x.user.status}`),
    table([{ h: 'Ref', k: 'ref' }, { h: 'Status', k: 'status' }, { h: 'Fare', f: (r) => money(r.final_fare ?? r.estimated_fare) }, { h: 'Date', f: (r) => when(r.created_at) }], x.bookings),
    h('div', { class: 'row' }, can('support_lead') && h('button', { class: 'b red', onclick: async () => { const a = await ask('Restrict this account', { reason: true, danger: true, fields: [{ name: 'status', label: 'status', type: 'select', options: ['restricted', 'deactivated', 'active'] }] }); if (a) act(() => api('POST', `/admin/users/${u.id}/status`, { status: a.status, reason: a.reason }), close); } }, 'Change account status'), h('button', { class: 'b sec', onclick: close }, 'Close')));
  document.body.append(d); d.showModal();
}
V.support = async (el, state = {}) => {
  const data = await api('GET', '/admin/support/cases' + (state.q ? '?q=' + encodeURIComponent(state.q) : ''));
  const inp = h('input', { placeholder: 'Case, booking ref, payment reference, phone', value: state.q || '', style: 'min-width:300px' });
  el.append(h('h1', {}, 'Support cases'), h('div', { class: 'row' }, inp, h('button', { class: 'b', onclick: () => { $('#view').replaceChildren(); V.support($('#view'), { q: inp.value }); } }, 'Search')),
    table([{ h: 'Case', k: 'ref' }, { h: 'Priority', f: (c) => pill(c.priority, statusCls(c.priority)) }, { h: 'Status', k: 'status' }, { h: 'Category', k: 'category' }, { h: 'Subject', k: 'subject' }, { h: 'Reporter', k: 'reporter' }, { h: 'SLA due', f: (c) => h('span', { class: c.overdue ? 'err' : '' }, when(c.sla_due_at)) }, { h: '', f: (c) => (c.sensitive ? pill('sensitive', 'bad') : '') }], data.cases, (c) => caseDetail(c.id)));
};
async function caseDetail(id) {
  const x = await api('GET', '/admin/support/cases/' + id); const d = h('dialog', { style: 'max-width:720px' }); const close = () => { d.close(); d.remove(); };
  const reply = h('textarea', { rows: 3, placeholder: 'Reply to customer (visible to them)', style: 'width:100%' }); const note = h('textarea', { rows: 2, placeholder: 'Internal note (staff only)', style: 'width:100%' });
  const status = h('select', {}, ['', 'in_progress', 'awaiting_user', 'resolved', 'closed'].map((s) => h('option', { value: s }, s || 'status unchanged'))); const res = h('input', { placeholder: 'Resolution (required when resolving)', style: 'width:100%' });
  d.append(h('h2', {}, x.case.ref + ' · ' + x.case.subject), h('div', {}, `${x.case.category} · ${x.case.priority} · ${x.case.status}`),
    h('div', {}, x.events.map((e) => h('div', { class: 'card', style: e.visibility === 'internal' ? 'background:#f2b70522' : '' }, h('b', {}, e.kind + (e.visibility === 'internal' ? ' (internal)' : '') + ' · ' + when(e.created_at)), h('div', {}, e.body || (e.file_key ? 'Evidence attached' : ''))))),
    reply, note, h('div', { class: 'row' }, status, res), h('div', { class: 'row' }, h('button', { class: 'b', onclick: () => act(() => api('POST', `/admin/support/cases/${id}/update`, { reply: reply.value || undefined, internal_note: note.value || undefined, status: status.value || undefined, resolution: res.value || undefined, assign_to_me: true }), () => { close(); caseDetail(id); }) }, 'Save'), h('button', { class: 'b sec', onclick: close }, 'Close')));
  document.body.append(d); d.showModal();
}
V.safety = async (el) => {
  const d = await api('GET', '/admin/safety/incidents');
  el.append(h('h1', {}, 'Safety incidents'), h('div', { class: 'banner' }, 'SOS alerts are recorded here. The platform never reports that police or ambulance were contacted; record in the resolution what you actually did.'),
    table([{ h: 'Ref', k: 'ref' }, { h: 'Kind', f: (i) => pill(i.kind, i.kind === 'sos' ? 'bad' : '') }, { h: 'Status', k: 'status' }, { h: 'Reporter', k: 'reporter' }, { h: 'Location', f: (i) => i.lat != null ? h('a', { href: `https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=16/${i.lat}/${i.lng}`, target: '_blank', rel: 'noopener' }, 'map') : '-' }, { h: 'When', f: (i) => when(i.created_at) },
      { h: '', f: (i) => i.status !== 'resolved' ? h('span', { class: 'row' }, i.status === 'open' && h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/safety/incidents/${i.id}/update`, { status: 'acknowledged' }), () => go('safety')) }, 'Acknowledge'),
        h('button', { class: 'b', onclick: async () => { const a = await ask('Resolve incident', { reason: true }); if (a) act(() => api('POST', `/admin/safety/incidents/${i.id}/update`, { status: 'resolved', resolution: a.reason }), () => go('safety')); } }, 'Resolve')) : '' }], d.incidents));
};
V.pricing = async (el) => {
  const d = await api('GET', '/admin/pricing');
  const f = ['service_id', 'base_fare', 'per_km', 'per_min', 'minimum_fare', 'booking_fee', 'wait_per_min', 'airport_fee', 'tax_bps', 'rounding'];
  const af = ['billing', 'return_per_km', 'night_start_hour', 'night_end_hour', 'night_fee', 'hourly_rate', 'min_hours', 'max_hours', 'long_hire_hours', 'long_hire_rate', 'overtime_per_30min', 'overtime_grace_min'];
  el.append(h('h1', {}, 'Pricing & commission'), h('div', { class: 'banner' }, 'Changes are proposed, then approved by a different person. An accepted fare quote is never altered.'),
    h('h2', {}, 'Fare rules'), table([{ h: 'Service', k: 'service_id' }, { h: 'v', k: 'version' }, { h: 'Status', f: (r) => pill(r.status, statusCls(r.status)) }, ...f.slice(1).map((k) => ({ h: k.replace(/_/g, ' '), k })), { h: 'Abasare', f: (r) => r.service_id.startsWith('abasare') ? [r.billing === 'hourly' ? `${r.hourly_rate}/h (min ${r.min_hours}h, long ${r.long_hire_hours || '-'}h @ ${r.long_hire_rate || '-'}, overtime ${r.overtime_per_30min}/30min)` : `return ${r.return_per_km}/km`, r.night_fee ? ` · night ${r.night_start_hour}-${r.night_end_hour}h +${r.night_fee}` : ''].join('') : '' }, { h: 'Effective', f: (r) => when(r.effective_from) },
      { h: '', f: (r) => r.status === 'pending_approval' && can('finance_approver') ? h('span', { class: 'row' }, h('button', { class: 'b', onclick: () => act(() => api('POST', `/admin/pricing/${r.id}/approve`), () => go('pricing')) }, 'Approve'), h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/pricing/${r.id}/reject`), () => go('pricing')) }, 'Reject')) : '' }], d.rules),
    can('business_manager') && h('button', { class: 'b', onclick: async () => { const a = await ask('Propose new fare rule', { fields: [...f, ...af].map((k) => ({ name: k, label: k + (af.includes(k) ? ' (Abasare)' : ''), type: ['service_id', 'billing'].includes(k) ? 'text' : 'number' })) }); if (a) { delete a.reason; if (!a.billing) delete a.billing; for (const k of af) if (k !== 'billing' && (a[k] === 0 || Number.isNaN(a[k]))) delete a[k]; act(() => api('POST', '/admin/pricing', a), () => go('pricing')); } } }, 'Propose fare change'),
    h('h2', {}, 'Commission rules'), table([{ h: 'Scope', f: (c) => c.driver_id ? 'driver ' + c.driver_id.slice(0, 6) : c.fleet_id ? 'fleet' : c.service_id || 'platform default' }, { h: 'Kind', k: 'kind' }, { h: 'Rate', f: (c) => c.kind === 'percent' ? c.percent_bps / 100 + '%' : money(c.fixed_amount) }, { h: 'Exempt until', f: (c) => c.exempt_until ? when(c.exempt_until) : '-' }, { h: 'Status', f: (c) => pill(c.status, statusCls(c.status)) }, { h: 'Note', k: 'note' },
      { h: '', f: (c) => c.status === 'pending_approval' && can('finance_approver') ? h('button', { class: 'b', onclick: () => act(() => api('POST', `/admin/commissions/${c.id}/approve`), () => go('pricing')) }, 'Approve') : '' }], d.commissions));
};
V.promos = async (el) => {
  const d = await api('GET', '/admin/promotions');
  el.append(h('h1', {}, 'Promotions'), table([{ h: 'Code', k: 'code' }, { h: 'Type', f: (p) => p.kind === 'percent' ? p.value + '%' : money(p.value) }, { h: 'Max', f: (p) => money(p.max_discount) }, { h: 'Spent / budget', f: (p) => `${p.spent} / ${p.budget ?? '∞'}` }, { h: 'First ride', f: (p) => (p.first_ride_only ? 'yes' : '') }, { h: 'Active', f: (p) => h('button', { class: 'b sec', onclick: () => act(() => api('PATCH', '/admin/promotions/' + p.id, { active: !p.active }), () => go('promos')) }, p.active ? 'Active · pause' : 'Paused · resume') }], d.promotions),
    h('button', { class: 'b', onclick: async () => { const a = await ask('New promotion (platform funded)', { fields: [{ name: 'code', label: 'Code' }, { name: 'kind', label: 'kind', type: 'select', options: ['percent', 'fixed'] }, { name: 'value', label: 'Value (% or RWF)', type: 'number' }, { name: 'max_discount', label: 'Max discount RWF', type: 'number' }, { name: 'budget', label: 'Total budget RWF', type: 'number' }, { name: 'usage_limit', label: 'Usage limit', type: 'number' }] }); if (a) { delete a.reason; for (const k of ['max_discount', 'budget', 'usage_limit']) if (!a[k]) delete a[k]; act(() => api('POST', '/admin/promotions', a), () => go('promos')); } } }, 'New promotion'));
};
V.finance = async (el, state = {}) => {
  const [pos, pays, refunds, payouts, rec] = await Promise.all([api('GET', '/admin/finance/position'), api('GET', '/admin/finance/payments?limit=50' + (state.q ? '&q=' + encodeURIComponent(state.q) : '')), api('GET', '/admin/finance/refunds'), api('GET', '/admin/finance/payouts'), api('GET', '/admin/finance/reconciliation')]);
  const inp = h('input', { placeholder: 'Payment/provider reference or booking ref', value: state.q || '', style: 'min-width:320px' });
  const file = h('textarea', { rows: 4, placeholder: 'Provider settlement rows as JSON: [{"reference":"…","amount":1500,"status":"SUCCESS"}]', style: 'width:100%' });
  el.append(h('h1', {}, 'Finance'),
    h('div', { class: 'banner' }, pos.integrity.balanced ? 'Ledger integrity check: balanced (debits = credits).' : 'LEDGER IMBALANCE DETECTED. Stop payouts and investigate.'),
    h('h2', {}, 'Ledger position'), table([{ h: 'Account', k: 'name' }, { h: 'Type', k: 'type' }, { h: 'Debit', f: (a) => money(a.debit) }, { h: 'Credit', f: (a) => money(a.credit) }, { h: 'Balance', f: (a) => money(a.balance) }], pos.accounts),
    h('div', { class: 'row' }, ['payments', 'ledger', 'trips', 'earnings'].map((k) => h('button', { class: 'b sec', onclick: () => act(async () => { const r = await fetch(`${API}/admin/finance/export/${k}`, { headers: { authorization: 'Bearer ' + S.access } }); if (!r.ok) throw new Error('Export denied'); const u = URL.createObjectURL(await r.blob()); const a = h('a', { href: u, download: k + '.csv' }); document.body.append(a); a.click(); a.remove(); }) }, 'Export ' + k + '.csv'))),
    h('h2', {}, 'Transactions'), h('div', { class: 'row' }, inp, h('button', { class: 'b', onclick: () => { $('#view').replaceChildren(); V.finance($('#view'), { q: inp.value }); } }, 'Search')),
    table([{ h: 'Reference', k: 'reference' }, { h: 'Booking', k: 'booking_ref' }, { h: 'Method', k: 'method' }, { h: 'Status', f: (p) => pill(p.status, statusCls(p.status)) }, { h: 'Amount', f: (p) => money(p.amount) }, { h: 'Settlement', k: 'settlement_status' }, { h: 'Issue', k: 'failure_reason' }, { h: 'Date', f: (p) => when(p.created_at) }], pays.payments),
    h('h2', {}, 'Refunds (maker-checker)'), table([{ h: 'Booking', k: 'booking_ref' }, { h: 'Amount', f: (r) => money(r.amount) }, { h: 'Clawback', f: (r) => money(r.driver_clawback) }, { h: 'Reason', k: 'reason' }, { h: 'Status', f: (r) => pill(r.status, statusCls(r.status)) },
      { h: '', f: (r) => r.status === 'REQUESTED' && can('finance_approver') ? h('span', { class: 'row' }, h('button', { class: 'b', onclick: async () => { const a = await ask('Approve refund of ' + money(r.amount) + '?', {}); if (a) act(() => api('POST', `/admin/finance/refunds/${r.id}/decision`, { approve: true }), () => go('finance')); } }, 'Approve'), h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/finance/refunds/${r.id}/decision`, { approve: false }), () => go('finance')) }, 'Reject')) : '' }], refunds.refunds),
    h('h2', {}, 'Driver / fleet payouts'), table([{ h: 'Owner', k: 'owner' }, { h: 'Amount', f: (p) => money(p.amount) }, { h: 'Fee', f: (p) => money(p.fee) }, { h: 'MoMo number', k: 'msisdn' }, { h: 'Status', f: (p) => pill(p.status, statusCls(p.status)) }, { h: 'Requested', f: (p) => when(p.requested_at) },
      { h: '', f: (p) => h('span', { class: 'row' },
        p.status === 'REQUESTED' && can('finance_officer', 'finance_approver') && h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/finance/payouts/${p.id}/review`), () => go('finance')) }, 'Review'),
        ['REQUESTED', 'REVIEWED'].includes(p.status) && can('finance_approver') && h('button', { class: 'b', onclick: () => act(() => api('POST', `/admin/finance/payouts/${p.id}/approve`), () => go('finance')) }, 'Approve'),
        p.status === 'APPROVED' && can('finance_approver') && h('button', { class: 'b', onclick: async () => { const a = await ask('Mark paid (after you sent the MoMo transfer)', { fields: [{ name: 'provider_reference', label: 'MoMo transaction id' }] }); if (a) act(() => api('POST', `/admin/finance/payouts/${p.id}/paid`, { provider_reference: a.provider_reference }), () => go('finance')); } }, 'Mark paid'),
        ['REQUESTED', 'REVIEWED', 'APPROVED'].includes(p.status) && can('finance_officer', 'finance_approver') && h('button', { class: 'b red', onclick: async () => { const a = await ask('Reject payout', { reason: true, danger: true }); if (a) act(() => api('POST', `/admin/finance/payouts/${p.id}/reject`, { note: a.reason }), () => go('finance')); } }, 'Reject')) }], payouts.payouts),
    h('h2', {}, 'Reconciliation'), h('div', { class: 'banner' }, 'Upload the provider settlement report rows for a day. Differences are listed for investigation. Never mark a payment paid from a screenshot.'),
    file, h('div', { class: 'row' }, h('input', { id: 'recdate', type: 'date', value: new Date().toISOString().slice(0, 10) }), h('button', { class: 'b', onclick: () => act(async () => { const r = await api('POST', '/admin/finance/reconcile', { provider: 'mtn_momo', run_date: $('#recdate').value, rows: JSON.parse(file.value || '[]') }); toast(JSON.stringify(r.summary)); }, () => go('finance')) }, 'Run reconciliation')),
    h('h3', {}, 'Payment exceptions'), table([{ h: 'Reference', k: 'reference' }, { h: 'Status', k: 'status' }, { h: 'Amount', f: (p) => money(p.amount) }, { h: 'Issue', k: 'failure_reason' }, { h: 'Created', f: (p) => when(p.created_at) }], rec.payment_exceptions),
    h('h3', {}, 'Open reconciliation items'), table([{ h: 'Run date', k: 'run_date' }, { h: 'Kind', f: (i) => pill(i.kind, 'warn') }, { h: 'Reference', k: 'provider_reference' }, { h: 'Internal', f: (i) => money(i.internal_amount) }, { h: 'Provider', f: (i) => money(i.provider_amount) },
      { h: '', f: (i) => h('button', { class: 'b sec', onclick: async () => { const a = await ask('Resolve item', { reason: true }); if (a) act(() => api('POST', `/admin/finance/reconciliation/items/${i.id}/resolve`, { note: a.reason }), () => go('finance')); } }, 'Resolve') }], rec.open_items),
    h('h3', {}, 'Cash outstanding > 1 hour'), table([{ h: 'Booking', k: 'ref' }, { h: 'Due', f: (p) => money(p.amount) }, { h: 'Collected', f: (p) => money(p.amount_collected) }], rec.cash_outstanding));
};
V.business = async (el) => {
  const d = await api('GET', '/admin/businesses');
  el.append(h('h1', {}, 'Business accounts'), table([{ h: 'Company', k: 'legal_name' }, { h: 'TIN', k: 'tin' }, { h: 'Status', f: (b) => pill(b.status, statusCls(b.status)) }, { h: 'Billing', k: 'billing_mode' }, { h: '', f: (b) => h('span', { class: 'row' }, b.status !== 'active' && h('button', { class: 'b', onclick: () => act(() => api('POST', `/admin/businesses/${b.id}/decision`, { status: 'active' }), () => go('business')) }, 'Verify & activate'), b.status === 'active' && h('button', { class: 'b sec', onclick: async () => { const a = await ask('Issue monthly invoice', { fields: [{ name: 'month', label: 'YYYY-MM' }] }); if (a) act(() => api('POST', `/admin/businesses/${b.id}/invoice`, { month: a.month })); } }, 'Invoice month')) }], d.businesses),
    h('h1', {}, 'Fleets'), table([{ h: 'Fleet', k: 'name' }, { h: 'Status', f: (b) => pill(b.status, statusCls(b.status)) }, { h: 'Revenue share', f: (b) => b.revenue_share_bps / 100 + '%' }, { h: '', f: (f) => h('button', { class: 'b', onclick: async () => { const a = await ask('Fleet agreement', { fields: [{ name: 'revenue_share_bps', label: 'Fleet share of driver net, basis points (1000 = 10%)', type: 'number' }] }); if (a) act(() => api('POST', `/admin/fleets/${f.id}/decision`, { status: 'active', revenue_share_bps: a.revenue_share_bps }), () => go('business')); } }, 'Activate / set share') }], d.fleets));
};
V.privacy = async (el) => {
  const d = await api('GET', '/admin/privacy-requests');
  el.append(h('h1', {}, 'Privacy requests'), table([{ h: 'Kind', k: 'kind' }, { h: 'User', k: 'display_name' }, { h: 'Status', f: (r) => pill(r.status, statusCls(r.status)) }, { h: 'Due', f: (r) => when(r.due_at) }, { h: '', f: (r) => ['open', 'in_progress'].includes(r.status) ? h('button', { class: 'b', onclick: async () => { const a = await ask(r.kind === 'deletion' ? 'Execute deletion? Personal data is erased; financial records are kept in anonymised form.' : 'Execute ' + r.kind, { danger: r.kind === 'deletion', confirmText: 'Execute' }); if (a) act(async () => { const o = await api('POST', `/admin/privacy-requests/${r.id}/execute`); if (r.kind === 'access') { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' })), download: 'user-data.json' }); document.body.append(a); a.click(); a.remove(); } }, () => go('privacy')); } }, 'Execute') : '' }], d.requests));
};
V.settings = async (el) => {
  const [d, ints] = await Promise.all([api('GET', '/admin/settings'), api('GET', '/admin/integration-status')]);
  el.append(h('h1', {}, 'Settings'), h('h2', {}, 'Integration status'), table([{ h: 'Integration', k: 'name' }, { h: 'Status', k: 'status' }], ints.integrations),
    h('h2', {}, 'Feature flags'), table([{ h: 'Flag', k: 'key' }, { h: 'Description', k: 'description' }, { h: 'Enabled', f: (f) => h('button', { class: 'b ' + (f.enabled ? '' : 'sec'), onclick: async () => { const a = await ask((f.enabled ? 'Disable ' : 'Enable ') + f.key + '?', { reason: true }); if (a) act(() => api('PUT', '/admin/flags/' + f.key, { enabled: !f.enabled }), () => go('settings')); } }, f.enabled ? 'ON' : 'off') }], d.flags),
    h('h2', {}, 'Operational settings'), table([{ h: 'Key', k: 'k' }, { h: 'Value', f: (r) => h('code', {}, JSON.stringify(r.v)) }, { h: '', f: (r) => h('button', { class: 'b sec', onclick: async () => { const a = await ask('Edit ' + r.k, { fields: [{ name: 'value', label: 'New value (JSON)' }] }); if (a) act(() => api('PUT', '/admin/settings/' + r.k, { value: JSON.parse(a.value) }), () => go('settings')); } }, 'Edit') }], Object.entries(d.settings).map(([k, v]) => ({ k, v }))),
    h('h2', {}, 'Notification templates (overrides)'), table([{ h: 'Key', k: 'key' }, { h: 'Lang', k: 'lang' }, { h: 'Title', k: 'title' }, { h: 'Body', k: 'body' }], d.templates),
    h('button', { class: 'b', onclick: async () => { const a = await ask('Override template', { fields: [{ name: 'key', label: 'template key e.g. booking_confirmed' }, { name: 'lang', label: 'lang', type: 'select', options: ['rw', 'en', 'fr', 'sw'] }, { name: 'title', label: 'Title' }, { name: 'body', label: 'Body with {{placeholders}}' }] }); if (a) { delete a.reason; act(() => api('PUT', `/admin/templates/${a.key}/${a.lang}`, { title: a.title, body: a.body }), () => go('settings')); } } }, 'Edit template'));
};
V.audit = async (el, state = {}) => {
  const d = await api('GET', '/admin/audit?limit=200' + (state.action ? '&action=' + encodeURIComponent(state.action) : ''));
  const inp = h('input', { placeholder: 'Action prefix e.g. refund, pricing, driver', value: state.action || '' });
  el.append(h('h1', {}, 'Audit log (append-only)'), h('div', { class: 'row' }, inp, h('button', { class: 'b', onclick: () => { $('#view').replaceChildren(); V.audit($('#view'), { action: inp.value }); } }, 'Filter')),
    table([{ h: 'When', f: (l) => when(l.created_at) }, { h: 'Actor', f: (l) => l.actor_name || l.actor_id?.slice(0, 8) || 'system' }, { h: 'Action', k: 'action' }, { h: 'Entity', f: (l) => `${l.entity_type || ''} ${l.entity_id || ''}` }, { h: 'Change', f: (l) => h('code', {}, JSON.stringify(l.after ?? '').slice(0, 120)) }], d.logs));
};
V.staff = async (el) => {
  const d = await api('GET', '/admin/staff');
  el.append(h('h1', {}, 'Staff & roles'), h('div', { class: 'banner' }, 'Two-factor authentication is mandatory for every staff account.'), table([{ h: 'Name', k: 'display_name' }, { h: 'Email', k: 'email' }, { h: 'Roles', f: (s) => s.roles.join(', ') }, { h: 'Status', k: 'status' }, { h: '', f: (s) => h('button', { class: 'b sec', onclick: async () => { const a = await ask('Sign this person out everywhere?', { danger: true }); if (a) act(() => api('POST', `/admin/staff/${s.id}/sessions/revoke`)); } }, 'Revoke sessions') }], d.staff),
    h('button', { class: 'b', onclick: async () => { const a = await ask('Create staff account', { fields: [{ name: 'name', label: 'Full name' }, { name: 'email', label: 'Email' }, { name: 'role', label: 'role', type: 'select', options: Object.keys(d.roles) }, { name: 'password', label: 'Temporary password (12+ chars)' }] }); if (a) { delete a.reason; act(async () => { const r = await api('POST', '/admin/staff', a); alert('Give this to the new staff member NOW (shown once):\n\nTOTP secret: ' + r.totp_secret + '\n' + r.totp_uri); }, () => go('staff')); } } }, 'Add staff member'),
    h('h2', {}, 'Role permissions'), table([{ h: 'Role', k: 'r' }, { h: 'Permissions', f: (x) => x.p.join(', ') }], Object.entries(d.roles).map(([r, p]) => ({ r, p }))));
};

// ---------------- shell ----------------
function go(tab) { S.tab = tab; render(); }
async function render() {
  const root = $('#app'); root.replaceChildren();
  if (!S.access) return loginView(root);
  const tabs = TABS.filter(([, , need]) => !need.length ? can() : can(...need));
  const view = h('main', { id: 'view' });
  root.append(h('div', { class: 'shell' }, h('nav', {}, h('div', { class: 'brand' }, h('img', { src: 'logo.png', alt: '', style: 'width:28px;height:28px;border-radius:7px;vertical-align:middle;margin-right:8px' }), 'Abasare'), tabs.map(([k, l]) => h('button', { class: S.tab === k ? 'on' : '', onclick: () => go(k) }, l)), h('button', { onclick: logout }, 'Sign out')), view));
  try { await (V[S.tab] || V.dashboard)(view); } catch (e) { view.append(h('div', { class: 'err' }, e.message)); }
}
function loginView(root) {
  const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'username' }), pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' }), totp = h('input', { placeholder: '6-digit authenticator code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' }), err = h('div', { class: 'err' });
  const submit = async () => { err.textContent = ''; try { const r = await fetch(API + '/auth/staff/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.value, password: pw.value, totp: totp.value }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'Sign-in failed'); save(j); S.tab = 'dashboard'; render(); } catch (e) { err.textContent = e.message; } };
  totp.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  root.append(h('div', { class: 'card login' }, h('h1', {}, 'Rwanda Mobility · Staff sign-in'), email, pw, totp, err, h('button', { class: 'b', style: 'width:100%', onclick: submit }, 'Sign in'), h('p', { style: 'color:var(--mut)' }, 'Staff accounts require two-factor authentication.')));
}
render();

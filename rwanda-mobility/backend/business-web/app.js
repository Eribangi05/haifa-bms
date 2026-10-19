'use strict';
// Abasare Business: a small portal for companies (book and pay for team rides) and fleets (drivers, vehicles, earnings).
// Same accounts and the same API as the phone app: every rule (budgets, limits, ownership) is enforced by the server, never here.
const API = '/api/v1';
const root = document.getElementById('app');
const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* storage blocked */ } } };
const fmt = (n) => (n == null ? '' : Number(n).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US'));
const when = (iso) => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleString(lang === 'fr' ? 'fr-FR' : lang === 'rw' ? 'en-GB' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Kigali' }); };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

// ---------------------------------------------------------------- API with sign-in and silent token refresh
let refreshing = null;
async function refreshToken() {
  const rt = store.get('biz.refresh'); if (!rt) return false;
  refreshing = refreshing || fetch(API + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) })
    .then(async (r) => { if (!r.ok) return false; const j = await r.json(); store.set('biz.token', j.access_token); if (j.refresh_token) store.set('biz.refresh', j.refresh_token); return true; })
    .catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}
async function api(method, path, body, headers = {}) {
  const go = () => fetch(API + path, { method, headers: { 'content-type': 'application/json', 'accept-language': lang, ...(store.get('biz.token') ? { authorization: 'Bearer ' + store.get('biz.token') } : {}), ...headers }, body: body == null ? undefined : JSON.stringify(body) });
  let r = await go();
  if (r.status === 401 && (await refreshToken())) r = await go();
  if (r.status === 401) { signOutLocal(); throw new Error('auth'); }
  let j = null; try { j = await r.json(); } catch { /* empty body */ }
  if (!r.ok) { const e = new Error(j?.error?.message || t('error')); e.code = j?.error?.code; e.status = r.status; throw e; }
  return j;
}
const signOutLocal = () => { store.set('biz.token', null); store.set('biz.refresh', null); state.account = null; render(); };

// ---------------------------------------------------------------- shared UI
const state = { phone: '', stage: 'phone', account: null, tab: null, accounts: null, flash: null, busy: false };
let tick = 0;
function flash(msg, bad) { state.flash = { msg, bad, id: ++tick }; const id = tick; render(); setTimeout(() => { if (state.flash && state.flash.id === id) { state.flash = null; const el = document.getElementById('flash'); if (el) el.remove(); } }, 6000); }
const errText = (e) => (e && e.code === 'invalid_phone' ? t('err.invalid_phone') : e && e.status === 404 ? t('err.not_found') : e && e.status === 403 ? t('err.forbidden') : e && e.message) || t('error');
async function act(fn, ok) { if (state.busy) return; state.busy = true; try { const r = await fn(); skipRestore = true; if (ok) flash(ok); return r; } catch (e) { if (e.message !== 'auth') flash(errText(e), true); } finally { state.busy = false; render(); } }
const stText = (s) => { const k = 'st.' + s; return t(k) === k ? s : t(k); };
const pill = (s, tone) => h('span', { class: 'pill ' + (tone || (/PAID|PAYMENT_COMPLETED|COMPLETED|approved|APPROVED|active/.test(s) ? 'ok' : /CANCEL|NO_DRIVER|suspend|SUSPEND/i.test(s) ? 'bad' : 'warn')) }, stText(s));
const field = (label, input) => h('label', { class: 'f' }, label, input);
const input = (o = {}) => h('input', o);

function table(cols, rows) {
  if (!rows.length) return h('p', { class: 'muted' }, t('none'));
  return h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c.h)))), h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => h('td', {}, c.f(r))))))));
}
function csv(name, headers, rows) {
  const cell = (v) => { const s = String(v ?? ''); const safe = /^[=+\-@]/.test(s) ? "'" + s : s; return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe; };   // a leading = + - @ would run as a spreadsheet formula
  const text = '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: name }); document.body.append(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- sign in
function loginView() {
  const ph = input({ type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: t('phone.ph'), value: state.phone });
  const code = input({ type: 'text', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' });
  const card = h('div', { class: 'card login' }, h('h1', {}, t('signin.title')), h('p', { class: 'muted' }, t('signin.sub')));
  if (state.stage === 'phone') {
    card.append(field(t('phone'), ph), h('div', { class: 'row' }, h('button', { class: 'b', onclick: () => act(async () => { state.phone = ph.value.trim(); await api('POST', '/auth/otp/request', { phone: state.phone, language: lang }); state.stage = 'code'; }) }, t('send.code'))));
  } else {
    card.append(field(t('code'), code), h('div', { class: 'row' },
      h('button', { class: 'b', onclick: () => act(async () => { const j = await api('POST', '/auth/otp/verify', { phone: state.phone, code: code.value.trim(), role: 'passenger', language: lang }); store.set('biz.token', j.access_token); store.set('biz.refresh', j.refresh_token); state.stage = 'phone'; state.accounts = null; }) }, t('verify')),
      h('button', { class: 'b sec', onclick: () => { state.stage = 'phone'; render(); } }, t('back'))));
  }
  return card;
}

// ---------------------------------------------------------------- account list
async function loadAccounts() {
  const [b, f] = await Promise.all([api('GET', '/businesses/mine'), api('GET', '/fleets/mine')]);
  state.accounts = { businesses: b.businesses, fleets: f.fleets }; render();
}
function homeView() {
  const a = state.accounts; if (!a) { act(loadAccounts); return h('p', { class: 'muted' }, t('loading')); }
  const open = (kind, x) => { state.account = { kind, ...x }; state.tab = kind === 'company' ? 'overview' : 'drivers'; render(); };
  const nm = input({ placeholder: t('legal.name') }), tin = input({ placeholder: t('tin') }), fn = input({ placeholder: t('fleet.name') });
  return h('div', {}, h('h1', {}, t('accounts')),
    h('h2', {}, t('companies')), a.businesses.length ? table([{ h: t('name'), f: (x) => x.legal_name }, { h: t('role'), f: (x) => x.role }, { h: t('status'), f: (x) => pill(x.status) }, { h: '', f: (x) => h('button', { class: 'b sec', onclick: () => open('company', x) }, t('open')) }], a.businesses) : h('p', { class: 'muted' }, t('none')),
    h('div', { class: 'card' }, h('b', {}, t('create.company')), h('div', { class: 'row' }, field(t('legal.name'), nm), field(t('tin'), tin), h('button', { class: 'b', onclick: () => act(async () => { const r = await api('POST', '/businesses', { legal_name: nm.value.trim(), tin: tin.value.trim() || undefined }); state.accounts = null; flash(r.note || t('saved')); }) }, t('create')))),
    h('h2', {}, t('fleets')), a.fleets.length ? table([{ h: t('name'), f: (x) => x.name }, { h: t('role'), f: (x) => x.role }, { h: t('status'), f: (x) => pill(x.status) }, { h: '', f: (x) => h('button', { class: 'b sec', onclick: () => open('fleet', x) }, t('open')) }], a.fleets) : h('p', { class: 'muted' }, t('none')),
    h('div', { class: 'card' }, h('b', {}, t('create.fleet')), h('div', { class: 'row' }, field(t('fleet.name'), fn), h('button', { class: 'b', onclick: () => act(async () => { const r = await api('POST', '/fleets', { name: fn.value.trim() }); state.accounts = null; flash(r.note || t('saved')); }) }, t('create')))));
}

// ---------------------------------------------------------------- company
const cache = {};
function load(key, fn) { if (cache[key] !== undefined) return cache[key]; cache[key] = null; fn().then((v) => { cache[key] = v; render(); }).catch((e) => { delete cache[key]; if (e.message !== 'auth') flash(errText(e), true); }); return null; }
const reset = () => { for (const k of Object.keys(cache)) delete cache[k]; render(); };
const thisMonth = () => { const d = new Date(Date.now() + 2 * 3600e3); return d.toISOString().slice(0, 7); };

function tabs(list) { return h('div', { class: 'tabs' }, list.map((k) => h('button', { class: state.tab === k ? 'on' : '', onclick: () => { state.tab = k; render(); } }, t('tab.' + k)))); }

function companyView() {
  const a = state.account, id = a.id, admin = a.role === 'admin';
  const list = admin ? ['overview', 'rides', 'book', 'team', 'statement', 'invoices', 'policy'] : ['rides', 'book'];
  if (!list.includes(state.tab)) state.tab = list[0];
  const head = [h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: () => { state.account = null; render(); } }, t('back')), h('h1', { style: 'margin:0' }, a.legal_name), pill(a.status)), a.status !== 'active' ? h('div', { class: 'banner' }, t('pending.verify')) : null, tabs(list)];
  const v = { overview: () => companyOverview(id), rides: () => ridesView(id, admin), book: () => bookView(id), team: () => teamView(id), statement: () => statementView(id), invoices: () => invoicesView(id), policy: () => policyView(id, a) }[state.tab]();
  return h('div', {}, head, v);
}
function companyOverview(id) {
  const st = load('st:' + id + thisMonth(), () => api('GET', `/businesses/${id}/statement?month=${thisMonth()}`)), a = state.account;
  return h('div', {}, h('div', { class: 'kpi' },
    h('div', { class: 'card' }, h('span', {}, t('spent')), h('b', {}, st ? fmt(st.total) + ' RWF' : '…')),
    h('div', { class: 'card' }, h('span', {}, t('trips.n')), h('b', {}, st ? st.trip_count : '…')),
    h('div', { class: 'card' }, h('span', {}, t('budget')), h('b', {}, a.monthly_budget ? fmt(a.monthly_budget) + ' RWF' : '—'))),
    st && Object.keys(st.by_cost_centre).length ? [h('h2', {}, t('by.cc')), table([{ h: t('cost.centre'), f: (r) => r[0] }, { h: t('amount'), f: (r) => fmt(r[1]) }], Object.entries(st.by_cost_centre))] : null);
}
function ridesView(id, admin) {
  const r = load('rides:' + id, () => api('GET', `/businesses/${id}/bookings`)); if (!r) return h('p', { class: 'muted' }, t('loading'));
  return table([{ h: t('ref'), f: (b) => b.ref }, { h: t('when'), f: (b) => when(b.requested_at) }, { h: t('from'), f: (b) => b.pickup?.name || '' }, { h: t('to'), f: (b) => b.destination?.name || '' }, { h: t('fare'), f: (b) => fmt(b.final_fare ?? b.estimated_fare) }, { h: t('status'), f: (b) => pill(b.status) }], r.bookings);
}
function placePicker(label, sel) {
  const q = input({ placeholder: t('search.ph'), 'aria-label': label }), out = h('div', { class: 'card', style: 'display:none;padding:0' });
  let timer; const chosen = h('div', { class: 'muted' }, sel.place ? sel.place.name : '');
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => { if (q.value.trim().length < 2) { out.style.display = 'none'; return; } try { const r = await api('GET', `/places/search?q=${encodeURIComponent(q.value.trim())}&lang=${lang}`); out.replaceChildren(...r.places.slice(0, 6).map((p) => h('div', { class: 'hit', onclick: () => { sel.place = p; chosen.textContent = p.name; q.value = ''; out.style.display = 'none'; } }, p.name))); out.style.display = r.places.length ? 'block' : 'none'; } catch { /* ignore typing errors */ } }, 250); });
  return h('div', { style: 'flex:1;min-width:220px' }, h('label', { class: 'f' }, label, q), chosen, out);
}
const bookState = { pickup: {}, dest: {}, quote: null, cc: '', po: '' };
function bookView(id) {
  const cc = input({ value: bookState.cc }), po = input({ value: bookState.po });
  const prices = h('div', {});
  const getPrices = () => act(async () => { if (!bookState.pickup.place || !bookState.dest.place) return; bookState.cc = cc.value; bookState.po = po.value; const { place: p } = bookState.pickup, { place: d } = bookState.dest; bookState.quote = await api('POST', '/fares/estimate', { pickup: { lat: p.lat, lng: p.lng }, dest: { lat: d.lat, lng: d.lng } }); });
  if (bookState.quote) prices.append(h('div', {}, bookState.quote.options.filter((o) => o.kind !== 'abasare').map((o) => h('div', { class: 'card' }, h('div', { class: 'row' },
    h('b', { style: 'flex:1' }, o['name_' + lang] || o.name_en), o.available ? h('span', {}, fmt(o.fare.total) + ' RWF', o.per_km ? h('span', { class: 'muted' }, ` · ${o.per_km} ${t('per.km')}`) : '') : '', o.available ? h('button', { class: 'b', onclick: () => act(async () => {
      const key = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
      await api('POST', `/businesses/${id}/bookings`, { quote_id: o.quote_id, pickup_name: bookState.pickup.place.name, dest_name: bookState.dest.place.name, cost_centre: bookState.cc || undefined, po_ref: bookState.po || undefined }, { 'idempotency-key': key });
      bookState.quote = null; delete cache['rides:' + id]; state.tab = 'rides'; flash(t('booked'));
    }) }, t('book.now')) : h('span', { class: 'pill warn' }, t('unavailable')))))));
  return h('div', {}, h('div', { class: 'card' }, h('div', { class: 'row' }, placePicker(t('pickup'), bookState.pickup), placePicker(t('dest'), bookState.dest)),
    h('div', { class: 'row' }, field(t('cost.centre'), cc), field(t('po'), po), h('button', { class: 'b', onclick: getPrices }, t('get.prices')))), prices);
}
function teamView(id) {
  const m = load('team:' + id, () => api('GET', `/businesses/${id}/members`));
  const ph = input({ type: 'tel', placeholder: t('phone.ph') }), nm = input({}), lim = input({ inputmode: 'numeric' }), cc = input({}), role = h('select', {}, ['employee', 'booker', 'admin'].map((r) => h('option', { value: r }, t('role.' + r))));
  return h('div', {}, h('div', { class: 'card' }, h('b', {}, t('member.add')), h('div', { class: 'row' }, field(t('phone'), ph), field(t('name'), nm), field(t('role'), role), field(t('limit'), lim), field(t('cost.centre'), cc),
    h('button', { class: 'b', onclick: () => act(async () => { await api('POST', `/businesses/${id}/members`, { phone: ph.value.trim(), name: nm.value.trim() || undefined, role: role.value, spending_limit: lim.value ? Number(lim.value.replace(/\D/g, '')) : undefined, cost_centre: cc.value.trim() || undefined }); delete cache['team:' + id]; }, t('saved')) }, t('add')))),
    m ? table([{ h: t('name'), f: (x) => x.display_name || x.phone }, { h: t('phone'), f: (x) => x.phone }, { h: t('role'), f: (x) => t('role.' + x.role) }, { h: t('limit'), f: (x) => fmt(x.spending_limit) }, { h: t('cost.centre'), f: (x) => x.cost_centre || '' }, { h: t('active'), f: (x) => (x.active ? '✓' : '') },
      { h: '', f: (x) => x.active ? h('button', { class: 'b sec', onclick: () => act(async () => { await api('DELETE', `/businesses/${id}/members/${x.user_id}`); delete cache['team:' + id]; }) }, t('remove')) : '' }], m.members) : h('p', { class: 'muted' }, t('loading')));
}
const stmt = { month: thisMonth() };
function statementView(id) {
  const mo = input({ type: 'month', value: stmt.month, onchange: () => { stmt.month = mo.value || thisMonth(); render(); } });
  const s = load('stmt:' + id + stmt.month, () => api('GET', `/businesses/${id}/statement?month=${stmt.month}`));
  return h('div', {}, h('div', { class: 'row noprint' }, field(t('month'), mo), s ? h('button', { class: 'b sec', onclick: () => csv(`statement-${stmt.month}.csv`, [t('ref'), t('when'), t('employee'), t('from'), t('to'), t('cost.centre'), t('po'), t('fare')], s.trips.map((x) => [x.ref, x.completed_at, x.employee, x.pickup_name, x.dest_name, x.cost_centre, x.po_ref, x.final_fare])) }, t('csv')) : null, h('button', { class: 'b sec', onclick: () => window.print() }, t('print'))),
    s ? [h('h2', {}, `${t('tab.statement')} ${s.month}`), h('p', {}, `${t('trips.n')}: ${s.trip_count} · ${t('total')}: ${fmt(s.total)} RWF`),
      Object.keys(s.by_cost_centre).length ? table([{ h: t('cost.centre'), f: (r) => r[0] }, { h: t('amount'), f: (r) => fmt(r[1]) }], Object.entries(s.by_cost_centre)) : null,
      table([{ h: t('ref'), f: (x) => x.ref }, { h: t('when'), f: (x) => when(x.completed_at) }, { h: t('employee'), f: (x) => x.employee }, { h: t('from'), f: (x) => x.pickup_name || '' }, { h: t('to'), f: (x) => x.dest_name || '' }, { h: t('cost.centre'), f: (x) => x.cost_centre || '' }, { h: t('po'), f: (x) => x.po_ref || '' }, { h: t('fare'), f: (x) => fmt(x.final_fare) }], s.trips)] : h('p', { class: 'muted' }, t('loading')));
}
function invoicesView(id) {
  const i = load('inv:' + id, () => api('GET', `/businesses/${id}/invoices`)); if (!i) return h('p', { class: 'muted' }, t('loading'));
  return table([{ h: t('period'), f: (x) => `${String(x.period_start).slice(0, 10)} – ${String(x.period_end).slice(0, 10)}` }, { h: t('amount'), f: (x) => fmt(x.total ?? x.amount) }, { h: t('status'), f: (x) => pill(String(x.status || '')) }], i.invoices);
}
function policyView(id, a) {
  const p = a.policy || {}, svc = load('svc', () => api('GET', '/services'));
  if (!svc) return h('p', { class: 'muted' }, t('loading'));   // the form is drawn once, with its checkboxes, so nothing typed can be lost when the list arrives
  const mf = input({ inputmode: 'numeric', value: p.max_fare ?? '' }), mb = input({ inputmode: 'numeric', value: a.monthly_budget ?? '' }), sh = input({ inputmode: 'numeric', value: p.start_hour ?? '' }), eh = input({ inputmode: 'numeric', value: p.end_hour ?? '' });
  const allowed = new Set(p.allowed_services || []), boxes = (svc ? svc.services : []).map((s) => ({ s, cb: h('input', { type: 'checkbox', checked: allowed.has(s.id) }) }));
  const num = (el) => { const v = el.value.replace(/\D/g, ''); return v === '' ? null : Number(v); };
  return h('div', { class: 'card' }, h('p', { class: 'muted' }, t('policy.sub')), h('div', { class: 'row' }, field(t('max.fare'), mf), field(t('budget'), mb), field(t('hours.from'), sh), field(t('hours.to'), eh)),
    h('b', {}, t('services.allowed')), h('div', { class: 'row' }, boxes.length ? boxes.map((x) => h('label', { class: 'row', style: 'margin:0 12px 0 0' }, x.cb, x.s['name_' + lang] || x.s.name_en)) : t('loading'), h('span', { class: 'muted' }, ' · ' + t('all.services') + ' = ∅')),
    h('div', { class: 'row' }, h('button', { class: 'b', onclick: () => act(async () => { const sel = boxes.filter((x) => x.cb.checked).map((x) => x.s.id); await api('PATCH', `/businesses/${id}/policy`, { max_fare: num(mf), monthly_budget: num(mb), start_hour: num(sh), end_hour: num(eh), allowed_services: sel }); Object.assign(state.account, { monthly_budget: num(mb), policy: { ...p, max_fare: num(mf), start_hour: num(sh), end_hour: num(eh), allowed_services: sel } }); }, t('saved')) }, t('save'))));
}

// ---------------------------------------------------------------- fleet
function fleetView() {
  const a = state.account, id = a.id, list = ['drivers', 'vehicles', 'trips', 'earnings', 'invite'];
  if (!list.includes(state.tab)) state.tab = 'drivers';
  const head = [h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: () => { state.account = null; render(); } }, t('back')), h('h1', { style: 'margin:0' }, a.name), pill(a.status)), a.status !== 'active' ? h('div', { class: 'banner' }, t('pending.verify')) : null, tabs(list)];
  const v = { drivers: () => fleetDrivers(id), vehicles: () => fleetVehicles(id), trips: () => fleetTrips(id), earnings: () => fleetEarnings(id, a), invite: () => fleetInvite(id) }[state.tab]();
  return h('div', {}, head, v);
}
function fleetDrivers(id) {
  const d = load('fd:' + id, () => api('GET', `/fleets/${id}/drivers`)); if (!d) return h('p', { class: 'muted' }, t('loading'));
  return table([{ h: t('driver'), f: (x) => x.display_name || '' }, { h: t('status'), f: (x) => pill(x.status) }, { h: t('online'), f: (x) => (x.is_online ? '●' : '') }, { h: t('rating'), f: (x) => (x.rating_avg ? Number(x.rating_avg).toFixed(1) : '') }, { h: t('completed'), f: (x) => x.completed_count }, { h: t('cancelled'), f: (x) => x.cancel_count }, { h: t('plate'), f: (x) => x.plate || '' }, { h: t('type'), f: (x) => x.vehicle_type || '' }], d.drivers);
}
function fleetVehicles(id) {
  const v = load('fv:' + id, () => api('GET', `/fleets/${id}/vehicles`)); if (!v) return h('p', { class: 'muted' }, t('loading'));
  const set = (x, status) => act(async () => { await api('PATCH', `/fleets/${id}/vehicles/${x.id}`, { status }); delete cache['fv:' + id]; }, t('saved'));
  return h('div', {}, table([{ h: t('plate'), f: (x) => x.plate }, { h: t('type'), f: (x) => x.vehicle_type }, { h: 'Make', f: (x) => [x.make, x.model].filter(Boolean).join(' ') }, { h: t('status'), f: (x) => pill(x.status) },
    { h: '', f: (x) => x.status === 'approved' ? h('button', { class: 'b sec', onclick: () => set(x, 'suspended') }, t('suspend')) : x.status === 'suspended' ? h('button', { class: 'b sec', onclick: () => set(x, 'approved') }, t('approve')) : '' }], v.vehicles),
    v.expiring_documents.length ? [h('h2', {}, t('docs.expiring')), table([{ h: t('doc'), f: (x) => x.doc_type }, { h: t('expires'), f: (x) => String(x.expiry_date).slice(0, 10) }], v.expiring_documents)] : null);
}
function fleetTrips(id) {
  const r = load('ft:' + id, () => api('GET', `/fleets/${id}/trips`)); if (!r) return h('p', { class: 'muted' }, t('loading'));
  return table([{ h: t('ref'), f: (x) => x.ref }, { h: t('status'), f: (x) => pill(x.status) }, { h: t('when'), f: (x) => when(x.completed_at) }, { h: t('fare'), f: (x) => fmt(x.final_fare) }], r.trips);
}
function fleetEarnings(id, a) {
  const e = load('fe:' + id, () => api('GET', `/fleets/${id}/earnings`)); if (!e) return h('p', { class: 'muted' }, t('loading'));
  const amt = input({ inputmode: 'numeric' });
  return h('div', {}, h('div', { class: 'kpi' }, [['trips.n', e.trips], ['gross', fmt(e.gross) + ' RWF'], ['commission', fmt(e.commission) + ' RWF'], ['fleet.share', fmt(e.fleet_share) + ' RWF'], ['driver.net', fmt(e.driver_net) + ' RWF'], e.fleet_balance != null ? ['fleet.balance', fmt(typeof e.fleet_balance === 'object' ? e.fleet_balance.eligible_payout : e.fleet_balance) + ' RWF'] : null].filter(Boolean).map(([k, v]) => h('div', { class: 'card' }, h('span', {}, t(k)), h('b', {}, v)))),
    a.role === 'owner' ? h('div', { class: 'card' }, h('div', { class: 'row' }, field(t('amount'), amt), h('button', { class: 'b', onclick: () => act(async () => { await api('POST', `/fleets/${id}/payouts`, { amount: Number(amt.value.replace(/\D/g, '')) }, { 'idempotency-key': (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) }); delete cache['fe:' + id]; }, t('payout.sent')) }, t('payout')))) : null);
}
function fleetInvite(id) {
  const ph = input({ type: 'tel', placeholder: t('phone.ph') });
  return h('div', { class: 'card' }, h('p', { class: 'muted' }, t('invite.sub')), h('div', { class: 'row' }, field(t('phone'), ph), h('button', { class: 'b', onclick: () => act(async () => { await api('POST', `/fleets/${id}/invites`, { phone: ph.value.trim() }); ph.value = ''; }, t('invited')) }, t('invite'))));
}

// ---------------------------------------------------------------- shell
// A background load finishing must never wipe what someone is typing: the form values are kept across a re-render of the same screen
// (and cleared after a successful action, so a saved form starts empty again).
let lastSig = '', skipRestore = false;
const formEls = () => [...root.querySelectorAll('main input, main select')];
function render() {
  const signedIn = !!store.get('biz.token');
  const sig = [signedIn, state.account && state.account.id, state.tab, state.stage].join('|');
  const snap = sig === lastSig && !skipRestore ? formEls().map((e) => (e.type === 'checkbox' ? e.checked : e.value)) : null;
  skipRestore = false;
  const sel = h('select', { 'aria-label': t('lang'), onchange: (e) => { setLang(e.target.value); render(); } }, LANGS.map((l) => h('option', { value: l, selected: l === lang }, { en: 'English', rw: 'Kinyarwanda', fr: 'Français' }[l])));
  document.title = t('app.name');
  root.replaceChildren(h('header', {}, h('b', {}, 'ABASARE'), h('span', {}, t('app.name').replace(/^Abasare\s*/, '')), h('span', { class: 'sp' }), sel, signedIn ? h('button', { onclick: () => { api('POST', '/auth/logout', {}).catch(() => {}); signOutLocal(); } }, t('signout')) : null),
    h('main', {}, state.flash ? h('div', { class: 'banner' + (state.flash.bad ? ' bad' : ' ok'), role: 'status', id: 'flash' }, state.flash.msg) : null, !signedIn ? loginView() : !state.account ? homeView() : state.account.kind === 'company' ? companyView() : fleetView()));
  lastSig = sig;
  if (snap) { const els = formEls(); if (els.length === snap.length) els.forEach((e, i) => { if (e.type === 'checkbox') e.checked = snap[i]; else if (e.value !== snap[i]) e.value = snap[i]; }); }
}
setLang(lang);
render();

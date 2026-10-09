'use strict';
// Abasare operations console: shared building blocks. No framework, no build step. All dynamic text goes in with textContent (XSS-safe).
// Load order (index.html): core.js, views-ops.js, views-admin.js, business.js, app.js. Classic scripts share one global scope, so keep names unique.
const API = '/api/v1';
const store = {   // sessionStorage can throw (blocked site data): never let that break the page
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  clear() { try { sessionStorage.clear(); } catch { /* ignore */ } },
};
const pref = {    // per-browser convenience (theme, table page size)
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const S = { access: store.get('rm_a'), refresh: store.get('rm_r'), roles: JSON.parse(store.get('rm_roles') || '[]'), perms: JSON.parse(store.get('rm_perms') || '[]'), permsAt: 0, tab: 'dashboard', state: {}, dirty: new Set(), nav: 0, notice: '' };
const $ = (s, r = document) => r.querySelector(s);

// append/replaceChildren ignore null, undefined and false (so `cond && node` and `cond ? node : null` are safe) and accept nested arrays.
for (const m of ['append', 'prepend', 'replaceChildren']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter((c) => c != null && c !== false)); };
}

/** Tiny DOM builder. Handlers: onclick etc. Buttons with an async onclick are disabled while they run (no double submit). */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'onclick' && tag === 'button' && typeof v === 'function') {
      e.addEventListener('click', (ev) => {
        if (e.dataset.busy) return;
        const r = v(ev);
        if (r && typeof r.then === 'function') { e.dataset.busy = '1'; e.setAttribute('aria-disabled', 'true'); r.then(() => {}, () => {}).then(() => { delete e.dataset.busy; e.removeAttribute('aria-disabled'); }); }   // aria-disabled (not disabled) keeps keyboard focus on the button
      });
    } else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c) e.append(c);
  return e;
}

// ---------------- formatting ----------------
const money = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US') + ' RWF');
const nfmt = (n) => (n == null || Number.isNaN(Number(n)) ? '-' : Number(n).toLocaleString('en-US'));
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Kigali', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const dateOnly = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'Africa/Kigali', day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const ago = (d) => { if (!d) return '-'; const s = Math.max(0, Math.round((Date.now() - new Date(d)) / 1000)); return s < 90 ? s + ' s ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const human = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const short = (s, n = 8) => (s ? String(s).slice(0, n) : '');

/** Status tone for pills: ok (green) | warn (amber) | bad (red) | info (blue) | '' (neutral). */
function statusCls(s) {
  const t = String(s ?? '');
  if (/CANCEL|REJECT|SUSPEND|FAIL|NO_DRIVER|EXPIRED|REVERSED|^open$|urgent|restricted|deactivated|overdue|inactive|imbalance/i.test(t)) return 'bad';
  if (/PENDING|REVIEW|INFO|SEARCH|REQUEST|DISPUTE|awaiting|in_progress|acknowledged|REVIEWED|resubmit|hold|DOCUMENTS|high|APPROVED_PENDING/i.test(t)) return 'warn';
  if (/APPROVED|ACTIVE|COMPLETED|SUCCESS|PAID|PROCESSED|resolved|closed|settled|verified|^active$|^ok$|balanced/i.test(t)) return 'ok';
  if (/ASSIGNED|ARRIV|PROGRESS|ONLINE|SCHEDULED/i.test(t)) return 'info';
  return '';
}
const pill = (t, cls) => h('span', { class: 'pill ' + (cls ?? statusCls(t)) }, human(t));

// ---------------- permissions ----------------
// The server decides what a role may do: sign-in, token refresh and GET /users/me return the caller's effective permissions (S.perms; '*' = everything).
// There is deliberately no copy of the role table here, so the console can never drift from the API (which re-checks every request anyway).
const heldPerms = () => new Set(S.perms);
/** can('bookings.dispatch') or, for older call sites, can('business_manager'): true for a super admin, a held role name, or a held permission. */
const can = (...need) => S.roles.includes('super_admin') || S.perms.includes('*') || need.some((n) => S.roles.includes(n) || heldPerms().has(n));
/** Re-reads roles and permissions from the server (at most every 20 s unless forced). Returns true when they changed, so the shell can rebuild its menu. */
async function syncAccess(force = false) {
  if (!S.access || (!force && Date.now() - S.permsAt < 20000)) return false;
  S.permsAt = Date.now();
  try {
    const me = await api('GET', '/users/me');
    const roles = me.roles || [], perms = me.permissions || [];
    const changed = JSON.stringify(roles) !== JSON.stringify(S.roles) || JSON.stringify(perms) !== JSON.stringify(S.perms);
    S.roles = roles; S.perms = perms; store.set('rm_roles', JSON.stringify(roles)); store.set('rm_perms', JSON.stringify(perms));
    return changed;
  } catch { return false; }
}
const myId = () => { try { return JSON.parse(atob(S.access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch { return null; } };

// ---------------- API ----------------
class ApiError extends Error { constructor(msg, status, code) { super(msg); this.status = status; this.code = code; } }
let refreshing = null;
function save(t) { S.access = t.access_token; S.refresh = t.refresh_token; S.roles = t.roles || S.roles; S.perms = t.permissions || S.perms; S.permsAt = Date.now(); store.set('rm_perms', JSON.stringify(S.perms)); store.set('rm_a', S.access); store.set('rm_r', S.refresh); store.set('rm_roles', JSON.stringify(S.roles)); }
function doRefresh() {
  if (!S.refresh) return Promise.resolve(false);
  refreshing ||= (async () => {
    try {
      const r = await fetch(API + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: S.refresh }) });
      if (!r.ok) return false; save(await r.json()); return true;
    } catch { return false; } finally { setTimeout(() => { refreshing = null; }, 0); }
  })();
  return refreshing;
}
/** Ends the session and shows the sign-in page with an explanation (never a blank page). */
function expireSession(msg = 'Your session has expired. Please sign in again.') {
  if (!S.access && !S.refresh) return;
  store.clear(); S.access = S.refresh = null; S.roles = []; S.perms = []; S.notice = msg; render();
}
async function api(method, path, body, retry = true) {
  let r;
  try { r = await fetch(API + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(S.access ? { authorization: 'Bearer ' + S.access } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'network'); }
  if (r.status === 401 && S.access) {
    if (retry && await doRefresh()) return api(method, path, body, false);
    expireSession(); throw new ApiError('Your session has expired.', 401, 'unauthorized');
  }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
  if (!r.ok) {
    const msg = r.status === 403 ? (data?.error?.message || 'You do not have permission to do this.') : (data?.error?.message || 'Request failed (' + r.status + ')');
    throw new ApiError(msg, r.status, data?.error?.code);
  }
  return data;
}
function logout() { if (typeof stopLive === 'function') stopLive(); if (S.access) fetch(API + '/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + S.access } }).catch(() => {}); store.clear(); S.access = S.refresh = null; S.roles = []; S.perms = []; S.notice = ''; render(); }

// ---------------- feedback ----------------
function toast(msg, bad) {
  let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + (bad ? 'err' : 'ok') }, msg); box.append(t); setTimeout(() => t.remove(), bad ? 7000 : 4000);
}
async function act(fn, after) { try { await fn(); toast('Done'); if (after) after(); } catch (e) { toast(e.message, true); } }
const loading = (text = 'Loading') => h('div', { class: 'loader', role: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), text + '…');
function errorPanel(e, retry) {
  const denied = e?.status === 403;
  return h('div', { class: 'alert bad', role: 'alert' }, h('b', {}, denied ? 'You do not have access to this section.' : e?.status === 0 ? 'The server cannot be reached.' : 'This page could not be loaded.'),
    h('div', {}, denied ? 'Ask a super admin if you need a different role.' : e?.message || String(e)), retry && !denied ? h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: retry }, 'Try again')) : null);
}

// ---------------- dialogs ----------------
let dlgSeq = 0;
/** Detail dialog: title, close button, Esc, backdrop click. Returns { el, close }. Only one detail dialog of the same key at a time. */
function openDialog(title, content, { width = 760, key = null } = {}) {
  if (key) document.querySelectorAll(`dialog[data-key="${key}"]`).forEach((x) => { try { x.close(); } catch { /* ignore */ } x.remove(); });
  const id = 'dlg' + (++dlgSeq), opener = document.activeElement;
  const d = h('dialog', { 'aria-labelledby': id, style: `max-width:${width}px`, 'data-key': key });
  const close = () => { if (d.open) d.close(); d.remove(); if (opener && opener.isConnected && opener.focus) opener.focus(); };
  d.append(h('div', { class: 'dhead' }, h('h2', { id }, title), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, '×')), h('div', { class: 'dbody' }, content));
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.addEventListener('click', (e) => { if (e.target === d) close(); });
  document.body.append(d); d.showModal();
  return { el: d, close };
}

/** Confirm dialog with optional reason and validated fields.
 *  field: { name, label, type: text|email|number|date|select|textarea, value, options: [str | {value,label}], required, min, max, integer, maxlength, help, pattern, patternMsg }
 *  Resolves to an object of values (plus reason) or null when cancelled. */
function ask(title, { reason = false, confirmText = 'Confirm', danger = false, fields = [], message = null } = {}) {
  return new Promise((res) => {
    const id = 'dlg' + (++dlgSeq), opener = document.activeElement;
    const d = h('dialog', { 'aria-labelledby': id });
    const inputs = {}, errs = {};
    const rs = reason ? h('textarea', { rows: 3, placeholder: 'Reason (required, kept in the audit log)', 'aria-label': 'Reason', style: 'width:100%' }) : null;
    const rsErr = h('div', { class: 'ferr', role: 'alert' });
    const f = fields.map((x) => {
      const opts = (x.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
      const el = h(x.type === 'select' ? 'select' : x.type === 'textarea' ? 'textarea' : 'input', {
        placeholder: x.label, 'aria-label': x.label, type: x.type === 'number' ? 'number' : x.type === 'date' ? 'date' : x.type === 'email' ? 'email' : x.type === 'select' || x.type === 'textarea' ? null : 'text',
        value: x.type === 'select' || x.type === 'textarea' ? null : x.value ?? null, maxlength: x.maxlength || null, min: x.min ?? null, max: x.max ?? null, step: x.type === 'number' ? (x.integer ? 1 : 'any') : null,
        inputmode: x.type === 'number' && x.integer ? 'numeric' : null, rows: x.type === 'textarea' ? 3 : null, style: 'width:100%',
      }, opts.map((o) => h('option', { value: o.value, selected: String(o.value) === String(x.value ?? '') }, o.label)));
      if (x.type === 'textarea' && x.value) el.value = x.value;
      inputs[x.name] = el; errs[x.name] = h('div', { class: 'ferr', role: 'alert' });
      el.addEventListener('input', () => { errs[x.name].textContent = ''; el.removeAttribute('aria-invalid'); });
      return h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, x.label, x.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null), el, x.help ? h('span', { class: 'hint' }, x.help) : null, errs[x.name]);
    });
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (d.open) d.close(); d.remove(); if (opener && opener.isConnected && opener.focus) opener.focus(); res(v); };
    const validate = () => {
      let first = null, okAll = true;
      const fail = (name, el, msg) => { errs[name].textContent = msg; el.setAttribute('aria-invalid', 'true'); okAll = false; first ||= el; };
      for (const x of fields) {
        const el = inputs[x.name], raw = String(el.value ?? '').trim();
        if (x.required && !raw) { fail(x.name, el, 'Required'); continue; }
        if (!raw) continue;
        if (x.type === 'number') {
          const n = Number(raw);
          if (!Number.isFinite(n)) fail(x.name, el, 'Enter a number');
          else if (x.integer && !Number.isInteger(n)) fail(x.name, el, 'Enter a whole number');
          else if (x.min != null && n < x.min) fail(x.name, el, 'At least ' + nfmt(x.min));
          else if (x.max != null && n > x.max) fail(x.name, el, 'At most ' + nfmt(x.max));
        } else if (x.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) fail(x.name, el, 'Enter a valid email address');
        else if (x.pattern && !new RegExp(x.pattern).test(raw)) fail(x.name, el, x.patternMsg || 'Invalid format');
      }
      rsErr.textContent = '';
      if (reason && (!rs.value || rs.value.trim().length < 5)) { rsErr.textContent = 'Please give a reason (at least 5 characters).'; okAll = false; first ||= rs; }
      first?.focus();
      return okAll;
    };
    const submit = () => {
      if (!validate()) return;
      const out = { reason: rs?.value.trim() };
      for (const x of fields) { const raw = inputs[x.name].value; out[x.name] = x.type === 'number' ? (String(raw).trim() === '' ? undefined : Number(raw)) : typeof raw === 'string' ? raw.trim() : raw; }
      finish(out);
    };
    d.append(...[h('div', { class: 'dhead' }, h('h2', { id }, title), h('button', { class: 'x', 'aria-label': 'Close', onclick: () => finish(null) }, '×')),
      h('div', { class: 'dbody' }, message && (typeof message === 'string' ? h('p', { class: 'effect' }, message) : message), ...f, rs, rsErr,
        h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => finish(null) }, 'Cancel'), h('button', { class: 'b ' + (danger ? 'red' : ''), onclick: submit }, confirmText)))].filter(Boolean));
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });        // Esc
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });
    document.body.append(d); d.showModal();
    (Object.values(inputs)[0] || rs)?.focus();
  });
}

// ---------------- CSV (formula-injection safe, Excel-friendly) ----------------
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob); const a = h('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000);
}
function downloadCsv(name, headers, rows) {
  const text = '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), name.endsWith('.csv') ? name : name + '.csv');
}

// ---------------- tables ----------------
/** Column: { h: header, k: row key | f: (row) => node/text, s: (row) => sort value, csv: (row) => text, cls }.
 *  table(cols, rows, onRow, emptyText, { csv: 'file-name', search: bool, pageSize: 50, sort: false, caption }) — search appears automatically from 8 rows.
 *  Header is sticky, columns sort on click, the wrapper scrolls inside itself so the page never scrolls sideways. */
function table(cols, rows, onRow, empty = 'Nothing here yet.', opts = {}) {
  const pageSize = opts.pageSize || 50;
  const st = { q: '', sort: opts.sortBy ?? null, dir: opts.sortDir ?? 1, page: 0 };
  const sortable = opts.sort !== false;
  const items = rows.map((r) => {
    const tr = h('tr', { class: onRow ? 'click' : '' }, cols.map((c) => h('td', { class: c.cls || null, 'data-label': c.h || null }, c.f ? c.f(r) : r[c.k] ?? '-')));
    if (onRow) {
      tr.tabIndex = 0;
      const open = () => Promise.resolve().then(() => onRow(r)).catch((e) => toast(e.message, true));
      tr.addEventListener('click', (ev) => { if (!ev.target.closest('a,button,input,select,textarea')) open(); });
      tr.addEventListener('keydown', (ev) => { if (ev.target === tr && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); open(); } });
    }
    return { r, tr, text: tr.textContent.toLowerCase() };
  });
  const sortVal = (it, i) => { const c = cols[i]; const v = c.s ? c.s(it.r) : c.k ? it.r[c.k] : it.tr.children[i].textContent; return v == null ? '' : v; };
  const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const tbody = h('tbody'), pager = h('div', { class: 'pager' }), count = h('span', { class: 'muted' });
  const heads = cols.map((c, i) => {
    const th = h('th', { class: c.cls || null, scope: 'col' });
    if (sortable && c.h && (c.k || c.s)) { const b = h('button', { class: 'sortbtn', title: 'Sort by ' + c.h, onclick: () => { st.dir = st.sort === i ? -st.dir : 1; st.sort = i; st.page = 0; draw(); } }, c.h, h('span', { class: 'arrow', 'aria-hidden': 'true' })); th.append(b); } else th.append(c.h || '');
    return th;
  });
  function draw() {
    let list = items.filter((it) => !st.q || it.text.includes(st.q));
    if (st.sort != null) { const i = st.sort; list = list.map((it) => [it, sortVal(it, i)]).sort((a, b) => cmp(a[1], b[1]) * st.dir).map((x) => x[0]); }
    const pages = Math.max(1, Math.ceil(list.length / pageSize)); st.page = Math.min(st.page, pages - 1);
    const slice = list.slice(st.page * pageSize, (st.page + 1) * pageSize);
    tbody.replaceChildren(...(slice.length ? slice.map((x) => x.tr) : [h('tr', {}, h('td', { colspan: cols.length, class: 'empty' }, items.length ? 'No rows match your search.' : empty))]));
    heads.forEach((th, i) => { th.setAttribute('aria-sort', st.sort === i ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'); const a = th.querySelector('.arrow'); if (a) a.textContent = st.sort === i ? (st.dir > 0 ? ' ▲' : ' ▼') : ''; });
    count.textContent = items.length ? (list.length === items.length ? `${items.length} row${items.length === 1 ? '' : 's'}` : `${list.length} of ${items.length} rows`) : '';
    pager.replaceChildren(...(pages > 1 ? [h('button', { class: 'b sec', disabled: st.page === 0, onclick: () => { st.page--; draw(); } }, 'Previous'), h('span', {}, `Page ${st.page + 1} of ${pages}`), h('button', { class: 'b sec', disabled: st.page >= pages - 1, onclick: () => { st.page++; draw(); } }, 'Next')] : []));
    current = list;
  }
  let current = items;
  const showSearch = opts.search ?? (items.length >= 8 && sortable);
  const bar = (showSearch || opts.csv) ? h('div', { class: 'tbar' },
    showSearch ? h('input', { type: 'search', class: 'tsearch', placeholder: 'Filter these rows…', 'aria-label': 'Filter rows', oninput: (e) => { st.q = e.target.value.trim().toLowerCase(); st.page = 0; draw(); } }) : null, count,
    opts.csv ? h('button', { class: 'b sec sm', title: 'Download the rows currently shown (filtered and sorted) as CSV', onclick: () => {
      const cc = cols.filter((c) => c.h && (c.k || c.f));
      downloadCsv(opts.csv, cc.map((c) => c.h), current.map((it) => cc.map((c) => { if (c.csv) return c.csv(it.r); if (c.k) return it.r[c.k]; const i = cols.indexOf(c); return it.tr.children[i].textContent; })));
    } }, 'Download CSV') : null) : null;
  draw();
  return h('div', { class: 'tblwrap' }, bar, h('div', { class: 'tbl' }, h('table', {}, opts.caption ? h('caption', { class: 'sr' }, opts.caption) : null, h('thead', {}, h('tr', {}, heads)), tbody)), pager);
}
const dateCol = (title, k, withTime = true) => ({ h: title, f: (r) => (withTime ? when(r[k]) : dateOnly(r[k])), s: (r) => (r[k] ? Date.parse(r[k]) : 0), csv: (r) => r[k] || '', cls: 'nowrap' });
const moneyCol = (title, k) => ({ h: title, f: (r) => money(r[k]), s: (r) => (r[k] == null ? -1 : Number(r[k])), csv: (r) => r[k] ?? '', cls: 'num' });

// ---------------- KPI cards and sparklines ----------------
/** Inline-SVG sparkline from a list of numbers (null = still loading). */
function sparkline(values, { w = 120, hgt = 34, tone = 'brand', label = 'Trend' } = {}) {
  if (!values || values.length < 2) return h('span', { class: 'spark skeleton', 'aria-hidden': 'true' });
  const max = Math.max(...values), min = Math.min(...values, 0), span = max - min || 1, pad = 3;
  const pts = values.map((v, i) => [pad + (i * (w - 2 * pad)) / (values.length - 1), hgt - pad - ((v - min) / span) * (hgt - 2 * pad)]);
  const line = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' '), last = pts[pts.length - 1];
  return svg('svg', { class: 'spark ' + tone, viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, role: 'img', 'aria-label': `${label}: ${values.map(nfmt).join(', ')}` },
    svg('title', {}, document.createTextNode(`${label}: ${values.map(nfmt).join(', ')}`)),
    svg('polygon', { class: 'area', points: `${pad},${hgt - pad} ${line} ${w - pad},${hgt - pad}` }), svg('polyline', { class: 'line', points: line, fill: 'none' }), svg('circle', { class: 'dot', cx: last[0].toFixed(1), cy: last[1].toFixed(1), r: 2.5 }));
}
/** KPI card. opts: { tone: bad|warn|ok, hint, spark: node, delta: number|null (percent vs previous period), to: tab name (click to open) } */
function kpi(label, value, opts = {}) {
  if (typeof opts === 'boolean') opts = { tone: opts ? 'bad' : '' };
  const d = opts.delta;
  const el = h(opts.to ? 'button' : 'div', { class: 'card kpi' + (opts.tone ? ' ' + opts.tone : '') + (opts.to ? ' link' : ''), onclick: opts.to ? () => go(opts.to) : null, title: opts.to ? 'Open ' + opts.to : null },
    h('div', { class: 'l' }, label), h('div', { class: 'v' }, value ?? '-'),
    d == null ? null : h('div', { class: 'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') }, (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + Math.abs(d) + '% vs previous period'),
    opts.hint ? h('div', { class: 'hint' }, opts.hint) : null, opts.spark || null);
  return el;
}

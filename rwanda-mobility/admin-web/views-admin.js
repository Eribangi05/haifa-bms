'use strict';
// Back-office views: request codes, finance, business accounts, privacy, audit log, staff, plus the public staff-invite activation page.

/** Sub-navigation inside a tab (keeps long pages short and only loads what is shown). */
function subnav(tab, items, current) {
  return h('div', { class: 'subnav', role: 'tablist' }, items.map(([k, label]) => h('button', { role: 'tab', 'aria-selected': k === current ? 'true' : 'false', class: k === current ? 'on' : '', onclick: () => go(tab, { ...S.state, sub: k }) }, label)));
}

// =============================================================== REQUEST CODES
async function fetchBlob(path) {
  const r = await fetch(API + path, { headers: { authorization: 'Bearer ' + S.access } });
  if (r.status === 401) { expireSession(); throw new Error('Your session has expired.'); }
  if (!r.ok) throw new Error('Download failed (' + r.status + ')');
  return r.blob();
}
const blobToDataUrl = (b) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
// Branded QR (vector): rounded dots, Rwanda-blue corners, Abasare mark in the middle. PNG is drawn from the SVG in the browser so printers get a sharp 2048 px file.
const brandedSvg = async (c) => (await fetchBlob(`/admin/request-codes/${c.id}/qr-branded.svg`)).text();
async function downloadQr(c) {
  const svg = await brandedSvg(c);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const cv = document.createElement('canvas'); cv.width = cv.height = 2048; const g = cv.getContext('2d'); g.drawImage(img, 0, 0, 2048, 2048);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png')); downloadBlob(blob, `abasare-${c.code}.png`);
  } finally { URL.revokeObjectURL(url); }
}
async function downloadQrSvg(c) { downloadBlob(new Blob([await brandedSvg(c)], { type: 'image/svg+xml' }), `abasare-${c.code}.svg`); }
const escHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
// The printed poster is for the public at the venue, so it deliberately shows all three languages together (each line is one language).
// kind: 'a5' | 'a4' (poster, vector QR) | 'sticker' (square, QR only with a call to action).
async function printPoster(c, kind = 'a5') {
  const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print the poster', true); return; }
  const qr = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(await brandedSvg(c));
  const logo = await fetch('logo.png').then((r) => r.blob()).then(blobToDataUrl).catch(() => '');
  const sticker = kind === 'sticker', a4 = kind === 'a4';
  const W = sticker ? 100 : a4 ? 210 : 148, H = sticker ? 108 : a4 ? 297 : 210, k = W / 148;      // everything scales from the A5 design
  const css = `@page{size:${W}mm ${H}mm;margin:0}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;font-family:"Segoe UI",system-ui,Arial,sans-serif;color:#0F3554}
.p{width:${W}mm;height:${H}mm;position:relative;overflow:hidden;background:#fff;display:flex;flex-direction:column}
.flag{display:flex;flex-direction:column}.flag i{display:block;width:100%}.f1{background:#00A1DE;height:${7 * k}mm}.f2{background:#FAD201;height:${2.4 * k}mm}.f3{background:#20603D;height:${3.6 * k}mm}
.head{display:flex;align-items:center;justify-content:center;gap:${4 * k}mm;padding:${4 * k}mm ${8 * k}mm ${1 * k}mm}.head img{height:${16 * k}mm;width:${16 * k}mm;border-radius:${3.5 * k}mm}
.brand b{display:block;font-size:${27 * k}pt;letter-spacing:.5mm;color:#0069A8;line-height:1}.brand span{font-size:${9.5 * k}pt;letter-spacing:.6mm;color:#20603D;font-weight:700}
.venue{text-align:center;font-size:${12 * k}pt;font-weight:700;margin:${1 * k}mm ${8 * k}mm 0}.partner{text-align:center;font-size:${9 * k}pt;color:#55708a}
h1{text-align:center;margin:${2 * k}mm ${6 * k}mm 0;font-size:${23 * k}pt;line-height:1.1;color:#0F3554}.sub{text-align:center;font-size:${11 * k}pt;line-height:1.35;color:#2c4a63}.sub b{color:#0069A8}
.cardwrap{display:flex;justify-content:center;margin:${4.5 * k}mm 0 ${3 * k}mm}
.card{position:relative;width:${80 * k}mm;height:${80 * k}mm;background:#fff;border-radius:${6 * k}mm;border:${1.1 * k}mm solid #0069A8;padding:${3 * k}mm}
.card img.q{width:100%;height:100%;display:block}
.c{position:absolute;width:${11 * k}mm;height:${11 * k}mm;border:${1.6 * k}mm solid #FAD201}.c1{left:-${2.4 * k}mm;top:-${2.4 * k}mm;border-right:0;border-bottom:0;border-top-left-radius:${7 * k}mm}.c2{right:-${2.4 * k}mm;top:-${2.4 * k}mm;border-left:0;border-bottom:0;border-top-right-radius:${7 * k}mm}
.c3{left:-${2.4 * k}mm;bottom:-${2.4 * k}mm;border-right:0;border-top:0;border-bottom-left-radius:${7 * k}mm}.c4{right:-${2.4 * k}mm;bottom:-${2.4 * k}mm;border-left:0;border-top:0;border-bottom-right-radius:${7 * k}mm}
.pill{display:flex;justify-content:center}.pill span{background:#0069A8;color:#fff;border-radius:${8 * k}mm;padding:${1.3 * k}mm ${6 * k}mm;font-weight:800;font-size:${11.5 * k}pt;letter-spacing:.4mm}
.steps{display:flex;justify-content:center;gap:${5 * k}mm;margin:${3.5 * k}mm ${6 * k}mm 0}.st{width:${38 * k}mm;text-align:center;font-size:${8 * k}pt;line-height:1.25}.st i{display:flex;align-items:center;justify-content:center;width:${7 * k}mm;height:${7 * k}mm;margin:0 auto ${1 * k}mm;border-radius:50%;background:#FAD201;color:#0F3554;font-style:normal;font-weight:800;font-size:${11 * k}pt}
.foot{margin-top:auto;background:#20603D;color:#fff;text-align:center;padding:${2.6 * k}mm ${6 * k}mm;font-size:${8.5 * k}pt;line-height:1.3}.foot b{font-size:${11.5 * k}pt}.code{display:inline-block;margin-top:${.8 * k}mm;font-family:Consolas,monospace;letter-spacing:.5mm;font-size:${8 * k}pt;opacity:.85}
.tag{text-align:center;font-size:${8.5 * k}pt;letter-spacing:.5mm;color:#0069A8;font-weight:700;margin-top:${2 * k}mm}
.sk .card{width:${72 * k}mm;height:${72 * k}mm}.sk h1{font-size:${20 * k}pt;margin-top:${2 * k}mm}.sk .cardwrap{margin-top:${3 * k}mm}`;
  const steps = [['1', 'Sikana', 'Scannez', 'Scan'], ['2', 'Hitamo urugendo', 'Choisissez', 'Choose your ride'], ['3', 'Genda', 'Partez', 'Go']];
  const stepsHtml = steps.map(([n, rw, fr, en]) => `<div class="st"><i>${n}</i><b>${rw}</b><br>${fr}<br>${en}</div>`).join('');
  const brand = `<div class="head">${logo ? `<img src="${logo}" alt="">` : ''}<div class="brand"><b>ABASARE</b><span>GENDA · KORA · SURA</span></div></div>`;
  const venue = `<div class="venue">${escHtml(c.label)}</div>${c.partner_name ? `<div class="partner">${escHtml(c.partner_name)}</div>` : ''}`;
  const card = `<div class="cardwrap"><div class="card"><span class="c c1"></span><span class="c c2"></span><span class="c c3"></span><span class="c c4"></span><img class="q" src="${qr}" alt="QR"></div></div><div class="pill"><span>SIKANA · SCANNEZ · SCAN</span></div>`;
  const body = sticker
    ? `<div class="flag"><i class="f1"></i><i class="f2"></i><i class="f3"></i></div>${brand}<h1>Sikana usabe umushoferi</h1><div class="sub">Scannez pour un chauffeur · Scan for a driver</div>${card}<div class="foot"><b>${escHtml(SUPPORT_PHONE)}</b><br><span class="code">${escHtml(c.code)}</span></div>`
    : `<div class="flag"><i class="f1"></i><i class="f2"></i><i class="f3"></i></div>${brand}${venue}<h1>Sikana usabe umushoferi</h1><div class="sub">Scannez pour demander un chauffeur<br><b>Scan to request a driver</b></div>${card}<div class="steps">${stepsHtml}</div><div class="foot"><b>${escHtml(SUPPORT_PHONE)}</b><br>Umutekano · Sécurité · Safety<br><span class="code">${escHtml(c.code)}</span></div>`;
  const d = w.document; d.open(); d.write(`<!doctype html><html><head><meta charset="utf-8"><title>Abasare ${escHtml(c.code)}</title><style>${css}</style></head><body><div class="p${sticker ? ' sk' : ''}">${body}</div></body></html>`); d.close();
  const imgs = [...d.images]; await Promise.all(imgs.map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
  setTimeout(() => { w.focus(); w.print(); }, 300);
}
const SUPPORT_PHONE = '+250 786 880 880';
V.codes = async (el) => {
  const d = await api('GET', '/admin/request-codes'), manage = can('codes.manage');
  const f = { label: h('input', { placeholder: 'Venue name (e.g. Hotel Serena)', maxlength: 120, 'aria-label': 'Venue name' }), partner: h('input', { placeholder: 'Partner name (optional)', maxlength: 120, 'aria-label': 'Partner name' }),
    lat: h('input', { placeholder: 'Latitude', type: 'number', step: 'any', min: -90, max: 90, 'aria-label': 'Latitude' }), lng: h('input', { placeholder: 'Longitude', type: 'number', step: 'any', min: -180, max: 180, 'aria-label': 'Longitude' }),
    note: h('input', { placeholder: 'Pickup note (e.g. Main entrance, ask the receptionist)', maxlength: 300, 'aria-label': 'Pickup note' }), svc: h('select', { 'aria-label': 'Default service' }, h('option', { value: 'ride' }, 'Default: ride'), h('option', { value: 'abasare' }, 'Default: Abasare (driver for your car)')),
    exp: h('input', { type: 'date', 'aria-label': 'Expiry date' }) };
  const err = h('div', { class: 'ferr', role: 'alert' });
  const form = h('div', { class: 'card' }, h('h2', {}, 'New request code'), h('div', { class: 'fgrid' }, h('label', { class: 'field' }, 'Venue name', f.label), h('label', { class: 'field' }, 'Partner', f.partner), h('label', { class: 'field' }, 'Latitude', f.lat), h('label', { class: 'field' }, 'Longitude', f.lng),
    h('label', { class: 'field' }, 'Pickup note', f.note), h('label', { class: 'field' }, 'Default service', f.svc), h('label', { class: 'field' }, 'Expires (optional)', f.exp)),
    h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: () => { if (!navigator.geolocation) { toast('Location is not available in this browser', true); return; } navigator.geolocation.getCurrentPosition((p) => { f.lat.value = p.coords.latitude.toFixed(6); f.lng.value = p.coords.longitude.toFixed(6); }, () => toast('Could not get your location', true)); } }, 'Use my current location')), err,
    h('button', { class: 'b', onclick: () => {
      err.textContent = ''; const lat = Number(f.lat.value), lng = Number(f.lng.value);
      if (!f.label.value.trim()) { err.textContent = 'Venue name is required.'; f.label.focus(); return; }
      if (f.lat.value === '' || f.lng.value === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { err.textContent = 'Enter a valid latitude (-90 to 90) and longitude (-180 to 180).'; f.lat.focus(); return; }
      const body = { label: f.label.value.trim(), lat, lng, default_service: f.svc.value };
      if (f.partner.value.trim()) body.partner_name = f.partner.value.trim(); if (f.note.value.trim()) body.pickup_note = f.note.value.trim();
      if (f.exp.value) body.expires_at = new Date(f.exp.value + 'T23:59:59+02:00').toISOString();
      return act(() => api('POST', '/admin/request-codes', body), () => go('codes')); } }, 'Create code'));
  el.append(h('h1', {}, 'Request codes'), note('Print a QR code for a hotel, bar, mall or taxi rank. Customers scan it and request a ride or an Umusare with almost no steps. Scans are counted once per phone network every 10 minutes.'),
    table([{ h: 'Code', f: (c) => h('code', {}, c.code), s: (c) => c.code, csv: (c) => c.code }, { h: 'Venue', f: (c) => c.label + (c.partner_name ? ' (' + c.partner_name + ')' : ''), s: (c) => c.label }, { h: 'Default', f: (c) => human(c.default_service), s: (c) => c.default_service },
      { h: 'Scans', k: 'scans', cls: 'num' }, { h: 'Bookings', k: 'bookings', cls: 'num' }, { h: 'Completed', k: 'completed', cls: 'num' }, { h: 'Expires', f: (c) => (c.expires_at ? when(c.expires_at) : '-'), s: (c) => (c.expires_at ? Date.parse(c.expires_at) : Infinity) },
      { h: 'Status', f: (c) => (c.active && !c.expired ? pill('active', 'ok') : pill(c.expired ? 'expired' : 'inactive', 'bad')), s: (c) => (c.active && !c.expired ? 0 : 1), csv: (c) => (c.active && !c.expired ? 'active' : c.expired ? 'expired' : 'inactive') },
      { h: '', f: (c) => h('span', { class: 'row' }, h('button', { class: 'b sec', onclick: () => act(() => downloadQr(c)) }, 'QR (PNG)'), h('button', { class: 'b sec', onclick: () => act(() => downloadQrSvg(c)) }, 'QR (SVG)'), h('button', { class: 'b sec', onclick: () => act(() => printPoster(c, 'a5')) }, 'Poster A5'), h('button', { class: 'b sec', onclick: () => act(() => printPoster(c, 'a4')) }, 'Poster A4'), h('button', { class: 'b sec', onclick: () => act(() => printPoster(c, 'sticker')) }, 'Sticker'),
        manage && h('button', { class: 'b sec', onclick: () => act(() => api('PATCH', '/admin/request-codes/' + c.id, { active: !c.active }), () => go('codes')) }, c.active ? 'Deactivate' : 'Activate')) }], d.codes, null, 'No request codes yet.', { csv: 'request-codes' }),
    manage && form);
};

// =============================================================== FINANCE
const dayRange = (from, to) => ({ from: from ? new Date(from + 'T00:00:00+02:00').toISOString() : undefined, to: to ? new Date(to + 'T23:59:59+02:00').toISOString() : undefined });
async function exportCsv(kind, from, to) {
  const p = dayRange(from, to), qp = Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const r = await fetch(`${API}/admin/finance/export/${kind}${qp ? '?' + qp : ''}`, { headers: { authorization: 'Bearer ' + S.access } });
  if (r.status === 401) { expireSession(); throw new Error('Your session has expired.'); }
  if (!r.ok) throw new Error(r.status === 403 ? 'You are not allowed to export this.' : 'Export failed (' + r.status + ')');
  downloadBlob(await r.blob(), `${kind}${from ? '-' + from : ''}${to ? '-to-' + to : ''}.csv`);
}
const FIN_SUBS = [['position', 'Ledger and exports'], ['payments', 'Transactions'], ['refunds', 'Refunds'], ['payouts', 'Payouts'], ['debts', 'Cancellation fee debts'], ['recon', 'Reconciliation']];
V.finance = async (el, state = {}) => {
  const sub = FIN_SUBS.some((s) => s[0] === state.sub) ? state.sub : 'position';
  el.append(h('h1', {}, 'Finance'), subnav('finance', FIN_SUBS, sub));
  const body = h('div'); el.append(body);
  await FIN[sub](body, state);
};
const FIN = {};
FIN.position = async (el) => {
  const pos = await api('GET', '/admin/finance/position');
  const from = h('input', { type: 'date', 'aria-label': 'From date' }), to = h('input', { type: 'date', 'aria-label': 'To date' });
  el.append(pos.integrity.balanced ? h('div', { class: 'alert ok' }, 'Ledger integrity check: balanced (total debits equal total credits).') : h('div', { class: 'alert bad', role: 'alert' }, 'LEDGER IMBALANCE DETECTED. Stop payouts and investigate.'),
    h('h2', {}, 'Ledger position'), table([{ h: 'Account', f: (a) => human(a.name), s: (a) => a.name }, { h: 'Type', f: (a) => human(a.type), s: (a) => a.type }, moneyCol('Debit', 'debit'), moneyCol('Credit', 'credit'), moneyCol('Balance', 'balance')], pos.accounts, null, 'No ledger accounts.', { csv: 'ledger-position' }),
    h('h2', {}, 'Export to CSV'), h('p', { class: 'muted' }, 'Each export is recorded in the audit log. Leave the dates empty for everything. Dates use Kigali time.'),
    h('div', { class: 'row' }, h('label', {}, 'From ', from), h('label', {}, 'To ', to)),
    h('div', { class: 'row' }, ['payments', 'ledger', 'trips', 'earnings'].map((k) => h('button', { class: 'b sec', onclick: () => { if (from.value && to.value && from.value > to.value) { toast('The start date is after the end date.', true); return; } return act(() => exportCsv(k, from.value, to.value)); } }, 'Export ' + k + '.csv'))));
};
FIN.payments = async (el, state) => {
  const q = state.q || '', stt = state.pstatus || '', mth = state.method || '';
  const pays = await api('GET', `/admin/finance/payments?limit=200${q ? '&q=' + encodeURIComponent(q) : ''}${stt ? '&status=' + stt : ''}${mth ? '&method=' + mth : ''}`);
  const inp = h('input', { type: 'search', placeholder: 'Payment/provider reference or booking ref', 'aria-label': 'Search payments', value: q, style: 'min-width:min(100%,320px)' });
  const s1 = h('select', { 'aria-label': 'Status' }, ['', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED'].map((s) => h('option', { value: s, selected: s === stt }, s ? human(s) : 'Any status')));
  const s2 = h('select', { 'aria-label': 'Method' }, [['', 'Any method'], ['cash', 'Cash'], ['mtn_momo', 'MTN MoMo'], ['airtel_money', 'Airtel Money']].map(([v, l]) => h('option', { value: v, selected: v === mth }, l)));
  el.append(filterBar(inp, s1, s2, h('button', { type: 'submit', class: 'b', onclick: () => go('finance', { sub: 'payments', q: inp.value.trim(), pstatus: s1.value, method: s2.value }) }, 'Search')), limitNote(pays.payments.length, 200, 'payments'),
    table([{ h: 'Reference', k: 'reference' }, { h: 'Booking', k: 'booking_ref' }, { h: 'Method', f: (p) => methodName(p.method), s: (p) => p.method }, { h: 'Status', f: (p) => pill(p.status), s: (p) => p.status, csv: (p) => p.status }, moneyCol('Amount', 'amount'), { h: 'Settlement', f: (p) => (p.settlement_status ? pill(p.settlement_status) : '-'), s: (p) => p.settlement_status || '', csv: (p) => p.settlement_status || '' },
      { h: 'Issue', f: (p) => human(p.failure_reason || ''), s: (p) => p.failure_reason || '', csv: (p) => p.failure_reason || '' }, dateCol('Date', 'created_at')], pays.payments, null, 'No payments match.', { csv: 'payments', search: true, sortBy: 7, sortDir: -1 }));
};
FIN.refunds = async (el) => {
  const refunds = await api('GET', '/admin/finance/refunds'), approve = can('finance.refund.approve');
  el.append(note('Refunds need two people: one requests (from the booking), a different one approves here.'),
    table([{ h: 'Booking', k: 'booking_ref' }, moneyCol('Amount', 'amount'), moneyCol('Taken back from driver', 'driver_clawback'), { h: 'Reason', k: 'reason' }, { h: 'Status', f: (r) => pill(r.status), s: (r) => r.status, csv: (r) => r.status }, dateCol('Requested', 'created_at'),
      { h: '', f: (r) => r.status === 'REQUESTED' && approve ? h('span', { class: 'row' }, h('button', { class: 'b', onclick: async () => { const a = await ask('Approve refund of ' + money(r.amount) + '?', { confirmText: 'Approve refund', message: r.driver_clawback ? `${money(r.driver_clawback)} will be taken back from the driver.` : null }); if (a) act(() => api('POST', `/admin/finance/refunds/${r.id}/decision`, { approve: true }), () => go('finance')); } }, 'Approve'),
        h('button', { class: 'b sec', onclick: async () => { const a = await ask('Reject this refund request?', { confirmText: 'Reject', danger: true }); if (a) act(() => api('POST', `/admin/finance/refunds/${r.id}/decision`, { approve: false }), () => go('finance')); } }, 'Reject')) : '' }], refunds.refunds, null, 'No refund requests.', { csv: 'refunds', sortBy: 5, sortDir: -1 }));
};
FIN.payouts = async (el) => {
  const payouts = await api('GET', '/admin/finance/payouts');
  const rv = can('finance.payout.review'), ap = can('finance.payout.approve');
  el.append(note('Payouts go through review, approval and then a manual MoMo transfer. Mark a payout paid only after you sent the money and have the transaction id.'),
    table([{ h: 'Owner', k: 'owner' }, moneyCol('Amount', 'amount'), moneyCol('Fee', 'fee'), { h: 'MoMo number', k: 'msisdn' }, { h: 'Status', f: (p) => pill(p.status), s: (p) => p.status, csv: (p) => p.status }, dateCol('Requested', 'requested_at'),
      { h: '', f: (p) => h('span', { class: 'row' },
        p.status === 'REQUESTED' && rv && h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/finance/payouts/${p.id}/review`), () => go('finance')) }, 'Review'),
        ['REQUESTED', 'REVIEWED'].includes(p.status) && ap && h('button', { class: 'b', onclick: async () => { const a = await ask('Approve payout of ' + money(p.amount) + ' to ' + p.owner + '?', { confirmText: 'Approve payout' }); if (a) act(() => api('POST', `/admin/finance/payouts/${p.id}/approve`), () => go('finance')); } }, 'Approve'),
        p.status === 'APPROVED' && ap && h('button', { class: 'b', onclick: async () => { const a = await ask('Mark paid (after you sent the MoMo transfer)', { confirmText: 'Mark paid', fields: [{ name: 'provider_reference', label: 'MoMo transaction id', required: true, maxlength: 80, pattern: '^.{3,80}$', patternMsg: 'At least 3 characters' }] }); if (a) act(() => api('POST', `/admin/finance/payouts/${p.id}/paid`, { provider_reference: a.provider_reference }), () => go('finance')); } }, 'Mark paid'),
        ['REQUESTED', 'REVIEWED', 'APPROVED'].includes(p.status) && rv && h('button', { class: 'b red', onclick: async () => { const a = await ask('Reject payout', { reason: true, danger: true, confirmText: 'Reject payout' }); if (a) act(() => api('POST', `/admin/finance/payouts/${p.id}/reject`, { note: a.reason }), () => go('finance')); } }, 'Reject')) }], payouts.payouts, null, 'No payout requests.', { csv: 'payouts', sortBy: 5, sortDir: -1 }));
};
FIN.debts = async (el, state) => {
  const st = state.dstatus ?? 'open';
  const d = await api('GET', '/admin/finance/passenger-debts?limit=200' + (st ? '&status=' + st : ''));
  const sel = h('select', { 'aria-label': 'Status', onchange: () => go('finance', { sub: 'debts', dstatus: sel.value }) }, [['open', 'Open'], ['settled', 'Settled'], ['waived', 'Waived'], ['', 'All']].map(([v, l]) => h('option', { value: v, selected: v === st }, l)));
  el.append(note('Passengers who cancel late or do not show up owe a fee. It is added to their next trip automatically. Waive a fee only with a clear reason (for example, a driver problem).'),
    filterBar(h('label', {}, 'Show ', sel)),
    table([{ h: 'Passenger', f: (x) => x.display_name || x.phone, s: (x) => x.display_name || x.phone }, { h: 'Phone', k: 'phone', cls: 'nowrap' }, { h: 'Trip', k: 'booking_ref' }, { h: 'Reason', f: (x) => human(x.kind), s: (x) => x.kind }, moneyCol('Amount', 'amount'), { h: 'Status', f: (x) => pill(x.status), s: (x) => x.status, csv: (x) => x.status }, { h: 'Waiver reason', k: 'waive_reason' }, dateCol('Created', 'created_at'),
      { h: '', f: (x) => x.status === 'open' && can('finance.waive_fee') ? h('button', { class: 'b sec', onclick: async () => { const a = await ask(`Waive ${money(x.amount)} for ${x.display_name || x.phone}?`, { reason: true, confirmText: 'Waive fee' }); if (a) act(() => api('POST', `/admin/finance/passenger-debts/${x.id}/waive`, { reason: a.reason }), () => go('finance')); } }, 'Waive') : '' }], d.debts, null, 'No fee debts with this status.', { csv: 'passenger-debts', sortBy: 7, sortDir: -1 }));
};
FIN.recon = async (el) => {
  const rec = await api('GET', '/admin/finance/reconciliation'), reconcile = can('finance.reconcile');
  const file = h('textarea', { rows: 5, 'aria-label': 'Settlement rows', placeholder: '[{"reference":"RM-…","amount":1500,"status":"SUCCESS"}]', style: 'width:100%;font-family:ui-monospace,monospace' }), err = h('div', { class: 'ferr', role: 'alert' });
  const date = h('input', { id: 'recdate', type: 'date', 'aria-label': 'Settlement date', value: new Date(Date.now() + KIGALI_MS).toISOString().slice(0, 10) }), prov = h('select', { 'aria-label': 'Provider' }, h('option', { value: 'mtn_momo' }, 'MTN MoMo'), h('option', { value: 'airtel_money' }, 'Airtel Money'));
  const run = () => {
    err.textContent = ''; let rows;
    try { rows = JSON.parse(file.value || '[]'); } catch (e) { err.textContent = 'The rows are not valid JSON: ' + e.message; return; }
    if (!Array.isArray(rows) || !rows.length) { err.textContent = 'Paste a JSON list with at least one row.'; return; }
    const badRow = rows.findIndex((r) => !r || typeof r.reference !== 'string' || !Number.isInteger(r.amount) || !['SUCCESS', 'FAILED', 'PENDING'].includes(r.status));
    if (badRow >= 0) { err.textContent = `Row ${badRow + 1} is invalid. Each row needs a text "reference", a whole-number "amount" and a "status" of SUCCESS, FAILED or PENDING.`; return; }
    if (!date.value) { err.textContent = 'Choose the settlement date.'; return; }
    return act(async () => { const r = await api('POST', '/admin/finance/reconcile', { provider: prov.value, run_date: date.value, rows }); toast('Reconciliation done: ' + Object.entries(r.summary || {}).map(([k, v]) => `${human(k)} ${v}`).join(', ')); }, () => go('finance'));
  };
  el.append(h('h2', {}, 'Run reconciliation'), note('Paste the provider settlement report rows for one day. Differences are listed below for investigation. Never mark a payment paid from a screenshot.'),
    reconcile ? [file, h('div', { class: 'row' }, prov, date, h('button', { class: 'b', onclick: run }, 'Run reconciliation')), err] : h('div', { class: 'muted' }, 'Only finance officers can run a reconciliation.'),
    h('h2', {}, 'Payment exceptions'), table([{ h: 'Reference', k: 'reference' }, { h: 'Method', f: (p) => methodName(p.method) }, { h: 'Status', f: (p) => pill(p.status), s: (p) => p.status }, moneyCol('Amount', 'amount'), { h: 'Issue', f: (p) => human(p.failure_reason || ''), s: (p) => p.failure_reason || '' }, dateCol('Created', 'created_at')], rec.payment_exceptions, null, 'No payment exceptions.', { csv: 'payment-exceptions' }),
    h('h2', {}, 'Open reconciliation items'), table([{ h: 'Run date', f: (i) => dateOnly(i.run_date), s: (i) => Date.parse(i.run_date) }, { h: 'Provider', f: (i) => methodName(i.provider) }, { h: 'Kind', f: (i) => pill(i.kind, 'warn'), s: (i) => i.kind, csv: (i) => i.kind }, { h: 'Reference', k: 'provider_reference' }, moneyCol('Internal', 'internal_amount'), moneyCol('Provider', 'provider_amount'),
      { h: '', f: (i) => reconcile ? h('button', { class: 'b sec', onclick: async () => { const a = await ask('Resolve item', { reason: true, confirmText: 'Resolve', message: 'Say how the difference was explained or fixed.' }); if (a) act(() => api('POST', `/admin/finance/reconciliation/items/${i.id}/resolve`, { note: a.reason }), () => go('finance')); } }, 'Resolve') : '' }], rec.open_items, null, 'No open items.', { csv: 'reconciliation-items' }),
    h('h2', {}, 'Cash outstanding for more than 1 hour'), table([{ h: 'Booking', k: 'ref' }, moneyCol('Due', 'amount'), moneyCol('Collected', 'amount_collected'), dateCol('Since', 'created_at')], rec.cash_outstanding, null, 'No outstanding cash.', { csv: 'cash-outstanding' }));
};

// =============================================================== BUSINESS & FLEETS
V.business = async (el) => {
  const d = await api('GET', '/admin/businesses'), corp = can('corporate.manage'), fleet = can('fleet.manage');
  el.append(h('h1', {}, 'Business accounts and fleets'), h('h2', {}, 'Business accounts'),
    table([{ h: 'Company', k: 'legal_name' }, { h: 'TIN', k: 'tin' }, { h: 'Status', f: (b) => pill(b.status), s: (b) => b.status, csv: (b) => b.status }, { h: 'Billing', f: (b) => human(b.billing_mode), s: (b) => b.billing_mode }, moneyCol('Credit limit', 'credit_limit'),
      { h: '', f: (b) => corp ? h('span', { class: 'row' },
        b.status !== 'active' && h('button', { class: 'b', onclick: async () => {
          const a = await ask('Verify and activate ' + b.legal_name, { confirmText: 'Activate', message: 'Check the company registration and TIN first. Credit terms are a manual approval.', fields: [{ name: 'billing_mode', label: 'Billing mode', type: 'select', value: b.billing_mode || 'prepaid', options: [{ value: 'prepaid', label: 'Prepaid' }, { value: 'payg', label: 'Pay as you go' }, { value: 'credit', label: 'Credit (monthly invoice)' }] }, { name: 'credit_limit', label: 'Credit limit in RWF (only for credit)', type: 'number', integer: true, min: 0, help: 'Required when billing mode is credit.' }] });
          if (!a) return; if (a.billing_mode === 'credit' && !a.credit_limit) { toast('Credit terms need a credit limit.', true); return; }
          act(() => api('POST', `/admin/businesses/${b.id}/decision`, { status: 'active', billing_mode: a.billing_mode, ...(a.credit_limit ? { credit_limit: a.credit_limit } : {}) }), () => go('business')); } }, 'Verify and activate'),
        b.status === 'active' && h('button', { class: 'b sec', onclick: async () => { const a = await ask('Issue monthly invoice', { confirmText: 'Issue invoice', fields: [{ name: 'month', label: 'Month (YYYY-MM)', required: true, pattern: '^\\d{4}-(0[1-9]|1[0-2])$', patternMsg: 'Use the format 2026-09', value: new Date(Date.now() + KIGALI_MS - 15 * 864e5).toISOString().slice(0, 7) }] }); if (a) act(() => api('POST', `/admin/businesses/${b.id}/invoice`, { month: a.month })); } }, 'Invoice month'),
        b.status === 'active' && h('button', { class: 'b red', onclick: async () => { const a = await ask('Suspend ' + b.legal_name + '?', { danger: true, confirmText: 'Suspend', message: 'Employees can no longer book on the company account.' }); if (a) act(() => api('POST', `/admin/businesses/${b.id}/decision`, { status: 'suspended' }), () => go('business')); } }, 'Suspend')) : '' }], d.businesses, null, 'No business accounts yet.', { csv: 'business-accounts' }),
    h('h2', {}, 'Fleets'), table([{ h: 'Fleet', k: 'name' }, { h: 'Status', f: (b) => pill(b.status), s: (b) => b.status, csv: (b) => b.status }, { h: 'Fleet share of driver net', f: (b) => b.revenue_share_bps / 100 + '%', s: (b) => b.revenue_share_bps, cls: 'num' },
      { h: '', f: (f) => fleet ? h('button', { class: 'b' + (f.status === 'active' ? ' sec' : ''), onclick: async () => { const a = await ask(f.status === 'active' ? 'Change fleet share' : 'Activate fleet ' + f.name, { confirmText: 'Save', fields: [{ name: 'revenue_share_bps', label: 'Fleet share of driver net, in basis points (1000 = 10%)', type: 'number', integer: true, required: true, min: 0, max: 10000, value: f.revenue_share_bps }] }); if (a) act(() => api('POST', `/admin/fleets/${f.id}/decision`, { status: 'active', revenue_share_bps: a.revenue_share_bps }), () => go('business')); } }, f.status === 'active' ? 'Change share' : 'Activate and set share') : '' }], d.fleets, null, 'No fleets yet.', { csv: 'fleets' }));
};

// =============================================================== PRIVACY
V.privacy = async (el) => {
  const d = await api('GET', '/admin/privacy-requests');
  el.append(h('h1', {}, 'Privacy requests'), note('Access requests export the person\'s data as a file. Deletion erases personal data; financial records are kept in anonymised form as the law requires.'),
    table([{ h: 'Kind', f: (r) => human(r.kind), s: (r) => r.kind }, { h: 'User', k: 'display_name' }, { h: 'Status', f: (r) => pill(r.status), s: (r) => r.status, csv: (r) => r.status }, { h: 'Due', f: (r) => h('span', { class: new Date(r.due_at) < new Date() && ['open', 'in_progress'].includes(r.status) ? 'late' : '' }, when(r.due_at)), s: (r) => Date.parse(r.due_at), csv: (r) => r.due_at },
      { h: '', f: (r) => ['open', 'in_progress'].includes(r.status) ? h('button', { class: 'b' + (r.kind === 'deletion' ? ' red' : ''), onclick: async () => {
        const a = await ask(r.kind === 'deletion' ? 'Delete personal data of ' + r.display_name + '?' : 'Execute ' + r.kind + ' request', { danger: r.kind === 'deletion', confirmText: r.kind === 'deletion' ? 'Erase data' : 'Execute', message: r.kind === 'deletion' ? 'Personal data is erased and cannot be recovered. Financial records are kept in anonymised form.' : null });
        if (a) act(async () => { const o = await api('POST', `/admin/privacy-requests/${r.id}/execute`); if (r.kind === 'access') downloadBlob(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' }), 'user-data.json'); }, () => go('privacy')); } }, 'Execute') : '' }], d.requests, null, 'No privacy requests.', { csv: 'privacy-requests' }));
};

// =============================================================== AUDIT LOG
function summarize(o) {
  if (o == null || o === '') return '';
  if (typeof o !== 'object') return String(o);
  return Object.entries(o).slice(0, 4).map(([k, v]) => `${k}: ${v !== null && typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : v}`).join(' · ');
}
V.audit = async (el, state = {}) => {
  const a = state.action || '', et = state.entity || '', limit = Number(state.limit) || 200;
  const d = await api('GET', `/admin/audit?limit=${limit}` + (a ? '&action=' + encodeURIComponent(a) : '') + (et ? '&entity_type=' + encodeURIComponent(et) : ''));
  const inp = h('input', { type: 'search', placeholder: 'Action starts with, e.g. refund, pricing, driver', 'aria-label': 'Action prefix', value: a, style: 'min-width:min(100%,280px)' }), ent = h('input', { type: 'search', placeholder: 'Entity type, e.g. booking', 'aria-label': 'Entity type', value: et });
  const lim = h('select', { 'aria-label': 'Rows' }, [100, 200, 500].map((n) => h('option', { value: n, selected: n === limit }, n + ' rows')));
  const apply = () => go('audit', { action: inp.value.trim(), entity: ent.value.trim(), limit: lim.value });
  el.append(h('h1', {}, 'Audit log'), note('Append-only record of who did what. Click a row for the full before and after values.'), filterBar(inp, ent, lim, h('button', { type: 'submit', class: 'b', onclick: apply }, 'Filter'), (a || et) ? h('button', { type: 'button', class: 'b sec', onclick: () => go('audit', {}) }, 'Clear') : null), limitNote(d.logs.length, limit, 'entries'),
    table([dateCol('When', 'created_at'), { h: 'Actor', f: (l) => l.actor_name || (l.actor_id ? short(l.actor_id) : 'System'), s: (l) => l.actor_name || '' }, { h: 'Action', f: (l) => h('code', {}, l.action), s: (l) => l.action, csv: (l) => l.action },
      { h: 'Entity', f: (l) => [human(l.entity_type || ''), l.entity_id ? h('span', { class: 'muted mono' }, ' ' + short(l.entity_id)) : null], s: (l) => l.entity_type || '', csv: (l) => `${l.entity_type || ''} ${l.entity_id || ''}` },
      { h: 'Change', f: (l) => h('span', { class: 'trunc', title: JSON.stringify(l.after ?? '') }, summarize(l.after)), csv: (l) => JSON.stringify(l.after ?? '') }], d.logs, (l) => {
      const js = (v) => h('pre', {}, v == null ? '(none)' : JSON.stringify(v, null, 2));
      openDialog(l.action, h('div', {}, h('div', { class: 'kvgrid' }, h('div', { class: 'kv' }, h('span', { class: 'k' }, 'When'), h('span', {}, when(l.created_at))), h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Actor'), h('span', {}, `${l.actor_name || 'System'}${l.actor_role ? ' (' + human(l.actor_role) + ')' : ''}`)),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Entity'), h('span', { class: 'mono' }, `${l.entity_type || ''} ${l.entity_id || ''}`)), l.ip ? h('div', { class: 'kv' }, h('span', { class: 'k' }, 'IP address'), h('span', { class: 'mono' }, l.ip)) : null),
        h('h2', {}, 'Before'), js(l.before), h('h2', {}, 'After'), js(l.after)), { width: 720, key: 'audit' });
    }, 'No audit entries match.', { csv: 'audit-log', search: true }));
};

// =============================================================== STAFF (the Staff tab itself lives in views-staff.js)
function showInvite(r, email, after) {
  showLink(r.invite_url, r.expires_at, email, 'Invitation created', after);
}
// ---- the person's side: activate an account, or complete a password / two-factor / full reset (public page opened from a one-time link) ----
async function activationView(root, token) {
  const pub = async (m, p, body) => { let r; try { r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'POST' ? JSON.stringify(body || {}) : undefined }); } catch { throw new Error('Cannot reach the server. Check your connection.'); } const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error?.message || 'Request failed'); return j; };
  const card = h('div', { class: 'card login' }); root.append(h('main', { class: 'loginpage' }, card));
  let info; try { info = await pub('GET', '/staff-invite/' + token); } catch (e) { card.append(h('h1', {}, 'Link not valid'), h('div', { class: 'alert bad' }, e.message + '. Ask your administrator for a new link.')); return; }
  const kind = info.purpose || 'invite';
  const err = h('div', { class: 'err', role: 'alert' });
  const pwFields = () => [h('input', { type: 'password', placeholder: (kind === 'password_reset' ? 'Choose a NEW password' : 'Choose a password') + ' (12+ characters)', 'aria-label': 'Password', autocomplete: 'new-password' }), h('input', { type: 'password', placeholder: 'Repeat the password', 'aria-label': 'Repeat password', autocomplete: 'new-password' })];
  const codeField = (ph = '6-digit code from the app') => h('input', { placeholder: ph, 'aria-label': 'Authenticator code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' });
  const finish = (title, text) => { history.replaceState(null, '', location.pathname); card.replaceChildren(h('h1', {}, title), h('p', {}, text), h('button', { class: 'b wide', onclick: () => render() }, 'Go to sign in')); };
  const checkPw = (pw, pw2) => { if (pw.value.length < 12) return 'The password needs at least 12 characters.'; if (pw.value !== pw2.value) return 'The passwords do not match.'; return ''; };
  const checkCode = (code) => (/^\d{6}$/.test(code.value.trim()) ? '' : 'Enter the 6-digit code from your authenticator app.');
  const run = async (body, title, text) => { try { await pub('POST', '/staff-invite/' + token + '/activate', body); finish(title, text); } catch (e) { err.textContent = e.message; } };

  if (kind === 'password_reset') {   // new password, confirmed with the CURRENT authenticator code; no new authenticator
    const [pw, pw2] = pwFields(), code = codeField('Current 6-digit code from your authenticator app');
    card.replaceChildren(h('h1', {}, 'Reset your password'), h('p', {}, 'Hello ' + info.name + '. Choose a new password for ' + info.email + '. Confirm it with the code your authenticator app shows right now.'), pw, pw2, code, err,
      h('button', { class: 'b wide', onclick: () => { err.textContent = checkPw(pw, pw2) || checkCode(code); if (!err.textContent) run({ password: pw.value, code: code.value.trim() }, 'Password changed', 'Sign in with your email, your new password and the code from your authenticator app. You were signed out everywhere.'); } }, 'Change my password'));
    return;
  }
  const begin = async () => { err.textContent = ''; try { step2(await pub('POST', '/staff-invite/' + token + '/begin')); } catch (e) { err.textContent = e.message; } };
  const intro = {
    invite: ['Welcome, ' + info.name, 'You were invited as ' + info.role.replace(/_/g, ' ') + ' (' + info.email + '). Next you will set up two-factor authentication on your own phone.'],
    mfa_reset: ['Replace your authenticator', 'Hello ' + info.name + '. You will scan a NEW QR code on your own phone and confirm with your current password. Your old authenticator stops working when you finish.'],
    full_reset: ['Reset your sign-in', 'Hello ' + info.name + '. You will choose a new password and scan a NEW QR code on your own phone. Your old password and authenticator stop working when you finish.'],
  }[kind];
  card.replaceChildren(h('h1', {}, intro[0]), h('p', {}, intro[1]), err, h('button', { class: 'b wide', onclick: begin }, 'Start setup'));
  function step2(b) {
    const qr = h('img', { alt: 'Authenticator QR code', src: 'data:image/svg+xml;utf8,' + encodeURIComponent(b.qr_svg), style: 'width:220px;height:220px;display:block;margin:8px auto;background:#fff' });
    const [pw, pw2] = kind === 'mfa_reset' ? [h('input', { type: 'password', placeholder: 'Your current password', 'aria-label': 'Current password', autocomplete: 'current-password' }), null] : pwFields();
    const code = codeField();
    card.replaceChildren(h('h1', {}, 'Set up your authenticator'), h('p', {}, '1. Open Google Authenticator or Microsoft Authenticator on your phone and scan this QR code.'), qr,
      h('details', {}, h('summary', {}, 'Cannot scan? Enter the key by hand'), h('code', { style: 'word-break:break-all;display:block;margin:6px 0' }, b.secret)),
      h('p', {}, kind === 'mfa_reset' ? '2. Type your current password and the 6-digit code shown in the app.' : '2. Choose your password and type the 6-digit code shown in the app.'), pw, pw2, code, err,
      h('button', { class: 'b wide', onclick: () => {
        err.textContent = kind === 'mfa_reset' ? (pw.value ? '' : 'Enter your current password.') : checkPw(pw, pw2); if (!err.textContent) err.textContent = checkCode(code); if (err.textContent) return;
        const body = kind === 'mfa_reset' ? { current_password: pw.value, code: code.value.trim() } : { password: pw.value, code: code.value.trim() };
        run(body, kind === 'invite' ? 'All set' : 'All set', kind === 'invite' ? 'Your account is active. Sign in with your email, your password and the code from your authenticator app.' : 'Your sign-in is updated and you were signed out everywhere. Sign in with your email, your password and the code from your NEW authenticator.');
      } }, kind === 'invite' ? 'Activate my account' : 'Finish'));
  }
}

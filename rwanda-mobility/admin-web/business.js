'use strict';
// Business-settings screens: pricing editor, settings, promotions, services. Loaded after core.js and views-*.js and shares their helpers (h, api, ask, table, act, toast, V, S, go, can).
// Everything here is a front-end over audited server endpoints; the server re-validates every value.

const fmt = (n) => (n == null || Number.isNaN(n) ? '' : Number(n).toLocaleString(NUM()));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const kigaliNow = () => { const d = new Date(Date.now() + 2 * 3600e3); return { hour: d.getUTCHours(), dow: d.getUTCDay() }; };
const hourLabel = (n) => String(n).padStart(2, '0') + ':00';

/** Number input with thousands separators, unit suffix, range validation. get() -> number | null (blank, if nullable) | NaN (invalid). */
function numField({ value, unit, min = 0, max, nullable = false, decimal = false, label, onInput, width }) {
  const input = h('input', { type: 'text', inputmode: decimal ? 'decimal' : 'numeric', autocomplete: 'off', class: 'num', 'aria-label': label || null, style: width ? 'width:' + width : null });
  input.value = value == null ? '' : fmt(value);
  const get = () => {
    const t = input.value.replace(/[,\s]/g, '');
    if (t === '') return nullable ? null : NaN;
    return (decimal ? /^\d+(\.\d{1,2})?$/ : /^-?\d+$/).test(t) ? Number(t) : NaN;
  };
  const error = () => {
    const v = get(); if (v === null) return null;
    if (Number.isNaN(v)) return input.value.trim() === '' ? 'Required' : decimal ? 'Enter a number, up to 2 decimals' : 'Enter a whole number';
    if (v < min) return 'At least ' + fmt(min) + (unit ? ' ' + unit : '');
    if (max != null && v > max) return 'At most ' + fmt(max) + (unit ? ' ' + unit : '');
    return null;
  };
  input.addEventListener('input', () => { input.classList.toggle('bad', !!error()); onInput && onInput(); });
  input.addEventListener('blur', () => { const v = get(); if (typeof v === 'number' && !Number.isNaN(v) && !decimal) input.value = fmt(v); });
  input.addEventListener('focus', () => input.select());
  const el = h('span', { class: 'numwrap' }, input, unit && h('span', { class: 'unit' }, unit));
  return { el, input, get, error, set: (v) => { input.value = v == null ? '' : fmt(v); input.classList.remove('bad'); } };
}

/** replaceChildren that drops null/false instead of printing them. */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((c) => c != null && c !== false));

/** Sticky bar that appears at the bottom of the screen while a form is being edited. */
function saveBar({ status, actions }) { return h('div', { class: 'savebar' }, h('div', { class: 'status' }, status), h('div', { class: 'row', style: 'margin:0' }, actions)); }

// =============================================================== PRICING

const PRICE_FIELDS = [
  // section, key, label, unit, help, min, max, extra
  ['Standard fare', 'base_fare', 'Base fare', 'RWF', 'Charged on every trip before distance and time.', 0, 1e6, { when: 'distance' }],
  ['Standard fare', 'per_km', 'Price per kilometre', 'RWF / km', 'Multiplied by the trip distance.', 0, 1e5, { when: 'distance' }],
  ['Standard fare', 'per_min', 'Price per minute', 'RWF / min', 'Multiplied by the estimated trip time. 0 = distance only.', 0, 1e4, { when: 'distance' }],
  ['Standard fare', 'minimum_fare', 'Minimum fare', 'RWF', 'A trip never costs less than this (before fees).', 0, 1e6, { when: 'distance' }],
  ['Standard fare', 'rounding', 'Round the total to the nearest', 'RWF', 'For example 50 rounds 1,678 to 1,700. Use 1 for no rounding.', 1, 1000],
  ['Fees and tax', 'booking_fee', 'Booking fee', 'RWF', 'Flat fee added to every booking. 0 = none.', 0, 1e5],
  ['Fees and tax', 'airport_fee', 'Airport fee', 'RWF', 'Added to airport trips only.', 0, 1e5, { when: 'distance' }],
  ['Fees and tax', 'scheduled_fee', 'Scheduled booking fee', 'RWF', 'Added when the trip is booked in advance.', 0, 1e5],
  ['Fees and tax', 'tax_pct', 'Tax', '%', 'Added on top of the fare. 0 = no tax.', 0, 50, { decimal: true }],
  ['Waiting time', 'free_wait_min', 'Free waiting time', 'minutes', 'The driver waits this long at pickup at no charge.', 0, 60],
  ['Waiting time', 'wait_per_min', 'Waiting charge after that', 'RWF / min', 'Billed at the end of the trip, so it is not in the preview.', 0, 1e4],
  ['Night service', 'night_start_hour', 'Night starts at', 'hour 0-23', 'Leave both hours empty for no night fee. Trips that start inside this window pay the night fee.', 0, 23, { nullable: true }],
  ['Night service', 'night_end_hour', 'Night ends at', 'hour 0-24', 'For example start 22 and end 5 covers 22:00 to 05:00.', 0, 24, { nullable: true }],
  ['Night service', 'night_fee', 'Night fee', 'RWF', 'Flat fee added inside the night window.', 0, 1e5],
  ['Abasare: driver for the customer\'s car', 'return_per_km', 'Driver return allowance', 'RWF / km', 'Covers the driver\'s way back after a drive-me-home trip.', 0, 1e5, { when: 'abasare-distance' }],
  ['Abasare: driver for the customer\'s car', 'hourly_rate', 'Hourly rate', 'RWF / hour', 'Price per booked hour.', 0, 1e6, { when: 'hourly' }],
  ['Abasare: driver for the customer\'s car', 'min_hours', 'Minimum hours', 'hours', 'Shortest booking allowed.', 1, 24, { when: 'hourly' }],
  ['Abasare: driver for the customer\'s car', 'max_hours', 'Maximum hours', 'hours', 'Longest booking allowed.', 1, 24, { when: 'hourly' }],
  ['Abasare: driver for the customer\'s car', 'long_hire_hours', 'Long-hire from', 'hours', 'Bookings this long or longer get the long-hire rate. Leave empty for none.', 1, 24, { when: 'hourly', nullable: true }],
  ['Abasare: driver for the customer\'s car', 'long_hire_rate', 'Long-hire hourly rate', 'RWF / hour', 'Cheaper hourly rate for long bookings. Set together with the hours above.', 0, 1e6, { when: 'hourly', nullable: true }],
  ['Abasare: driver for the customer\'s car', 'overtime_per_30min', 'Overtime per 30 minutes', 'RWF', 'Charged for each started half hour beyond the booked time.', 0, 1e5, { when: 'hourly' }],
  ['Abasare: driver for the customer\'s car', 'overtime_grace_min', 'Overtime grace period', 'minutes', 'No overtime is charged within this many minutes of the booked end.', 0, 120, { when: 'hourly' }],
].map(([section, key, label, unit, help, min, max, extra]) => ({ section, key, label, unit, help, min, max, ...(extra || {}) }));
const PRICE_DEFAULTS = { model: 'platform', billing: 'distance', base_fare: 0, per_km: 0, per_min: 0, minimum_fare: 0, rounding: 50, booking_fee: 0, airport_fee: 0, scheduled_fee: 0, tax_pct: 0, free_wait_min: 3, wait_per_min: 0,
  night_start_hour: null, night_end_hour: null, night_fee: 0, return_per_km: 0, hourly_rate: 0, min_hours: 2, max_hours: 12, long_hire_hours: null, long_hire_rate: null, overtime_per_30min: 0, overtime_grace_min: 10, time_multipliers: [] };

const ruleToState = (r) => {
  const st = { ...PRICE_DEFAULTS };
  if (r) { for (const k of Object.keys(PRICE_DEFAULTS)) if (r[k] !== undefined && r[k] !== null) st[k] = r[k]; for (const k of ['night_start_hour', 'night_end_hour', 'long_hire_hours', 'long_hire_rate']) st[k] = r[k] ?? null; st.tax_pct = (r.tax_bps || 0) / 100; }
  st.time_multipliers = JSON.parse(JSON.stringify(r?.time_multipliers || []));
  return st;
};
const stateToBody = (st, service_id, zone_id, effective) => {
  const b = { service_id, zone_id, model: st.model, billing: st.billing, tax_bps: Math.round(st.tax_pct * 100), time_multipliers: st.time_multipliers.map((w) => ({ label: w.label, days: [...w.days].sort(), start_hour: w.start_hour, end_hour: w.end_hour, percent: w.percent })) };
  for (const f of PRICE_FIELDS) if (f.key !== 'tax_pct') b[f.key] = st[f.key];
  if (effective) b.effective_from = effective;
  return b;
};
const svcName = (d, id) => d.services.find((s) => s.id === id)?.name_en || id;
const zoneName = (d, id) => (id ? d.zones.find((z) => z.id === id)?.name || id : 'All zones');
const unitFmt = (f, v) => (v == null ? 'not set' : f.unit === '%' ? v + ' %' : f.unit.startsWith('hour') && f.key.includes('night') ? hourLabel(v) : fmt(v) + ' ' + f.unit.replace(' / ', ' per '));
const winText = (w) => `${w.label}: ${w.days.length ? w.days.map((d) => DAYS[d]).join(' ') : 'every day'} ${hourLabel(w.start_hour)}-${hourLabel(w.end_hour)} ${w.percent > 0 ? '+' : ''}${w.percent}%`;

/** Human list of what differs between two form states. */
function diffStates(a, b) {
  const out = [];
  if (a.billing !== b.billing) out.push({ label: 'Billing', from: a.billing, to: b.billing });
  if (a.model !== b.model) out.push({ label: 'Pricing model', from: a.model, to: b.model });
  for (const f of PRICE_FIELDS) if ((a[f.key] ?? null) !== (b[f.key] ?? null)) out.push({ label: f.label, from: unitFmt(f, a[f.key]), to: unitFmt(f, b[f.key]), delta: typeof a[f.key] === 'number' && typeof b[f.key] === 'number' && f.unit.startsWith('RWF') ? b[f.key] - a[f.key] : null });
  const wa = a.time_multipliers.map(winText), wb = b.time_multipliers.map(winText);
  if (JSON.stringify(wa) !== JSON.stringify(wb)) out.push({ label: 'Peak / off-peak windows', from: wa.length ? wa.join('; ') : 'none', to: wb.length ? wb.join('; ') : 'none' });
  return out;
}
const diffSentence = (diff) => diff.map((x) => `${x.label} ${x.from} → ${x.to}`).join('; ');

V.pricing = async (el) => {
  const d = await api('GET', '/admin/pricing');
  const manage = can('pricing.manage'), approve = can('pricing.approve'), me = myId();
  const active = d.rules.filter((r) => r.status === 'active'), pending = d.rules.filter((r) => r.status === 'pending_approval');
  const baseFor = (service, zone) => active.find((r) => r.service_id === service && r.zone_id === zone) || active.find((r) => r.service_id === service && r.zone_id == null) || null;
  const canApproveRow = (x) => approve && (x.created_by !== me || d.self_approval);

  el.append(h('h1', {}, 'Pricing & commission'),
    d.self_approval
      ? h('div', { class: 'banner danger' }, h('b', {}, 'Self-approval is ON. '), 'The person who proposes a price or commission change can also approve it, so no second person checks it. Every self-approved change is flagged "self approved" in the audit log. A super admin can turn this off under Settings > Pricing & approvals.')
      : h('div', { class: 'banner' }, 'Changes are proposed, then approved by a different person. An accepted fare quote is never altered, and a new price only applies to new bookings.'));

  // ---- awaiting approval
  el.append(h('h2', {}, 'Waiting for approval'));
  if (!pending.length) el.append(h('div', { class: 'empty card' }, 'No price changes are waiting for approval.'));
  for (const r of pending) {
    const base = baseFor(r.service_id, r.zone_id), diff = diffStates(ruleToState(base), ruleToState(r)), own = r.created_by === me;
    const effect = `Approving makes this the live ${svcName(d, r.service_id)} price in ${zoneName(d, r.zone_id)} ${new Date(r.effective_from) > new Date() ? 'from ' + when(r.effective_from) : 'immediately'}. Accepted quotes are unaffected.`;
    el.append(h('div', { class: 'card pending' },
      h('div', { class: 'row' }, h('b', {}, `${svcName(d, r.service_id)} · ${zoneName(d, r.zone_id)} · v${r.version}`), pill('pending approval', 'warn'), h('span', { class: 'muted' }, `proposed by ${own ? 'you' : r.created_by_name || 'staff'} on ${when(r.created_at)}`)),
      diff.length ? h('ul', { class: 'difflist' }, diff.map((x) => h('li', {}, h('b', {}, x.label + ': '), x.from, ' → ', h('b', {}, x.to), x.delta ? h('span', { class: x.delta > 0 ? 'up' : 'down' }, ` (${x.delta > 0 ? '+' : ''}${fmt(x.delta)})`) : null))) : h('div', { class: 'muted' }, base ? 'No differences from the current price.' : 'New price, nothing to compare with.'),
      approve && h('div', { class: 'row' },
        h('button', { class: 'b', disabled: !canApproveRow(r), title: canApproveRow(r) ? null : 'A different person must approve your proposal', onclick: async () => {
          const a = await ask(own ? 'Approve your own price change?' : 'Approve this price change?', { confirmText: own ? 'Approve my own change' : 'Approve', danger: own, message: (own ? 'Self-approval is enabled, so no second person will check this. It will be flagged in the audit log. ' : '') + `${diffSentence(diff) || 'Same values as today.'}. ${effect}` });
          if (a) act(() => api('POST', `/admin/pricing/${r.id}/approve`), () => go('pricing'));
        } }, own ? 'Approve own proposal' : 'Approve'),
        h('button', { class: 'b sec', onclick: async () => { const a = await ask('Reject this proposal?', { confirmText: 'Reject', danger: true, message: 'The proposal is discarded. Current prices stay as they are.' }); if (a) act(() => api('POST', `/admin/pricing/${r.id}/reject`), () => go('pricing')); } }, 'Reject'),
        own && !d.self_approval && h('span', { class: 'muted' }, 'You proposed this, so another approver must decide.'))));
  }

  // ---- current prices
  el.append(h('h2', {}, 'Current prices'),
    manage && h('div', { class: 'row' }, h('button', { class: 'b', onclick: () => { $('#view').replaceChildren(); priceEditor($('#view'), d, null); } }, 'Add or change a price')),
    table([{ h: 'Service', f: (r) => svcName(d, r.service_id) }, { h: 'Zone', f: (r) => zoneName(d, r.zone_id) }, { h: 'Version', f: (r) => 'v' + r.version },
      { h: 'Headline', f: (r) => r.billing === 'hourly' ? `${fmt(r.hourly_rate)} RWF per hour (${r.min_hours}-${r.max_hours} h)` : `${fmt(r.base_fare)} + ${fmt(r.per_km)}/km + ${fmt(r.per_min)}/min, min ${fmt(r.minimum_fare)}` },
      { h: 'Extras', f: (r) => [r.booking_fee ? `booking ${fmt(r.booking_fee)}` : '', r.night_fee ? `night +${fmt(r.night_fee)} (${r.night_start_hour}-${r.night_end_hour}h)` : '', r.tax_bps ? `tax ${r.tax_bps / 100}%` : '', r.time_multipliers?.length ? `${r.time_multipliers.length} peak/off-peak window(s)` : ''].filter(Boolean).join(' · ') || '-' },
      { h: 'Live since', f: (r) => when(r.effective_from) },
      { h: '', f: (r) => manage ? h('button', { class: 'b sec', onclick: () => { $('#view').replaceChildren(); priceEditor($('#view'), d, r); } }, 'Edit') : '' }],
    active, null, 'No active prices yet. Use "Add or change a price" to create the first one.'),
    h('details', { class: 'card' }, h('summary', {}, `Full history (${d.rules.length} versions)`),
      table([{ h: 'Service', f: (r) => svcName(d, r.service_id) }, { h: 'Zone', f: (r) => zoneName(d, r.zone_id) }, { h: 'v', k: 'version' }, { h: 'Status', f: (r) => pill(r.status, statusCls(r.status)) }, { h: 'Base', f: (r) => fmt(r.base_fare) }, { h: 'Per km', f: (r) => fmt(r.per_km) }, { h: 'Per min', f: (r) => fmt(r.per_min) }, { h: 'Minimum', f: (r) => fmt(r.minimum_fare) }, { h: 'Proposed by', f: (r) => r.created_by_name || '-' }, { h: 'Effective', f: (r) => when(r.effective_from) }], d.rules)));

  // ---- commission
  el.append(h('h2', {}, 'Commission rules'),
    table([{ h: 'Applies to', f: (c) => c.driver_id ? 'one driver (' + c.driver_id.slice(0, 6) + ')' : c.fleet_id ? 'one fleet' : c.service_id ? svcName(d, c.service_id) : 'Everything (platform default)' }, { h: 'Rate', f: (c) => c.kind === 'percent' ? c.percent_bps / 100 + '% of the fare' : money(c.fixed_amount) + ' per trip' }, { h: 'Exempt until', f: (c) => c.exempt_until ? when(c.exempt_until) : '-' }, { h: 'Status', f: (c) => pill(c.status, statusCls(c.status)) }, { h: 'Proposed by', f: (c) => c.created_by_name || '-' }, { h: 'Note', k: 'note' },
      { h: '', f: (c) => c.status === 'pending_approval' && approve ? h('button', { class: 'b', disabled: !canApproveRow(c), title: canApproveRow(c) ? null : 'A different person must approve your proposal', onclick: async () => {
        const own = c.created_by === me; const a = await ask('Approve commission change?', { confirmText: 'Approve', danger: own, message: `${own ? 'Self-approval is enabled: this will be flagged in the audit log. ' : ''}New rate ${c.kind === 'percent' ? c.percent_bps / 100 + '%' : money(c.fixed_amount)} applies to trips completed after approval; earlier trips keep their commission.` });
        if (a) act(() => api('POST', `/admin/commissions/${c.id}/approve`), () => go('pricing')); } }, 'Approve') : '' }], d.commissions, null, 'No commission rules yet.'),
    manage && h('button', { class: 'b sec', onclick: async () => {
      const a = await ask('Propose a commission rule', { confirmText: 'Propose', message: 'Choose who it applies to and the rate. It takes effect only after approval.', fields: [
        { name: 'service', label: 'Applies to', type: 'select', options: ['all services', ...d.services.map((s) => s.id)] }, { name: 'kind', label: 'Kind', type: 'select', options: ['percent', 'fixed'] },
        { name: 'rate', label: 'Percent (e.g. 15) or fixed RWF per trip', type: 'number' }, { name: 'note', label: 'Note (why)' }] });
      if (!a) return;
      const body = { service_id: a.service === 'all services' ? null : a.service, kind: a.kind, note: a.note || undefined };
      if (a.kind === 'percent') body.percent_bps = Math.round(a.rate * 100); else body.fixed_amount = Math.round(a.rate);
      act(() => api('POST', '/admin/commissions', body), () => go('pricing'));
    } }, 'Propose commission rule'));
};

function priceEditor(el, d, startRule) {
  const manage = can('pricing.manage');
  const editable = d.services;           // ride + abasare
  const t = { service: startRule?.service_id || editable[0]?.id, zone: startRule ? startRule.zone_id : d.zones[0]?.id ?? null };
  const active = d.rules.filter((r) => r.status === 'active');
  const baseFor = (service, zone) => active.find((r) => r.service_id === service && r.zone_id === zone) || active.find((r) => r.service_id === service && r.zone_id == null) || null;
  let base = baseFor(t.service, t.zone), baseState = ruleToState(base), st = ruleToState(startRule || base);
  const ctl = {};               // field controls by key
  let windowsEl, previewTimer = null, previewSeq = 0, effectiveEl;

  const svcSel = h('select', { 'aria-label': 'Service' }, editable.map((s) => h('option', { value: s.id, selected: s.id === t.service }, s.name_en + (s.enabled ? '' : ' (disabled)'))));
  const zoneSel = h('select', { 'aria-label': 'Zone' }, [h('option', { value: '', selected: t.zone === null }, 'All zones (fallback)'), ...d.zones.map((z) => h('option', { value: z.id, selected: z.id === t.zone }, z.name))]);
  const fromSel = h('select', { 'aria-label': 'Start from' }, [h('option', { value: '' }, 'Current price of the target'), ...active.map((r) => h('option', { value: r.id }, `Copy values from ${svcName(d, r.service_id)} · ${zoneName(d, r.zone_id)}`))]);
  const isAbasare = () => d.services.find((s) => s.id === svcSel.value)?.kind === 'abasare';
  const targetText = () => `${svcName(d, svcSel.value)} fare in ${zoneName(d, zoneSel.value || null)}`;

  const billingSel = h('select', { 'aria-label': 'Billing' }, h('option', { value: 'distance' }, 'By distance and time'), h('option', { value: 'hourly' }, 'By the hour'));
  const modelSel = h('select', { 'aria-label': 'Pricing model' }, h('option', { value: 'platform' }, 'Platform fare (calculated)'), h('option', { value: 'fixed' }, 'Fixed fare'));
  effectiveEl = h('input', { type: 'datetime-local', 'aria-label': 'Effective from' });

  // ---- field rendering
  const fieldRows = {};
  const buildField = (f) => {
    const nf = numField({ value: st[f.key], unit: f.unit, min: f.min, max: f.max, nullable: f.nullable, decimal: f.decimal, label: f.label, onInput: changed });
    ctl[f.key] = nf;
    const errEl = h('div', { class: 'ferr' });
    const row = h('label', { class: 'field' }, h('span', { class: 'flabel' }, f.label), nf.el, h('span', { class: 'hint' }, f.help), errEl);
    row._err = errEl; fieldRows[f.key] = row; return row;
  };
  const sections = [...new Set(PRICE_FIELDS.map((f) => f.section))];
  const sectionEls = {};
  const body = h('div', { class: 'formcol' });
  for (const sec of sections) {
    const box = h('div', { class: 'card fsec' }, h('h2', {}, sec), h('div', { class: 'fgrid' }, PRICE_FIELDS.filter((f) => f.section === sec).map(buildField)));
    sectionEls[sec] = box; body.append(box);
  }
  // Abasare billing choice sits inside its section
  const abSec = sectionEls['Abasare: driver for the customer\'s car'];
  abSec.insertBefore(h('div', { class: 'fgrid' }, h('label', { class: 'field' }, h('span', { class: 'flabel' }, 'Billing method'), billingSel, h('span', { class: 'hint' }, 'Drive-me-home trips are billed by distance; hourly hire by the booked hours.'))), abSec.children[1]);
  // peak / off-peak windows
  windowsEl = h('div', {});
  const winBox = h('div', { class: 'card fsec' }, h('h2', {}, 'Peak and off-peak windows'),
    h('p', { class: 'hint' }, 'Raise or lower the fare for part of the day or week, for example +20% on weekday mornings or -10% on Sundays. Each window shows as its own line on the receipt. Windows that overlap add up, and the total can never go above the rule\'s maximum surge (+50% unless changed) or below -50%. Leave empty for no change.'),
    windowsEl, h('button', { class: 'b sec', onclick: () => { if (st.time_multipliers.length >= 6) { toast('At most 6 windows', true); return; } st.time_multipliers.push({ label: 'Peak', days: [1, 2, 3, 4, 5], start_hour: 7, end_hour: 9, percent: 10 }); renderWindows(); changed(); } }, 'Add a window'));
  body.append(winBox);
  const optsBox = h('div', { class: 'card fsec' }, h('h2', {}, 'Pricing model and start date'),
    h('div', { class: 'fgrid' }, h('label', { class: 'field' }, h('span', { class: 'flabel' }, 'Model'), modelSel, h('span', { class: 'hint' }, 'Fixed fares are shown to the customer as a fixed price.')),
      h('label', { class: 'field' }, h('span', { class: 'flabel' }, 'Start date (optional)'), effectiveEl, h('span', { class: 'hint' }, 'Leave empty to apply as soon as it is approved. A later date schedules the change; the current price stays live until then (your browser\'s time zone).'))));
  body.append(optsBox);

  const winErrs = [];
  function renderWindows() {
    windowsEl.replaceChildren(); winErrs.length = 0;
    if (!st.time_multipliers.length) windowsEl.append(h('div', { class: 'empty' }, 'No windows: the fare is the same at every hour.'));
    st.time_multipliers.forEach((w, i) => {
      const label = h('input', { value: w.label, maxlength: 40, 'aria-label': 'Window name', class: 'wname' }); label.addEventListener('input', () => { w.label = label.value; changed(); });
      const days = h('span', { class: 'days' }, DAYS.map((nm, di) => { const cb = h('input', { type: 'checkbox', checked: w.days.includes(di), 'aria-label': nm }); cb.addEventListener('change', () => { w.days = cb.checked ? [...w.days, di] : w.days.filter((x) => x !== di); changed(); }); return h('label', { class: 'chk' }, cb, nm); }));
      const s = numField({ value: w.start_hour, min: 0, max: 23, unit: 'h', label: 'From hour', width: '70px', onInput: () => { w.start_hour = s.get(); changed(); } });
      const e = numField({ value: w.end_hour, min: 1, max: 24, unit: 'h', label: 'To hour', width: '70px', onInput: () => { w.end_hour = e.get(); changed(); } });
      const p = numField({ value: w.percent, min: -50, max: 100, unit: '%', label: 'Adjustment percent', width: '70px', onInput: () => { w.percent = p.get(); changed(); } });
      winErrs.push(() => s.error() || e.error() || p.error() || (!w.label.trim() ? 'Give the window a name' : null) || (s.get() === e.get() ? 'Start and end hour must differ' : null));
      windowsEl.append(h('div', { class: 'winrow' }, label, days, h('span', {}, 'from ', s.el, ' to ', e.el), h('span', {}, 'adjust ', p.el), h('button', { class: 'b sec', 'aria-label': 'Remove window', onclick: () => { st.time_multipliers.splice(i, 1); renderWindows(); changed(); } }, 'Remove')));
    });
  }

  // ---- state sync
  const readState = () => {
    const cur = { model: modelSel.value, billing: billingSel.value, time_multipliers: st.time_multipliers };
    for (const f of PRICE_FIELDS) cur[f.key] = ctl[f.key].get();
    return cur;
  };
  const applyVisibility = () => {
    const hourly = billingSel.value === 'hourly', ab = isAbasare();
    for (const f of PRICE_FIELDS) {
      const show = !f.when || (f.when === 'distance' && !hourly) || (f.when === 'abasare-distance' && ab && !hourly) || (f.when === 'hourly' && ab && hourly);
      fieldRows[f.key].style.display = show ? '' : 'none';
    }
    abSec.style.display = ab ? '' : 'none';
  };
  const errorsNow = () => {
    const errs = {}; const cur = readState();
    const hourly = cur.billing === 'hourly';
    for (const f of PRICE_FIELDS) { if (fieldRows[f.key].style.display === 'none') continue; const e = ctl[f.key].error(); if (e) errs[f.key] = e; }
    if (!errs.night_end_hour && (cur.night_start_hour == null) !== (cur.night_end_hour == null)) errs.night_end_hour = 'Set both the start and end hour, or leave both empty';
    if (hourly && isAbasare()) {
      if (cur.min_hours > cur.max_hours) errs.min_hours = 'Cannot be more than the maximum hours';
      if (!errs.long_hire_rate && (cur.long_hire_hours == null) !== (cur.long_hire_rate == null)) errs.long_hire_rate = 'Set both the long-hire hours and rate, or leave both empty';
    }
    winErrs.forEach((fn, i) => { const e = fn(); if (e) errs['window' + i] = `Window ${i + 1}: ${e}`; });
    return errs;
  };
  const diffEl = h('div', {}), previewEl = h('div', {});
  let bar;
  const statusEl = h('span', {});
  const proposeBtn = h('button', { class: 'b', onclick: () => propose() }, 'Review and propose');
  const discardBtn = h('button', { class: 'b sec', onclick: () => { loadTarget(true); } }, 'Discard edits');

  function changed() {
    applyVisibility();
    const errs = errorsNow();
    for (const f of PRICE_FIELDS) fieldRows[f.key]._err.textContent = errs[f.key] || '';
    const cur = readState(); const bad = Object.keys(errs).length > 0;
    const diff = bad ? [] : diffStates(baseState, { ...cur, tax_pct: cur.tax_pct });
    const dirty = !bad ? diff.length > 0 : true;
    setDirty('price', dirty);
    fill(diffEl, h('h2', {}, 'Current vs proposed'),
      bad ? h('div', { class: 'err' }, 'Fix these first: ', Object.values(errs).join(' · ')) :
      !diff.length ? h('div', { class: 'empty' }, base ? 'No changes yet. Edit a value on the left.' : 'Nothing entered yet.') :
      h('table', { class: 'difftbl' }, h('thead', {}, h('tr', {}, ['Setting', 'Current', 'Proposed', ''].map((x) => h('th', {}, x)))), h('tbody', {}, diff.map((x) => h('tr', {}, h('td', {}, x.label), h('td', {}, x.from), h('td', {}, h('b', {}, x.to)), h('td', { class: x.delta > 0 ? 'up' : 'down' }, x.delta ? (x.delta > 0 ? '+' : '') + fmt(x.delta) : ''))))));
    statusEl.textContent = bad ? `${Object.keys(errs).length} problem(s) to fix` : diff.length ? `${diff.length} unsaved change${diff.length > 1 ? 's' : ''} to the ${targetText()}` : 'No changes yet';
    proposeBtn.disabled = bad || !diff.length;
    schedulePreview(bad);
  }

  // ---- live preview
  const tripNow = kigaliNow();
  const trip = { km: numField({ value: 5, min: 0, max: 500, decimal: true, unit: 'km', label: 'Distance', width: '80px', onInput: () => schedulePreview() }), min: numField({ value: 15, min: 0, max: 1440, decimal: true, unit: 'min', label: 'Duration', width: '80px', onInput: () => schedulePreview() }), hours: numField({ value: 3, min: 1, max: 24, unit: 'h', label: 'Hours', width: '70px', onInput: () => schedulePreview() }) };
  const hourSel = h('select', { 'aria-label': 'Hour of day' }, Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: i === tripNow.hour }, hourLabel(i))));
  const dowSel = h('select', { 'aria-label': 'Day of week' }, DAYS.map((nm, i) => h('option', { value: i, selected: i === tripNow.dow }, nm)));
  const airportCb = h('input', { type: 'checkbox' }), schedCb = h('input', { type: 'checkbox' });
  for (const x of [hourSel, dowSel, airportCb, schedCb]) x.addEventListener('change', () => schedulePreview());
  const hoursWrap = h('label', {}, 'Hours ', trip.hours.el);
  const tripBox = h('div', { class: 'row tripbox' }, h('label', {}, 'Distance ', trip.km.el), h('label', {}, 'Time ', trip.min.el), hoursWrap, h('label', {}, 'Start ', dowSel, ' ', hourSel), h('label', { class: 'chk' }, airportCb, 'Airport'), h('label', { class: 'chk' }, schedCb, 'Booked in advance'));
  function schedulePreview(bad) {
    clearTimeout(previewTimer);
    hoursWrap.style.display = billingSel.value === 'hourly' ? '' : 'none';
    if (bad === true || Object.keys(errorsNow()).length) { fill(previewEl, h('div', { class: 'empty' }, 'Fix the highlighted fields to see the fare preview.')); return; }
    previewTimer = setTimeout(runPreview, 250);
  }
  async function runPreview() {
    const seq = ++previewSeq; const cur = readState();
    const tv = [trip.km.get(), trip.min.get()]; if (tv.some(Number.isNaN)) { fill(previewEl, h('div', { class: 'empty' }, 'Enter a distance and time.')); return; }
    try {
      const r = await api('POST', '/admin/pricing/preview', { rule: stateToBody(cur, svcSel.value, zoneSel.value || null), trip: { distance_km: tv[0], duration_min: tv[1], local_hour: Number(hourSel.value), local_dow: Number(dowSel.value), airport: airportCb.checked, scheduled: schedCb.checked, hours: billingSel.value === 'hourly' ? trip.hours.get() : undefined } });
      if (seq !== previewSeq) return;
      const keyOf = (l) => l.code + (l.code === 'distance' || l.code === 'time' ? '' : '');
      const cur_ = new Map((r.current?.lines || []).map((l) => [keyOf(l), l])), prop = new Map(r.proposed.lines.map((l) => [keyOf(l), l]));
      const keys = [...prop.keys(), ...[...cur_.keys()].filter((k) => !prop.has(k))];
      const delta = r.current ? r.proposed.total - r.current.total : null;
      fill(previewEl, 
        h('table', { class: 'difftbl preview' }, h('thead', {}, h('tr', {}, ['Fare line', r.current ? 'Current' : '', 'Proposed'].map((x) => h('th', {}, x)))),
          h('tbody', {}, keys.map((k) => { const p = prop.get(k), c = cur_.get(k); return h('tr', { class: p && c && p.amount !== c.amount ? 'chg' : '' }, h('td', {}, (p || c).label_en), h('td', {}, c ? fmt(c.amount) : r.current ? '-' : ''), h('td', {}, p ? fmt(p.amount) : '-')); }),
            h('tr', { class: 'total' }, h('td', {}, 'Customer pays'), h('td', {}, r.current ? fmt(r.current.total) : ''), h('td', { 'data-testid': 'preview-total' }, fmt(r.proposed.total) + ' RWF')))),
        delta != null && h('div', { class: 'ptotal ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '') }, delta === 0 ? 'Same as the current price for this trip.' : `${delta > 0 ? '+' : ''}${fmt(delta)} RWF (${r.current.total ? (delta / r.current.total * 100).toFixed(1) : '-'}%) compared with today for this trip.`),
        r.current_error && h('div', { class: 'muted' }, 'No current price to compare with (' + r.current_error + ').'),
        h('div', { class: 'hint' }, 'Same calculation as real quotes. Waiting time and extras are added when the trip ends.'));
    } catch (e) { if (seq === previewSeq) fill(previewEl, h('div', { class: 'err' }, e.message)); }
  }

  // ---- propose
  async function propose() {
    const cur = readState(); const diff = diffStates(baseState, cur);
    const effective = effectiveEl.value ? new Date(effectiveEl.value).toISOString() : undefined;
    const self = d.self_approval && can('pricing.approve');
    const msg = base
      ? `This changes the ${targetText()}: ${diffSentence(diff)}. It applies to new bookings ${effective ? 'from ' + when(effective) : 'once approved'}; accepted quotes are unaffected. ${d.self_approval ? 'Self-approval is on, so you can approve it yourself right after.' : 'A different person must approve it before it goes live.'}`
      : `This sets the first ${targetText()}: ${diffSentence(diff)}. It applies to new bookings ${effective ? 'from ' + when(effective) : 'once approved'}.`;
    const a = await ask('Propose this price change?', { confirmText: 'Propose change', message: msg });
    if (!a) return;
    try {
      const r = await api('POST', '/admin/pricing', stateToBody(cur, svcSel.value, zoneSel.value || null, effective));
      setDirty('price', false);
      if (self) {
        const ok = await ask('Approve it now?', { confirmText: 'Approve my own change', danger: true, message: 'Self-approval is enabled. Approving now makes the new price live without a second check, and the audit log will mark it as self approved.' });
        if (ok) { try { await api('POST', `/admin/pricing/${r.id}/approve`); toast('Proposed and approved: the new price is live'); } catch (e) { toast(e.message, true); } }
        else toast('Proposed. It is waiting for approval.');
      } else toast('Proposed. Another person must approve it before it goes live.');
      go('pricing');
    } catch (e) { toast(e.message, true); }
  }

  function loadTarget(keepTarget) {
    t.service = svcSel.value; t.zone = zoneSel.value || null;
    base = baseFor(t.service, t.zone); baseState = ruleToState(base);
    const src = fromSel.value ? active.find((r) => r.id === fromSel.value) : base;
    st = ruleToState(src);
    if (!src && svcSel.value.includes('hourly')) st.billing = 'hourly';
    for (const f of PRICE_FIELDS) ctl[f.key].set(st[f.key]);
    billingSel.value = st.billing; modelSel.value = st.model; renderWindows(); changed();
  }
  const guardedReload = () => { if (isDirty() && !window.confirm('Replace your edits with the values of the selected price?')) { svcSel.value = t.service; zoneSel.value = t.zone ?? ''; return; } loadTarget(); };
  svcSel.addEventListener('change', guardedReload); zoneSel.addEventListener('change', guardedReload);
  fromSel.addEventListener('change', () => loadTarget());
  billingSel.addEventListener('change', changed); modelSel.addEventListener('change', changed); effectiveEl.addEventListener('change', changed);

  billingSel.value = st.billing; modelSel.value = st.model;
  bar = saveBar({ status: statusEl, actions: [discardBtn, proposeBtn] });
  el.append(h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: () => go('pricing') }, '← Back to prices'), h('h1', { style: 'margin:0' }, 'Price editor')),
    d.self_approval && h('div', { class: 'banner danger' }, 'Self-approval is ON: you will be able to approve your own change. It is flagged in the audit log.'),
    h('div', { class: 'card targetbar' }, h('label', {}, 'Service ', svcSel), h('label', {}, 'Zone ', zoneSel), h('label', {}, 'Start from ', fromSel),
      h('span', { class: 'hint' }, 'Pick another service or zone to create its price. "Copy values from" duplicates an existing price into the target.')),
    h('div', { class: 'editgrid' }, body, h('aside', { class: 'sidecol' }, h('div', { class: 'card' }, h('h2', {}, 'Live fare preview'), tripBox, previewEl), h('div', { class: 'card' }, diffEl))),
    bar);
  renderWindows(); changed();
}

// =============================================================== SETTINGS

const valueText = (it, v) => it.type === 'bool' ? (v ? 'On' : 'Off') : Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : typeof v === 'number' ? fmt(v) + (it.unit ? ' ' + it.unit : '') : typeof v === 'string' ? v : JSON.stringify(v);

V.settings = async (el, state = {}) => {
  const [d, ints] = await Promise.all([api('GET', '/admin/settings'), api('GET', '/admin/integration-status')]);
  const isSuper = S.roles.includes('super_admin');
  const filter = h('input', { type: 'search', placeholder: 'Find a setting', value: state.q || '', 'aria-label': 'Find a setting', style: 'min-width:260px' });
  const sections = h('div', {});
  const rerender = () => {
    sections.replaceChildren(); const q = filter.value.trim().toLowerCase();
    for (const g of d.groups) {
      const items = d.items.filter((it) => it.group === g && (!q || (it.label + ' ' + it.key + ' ' + it.desc).toLowerCase().includes(q)));
      if (!items.length) continue;
      sections.append(h('div', { class: 'card' }, h('h2', {}, g), items.map(settingRow)));
    }
    if (!sections.children.length) sections.append(h('div', { class: 'empty card' }, 'No settings match your search.'));
  };
  function settingRow(it) {
    const locked = it.superAdminOnly && !isSuper;
    let ctrl, getVal, nf;
    const orig = it.value;
    const errEl = h('div', { class: 'ferr' });
    const saveBtn = h('button', { class: 'b', style: 'display:none' }, 'Save'), cancelBtn = h('button', { class: 'b sec', style: 'display:none' }, 'Undo');
    const dirtyId = 'setting:' + it.key;
    const update = () => {
      let v, err = null;
      try { v = getVal(); } catch (e) { err = e.message; }
      if (!err && nf) { err = nf.error(); }
      const dirty = JSON.stringify(v) !== JSON.stringify(orig);
      errEl.textContent = err || ''; setDirty(dirtyId, dirty && !locked);
      saveBtn.style.display = cancelBtn.style.display = dirty ? '' : 'none'; saveBtn.disabled = !!err;
      row.classList.toggle('editing', dirty);
    };
    if (it.type === 'bool') { const cb = h('input', { type: 'checkbox', checked: !!orig, disabled: locked, 'aria-label': it.label }); cb.addEventListener('change', update); getVal = () => cb.checked; ctrl = h('label', { class: 'switch' }, cb, h('span', {}, 'On / off')); }
    else if (it.type === 'enum') { const s = h('select', { disabled: locked, 'aria-label': it.label }, it.options.map((o) => h('option', { value: o, selected: o === orig }, o))); s.addEventListener('change', update); getVal = () => s.value; ctrl = s; }
    else if (it.type === 'int') { nf = numField({ value: orig, unit: it.unit, min: it.min ?? 0, max: it.max, label: it.label, onInput: update }); nf.input.disabled = locked; getVal = () => nf.get(); ctrl = nf.el; }
    else if (it.type === 'int_list' || it.type === 'str_list') { const i = h('input', { value: (orig || []).join(', '), disabled: locked, 'aria-label': it.label, style: 'min-width:260px' }); i.addEventListener('input', update); getVal = () => { const p = i.value.split(',').map((x) => x.trim()).filter(Boolean); if (it.type === 'int_list') { if (p.some((x) => !/^\d+$/.test(x))) throw new Error('Use whole numbers separated by commas'); return p.map(Number); } return p; }; ctrl = i; }
    else { const i = h('input', { value: JSON.stringify(orig), 'aria-label': it.label, style: 'min-width:260px', class: 'mono' }); i.addEventListener('input', update); getVal = () => { try { return JSON.parse(i.value); } catch { throw new Error('Not valid JSON'); } }; ctrl = i; }
    saveBtn.addEventListener('click', async () => {
      const v = getVal();
      if (it.key === 'pricing.self_approval' && v === true) { const a = await ask('Turn on self-approval?', { danger: true, confirmText: 'Turn on', reason: true, message: 'Anyone who can propose a price or commission change will also be able to approve their own change, so nothing is checked by a second person. Use this only for very small teams. Each self-approved change is flagged in the audit log.' }); if (!a) return; }
      try { await api('PUT', '/admin/settings/' + it.key, { value: v }); setDirty(dirtyId, false); toast(`${it.label} saved`); V.settings_reload(); } catch (e) { errEl.textContent = e.message; toast(e.message, true); }
    });
    cancelBtn.addEventListener('click', () => { setDirty(dirtyId, false); rerender(); });
    const reset = it.has_default && !it.is_default && !locked && h('button', { class: 'b sec', title: 'Back to the built-in default', onclick: async () => {
      const a = await ask('Reset to default?', { confirmText: 'Reset', message: `${it.label} goes back from ${valueText(it, it.value)} to ${valueText(it, it.default)}.` });
      if (a) act(() => api('DELETE', '/admin/settings/' + it.key), V.settings_reload); } }, 'Reset to default');
    const row = h('div', { class: 'setrow' },
      h('div', { class: 'setinfo' }, h('div', { class: 'flabel' }, it.label), h('div', { class: 'hint' }, it.desc), h('code', { class: 'key' }, it.key)),
      h('div', { class: 'setctl' }, h('div', { class: 'row', style: 'margin:0' }, ctrl, saveBtn, cancelBtn, reset), errEl,
        h('div', { class: 'hint' }, it.has_default ? `Default: ${valueText(it, it.default)}` : 'No built-in default', it.min != null || it.max != null ? ` · allowed ${it.min != null ? fmt(it.min) : ''} to ${it.max != null ? fmt(it.max) : ''}${it.unit ? ' ' + it.unit : ''}` : '', it.is_default ? ' · using the default' : '',
          it.last_change ? ` · last changed by ${it.last_change.by} on ${when(it.last_change.at)}${it.last_change.action === 'setting.reset' ? ' (reset to default)' : ''}` : ''),
        locked && h('div', { class: 'hint' }, 'Only a super admin can change this.')));
    return row;
  }
  V.settings_reload = () => { S.dirty.clear(); go('settings'); };
  filter.addEventListener('input', rerender);
  el.append(h('h1', {}, 'Settings'),
    d.settings['pricing.self_approval'] && h('div', { class: 'banner danger' }, h('b', {}, 'Self-approval is ON. '), 'Price and commission changes can be approved by the person who proposed them. Turn it off below when you have a second approver.'),
    h('div', { class: 'row' }, filter), sections,
    h('div', { class: 'banner' }, 'Feature flags have their own page (Feature flags), and notification wording is edited under Content and rules.'),
    h('h2', {}, 'Integration status'), table([{ h: 'Integration', k: 'name' }, { h: 'Status', k: 'status' }], ints.integrations));
  rerender();
};

// =============================================================== PROMOTIONS

const SEGMENTS = [['all', 'Everyone'], ['first_ride', 'First ride only'], ['corporate', 'Corporate members'], ['referred', 'Customers who joined by referral'], ['phones', 'A list of phone numbers']];
V.promos = async (el) => {
  const [d, sv] = await Promise.all([api('GET', '/admin/promotions'), api('GET', '/admin/services')]);
  const segName = (p) => (SEGMENTS.find(([k]) => k === (p.segment || (p.first_ride_only ? 'first_ride' : 'all'))) || ['', 'Everyone'])[1] + (p.segment === 'phones' ? ` (${p.segment_phones?.length || 0})` : '');
  const f = {
    code: h('input', { placeholder: 'e.g. WELCOME20', maxlength: 20, 'aria-label': 'Code' }),
    kind: h('select', { 'aria-label': 'Discount type' }, h('option', { value: 'percent' }, 'Percent off'), h('option', { value: 'fixed' }, 'Fixed amount off')),
    value: numField({ value: 10, min: 1, max: 100000, unit: '%', label: 'Value' }), max: numField({ value: null, min: 1, nullable: true, unit: 'RWF', label: 'Maximum discount' }), minFare: numField({ value: 0, min: 0, unit: 'RWF', label: 'Minimum fare' }),
    seg: h('select', { 'aria-label': 'Audience' }, SEGMENTS.map(([k, l]) => h('option', { value: k }, l))), phones: h('textarea', { rows: 3, placeholder: '+250788123456, +250722123456 (comma or new line separated)', style: 'width:100%;display:none', 'aria-label': 'Phone numbers' }),
    from: h('input', { type: 'date', 'aria-label': 'Start date' }), to: h('input', { type: 'date', 'aria-label': 'End date' }),
    budget: numField({ value: null, min: 1, nullable: true, unit: 'RWF', label: 'Total budget' }), usage: numField({ value: null, min: 1, nullable: true, unit: 'uses', label: 'Total uses' }), per: numField({ value: 1, min: 1, max: 100, unit: 'per customer', label: 'Uses per customer' }),
    svc: h('select', { 'aria-label': 'Service', multiple: true, size: 4 }, sv.services.filter((s) => s.kind === 'ride').map((s) => h('option', { value: s.id }, s.name_en))),
  };
  const err = h('div', { class: 'err' });
  const syncKind = () => { const pct = f.kind.value === 'percent'; f.value.el.querySelector('.unit').textContent = pct ? '%' : 'RWF'; };
  f.kind.addEventListener('change', syncKind);
  f.seg.addEventListener('change', () => { f.phones.style.display = f.seg.value === 'phones' ? '' : 'none'; });
  const dirtyOn = () => setDirty('promo', !!f.code.value.trim());
  f.code.addEventListener('input', dirtyOn);
  const iso = (dt, end) => (dt ? new Date(dt + (end ? 'T23:59:59' : 'T00:00:00')).toISOString() : undefined);
  const build = () => {
    const body = { code: f.code.value.trim().toUpperCase(), kind: f.kind.value, value: f.value.get(), min_fare: f.minFare.get(), segment: f.seg.value, per_user_limit: f.per.get() };
    const bad = [f.value, f.minFare, f.per, f.max, f.budget, f.usage].find((n) => n.error());
    if (!/^[A-Z0-9_-]{3,20}$/.test(body.code)) return { error: 'Code must be 3-20 letters, numbers, - or _' };
    if (bad) return { error: bad.error() };
    if (body.kind === 'percent' && body.value > 100) return { error: 'A percentage cannot be more than 100' };
    if (f.max.get() != null) body.max_discount = f.max.get(); if (f.budget.get() != null) body.budget = f.budget.get(); if (f.usage.get() != null) body.usage_limit = f.usage.get();
    if (f.from.value) body.valid_from = iso(f.from.value); if (f.to.value) body.valid_to = iso(f.to.value, true);
    if (body.valid_from && body.valid_to && body.valid_to <= body.valid_from) return { error: 'The end date must be after the start date' };
    if (f.seg.value === 'phones') { body.segment_phones = f.phones.value.split(/[\s,;]+/).filter(Boolean); if (!body.segment_phones.length || body.segment_phones.some((p) => !/^\+250\d{9}$/.test(p))) return { error: 'Phone numbers must look like +250788123456' }; }
    const sel = [...f.svc.selectedOptions].map((o) => o.value); if (sel.length) body.service_ids = sel;
    return { body };
  };
  const create = async () => {
    err.textContent = ''; const { body, error } = build(); if (error) { err.textContent = error; return; }
    const what = body.kind === 'percent' ? `${body.value}% off` : `${fmt(body.value)} RWF off`;
    const a = await ask('Create this promotion?', { confirmText: 'Create promotion', message: `Code ${body.code} gives ${what}${body.max_discount ? ' (up to ' + fmt(body.max_discount) + ' RWF)' : ''} to ${SEGMENTS.find(([k]) => k === body.segment)[1].toLowerCase()}${body.valid_from ? ' from ' + when(body.valid_from) : ''}${body.valid_to ? ' until ' + when(body.valid_to) : ''}. The platform pays for the discount${body.budget ? ', up to ' + fmt(body.budget) + ' RWF in total, after which the code stops working' : ' with no total cap'}.` });
    if (!a) return;
    try { await api('POST', '/admin/promotions', body); setDirty('promo', false); toast('Promotion created'); go('promos'); } catch (e) { err.textContent = e.message; toast(e.message, true); }
  };
  const lab = (t, c, hint) => h('label', { class: 'field' }, h('span', { class: 'flabel' }, t), c, hint && h('span', { class: 'hint' }, hint));
  el.append(h('h1', {}, 'Promotions'),
    table([{ h: 'Code', k: 'code' }, { h: 'Discount', f: (p) => (p.kind === 'percent' ? p.value + '%' : money(p.value)) + (p.max_discount ? ' (max ' + fmt(p.max_discount) + ')' : '') }, { h: 'Audience', f: segName },
      { h: 'Runs', f: (p) => `${p.valid_from ? new Date(p.valid_from).toLocaleDateString(LOC()) : 'now'} → ${p.valid_to ? new Date(p.valid_to).toLocaleDateString(LOC()) : 'no end'}` },
      { h: 'Budget used', f: (p) => p.budget ? h('div', {}, `${fmt(p.spent)} / ${fmt(p.budget)} RWF`, h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, Math.round(p.spent / p.budget * 100))}%` }))) : `${fmt(p.spent)} RWF (no cap)` },
      { h: '', f: (p) => h('span', { class: 'row', style: 'margin:0' },
        h('button', { class: 'b sec', onclick: () => act(() => api('PATCH', '/admin/promotions/' + p.id, { active: !p.active }), () => go('promos')) }, p.active ? 'Active · pause' : 'Paused · resume'),
        h('button', { class: 'b sec', onclick: async () => {
          const a = await ask('Edit ' + p.code, { confirmText: 'Save', message: 'Change the end date or budget. The budget cannot be lower than what is already spent.', fields: [{ name: 'valid_to', label: 'End date (empty = no end)', type: 'date', value: p.valid_to ? new Date(p.valid_to).toISOString().slice(0, 10) : '' }, { name: 'budget', label: 'Total budget RWF (0 = no cap)', type: 'number', value: p.budget ?? 0 }] });
          if (a) act(() => api('PATCH', '/admin/promotions/' + p.id, { valid_to: a.valid_to ? iso(a.valid_to, true) : null, budget: a.budget > 0 ? a.budget : null }), () => go('promos')); } }, 'Edit')) }], d.promotions, null, 'No promotions yet. Create one below.'),
    h('div', { class: 'card', style: 'margin-top:14px' }, h('h2', {}, 'New promotion'),
      h('div', { class: 'fgrid' }, lab('Code', f.code, 'Customers type this at checkout.'), lab('Discount type', f.kind), lab('Value', f.value.el), lab('Maximum discount', f.max.el, 'Optional cap per trip for percent codes.'), lab('Minimum fare', f.minFare.el, 'Trip must cost at least this much.'),
        lab('Who can use it', f.seg, 'First ride and corporate members are checked automatically at checkout.'), lab('Start date', f.from, 'Empty = starts now.'), lab('End date', f.to, 'Empty = no end.'),
        lab('Total budget', f.budget.el, 'The code stops when this much has been given away. Empty = no cap.'), lab('Total uses', f.usage.el), lab('Uses per customer', f.per.el), lab('Only on these services', f.svc, 'Hold Ctrl or Cmd to choose several. None selected = all rides.')),
      f.phones, err,
      h('div', { class: 'row' }, h('button', { class: 'b', onclick: create }, 'Review and create'))));
};

// =============================================================== SERVICES

V.services = async (el) => {
  const [d, z] = await Promise.all([api('GET', '/admin/services'), api('GET', '/admin/zones')]);
  const zs = z.zones;
  const zoneOn = (sid, zid) => d.zone_services.find((x) => x.service_id === sid && x.zone_id === zid)?.enabled;
  el.append(h('h1', {}, 'Services'), h('div', { class: 'banner' }, 'Switch a service on or off everywhere or in one zone, rename it, and set how many passengers it takes. A service needs an approved price in a zone before it can be switched on there. Customers see changes immediately.'),
    table([{ h: 'Service', f: (s) => h('div', {}, h('b', {}, s.name_en), h('div', { class: 'muted' }, `${s.name_rw} · ${s.name_fr || '-'}`)) }, { h: 'Type', f: (s) => s.kind === 'abasare' ? 'Abasare' : 'Ride' }, { h: 'Seats', k: 'passenger_capacity' },
      { h: 'Everywhere', f: (s) => h('button', { class: 'b ' + (s.enabled ? '' : 'sec'), 'aria-label': 'Toggle ' + s.name_en, onclick: async () => {
        const a = await ask(`${s.enabled ? 'Turn off' : 'Turn on'} ${s.name_en}?`, { confirmText: s.enabled ? 'Turn off' : 'Turn on', danger: s.enabled, message: s.enabled ? 'Customers will no longer see this service anywhere. Trips already booked are not affected.' : 'Customers in every enabled zone will be able to book it.' });
        if (a) act(() => api('PATCH', '/admin/services/' + s.id, { enabled: !s.enabled }), () => go('services')); } }, s.enabled ? 'ON' : 'off') },
      ...zs.map((zn) => ({ h: zn.name, f: (s) => h('button', { class: 'b ' + (zoneOn(s.id, zn.id) ? '' : 'sec'), 'aria-label': `Toggle ${s.name_en} in ${zn.name}`, onclick: async () => {
        const on = !zoneOn(s.id, zn.id);
        const a = await ask(`${on ? 'Enable' : 'Disable'} ${s.name_en} in ${zn.name}?`, { confirmText: on ? 'Enable' : 'Disable', danger: !on, message: on ? 'Customers in this zone will be able to book it.' : `Customers in ${zn.name} will no longer see ${s.name_en}. Trips already booked are not affected.` });
        if (a) act(() => api('PUT', `/admin/services/${s.id}/zones/${zn.id}`, { enabled: on }), () => go('services')); } }, zoneOn(s.id, zn.id) ? 'ON' : 'off') })),
      { h: '', f: (s) => h('button', { class: 'b sec', onclick: async () => {
        const a = await ask('Edit ' + s.name_en, { confirmText: 'Save', message: 'Names are what customers see in each language.', fields: [{ name: 'name_en', label: 'Name (English)', value: s.name_en }, { name: 'name_rw', label: 'Name (Kinyarwanda)', value: s.name_rw }, { name: 'name_fr', label: 'Name (French)', value: s.name_fr || '' }, { name: 'passenger_capacity', label: 'Seats (passengers)', type: 'number', value: s.passenger_capacity }] });
        if (a) { delete a.reason; if (!a.name_fr) delete a.name_fr; act(() => api('PATCH', '/admin/services/' + s.id, a), () => go('services')); } } }, 'Edit') }], d.services, null, 'No services.'));
};

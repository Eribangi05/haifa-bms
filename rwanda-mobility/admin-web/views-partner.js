'use strict';
// Venue partners. V.partners = back-office management (partners.manage); V.partner = the restricted portal a partner_manager sees (own partner only, enforced by the API).

const thisMonth = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 7);

V.partners = async (el, state = {}) => {
  if (state.id) return partnerDetail(el, state.id);
  const d = await api('GET', '/admin/partners');
  el.append(h('h1', {}, 'Venue partners'),
    note('Hotels, bars and malls that hand out request codes. A partner manager sees only their own codes, the rides requested from them and a monthly statement. Rides can be charged to the partner on a monthly invoice.'),
    table([{ h: 'Partner', k: 'name' }, { h: 'Status', f: (p) => pill(p.status), s: (p) => p.status }, { h: 'Codes', k: 'codes', cls: 'num' }, { h: 'Managers', k: 'managers', cls: 'num' }, { h: 'Requests', k: 'requests', cls: 'num' }, { h: 'Contact', f: (p) => p.contact_name || '-' }],
      d.partners, (p) => go('partners', { id: p.id }), 'No partners yet.', { csv: 'partners' }),
    h('div', { class: 'row' }, h('button', { class: 'b', onclick: async () => {
      const v = await ask('New partner', { fields: [{ name: 'name', label: 'Venue / company name', required: true, maxlength: 120 }, { name: 'contact_name', label: 'Contact person', maxlength: 120 }, { name: 'contact_phone', label: 'Contact phone', maxlength: 30 }, { name: 'contact_email', label: 'Contact email', type: 'email' }] });
      if (v) await act(() => api('POST', '/admin/partners', Object.fromEntries(Object.entries({ name: v.name, contact_name: v.contact_name, contact_phone: v.contact_phone, contact_email: v.contact_email }).filter(([, x]) => x))), () => go('partners')); } }, 'New partner')));
};

async function partnerDetail(el, id) {
  const [d, codes] = await Promise.all([api('GET', '/admin/partners/' + id), can('codes.view') ? api('GET', '/admin/request-codes').catch(() => ({ codes: [] })) : { codes: [] }]);
  const p = d.partner, t = p.billing_terms || {}, month = h('input', { type: 'month', value: thisMonth(), 'aria-label': 'Month' }), out = h('div', {});
  const free = (codes.codes || []).filter((c) => !c.partner_id);
  el.append(h('h1', {}, p.name), h('p', {}, pill(p.status), ' ', p.contact_name || '', ' ', p.contact_phone || '', ' ', p.contact_email || ''),
    h('div', { class: 'card' }, h('h2', {}, 'Billing terms'), h('p', { class: 'muted' }, `Monthly invoice. Payment within ${t.payment_days ?? '-'} days. Monthly cap: ${t.monthly_cap ? money(t.monthly_cap) : 'none'}. Maximum fare per ride: ${t.max_fare ? money(t.max_fare) : 'none'}.`),
      h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: async () => {
        const v = await ask('Billing terms', { fields: [{ name: 'payment_days', label: 'Payment days', type: 'number', integer: true, min: 0, max: 120, value: t.payment_days }, { name: 'monthly_cap', label: 'Monthly cap in RWF (empty = none)', type: 'number', integer: true, min: 0, value: t.monthly_cap }, { name: 'max_fare', label: 'Maximum fare per ride in RWF (empty = none)', type: 'number', integer: true, min: 0, value: t.max_fare }] });
        if (v) await act(() => api('PATCH', '/admin/partners/' + id, { billing_terms: Object.fromEntries(Object.entries({ payment_days: v.payment_days, monthly_cap: v.monthly_cap, max_fare: v.max_fare }).filter(([, x]) => x != null)) }), () => go('partners', { id })); } }, 'Edit terms'),
        h('button', { class: 'b sec', onclick: () => act(() => api('PATCH', '/admin/partners/' + id, { status: p.status === 'suspended' ? 'active' : 'suspended' }), () => go('partners', { id })) }, p.status === 'suspended' ? 'Reactivate' : 'Suspend'))),
    h('h2', {}, 'Request codes'),
    table([{ h: 'Code', f: (c) => h('code', {}, c.code), s: (c) => c.code }, { h: 'Venue', k: 'label' }, { h: 'Billed to partner', f: (c) => (c.bill_to_partner ? 'yes' : 'no') }, { h: 'Requests', k: 'requests', cls: 'num' },
      { h: '', f: (c) => h('button', { class: 'b sec', onclick: () => act(() => api('DELETE', `/admin/partners/${id}/codes/${c.id}`), () => go('partners', { id })) }, 'Unlink') }], d.codes, null, 'No codes linked yet.'),
    free.length ? h('div', { class: 'row' }, h('button', { class: 'b', onclick: async () => {
      const v = await ask('Link a request code', { fields: [{ name: 'code', label: 'Code', type: 'select', options: free.map((c) => ({ value: c.id, label: `${c.code} - ${c.label}` })) }, { name: 'bill', label: 'Charge rides to the partner?', type: 'select', options: [{ value: 'no', label: 'No, riders pay' }, { value: 'yes', label: 'Yes, bill the partner monthly' }] }] });
      if (v) await act(() => api('POST', `/admin/partners/${id}/codes`, { code_id: v.code, bill_to_partner: v.bill === 'yes' }), () => go('partners', { id })); } }, 'Link a code')) : note('Create a request code in the Request codes tab, then link it here.'),
    h('h2', {}, 'Partner managers'),
    table([{ h: 'Name', k: 'display_name' }, { h: 'Email', k: 'email' }, { h: 'Status', f: (u) => pill(u.status) }], d.managers, null, 'No manager has joined yet.'),
    d.invites.length ? note(d.invites.length + ' invitation(s) waiting: ' + d.invites.map((i) => i.email).join(', ')) : null,
    h('div', { class: 'row' }, h('button', { class: 'b', onclick: async () => {
      const v = await ask('Invite a partner manager', { fields: [{ name: 'name', label: 'Full name', required: true, maxlength: 80 }, { name: 'email', label: 'Email', type: 'email', required: true }] });
      if (!v) return; const r = await api('POST', `/admin/partners/${id}/invite`, v);
      openDialog('Invitation link (shown once)', h('div', {}, h('p', {}, 'Send this link only to the invitee. They set their own password and authenticator.'), h('input', { readonly: true, value: r.invite_url, style: 'width:100%', onfocus: (e) => e.target.select() }))); } }, 'Invite manager')),
    h('h2', {}, 'Monthly statement and invoice'),
    h('div', { class: 'row' }, month, h('button', { class: 'b sec', onclick: () => act(async () => { out.replaceChildren(statementView(await api('GET', `/admin/partners/${id}/statement?month=${month.value}`))); }) }, 'Show statement'),
      h('button', { class: 'b', onclick: async () => { const v = await ask('Issue invoice for ' + month.value, { confirmText: 'Issue invoice', message: 'Creates the invoice for the rides charged to this partner in that month. It cannot be issued twice.' }); if (v) await act(() => api('POST', `/admin/partners/${id}/invoice`, { month: month.value })); } }, 'Issue invoice')), out,
    h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: () => go('partners', {}) }, 'Back to partners')));
}

function statementView(s) {
  return h('div', { class: 'card' }, h('h2', {}, 'Statement ' + s.month),
    h('div', { class: 'grid' }, kpi('Requests', nfmt(s.requests)), kpi('Completed trips', nfmt(s.completed_trips)), kpi('Billed to partner', nfmt(s.billed_trip_count)), kpi('Amount to invoice', money(s.billed_total))),
    s.invoice ? note(`Invoice issued: ${money(s.invoice.total_amount)} for ${s.invoice.trip_count} trips (${s.invoice.status}).`, 'ok') : note('No invoice issued for this month yet.'),
    table([{ h: 'Ref', k: 'ref' }, dateCol('Completed', 'completed_at'), { h: 'Venue code', k: 'code_label' }, { h: 'From', f: (t) => t.pickup_name || '-' }, { h: 'To', f: (t) => t.dest_name || '-' }, moneyCol('Fare', 'final_fare'), { h: 'Billed to partner', f: (t) => (t.billed_to_partner ? 'yes' : 'no') }],
      s.trips, null, 'No completed trips this month.', { csv: 'statement-' + s.month }));
}

// ---- the partner manager's own console: no pricing, no bookings, no other partner ----
V.partner = async (el, state = {}) => {
  const me = await api('GET', '/partner/me'), month = state.month || thisMonth();
  const [codes, reqs, st] = await Promise.all([api('GET', '/partner/codes'), api('GET', '/partner/requests'), api('GET', '/partner/statement?month=' + month)]);
  const m = h('input', { type: 'month', value: month, 'aria-label': 'Month', onchange: (e) => go('partner', { month: e.target.value }) });
  el.append(h('h1', {}, me.partner.name), me.partner.status === 'suspended' ? note('This partner account is suspended. Contact Abasare.', 'bad') : null,
    h('h2', {}, 'Your request codes'),
    table([{ h: 'Code', f: (c) => h('code', {}, c.code), s: (c) => c.code }, { h: 'Venue', k: 'label' }, { h: 'Scans', k: 'scans', cls: 'num' }, { h: 'Requests', k: 'requests', cls: 'num' }, { h: 'Charged to you', f: (c) => (c.bill_to_partner ? 'yes' : 'no') }, { h: 'Status', f: (c) => (c.active ? pill('active', 'ok') : pill('inactive', 'bad')) }], codes.codes, null, 'No codes linked to your account yet.'),
    h('h2', {}, 'Requests from your codes'),
    table([dateCol('When', 'created_at'), { h: 'Ref', k: 'ref' }, { h: 'Code', k: 'code_label' }, { h: 'Status', f: (r) => pill(r.status), s: (r) => r.status }, { h: 'From', f: (r) => r.pickup_name || '-' }, { h: 'To', f: (r) => r.dest_name || '-' }, moneyCol('Fare', 'fare'), { h: 'Charged to you', f: (r) => (r.billed_to_partner ? 'yes' : 'no') }], reqs.requests, null, 'No requests yet.', { csv: 'requests' }),
    h('div', { class: 'row' }, m), statementView(st));
};

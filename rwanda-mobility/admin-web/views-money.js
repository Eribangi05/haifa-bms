'use strict';
// Round 3 views: customer credit and loyalty, damage/loss claims, USSD channel. Loaded after business.js (see index.html); registers V.wallet, V.claims, V.ussd.

// =============================================================== CREDIT AND LOYALTY
const WALLET_SUBS = [['lookup', 'Look up a customer'], ['adjustments', 'Credit changes'], ['loyalty', 'Loyalty and tiers']];
V.wallet = async (el, state = {}) => {
  const sub = WALLET_SUBS.some((s) => s[0] === state.sub) ? state.sub : 'lookup';
  el.append(h('h1', {}, 'Credit and loyalty'), note('Credit is spendable on trips only. It cannot be topped up with cash and cannot be withdrawn. Every change is a ledger entry and is audited.'), subnav('wallet', WALLET_SUBS, sub));
  const body = h('div'); el.append(body);
  await WAL[sub](body, state);
};
const WAL = {};
const kindLabel = (k) => ({ credit: 'Credit added', debit: 'Credit removed', hold: 'Reserved for a trip', release: 'Reservation released', spend: 'Spent on a trip', expire: 'Expired' }[k] || human(k));
WAL.lookup = async (el, state) => {
  const q = state.q || '';
  const inp = h('input', { type: 'search', placeholder: 'Phone number, name or user id', 'aria-label': 'Find a customer', value: q, style: 'min-width:min(100%,320px)' });
  el.append(filterBar(inp, h('button', { type: 'submit', class: 'b', onclick: () => go('wallet', { sub: 'lookup', q: inp.value.trim() }) }, 'Search')));
  if (q.length < 3) { el.append(h('p', { class: 'muted' }, 'Enter at least 3 characters.')); return; }
  const r = await api('GET', '/admin/wallet/lookup?q=' + encodeURIComponent(q));
  el.append(table([{ h: 'Customer', f: (u) => u.display_name || '-', s: (u) => u.display_name || '' }, { h: 'Phone', k: 'phone' }, { h: 'Status', f: (u) => pill(u.status), s: (u) => u.status },
    { h: 'Credit', f: (u) => money(u.balance.available), s: (u) => u.balance.available, cls: 'num', csv: (u) => u.balance.available }, { h: 'Reserved', f: (u) => money(u.balance.held), s: (u) => u.balance.held, cls: 'num', csv: (u) => u.balance.held },
    { h: 'Points', f: (u) => (u.loyalty ? nfmt(u.loyalty.points) + ' (' + human(u.loyalty.tier) + ')' : '0'), s: (u) => u.loyalty?.points || 0, cls: 'num', csv: (u) => u.loyalty?.points || 0 }],
  r.users, (u) => walletDetail(u), 'No customer matches.'));
};
async function walletDetail(u) {
  const d = await api('GET', `/admin/wallet/${u.id}/statement?limit=50`);
  const body = h('div', {}, h('div', { class: 'row' }, kpi('Credit', money(d.balance.available)), kpi('Reserved for trips', money(d.balance.held)), kpi('Loyalty points', nfmt(d.loyalty.points), { hint: human(d.loyalty.tier) + ' tier' })),
    d.summary.next_expiry ? note('Next credit expiry: ' + when(d.summary.next_expiry) + ' (' + money(d.summary.expiring_within_30_days) + ' within 30 days).') : null,
    can('wallet.adjust') ? h('div', { class: 'row' }, h('button', { class: 'b', onclick: () => adjustCredit(u, dlg) }, 'Change credit')) : null,
    h('h3', {}, 'Statement'),
    table([dateCol('When', 'created_at'), { h: 'What', f: (e) => kindLabel(e.kind), s: (e) => e.kind }, { h: 'Source', f: (e) => human(e.source || ''), s: (e) => e.source || '' },
      { h: 'Credit change', f: (e) => (e.available_delta ? (e.available_delta > 0 ? '+' : '') + nfmt(e.available_delta) : '-'), s: (e) => e.available_delta, cls: 'num', csv: (e) => e.available_delta },
      { h: 'Reserved change', f: (e) => (e.held_delta ? (e.held_delta > 0 ? '+' : '') + nfmt(e.held_delta) : '-'), s: (e) => e.held_delta, cls: 'num', csv: (e) => e.held_delta },
      { h: 'Credit after', f: (e) => money(e.available_after), s: (e) => e.available_after, cls: 'num', csv: (e) => e.available_after }, { h: 'Note', k: 'memo' }], d.entries, null, 'No credit activity yet.', { csv: 'credit-statement' }));
  const dlg = openDialog((u.display_name || u.phone || 'Customer') + ': credit statement', body, { width: 980, key: 'wallet' });
}
async function adjustCredit(u, dlg) {
  const cfg = await api('GET', '/admin/loyalty/config');
  const th = cfg.settings['wallet.adjust_approval_threshold'];
  const r = await ask('Change credit for ' + (u.display_name || u.phone), { reason: false, confirmText: 'Submit', message: `Positive amounts add credit, negative amounts remove it. Changes of ${money(th)} or more wait for a second person to approve.`,
    fields: [{ name: 'amount', label: 'Amount in RWF (negative removes credit)', type: 'number', integer: true, required: true, min: -10000000, max: 10000000 },
      { name: 'source', label: 'Kind', type: 'select', value: 'adjustment', options: [{ value: 'adjustment', label: 'Correction' }, { value: 'goodwill', label: 'Goodwill' }, { value: 'promo', label: 'Promotion' }, { value: 'quest', label: 'Quest or campaign reward' }] },
      { name: 'why', label: 'Reason (at least 10 characters, kept in the audit log)', type: 'textarea', required: true, maxlength: 300, pattern: '^[\\s\\S]{10,}$', patternMsg: 'The reason needs at least 10 characters.' }] });
  if (!r) return;
  await act(async () => { const a = await api('POST', '/admin/wallet/adjustments', { user_id: u.id, amount: r.amount, source: r.source, reason: r.why }); toast(a.needs_approval ? 'Submitted: waiting for a second approver.' : 'Credit changed.'); }, () => { dlg.close(); go('wallet', { sub: 'adjustments' }); });
}
WAL.adjustments = async (el, state) => {
  const st = state.status || 'pending';
  const r = await api('GET', '/admin/wallet/adjustments?status=' + st), approve = can('wallet.adjust.approve');
  el.append(h('div', { class: 'row' }, ['pending', 'applied', 'rejected'].map((s) => h('button', { class: 'b ' + (s === st ? '' : 'sec'), onclick: () => go('wallet', { sub: 'adjustments', status: s }) }, human(s)))),
    note('Large changes need a different person to approve: the one who asked cannot approve their own.'),
    table([dateCol('Requested', 'created_at'), { h: 'Customer', f: (a) => (a.display_name || '') + ' ' + (a.phone || ''), s: (a) => a.phone || '' }, { h: 'Amount', f: (a) => (a.amount > 0 ? '+' : '') + nfmt(a.amount) + ' RWF', s: (a) => a.amount, cls: 'num', csv: (a) => a.amount },
      { h: 'Kind', f: (a) => human(a.source), s: (a) => a.source }, { h: 'Reason', k: 'reason' }, { h: 'Requested by', k: 'requested_by_name' }, { h: 'Status', f: (a) => pill(a.status), s: (a) => a.status },
      { h: '', f: (a) => (a.status === 'pending' && approve ? h('span', { class: 'row' },
        h('button', { class: 'b', onclick: async () => { const x = await ask('Approve this credit change?', { confirmText: 'Approve', message: `${a.amount > 0 ? 'Adds' : 'Removes'} ${money(Math.abs(a.amount))} for ${a.phone}. Reason: ${a.reason}` }); if (x) await act(() => api('POST', `/admin/wallet/adjustments/${a.id}/decision`, { approve: true }), () => go('wallet', { sub: 'adjustments' })); } }, 'Approve'),
        h('button', { class: 'b sec', onclick: async () => { const x = await ask('Reject this credit change?', { confirmText: 'Reject', danger: true }); if (x) await act(() => api('POST', `/admin/wallet/adjustments/${a.id}/decision`, { approve: false }), () => go('wallet', { sub: 'adjustments' })); } }, 'Reject')) : null) }],
    r.adjustments, null, 'Nothing here.', { csv: 'credit-changes' }));
};
WAL.loyalty = async (el) => {
  const [c, rec] = await Promise.all([api('GET', '/admin/loyalty/config'), api('GET', '/admin/wallet/reconciliation')]);
  const s = c.settings;
  el.append(rec.ok ? h('div', { class: 'alert ok' }, 'Credit reconciliation: the ledger agrees with every customer balance, reservation and deposit.') : h('div', { class: 'alert bad', role: 'alert' }, 'CREDIT MISMATCH: ' + (rec.credit_mismatches.length + rec.hold_mismatches.length + rec.deposit_mismatches.length) + ' customers differ from the ledger. Do not change credit until an engineer has checked.'),
    h('div', { class: 'row' }, kpi('Credit owed to customers', money(rec.totals.credit_liability)), kpi('Reserved for open trips', money(rec.totals.held_liability)), kpi('Abasare deposits held', money(rec.totals.deposits_held))),
    h('h2', {}, 'Loyalty tiers'),
    table([{ h: 'Tier', f: (t) => human(t.tier), s: (t) => t.min_points }, { h: 'Lifetime points from', f: (t) => nfmt(t.min_points), s: (t) => t.min_points, cls: 'num', csv: (t) => t.min_points }, { h: 'Bonus points per trip', f: (t) => t.bonus_pct + '%', s: (t) => t.bonus_pct, cls: 'num', csv: (t) => t.bonus_pct },
      { h: 'Extra free-cancel time', f: (t) => t.extra_free_cancel_s + ' s', s: (t) => t.extra_free_cancel_s, cls: 'num', csv: (t) => t.extra_free_cancel_s }], c.tiers, null, '', { sort: false }),
    h('p', { class: 'muted' }, `Points earned: 1 point per ${nfmt(s['loyalty.earn_rwf_per_point'])} RWF of fare. Redeem: 100 points = ${money(s['loyalty.redeem_rwf_per_100_points'])} credit, minimum ${nfmt(s['loyalty.min_redeem_points'])} points. Credit expires after ${s['wallet.credit_expiry_days'] || 'never'} ${s['wallet.credit_expiry_days'] ? 'days' : ''}. Abasare deposit: ${s['abasare.deposit_percent']}%.`),
    can('settings.manage') ? h('div', { class: 'row' }, h('button', { class: 'b', onclick: () => go('settings') }, 'Change these on the Settings page (Credit and loyalty)')) : note('Thresholds and perks are edited on the Settings page by someone with the settings permission.'));
};

// =============================================================== CLAIMS
const CLAIM_STATUS_TONE = { submitted: 'warn', under_review: 'info', info_requested: 'warn', accepted: 'ok', partially_accepted: 'ok', rejected: 'bad', settled: 'ok', closed: '', withdrawn: '' };
const claimPill = (s) => pill(s, CLAIM_STATUS_TONE[s] ?? '');
V.claims = async (el, state = {}) => {
  const st = state.status || '', as = state.assigned || '', q = state.q || '';
  const r = await api('GET', `/admin/claims?limit=200${st ? '&status=' + st : ''}${as ? '&assigned=' + as : ''}${q ? '&q=' + encodeURIComponent(q) : ''}${state.overdue ? '&overdue=true' : ''}`);
  const s1 = h('select', { 'aria-label': 'Status' }, ['', 'submitted', 'under_review', 'info_requested', 'accepted', 'partially_accepted', 'rejected', 'settled', 'closed', 'withdrawn'].map((x) => h('option', { value: x, selected: x === st }, x ? human(x) : 'Any status')));
  const s2 = h('select', { 'aria-label': 'Assignment' }, [['', 'Anyone'], ['me', 'Assigned to me'], ['unassigned', 'Unassigned']].map(([v, l]) => h('option', { value: v, selected: v === as }, l)));
  const s3 = h('input', { type: 'search', placeholder: 'Claim or booking reference', value: q, 'aria-label': 'Search claims' });
  const od = h('input', { type: 'checkbox', checked: !!state.overdue, 'aria-label': 'Only claims past the first-response target' });
  const overdueN = r.claims.filter((c) => c.sla_overdue).length;
  el.append(h('h1', {}, 'Claims'), note('Damage, loss and injury claims from owners, drivers and passengers. Only the people on the trip and staff can see a claim. The other party has a right to reply before a decision.'),
    overdueN ? h('div', { class: 'alert warn', role: 'status' }, overdueN + ' claim(s) are past the first-response target.') : null,
    filterBar(s1, s2, s3, h('label', {}, od, ' Overdue only'), h('button', { type: 'submit', class: 'b', onclick: () => go('claims', { status: s1.value, assigned: s2.value, q: s3.value.trim(), overdue: od.checked }) }, 'Filter')),
    table([{ h: 'Claim', k: 'ref' }, { h: 'Trip', k: 'booking_ref' }, { h: 'Type', f: (c) => human(c.claim_type), s: (c) => c.claim_type }, { h: 'From', f: (c) => human(c.filer_role), s: (c) => c.filer_role },
      { h: 'Status', f: (c) => claimPill(c.status), s: (c) => c.status, csv: (c) => c.status }, moneyCol('Claimed', 'claimed_amount'), moneyCol('Granted', 'decision_amount'),
      { h: 'Assigned', f: (c) => c.assigned_name || 'Nobody', s: (c) => c.assigned_name || '' }, { h: 'Target', f: (c) => (c.sla_overdue ? pill('overdue', 'bad') : ['submitted'].includes(c.status) ? ago(c.sla_due_at).replace(' ago', ' past') && when(c.sla_due_at) : '-'), s: (c) => Date.parse(c.sla_due_at) },
      { h: 'Settlement', f: (c) => (c.settlement_status === 'none' ? '-' : human(c.settlement_status)), s: (c) => c.settlement_status }, dateCol('Filed', 'created_at')], r.claims, (c) => claimDetail(c.id), 'No claims match.', { csv: 'claims' }));
};
async function claimDetail(id) {
  const c = await api('GET', '/admin/claims/' + id);
  const reload = () => { dlg.close(); claimDetail(id).catch((e) => toast(e.message, true)); };
  const handle = can('claims.handle'), decide = can('claims.decide'), approve = can('claims.settle.approve');
  const evtLabel = { filed: 'Filed', status: 'Status', message: 'Message from claimant', reply: 'Reply from the other party', internal_note: 'Internal note (staff only)', evidence: 'Evidence added', info_request: 'Information requested', decision: 'Decision', assignment: 'Assignment', settlement: 'Settlement', reminder: 'Reminder', insurer: 'Insurer details' };
  const timeline = h('ol', { class: 'timeline' }, c.events.map((e) => h('li', { class: e.visibility === 'internal' ? 'internal' : '' },
    h('b', {}, evtLabel[e.kind] || human(e.kind)), ' ', h('small', { class: 'muted' }, when(e.created_at) + ' · ' + (e.author_name || human(e.author_role)) + (e.visibility === 'internal' ? ' · staff only' : '')),
    e.body ? h('div', {}, e.body) : null, e.kind === 'status' && e.meta?.to ? h('div', { class: 'muted' }, human(e.meta.from) + ' → ' + human(e.meta.to)) : null)));
  const img = (u) => h('a', { href: u.url, target: '_blank', rel: 'noopener' }, h('img', { src: u.url, alt: 'Evidence photo', loading: 'lazy', style: 'max-width:100%;max-height:180px;border-radius:8px;margin:2px;object-fit:cover' }));
  const side = (title, p) => h('div', { class: 'card', style: 'flex:1;min-width:240px' }, h('h4', {}, title),
    p.record ? h('div', { class: 'muted' }, `Odometer ${nfmt(p.record.odometer_km)} km · fuel ${p.record.fuel_percent}% · ${p.record.damage_noted ? 'driver noted damage' : 'no damage noted'}${p.record.notes ? ' · ' + p.record.notes : ''}`) : h('div', { class: 'muted' }, 'No record'),
    p.record?.owner_response ? h('div', { class: 'muted' }, 'Owner said: ' + (p.record.owner_response === 'ok' ? 'OK' : 'issue') + (p.record.owner_note ? ' - ' + p.record.owner_note : '')) : null,
    h('div', {}, p.photos.map((u) => h('a', { href: u, target: '_blank', rel: 'noopener' }, h('img', { src: u, alt: title + ' photo', loading: 'lazy', style: 'max-width:48%;border-radius:8px;margin:2px' })))));
  const uploads = c.evidence.filter((e) => e.source === 'upload');
  const act1 = (label, fn, cls = 'sec') => h('button', { class: 'b ' + cls, onclick: fn }, label);
  const actions = h('div', { class: 'row' },
    handle && !c.assigned_to ? act1('Assign to me', () => act(() => api('POST', `/admin/claims/${id}/assign`, {}), reload)) : null,
    handle ? act1('Add internal note', async () => { const r = await ask('Internal note', { fields: [{ name: 'body', label: 'Note (staff only)', type: 'textarea', required: true, maxlength: 2000 }], confirmText: 'Save' }); if (r) await act(() => api('POST', `/admin/claims/${id}/notes`, { body: r.body }), reload); }) : null,
    handle && c.status === 'submitted' ? act1('Start review', () => act(() => api('POST', `/admin/claims/${id}/review`, { action: 'start' }), reload), '') : null,
    handle && ['submitted', 'under_review'].includes(c.status) ? act1('Ask for more information', async () => { const r = await ask('Ask the claimant for information', { fields: [{ name: 'message', label: 'What do you need?', type: 'textarea', required: true, maxlength: 1000 }], confirmText: 'Send' }); if (r) await act(() => api('POST', `/admin/claims/${id}/review`, { action: 'request_info', message: r.message }), reload); }) : null,
    decide && ['submitted', 'under_review'].includes(c.status) ? act1('Decide', async () => {
      const replyOpen = c.respondent_id && !c.replied_at && c.reply_due_at && new Date(c.reply_due_at) > new Date();
      const r = await ask('Decision on ' + c.ref, { confirmText: 'Record decision', message: replyOpen ? 'The other party can still reply until ' + when(c.reply_due_at) + '. Deciding earlier is recorded in the audit log.' : null,
        fields: [{ name: 'outcome', label: 'Outcome', type: 'select', value: 'accepted', options: [{ value: 'accepted', label: 'Accepted in full' }, { value: 'partially_accepted', label: 'Partly accepted' }, { value: 'rejected', label: 'Rejected' }] },
          { name: 'amount', label: 'Amount granted in RWF (claimed ' + nfmt(c.claimed_amount) + ')', type: 'number', integer: true, min: 0, value: c.claimed_amount || undefined, help: 'Leave as claimed for full acceptance; lower it for a partial one; ignored when rejected.' },
          { name: 'why', label: 'Reason shown to both parties (at least 10 characters)', type: 'textarea', required: true, maxlength: 1000 }, ...(replyOpen ? [{ name: 'skip', label: 'Decide before the reply window ends?', type: 'select', value: 'no', options: [{ value: 'no', label: 'No, wait' }, { value: 'yes', label: 'Yes, decide now' }] }] : [])] });
      if (!r) return;
      await act(() => api('POST', `/admin/claims/${id}/decision`, { outcome: r.outcome, amount: r.outcome === 'rejected' ? undefined : r.amount, reason: r.why, skip_reply_window: r.skip === 'yes' }), reload);
    }, '') : null,
    decide && ['accepted', 'partially_accepted'].includes(c.status) && c.settlement_status !== 'pending_approval' ? act1('Settle', async () => {
      const r = await ask('Settle ' + c.ref, { confirmText: 'Settle', message: 'Credit is added to the claimant\'s account at once. A manual payout is a record of a transfer made outside the platform. Amounts at or above the approval threshold wait for a second person.',
        fields: [{ name: 'kind', label: 'How', type: 'select', value: 'credit', options: [{ value: 'credit', label: 'Customer credit' }, { value: 'manual_payout', label: 'Manual payout (record only)' }] },
          { name: 'amount', label: 'Amount in RWF', type: 'number', integer: true, min: 1, max: c.decision_amount, value: c.decision_amount, required: true }, { name: 'reference', label: 'Payment reference (manual payout only)', type: 'text', maxlength: 120 }] });
      if (r) await act(async () => { const x = await api('POST', `/admin/claims/${id}/settlement`, { kind: r.kind, amount: r.amount, reference: r.reference || undefined }); toast(x.needs_approval ? 'Waiting for a second approver.' : 'Settled.'); }, reload);
    }, '') : null,
    approve && c.settlement_status === 'pending_approval' && c.settlement_requested_by !== myId() ? h('span', { class: 'row' },
      act1('Approve settlement', () => act(() => api('POST', `/admin/claims/${id}/settlement/decision`, { approve: true }), reload), ''), act1('Reject settlement', () => act(() => api('POST', `/admin/claims/${id}/settlement/decision`, { approve: false }), reload))) : null,
    handle && ['rejected', 'settled'].includes(c.status) ? act1('Close claim', () => act(() => api('POST', `/admin/claims/${id}/close`, {}), reload)) : null,
    handle ? act1('Insurer details', async () => { const r = await ask('Insurer details (recorded by hand: nothing is sent to an insurer)', { confirmText: 'Save', fields: [{ name: 'policy_ref', label: 'Policy reference', type: 'text', value: c.policy_ref || '', maxlength: 80 }, { name: 'insurer_claim_ref', label: 'Insurer claim reference', type: 'text', value: c.insurer_claim_ref || '', maxlength: 80 },
      { name: 'insurer_status', label: 'Insurer status', type: 'select', value: c.insurer_status, options: ['not_applicable', 'to_submit', 'submitted', 'accepted', 'rejected', 'paid'].map((x) => ({ value: x, label: human(x) })) }] }); if (r) await act(() => api('PATCH', `/admin/claims/${id}/insurer`, { policy_ref: r.policy_ref || null, insurer_claim_ref: r.insurer_claim_ref || null, insurer_status: r.insurer_status }), reload); }) : null);
  const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,application/pdf', 'aria-label': 'Add evidence file' });
  const upload = handle && !['closed', 'withdrawn', 'settled'].includes(c.status) ? h('div', { class: 'row' }, fileIn, h('button', { class: 'b sec', onclick: async () => {
    if (!fileIn.files[0]) { toast('Choose a file first.', true); return; }
    const fd = new FormData(); fd.append('file', fileIn.files[0]);
    await act(async () => { const r = await fetch(API + `/admin/claims/${id}/evidence`, { method: 'POST', headers: { authorization: 'Bearer ' + S.access }, body: fd }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || 'Upload failed'); }, reload); } }, 'Upload')) : null;
  const body = h('div', {},
    h('div', { class: 'row' }, claimPill(c.status), pill(human(c.claim_type), ''), h('span', {}, `Claimed ${money(c.claimed_amount)}`), c.decision_amount != null ? h('span', {}, `Granted ${money(c.decision_amount)}`) : null, c.settlement_status !== 'none' ? pill('settlement ' + c.settlement_status, c.settlement_status === 'done' ? 'ok' : 'warn') : null),
    h('p', {}, h('b', {}, 'From: '), `${c.filer_name || c.filer_phone || '-'} (${human(c.filer_role)}, ${c.filer_phone || ''})   `, h('b', {}, 'Other party: '), `${c.respondent_name || '-'} (${human(c.respondent_role || '')})   `, h('b', {}, 'Assigned: '), c.assigned_name || 'Nobody', '   ', h('b', {}, 'Trip: '), c.booking?.ref || ''),
    h('p', {}, c.description), c.reply_due_at ? h('p', { class: 'muted' }, 'Other party reply by ' + when(c.reply_due_at) + (c.replied_at ? ' (replied ' + when(c.replied_at) + ')' : ' (not replied yet)')) : null,
    c.policy_ref || c.insurer_status !== 'not_applicable' ? note(`Insurer: policy ${c.policy_ref || '-'}, claim ${c.insurer_claim_ref || '-'}, status ${human(c.insurer_status)}. Entered by hand; no insurer connection exists yet.`) : null,
    actions,
    c.comparison ? h('div', {}, h('h3', {}, 'Car condition: before and after'), h('div', { class: 'row', style: 'align-items:flex-start' }, side('At pickup', c.comparison.pickup), side('At drop-off', c.comparison.dropoff))) : null,
    h('h3', {}, 'Evidence uploaded (' + uploads.length + ')'), uploads.length ? h('div', {}, uploads.map((u) => h('div', { style: 'display:inline-block;margin:4px' }, img(u), u.caption ? h('div', { class: 'muted' }, u.caption) : null))) : h('p', { class: 'muted' }, 'No extra files.'), upload,
    h('h3', {}, 'Timeline'), timeline);
  const dlg = openDialog(c.ref + ' · ' + human(c.claim_type) + ' claim', body, { width: 1000, key: 'claim' });
}

// =============================================================== USSD
V.ussd = async (el, state = {}) => {
  const days = Number(state.days) || 30, outcome = state.outcome || '';
  const [stt, ses] = await Promise.all([api('GET', '/admin/ussd/stats?days=' + days), api('GET', '/admin/ussd/sessions?limit=100' + (outcome ? '&outcome=' + outcome : ''))]);
  const ch = (name) => stt.channels.find((x) => x.channel === name) || { bookings: 0, completed: 0, cancelled: 0 };
  const sel = h('select', { 'aria-label': 'Period' }, [7, 30, 90].map((d) => h('option', { value: d, selected: d === days }, 'Last ' + d + ' days')));
  const so = h('select', { 'aria-label': 'Outcome' }, ['', 'booked', 'cancelled', 'help', 'declined', 'declined_fare', 'no_car', 'blocked', 'error', 'completed'].map((x) => h('option', { value: x, selected: x === outcome }, x ? human(x) : 'Any outcome')));
  el.append(h('h1', {}, 'USSD channel'), note('Riders without a smartphone book over USSD (cash only). Phone numbers are masked here. Sessions are kept for 30 days.'),
    filterBar(sel, so, h('button', { type: 'submit', class: 'b', onclick: () => go('ussd', { days: sel.value, outcome: so.value }) }, 'Apply')),
    h('div', { class: 'row' }, kpi('USSD sessions', nfmt(stt.sessions.total)), kpi('Booked', nfmt(stt.sessions.booked), { hint: stt.sessions.total ? Math.round((100 * stt.sessions.booked) / stt.sessions.total) + '% of sessions' : '' }), kpi('Errors', nfmt(stt.sessions.errors), { tone: stt.sessions.errors ? 'warn' : '' }),
      kpi('Screens per session', stt.sessions.avg_screens ?? '-'), kpi('USSD bookings', nfmt(ch('ussd').bookings), { hint: `${ch('ussd').completed} completed, ${ch('ussd').cancelled} cancelled` }), kpi('App bookings', nfmt(ch('app').bookings), { hint: `${ch('app').completed} completed, ${ch('app').cancelled} cancelled` })),
    h('h2', {}, 'Outcomes'), table([{ h: 'Outcome', f: (o) => human(o.outcome), s: (o) => o.outcome }, { h: 'Sessions', k: 'n', cls: 'num' }], stt.outcomes, null, 'No sessions in this period.', { sort: false }),
    h('h2', {}, 'Language of USSD users'), table([{ h: 'Language', f: (l) => ({ rw: 'Kinyarwanda', fr: 'French', en: 'English' }[l.language] || 'Not chosen'), s: (l) => l.language || '' }, { h: 'Phones', k: 'n', cls: 'num' }], stt.languages, null, '', { sort: false }),
    h('h2', {}, 'Session log'),
    table([dateCol('Started', 'created_at'), { h: 'Phone', k: 'phone' }, { h: 'Provider', k: 'provider' }, { h: 'Language', f: (s) => s.language || '-', s: (s) => s.language || '' }, { h: 'Last step', f: (s) => human(s.step), s: (s) => s.step },
      { h: 'Screens', k: 'screens', cls: 'num' }, { h: 'Outcome', f: (s) => (s.outcome ? pill(s.outcome, s.outcome === 'booked' ? 'ok' : s.outcome === 'error' ? 'bad' : '') : pill('open', 'warn')), s: (s) => s.outcome || '', csv: (s) => s.outcome || '' },
      { h: 'Booking', f: (s) => (s.booking_ref ? s.booking_ref + ' (' + human(s.booking_status) + ')' : '-'), s: (s) => s.booking_ref || '' }], ses.sessions, null, 'No sessions yet.', { csv: 'ussd-sessions' }));
};

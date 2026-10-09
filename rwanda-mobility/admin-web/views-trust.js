'use strict';
// Round 5 console views: operations dashboard (busy hours, cancellations, time to first driver, failed payments), staff alerts and fraud signals,
// driver review queue with its time target, referrals and ambassadors. Registered in app.js (TABS) and index.html.

const dur = (s) => (s == null ? '-' : s < 90 ? s + ' s' : Math.round(s / 60) + ' min');
const sevCls = (s) => (s === 'critical' ? 'bad' : s === 'warning' ? 'warn' : '');

/** Bar chart of requested / completed / cancelled trips per hour (inline SVG, no library). */
function hourChart(rows) {
  if (!rows.length) return h('div', { class: 'muted' }, 'No trips in this period yet.');
  const W = Math.max(520, rows.length * 22), H = 150, pad = 22, max = Math.max(1, ...rows.map((r) => r.requested));
  const bw = (W - pad * 2) / rows.length;
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  const kids = [];
  for (const g of [0, 0.5, 1]) { const yy = y(max * g); kids.push(svg('line', { x1: pad, x2: W - pad, y1: yy, y2: yy, class: 'grid-line' }), svg('text', { x: 2, y: yy + 3, class: 'ax' }, document.createTextNode(String(Math.round(max * g))))); }
  rows.forEach((r, i) => {
    const x = pad + i * bw;
    kids.push(svg('rect', { x: x + 1, y: y(r.requested), width: Math.max(2, bw - 2), height: H - pad - y(r.requested), class: 'bar-req' }, svg('title', {}, document.createTextNode(`${r.hour.replace('T', ' ')}: ${r.requested} requested, ${r.completed} completed, ${r.cancelled} cancelled`))));
    if (r.completed) kids.push(svg('rect', { x: x + 1, y: y(r.completed), width: Math.max(2, bw - 2), height: H - pad - y(r.completed), class: 'bar-done' }));
    if (i % Math.ceil(rows.length / 12) === 0) kids.push(svg('text', { x: x + 1, y: H - 6, class: 'ax' }, document.createTextNode(r.hour.slice(rows.length > 30 ? 5 : 11, rows.length > 30 ? 10 : 16))));
  });
  const wrap = h('div', { class: 'chartwrap', role: 'img', 'aria-label': `Trips per hour. Peak ${max} requests in an hour.` });
  wrap.append(svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'hourchart' }, ...kids));
  return wrap;
}

// =============================================================== OPERATIONS DASHBOARD
V.opsdash = async (el, state = {}) => {
  const hours = Number(state.hours) || 24;
  const d = await api('GET', '/admin/dashboard/ops?hours=' + hours);
  const range = h('select', { 'aria-label': 'Period', onchange: () => go('opsdash', { hours: Number(range.value) }) }, [[6, 'Last 6 hours'], [24, 'Last 24 hours'], [72, 'Last 3 days'], [168, 'Last 7 days'], [720, 'Last 30 days']].map(([v, l]) => h('option', { value: v, selected: v === hours }, l)));
  const t = d.trips, p = d.payments, f = d.time_to_first_driver;
  el.append(h('h1', {}, 'Operations dashboard'),
    h('div', { class: 'row spread' }, h('div', { class: 'muted' }, 'Kigali time. Refreshed ' + when(d.generated_at) + '.'), h('span', { class: 'row' }, range, h('button', { class: 'b sec', onclick: () => go('opsdash') }, 'Refresh'))),
    h('h2', {}, 'Right now'),
    h('div', { class: 'grid' }, kpi('Drivers online', nfmt(d.live.online_drivers), { hint: 'seen in the last 2 minutes' }), kpi('Searching for a driver', nfmt(d.live.searching), { tone: d.live.searching > d.live.online_drivers ? 'warn' : '' }), kpi('Trips in progress', nfmt(d.live.active_trips))),
    h('h2', {}, 'Trips'),
    h('div', { class: 'grid' }, kpi('Requested', nfmt(t.requested)), kpi('Completed', nfmt(t.completed), { hint: t.completion_rate_pct + '% of requests' }),
      kpi('Cancellation rate', t.cancellation_rate_pct + '%', { tone: t.cancellation_rate_pct > 30 ? 'bad' : t.cancellation_rate_pct > 18 ? 'warn' : '', hint: `${t.cancelled_by.passenger} by riders, ${t.cancelled_by.driver} by drivers, ${t.cancelled_by.system} by the system` }),
      kpi('No driver found', nfmt(t.no_driver), { tone: t.no_driver > 0 ? 'warn' : '', to: t.no_driver ? 'bookings' : null })),
    h('h2', {}, 'Time to first driver'),
    h('div', { class: 'grid' }, kpi('Median', dur(f.median_s), { hint: `${nfmt(f.assigned_trips)} trips got a driver` }), kpi('Slowest 10%', dur(f.p90_s), { tone: f.p90_s > 600 ? 'bad' : f.p90_s > 300 ? 'warn' : '' }), kpi('Average', dur(f.average_s))),
    h('h2', {}, 'Mobile-money payments'),
    h('div', { class: 'grid' }, kpi('Failed payments', nfmt(p.failed), { tone: p.failure_rate_pct > 15 ? 'bad' : p.failed ? 'warn' : '', hint: `${p.failure_rate_pct}% of ${nfmt(p.mobile_money_total)} attempts` }), kpi('Failed amount', money(p.failed_amount), {}),
      h('div', { class: 'card' }, h('div', { class: 'l' }, 'Top failure reasons'), p.top_reasons.length ? h('ul', { class: 'plain' }, p.top_reasons.map((r) => h('li', {}, `${human(r.reason)}: ${r.n}`))) : h('div', { class: 'muted' }, 'None'))),
    h('h2', {}, 'Trips per hour'),
    h('div', { class: 'card' }, hourChart(d.per_hour), h('div', { class: 'muted legend' }, h('span', { class: 'sw req' }), ' requested ', h('span', { class: 'sw done' }), ' completed')));
};

// =============================================================== STAFF ALERTS and FRAUD SIGNALS
V.alerts = async (el, state = {}) => {
  const status = state.status || 'open';
  const [a, r] = await Promise.all([api('GET', '/admin/alerts?status=' + status), api('GET', '/admin/risk-events?limit=60')]);
  const sub = h('div', { class: 'row' }, ['open', 'acknowledged', 'all'].map((s) => h('button', { class: 'b ' + (s === status ? '' : 'sec'), onclick: () => go('alerts', { status: s }) }, human(s))));
  el.append(h('h1', {}, 'Alerts'),
    note('Raised automatically: failed staff sign-ins, a stolen-session sign, staff opening many customer records, privileged actions at night (Kigali time), large credit changes, bursts of failed payments or fraud signals, and every SOS. Acknowledge an alert once someone has looked at it.'), sub,
    table([
      { h: 'Level', f: (x) => pill(x.severity, sevCls(x.severity)), s: (x) => ({ critical: 0, warning: 1, info: 2 }[x.severity]) },
      { h: 'What happened', f: (x) => h('div', {}, h('b', {}, x.title), h('div', { class: 'muted' }, human(x.kind), x.actor_name ? ' · ' + x.actor_name : '')), s: (x) => x.title },
      { h: 'When', f: (x) => when(x.created_at), s: (x) => Date.parse(x.created_at) },
      { h: 'Details', f: (x) => h('code', { class: 'small' }, JSON.stringify(x.detail).slice(0, 140)), csv: (x) => JSON.stringify(x.detail) },
      { h: '', f: (x) => (x.status === 'open' ? h('button', { class: 'b', onclick: () => act(() => api('POST', `/admin/alerts/${x.id}/ack`), () => go('alerts', { status })) }, 'Acknowledge') : h('span', { class: 'muted' }, 'by ' + (x.acknowledged_by_name || '?') + ', ' + when(x.acknowledged_at))) }],
      a.alerts, null, status === 'open' ? 'No open alerts. Good.' : 'Nothing here.', { csv: 'alerts' }),
    h('h2', {}, 'Fraud signals (last 7 days)'),
    h('div', { class: 'grid' }, r.by_kind.length ? r.by_kind.map((k) => kpi(human(k.kind), nfmt(k.n))) : kpi('No signals', '0')),
    table([{ h: 'When', f: (x) => when(x.created_at), s: (x) => Date.parse(x.created_at) }, { h: 'Signal', f: (x) => human(x.kind), s: (x) => x.kind },
      { h: 'Person', f: (x) => (x.display_name || x.phone || (x.user_id ? x.user_id.slice(0, 8) : '-')), s: (x) => x.display_name || '' }, { h: 'Details', f: (x) => h('code', { class: 'small' }, JSON.stringify(x.detail).slice(0, 160)), csv: (x) => JSON.stringify(x.detail) }],
      r.events, null, 'No fraud signals recorded.', { csv: 'fraud-signals' }));
};

// =============================================================== DRIVER REVIEW QUEUE
V.reviewq = async (el) => {
  const d = await api('GET', '/admin/review-queue'), decide = can('drivers.review');
  const late = [...d.driver_applications, ...d.vehicle_applications].filter((x) => x.late).length;
  const age = (x) => h('span', {}, x.waiting_hours == null ? '-' : x.waiting_hours < 1 ? Math.round(x.waiting_hours * 60) + ' min' : x.waiting_hours + ' h', x.late ? [' ', pill('late', 'bad')] : null);
  el.append(h('h1', {}, 'Review queue'),
    note(`Oldest first. Target: reviewed within ${d.target_hours} hours (change it in Settings, "Drivers & Abasare"). Applications past the target are marked late and the driver sees that their application is being prioritised.`, late ? 'warn' : ''),
    h('h2', {}, 'Driver applications (' + d.driver_applications.length + ')'),
    table([{ h: 'Driver', f: (x) => h('div', {}, h('b', {}, x.legal_name || x.display_name || '-'), h('div', { class: 'muted' }, x.phone || '')), s: (x) => x.legal_name || '' },
      { h: 'Path', f: (x) => [x.vehicle_type ? human(x.vehicle_type) + (x.plate ? ' ' + x.plate : '') : null, x.abasare_status && x.abasare_status !== 'none' ? 'Abasare' : null].filter(Boolean).join(' + ') || '-' },
      { h: 'Documents', f: (x) => `${x.docs_pending} to check` + (x.docs_rejected ? `, ${x.docs_rejected} rejected` : '') + (!x.docs_pending && !x.docs_rejected ? ' (ready to decide)' : ''), s: (x) => x.docs_pending },
      { h: 'Waiting', f: age, s: (x) => x.waiting_hours ?? 0 },
      { h: '', f: (x) => h('button', { class: 'b', onclick: () => go('drivers', { q: x.phone || x.legal_name || '' }) }, decide ? 'Review' : 'Open') }],
      d.driver_applications, null, 'No driver applications waiting.', { csv: 'driver-queue', sortBy: 3, sortDir: -1 }),
    h('h2', {}, 'Vehicle applications from approved drivers (' + d.vehicle_applications.length + ')'),
    table([{ h: 'Driver', f: (x) => h('div', {}, h('b', {}, x.display_name || '-'), h('div', { class: 'muted' }, x.phone || '')), s: (x) => x.display_name || '' },
      { h: 'Vehicle', f: (x) => `${human(x.vehicle_type)} ${x.make} ${x.model}, ${x.plate}` }, { h: 'Documents', f: (x) => (x.docs_pending ? `${x.docs_pending} to check` : 'all checked'), s: (x) => x.docs_pending },
      { h: 'Waiting', f: age, s: (x) => x.waiting_hours ?? 0 },
      { h: '', f: (x) => decide && h('span', { class: 'row' },
        h('button', { class: 'b', onclick: async () => { const a = await ask(`Approve ${x.plate}?`, { confirmText: 'Approve', message: 'All mandatory documents must be approved first.' }); if (a) act(() => api('POST', `/admin/vehicles/${x.id}/review`, { decision: 'approve' }), () => go('reviewq')); } }, 'Approve'),
        h('button', { class: 'b sec', onclick: async () => { const a = await ask(`Send ${x.plate} back`, { confirmText: 'Send back', fields: [{ name: 'note', label: 'What must the driver fix?', type: 'textarea', required: true, maxlength: 300 }] }); if (a) act(() => api('POST', `/admin/vehicles/${x.id}/review`, { decision: 'reject', note: a.note }), () => go('reviewq')); } }, 'Send back')) }],
      d.vehicle_applications, null, 'No vehicle applications waiting.', { csv: 'vehicle-queue' }));
};

// =============================================================== REFERRALS and AMBASSADORS
V.referrals = async (el) => {
  const d = await api('GET', '/admin/referrals'), manage = can('growth.manage'), t = d.totals;
  const tierPillOf = (x) => pill(x, x === 'gold' ? 'ok' : x === 'silver' ? 'warn' : '');
  el.append(h('h1', {}, 'Referrals and ambassadors'),
    note('A referral is paid when the invited rider finishes a first paid trip. It is rejected (reason shown) when both accounts use the same phone or the inviter hit the monthly cap. Amounts and tier thresholds are in Settings, "Referrals". Reward amounts are PLACEHOLDERS to confirm.'),
    h('div', { class: 'grid' }, kpi('Invitations', nfmt(t.total)), kpi('Waiting for a first trip', nfmt(t.pending)), kpi('Rewarded', nfmt(t.rewarded)), kpi('Rejected', nfmt(t.rejected), { tone: t.rejected ? 'warn' : '' }), kpi('Paid out', money(t.paid))),
    h('h2', {}, 'Ambassadors'),
    table([{ h: 'Person', f: (x) => h('div', {}, h('b', {}, x.display_name || '-'), h('div', { class: 'muted' }, x.phone || '')), s: (x) => x.display_name || '' },
      { h: 'Tier', f: (x) => tierPillOf(x.tier), s: (x) => x.tier }, { h: 'Rewarded', k: 'rewarded', cls: 'num' }, { h: 'Waiting', k: 'pending', cls: 'num' }, { h: 'Rejected', k: 'rejected', cls: 'num' }, moneyCol('Earned', 'earned'),
      { h: 'Status', f: (x) => pill(x.status, x.status === 'active' ? 'ok' : 'warn'), s: (x) => x.status },
      { h: '', f: (x) => manage && h('button', { class: 'b sec', onclick: async () => { const a = await ask((x.status === 'active' ? 'Pause ' : 'Resume ') + (x.display_name || 'ambassador') + '?', { reason: true, danger: x.status === 'active', confirmText: x.status === 'active' ? 'Pause' : 'Resume' }); if (a) act(() => api('PATCH', '/admin/ambassadors/' + x.user_id, { status: x.status === 'active' ? 'paused' : 'active', reason: a.reason }), () => go('referrals')); } }, x.status === 'active' ? 'Pause' : 'Resume') }],
      d.ambassadors, null, 'No ambassadors yet. They appear after a first rewarded invitation.', { csv: 'ambassadors' }),
    h('h2', {}, 'Recent invitations'),
    table([{ h: 'When', f: (x) => when(x.created_at), s: (x) => Date.parse(x.created_at) }, { h: 'Inviter', k: 'referrer' }, { h: 'Invited', k: 'referee' },
      { h: 'Status', f: (x) => pill(x.status, x.status === 'rewarded' ? 'ok' : x.status === 'rejected' ? 'bad' : 'warn'), s: (x) => x.status }, { h: 'Why rejected', f: (x) => (x.reject_reason ? human(x.reject_reason) : '-') },
      { h: 'Reward (inviter / invited)', f: (x) => (x.status === 'rewarded' ? `${nfmt(x.reward_referrer)} / ${nfmt(x.reward_referee)}` : '-') }],
      d.recent, null, 'No invitations yet.', { csv: 'referrals' }));
};

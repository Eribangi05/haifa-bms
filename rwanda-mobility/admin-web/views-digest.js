'use strict';
// Daily digest: one Kigali day in numbers (GET /admin/digest), with a "Copy as text" button for pasting into WhatsApp or an e-mail.
V.digest = async (el, state = {}) => {
  const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10), day = state.date || today;
  const d = await api('GET', '/admin/digest?date=' + encodeURIComponent(day));
  const date = h('input', { type: 'date', value: day, max: today, 'aria-label': 'Date', onchange: () => go('digest', { date: date.value || today }) });
  const rate = (v) => (v == null ? '-' : v + ' %');
  const lines = [`Abasare daily digest ${d.date}`, `Requests ${d.trips.requested}, completed ${d.trips.completed}, cancelled ${d.trips.cancelled}, no driver ${d.trips.no_driver} (cancellation ${rate(d.trips.cancellation_rate_pct)})`,
    `Gross booking value ${money(d.money.gross_booking_value)}, platform commission ${money(d.money.platform_commission_revenue)}, cash collected ${money(d.money.cash_collected)}`,
    `Payment success ${rate(d.payments.success_rate_pct)}; safety incidents ${d.safety_incidents}; new support cases ${d.support_opened}; new users ${d.new_users}`, `Suspicious: ${d.suspicious.staff_alerts} staff alerts, ${d.suspicious.risk_events} risk events; drivers waiting now ${d.drivers_waiting_now}`];
  el.append(h('h1', {}, 'Daily digest'), h('div', { class: 'tbar' }, date, h('span', { class: 'grow' }), h('button', { class: 'b sec', onclick: async () => { try { await navigator.clipboard.writeText(lines.join('\n')); toast('Copied'); } catch { toast('Could not copy: select the text below', true); } } }, 'Copy as text')),
    h('h2', {}, 'Trips'), h('div', { class: 'grid' }, kpi('Requested', nfmt(d.trips.requested)), kpi('Completed trips', nfmt(d.trips.completed), { tone: 'ok' }), kpi('Cancelled', nfmt(d.trips.cancelled), { tone: d.trips.cancellation_rate_pct > 30 ? 'warn' : '' }), kpi('No driver found', nfmt(d.trips.no_driver), { tone: d.trips.no_driver ? 'warn' : '' }), kpi('Cancellation rate (%)', rate(d.trips.cancellation_rate_pct))),
    h('h2', {}, 'Money'), h('div', { class: 'grid' }, kpi('Gross booking value', money(d.money.gross_booking_value), { hint: 'customer spend, not revenue' }), kpi('Platform commission', money(d.money.platform_commission_revenue)), kpi('Driver earnings', money(d.money.driver_earnings)), kpi('Cash collected', money(d.money.cash_collected))),
    h('h2', {}, 'People and safety'), h('div', { class: 'grid' }, kpi('Safety incidents', nfmt(d.safety_incidents), { tone: d.safety_incidents ? 'bad' : '' }), kpi('New support cases', nfmt(d.support_opened)), kpi('New users', nfmt(d.new_users)), kpi('Drivers waiting', nfmt(d.drivers_waiting_now), { hint: 'right now' }),
      kpi('Suspicious activity', nfmt(d.suspicious.staff_alerts + d.suspicious.risk_events), { tone: d.suspicious.staff_alerts ? 'warn' : '', hint: `${d.suspicious.staff_alerts} staff alerts, ${d.suspicious.risk_events} risk events`, to: can('alerts.view') ? 'alerts' : null })),
    h('pre', { class: 'digesttext', tabindex: 0, 'aria-label': 'Digest as text' }, lines.join('\n')));
};

'use strict';
// Trust and safety console: safety checks ("Are you OK?"), rating tags, tips, favourites/blocks and driver badges / training.
// Loaded after business.js; shares core.js helpers. Every call is a staff endpoint that re-checks permissions; sections the role cannot read are shown as a short notice.

const safeCall = async (fn) => { try { return await fn(); } catch (e) { return { error: e }; } };
const noAccess = (what) => h('div', { class: 'muted' }, `You do not have access to ${what}.`);

V.trust = async (el) => {
  const [alerts, tags, tips, favs, optouts] = await Promise.all([
    can('safety.respond') ? safeCall(() => api('GET', '/admin/safety/alerts')) : null,
    can('drivers.view') ? safeCall(() => api('GET', '/admin/trust/tags')) : null,
    can('drivers.view') ? safeCall(() => api('GET', '/admin/trust/tips')) : null,
    can('drivers.view') ? safeCall(() => api('GET', '/admin/trust/favourites')) : null,
    can('safety.respond') ? safeCall(() => api('GET', '/admin/safety/opt-outs')) : null,
  ]);
  const reload = () => go('trust');
  el.append(h('h1', {}, 'Trust and safety'),
    h('p', { class: 'muted' }, 'Safety checks, rating tags, tips, favourite and blocked drivers, badges. SMS and push delivery is SIMULATED until providers are connected; no agency is ever contacted automatically.'));

  // ---- safety alerts
  el.append(h('h2', {}, 'Safety checks'));
  if (!alerts) el.append(noAccess('safety checks'));
  else if (alerts.error) el.append(errorPanel(alerts.error));
  else {
    const open = alerts.alerts.filter((a) => a.status === 'asked' || a.status === 'escalated');
    el.append(h('div', { class: 'grid' }, kpi('Waiting for passenger answer', nfmt(alerts.alerts.filter((a) => a.status === 'asked').length), { tone: alerts.alerts.some((a) => a.status === 'asked') ? 'warn' : '' }),
      kpi('Escalated, open', nfmt(alerts.alerts.filter((a) => a.status === 'escalated').length), { tone: alerts.alerts.some((a) => a.status === 'escalated') ? 'bad' : '' }), kpi('Answered OK', nfmt(alerts.alerts.filter((a) => a.status === 'ok').length))));
    el.append(table([
      dateCol('Asked', 'asked_at'), { h: 'Kind', f: (a) => human(a.kind), s: (a) => a.kind }, { h: 'Status', f: (a) => pill(a.status, a.status === 'escalated' ? 'bad' : a.status === 'asked' ? 'warn' : undefined), s: (a) => a.status, csv: (a) => a.status },
      { h: 'Response', f: (a) => (a.answer ? human(a.answer) : a.escalation_reason === 'no_answer' ? 'No answer' : '-'), s: (a) => a.answer || '' },
      { h: 'Booking', k: 'booking_ref', cls: 'nowrap' }, { h: 'Passenger', k: 'passenger_first_name' }, { h: 'Driver', k: 'driver' },
      { h: 'Detail', f: (a) => (a.kind === 'long_stop' ? `stopped ~${a.detail?.stopped_min ?? '?'} min` : `${nfmt(a.detail?.excess_m)} m beyond allowed ${nfmt(a.detail?.limit_m)} m`), csv: (a) => JSON.stringify(a.detail || {}) },
      { h: 'Case', f: (a) => [a.case_ref, a.incident_ref].filter(Boolean).join(' / ') || '-', s: (a) => a.case_ref || '' },
      { h: '', f: (a) => (can('safety.respond') && ['asked', 'escalated', 'ok'].includes(a.status) ? h('button', { class: 'b sec', onclick: async () => {
        const r = await ask('Resolve safety check ' + a.ref, { reason: true, confirmText: 'Resolve', message: 'Record what you actually did, e.g. who you called and when.' });
        if (r) act(() => api('POST', `/admin/safety/alerts/${a.id}/resolve`, { note: r.reason }), reload); } }, 'Resolve') : null) },
    ], alerts.alerts, null, 'No safety checks yet.', { csv: 'safety-checks', sortBy: 0, sortDir: -1, caption: `${open.length} open` }));
    if (optouts && !optouts.error) {
      el.append(h('h3', {}, 'Trusted-contact opt-outs'), h('p', { class: 'muted' }, 'Numbers that asked to stop trip messages (STOP link on the share page) or were added by staff. They are never messaged.'),
        table([dateCol('Since', 'created_at'), { h: 'Number', f: (o) => o.phone.slice(0, 7) + '***' + o.phone.slice(-2), s: (o) => o.phone }, { h: 'Source', k: 'source' },
          { h: '', f: (o) => h('button', { class: 'b sec', onclick: async () => { if (await ask('Remove opt-out', { confirmText: 'Remove', message: 'This number can be messaged again if its owner turns the contact on.' })) act(() => api('DELETE', '/admin/safety/opt-outs/' + encodeURIComponent(o.phone)), reload); } }, 'Remove') }],
        optouts.opt_outs, null, 'No opt-outs.'),
        h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: async () => { const r = await ask('Add opt-out', { confirmText: 'Add', fields: [{ name: 'phone', label: 'Phone number', required: true, pattern: '^(\\+?250|0)?7[0-9]{8}$', patternMsg: 'Enter a Rwandan number like 0788123456' }] }); if (r) act(() => api('POST', '/admin/safety/opt-outs', { phone: r.phone }), reload); } }, 'Add opt-out')));
    }
  }

  // ---- tags
  el.append(h('h2', {}, 'Rating tags per driver'));
  if (!tags) el.append(noAccess('rating tags'));
  else if (tags.error) el.append(errorPanel(tags.error));
  else {
    const names = [...new Set(tags.drivers.flatMap((d) => Object.keys(d.tags)))].sort();
    el.append(table([{ h: 'Driver', f: (d) => d.display_name || short(d.driver_id), s: (d) => d.display_name || '' }, { h: 'Rating', f: (d) => Number(d.rating_avg).toFixed(2), s: (d) => d.rating_avg, cls: 'num' }, { h: 'Ratings', k: 'rating_count', cls: 'num' },
      ...names.map((n) => ({ h: human(n), f: (d) => d.tags[n] || '', s: (d) => d.tags[n] || 0, cls: 'num' })),
      { h: '', f: (d) => (can('drivers.review') ? h('button', { class: 'b sec', onclick: () => badgeDialog(d, reload) }, 'Badges') : h('button', { class: 'b sec', onclick: () => badgeDialog(d, reload) }, 'View badges')) }],
    tags.drivers, null, 'No rated trips yet.', { csv: 'driver-tags' }));
  }

  // ---- tips
  el.append(h('h2', {}, 'Tips'));
  if (!tips) el.append(noAccess('tips'));
  else if (tips.error) el.append(errorPanel(tips.error));
  else {
    const t = tips.totals;
    el.append(h('div', { class: 'grid' }, kpi('Mobile-money tips paid', money(t.momo_total), { hint: `${nfmt(t.momo_count)} tips, 100% to drivers` }), kpi('Cash tips (informational)', money(t.cash_total_informational), { hint: `${nfmt(t.cash_count)} reported by passengers; Abasare did not process this cash` })),
      table([{ h: 'Driver', f: (d) => d.display_name || short(d.driver_id) }, { h: 'Tips', k: 'tips', cls: 'num' }, moneyCol('Total', 'total')], tips.top_drivers, null, 'No tips yet.', { csv: 'top-tipped-drivers' }));
  }

  // ---- favourites
  el.append(h('h2', {}, 'Favourite and blocked drivers'));
  if (!favs) el.append(noAccess('favourites'));
  else if (favs.error) el.append(errorPanel(favs.error));
  else {
    el.append(h('div', { class: 'grid' }, kpi('Favourites', nfmt(favs.totals.favourites)), kpi('Blocked', nfmt(favs.totals.blocked), { hint: 'Passengers are never identified here' }), kpi('Passengers using lists', nfmt(favs.totals.passengers))),
      table([{ h: 'Driver', f: (d) => d.display_name || short(d.driver_id) }, { h: 'Favourited by', k: 'favourited', cls: 'num' }, { h: 'Blocked by', k: 'blocked', cls: 'num' }], favs.drivers, null, 'Nobody has listed a driver yet.', { csv: 'driver-preferences', sortBy: 2, sortDir: -1 }));
  }
};

async function badgeDialog(d, reload) {
  const r = await api('GET', `/admin/drivers/${d.driver_id}/badges`);
  const has = r.badges.some((b) => b.id === 'training_completed');
  const body = h('div', {},
    h('p', { class: 'muted' }, 'Computed from approved, unexpired documents and real trip data. Only the training badge is granted by staff and every change is audited.'),
    r.badges.length ? h('div', { class: 'row' }, r.badges.map((b) => pill(b.label.en + (b.tier ? ` (${b.tier})` : ''), 'ok'))) : h('p', {}, 'No badges.'),
    r.training.length ? table([dateCol('Granted', 'granted_at'), { h: 'Reason', k: 'reason' }, dateCol('Revoked', 'revoked_at'), { h: 'Revoke reason', f: (x) => x.revoke_reason || '-' }], r.training, null, '') : null,
    can('drivers.review') ? h('div', { class: 'row end' }, h('button', { class: 'b' + (has ? ' red' : ''), onclick: async () => {
      const a = await ask(has ? 'Revoke training badge' : 'Grant training badge', { reason: true, confirmText: has ? 'Revoke' : 'Grant', danger: has, message: 'The reason is kept in the audit log.' });
      if (a) { dlg.close(); act(() => api('POST', `/admin/drivers/${d.driver_id}/training`, { granted: !has, reason: a.reason }), reload); } } }, has ? 'Revoke training' : 'Grant training')) : null);
  const dlg = openDialog('Badges: ' + (d.display_name || short(d.driver_id)), body, { key: 'badges', width: 640 });
}

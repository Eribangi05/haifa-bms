'use strict';
// Owner pages: Revenue (trips, commission, payouts, active drivers, daily or weekly trend, CSV and print/PDF), Ratings (spread, low ratings, drivers to coach)
// and Demo data (load or remove a week of presentation data). Data: GET /admin/revenue, /admin/revenue/csv, /admin/revenue/report, /admin/ratings, /admin/demo.

const ymdAdd = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** Bars (one per day or week): light = what customers paid, dark = the platform commission. */
function revenueChart(trend, group) {
  const W = Math.max(320, trend.length * 46 + 50), H = 190, padL = 46, padB = 34, padT = 12, innerH = H - padB - padT;
  const max = Math.max(1, ...trend.map((x) => Number(x.gross)));
  const slot = (W - padL - 8) / Math.max(1, trend.length), bw = Math.min(30, slot * 0.7);
  const kids = [];
  for (let i = 0; i <= 3; i++) {
    const y = padT + innerH - (innerH * i) / 3;
    kids.push(svg('line', { x1: padL, x2: W - 6, y1: y, y2: y, class: 'grid-line' }), svg('text', { x: padL - 5, y: y + 3, 'text-anchor': 'end', class: 'ax' }, document.createTextNode(nfmt(Math.round((max * i) / 3 / 1000)) + 'k')));
  }
  trend.forEach((x, i) => {
    const cx = padL + slot * i + slot / 2, gh = (Number(x.gross) / max) * innerH, ch = (Number(x.commission) / max) * innerH;
    const label = group === 'week' ? x.day.slice(5) : x.day.slice(5);
    kids.push(svg('rect', { x: cx - bw / 2, y: padT + innerH - gh, width: bw, height: Math.max(1, gh), class: 'bar-req', rx: 2 }, svg('title', {}, document.createTextNode(`${x.day}: ${money(x.gross)} · ${money(x.commission)}`))),
      svg('rect', { x: cx - bw / 2, y: padT + innerH - ch, width: bw, height: Math.max(1, ch), class: 'bar-done', rx: 2 }),
      svg('text', { x: cx, y: H - padB + 14, 'text-anchor': 'middle', class: 'ax' }, document.createTextNode(label)),
      svg('text', { x: cx, y: H - padB + 26, 'text-anchor': 'middle', class: 'ax mut' }, document.createTextNode(nfmt(x.trips))));
  });
  const wrap = h('div', { class: 'chartwrap', role: 'img', 'aria-label': 'Revenue trend: ' + trend.map((x) => `${x.day} ${money(x.commission)}`).join(', ') });
  wrap.append(svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `max-width:${Math.max(W, 640)}px;height:auto`, class: 'hourchart' }, ...kids));
  return wrap;
}

/** Trips by hour of the day (Kigali), 24 slim bars. */
function busyHours(rows) {
  const by = Object.fromEntries(rows.map((r) => [r.hour, r.trips])), max = Math.max(1, ...rows.map((r) => r.trips)), W = 24 * 20 + 30, H = 100;
  const kids = [];
  for (let hr = 0; hr < 24; hr++) {
    const n = by[hr] || 0, bh = (n / max) * (H - 30);
    kids.push(svg('rect', { x: 24 + hr * 20, y: H - 18 - bh, width: 14, height: Math.max(1, bh), class: 'bar-done', rx: 2 }, svg('title', {}, document.createTextNode(`${hr}:00 - ${n}`))));
    if (hr % 3 === 0) kids.push(svg('text', { x: 31 + hr * 20, y: H - 5, 'text-anchor': 'middle', class: 'ax' }, document.createTextNode(String(hr))));
  }
  const wrap = h('div', { class: 'chartwrap', role: 'img', 'aria-label': 'Completed trips by hour of the day' });
  wrap.append(svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'hourchart' }, ...kids));
  return wrap;
}

const METHOD_LABEL = { cash: 'Cash', mtn_momo: 'MTN MoMo', airtel_money: 'Airtel Money', wallet: 'Abasare credit', corporate: 'Company account', card: 'Card' };

V.revenue = async (el, state = {}) => {
  const today = kigaliToday(), group = state.group === 'week' ? 'week' : 'day';
  const to = state.to || today, from = state.from || ymdAdd(to, -(Number(state.days) || 7) + 1);
  const qs = `from=${from}&to=${to}&group=${group}`;
  const d = await api('GET', '/admin/revenue?' + qs);
  const t = d.totals, c = d.change_pct, days = d.range.days;
  const days0 = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const range = periodControl({ value: [7, 14, 30, 90].includes(days0) && to === today ? days0 : 7, options: [[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days'], [90, 'Last 90 days']], range: [7, 14, 30, 90].includes(days0) && to === today ? null : { from, to },
    onQuick: (v) => go('revenue', { days: v, group }), onRange: (f, tt) => go('revenue', { from: f, to: tt, group }) });
  const toggle = h('span', { class: 'row' }, ['day', 'week'].map((g) => h('button', { class: 'b ' + (g === group ? '' : 'sec'), onclick: () => go('revenue', { from, to, group: g }) }, g === 'day' ? 'By day' : 'By week')));
  const csv = async () => { try { const text = await api('GET', '/admin/revenue/csv?' + qs); downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), `abasare-revenue-${from}_${to}.csv`); } catch (e) { toast(e.message, true); } };
  const printPdf = async () => {
    try {
      const html = await api('GET', `/admin/revenue/report?${qs}&lang=${typeof curLang === 'string' ? curLang : 'en'}`);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), w = window.open(url, '_blank');
      if (!w) { toast('Allow pop-ups for this page, then try again.', true); return; }
      w.addEventListener('load', () => setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* the user can print from the new tab */ } }, 400));
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) { toast(e.message, true); }
  };
  const spark = (k) => sparkline(d.trend.map((x) => Number(x[k])));
  el.append(h('h1', {}, 'Revenue'),
    h('div', { class: 'row spread' }, h('div', { class: 'muted' }, `Kigali days ${d.range.from} to ${d.range.to}. Compared with the ${d.range.days} days before.`),
      h('span', { class: 'row' }, range, toggle, h('button', { class: 'b sec', onclick: csv }, 'Download CSV'), h('button', { class: 'b', onclick: printPdf }, 'Print / Save as PDF'))),
    note('Revenue is the commission the platform keeps. "Customer spend" is what riders paid for completed trips, most of which goes to drivers.'),
    h('div', { class: 'grid' },
      kpi('Platform revenue (commission)', money(t.commission), { tone: 'ok', delta: c.commission, spark: spark('commission'), hint: `${t.take_rate_pct}% of customer spend` }),
      kpi('Customer spend', money(t.gross), { delta: c.gross, spark: spark('gross') }),
      kpi('Paid to drivers', money(t.driver_net), { delta: c.driver_net }),
      kpi('Completed trips', nfmt(t.completed), { delta: c.completed, spark: spark('trips'), hint: `${t.completion_rate_pct}% of ${nfmt(t.requested)} requests` })),
    h('div', { class: 'grid' },
      kpi('Active drivers', nfmt(t.active_drivers), { delta: c.active_drivers, hint: `${nfmt(d.drivers_online_now)} online now` }), kpi('Active riders', nfmt(t.active_riders), { delta: c.active_riders }),
      kpi('New riders', nfmt(t.new_riders), { delta: c.new_riders }), kpi('Average fare', money(t.avg_fare)),
      kpi('Cash', money(t.cash), { hint: t.gross ? Math.round((t.cash / t.gross) * 100) + '% of customer spend' : '' }), kpi('Mobile money', money(t.mobile_money), { hint: t.gross ? Math.round((t.mobile_money / t.gross) * 100) + '% of customer spend' : '' }),
      kpi('Average rating', t.rating_count ? t.rating_avg + ' / 5' : '-', { hint: `${nfmt(t.rating_count)} ratings`, to: 'ratings' }), kpi('Cancelled or no driver', nfmt(t.cancelled + t.no_driver), { tone: t.requested && (t.cancelled + t.no_driver) / t.requested > 0.2 ? 'warn' : '' })),
    h('h2', {}, group === 'week' ? 'Trend by week' : 'Trend by day'),
    h('div', { class: 'card' }, d.trend.length ? revenueChart(d.trend, group) : h('div', { class: 'muted' }, 'No completed trips in this period.'), h('div', { class: 'muted legend' }, h('span', { class: 'sw req' }), ' customer spend ', h('span', { class: 'sw done' }), ' platform commission. Number under each bar: trips.')),
    table([{ h: group === 'week' ? 'Week starting' : 'Day', k: 'day', cls: 'nowrap' }, { h: 'Trips', k: 'trips', cls: 'num' }, moneyCol('Customer spend', 'gross'), moneyCol('Commission', 'commission'), moneyCol('Paid to drivers', 'driver_net'), { h: 'Drivers', k: 'drivers', cls: 'num' }], d.trend.slice().reverse(), null, 'No completed trips in this period.', { csv: 'revenue-trend' }),
    h('h2', {}, 'By service'),
    table([{ h: 'Service', f: (r) => r.name_en }, { h: 'Trips', k: 'trips', cls: 'num' }, moneyCol('Customer spend', 'gross'), moneyCol('Commission', 'commission')], d.by_service, null, 'Nothing yet.'),
    h('h2', {}, 'By payment method'),
    table([{ h: 'Method', f: (r) => METHOD_LABEL[r.method] || human(r.method) }, { h: 'Trips', k: 'trips', cls: 'num' }, moneyCol('Customer spend', 'gross')], d.by_method, null, 'Nothing yet.'),
    h('h2', {}, 'Busiest hours (Kigali time)'), h('div', { class: 'card' }, busyHours(d.busy_hours)),
    h('h2', {}, 'Top drivers'),
    table([{ h: 'Driver', f: (r) => r.name }, { h: 'Trips', k: 'trips', cls: 'num' }, moneyCol('Customer spend', 'gross'), moneyCol('Commission', 'commission'), moneyCol('Earned', 'driver_net'), { h: 'Rating', f: (r) => (r.rating > 0 ? '★ ' + r.rating.toFixed(2) : '-'), s: (r) => r.rating, cls: 'num' }], d.top_drivers, null, 'Nothing yet.'));
};

V.ratings = async (el) => {
  const d = await api('GET', '/admin/ratings');
  const s = d.summary, max = Math.max(1, ...s.spread.map((x) => x.count));
  const spread = h('div', { class: 'card spread5', role: 'img', 'aria-label': 'Ratings by stars: ' + s.spread.map((x) => `${x.score}★ ${x.count}`).join(', ') },
    s.spread.slice().reverse().map((x) => h('div', { class: 'row', style: 'gap:8px;align-items:center;margin:3px 0' }, h('span', { style: 'width:46px' }, '★ ' + x.score), h('span', { class: 'sbar', style: 'flex:1;background:var(--line);border-radius:6px;height:12px;overflow:hidden' }, h('span', { style: `display:block;height:100%;width:${Math.round((x.count / max) * 100)}%;background:${x.score <= d.low_score ? 'var(--bad, #c0392b)' : 'var(--brand, #0069A8)'}` })), h('span', { class: 'num', style: 'width:48px;text-align:right' }, nfmt(x.count)))));
  const dir = (r) => (r.direction === 'rider_to_driver' ? 'Rider rated the driver' : 'Driver rated the rider');
  el.append(h('h1', {}, 'Ratings'),
    note(`Last ${d.window_days} days. A driver is flagged for a coaching call when the average falls below ${d.flag_avg} after at least ${d.flag_min_count} ratings. A low rating is ${d.low_score} stars or fewer. Change these limits in Settings.`),
    h('div', { class: 'grid' }, kpi('Average rating of drivers', s.count ? s.avg + ' / 5' : '-', { tone: s.avg && s.avg < d.flag_avg ? 'warn' : 'ok' }), kpi('Ratings given', nfmt(s.count)), kpi('Low ratings', nfmt(s.low_count), { tone: s.low_count ? 'warn' : '' }), kpi('Drivers to coach', nfmt(d.flagged.length), { tone: d.flagged.length ? 'bad' : 'ok' })),
    h('h2', {}, 'How riders rate drivers'), spread,
    h('h2', {}, 'Drivers to coach'),
    table([{ h: 'Driver', f: (r) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('drivers', { status: '', q: r.name }); } }, r.name), s: (r) => r.name, csv: (r) => r.name }, { h: 'Average', f: (r) => '★ ' + r.avg.toFixed(2), s: (r) => r.avg, csv: (r) => r.avg, cls: 'num' }, { h: 'Ratings', k: 'n', cls: 'num' }, { h: 'Low ratings', k: 'low_count', cls: 'num' }, dateCol('Latest low rating', 'last_low_at')], d.flagged, null, 'No driver is below the limit. Good.', { csv: 'drivers-to-coach' }),
    h('h2', {}, 'Recent low ratings'),
    table([dateCol('When', 'created_at'), { h: 'Stars', f: (r) => '★ ' + r.score, s: (r) => r.score, csv: (r) => r.score, cls: 'num' }, { h: 'Who rated whom', f: (r) => `${r.reviewer || 'Rider'} → ${r.reviewee}`, s: (r) => r.reviewee }, { h: 'Direction', f: dir, s: dir, csv: dir },
      { h: 'Comment', f: (r) => r.comment || '-', csv: (r) => r.comment || '' }, { h: 'Reasons', f: (r) => (r.tags || []).map(human).join(', ') || '-', csv: (r) => (r.tags || []).join(' ') },
      { h: 'Trip', f: (r) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('bookings', { q: r.booking_ref }); } }, r.booking_ref), s: (r) => r.booking_ref, csv: (r) => r.booking_ref }], d.recent, null, 'No low ratings in this period.', { csv: 'low-ratings' }));
};

V.demo = async (el) => {
  const s = await api('GET', '/admin/demo');
  const status = s.loaded
    ? note(`Demo data is loaded: ${nfmt(s.drivers)} drivers, ${nfmt(s.riders)} riders, ${nfmt(s.trips)} trips. Demo drivers that are online move on the Live map.`)
    : note('No demo data is loaded. This is the normal state for a live service.');
  const load = async () => {
    const v = await ask('Load demo data', { confirmText: 'Load', message: 'Creates a week of believable activity: drivers, riders, trips, payments, earnings and ratings. Anything loaded earlier is replaced. It does not touch real records.',
      fields: [{ name: 'drivers', label: 'Drivers', type: 'number', integer: true, min: 5, max: 150, value: 40 }, { name: 'riders', label: 'Riders', type: 'number', integer: true, min: 10, max: 500, value: 90 }, { name: 'days', label: 'Days of history', type: 'number', integer: true, min: 1, max: 31, value: 14 }] });
    if (!v) return;
    await act(async () => { const r = await api('POST', '/admin/demo/load', { drivers: Number(v.drivers), riders: Number(v.riders), days: Number(v.days) }); toast(`Loaded ${r.trips} trips from ${r.drivers} drivers.`); }, () => go('demo'));
  };
  const clear = async () => {
    const v = await ask('Remove demo data', { confirmText: 'Remove', danger: true, message: 'Deletes every demo driver, rider, trip, payment and rating. Real records are not touched.' });
    if (!v) return;
    await act(async () => { await api('POST', '/admin/demo/clear'); }, () => go('demo'));
  };
  el.append(h('h1', {}, 'Demo data'), status,
    h('div', { class: 'row' }, h('button', { class: 'b', onclick: load }, s.loaded ? 'Reload demo data' : 'Load demo data'), s.loaded ? h('button', { class: 'b danger', onclick: clear }, 'Remove demo data') : null),
    h('h2', {}, 'Signing in as a demo person'),
    h('div', { class: 'card' }, h('p', {}, 'In the app, sign in with these phone numbers and the code sent by SMS (the code appears on screen while the test code option is on):'),
      h('ul', { class: 'plain' }, h('li', {}, `Rider ${s.sample_rider_phone} (has many completed trips and receipts)`), h('li', {}, `Driver ${s.sample_driver_phone} (has a week of earnings and a weekly statement)`))),
    h('h2', {}, 'Before the meeting'),
    h('div', { class: 'card' }, h('ol', {}, h('li', {}, 'Open the service address once so the server is awake.'), h('li', {}, 'Load demo data here, then open Revenue, Ratings and Live map to check them.'), h('li', {}, 'Follow the 5-minute demo script in the project documents (docs/DEMO_SCRIPT.md).'), h('li', {}, 'Afterwards, remove the demo data.'))));
};

'use strict';
// Growth views: fixed-price routes, driver quests, campaigns, demand map. Registered in app.js (TABS) and index.html. Seeded routes and quests are PLACEHOLDERS (flagged in the tables).

const placeholderPill = (r) => (r.placeholder ? pill('PLACEHOLDER', 'warn') : null);
const tierPill = (on) => pill(on ? 'active' : 'inactive', on ? 'ok' : '');

// =============================================================== FIXED-PRICE ROUTES
V.fixedroutes = async (el) => {
  const d = await api('GET', '/admin/fixed-routes'), manage = can('pricing.manage'), approve = can('pricing.approve');
  const propose = async (r, body, okMsg) => act(() => api('PATCH', '/admin/fixed-routes/' + r.id, body), () => go('fixedroutes'));
  el.append(h('h1', {}, 'Fixed-price routes'),
    note('Airport and intercity trips at one agreed price. A price change or switching a route on needs a second person to approve (maker-checker). Routes marked PLACEHOLDER carry example prices and are OFF until a real price is approved.'),
    table([
      { h: 'Route', f: (r) => h('span', {}, r.name_en, ' ', placeholderPill(r)), s: (r) => r.name_en },
      { h: 'Names rw / fr', f: (r) => `${r.name_rw} / ${r.name_fr}`, csv: (r) => `${r.name_rw} / ${r.name_fr}` },
      { h: 'Service', f: (r) => svcLabel(r.service_id), s: (r) => r.service_id },
      moneyCol('Price (before tax)', 'price'),
      { h: 'Radius (m)', f: (r) => `${r.from_radius_m} / ${r.to_radius_m}`, cls: 'num' },
      { h: 'Both ways', f: (r) => (r.bidirectional ? 'yes' : 'no') },
      { h: 'Status', f: (r) => h('span', {}, tierPill(r.active), r.pending ? [' ', pill('waiting for approval', 'warn')] : null), s: (r) => (r.active ? 0 : 1) },
      { h: 'Waiting', f: (r) => (r.pending ? [r.pending.price != null ? 'price ' + nfmt(r.pending.price) : null, r.pending.active ? 'switch on' : null].filter(Boolean).join(', ') : '-') },
      { h: '', f: (r) => h('span', { class: 'row' },
        manage && h('button', { class: 'b sec', onclick: async () => { const v = await ask('Propose a price for ' + r.name_en, { fields: [{ name: 'price', label: 'Price in RWF (before tax)', type: 'number', integer: true, min: 1, required: true, value: r.price }] }); if (v) await propose(r, { price_rwf: v.price }); } }, 'Set price'),
        manage && !r.active && h('button', { class: 'b sec', onclick: () => propose(r, { active: true }) }, 'Propose switch on'),
        manage && r.active && h('button', { class: 'b sec', onclick: () => propose(r, { active: false }) }, 'Switch off'),
        approve && r.pending && h('button', { class: 'b', onclick: async () => {
          const needsConfirm = r.placeholder && r.pending.active && r.pending.price == null;
          const v = await ask('Approve the change to ' + r.name_en, { confirmText: 'Approve', message: needsConfirm ? 'This route still has an example (placeholder) price of ' + money(r.price) + '. Approving switches it on at that price.' : 'Apply the waiting change.' });
          if (v) await act(() => api('POST', `/admin/fixed-routes/${r.id}/approve`, { confirm_placeholder_price: needsConfirm }), () => go('fixedroutes')); } }, 'Approve'),
        approve && r.pending && h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/fixed-routes/${r.id}/reject`), () => go('fixedroutes')) }, 'Reject')) },
    ], d.routes, null, 'No fixed-price routes yet.', { csv: 'fixed-routes' }),
    manage && h('div', { class: 'row' }, h('button', { class: 'b', onclick: async () => {
      const v = await ask('New fixed-price route', { confirmText: 'Create (switched off)', fields: [
        { name: 'name_en', label: 'Name (English)', required: true, maxlength: 120 }, { name: 'name_rw', label: 'Izina (Kinyarwanda)', required: true, maxlength: 120 }, { name: 'name_fr', label: 'Nom (français)', required: true, maxlength: 120 },
        { name: 'flat', label: 'From latitude', type: 'number', required: true, min: -90, max: 90 }, { name: 'flng', label: 'From longitude', type: 'number', required: true, min: -180, max: 180 }, { name: 'fr', label: 'From radius (m)', type: 'number', integer: true, min: 100, max: 50000, value: 1500, required: true },
        { name: 'tlat', label: 'To latitude', type: 'number', required: true, min: -90, max: 90 }, { name: 'tlng', label: 'To longitude', type: 'number', required: true, min: -180, max: 180 }, { name: 'tr', label: 'To radius (m)', type: 'number', integer: true, min: 100, max: 50000, value: 1500, required: true },
        { name: 'service', label: 'Service', type: 'select', options: Object.keys(CAT.services).length ? Object.keys(CAT.services).filter((k) => !k.startsWith('abasare')) : ['standard'], value: 'standard' },
        { name: 'price', label: 'Price in RWF (before tax)', type: 'number', integer: true, min: 1, required: true }] });
      if (v) await act(() => api('POST', '/admin/fixed-routes', { name_en: v.name_en, name_rw: v.name_rw, name_fr: v.name_fr, from: { lat: v.flat, lng: v.flng, radius_m: v.fr }, to: { lat: v.tlat, lng: v.tlng, radius_m: v.tr }, service_id: v.service, price_rwf: v.price }), () => go('fixedroutes')); } }, 'New route')));
};

// =============================================================== DRIVER QUESTS
V.quests = async (el) => {
  const d = await api('GET', '/admin/quests');
  const fields = (q = {}) => [
    { name: 'title_en', label: 'Title (English)', required: true, maxlength: 100, value: q.title_en }, { name: 'title_rw', label: 'Umutwe (Kinyarwanda)', required: true, maxlength: 100, value: q.title_rw }, { name: 'title_fr', label: 'Titre (français)', required: true, maxlength: 100, value: q.title_fr },
    { name: 'kind', label: 'Kind', type: 'select', options: ['trips', 'earnings', 'streak', 'peak_hours'], value: q.kind || 'trips' }, { name: 'window', label: 'Window (streak needs weekly)', type: 'select', options: ['daily', 'weekly'], value: q.window || 'daily' },
    { name: 'target', label: 'Target (trips, RWF or days)', type: 'number', integer: true, min: 1, required: true, value: q.target }, { name: 'reward', label: 'Reward in RWF', type: 'number', integer: true, min: 1, max: 1000000, required: true, value: q.reward },
    { name: 'budget_cap', label: 'Total budget in RWF (empty = none)', type: 'number', integer: true, min: 0, value: q.budget_cap }];
  const body = (v) => ({ title_en: v.title_en, title_rw: v.title_rw, title_fr: v.title_fr, kind: v.kind, window: v.window, target: v.target, reward: v.reward, budget_cap: v.budget_cap ?? null });
  el.append(h('h1', {}, 'Driver quests and bonuses'),
    note('A bonus is credited to the driver wallet through the ledger, once per quest and period, until the budget runs out. Seeded quests are PLACEHOLDERS (reward amounts are examples) and start switched off.'),
    table([
      { h: 'Quest', f: (q) => h('span', {}, q.title_en, ' ', placeholderPill(q)), s: (q) => q.title_en }, { h: 'Kind', f: (q) => human(q.kind) + ' / ' + q.window },
      { h: 'Target', k: 'target', cls: 'num' }, moneyCol('Reward', 'reward'), { h: 'Winners', k: 'awards', cls: 'num' },
      { h: 'Budget used', f: (q) => (q.budget_cap == null ? money(q.spent) + ' (no cap)' : `${money(q.spent)} of ${money(q.budget_cap)}`), s: (q) => q.spent, csv: (q) => q.spent },
      { h: 'Status', f: (q) => tierPill(q.active), s: (q) => (q.active ? 0 : 1) },
      { h: '', f: (q) => h('span', { class: 'row' },
        h('button', { class: 'b sec', onclick: () => act(() => api('PATCH', '/admin/quests/' + q.id, { active: !q.active, placeholder: q.active ? undefined : false }), () => go('quests')) }, q.active ? 'Switch off' : 'Switch on'),
        h('button', { class: 'b sec', onclick: async () => { const v = await ask('Edit quest', { fields: fields(q) }); if (v) await act(() => api('PATCH', '/admin/quests/' + q.id, { ...body(v), placeholder: false }), () => go('quests')); } }, 'Edit')) },
    ], d.quests, null, 'No quests yet.', { csv: 'quests' }),
    can('growth.manage') && h('div', { class: 'row' }, h('button', { class: 'b', onclick: async () => { const v = await ask('New quest (starts switched off)', { fields: fields() }); if (v) await act(() => api('POST', '/admin/quests', body(v)), () => go('quests')); } }, 'New quest')));
};

// =============================================================== CAMPAIGNS
const CAMPAIGN_LANGS = [['rw', 'Kinyarwanda'], ['fr', 'Français'], ['en', 'English']];
const CAMPAIGN_SEGMENTS = [['all_passengers', 'All passengers'], ['all_drivers', 'All drivers'], ['inactive_passengers', 'Inactive passengers'], ['corporate_members', 'Corporate members'], ['zone', 'Zone'], ['language', 'By language'], ['phone_list', 'Phone list'], ['abasare_owners', 'Abasare car owners']];
V.campaigns = async (el, state = {}) => {
  if (state.id) return campaignEditor(el, state.id);
  const d = await api('GET', '/admin/campaigns');
  el.append(h('h1', {}, 'Campaigns'),
    note('Messages go only to people who accepted marketing, only between 07:00 and 21:00 Kigali time, one per person per day, each in their OWN language. All three languages are required. SMS and push delivery is SIMULATED until the providers are connected.'),
    table([{ h: 'Name', k: 'name' }, { h: 'Channel', f: (c) => c.channel }, { h: 'Audience', f: (c) => human(c.segment.type) }, { h: 'Status', f: (c) => pill(c.status) , s: (c) => c.status },
      { h: 'Scheduled', f: (c) => (c.scheduled_at ? when(c.scheduled_at) : '-'), s: (c) => (c.scheduled_at ? Date.parse(c.scheduled_at) : 0) }, { h: 'Sent', f: (c) => c.stats.sent ?? '-', cls: 'num' }, { h: 'Without consent', f: (c) => c.stats.skipped_no_consent ?? '-', cls: 'num' }],
      d.campaigns, (c) => go('campaigns', { id: c.id }), 'No campaigns yet.', { csv: 'campaigns' }),
    h('div', { class: 'row' }, h('button', { class: 'b', onclick: async () => { const r = await api('POST', '/admin/campaigns', blankCampaign()); go('campaigns', { id: r.id }); } }, 'New campaign')));
};
const blankCampaign = () => ({ name: 'New campaign', channel: 'inapp', segment: { type: 'all_passengers' }, title_rw: 'Umutwe', title_fr: 'Titre', title_en: 'Title', msg_rw: 'Ubutumwa', msg_fr: 'Message', msg_en: 'Message' });

async function campaignEditor(el, id) {
  const c = await api('GET', '/admin/campaigns/' + id), draft = c.status === 'draft';
  const f = { name: h('input', { value: c.name, maxlength: 120, disabled: !draft, 'aria-label': 'Campaign name' }),
    channel: h('select', { disabled: !draft, 'aria-label': 'Channel' }, ['sms', 'push', 'inapp'].map((x) => h('option', { value: x, selected: x === c.channel }, x))),
    seg: h('select', { disabled: !draft, 'aria-label': 'Audience' }, CAMPAIGN_SEGMENTS.map(([k, l]) => h('option', { value: k, selected: k === c.segment.type }, l))),
    arg: h('input', { disabled: !draft, 'aria-label': 'Audience detail', placeholder: 'days / zone id / language / phones, comma separated', value: segArg(c.segment) }) };
  const msgs = {}; for (const [l] of CAMPAIGN_LANGS) msgs[l] = { title: h('input', { value: c['title_' + l], maxlength: 80, disabled: !draft, 'aria-label': 'Title ' + l }), body: h('textarea', { rows: 3, maxlength: 500, disabled: !draft, 'aria-label': 'Message ' + l, style: 'width:100%' }, c['msg_' + l]) };
  const preview = h('div', { class: 'card' }), count = h('div', { class: 'muted' });
  const segment = () => { const a = f.arg.value.trim(), t = f.seg.value;
    return t === 'inactive_passengers' ? { type: t, days: Number(a) || 30 } : t === 'zone' ? { type: t, zone_id: a || 'kigali', role: 'passenger' } : t === 'language' ? { type: t, lang: a || 'rw' } : t === 'phone_list' ? { type: t, phones: a.split(',').map((x) => x.trim()).filter(Boolean) } : { type: t }; };
  const payload = () => ({ name: f.name.value.trim(), channel: f.channel.value, segment: segment(), ...Object.fromEntries(CAMPAIGN_LANGS.flatMap(([l]) => [['title_' + l, msgs[l].title.value.trim()], ['msg_' + l, msgs[l].body.value.trim()]])) });
  const drawPreview = () => preview.replaceChildren(h('h2', {}, 'What each person receives'), h('p', { class: 'muted' }, 'Everyone gets only the text of their own language.'),
    ...CAMPAIGN_LANGS.map(([l, name]) => h('div', { class: 'card' }, h('b', {}, name), h('div', {}, msgs[l].title.value || '(no title)'), h('div', { class: 'muted' }, msgs[l].body.value || '(empty)'), f.channel.value === 'sms' ? h('small', {}, `${msgs[l].body.value.length}/320 characters`) : null)));
  for (const [l] of CAMPAIGN_LANGS) { msgs[l].title.addEventListener('input', drawPreview); msgs[l].body.addEventListener('input', drawPreview); }
  const doCount = () => act(async () => { const r = await api('POST', '/admin/campaigns/preview', { channel: f.channel.value, segment: segment() }); count.textContent = `${nfmt(r.matched)} people match, ${nfmt(r.eligible)} can be messaged (${nfmt(r.skipped_no_consent)} have not accepted marketing). Rw ${r.by_language.rw}, Fr ${r.by_language.fr}, En ${r.by_language.en}.`; });
  const testLang = h('select', { 'aria-label': 'Test language' }, CAMPAIGN_LANGS.map(([l, n]) => h('option', { value: l }, n)));
  el.append(h('h1', {}, c.name), h('p', {}, pill(c.status), ' ', c.scheduled_at ? 'scheduled ' + when(c.scheduled_at) : ''),
    h('div', { class: 'card' }, h('div', { class: 'fgrid' }, h('label', { class: 'field' }, 'Name', f.name), h('label', { class: 'field' }, 'Channel', f.channel), h('label', { class: 'field' }, 'Audience', f.seg), h('label', { class: 'field' }, 'Detail', f.arg)),
      CAMPAIGN_LANGS.map(([l, n]) => h('div', {}, h('h3', {}, n), msgs[l].title, msgs[l].body)),
      h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: doCount }, 'Count recipients'), count)),
    preview,
    h('div', { class: 'row' }, h('button', { class: 'b sec', onclick: () => go('campaigns', {}) }, 'Back'),
      draft && h('button', { class: 'b', onclick: () => act(() => api('PATCH', '/admin/campaigns/' + id, payload()), () => go('campaigns', { id })) }, 'Save draft'),
      testLang, h('button', { class: 'b sec', onclick: () => act(() => api('POST', `/admin/campaigns/${id}/test-send`, { lang: testLang.value })) }, 'Send test to me'),
      draft && h('button', { class: 'b', onclick: async () => { const v = await ask('Send this campaign', { confirmText: 'Schedule', message: 'Only people who accepted marketing receive it, outside 21:00-07:00 Kigali time. Leave the date empty to send as soon as allowed.', fields: [{ name: 'at', label: 'Send at, Kigali time (e.g. 2026-10-20T09:00), empty = as soon as allowed', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$', patternMsg: 'Use the format 2026-10-20T09:00' }] }); if (v) await act(async () => { await api('PATCH', '/admin/campaigns/' + id, payload()); await api('POST', `/admin/campaigns/${id}/schedule`, v.at ? { scheduled_at: new Date(v.at + '+02:00').toISOString() } : {}); }, () => go('campaigns', { id })); } }, 'Schedule'),
      ['draft', 'scheduled', 'sending'].includes(c.status) && h('button', { class: 'b red', onclick: () => act(() => api('POST', `/admin/campaigns/${id}/cancel`), () => go('campaigns', { id })) }, 'Cancel campaign')),
    c.status !== 'draft' ? h('div', { class: 'card' }, h('h2', {}, 'Result'), h('pre', {}, JSON.stringify({ recipients: c.recipients, by_language: c.by_language, stats: c.stats }, null, 2))) : null);
  drawPreview();
}
const segArg = (s) => (s.type === 'inactive_passengers' ? String(s.days) : s.type === 'zone' ? s.zone_id : s.type === 'language' ? s.lang : s.type === 'phone_list' ? s.phones.join(', ') : '');

// =============================================================== DEMAND MAP
V.demand = async (el) => {
  const d = await api('GET', '/admin/heatmap');
  const bar = (v) => h('span', { class: 'bar', style: `display:inline-block;height:10px;width:${Math.round(v * 100)}px;background:currentColor;opacity:${0.25 + v * 0.75}` });
  const section = (key, title) => [h('h2', {}, title), table([{ h: 'Cell centre', f: (c) => `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`, csv: (c) => `${c.lat},${c.lng}` }, { h: 'Intensity', f: (c) => h('span', {}, bar(c.intensity), ' ', c.intensity), s: (c) => c.intensity },
    { h: 'Requests', k: 'requests', cls: 'num' }, { h: 'Unmatched', k: 'unmatched', cls: 'num' }, { h: 'Hint', f: (c) => human(String(c.hint).replace('heat.', '')) }], d.windows[key].cells, null, 'No area has enough requests to be shown.', { csv: 'demand-' + key })];
  el.append(h('h1', {}, 'Demand map'), note(`Requests per ${d.cell_size_m} m cell. Areas with fewer than ${d.k_min} different requesters are hidden so no individual can be located. Refreshed about every minute.`),
    ...section('now', 'Now (last 15 minutes)'), ...section('last_hour', 'Last hour'), ...section('same_hour_last_week', 'Same hour last week'));
};

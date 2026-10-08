'use strict';
// Configuration editors that used to live in code: places and zones (coverage), help centre, driver document rules, support deadlines,
// notification wording and feature flags. The API validates everything again and writes the audit entries.

// ------------------------------------------------------------------ small shared pieces
/** Leaflet map inside a dialog. onClick(lat, lng) is called for every click; returns { map, el }. */
function pickMap(center, zoom, onClick) {
  const el = h('div', { class: 'mappick', role: 'application', 'aria-label': 'Map. Click to choose a point.' });
  const map = L.map(el).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  map.on('click', (e) => onClick(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)));
  setTimeout(() => map.invalidateSize(), 150); setTimeout(() => map.invalidateSize(), 600);
  return { map, el };
}
const KIGALI = [-1.9536, 30.0927];
const numOrNull = (v) => { const n = Number(String(v).trim()); return String(v).trim() !== '' && Number.isFinite(n) ? n : null; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

V.places = async (el, state = {}) => {
  const tabs = [can('places.manage') && ['places', 'Places and landmarks'], can('zones.manage') && ['zones', 'Zones (coverage)']].filter(Boolean);
  const sub = tabs.some((t) => t[0] === state.sub) ? state.sub : tabs[0][0];
  el.append(h('h1', {}, 'Places and zones'), subnav('places', tabs, sub));
  return sub === 'zones' ? zonesView(el) : placesView(el, state);
};

// ------------------------------------------------------------------ places
async function placesView(el, state) {
  const search = state.q || '', active = state.active || 'all', pickup = state.pickup || 'all';
  const d = await api('GET', `/admin/places?limit=500&active=${active}&pickup=${pickup}` + (search ? '&q=' + encodeURIComponent(search) : ''));
  const q = h('input', { type: 'search', placeholder: 'Search any language', 'aria-label': 'Search places', value: search });
  const as = h('select', { 'aria-label': 'Active filter' }, [['all', 'Active and disabled'], ['yes', 'Active only'], ['no', 'Disabled only']].map(([v, l]) => h('option', { value: v, selected: v === active }, l)));
  const ps = h('select', { 'aria-label': 'Pickup filter' }, [['all', 'Any place'], ['yes', 'Pickup points only'], ['no', 'Not pickup points']].map(([v, l]) => h('option', { value: v, selected: v === pickup }, l)));
  const apply = () => go('places', { sub: 'places', q: q.value.trim(), active: as.value, pickup: ps.value });
  el.append(note('Landmarks and pickup points customers search and choose in the app. Disabling a place hides it from customers without deleting it. Names are shown in the customer\'s own language; add Kinyarwanda and French so nobody sees a mix.'),
    filterBar(q, as, ps, h('button', { type: 'submit', class: 'b', onclick: apply }, 'Filter'), h('span', { class: 'grow' }),
      h('button', { class: 'b sec', onclick: () => importPlacesDialog() }, 'Import CSV'), h('button', { class: 'b', onclick: () => placeDialog(null, d.kinds) }, 'Add place')),
    limitNote(d.places.length, 500, 'places'),
    table([{ h: 'Name (English)', k: 'name_en' }, { h: 'Kinyarwanda', f: (p) => p.name_rw || h('span', { class: 'muted' }, 'missing'), s: (p) => p.name_rw || '' }, { h: 'French', f: (p) => p.name_fr || h('span', { class: 'muted' }, 'missing'), s: (p) => p.name_fr || '' },
      { h: 'Kind', f: (p) => human(p.kind), s: (p) => p.kind }, { h: 'Pickup point', f: (p) => (p.designated_pickup ? pill('pickup', 'info') : ''), s: (p) => (p.designated_pickup ? 1 : 0), csv: (p) => (p.designated_pickup ? 'yes' : 'no') },
      { h: 'Status', f: (p) => pill(p.active ? 'active' : 'disabled', p.active ? 'ok' : 'warn'), s: (p) => (p.active ? 1 : 0), csv: (p) => (p.active ? 'active' : 'disabled') },
      { h: 'Location', f: (p) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`, csv: (p) => `${p.lat},${p.lng}`, cls: 'nowrap' }, { h: 'Zone', f: (p) => (p.zone_id ? zoneLabel(p.zone_id) : h('span', { class: 'muted' }, 'outside')), s: (p) => p.zone_id || '' },
      { h: '', f: (p) => h('span', { class: 'row' }, h('button', { class: 'b sec', onclick: () => placeDialog(p, d.kinds) }, 'Edit'),
        h('button', { class: 'b sec', onclick: () => act(() => api('PATCH', '/admin/places/' + p.id, { active: !p.active }), () => go('places')) }, p.active ? 'Disable' : 'Enable')) }],
      d.places, (p) => placeDialog(p, d.kinds), 'No places match.', { csv: 'places' }));
}

function placeDialog(p, kinds) {
  const f = {
    en: h('input', { value: p?.name_en || '', maxlength: 100, 'aria-label': 'Name in English', style: 'width:100%' }), rw: h('input', { value: p?.name_rw || '', maxlength: 100, 'aria-label': 'Name in Kinyarwanda', style: 'width:100%' }),
    fr: h('input', { value: p?.name_fr || '', maxlength: 100, 'aria-label': 'Name in French', style: 'width:100%' }),
    kind: h('select', { 'aria-label': 'Kind' }, kinds.map((k) => h('option', { value: k, selected: k === (p?.kind || 'landmark') }, human(k)))),
    pick: h('input', { type: 'checkbox', checked: !!p?.designated_pickup, 'aria-label': 'Pickup point' }),
    act: h('input', { type: 'checkbox', checked: p ? p.active : true, 'aria-label': 'Active' }),
    lat: h('input', { value: p ? p.lat : '', inputmode: 'decimal', placeholder: 'Latitude, e.g. -1.9441', 'aria-label': 'Latitude' }), lng: h('input', { value: p ? p.lng : '', inputmode: 'decimal', placeholder: 'Longitude, e.g. 30.0619', 'aria-label': 'Longitude' }),
  };
  const err = h('div', { class: 'ferr', role: 'alert' });
  let marker; const mp = pickMap(p ? [p.lat, p.lng] : KIGALI, p ? 15 : 12, (la, ln) => { f.lat.value = la; f.lng.value = ln; place(); });
  const place = () => { const la = numOrNull(f.lat.value), ln = numOrNull(f.lng.value); if (la == null || ln == null) return; if (!marker) marker = L.marker([la, ln], { draggable: true }).addTo(mp.map).on('dragend', (e) => { const c = e.target.getLatLng(); f.lat.value = +c.lat.toFixed(6); f.lng.value = +c.lng.toFixed(6); }); else marker.setLatLng([la, ln]); };
  f.lat.addEventListener('change', place); f.lng.addEventListener('change', place); if (p) place();
  let dlg;
  const save = async () => {
    err.textContent = '';
    const la = numOrNull(f.lat.value), ln = numOrNull(f.lng.value);
    if (f.en.value.trim().length < 2) { err.textContent = 'Give the place a name in English.'; f.en.focus(); return; }
    if (la == null || ln == null) { err.textContent = 'Click the map or type a latitude and longitude.'; return; }
    if (la < -3.2 || la > -0.7 || ln < 28.5 || ln > 31.3) { err.textContent = 'These coordinates are outside Rwanda. Latitude is about -1.9 and longitude about 30.1: check they are not swapped.'; return; }
    const body = { name_en: f.en.value.trim(), name_rw: f.rw.value.trim() || null, name_fr: f.fr.value.trim() || null, kind: f.kind.value, lat: la, lng: ln, designated_pickup: f.pick.checked, active: f.act.checked };
    try { const r = await api(p ? 'PATCH' : 'POST', p ? '/admin/places/' + p.id : '/admin/places', body); toast(r.warning || 'Place saved', !!r.warning); dlg.close(); go('places'); } catch (e) { err.textContent = e.message; }
  };
  dlg = openDialog(p ? 'Edit ' + p.name_en : 'Add a place', h('div', {},
    h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Name in English *'), f.en), h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Name in Kinyarwanda'), f.rw), h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Name in French'), f.fr),
    h('div', { class: 'row' }, h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Kind'), f.kind), h('label', { class: 'switch' }, f.pick, h('span', {}, 'Designated pickup point')), h('label', { class: 'switch' }, f.act, h('span', {}, 'Active (visible to customers)'))),
    h('p', { class: 'hint' }, 'Click the map to place the pin (drag it to adjust), or type the coordinates.'), mp.el, h('div', { class: 'coordrow' }, f.lat, f.lng), err,
    h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'b', onclick: save }, 'Save place'))), { width: 720, key: 'place' });
}

function importPlacesDialog() {
  const ta = h('textarea', { rows: 8, 'aria-label': 'CSV text', placeholder: 'name_en,name_rw,name_fr,kind,lat,lng,designated_pickup\nExample Market,Isoko,Marché,market,-1.95,30.06,yes', style: 'width:100%;font-family:monospace' });
  const file = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', 'aria-label': 'CSV file' });
  const out = h('div', { 'aria-live': 'polite' }); let dlg;
  file.addEventListener('change', () => { const f = file.files[0]; if (!f) return; if (f.size > 300000) { out.replaceChildren(h('div', { class: 'alert bad' }, 'The file is larger than 300 KB.')); return; } const r = new FileReader(); r.onload = () => { ta.value = String(r.result); }; r.readAsText(f); });
  const run = async (dry) => {
    if (!ta.value.trim()) { out.replaceChildren(h('div', { class: 'alert bad' }, 'Choose a file or paste the CSV text first.')); return; }
    try {
      const r = await api('POST', '/admin/places/import', { csv: ta.value, dry_run: dry });
      if (r.error_count) out.replaceChildren(h('div', { class: 'alert bad' }, h('b', {}, `${r.error_count} problem${r.error_count === 1 ? '' : 's'}. Nothing was imported. Fix the file and try again.`), h('ul', {}, r.errors.map((e) => h('li', {}, `Row ${e.row}: ${e.message}`)))));
      else if (dry) out.replaceChildren(h('div', { class: 'alert ok' }, `${r.valid} place${r.valid === 1 ? '' : 's'} look good. Press Import to save them.`));
      else { toast(`${r.created} places imported`); dlg.close(); go('places'); }
    } catch (e) { out.replaceChildren(h('div', { class: 'alert bad' }, e.message)); }
  };
  dlg = openDialog('Import places from CSV', h('div', {},
    h('p', {}, 'Columns: ', h('code', {}, 'name_en, name_rw, name_fr, kind, lat, lng, designated_pickup'), '. Only name_en, lat and lng are required. Coordinates must be in Rwanda. Either every row is imported or none.'),
    h('div', { class: 'row' }, h('button', { class: 'b sec sm', onclick: () => downloadCsv('places-template', ['name_en', 'name_rw', 'name_fr', 'kind', 'lat', 'lng', 'designated_pickup'], [['Example Market', 'Isoko', 'Marché', 'market', '-1.95', '30.06', 'yes']]) }, 'Download a template'), file), ta, out,
    h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'b sec', onclick: () => run(true) }, 'Check the file'), h('button', { class: 'b', onclick: () => run(false) }, 'Import'))), { width: 720, key: 'place-import' });
}

// ------------------------------------------------------------------ zones
async function zonesView(el) {
  const d = await api('GET', '/admin/zones');
  el.append(note('A zone is an area where Abasare operates. Customers can only book when the pickup lies inside an active zone. Draw it by centre and radius, or by clicking its corners. Which services run in a zone is set on the Services page. A zone cannot be deleted, only disabled, and the last active zone can never be disabled.'),
    h('div', { class: 'row' }, h('button', { class: 'b', onclick: () => zoneDialog(null) }, 'Add zone')),
    table([{ h: 'Zone', f: (z) => h('div', {}, h('b', {}, z.name), h('div', { class: 'muted mono' }, z.id)), s: (z) => z.name }, { h: 'Shape', f: (z) => (z.shape === 'circle' ? `Circle, ${nfmt(Math.round(z.config.radius_m))} m radius` : `Outline, ${z.polygon.length - 1} corners`), s: (z) => z.shape },
      { h: 'Area', f: (z) => nfmt(z.area_km2) + ' km²', s: (z) => z.area_km2, cls: 'num' }, { h: 'Services on', k: 'services_enabled', cls: 'num' }, { h: 'Places', k: 'places', cls: 'num' },
      { h: 'Status', f: (z) => pill(z.active ? 'active' : 'disabled', z.active ? 'ok' : 'warn'), s: (z) => (z.active ? 1 : 0) },
      { h: '', f: (z) => h('span', { class: 'row' }, h('button', { class: 'b sec', onclick: () => zoneDialog(z) }, 'Edit'),
        h('button', { class: 'b ' + (z.active ? 'red' : 'sec'), onclick: async () => { const a = await ask((z.active ? 'Disable ' : 'Enable ') + z.name + '?', { reason: true, danger: z.active, confirmText: z.active ? 'Disable' : 'Enable', message: z.active ? 'Customers can no longer book pickups inside this zone. Trips already open must finish first.' : 'Customers can book pickups inside this zone again.' }); if (a) act(() => api('POST', `/admin/zones/${z.id}/active`, { active: !z.active, reason: a.reason }), () => go('places', { sub: 'zones' })); } }, z.active ? 'Disable' : 'Enable')) }],
      d.zones, (z) => zoneDialog(z), 'No zones.', { sort: true }));
}

function zoneDialog(z) {
  const creating = !z;
  const name = h('input', { value: z?.name || '', maxlength: 60, 'aria-label': 'Zone name', style: 'width:100%' });
  const idEl = h('input', { value: z?.id || '', disabled: !creating, maxlength: 30, 'aria-label': 'Zone id', placeholder: 'short-id, e.g. huye', style: 'width:100%' });
  if (creating) name.addEventListener('input', () => { if (!idEl.dataset.touched) idEl.value = slug(name.value); }); idEl.addEventListener('input', () => { idEl.dataset.touched = '1'; });
  const shape = h('select', { 'aria-label': 'Shape' }, [['circle', 'Circle: centre and radius'], ['polygon', 'Outline: click the corners']].map(([v, l]) => h('option', { value: v, selected: v === (z?.shape || 'circle') }, l)));
  const cLat = h('input', { value: z?.config?.center ? z.config.center[1] : '', inputmode: 'decimal', placeholder: 'Centre latitude', 'aria-label': 'Centre latitude' }), cLng = h('input', { value: z?.config?.center ? z.config.center[0] : '', inputmode: 'decimal', placeholder: 'Centre longitude', 'aria-label': 'Centre longitude' });
  const rad = h('input', { value: z?.config?.radius_m || 3000, inputmode: 'numeric', placeholder: 'Radius in metres', 'aria-label': 'Radius in metres' });
  const initPts = z && z.shape !== 'circle' ? z.polygon.slice(0, -1).map(([lng, lat]) => `${lat}, ${lng}`).join('\n') : '';
  const pts = h('textarea', { rows: 6, 'aria-label': 'Corners, one per line as latitude, longitude', placeholder: 'One corner per line: latitude, longitude\n-1.95, 30.05', style: 'width:100%;font-family:monospace' }); pts.value = initPts;
  const activeEl = h('input', { type: 'checkbox', checked: z ? z.active : true, 'aria-label': 'Active' });
  const err = h('div', { class: 'ferr', role: 'alert' }), circleBox = h('div', {}, h('div', { class: 'coordrow' }, cLat, cLng, rad)), polyBox = h('div', {}, pts, h('div', { class: 'row' }, h('button', { class: 'b sec sm', onclick: () => { pts.value = pts.value.split('\n').slice(0, -1).join('\n'); draw(); } }, 'Remove last corner'), h('button', { class: 'b sec sm', onclick: () => { pts.value = ''; draw(); } }, 'Clear')));
  let layer; const center = z?.config?.center ? [z.config.center[1], z.config.center[0]] : z ? [z.polygon[0][1], z.polygon[0][0]] : KIGALI;
  const mp = pickMap(center, z ? 12 : 11, (la, ln) => { if (shape.value === 'circle') { cLat.value = la; cLng.value = ln; } else pts.value = (pts.value.trim() ? pts.value.trim() + '\n' : '') + `${la}, ${ln}`; draw(); });
  const parsePts = () => pts.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[,;\s]+/).map(Number));
  function draw() {
    if (layer) { layer.remove(); layer = null; }
    circleBox.style.display = shape.value === 'circle' ? '' : 'none'; polyBox.style.display = shape.value === 'circle' ? 'none' : '';
    if (shape.value === 'circle') { const la = numOrNull(cLat.value), ln = numOrNull(cLng.value), r = numOrNull(rad.value); if (la != null && ln != null && r) layer = L.circle([la, ln], { radius: r, color: '#0077b0' }).addTo(mp.map); }
    else { const ps = parsePts().filter((p) => p.length === 2 && p.every(Number.isFinite)); if (ps.length >= 3) layer = L.polygon(ps, { color: '#0077b0' }).addTo(mp.map); else if (ps.length) layer = L.polyline(ps, { color: '#0077b0' }).addTo(mp.map); }
    if (layer) try { mp.map.fitBounds(layer.getBounds(), { maxZoom: 14, padding: [20, 20] }); } catch { /* empty */ }
  }
  [shape, cLat, cLng, rad, pts].forEach((x) => x.addEventListener('input', draw)); shape.addEventListener('change', draw); setTimeout(draw, 200);
  let dlg;
  const save = async () => {
    err.textContent = '';
    if (name.value.trim().length < 2) { err.textContent = 'Give the zone a name.'; name.focus(); return; }
    if (!/^[a-z0-9_-]{2,30}$/.test(idEl.value)) { err.textContent = 'The id needs 2 to 30 lowercase letters, digits, - or _.'; idEl.focus(); return; }
    const body = { name: name.value.trim(), active: activeEl.checked };
    if (shape.value === 'circle') {
      const la = numOrNull(cLat.value), ln = numOrNull(cLng.value), r = numOrNull(rad.value);
      if (la == null || ln == null) { err.textContent = 'Click the map or type the centre latitude and longitude.'; return; }
      if (r == null || r < 200 || r > 150000) { err.textContent = 'The radius must be between 200 and 150,000 metres.'; return; }
      body.circle = { lat: la, lng: ln, radius_m: r };
    } else {
      const ps = parsePts(); if (ps.length < 3 || ps.some((p) => p.length !== 2 || !p.every(Number.isFinite))) { err.textContent = 'Enter at least 3 corners, one per line, as "latitude, longitude".'; return; }
      const ring = ps.map(([la, ln]) => [ln, la]); ring.push([...ring[0]]); body.polygon = ring;
    }
    try { const r = await api('PUT', '/admin/zones/' + idEl.value, body); toast(r.warnings?.length ? r.warnings[0] : 'Zone saved', !!r.warnings?.length); dlg.close(); go('places', { sub: 'zones' }); await catalogReset(); } catch (e) { err.textContent = e.message; }
  };
  dlg = openDialog(creating ? 'Add a zone' : 'Edit ' + z.name, h('div', {},
    h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Name *'), name), h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Id (permanent) *'), idEl, h('span', { class: 'hint' }, 'Prices and service switches refer to the id, so it cannot change later.')),
    h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Shape'), shape), circleBox, polyBox, h('p', { class: 'hint' }, 'Click the map to set the centre (circle) or add a corner (outline).'), mp.el,
    h('label', { class: 'switch' }, activeEl, h('span', {}, 'Active')), err,
    h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'b', onclick: save }, 'Save zone'))), { width: 760, key: 'zone' });
}
/** Zone names are cached for table labels; forget them after an edit. */
async function catalogReset() { CAT.ready = null; await catalog(); }

// ------------------------------------------------------------------ content and rules
V.content = async (el, state = {}) => {
  const tabs = [can('faq.manage') && ['faq', 'Help centre (FAQ)'], can('requirements.manage') && ['docs', 'Driver documents'], can('support.configure') && ['support', 'Support deadlines'], can('settings.manage') && ['wording', 'Notification wording']].filter(Boolean);
  const sub = tabs.some((t) => t[0] === state.sub) ? state.sub : tabs[0][0];
  el.append(h('h1', {}, 'Content and rules'), subnav('content', tabs, sub));
  if (sub === 'docs') return docsView(el);
  if (sub === 'support') return supportCatView(el);
  if (sub === 'wording') return wordingView(el, state);
  return faqView(el);
};

// ---- help centre
async function faqView(el) {
  const d = await api('GET', '/admin/faq'), rows = d.faq;
  const move = async (i, dir) => { const ids = rows.map((r) => r.id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; try { await api('POST', '/admin/faq/order', { ids }); go('content', { sub: 'faq' }); } catch (e) { toast(e.message, true); } };
  el.append(note('Questions and answers shown in the app\'s help centre. Each entry must be written in English, Kinyarwanda AND French before it can be published, because a customer only ever sees one language. Drafts are not visible to customers.'),
    h('div', { class: 'row' }, h('button', { class: 'b', onclick: () => faqDialog(null) }, 'Add question')),
    table([{ h: '#', f: (r) => rows.indexOf(r) + 1, cls: 'num' }, { h: 'Question (English)', f: (r) => r.q_en || h('span', { class: 'muted' }, '(empty)') },
      { h: 'Languages', f: (r) => ['en', 'rw', 'fr'].map((l) => (r['q_' + l] && r['a_' + l] ? pill(l.toUpperCase(), 'ok') : pill(l.toUpperCase(), 'warn'))), csv: (r) => ['en', 'rw', 'fr'].filter((l) => r['q_' + l] && r['a_' + l]).join(' ') },
      { h: 'Status', f: (r) => pill(r.published ? 'published' : 'draft', r.published ? 'ok' : 'warn') },
      { h: '', f: (r) => { const i = rows.indexOf(r); return h('span', { class: 'row' }, h('button', { class: 'b sec sm', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'), h('button', { class: 'b sec sm', 'aria-label': 'Move down', disabled: i === rows.length - 1, onclick: () => move(i, 1) }, '↓'),
        h('button', { class: 'b sec', onclick: () => faqDialog(r) }, 'Edit'),
        h('button', { class: 'b sec', onclick: () => act(() => api('PATCH', '/admin/faq/' + r.id, { published: !r.published }), () => go('content', { sub: 'faq' })) }, r.published ? 'Unpublish' : 'Publish'),
        h('button', { class: 'b red', onclick: async () => { const a = await ask('Delete this question?', { danger: true, confirmText: 'Delete', message: r.q_en }); if (a) act(() => api('DELETE', '/admin/faq/' + r.id), () => go('content', { sub: 'faq' })); } }, 'Delete')); } }], rows, (r) => faqDialog(r), 'No questions yet.', { sort: false, search: false }));
}
function faqDialog(r) {
  const LANGS = [['en', 'English'], ['rw', 'Kinyarwanda'], ['fr', 'Français']], f = {};
  const blocks = LANGS.map(([l, name]) => {
    f['q_' + l] = h('input', { value: r?.['q_' + l] || '', maxlength: 200, 'aria-label': 'Question in ' + name, style: 'width:100%' });
    f['a_' + l] = h('textarea', { rows: 3, maxlength: 1500, 'aria-label': 'Answer in ' + name }); f['a_' + l].value = r?.['a_' + l] || '';
    return h('div', { class: 'faqlang' }, h('b', {}, name), h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Question'), f['q_' + l]), h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Answer'), f['a_' + l]));
  });
  const pub = h('input', { type: 'checkbox', checked: !!r?.published, 'aria-label': 'Published' }), err = h('div', { class: 'ferr', role: 'alert' }); let dlg;
  const save = async () => {
    err.textContent = ''; const body = { published: pub.checked }; for (const k of Object.keys(f)) body[k] = f[k].value.trim();
    if (!body.q_en) { err.textContent = 'Write at least the English question.'; f.q_en.focus(); return; }
    if (body.published) { const miss = LANGS.filter(([l]) => body['q_' + l].length < 3 || body['a_' + l].length < 3).map(([, n]) => n); if (miss.length) { err.textContent = 'To publish, also write the question and answer in: ' + miss.join(', ') + '. Or untick Published to save a draft.'; return; } }
    try { await api(r ? 'PATCH' : 'POST', r ? '/admin/faq/' + r.id : '/admin/faq', body); toast('Saved'); dlg.close(); go('content', { sub: 'faq' }); } catch (e) { err.textContent = e.message; }
  };
  dlg = openDialog(r ? 'Edit question' : 'Add question', h('div', {}, ...blocks, h('label', { class: 'switch' }, pub, h('span', {}, 'Published (visible in the app)')), err,
    h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'b', onclick: save }, 'Save'))), { width: 760, key: 'faq' });
}

// ---- driver document rules
async function docsView(el) {
  const d = await api('GET', '/admin/document-requirements');
  const label = (k) => d.doc_types.find((x) => x.key === k)?.label || human(k);
  el.append(note('Which documents each vehicle type needs before a driver can be approved. "Mandatory" documents block approval until reviewed; "Needs expiry date" makes the driver enter an expiry date. Every vehicle type must keep at least one mandatory document. Drivers already approved keep their status; the new rule applies to new applications and to renewals.'));
  for (const vt of d.vehicle_types) {
    const rows = d.requirements.filter((r) => r.vehicle_type === vt);
    const free = d.doc_types.filter((t) => !rows.some((r) => r.doc_type === t.key));
    el.append(h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, vt === 'abasare' ? 'Abasare (drive the customer\'s car)' : human(vt)),
      h('button', { class: 'b sec', disabled: !free.length, onclick: async () => {
        const a = await ask('Add a document for ' + human(vt), { reason: true, confirmText: 'Add', fields: [{ name: 'doc_type', label: 'Document', type: 'select', options: free.map((t) => ({ value: t.key, label: t.label })) }, { name: 'mandatory', label: 'Mandatory?', type: 'select', options: [{ value: 'yes', label: 'Mandatory' }, { value: 'no', label: 'Optional' }] }, { name: 'requires_expiry', label: 'Needs an expiry date?', type: 'select', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }] });
        if (a) act(() => api('POST', '/admin/document-requirements', { vehicle_type: vt, doc_type: a.doc_type, mandatory: a.mandatory === 'yes', requires_expiry: a.requires_expiry === 'yes', reason: a.reason }), () => go('content', { sub: 'docs' })); } }, 'Add document')),
      table([{ h: 'Document', f: (r) => label(r.doc_type), s: (r) => label(r.doc_type) },
        { h: 'Mandatory', f: (r) => h('button', { class: 'b ' + (r.mandatory ? '' : 'sec'), 'aria-label': `${label(r.doc_type)} mandatory for ${vt}`, onclick: async () => { const a = await ask(`${r.mandatory ? 'Make optional' : 'Make mandatory'}: ${label(r.doc_type)} for ${human(vt)}`, { reason: true }); if (a) act(() => api('PATCH', '/admin/document-requirements/' + r.id, { mandatory: !r.mandatory, reason: a.reason }), () => go('content', { sub: 'docs' })); } }, r.mandatory ? 'Mandatory' : 'Optional'), s: (r) => (r.mandatory ? 1 : 0) },
        { h: 'Expiry date', f: (r) => h('button', { class: 'b ' + (r.requires_expiry ? '' : 'sec'), 'aria-label': `${label(r.doc_type)} needs expiry for ${vt}`, onclick: async () => { const a = await ask(`${r.requires_expiry ? 'Stop requiring' : 'Require'} an expiry date: ${label(r.doc_type)} for ${human(vt)}`, { reason: true }); if (a) act(() => api('PATCH', '/admin/document-requirements/' + r.id, { requires_expiry: !r.requires_expiry, reason: a.reason }), () => go('content', { sub: 'docs' })); } }, r.requires_expiry ? 'Required' : 'Not needed'), s: (r) => (r.requires_expiry ? 1 : 0) },
        { h: '', f: (r) => h('button', { class: 'b red', onclick: async () => { const a = await ask(`Remove ${label(r.doc_type)} for ${human(vt)}?`, { reason: true, danger: true, confirmText: 'Remove' }); if (a) act(() => api('DELETE', '/admin/document-requirements/' + r.id, { reason: a.reason }), () => go('content', { sub: 'docs' })); } }, 'Remove') }], rows, null, 'No documents required.', { sort: false, search: false })));
  }
}

// ---- support categories
async function supportCatView(el) {
  const d = await api('GET', '/admin/support-categories');
  const PRIO = ['low', 'normal', 'high', 'urgent'];
  el.append(note('How quickly each kind of customer case must be answered (the deadline shown to support staff and used for overdue alerts), its priority, and whether it is sensitive (visible only to staff who may handle sensitive cases). Safety cases are protected: they stay urgent or high, sensitive, and within 24 hours. Changes apply to NEW cases.'),
    table([{ h: 'Category', f: (c) => human(c.category), s: (c) => c.category }, { h: 'Priority', f: (c) => pill(c.priority, c.priority === 'urgent' ? 'bad' : c.priority === 'high' ? 'warn' : ''), s: (c) => PRIO.indexOf(c.priority) },
      { h: 'Respond within', f: (c) => c.sla_hours + ' h', s: (c) => c.sla_hours, cls: 'num' }, { h: 'Sensitive', f: (c) => (c.sensitive ? 'Yes' : 'No'), s: (c) => (c.sensitive ? 1 : 0) }, { h: 'Open cases', k: 'open_cases', cls: 'num' },
      { h: '', f: (c) => h('button', { class: 'b sec', onclick: async () => {
        const a = await ask('Edit ' + human(c.category), { reason: true, confirmText: 'Save', fields: [{ name: 'priority', label: 'Priority', type: 'select', value: c.priority, options: PRIO }, { name: 'sla_hours', label: 'Respond within (hours, 1 to 720)', type: 'number', integer: true, min: 1, max: 720, value: c.sla_hours, required: true }, { name: 'sensitive', label: 'Sensitive?', type: 'select', value: c.sensitive ? 'yes' : 'no', options: [{ value: 'yes', label: 'Yes, restricted to sensitive-case staff' }, { value: 'no', label: 'No' }] }] });
        if (a) act(() => api('PATCH', '/admin/support-categories/' + c.category, { priority: a.priority, sla_hours: a.sla_hours, sensitive: a.sensitive === 'yes', reason: a.reason }), () => go('content', { sub: 'support' })); } }, 'Edit') }], d.categories, null, '', { sort: false, search: false }));
}

// ---- notification wording
async function wordingView(el, state) {
  const lang = state.lang || 'en', search = state.q || '';
  const d = await api('GET', '/admin/templates');
  const rows = d.templates.filter((t) => t.lang === lang && (!search || (t.key + ' ' + t.body).toLowerCase().includes(search.toLowerCase())));
  const ls = h('select', { 'aria-label': 'Language' }, [['en', 'English'], ['rw', 'Kinyarwanda'], ['fr', 'Français']].map(([v, l]) => h('option', { value: v, selected: v === lang }, l)));
  const q = h('input', { type: 'search', placeholder: 'Search messages', 'aria-label': 'Search messages', value: search });
  const apply = () => go('content', { sub: 'wording', lang: ls.value, q: q.value.trim() });
  el.append(note('The messages customers and drivers receive (push, SMS, in-app), one language at a time. Customers only ever see their own language, so edit the English, Kinyarwanda and French versions separately. Keep the {{placeholders}}: they are replaced with real values. Never put passwords or secrets in a message.'),
    filterBar(ls, q, h('button', { type: 'submit', class: 'b', onclick: apply }, 'Show')),
    table([{ h: 'Message', f: (t) => h('div', {}, h('b', {}, human(t.key)), h('div', { class: 'muted mono' }, t.key)), s: (t) => t.key }, { h: 'Title', k: 'title' }, { h: 'Text', f: (t) => h('span', { class: 'trunc', title: t.body }, t.body), s: (t) => t.body, csv: (t) => t.body },
      { h: 'Wording', f: (t) => pill(t.overridden ? 'customised' : 'built-in', t.overridden ? 'warn' : 'info'), s: (t) => (t.overridden ? 1 : 0) },
      { h: '', f: (t) => h('span', { class: 'row' }, h('button', { class: 'b sec', onclick: () => wordingDialog(t) }, 'Edit'), t.overridden && h('button', { class: 'b sec', onclick: async () => { const a = await ask('Go back to the built-in wording?', { confirmText: 'Revert', message: t.default_body }); if (a) act(() => api('DELETE', `/admin/templates/${t.key}/${t.lang}`), () => go('content', { sub: 'wording', lang, q: search })); } }, 'Revert')) }], rows, (t) => wordingDialog(t), 'No messages match.', { pageSize: 25 }));
}
function wordingDialog(t) {
  const title = h('input', { value: t.title, maxlength: 100, 'aria-label': 'Title', style: 'width:100%' }), body = h('textarea', { rows: 4, maxlength: 500, 'aria-label': 'Message text', style: 'width:100%' }); body.value = t.body;
  const err = h('div', { class: 'ferr', role: 'alert' }); let dlg;
  dlg = openDialog('Edit ' + human(t.key) + ' (' + t.lang.toUpperCase() + ')', h('div', {},
    h('p', { class: 'hint' }, 'Built-in: ', h('em', {}, t.default_title + ' / ' + t.default_body)), t.placeholders.length ? h('p', { class: 'hint' }, 'Available placeholders: ', t.placeholders.map((p) => h('code', { class: 'chip' }, '{{' + p + '}}'))) : null,
    h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Title'), title), h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Text'), body), err,
    h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'b', onclick: async () => {
      err.textContent = ''; if (!title.value.trim() || !body.value.trim()) { err.textContent = 'Title and text are both required.'; return; }
      try { await api('PUT', `/admin/templates/${t.key}/${t.lang}`, { title: title.value.trim(), body: body.value.trim() }); toast('Wording saved'); dlg.close(); go('content', { sub: 'wording', lang: t.lang }); } catch (e) { err.textContent = e.message; } } }, 'Save wording'))), { width: 640, key: 'wording' });
}

// ------------------------------------------------------------------ feature flags
V.flags = async (el) => {
  const d = await api('GET', '/admin/flags'), isSuper = S.roles.includes('super_admin');
  el.append(h('h1', {}, 'Feature flags'), note('Switches that turn whole features on or off for everyone, immediately. Each change asks for a reason and is written to the audit log. Flags marked regulated change prices or move money, so only a super admin can turn them on.'),
    table([{ h: 'Flag', f: (f) => h('div', {}, h('code', {}, f.key), d.regulated.includes(f.key) ? h('span', {}, ' ', pill('regulated', 'warn')) : null, h('div', { class: 'muted' }, f.description || 'No description')), s: (f) => f.key, csv: (f) => f.key },
      { h: 'State', f: (f) => pill(f.enabled ? 'on' : 'off', f.enabled ? 'ok' : ''), s: (f) => (f.enabled ? 1 : 0), csv: (f) => (f.enabled ? 'on' : 'off') },
      { h: 'Last change', f: (f) => (f.updated_at ? h('div', {}, `${f.updated_by_name || 'system'}, ${when(f.updated_at)}`, f.last_reason ? h('div', { class: 'muted' }, f.last_reason) : null) : '-'), s: (f) => (f.updated_at ? Date.parse(f.updated_at) : 0) },
      { h: '', f: (f) => { const locked = !f.enabled && d.regulated.includes(f.key) && !isSuper; return h('button', { class: 'b ' + (f.enabled ? 'sec' : ''), disabled: locked, title: locked ? 'Only a super admin can turn this on' : null, onclick: async () => { const a = await ask((f.enabled ? 'Turn off ' : 'Turn on ') + f.key + '?', { reason: true, danger: f.enabled, confirmText: f.enabled ? 'Turn off' : 'Turn on', message: f.description }); if (a) act(() => api('PUT', '/admin/flags/' + f.key, { enabled: !f.enabled, reason: a.reason }), () => go('flags')); } }, f.enabled ? 'Turn off' : 'Turn on'); } }],
      d.flags, null, 'No flags.', { csv: 'feature-flags' }));
};

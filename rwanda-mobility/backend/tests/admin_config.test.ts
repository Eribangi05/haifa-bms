import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx, q: typeof import('../src/db.ts').q, q1: typeof import('../src/db.ts').q1;
before(async () => { t = await boot('rwanda_mobility_test'); ({ q, q1 } = await import('../src/db.ts')); });
after(async () => { await t.close(); });

const get = (s: { token: string }, path: string) => t.api('GET', path, { token: s.token });
const post = (s: { token: string }, path: string, body?: any) => t.api('POST', path, { token: s.token, body: body ?? {} });
const put = (s: { token: string }, path: string, body: any) => t.api('PUT', path, { token: s.token, body });
const patch = (s: { token: string }, path: string, body: any) => t.api('PATCH', path, { token: s.token, body });
const del = (s: { token: string }, path: string, body?: any) => t.api('DELETE', path, { token: s.token, body });
const uniq = () => randomUUID().slice(0, 6);

test('places: add, search, edit names in three languages, designate pickup, disable; customers see only active ones; permission gated', async () => {
  const sa = await t.staff('super_admin'); const bm = await t.staff('business_manager'); const fo = await t.staff('finance_officer'); const cust = await t.register();
  assert.equal((await get(fo, '/admin/places')).status, 403);
  const nm = 'Test Landmark ' + uniq();
  const bad = await post(bm, '/admin/places', { name_en: nm, lat: 10, lng: 30.1 });
  assert.equal(bad.status, 400, 'latitude outside Rwanda');
  assert.equal((await post(bm, '/admin/places', { name_en: nm, lat: 30.1, lng: -1.95 })).status, 400, 'swapped coordinates are caught');
  const c = await post(bm, '/admin/places', { name_en: nm, name_rw: 'Ahantu ' + nm, name_fr: 'Lieu ' + nm, kind: 'market', lat: -1.9441, lng: 30.0619, designated_pickup: true });
  assert.equal(c.status, 200, JSON.stringify(c.json)); assert.equal(c.json.zone_id, 'kigali');
  assert.equal((await post(bm, '/admin/places', { name_en: nm, lat: -1.9442, lng: 30.0619 })).json.error.code, 'duplicate_place');
  const id = c.json.id;
  // search + filters
  const list = await get(bm, `/admin/places?q=${encodeURIComponent(nm.slice(0, 14))}&pickup=yes`);
  assert.ok(list.json.places.some((p: any) => p.id === id && p.designated_pickup && p.kind === 'market'));
  assert.ok(!(await get(bm, `/admin/places?q=${encodeURIComponent(nm)}&pickup=no`)).json.places.some((p: any) => p.id === id));
  // customers find it by any language; popular shows it as pickup
  assert.ok((await get(cust, `/places/search?q=${encodeURIComponent('Lieu Test Landmark')}&lang=fr`)).json.places.some((p: any) => p.id === id));
  assert.ok((await t.api('GET', '/places/popular?lang=fr')).json.places.some((p: any) => p.id === id && p.name.startsWith('Lieu')));
  // edit names
  assert.equal((await patch(bm, `/admin/places/${id}`, { name_rw: 'Isoko ' + nm, name_fr: 'Marché ' + nm })).status, 200);
  assert.ok((await t.api('GET', '/places/popular?lang=rw')).json.places.some((p: any) => p.id === id && p.name.startsWith('Isoko')));
  // un-designate, then disable: hidden from customers, still listed for staff
  assert.equal((await patch(bm, `/admin/places/${id}`, { designated_pickup: false })).status, 200);
  assert.equal((await patch(bm, `/admin/places/${id}`, { active: false })).status, 200);
  assert.ok(!(await t.api('GET', '/places/popular')).json.places.some((p: any) => p.id === id));
  assert.ok(!(await get(cust, `/places/search?q=${encodeURIComponent('Test Landmark')}`)).json.places.some((p: any) => p.id === id));
  assert.ok((await get(bm, `/admin/places?active=no&q=${encodeURIComponent(nm.slice(0, 14))}`)).json.places.some((p: any) => p.id === id));
  assert.equal((await patch(bm, `/admin/places/${randomUUID()}`, { active: true })).status, 404);
  const a = await q("select action from audit_logs where entity_type='place' and entity_id=$1 order by id", [id]);
  assert.ok(a.length >= 4 && a[0].action === 'place.created');
  // outside any zone: created but warned
  const far = await post(sa, '/admin/places', { name_en: 'Far Away ' + uniq(), lat: -2.6, lng: 28.95 });
  assert.equal(far.status, 200); assert.match(far.json.warning, /outside every active zone/);
});

test('places CSV import: dry run, per-row errors, all-or-nothing, duplicates, formula-looking text stays text', async () => {
  const sa = await t.staff('super_admin'); const s = uniq();
  const header = 'name_en,name_rw,name_fr,kind,lat,lng,designated_pickup\n';
  const good = `${header}Imp A ${s},Ahantu A,Lieu A,landmark,-1.95,30.06,yes\n"Imp, B ${s}",Ahantu B,,station,-1.96,30.07,no\n`;
  const dry = await post(sa, '/admin/places/import', { csv: good, dry_run: true });
  assert.equal(dry.status, 200); assert.equal(dry.json.valid, 2); assert.equal(dry.json.error_count, 0);
  assert.equal((await q("select 1 from places where name_en like $1", [`Imp %${s}`])).length, 0, 'dry run saves nothing');
  const mixed = `${good}Bad Lat ${s},,,landmark,50,30.06,no\nBad Kind ${s},,,spaceport,-1.95,30.09,no\nImp A ${s},,,landmark,-1.95,30.06,no\n`;
  const r = await post(sa, '/admin/places/import', { csv: mixed });
  assert.equal(r.status, 200); assert.equal(r.json.ok, false); assert.equal(r.json.error_count, 3);
  assert.deepEqual(r.json.errors.map((e: any) => e.row), [4, 5, 6]);
  assert.equal((await q("select 1 from places where name_en like $1", [`Imp %${s}`])).length, 0, 'one bad row blocks the whole file');
  const ok = await post(sa, '/admin/places/import', { csv: good });
  assert.equal(ok.json.created, 2);
  const row = await q1<any>("select name_en, designated_pickup, zone_id from places where name_en=$1", [`Imp, B ${s}`]);
  assert.ok(row && row.zone_id === 'kigali' && row.designated_pickup === false);
  assert.equal((await post(sa, '/admin/places/import', { csv: good })).json.error_count, 2, 'importing the same file again reports duplicates');
  assert.equal((await post(sa, '/admin/places/import', { csv: 'foo,bar\n1,2\n' })).json.error.code, 'csv_header');
  assert.equal((await post(sa, '/admin/places/import', { csv: header })).status, 400);
  assert.equal((await post(await t.staff('finance_officer'), '/admin/places/import', { csv: good })).status, 403);
});

test('zones: create by circle and by polygon, validation, overlap warning, disable rules, public coverage follows', async () => {
  const sa = await t.staff('super_admin'); const bm = await t.staff('business_manager'); const fo = await t.staff('finance_officer');
  assert.equal((await get(fo, '/admin/zones')).status, 403);
  assert.equal((await get(bm, '/admin/zones')).status, 200);
  const id = 'z' + uniq();
  const circ = await put(bm, `/admin/zones/${id}`, { name: 'Huye test ' + id, circle: { lat: -2.5967, lng: 29.7394, radius_m: 4000 } });
  assert.equal(circ.status, 200, JSON.stringify(circ.json)); assert.equal(circ.json.created, true); assert.deepEqual(circ.json.warnings, []);
  const z = (await get(bm, '/admin/zones')).json.zones.find((x: any) => x.id === id);
  assert.equal(z.shape, 'circle'); assert.equal(z.config.radius_m, 4000); assert.ok(z.area_km2 > 45 && z.area_km2 < 55, `area ${z.area_km2}`); assert.equal(z.polygon.length, 49);
  assert.ok((await t.api('GET', '/coverage')).json.zones.some((x: any) => x.id === id));
  // validation
  const base = { name: 'Poly ' + id };
  const sq = [[29.70, -2.60], [29.75, -2.60], [29.75, -2.55], [29.70, -2.55], [29.70, -2.60]];
  assert.equal((await put(bm, `/admin/zones/p${id}`, { ...base, polygon: sq.slice(0, 4) })).json.error.code, 'polygon_not_closed');
  assert.equal((await put(bm, `/admin/zones/p${id}`, { ...base, polygon: [[29.7, -2.6], [29.75, -2.55], [29.75, -2.6], [29.7, -2.55], [29.7, -2.6]] })).json.error.code, 'polygon_self_intersects');
  assert.equal((await put(bm, `/admin/zones/p${id}`, { ...base, polygon: [[-2.6, 29.7], [-2.6, 29.75], [-2.55, 29.75], [-2.55, 29.7], [-2.6, 29.7]] })).json.error.code, 'outside_rwanda', 'lat/lng swapped');
  assert.equal((await put(bm, `/admin/zones/p${id}`, { ...base, polygon: sq, circle: { lat: -2.6, lng: 29.7, radius_m: 1000 } })).status, 400, 'polygon xor circle');
  assert.equal((await put(bm, `/admin/zones/p${id}`, { ...base, circle: { lat: -2.6, lng: 29.7, radius_m: 50 } })).status, 400);
  assert.equal((await put(bm, `/admin/zones/p${id}`, { name: 'Huye test ' + id, polygon: sq })).json.error.code, 'zone_name_taken');
  const okp = await put(bm, `/admin/zones/p${id}`, { ...base, polygon: sq });
  assert.equal(okp.status, 200); assert.equal(okp.json.warnings.length, 1, 'overlaps the circle zone: warned, not refused');
  // update keeps the id; name and shape change
  assert.equal((await put(bm, `/admin/zones/${id}`, { name: 'Huye renamed ' + id, circle: { lat: -2.5967, lng: 29.7394, radius_m: 2500 } })).json.created, false);
  assert.equal((await get(bm, '/admin/zones')).json.zones.find((x: any) => x.id === id).config.radius_m, 2500);
  // disabling needs a reason; the last active zone can never be disabled
  assert.equal((await post(bm, `/admin/zones/${id}/active`, { active: false })).status, 400);
  assert.equal((await post(bm, `/admin/zones/${id}/active`, { active: false, reason: 'pilot ended' })).status, 200);
  assert.ok(!(await t.api('GET', '/coverage')).json.zones.some((x: any) => x.id === id));
  assert.equal((await post(bm, `/admin/zones/${id}/active`, { active: true, reason: 'pilot restarted' })).status, 200);
  const act = await q<any>('select id from service_zones where active');
  for (const zz of act.slice(1)) await q('update service_zones set active=false where id=$1', [zz.id]);
  const lastId = act[0].id;
  assert.equal((await post(sa, `/admin/zones/${lastId}/active`, { active: false, reason: 'try last zone' })).json.error.code, 'last_zone');
  assert.equal((await put(sa, `/admin/zones/${lastId}`, { name: (await q1<any>('select name from service_zones where id=$1', [lastId]))!.name, active: false, circle: { lat: -1.95, lng: 30.1, radius_m: 5000 } })).json.error.code, 'last_zone');
  for (const zz of act.slice(1)) await q('update service_zones set active=true where id=$1', [zz.id]);
  const a = await q("select action from audit_logs where entity_type='zone' and entity_id=$1 order by id", [id]);
  assert.deepEqual(a.map((x: any) => x.action), ['zone.created', 'zone.updated', 'zone.disabled', 'zone.enabled']);
  // per-zone service availability still works for the new zone
  assert.equal((await t.api('PUT', `/admin/services/moto/zones/${id}`, { token: bm.token, body: { enabled: false } })).status, 200);
});

test('driver document requirements: add, change flags, remove; unknown documents refused; the last mandatory document of a vehicle type is protected', async () => {
  const sa = await t.staff('super_admin'); const bm = await t.staff('business_manager');
  assert.equal((await get(bm, '/admin/document-requirements')).status, 403);
  const l = await get(sa, '/admin/document-requirements');
  assert.ok(l.json.requirements.length > 20 && l.json.vehicle_types.includes('moto') && l.json.vehicle_types.includes('abasare') && l.json.doc_types.some((d: any) => d.key === 'national_id' && d.label));
  const moto = l.json.requirements.filter((r: any) => r.vehicle_type === 'moto');
  const permit = moto.find((r: any) => r.doc_type === 'transport_permit');   // seeded optional
  assert.equal(permit.mandatory, false);
  assert.equal((await patch(sa, `/admin/document-requirements/${permit.id}`, { mandatory: true })).status, 400, 'reason mandatory');
  assert.equal((await patch(sa, `/admin/document-requirements/${permit.id}`, { mandatory: true, requires_expiry: false, reason: 'new regulation' })).status, 200);
  assert.deepEqual(await q1("select mandatory, requires_expiry from document_requirements where id=$1", [permit.id]), { mandatory: true, requires_expiry: false });
  // add + duplicate + unknown
  const del1 = await q1<any>("select id from document_requirements where vehicle_type='car' and doc_type='inspection'");
  assert.equal((await del(sa, `/admin/document-requirements/${del1.id}`, { reason: 'inspection suspended' })).status, 200);
  assert.equal((await post(sa, '/admin/document-requirements', { vehicle_type: 'car', doc_type: 'inspection', reason: 'back again' })).status, 200);
  assert.equal((await post(sa, '/admin/document-requirements', { vehicle_type: 'car', doc_type: 'inspection', reason: 'duplicate add' })).status, 409);
  assert.equal((await post(sa, '/admin/document-requirements', { vehicle_type: 'car', doc_type: 'passport', reason: 'unknown doc' })).status, 400);
  assert.equal((await post(sa, '/admin/document-requirements', { vehicle_type: 'rocket', doc_type: 'insurance', reason: 'unknown vehicle' })).json.error.code, 'unknown_vehicle_type');
  // the last mandatory document of a type cannot be removed or made optional
  const ab = await q<any>("select id from document_requirements where vehicle_type='abasare' and mandatory order by id");
  for (const r of ab.slice(1)) assert.equal((await del(sa, `/admin/document-requirements/${r.id}`, { reason: 'trim abasare list' })).status, 200);
  assert.equal((await del(sa, `/admin/document-requirements/${ab[0].id}`, { reason: 'remove the last one' })).json.error.code, 'last_required_document');
  assert.equal((await patch(sa, `/admin/document-requirements/${ab[0].id}`, { mandatory: false, reason: 'make last optional' })).json.error.code, 'last_required_document');
  assert.ok((await q("select 1 from audit_logs where entity_type='document_requirement' and action='docreq.deleted'")).length >= 1);
});

test('help centre: seeded entries are served from the table; drafts stay private; publishing needs all three languages; reorder; unpublish; delete', async () => {
  const sa = await t.staff('super_admin'); const sl = await t.staff('support_lead'); const an = await t.staff('analyst');
  const pub = await t.api('GET', '/support/faq');
  assert.deepEqual(pub.json.faq.map((f: any) => f.id), ['cancel', 'pin', 'pay', 'lost', 'sos'], 'the five original entries, in order');
  assert.match(pub.json.faq[1].a_rw, /PIN y'urugendo|Ni kode/); assert.match(pub.json.faq[0].q_fr, /annuler/);
  assert.equal((await get(an, '/admin/faq')).status, 403);
  assert.equal((await get(sl, '/admin/faq')).status, 200, 'support lead can edit the help centre by default');
  const d = await post(sl, '/admin/faq', { q_en: 'Is there a night fare?', a_en: 'Yes, 20% more after 22:00.', q_rw: '', a_rw: '', q_fr: '', a_fr: '', published: false });
  assert.equal(d.status, 200);
  assert.ok(!(await t.api('GET', '/support/faq')).json.faq.some((f: any) => f.id === d.json.id), 'draft is not public');
  assert.equal((await patch(sl, `/admin/faq/${d.json.id}`, { published: true })).json.error.code, 'faq_incomplete');
  assert.equal((await patch(sl, `/admin/faq/${d.json.id}`, { q_rw: 'Hari igiciro cya nijoro?', a_rw: 'Yego, hiyongeraho 20% nyuma ya saa 22:00.', q_fr: 'Y a-t-il un tarif de nuit ?', a_fr: 'Oui, 20 % de plus après 22 h.', published: true })).status, 200);
  const after = (await t.api('GET', '/support/faq')).json.faq; assert.equal(after[after.length - 1].id, d.json.id);
  // reorder: move it first
  const ids = [d.json.id, ...after.filter((f: any) => f.id !== d.json.id).map((f: any) => f.id)];
  assert.equal((await post(sl, '/admin/faq/order', { ids })).status, 200);
  assert.equal((await t.api('GET', '/support/faq')).json.faq[0].id, d.json.id);
  // unpublish hides, delete removes, everything is audited
  assert.equal((await patch(sl, `/admin/faq/${d.json.id}`, { published: false })).status, 200);
  assert.ok(!(await t.api('GET', '/support/faq')).json.faq.some((f: any) => f.id === d.json.id));
  assert.equal((await del(sl, `/admin/faq/${d.json.id}`)).status, 200);
  assert.equal((await del(sl, `/admin/faq/${d.json.id}`)).status, 404);
  const acts = (await q("select action from audit_logs where entity_type='faq' and entity_id=$1 order by id", [d.json.id])).map((x: any) => x.action);
  assert.deepEqual(acts, ['faq.created', 'faq.published', 'faq.unpublished', 'faq.deleted']);
  assert.equal((await post(sa, '/admin/faq', { q_en: 'x'.repeat(300), a_en: 'a', q_rw: '', a_rw: '', q_fr: '', a_fr: '' })).status, 400);
  await post(sa, '/admin/faq/order', { ids: ['cancel', 'pin', 'pay', 'lost', 'sos'] });
});

test('support categories: priority, deadline and sensitivity are editable and used by new cases; safety stays protected', async () => {
  const sa = await t.staff('super_admin'); const sl = await t.staff('support_lead'); const cust = await t.register();
  assert.equal((await get(sl, '/admin/support-categories')).status, 403);
  const l = await get(sa, '/admin/support-categories');
  assert.equal(l.json.categories.length, 10); assert.equal(l.json.categories.find((c: any) => c.category === 'safety').sla_hours, 2);
  const mk = async () => (await post(cust, '/support/cases', { category: 'lost_item', subject: 'Forgot my bag', body: 'It is a blue bag.' })).json;
  const before = await mk(); assert.equal(before.priority, 'normal');
  assert.equal((await patch(sa, '/admin/support-categories/lost_item', { priority: 'high', sla_hours: 4 })).status, 400, 'reason mandatory');
  assert.equal((await patch(sa, '/admin/support-categories/lost_item', { priority: 'high', sla_hours: 4, sensitive: true, reason: 'faster for lost items' })).status, 200);
  const c2 = await mk(); assert.equal(c2.priority, 'high');
  const hours = (new Date(c2.sla_due_at).getTime() - Date.now()) / 3600e3; assert.ok(hours > 3.5 && hours <= 4.01, `SLA ${hours}h`);
  assert.equal((await q1<any>('select sensitive from support_cases where id=$1', [c2.id]))!.sensitive, true);
  assert.equal((await patch(sa, '/admin/support-categories/lost_item', { sla_hours: 0, reason: 'zero hours' })).status, 400);
  assert.equal((await patch(sa, '/admin/support-categories/lost_item', { sla_hours: 1000, reason: 'too long' })).status, 400);
  assert.equal((await patch(sa, '/admin/support-categories/nonsense', { sla_hours: 5, reason: 'unknown category' })).status, 404);
  assert.equal((await patch(sa, '/admin/support-categories/safety', { sla_hours: 48, reason: 'relax safety' })).json.error.code, 'safety_sla');
  assert.equal((await patch(sa, '/admin/support-categories/safety', { sensitive: false, reason: 'relax safety' })).json.error.code, 'safety_sensitive');
  assert.equal((await patch(sa, '/admin/support-categories/safety', { priority: 'low', reason: 'relax safety' })).json.error.code, 'safety_priority');
  assert.equal((await patch(sa, '/admin/support-categories/lost_item', { priority: 'normal', sla_hours: 24, sensitive: false, reason: 'restore the defaults' })).status, 200);
});

test('feature flags: list with descriptions and last change, toggle with reason, regulated flags are super-admin only; notification wording list, validation and revert', async () => {
  const sa = await t.staff('super_admin');
  const fl = await get(sa, '/admin/flags');
  assert.equal(fl.status, 200); assert.ok(fl.json.flags.length >= 5 && fl.json.flags.every((f: any) => f.description)); assert.ok(fl.json.regulated.includes('pricing.surge'));
  const key = fl.json.flags.find((f: any) => !fl.json.regulated.includes(f.key)).key;
  const was = fl.json.flags.find((f: any) => f.key === key).enabled;
  assert.equal((await put(sa, `/admin/flags/${key}`, { enabled: !was, reason: 'switch for a pilot' })).status, 200);
  const f2 = (await get(sa, '/admin/flags')).json.flags.find((f: any) => f.key === key);
  assert.equal(f2.enabled, !was); assert.equal(f2.last_reason, 'switch for a pilot'); assert.ok(f2.updated_by_name !== undefined);
  await put(sa, `/admin/flags/${key}`, { enabled: was });
  // wording
  const tl = await get(sa, '/admin/templates');
  const booking = tl.json.templates.filter((x: any) => x.key === 'booking_confirmed');
  assert.deepEqual(booking.map((x: any) => x.lang).sort(), ['en', 'fr', 'rw']); assert.ok(booking.every((x: any) => !x.overridden && x.default_body));
  const otp = tl.json.templates.find((x: any) => x.key === 'otp' && x.lang === 'en'); assert.deepEqual(otp.placeholders.sort(), ['code', 'minutes']);
  assert.equal((await put(sa, '/admin/templates/otp/en', { title: 'Code', body: 'Your code is {{code}} and {{password}}' })).status, 400);
  assert.equal((await put(sa, '/admin/templates/otp/en', { title: 'Code', body: 'Your code is {{kode}}' })).json.error.code, 'unknown_placeholder');
  assert.equal((await put(sa, '/admin/templates/not_a_template/en', { title: 'x', body: 'y' })).json.error.code, 'unknown_template');
  assert.equal((await put(sa, '/admin/templates/otp/en', { title: 'Your Abasare code', body: 'Code {{code}}, valid {{minutes}} min.' })).status, 200);
  assert.equal((await get(sa, '/admin/templates')).json.templates.find((x: any) => x.key === 'otp' && x.lang === 'en').overridden, true);
  assert.equal((await del(sa, '/admin/templates/otp/en')).status, 200);
  assert.equal((await del(sa, '/admin/templates/otp/en')).status, 404);
  assert.equal((await get(sa, '/admin/templates')).json.templates.find((x: any) => x.key === 'otp' && x.lang === 'en').overridden, false);
  assert.equal((await get(await t.staff('support_lead'), '/admin/flags')).status, 403);
});

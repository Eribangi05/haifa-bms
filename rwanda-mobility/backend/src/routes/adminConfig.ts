import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requirePerm, requireAnyPerm, actorOf } from '../guards.js';
import { q, q1, tx } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit } from '../services/audit.js';
import { haversineM, pointInPolygon } from '../util/geo.js';
import { circleToRing, overlaps, ringAreaKm2, validateRing, type Ring } from '../services/zoneGeo.js';
import { DOC_LABELS, KNOWN_DOCS } from '../services/docTypes.js';
import { DEFAULT_TEMPLATES } from '../services/i18n.js';

// Admin-editable configuration that used to live in code: landmarks, zones, driver document rules, help centre, support categories, notification wording.
const reason = z.string().trim().min(5).max(300);
const PLACE_KINDS = ['landmark', 'station', 'market', 'hospital', 'school', 'hotel', 'airport', 'government', 'religious', 'other'] as const;
// Rwanda with a margin (same box as zones): catches swapped or mistyped coordinates.
const inRwanda = (lat: number, lng: number) => lat >= -3.2 && lat <= -0.7 && lng >= 28.5 && lng <= 31.3;
const latv = z.number().min(-3.2).max(-0.7), lngv = z.number().min(28.5).max(31.3);
const nameField = z.string().trim().min(2).max(100);
const optName = z.string().trim().max(100).nullable().optional();

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export async function adminConfigRoutes(app: FastifyInstance) {
  // =================================================================== PLACES (landmarks, pickup points)
  const places = { preHandler: requirePerm('places.manage') };
  const zoneOfPoint = async (lat: number, lng: number) => {
    const zs = await q<any>('select id, polygon from service_zones where active');
    return zs.find((z) => pointInPolygon({ lat, lng }, z.polygon))?.id ?? null;
  };
  const nearDuplicate = async (name: string, lat: number, lng: number, exceptId?: string) => {
    const rows = await q<any>('select id, lat, lng from places where lower(name_en)=lower($1) and ($2::uuid is null or id<>$2)', [name, exceptId ?? null]);
    return rows.some((r) => haversineM({ lat, lng }, { lat: r.lat, lng: r.lng }) < 150);
  };
  app.get('/admin/places', places, async (req) => {
    const b = parse(z.object({ q: z.string().trim().max(80).optional(), active: z.enum(['all', 'yes', 'no']).default('all'), pickup: z.enum(['all', 'yes', 'no']).default('all'), limit: z.coerce.number().int().min(1).max(500).default(200), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    const args = [b.q ? `%${b.q.replace(/[\\%_]/g, '\\$&')}%` : null, b.active, b.pickup];
    const where = `($1::text is null or name_en ilike $1 or name_rw ilike $1 or name_fr ilike $1) and ($2='all' or active=($2='yes')) and ($3='all' or designated_pickup=($3='yes'))`;
    const [rows, total] = await Promise.all([
      q(`select id, name_en, name_rw, name_fr, kind, lat, lng, zone_id, designated_pickup, active, updated_at from places where ${where} order by designated_pickup desc, name_en limit $4 offset $5`, [...args, b.limit, b.offset]),
      q1<{ n: number }>(`select count(*)::int n from places where ${where}`, args)]);
    return { places: rows, total: total!.n, kinds: PLACE_KINDS };
  });
  const placeBody = z.object({ name_en: nameField, name_rw: optName, name_fr: optName, kind: z.enum(PLACE_KINDS).default('landmark'), lat: latv, lng: lngv, designated_pickup: z.boolean().default(false), active: z.boolean().default(true) });
  app.post('/admin/places', places, async (req) => {
    const b = parse(placeBody, req.body);
    if (await nearDuplicate(b.name_en, b.lat, b.lng)) throw conflict('duplicate_place', 'A place with this name already exists within 150 m');
    const zone = await zoneOfPoint(b.lat, b.lng);
    const row = await q1<any>('insert into places(name_en,name_rw,name_fr,kind,lat,lng,zone_id,designated_pickup,active,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id',
      [b.name_en, b.name_rw || null, b.name_fr || null, b.kind, b.lat, b.lng, zone, b.designated_pickup, b.active, req.auth!.id]);
    await audit(actorOf(req), 'place.created', 'place', row.id, undefined, b);
    return { ok: true, id: row.id, zone_id: zone, warning: zone ? undefined : 'This point is outside every active zone, so customers there cannot book from it.' };
  });
  app.patch('/admin/places/:id', places, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(placeBody.partial(), req.body);
    const before = await q1<any>('select name_en,name_rw,name_fr,kind,lat,lng,designated_pickup,active from places where id=$1', [id]);
    if (!before) throw notFound('place');
    const next = { ...before, ...b };
    if ((b.name_en || b.lat !== undefined || b.lng !== undefined) && await nearDuplicate(next.name_en, next.lat, next.lng, id)) throw conflict('duplicate_place', 'Another place with this name already exists within 150 m');
    const zone = await zoneOfPoint(next.lat, next.lng);
    await q('update places set name_en=$2,name_rw=$3,name_fr=$4,kind=$5,lat=$6,lng=$7,zone_id=$8,designated_pickup=$9,active=$10,updated_at=now(),updated_by=$11 where id=$1',
      [id, next.name_en, next.name_rw || null, next.name_fr || null, next.kind, next.lat, next.lng, zone, next.designated_pickup, next.active, req.auth!.id]);
    await audit(actorOf(req), 'place.updated', 'place', id, before, b);
    return { ok: true };
  });
  // CSV: name_en,name_rw,name_fr,kind,lat,lng,designated_pickup. All rows are checked first; nothing is saved unless every row is valid (dry_run only checks).
  app.post('/admin/places/import', places, async (req) => {
    const b = parse(z.object({ csv: z.string().min(5).max(400_000), dry_run: z.boolean().default(false) }), req.body);
    const rows = parseCsv(b.csv);
    if (rows.length < 2) throw badRequest('csv_empty', 'The file needs a header row and at least one place');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    for (const need of ['name_en', 'lat', 'lng']) if (!head.includes(need)) throw badRequest('csv_header', `Missing column: ${need}. Expected: name_en, name_rw, name_fr, kind, lat, lng, designated_pickup`);
    if (rows.length - 1 > 500) throw badRequest('csv_too_long', 'At most 500 places per file');
    const col = (r: string[], n: string) => { const i = head.indexOf(n); return i < 0 ? '' : (r[i] ?? '').trim(); };
    const errors: { row: number; message: string }[] = [], ok: z.infer<typeof placeBody>[] = [];
    const seen: { name: string; lat: number; lng: number }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], n = i + 1;
      const lat = Number(col(r, 'lat')), lng = Number(col(r, 'lng'));
      const kind = (col(r, 'kind') || 'landmark').toLowerCase();
      const pick = col(r, 'designated_pickup').toLowerCase();
      const cand = { name_en: col(r, 'name_en'), name_rw: col(r, 'name_rw') || null, name_fr: col(r, 'name_fr') || null, kind, lat, lng, designated_pickup: ['1', 'true', 'yes', 'y'].includes(pick), active: true };
      const p = placeBody.safeParse(cand);
      if (!p.success) { errors.push({ row: n, message: p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') }); continue; }
      if (!['', '0', '1', 'true', 'false', 'yes', 'no', 'y', 'n'].includes(pick)) { errors.push({ row: n, message: 'designated_pickup must be yes/no' }); continue; }
      if (!inRwanda(lat, lng)) { errors.push({ row: n, message: 'Coordinates are outside Rwanda' }); continue; }
      if (seen.some((s) => s.name.toLowerCase() === p.data.name_en.toLowerCase() && haversineM(s, { lat, lng }) < 150)) { errors.push({ row: n, message: 'Duplicate of another row in this file' }); continue; }
      if (await nearDuplicate(p.data.name_en, lat, lng)) { errors.push({ row: n, message: 'Already exists (same name within 150 m)' }); continue; }
      seen.push({ name: p.data.name_en, lat, lng }); ok.push(p.data);
    }
    if (errors.length || b.dry_run) return { ok: !errors.length, dry_run: b.dry_run, valid: ok.length, errors: errors.slice(0, 50), error_count: errors.length };
    await tx(async (c) => {
      for (const p of ok) await q('insert into places(name_en,name_rw,name_fr,kind,lat,lng,zone_id,designated_pickup,active,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)',
        [p.name_en, p.name_rw, p.name_fr, p.kind, p.lat, p.lng, await zoneOfPoint(p.lat, p.lng), p.designated_pickup, req.auth!.id], c);
      await audit(actorOf(req), 'place.imported', 'place', null, undefined, { count: ok.length }, c);
    });
    return { ok: true, dry_run: false, created: ok.length, errors: [], error_count: 0 };
  });

  // =================================================================== ZONES (coverage)
  const zonesView = { preHandler: requireAnyPerm('zones.manage', 'pricing.manage') };
  app.get('/admin/zones', zonesView, async () => ({
    zones: (await q<any>(`select z.id, z.name, z.polygon, z.active, z.config, z.updated_at,
        (select count(*)::int from zone_services zs where zs.zone_id=z.id and zs.enabled) services_enabled,
        (select count(*)::int from places p where p.zone_id=z.id and p.active) places from service_zones z order by z.name`))
      .map((z) => ({ ...z, area_km2: +ringAreaKm2(z.polygon).toFixed(2), shape: z.config?.shape ?? 'polygon' })),
  }));
  const zoneBody = z.object({
    name: z.string().trim().min(2).max(60), active: z.boolean().default(true),
    polygon: z.array(z.tuple([z.number(), z.number()])).min(4).max(501).optional(),
    circle: z.object({ lat: latv, lng: lngv, radius_m: z.number().min(200).max(150_000) }).optional(),
  }).refine((b) => !!b.polygon !== !!b.circle, { message: 'Give either a polygon or a circle (centre and radius)' });
  // Create or replace a zone. The id is permanent (prices and services refer to it); the name, shape and active flag can change.
  app.put('/admin/zones/:id', { preHandler: requirePerm('zones.manage') }, async (req) => {
    const { id } = parse(z.object({ id: z.string().regex(/^[a-z0-9_-]{2,30}$/) }), req.params);
    const b = parse(zoneBody, req.body);
    const ring: Ring = b.circle ? circleToRing(b.circle.lat, b.circle.lng, b.circle.radius_m) : (b.polygon as Ring);
    validateRing(ring);
    const before = await q1<any>('select name, active, config from service_zones where id=$1', [id]);
    if (await q1('select 1 from service_zones where lower(name)=lower($1) and id<>$2', [b.name, id])) throw conflict('zone_name_taken', 'Another zone already has this name');
    if (before?.active && !b.active) {
      const others = await q1<{ n: number }>('select count(*)::int n from service_zones where active and id<>$1', [id]);
      if (!others!.n) throw conflict('last_zone', 'This is the last active zone. Customers could not book anywhere. Create or enable another zone first.');
    }
    const others = await q<any>('select id, name, polygon from service_zones where active and id<>$1', [id]);
    const cfg = b.circle ? { shape: 'circle', center: [b.circle.lng, b.circle.lat], radius_m: b.circle.radius_m } : { shape: 'polygon' };
    await q(`insert into service_zones(id,name,polygon,active,config,updated_by) values ($1,$2,$3,$4,$5,$6)
             on conflict (id) do update set name=excluded.name, polygon=excluded.polygon, active=excluded.active, config=service_zones.config || excluded.config, updated_at=now(), updated_by=excluded.updated_by`,
      [id, b.name, JSON.stringify(ring), b.active, JSON.stringify(cfg), req.auth!.id]);
    await audit(actorOf(req), before ? 'zone.updated' : 'zone.created', 'zone', id, before, { name: b.name, active: b.active, shape: cfg.shape, points: ring.length, circle: b.circle });
    const warnings = b.active ? overlaps(ring, others) : [];
    return { ok: true, created: !before, warnings: warnings.length ? [`Overlaps ${warnings.join(', ')}. A booking uses the first zone that matches, so overlapping areas can behave unexpectedly.`] : [] };
  });
  app.post('/admin/zones/:id/active', { preHandler: requirePerm('zones.manage') }, async (req) => {
    const { id } = parse(z.object({ id: z.string().regex(/^[a-z0-9_-]{2,30}$/) }), req.params);
    const b = parse(z.object({ active: z.boolean(), reason }), req.body);
    const before = await q1<any>('select name, active from service_zones where id=$1', [id]);
    if (!before) throw notFound('zone');
    if (before.active === b.active) return { ok: true };
    if (!b.active) {
      const others = await q1<{ n: number }>('select count(*)::int n from service_zones where active and id<>$1', [id]);
      if (!others!.n) throw conflict('last_zone', 'This is the last active zone. Customers could not book anywhere. Create or enable another zone first.');
      const open = await q1<{ n: number }>("select count(*)::int n from bookings where zone_id=$1 and status in ('REQUESTED','SEARCHING_DRIVER','SCHEDULED','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS')", [id]).catch(() => ({ n: 0 }));
      if (open && open.n) throw conflict('zone_in_use', `${open.n} trip(s) in this zone are still open. Disable the zone after they finish.`, { open: open.n });
    }
    await q('update service_zones set active=$2, updated_at=now(), updated_by=$3 where id=$1', [id, b.active, req.auth!.id]);
    await audit(actorOf(req), b.active ? 'zone.enabled' : 'zone.disabled', 'zone', id, { active: before.active }, { active: b.active, reason: b.reason });
    return { ok: true };
  });

  // =================================================================== DRIVER DOCUMENT REQUIREMENTS
  const reqs = { preHandler: requirePerm('requirements.manage') };
  const vehicleTypes = async () => {
    const rows = await q<{ t: string }>(`select distinct t from (select unnest(vehicle_types) t from service_categories union select vehicle_type from document_requirements union select 'abasare') x order by t`);
    return rows.map((r) => r.t);
  };
  app.get('/admin/document-requirements', reqs, async () => ({
    requirements: await q('select id, vehicle_type, doc_type, mandatory, requires_expiry from document_requirements order by vehicle_type, id'),
    vehicle_types: await vehicleTypes(), doc_types: KNOWN_DOCS.map((k) => ({ key: k, label: DOC_LABELS[k] })),
  }));
  const guardLastMandatory = async (vehicleType: string, exceptId: number) => {
    const left = await q1<{ n: number }>('select count(*)::int n from document_requirements where vehicle_type=$1 and mandatory and id<>$2', [vehicleType, exceptId]);
    if (!left!.n) throw conflict('last_required_document', 'Each vehicle type needs at least one mandatory document, otherwise drivers could be approved without any checks.');
  };
  app.post('/admin/document-requirements', reqs, async (req) => {
    const b = parse(z.object({ vehicle_type: z.string().regex(/^[a-z_]{2,20}$/), doc_type: z.enum(KNOWN_DOCS as [string, ...string[]]), mandatory: z.boolean().default(true), requires_expiry: z.boolean().default(true), reason }), req.body);
    if (!(await vehicleTypes()).includes(b.vehicle_type)) throw badRequest('unknown_vehicle_type', 'Unknown vehicle type');
    if (await q1('select 1 from document_requirements where vehicle_type=$1 and doc_type=$2', [b.vehicle_type, b.doc_type])) throw conflict('requirement_exists', 'This document is already listed for that vehicle type');
    const r = await q1<any>('insert into document_requirements(vehicle_type,doc_type,mandatory,requires_expiry) values ($1,$2,$3,$4) returning id', [b.vehicle_type, b.doc_type, b.mandatory, b.requires_expiry]);
    await audit(actorOf(req), 'docreq.created', 'document_requirement', String(r.id), undefined, b);
    return { ok: true, id: r.id };
  });
  app.patch('/admin/document-requirements/:id', reqs, async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const b = parse(z.object({ mandatory: z.boolean().optional(), requires_expiry: z.boolean().optional(), reason }), req.body);
    const before = await q1<any>('select vehicle_type, doc_type, mandatory, requires_expiry from document_requirements where id=$1', [id]);
    if (!before) throw notFound('requirement');
    if (b.mandatory === false && before.mandatory) await guardLastMandatory(before.vehicle_type, id);
    await q('update document_requirements set mandatory=coalesce($2,mandatory), requires_expiry=coalesce($3,requires_expiry) where id=$1', [id, b.mandatory ?? null, b.requires_expiry ?? null]);
    await audit(actorOf(req), 'docreq.updated', 'document_requirement', String(id), before, b);
    return { ok: true };
  });
  app.delete('/admin/document-requirements/:id', reqs, async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const b = parse(z.object({ reason }), req.body);
    const before = await q1<any>('select vehicle_type, doc_type, mandatory, requires_expiry from document_requirements where id=$1', [id]);
    if (!before) throw notFound('requirement');
    if (before.mandatory) await guardLastMandatory(before.vehicle_type, id);
    await q('delete from document_requirements where id=$1', [id]);
    await audit(actorOf(req), 'docreq.deleted', 'document_requirement', String(id), before, { reason: b.reason });
    return { ok: true };
  });

  // =================================================================== HELP CENTRE / FAQ
  const faq = { preHandler: requirePerm('faq.manage') };
  const faqText = (max: number) => z.string().trim().max(max);
  const faqBody = z.object({ q_en: faqText(200), a_en: faqText(1500), q_rw: faqText(200), a_rw: faqText(1500), q_fr: faqText(200), a_fr: faqText(1500), published: z.boolean().default(false) });
  const complete = (b: Record<string, any>) => ['q_en', 'a_en', 'q_rw', 'a_rw', 'q_fr', 'a_fr'].every((k) => String(b[k] ?? '').trim().length >= 3);
  app.get('/admin/faq', faq, async () => ({ faq: await q('select * from faq_entries order by sort, id') }));
  app.post('/admin/faq', faq, async (req) => {
    const b = parse(faqBody, req.body);
    if (b.published && !complete(b)) throw badRequest('faq_incomplete', 'A published entry needs the question and answer in English, Kinyarwanda and French. Save it as a draft until all six are written.');
    const id = 'faq_' + Math.random().toString(36).slice(2, 9);
    const sort = ((await q1<{ m: number }>('select coalesce(max(sort),0)::int m from faq_entries'))!.m) + 10;
    await q('insert into faq_entries(id,q_en,a_en,q_rw,a_rw,q_fr,a_fr,sort,published,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, b.q_en, b.a_en, b.q_rw, b.a_rw, b.q_fr, b.a_fr, sort, b.published, req.auth!.id]);
    await audit(actorOf(req), 'faq.created', 'faq', id, undefined, { q_en: b.q_en, published: b.published });
    return { ok: true, id };
  });
  app.patch('/admin/faq/:id', faq, async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const b = parse(faqBody.partial(), req.body);
    const before = await q1<any>('select * from faq_entries where id=$1', [id]);
    if (!before) throw notFound('FAQ entry');
    const next = { ...before, ...b };
    if (next.published && !complete(next)) throw badRequest('faq_incomplete', 'A published entry needs the question and answer in English, Kinyarwanda and French.');
    await q('update faq_entries set q_en=$2,a_en=$3,q_rw=$4,a_rw=$5,q_fr=$6,a_fr=$7,published=$8,updated_by=$9,updated_at=now() where id=$1', [id, next.q_en, next.a_en, next.q_rw, next.a_rw, next.q_fr, next.a_fr, next.published, req.auth!.id]);
    await audit(actorOf(req), b.published !== undefined && b.published !== before.published ? (b.published ? 'faq.published' : 'faq.unpublished') : 'faq.updated', 'faq', id, { q_en: before.q_en, published: before.published }, { q_en: next.q_en, published: next.published });
    return { ok: true };
  });
  app.delete('/admin/faq/:id', faq, async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const before = await q1<any>('select q_en from faq_entries where id=$1', [id]);
    if (!before) throw notFound('FAQ entry');
    await q('delete from faq_entries where id=$1', [id]);
    await audit(actorOf(req), 'faq.deleted', 'faq', id, before);
    return { ok: true };
  });
  app.post('/admin/faq/order', faq, async (req) => {
    const b = parse(z.object({ ids: z.array(z.string().max(40)).min(1).max(200) }), req.body);
    await tx(async (c) => { for (let i = 0; i < b.ids.length; i++) await q('update faq_entries set sort=$2, updated_at=now() where id=$1', [b.ids[i], (i + 1) * 10], c); });
    await audit(actorOf(req), 'faq.reordered', 'faq', null, undefined, { ids: b.ids });
    return { ok: true };
  });

  // =================================================================== SUPPORT CATEGORIES AND SLA
  const sup = { preHandler: requirePerm('support.configure') };
  app.get('/admin/support-categories', sup, async () => ({
    categories: await q(`select c.category, c.priority, c.sla_hours, c.sensitive, c.updated_at,
      (select count(*)::int from support_cases s where s.category=c.category and s.status in ('open','in_progress','awaiting_user')) open_cases from support_categories c order by c.sla_hours, c.category`),
  }));
  app.patch('/admin/support-categories/:category', sup, async (req) => {
    const { category } = parse(z.object({ category: z.string().max(30) }), req.params);
    const b = parse(z.object({ priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), sla_hours: z.number().int().min(1).max(720).optional(), sensitive: z.boolean().optional(), reason }), req.body);
    const before = await q1<any>('select priority, sla_hours, sensitive from support_categories where category=$1', [category]);
    if (!before) throw notFound('category');
    const next = { ...before, ...Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'reason' && (b as any)[k] !== undefined)) };
    if (category === 'safety') {   // safety cases must stay urgent, restricted and quick
      if (!['urgent', 'high'].includes(next.priority)) throw badRequest('safety_priority', 'Safety cases must stay Urgent or High priority');
      if (!next.sensitive) throw badRequest('safety_sensitive', 'Safety cases must stay marked sensitive');
      if (next.sla_hours > 24) throw badRequest('safety_sla', 'Safety cases must be answered within 24 hours');
    }
    await q('update support_categories set priority=$2, sla_hours=$3, sensitive=$4, updated_by=$5, updated_at=now() where category=$1', [category, next.priority, next.sla_hours, next.sensitive, req.auth!.id]);
    await audit(actorOf(req), 'support_category.updated', 'support_category', category, before, { ...next, reason: b.reason });
    return { ok: true };
  });

  // =================================================================== FEATURE FLAGS and NOTIFICATION WORDING (reads; writes stay in admin.ts)
  const settingsPre = { preHandler: requirePerm('settings.manage') };
  app.get('/admin/flags', settingsPre, async () => ({
    regulated: ['pricing.surge', 'pricing.negotiated', 'payments.wallet'],
    flags: await q(`select f.key, f.enabled, f.description, f.updated_at, u.display_name updated_by_name,
      (select a.after->>'reason' from audit_logs a where a.entity_type='flag' and a.entity_id=f.key order by a.id desc limit 1) last_reason from feature_flags f left join users u on u.id=f.updated_by order by f.key`),
  }));
  app.get('/admin/templates', settingsPre, async () => {
    const over = await q<any>('select key, lang, title, body from notification_templates');
    const ov = new Map(over.map((o) => [`${o.key}:${o.lang}`, o]));
    const out: any[] = [];
    for (const [key, langs] of Object.entries(DEFAULT_TEMPLATES)) for (const lang of ['en', 'rw', 'fr'] as const) {
      const d = langs[lang], o = ov.get(`${key}:${lang}`);
      out.push({ key, lang, default_title: d.title, default_body: d.body, title: o?.title ?? d.title, body: o?.body ?? d.body, overridden: !!o, placeholders: [...new Set([...d.body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))] });
    }
    return { templates: out };
  });
  app.delete('/admin/templates/:key/:lang', settingsPre, async (req) => {
    const p = parse(z.object({ key: z.string().max(60), lang: z.enum(['rw', 'en', 'fr', 'sw']) }), req.params);
    const r = await q1("delete from notification_templates where key=$1 and lang=$2 returning key", [p.key, p.lang]);
    if (!r) throw notFound('override');
    await audit(actorOf(req), 'template.reverted', 'template', `${p.key}:${p.lang}`); return { ok: true };
  });
}

import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { raiseAlert } from '../services/alerts.js';
import { z } from 'zod';
import { parse, lat, lng } from '../util/validate.js';
import { anyAuth, routeLimit } from '../guards.js';
import { q, q1, tx } from '../db.js';
import { notFound, badRequest, conflict } from '../errors.js';
import { notify } from '../services/notify.js';
import { saveFile } from '../services/storage.js';
import { getSetting } from '../services/settings.js';
import { sms } from '../providers/sms.js';
import { pickLang } from '../services/errmsg.js';
import { randomBytes } from 'node:crypto';

const refOf = (p: string) => p + '-' + randomBytes(4).toString('hex').toUpperCase();
const PRIORITY: Record<string, [string, number, boolean]> = {   // priority, SLA hours, sensitive
  safety: ['urgent', 2, true], payment: ['high', 8, false], refund: ['high', 24, false], fare_dispute: ['high', 24, false], driver_complaint: ['normal', 24, true],
  lost_item: ['normal', 24, false], booking: ['normal', 24, false], appeal: ['normal', 72, false], account: ['normal', 48, false], other: ['low', 72, false],
};

/** Priority / deadline / sensitivity per category: edited in the console (table support_categories); these constants are only the fallback if the table is unreadable. */
async function categoryRule(category: string): Promise<[string, number, boolean]> {
  const r = await q1<any>('select priority, sla_hours, sensitive from support_categories where category=$1', [category]).catch(() => undefined);
  return r ? [r.priority, r.sla_hours, r.sensitive] : PRIORITY[category];
}

export async function supportRoutes(app: FastifyInstance) {
  const pre = { preHandler: anyAuth };
  // Help centre entries are edited in the console (table faq_entries); only published ones reach the app.
  app.get('/support/faq', async () => ({ faq: await q('select id, q_en, a_en, q_rw, a_rw, q_fr, a_fr from faq_entries where published order by sort, id') }));

  app.post('/support/cases', { ...pre, config: routeLimit('CASE_RATE_MAX', 10) }, async (req) => {
    const b = parse(z.object({ category: z.enum(Object.keys(PRIORITY) as [string, ...string[]]), subject: z.string().min(3).max(140), body: z.string().min(3).max(2000), booking_id: z.string().uuid().optional() }), req.body);
    if (b.booking_id) {
      const own = await q1('select 1 from bookings where id=$1 and (passenger_id=$2 or driver_id=$2)', [b.booking_id, req.auth!.id]);
      if (!own) throw notFound('booking');
    }
    const [prio, sla, sens] = await categoryRule(b.category);
    return tx(async (c) => {
      const cs = (await q<any>(`insert into support_cases(ref, booking_id, reporter_id, category, priority, subject, sensitive, sla_due_at)
        values ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(hours => $8)) returning id, ref, status, priority, sla_due_at`, [refOf('CS'), b.booking_id ?? null, req.auth!.id, b.category, prio, b.subject, sens, sla], c))[0];
      await q("insert into case_events(case_id, author_id, kind, body) values ($1,$2,'message',$3)", [cs.id, req.auth!.id, b.body], c);
      return cs;
    });
  });

  app.get('/support/cases', pre, async (req) => ({ cases: await q('select id, ref, category, priority, status, subject, created_at, updated_at, csat from support_cases where reporter_id=$1 order by created_at desc limit 50', [req.auth!.id]) }));
  app.get('/support/cases/:id', pre, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const c = await q1<any>('select id, ref, category, priority, status, subject, resolution, csat, created_at from support_cases where id=$1 and reporter_id=$2', [id, req.auth!.id]);
    if (!c) throw notFound('case');
    const events = await q("select id, author_id, kind, body, created_at from case_events where case_id=$1 and visibility='public' order by id", [id]);   // internal notes never leave staff tools
    return { ...c, events };
  });
  app.post('/support/cases/:id/messages', { ...pre, config: routeLimit('CASE_RATE_MAX', 10) }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(z.object({ body: z.string().min(1).max(2000) }), req.body);
    const c = await q1<any>('select status from support_cases where id=$1 and reporter_id=$2', [id, req.auth!.id]);
    if (!c) throw notFound('case');
    await q("insert into case_events(case_id, author_id, kind, body) values ($1,$2,'message',$3)", [id, req.auth!.id, b.body]);
    await q("update support_cases set updated_at=now(), status = case when status in ('awaiting_user','resolved') then 'open' else status end where id=$1", [id]);
    return { ok: true };
  });
  app.post('/support/cases/:id/evidence', { ...pre, config: routeLimit('UPLOAD_RATE_MAX', 20) }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const c = await q1<any>('select id from support_cases where id=$1 and reporter_id=$2', [id, req.auth!.id]);
    if (!c) throw notFound('case');
    const have = await q1<{ n: number }>("select count(*)::int n from case_events where case_id=$1 and kind='evidence'", [id]);
    if (have!.n >= 20) throw conflict('limit', 'Too many attachments on this case');
    let buf: Buffer | null = null;
    for await (const p of req.parts({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } })) if (p.type === 'file') buf = await p.toBuffer();
    if (!buf) throw badRequest('file_required');
    const s = await saveFile(buf, 'evidence');
    await q("insert into case_events(case_id, author_id, kind, body, file_key) values ($1,$2,'evidence','Evidence attached',$3)", [id, req.auth!.id, s.key]);
    return { ok: true };
  });
  app.post('/support/cases/:id/csat', pre, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(z.object({ score: z.number().int().min(1).max(5) }), req.body);
    const r = await q("update support_cases set csat=$3 where id=$1 and reporter_id=$2 and status in ('resolved','closed') returning id", [id, req.auth!.id, b.score]);
    if (!r.length) throw conflict('not_resolved', 'Feedback is available after resolution');
    return { ok: true };
  });

  // ---- safety ----
  app.post('/safety/sos', { ...pre, config: routeLimit('SOS_RATE_MAX', 6) }, async (req) => {
    const b = parse(z.object({ booking_id: z.string().uuid().optional(), lat: lat.optional(), lng: lng.optional() }), req.body);
    let loc = { lat: b.lat ?? null, lng: b.lng ?? null };
    if (b.booking_id) {
      const bk = await q1<any>('select passenger_id, driver_id from bookings where id=$1', [b.booking_id]);
      if (!bk || (bk.passenger_id !== req.auth!.id && bk.driver_id !== req.auth!.id)) throw notFound('booking');
      if (loc.lat == null) {
        const d = bk.driver_id ? await q1<any>('select last_lat, last_lng from driver_profiles where user_id=$1', [bk.driver_id]) : null;
        if (d?.last_lat != null) loc = { lat: d.last_lat, lng: d.last_lng };
      }
    }
    const inc = await tx(async (c) => {
      const i = (await q<any>("insert into safety_incidents(ref, booking_id, reporter_id, kind, lat, lng, description) values ($1,$2,$3,'sos',$4,$5,'SOS activated') returning id, ref, created_at", [refOf('SOS'), b.booking_id ?? null, req.auth!.id, loc.lat, loc.lng], c))[0];
      await q(`insert into support_cases(ref, booking_id, reporter_id, category, priority, subject, sensitive, sla_due_at) values ($1,$2,$3,'safety','urgent',$4,true, now() + interval '15 minutes')`, [refOf('CS'), b.booking_id ?? null, req.auth!.id, `SOS ${i.ref}`], c);
      return i;
    });
    // Best-effort alert to configured escalation contacts. We only report what actually happened.
    let alerted = 0;
    const contacts = [...new Set([...((await getSetting('safety.escalation_contacts')) as string[]), config.supportPhone])];   // the owner's support number always hears about an SOS
    for (const phone of contacts) {
      try { await sms.send(phone, `SOS ${inc.ref}: user needs help${loc.lat != null ? ` near ${loc.lat.toFixed(5)},${loc.lng!.toFixed(5)}` : ''}. Open the safety console.`); alerted++; } catch { /* reported below */ }
    }
    await notify(req.auth!.id, 'sos_ack', { ref: inc.ref }, { critical: true });
    await raiseAlert({ kind: 'sos', severity: 'critical', title: `SOS ${inc.ref}${loc.lat != null ? ' (location known)' : ''}`, detail: { incident: inc.ref, booking_id: b.booking_id ?? null, lat: loc.lat, lng: loc.lng }, actorId: req.auth!.id, dedupe: `sos:${inc.ref}` });
    const mapLink = loc.lat != null ? ` https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=17/${loc.lat}/${loc.lng}` : '';
    return {
      incident: inc.ref, recorded: true, location_recorded: loc.lat != null,
      escalation_sms_sent_to_contacts: alerted, human_response_confirmed: false,
      message: pickLang(req, {
        en: 'Your SOS is recorded. No one has confirmed contact yet. If you are in danger call 112 (police) or 912 (ambulance) now.',
        fr: 'Votre SOS est enregistré. Personne n\'a encore confirmé vous avoir contacté. Si vous êtes en danger, appelez dès maintenant le 112 (police) ou le 912 (ambulance).',
        rw: 'SOS yawe yanditswe. Nta muntu uremeza ko yakuvugishije. Niba uri mu kaga, hamagara ubu 112 (Polisi) cyangwa 912 (ambulance).' }),
      emergency_numbers: { police: '112', ambulance: '912', traffic_police: '113' },
      support: { name: config.supportName, phone: config.supportPhone, alerted: true },
      share_text: `SOS ${inc.ref}: I need help.${mapLink}`,
    };
  });

  app.post('/safety/incidents', { ...pre, config: routeLimit('CASE_RATE_MAX', 10) }, async (req) => {
    const b = parse(z.object({ kind: z.enum(['accident', 'harassment', 'misconduct', 'lost_property', 'other']), booking_id: z.string().uuid().optional(), description: z.string().min(5).max(2000), lat: lat.optional(), lng: lng.optional() }), req.body);
    if (b.booking_id) {
      const own = await q1('select 1 from bookings where id=$1 and (passenger_id=$2 or driver_id=$2)', [b.booking_id, req.auth!.id]);
      if (!own) throw notFound('booking');
    }
    const i = await q1<any>('insert into safety_incidents(ref, booking_id, reporter_id, kind, lat, lng, description) values ($1,$2,$3,$4,$5,$6,$7) returning id, ref, status', [refOf('INC'), b.booking_id ?? null, req.auth!.id, b.kind, b.lat ?? null, b.lng ?? null, b.description]);
    return i;
  });
}

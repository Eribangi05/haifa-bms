import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, lat, lng } from '../util/validate.js';
import { anyAuth, actorOf, routeLimit } from '../guards.js';
import { q, q1, tx } from '../db.js';
import { notFound, badRequest, conflict } from '../errors.js';
import { notify } from '../services/notify.js';
import { saveFile } from '../services/storage.js';
import { getSetting } from '../services/settings.js';
import { sms } from '../providers/sms.js';
import { randomBytes } from 'node:crypto';
import { sharedView } from '../services/bookings.js';

const refOf = (p: string) => p + '-' + randomBytes(4).toString('hex').toUpperCase();
const PRIORITY: Record<string, [string, number, boolean]> = {   // priority, SLA hours, sensitive
  safety: ['urgent', 2, true], payment: ['high', 8, false], refund: ['high', 24, false], fare_dispute: ['high', 24, false], driver_complaint: ['normal', 24, true],
  lost_item: ['normal', 24, false], booking: ['normal', 24, false], appeal: ['normal', 72, false], account: ['normal', 48, false], other: ['low', 72, false],
};

export const FAQ = [
  { id: 'cancel', q_en: 'How do I cancel a ride?', a_en: 'Open your active trip and tap Cancel. Cancelling soon after a driver is assigned is free.',
    q_rw: 'Nahagarika nte urugendo?', a_rw: 'Fungura urugendo rwawe urimo hanyuma ukande "Guhagarika". Guhagarika mu gihe gito nyuma yo guhabwa umushoferi nta kiguzi bisaba.',
    q_fr: 'Comment annuler une course ?', a_fr: 'Ouvrez votre course en cours et appuyez sur Annuler. L\'annulation peu de temps après l\'attribution d\'un chauffeur est gratuite.' },
  { id: 'pin', q_en: 'What is the trip PIN?', a_en: 'A 4-digit code shown only to you. Give it to your driver to start the trip after checking their plate.',
    q_rw: 'PIN y\'urugendo ni iki?', a_rw: 'Ni kode y\'imibare 4 igaragara kuri wowe wenyine. Yihe umushoferi kugira ngo urugendo rutangire, nyuma yo kugenzura plaque y\'imodoka ye.',
    q_fr: 'Qu\'est-ce que le code PIN de la course ?', a_fr: 'C\'est un code à 4 chiffres visible uniquement par vous. Donnez-le à votre chauffeur pour démarrer la course, après avoir vérifié sa plaque.' },
  { id: 'pay', q_en: 'How can I pay?', a_en: 'Pay cash to the driver or with MTN Mobile Money. Payment is confirmed by the provider, not by a screenshot.',
    q_rw: 'Nishyura nte?', a_rw: 'Ushobora kwishyura mu ntoki umushoferi cyangwa ukoresheje MTN Mobile Money. Kwishyura byemezwa na MTN, ntibyemezwa n\'ifoto y\'ubutumwa.',
    q_fr: 'Comment puis-je payer ?', a_fr: 'Payez en espèces au chauffeur ou avec MTN Mobile Money. Le paiement est confirmé par l\'opérateur, et non par une capture d\'écran.' },
  { id: 'lost', q_en: 'I left something in the vehicle', a_en: 'Open the trip in History and tap Report a problem > Lost item.',
    q_rw: 'Nibagiwe ikintu mu modoka', a_rw: 'Fungura urugendo mu mateka y\'ingendo, ukande "Gutanga ikibazo" hanyuma uhitemo "Ikintu cyatakaye".',
    q_fr: 'J\'ai oublié un objet dans le véhicule', a_fr: 'Ouvrez la course dans l\'Historique, puis appuyez sur Signaler un problème > Objet perdu.' },
  { id: 'sos', q_en: 'What if I feel unsafe?', a_en: 'Use the SOS button. We record your trip and location and alert our team. Also call 112 (police) or 912 (ambulance).',
    q_rw: 'Nakora iki niba numva ntatekanye?', a_rw: 'Kanda buto ya SOS. Duhita twandika urugendo n\'aho uri, tukamenyesha itsinda ryacu. Hamagara kandi 112 (Polisi) cyangwa 912 (ambulance).',
    q_fr: 'Que faire si je ne me sens pas en sécurité ?', a_fr: 'Utilisez le bouton SOS. Nous enregistrons votre course et votre position et alertons notre équipe. Appelez aussi le 112 (police) ou le 912 (ambulance).' },
];

export async function supportRoutes(app: FastifyInstance) {
  const pre = { preHandler: anyAuth };
  app.get('/support/faq', async () => ({ faq: FAQ }));

  app.post('/support/cases', pre, async (req) => {
    const b = parse(z.object({ category: z.enum(Object.keys(PRIORITY) as [string, ...string[]]), subject: z.string().min(3).max(140), body: z.string().min(3).max(2000), booking_id: z.string().uuid().optional() }), req.body);
    if (b.booking_id) {
      const own = await q1('select 1 from bookings where id=$1 and (passenger_id=$2 or driver_id=$2)', [b.booking_id, req.auth!.id]);
      if (!own) throw notFound('booking');
    }
    const [prio, sla, sens] = PRIORITY[b.category];
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
  app.post('/support/cases/:id/messages', pre, async (req) => {
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
  app.post('/safety/sos', pre, async (req) => {
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
    for (const phone of (await getSetting('safety.escalation_contacts')) as string[]) {
      try { await sms.send(phone, `SOS ${inc.ref}: user needs help${loc.lat != null ? ` near ${loc.lat.toFixed(5)},${loc.lng!.toFixed(5)}` : ''}. Open the safety console.`); alerted++; } catch { /* reported below */ }
    }
    await notify(req.auth!.id, 'sos_ack', { ref: inc.ref }, { critical: true });
    return {
      incident: inc.ref, recorded: true, location_recorded: loc.lat != null,
      escalation_sms_sent_to_contacts: alerted, human_response_confirmed: false,
      message: 'Your SOS is recorded. No one has confirmed contact yet. If you are in danger call 112 (police) or 912 (ambulance) now.',
      emergency_numbers: { police: '112', ambulance: '912', traffic_police: '113' },
    };
  });

  app.post('/safety/incidents', pre, async (req) => {
    const b = parse(z.object({ kind: z.enum(['accident', 'harassment', 'misconduct', 'lost_property', 'other']), booking_id: z.string().uuid().optional(), description: z.string().min(5).max(2000), lat: lat.optional(), lng: lng.optional() }), req.body);
    if (b.booking_id) {
      const own = await q1('select 1 from bookings where id=$1 and (passenger_id=$2 or driver_id=$2)', [b.booking_id, req.auth!.id]);
      if (!own) throw notFound('booking');
    }
    const i = await q1<any>('insert into safety_incidents(ref, booking_id, reporter_id, kind, lat, lng, description) values ($1,$2,$3,$4,$5,$6,$7) returning id, ref, status', [refOf('INC'), b.booking_id ?? null, req.auth!.id, b.kind, b.lat ?? null, b.lng ?? null, b.description]);
    return i;
  });
}

// Campaign manager: marketing messages to a segment, sent through the notification pipeline (notifications table -> SMS / push workers).
// Rules: all three languages are mandatory; each person gets ONLY their own language; marketing opt-out (notif_prefs.marketing) and quiet hours
// (default 21:00-07:00 Kigali) are respected at send time; one row per person and campaign; a daily cap across campaigns; sent in batches.
import { z } from 'zod';
import { q, q1, tx } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { normalizeAnyPhone } from '../util/phone.js';
import { getSetting } from './settings.js';
import { audit, type Actor } from './audit.js';

export const segmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all_passengers') }), z.object({ type: z.literal('all_drivers') }),
  z.object({ type: z.literal('inactive_passengers'), days: z.number().int().min(1).max(730) }),
  z.object({ type: z.literal('corporate_members'), corporate_id: z.string().uuid().optional() }),
  z.object({ type: z.literal('zone'), zone_id: z.string().min(1).max(30), role: z.enum(['passenger', 'driver']).default('passenger') }),
  z.object({ type: z.literal('language'), lang: z.enum(['rw', 'fr', 'en']), role: z.enum(['passenger', 'driver']).optional() }),
  z.object({ type: z.literal('phone_list'), phones: z.array(z.string().max(20)).min(1).max(5000) }),
  z.object({ type: z.literal('abasare_owners') }),
]);
export type Segment = z.infer<typeof segmentSchema>;

export const campaignSchema = z.object({
  name: z.string().trim().min(2).max(120), channel: z.enum(['sms', 'push', 'inapp']), segment: segmentSchema,
  title_rw: z.string().trim().min(1).max(80), title_fr: z.string().trim().min(1).max(80), title_en: z.string().trim().min(1).max(80),
  msg_rw: z.string().trim().min(1).max(500), msg_fr: z.string().trim().min(1).max(500), msg_en: z.string().trim().min(1).max(500),
}).superRefine((c, ctx) => {
  if (c.channel === 'sms') for (const l of ['rw', 'fr', 'en'] as const) if ((c as any)[`msg_${l}`].length > 320) ctx.addIssue({ code: 'custom', path: [`msg_${l}`], message: 'An SMS message is limited to 320 characters' });
});

/** SQL fragment selecting users in the segment (no consent filter). Parameters are appended to `args`. */
function segmentWhere(seg: Segment, args: unknown[]): string {
  const role = (r: string) => `exists (select 1 from user_roles r where r.user_id=u.id and r.role='${r}')`;   // constant strings only
  switch (seg.type) {
    case 'all_passengers': return role('passenger');
    case 'all_drivers': return role('driver');
    case 'inactive_passengers': args.push(seg.days); return `${role('passenger')} and not exists (select 1 from bookings b where b.passenger_id=u.id and b.created_at > now() - make_interval(days => $${args.length}))`;
    case 'corporate_members': {
      if (seg.corporate_id) args.push(seg.corporate_id);
      return `exists (select 1 from corporate_members m where m.user_id=u.id and m.active${seg.corporate_id ? ` and m.corporate_id=$${args.length}` : ''})`;
    }
    case 'zone': args.push(seg.zone_id);
      return seg.role === 'driver' ? `exists (select 1 from driver_profiles dp where dp.user_id=u.id and dp.zone_id=$${args.length})` : `exists (select 1 from bookings b where b.passenger_id=u.id and b.zone_id=$${args.length})`;
    case 'language': args.push(seg.lang); return `u.preferred_language=$${args.length} and ${seg.role ? role(seg.role) : `(${role('passenger')} or ${role('driver')})`}`;
    case 'phone_list': args.push(seg.phones.map(normalizeAnyPhone).filter(Boolean)); return `u.phone = any($${args.length})`;
    case 'abasare_owners': return `exists (select 1 from customer_vehicles cv where cv.owner_id=u.id and cv.active)`;
  }
}
const langExpr = `case when u.preferred_language in ('rw','fr','en') then u.preferred_language else 'rw' end`;
const eligible = (channel: string) => `u.status='active' and u.notif_prefs->>'marketing' = 'true'` +
  (channel === 'sms' ? ` and u.phone is not null and coalesce(u.notif_prefs->>'sms','true') <> 'false'` : channel === 'push' ? ` and coalesce(u.notif_prefs->>'push','true') <> 'false'` : '');

/** How many people the segment matches, how many may actually be messaged (marketing consent + channel), and the language split. */
export async function previewAudience(channel: string, seg: Segment) {
  const args: unknown[] = [];
  const w = segmentWhere(seg, args);
  const r = await q1<any>(`select count(*)::int matched, count(*) filter (where ${eligible(channel)})::int eligible,
      count(*) filter (where ${eligible(channel)} and ${langExpr}='rw')::int rw, count(*) filter (where ${eligible(channel)} and ${langExpr}='fr')::int fr,
      count(*) filter (where ${eligible(channel)} and ${langExpr}='en')::int en from users u where ${w}`, args);
  return { matched: r.matched, eligible: r.eligible, skipped_no_consent: r.matched - r.eligible, by_language: { rw: r.rw, fr: r.fr, en: r.en } };
}

const CCOLS = 'id, name, channel, segment, title_rw, title_fr, title_en, msg_rw, msg_fr, msg_en, scheduled_at, status, stats, created_by, created_at, updated_at, started_at, finished_at';
export const getCampaign = async (id: string) => { const c = await q1<any>(`select ${CCOLS} from campaigns where id=$1`, [id]); if (!c) throw notFound('campaign'); return c; };
export const listCampaigns = () => q(`select ${CCOLS} from campaigns order by created_at desc limit 200`);

export async function createCampaign(actor: Actor, b: z.infer<typeof campaignSchema>) {
  const c = await q1<any>(`insert into campaigns(name,channel,segment,title_rw,title_fr,title_en,msg_rw,msg_fr,msg_en,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning ${CCOLS}`,
    [b.name, b.channel, JSON.stringify(b.segment), b.title_rw, b.title_fr, b.title_en, b.msg_rw, b.msg_fr, b.msg_en, actor.id]);
  await audit(actor, 'campaign.created', 'campaign', c.id, undefined, { name: b.name, channel: b.channel, segment: b.segment });
  return c;
}
export async function updateCampaign(actor: Actor, id: string, b: z.infer<typeof campaignSchema>) {
  const cur = await getCampaign(id);
  if (cur.status !== 'draft') throw conflict('campaign_not_editable', 'Only a draft campaign can be edited');
  const c = await q1<any>(`update campaigns set name=$2,channel=$3,segment=$4,title_rw=$5,title_fr=$6,title_en=$7,msg_rw=$8,msg_fr=$9,msg_en=$10,updated_at=now() where id=$1 returning ${CCOLS}`,
    [id, b.name, b.channel, JSON.stringify(b.segment), b.title_rw, b.title_fr, b.title_en, b.msg_rw, b.msg_fr, b.msg_en]);
  await audit(actor, 'campaign.updated', 'campaign', id, { name: cur.name, segment: cur.segment }, { name: b.name, segment: b.segment });
  return c;
}
export async function scheduleCampaign(actor: Actor, id: string, scheduledAt: Date) {
  const cur = await getCampaign(id);
  if (cur.status !== 'draft') throw conflict('campaign_not_editable', 'Only a draft campaign can be scheduled');
  const seg = segmentSchema.parse(cur.segment);
  const pv = await previewAudience(cur.channel, seg);
  const max = await getSetting('campaign.max_recipients');
  if (pv.eligible > max) throw conflict('campaign_too_large', 'This audience is larger than the allowed maximum', { max });
  if (pv.eligible === 0) throw badRequest('campaign_empty', 'Nobody in this segment can receive the message (no marketing consent)');
  const c = await q1<any>(`update campaigns set status='scheduled', scheduled_at=$2, stats=$3, updated_at=now() where id=$1 and status='draft' returning ${CCOLS}`, [id, scheduledAt, JSON.stringify({ targeted: pv.eligible, skipped_no_consent: pv.skipped_no_consent })]);
  await audit(actor, 'campaign.scheduled', 'campaign', id, undefined, { scheduled_at: scheduledAt, eligible: pv.eligible });
  return c;
}
export async function cancelCampaign(actor: Actor, id: string) {
  const c = await q1<any>(`update campaigns set status='cancelled', finished_at=now(), updated_at=now() where id=$1 and status in ('draft','scheduled','sending') returning ${CCOLS}`, [id]);
  if (!c) { await getCampaign(id); throw conflict('campaign_not_cancellable', 'This campaign is already finished'); }
  await audit(actor, 'campaign.cancelled', 'campaign', id);
  return c;
}

export const inQuietHours = (now: Date, startH: number, endH: number) => {
  const h = (now.getUTCHours() + 2) % 24;
  return startH === endH ? false : startH < endH ? h >= startH && h < endH : h >= startH || h < endH;
};

/** Send one message to the staff member who asks (test-send): their own account, the chosen language, clearly marked. Ignores consent by design. */
export async function testSend(actor: Actor, id: string, lang: 'rw' | 'fr' | 'en') {
  const c = await getCampaign(id);
  const u = await q1<any>('select phone from users where id=$1', [actor.id]);
  const title = `[TEST] ${c[`title_${lang}`]}`, body = c[`msg_${lang}`];
  await q(`insert into notifications(user_id, channel, template_key, params, title, body, lang, status, sent_at) values ($1,'in_app','campaign_test',$2,$3,$4,$5,'sent',now())`, [actor.id, JSON.stringify({ campaign_id: id }), title, body, lang]);
  let sms = false;
  if (c.channel === 'sms' && u?.phone) { await q(`insert into notifications(user_id, channel, template_key, params, title, body, lang) values ($1,'sms','campaign_test',$2,$3,$4,$5)`, [actor.id, JSON.stringify({ campaign_id: id }), title, `${title}: ${body}`, lang]); sms = true; }
  await audit(actor, 'campaign.test_sent', 'campaign', id, undefined, { lang });
  return { ok: true, lang, delivered_in_app: true, sms_queued: sms, title, body };
}

async function materialize(c: any) {
  const seg = segmentSchema.parse(c.segment);
  const args: unknown[] = [c.id];
  const w = segmentWhere(seg, args);
  const a2: unknown[] = [];
  const total = (await q1<any>(`select count(*)::int n from users u where ${segmentWhere(seg, a2)}`, a2))!.n;
  const ins = await q(`insert into campaign_recipients(campaign_id, user_id, lang) select $1, u.id, ${langExpr} from users u where ${w} and ${eligible(c.channel)} on conflict do nothing returning id`, args);
  await q('update campaigns set stats = stats || $2::jsonb where id=$1', [c.id, JSON.stringify({ targeted: ins.length, skipped_no_consent: total - ins.length })]);
}

/** Job. Starts due campaigns and sends the next batch of every running one, outside quiet hours. `now` is injectable for tests. */
export async function runCampaigns(now = new Date()) {
  const due = await q<any>("update campaigns set status='sending', started_at=$1 where status='scheduled' and scheduled_at <= $1 returning *", [now]);
  for (const c of due) await materialize(c);
  const [batch, qs, qe, perDay] = await Promise.all([getSetting('campaign.batch_size'), getSetting('campaign.quiet_start_hour'), getSetting('campaign.quiet_end_hour'), getSetting('campaign.max_per_user_per_day')]);
  if (inQuietHours(now, qs, qe)) return { started: due.length, sent: 0, quiet: true };
  let sent = 0;
  for (const c of await q<any>("select * from campaigns where status='sending' order by started_at")) {
    const rows = await tx(async (cx) => {
      const recs = await q<any>("select r.id, r.user_id, r.lang from campaign_recipients r where r.campaign_id=$1 and r.status='queued' order by r.id limit $2 for update skip locked", [c.id, batch], cx);
      for (const r of recs) {
        const u = await q1<any>('select status, phone, notif_prefs from users where id=$1', [r.user_id], cx);
        const setS = (s: string) => q('update campaign_recipients set status=$2, sent_at=case when $2=\'sent\' then $3::timestamptz else null end where id=$1', [r.id, s, now], cx);
        if (!u || u.status !== 'active' || u.notif_prefs?.marketing !== true) { await setS('skipped_optout'); continue; }   // opted out after the audience was fixed
        if (c.channel === 'sms' && (!u.phone || u.notif_prefs?.sms === false)) { await setS('skipped_no_channel'); continue; }
        const cnt = (await q1<any>("select count(*)::int n from campaign_recipients where user_id=$1 and status='sent' and sent_at > $2::timestamptz - interval '24 hours'", [r.user_id, now], cx))!.n;
        if (cnt >= perDay) { await setS('skipped_cap'); continue; }
        const title = c[`title_${r.lang}`], body = c[`msg_${r.lang}`];     // the recipient's own language only
        const params = JSON.stringify({ campaign_id: c.id });
        if (c.channel === 'sms') await q("insert into notifications(user_id, channel, template_key, params, title, body, lang, status) values ($1,'sms','campaign',$2,$3,$4,$5,'queued')", [r.user_id, params, title, body, r.lang], cx);
        else {
          await q("insert into notifications(user_id, channel, template_key, params, title, body, lang, status, sent_at) values ($1,'in_app','campaign',$2,$3,$4,$5,'sent',now())", [r.user_id, params, title, body, r.lang], cx);
          if (c.channel === 'push' && u.notif_prefs?.push !== false) await q("insert into notifications(user_id, channel, template_key, params, title, body, lang, status) values ($1,'push','campaign',$2,$3,$4,$5,'queued')", [r.user_id, params, title, body, r.lang], cx);
        }
        await setS('sent'); sent++;
      }
      return recs.length;
    });
    if (rows === 0 || !(await q1("select 1 from campaign_recipients where campaign_id=$1 and status='queued' limit 1", [c.id]))) {
      const st = await q<any>('select status, count(*)::int n from campaign_recipients where campaign_id=$1 group by status', [c.id]);
      const stats = Object.fromEntries(st.map((s) => [s.status, s.n]));
      await q("update campaigns set status='done', finished_at=$2, stats = stats || $3::jsonb, updated_at=now() where id=$1 and status='sending'", [c.id, now, JSON.stringify({ sent: stats.sent ?? 0, skipped_optout: stats.skipped_optout ?? 0, skipped_cap: stats.skipped_cap ?? 0, skipped_no_channel: stats.skipped_no_channel ?? 0 })]);
    }
  }
  return { started: due.length, sent, quiet: false };
}
export async function campaignDetail(id: string) {
  const c = await getCampaign(id);
  const st = await q<any>('select status, count(*)::int n from campaign_recipients where campaign_id=$1 group by status', [id]);
  const lg = await q<any>("select lang, count(*)::int n from campaign_recipients where campaign_id=$1 group by lang", [id]);
  return { ...c, recipients: Object.fromEntries(st.map((s) => [s.status, s.n])), by_language: Object.fromEntries(lg.map((s) => [s.lang, s.n])) };
}
void AppError;

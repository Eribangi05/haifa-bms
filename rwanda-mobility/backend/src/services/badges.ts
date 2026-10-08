import { q, q1, tx } from '../db.js';
import { conflict, notFound, badRequest } from '../errors.js';
import { audit, type Actor } from './audit.js';
import type { Lang } from './i18n.js';

export type Badge = { id: string; tier?: number; label: Record<Lang, string> };
const L = (en: string, rw: string, fr: string) => ({ en, rw, fr });

/** Badges are derived from approved, unexpired documents and real platform data. Only training_completed is granted by staff (audited). */
export async function driverBadges(driverId: string): Promise<Badge[]> {
  const r = await q1<any>(
    `select dp.status, dp.rating_avg, dp.rating_count, dp.completed_count, dp.abasare_skills,
      exists (select 1 from driver_documents d where d.driver_id=dp.user_id and d.doc_type='driving_licence' and not d.superseded and d.review_status='approved' and (d.expiry_date is null or d.expiry_date >= current_date)) licence,
      exists (select 1 from driver_documents d where d.driver_id=dp.user_id and d.doc_type='police_clearance' and not d.superseded and d.review_status='approved' and (d.expiry_date is null or d.expiry_date >= current_date)) police,
      exists (select 1 from driver_badge_grants g where g.driver_id=dp.user_id and g.badge='training_completed' and g.revoked_at is null) training
     from driver_profiles dp where dp.user_id=$1`, [driverId]);
  if (!r || r.status !== 'APPROVED') return [];
  const out: Badge[] = [];
  if (r.licence) {
    out.push({ id: 'licence_verified', label: L('Licence verified', 'Uruhushya rwo gutwara rwagenzuwe', 'Permis vérifié') });
    // experience comes from the licence date declared on the Abasare application, shown only when the licence document itself was approved
    const since = r.abasare_skills?.licence_since ? new Date(r.abasare_skills.licence_since) : null;
    const years = since && !Number.isNaN(since.getTime()) ? (Date.now() - since.getTime()) / (365.25 * 86400e3) : 0;
    const tier = years >= 10 ? 10 : years >= 5 ? 5 : years >= 2 ? 2 : 0;
    if (tier) out.push({ id: 'experience', tier, label: L(`${tier}+ years of experience`, `Imyaka irenga ${tier} afite uburambe`, `${tier} ans d'expérience et plus`) });
  }
  if (r.police) out.push({ id: 'police_clearance_valid', label: L('Police clearance valid', 'Icyemezo cy\'imyitwarire myiza gifite agaciro', 'Casier judiciaire valide') });
  const n = r.completed_count as number;
  const tt = n >= 1000 ? 1000 : n >= 500 ? 500 : n >= 100 ? 100 : n >= 25 ? 25 : 0;
  if (tt) out.push({ id: 'trips_completed', tier: tt, label: L(`${tt}+ trips completed`, `Ingendo zirenga ${tt} yarangije`, `${tt} courses et plus effectuées`) });
  if (Number(r.rating_avg) >= 4.8 && r.rating_count >= 10) out.push({ id: 'top_rated', label: L('Top rated', 'Yatoranyijwe cyane', 'Très bien noté') });
  if (r.training) out.push({ id: 'training_completed', label: L('Training completed', 'Yarangije amahugurwa', 'Formation terminée') });
  return out;
}

export async function setTraining(actor: Actor, driverId: string, granted: boolean, reason: string) {
  if (!reason || reason.trim().length < 5) throw badRequest('reason_required', 'A written reason is required');
  return tx(async (c) => {
    if (!(await q1('select 1 from driver_profiles where user_id=$1 for update', [driverId], c))) throw notFound('driver');
    const cur = await q1<any>("select id from driver_badge_grants where driver_id=$1 and badge='training_completed' and revoked_at is null", [driverId], c);
    if (granted) {
      if (cur) throw conflict('already_granted', 'Training is already recorded for this driver');
      await q("insert into driver_badge_grants(driver_id,badge,reason,granted_by) values ($1,'training_completed',$2,$3)", [driverId, reason.trim(), actor.id], c);
    } else {
      if (!cur) throw conflict('not_granted', 'This driver has no training badge');
      await q('update driver_badge_grants set revoked_at=now(), revoked_by=$2, revoke_reason=$3 where id=$1', [cur.id, actor.id, reason.trim()], c);
    }
    await audit(actor, granted ? 'driver.training_granted' : 'driver.training_revoked', 'driver', driverId, undefined, { reason }, c);
    return { ok: true, granted };
  });
}

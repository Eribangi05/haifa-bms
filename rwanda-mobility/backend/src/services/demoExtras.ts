import { randomUUID } from 'node:crypto';

/**
 * The people-and-operations half of the demo data (support, safety, alerts, claims, driver applications, partners, finance queues...). Runs inside the same
 * transaction as the trips. Everything points at demo users (staff, applicants, riders, drivers) so `clearDemo` removes it by foreign key.
 */
type Db = { query: (t: string, v?: any[]) => Promise<any> };
export type ExtraCtx = {
  now: number; rnd: () => number; pick: <T>(a: T[]) => T; name: () => string; riders: string[]; drivers: { id: string; kind: 'moto' | 'car'; abasare: boolean }[];
  done: { id: string; ref: string; passenger_id: string; driver_id: string; fare: number; payment_id: string }[]; tag: string;
};
const H = 3600e3, D = 864e5;

export async function loadExtras(c: Db, x: ExtraCtx) {
  const { now, rnd, pick } = x, iso = (ms: number) => new Date(ms).toISOString(), ago = (h: number) => iso(x.now - h * H);
  const ins = async (sql: string, v: unknown[]) => (await c.query(sql, v)).rows;

  // ---- staff team (cannot sign in: no password) ----
  const team: [string, string][] = [['Aline Uwase', 'super_admin'], ['Jean Claude Habimana', 'dispatcher'], ['Diane Mukamana', 'support_lead'], ['Patrick Nshuti', 'support_agent'], ['Eric Ndayisaba', 'driver_verifier'],
    ['Grace Ingabire', 'finance_officer'], ['Samuel Kamanzi', 'finance_approver'], ['Claudine Mutesi', 'business_manager'], ['Olivier Rugamba', 'analyst']];
  const staff: Record<string, string> = {};
  for (const [i, [n, role]] of team.entries()) {
    const id = randomUUID(); staff[role] = id;
    await c.query(`insert into users(id, email, display_name, preferred_language, device_fingerprint, created_at) values ($1,$2,$3,$4,$5,$6)`, [id, `${n.toLowerCase().replace(/[^a-z]+/g, '.')}@abasare.demo`, n, i % 3 === 0 ? 'en' : 'rw', x.tag, ago(24 * 40)]);
    await c.query('insert into user_roles(user_id, role) values ($1,$2)', [id, role]);
  }
  const agents = [staff.support_agent, staff.support_lead];

  // ---- approved documents for every demo driver (without them the hourly eligibility job would mark the drivers ineligible) ----
  const reqs = (await c.query('select vehicle_type, doc_type, requires_expiry from document_requirements where mandatory')).rows as { vehicle_type: string; doc_type: string; requires_expiry: boolean }[];
  const docRows: { driver_id: string; doc_type: string; expiry: string | null }[] = [];
  for (const d of x.drivers) for (const t of [d.kind, ...(d.abasare ? ['abasare'] : [])]) for (const r of reqs.filter((q) => q.vehicle_type === t))
    if (!docRows.some((q) => q.driver_id === d.id && q.doc_type === r.doc_type)) docRows.push({ driver_id: d.id, doc_type: r.doc_type, expiry: r.requires_expiry ? iso(x.now + 540 * D).slice(0, 10) : null });
  for (let i = 0; i < docRows.length; i += 400)
    await c.query(`insert into driver_documents(driver_id, doc_type, file_key, mime, size, expiry_date, review_status, reviewed_at)
      select driver_id, doc_type, 'docs/00000000-0000-0000-0000-000000000000.jpg', 'image/jpeg', 240000, expiry::date, 'approved', now() from json_to_recordset($1::json) as r(driver_id uuid, doc_type text, expiry text)`, [JSON.stringify(docRows.slice(i, i + 400))]);

  // ---- driver applications waiting for review ----
  const applicants: [string, string, string][] = [['DOCUMENTS_SUBMITTED', 'moto', ''], ['DOCUMENTS_SUBMITTED', 'car', ''], ['DOCUMENTS_SUBMITTED', 'moto', ''], ['DOCUMENTS_SUBMITTED', 'car', ''],
    ['UNDER_REVIEW', 'moto', ''], ['UNDER_REVIEW', 'car', ''], ['INFO_REQUIRED', 'moto', 'The insurance photo is blurred. Please send it again.'], ['SUSPENDED', 'moto', 'Three rider complaints about unsafe driving.']];
  let plateN = 0;
  for (const [i, [status, kind, why]] of applicants.entries()) {
    const id = randomUUID(), nm = x.name(), submitted = ago(2 + i * 9);
    await c.query('insert into users(id, phone, display_name, preferred_language, device_fingerprint, created_at) values ($1,$2,$3,$4,$5,$6)', [id, `+25078899${2001 + i}`, nm, x.pick(['rw', 'fr', 'en']), x.tag, ago(24 * 6)]);
    await c.query("insert into user_roles(user_id, role) values ($1,'driver'),($1,'passenger')", [id]);
    await c.query(`insert into driver_profiles(user_id, status, status_reason, legal_name, zone_id, submitted_at, created_at, review_started_at) values ($1,$2,$3,$4,'kigali',$5,$5,$6)`, [id, status, why || null, nm, submitted, status === 'UNDER_REVIEW' ? ago(1) : null]);
    await c.query(`insert into vehicles(driver_id, vehicle_type, make, model, color, year, plate, capacity, status) values ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
      [id, kind, kind === 'car' ? pick(['Toyota', 'Suzuki', 'Nissan']) : pick(['TVS', 'Bajaj']), kind === 'car' ? pick(['Vitz', 'Swift', 'Note']) : 'HLX', pick(['White', 'Blue', 'Black']), 2014 + (i % 8), `RB${kind === 'car' ? 'A' : 'E'} ${910 + ++plateN} K`, kind === 'car' ? 4 : 1]);
    for (const dt of kind === 'car' ? ['national_id', 'driving_licence', 'profile_photo', 'vehicle_registration', 'insurance', 'inspection'] : ['national_id', 'driving_licence', 'profile_photo', 'vehicle_registration', 'insurance'])
      await c.query(`insert into driver_documents(driver_id, doc_type, file_key, mime, size, expiry_date, review_status, created_at) values ($1,$2,'docs/00000000-0000-0000-0000-000000000000.jpg','image/jpeg',240000,$3,'pending',$4)`,
        [id, dt, dt === 'profile_photo' ? null : iso(x.now + (200 + i * 20) * D).slice(0, 10), submitted]);
  }
  // Abasare: approved drivers get their skills, three more have applied
  const carDrivers = x.drivers.filter((d) => d.kind === 'car');
  for (const d of x.drivers.filter((q) => q.abasare))
    await c.query(`update driver_profiles set abasare_skills=$2, abasare_applied_at=$3, abasare_decided_at=$3 where user_id=$1`, [d.id, JSON.stringify({ transmissions: ['manual', 'automatic'], classes: ['car'], licence_since: '2017-05-01', years_experience: 7, return_mode: 'moto' }), ago(24 * 12)]);
  for (const d of carDrivers.filter((q) => !q.abasare).slice(0, 3))
    await c.query(`update driver_profiles set abasare_status='pending', abasare_skills=$2, abasare_applied_at=$3 where user_id=$1`, [d.id, JSON.stringify({ transmissions: ['manual'], classes: ['car'], licence_since: '2019-02-01', years_experience: 5, return_mode: pick(['moto', 'taxi', 'own']) }), ago(30)]);

  // ---- support cases ----
  const SUP: [string, string, string, string, string][] = [   // category, priority, status, subject, resolution
    ['fare_dispute', 'normal', 'open', 'The fare was higher than the estimate', ''], ['payment', 'high', 'in_progress', 'I was charged twice on MTN MoMo', ''], ['lost_item', 'normal', 'in_progress', 'I left my phone in the car', ''],
    ['driver_complaint', 'high', 'open', 'The driver took a much longer route', ''], ['account', 'low', 'resolved', 'I cannot sign in with my new number', 'We updated the number after checking your identity. You can sign in now.'],
    ['refund', 'normal', 'awaiting_user', 'My refund has not arrived', ''], ['booking', 'normal', 'resolved', 'Wrong pickup point on the map', 'The pickup point was corrected and the driver was coached.'], ['safety', 'urgent', 'in_progress', 'The driver was driving too fast', ''],
    ['other', 'low', 'closed', 'I need a receipt for my company', 'The receipt was sent by SMS and e-mail.'], ['booking', 'normal', 'open', 'The driver cancelled without telling me', ''], ['payment', 'normal', 'resolved', 'The promo code was not applied', 'The discount was added as credit to your account.'],
    ['appeal', 'high', 'open', 'My account was paused, please review', ''], ['fare_dispute', 'low', 'resolved', 'Waiting time was charged', 'The waiting charge was removed.'], ['lost_item', 'normal', 'resolved', 'I lost my umbrella', 'The driver returned it the same day.'], ['driver_complaint', 'normal', 'closed', 'The driver was rude', 'The driver received a warning.'], ['booking', 'low', 'open', 'How do I change my destination?', '']];
  for (const [i, [cat, pri, status, subject, resolution]] of SUP.entries()) {
    const id = randomUUID(), created = x.now - (i * 9 + 3) * H, bk = x.done[(i * 7) % x.done.length], rep = bk.passenger_id;
    const due = created + (pri === 'urgent' ? 1 : pri === 'high' ? 4 : 24) * H;
    await c.query(`insert into support_cases(id, ref, booking_id, reporter_id, category, priority, status, subject, assigned_to, sla_due_at, resolution, csat, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
      [id, `SC-${1040 + i}`, bk.id, rep, cat, pri, status, subject, status === 'open' ? null : pick(agents), iso(due), resolution || null, status === 'resolved' || status === 'closed' ? 3 + Math.floor(rnd() * 3) : null, iso(created)]);
    await c.query(`insert into case_events(case_id, author_id, kind, body, visibility, created_at) values ($1,$2,'message',$3,'public',$4)`, [id, rep, subject + '. Please help.', iso(created)]);
    if (status !== 'open') {
      await c.query(`insert into case_events(case_id, author_id, kind, body, visibility, created_at) values ($1,$2,'message',$3,'public',$4)`, [id, pick(agents), resolution || 'Thank you for reaching out. We are checking the trip details and will come back to you today.', iso(created + 2 * H)]);
      await c.query(`insert into case_events(case_id, author_id, kind, body, visibility, created_at) values ($1,$2,'internal_note',$3,'internal',$4)`, [id, pick(agents), 'Checked the trip record and the payment. Nothing unusual on the driver side.', iso(created + 1 * H)]);
    }
  }

  // ---- safety ----
  const SAF: [string, string, string, string][] = [['sos', 'resolved', 'The rider pressed SOS. The driver was reached and the rider confirmed she was safe.', 'Rider reached by phone, no danger.'], ['misconduct', 'open', 'The rider says the driver asked for extra cash outside the app.', ''],
    ['accident', 'acknowledged', 'Minor collision at a junction, nobody was hurt.', ''], ['harassment', 'resolved', 'Inappropriate comments reported by a rider.', 'Driver suspended for review and the rider contacted.']];
  for (const [i, [kind, status, desc, res]] of SAF.entries()) {
    const bk = x.done[(i * 13 + 5) % x.done.length];
    await c.query(`insert into safety_incidents(id, ref, booking_id, reporter_id, kind, lat, lng, description, status, acknowledged_by, acknowledged_at, resolution, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [randomUUID(), `SF-${220 + i}`, bk.id, bk.passenger_id, kind, -1.95 + rnd() * 0.03, 30.06 + rnd() * 0.05, desc, status, status === 'open' ? null : staff.dispatcher, status === 'open' ? null : ago(30 + i * 20), res || null, ago(32 + i * 22)]);
  }

  // ---- alerts and fraud signals ----
  const AL: [string, string, string, string, number][] = [['critical', 'payment_failures', 'Burst of failed mobile-money payments (8 in 10 minutes)', 'open', 2], ['warning', 'mass_view', 'A staff member opened 26 customer records in 5 minutes', 'open', 6],
    ['warning', 'night_action', 'Credit adjustment made at night (Kigali time)', 'acknowledged', 30], ['info', 'large_credit', 'Credit adjustment above the approval limit was sent for a second approval', 'acknowledged', 52], ['warning', 'failed_logins', '5 failed staff sign-ins from one device', 'acknowledged', 70]];
  for (const [sev, kind, title, status, h] of AL)
    await c.query(`insert into admin_alerts(severity, kind, title, detail, actor_id, dedupe_key, status, created_at, acknowledged_by, acknowledged_at) values ($1,$2,$3,'{}',$4,$5,$6,$7,$8,$9)`,
      [sev, kind, title, staff.support_agent, `${kind}-${h}`, status, ago(h), status === 'open' ? null : staff.super_admin, status === 'open' ? null : ago(h - 1)]);
  for (const [i, k] of ['promo_reuse', 'fake_gps', 'cancel_loop', 'device_velocity', 'promo_reuse', 'cancel_loop'].entries())
    await c.query(`insert into risk_events(user_id, kind, detail, created_at) values ($1,$2,$3,$4)`, [pick(x.riders), k, JSON.stringify({ note: 'Detected automatically' }), ago(5 + i * 17)]);

  // ---- claims ----
  const CL: [string, string, string, string, number][] = [['damage', 'submitted', 'Scratch on the left rear door after the handover.', 'owner', 35000], ['loss', 'under_review', 'Sunglasses left on the back seat.', 'passenger', 15000], ['damage', 'settled', 'Cracked phone holder.', 'owner', 8000]];
  for (const [i, [type, status, desc, role, amount]] of CL.entries()) {
    const bk = x.done[(i * 17 + 3) % x.done.length], settled = status === 'settled';
    await c.query(`insert into claims(id, ref, booking_id, claim_type, filed_by, filer_role, respondent_id, respondent_role, description, claimed_amount, status, assigned_to, sla_due_at, decision_amount, decision_reason, decided_by, decided_at, settlement_kind, settlement_status, settlement_amount, settled_at, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,'driver',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)`,
      [randomUUID(), `CLM-${310 + i}`, bk.id, type, bk.passenger_id, role === 'owner' ? 'owner' : 'passenger', bk.driver_id, desc, amount, status, status === 'submitted' ? null : staff.support_lead, iso(x.now + (3 - i) * D), settled ? amount : null, settled ? 'Evidence checked and accepted.' : null, settled ? staff.support_lead : null,
        settled ? ago(20) : null, settled ? 'credit' : null, settled ? 'done' : 'none', settled ? amount : null, settled ? ago(19) : null, ago(30 + i * 24)]);
  }

  // ---- growth: promotions, referrals, campaigns, quests, fixed routes ----
  const PR: [string, string, number, number, number, number, number][] = [['DEMO-WEEKEND', 'percent', 15, 1500, 400, 200000, 96000], ['DEMO-STUDENT', 'fixed', 500, 500, 1500, 100000, 41500], ['DEMO-AIRPORT', 'percent', 10, 2000, 5000, 150000, 22400]];
  for (const [code, kind, value, maxd, minf, budget, spent] of PR)
    await c.query(`insert into promotions(code, kind, value, max_discount, min_fare, valid_from, valid_to, usage_limit, per_user_limit, budget, spent, active, segment) values ($1,$2,$3,$4,$5,$6,$7,2000,3,$8,$9,true,'all')`, [code, kind, value, maxd, minf, ago(24 * 10), iso(x.now + 24 * D), budget, spent]);
  for (let i = 0; i < 14; i++) {
    const a = x.riders[i % x.riders.length], b = x.riders[(i * 3 + 20) % x.riders.length]; if (a === b) continue;
    const st = i % 7 === 6 ? 'rejected' : i % 3 === 0 ? 'pending' : 'rewarded';
    await c.query('savepoint rf');
    await c.query(`insert into referrals(referrer_id, referee_id, status, created_at, reward_referrer, reward_referee, rewarded_at, reject_reason) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [a, b, st, ago(24 * (2 + i)), st === 'rewarded' ? 1000 : 0, st === 'rewarded' ? 1000 : 0, st === 'rewarded' ? ago(24 * (1 + i)) : null, st === 'rejected' ? 'same_phone' : null]).then(() => c.query('release savepoint rf'), () => c.query('rollback to savepoint rf'));
  }
  const CP: any[] = [
    ['Welcome weekend offer', 'sms', { type: 'all_passengers' }, 'done', 'Weekend offer', 'Offre du week-end', 'Weekend offer', 'Uyu munsi wishyure make: koresha DEMO-WEEKEND ugabanyirizwe 15%.', 'Ce week-end, utilisez DEMO-WEEKEND et profitez de 15 % de réduction.', 'This weekend, use DEMO-WEEKEND and get 15% off your rides.', ago(24 * 3), { sent: 84, failed: 1, skipped: 5 }],
    ['Driver quest reminder', 'push', { type: 'all_drivers' }, 'scheduled', 'Weekly quest', 'Défi de la semaine', 'Weekly quest', 'Kora ingendo 40 muri iki cyumweru wegukane igihembo.', 'Faites 40 courses cette semaine et gagnez une prime.', 'Complete 40 trips this week and earn a bonus.', iso(x.now + 2 * D), {}],
    ['Win back quiet riders', 'sms', { type: 'inactive_passengers', days: 30 }, 'draft', 'We miss you', 'Vous nous manquez', 'We miss you', 'Turakuzi! Garuka ukore urugendo rwa mbere ugabanyirizwe.', 'Revenez avec nous : votre prochaine course est moins chère.', 'Come back and enjoy a discount on your next ride.', null, {}]];
  for (const [name, ch, seg, status, trw, tfr, ten, mrw, mfr, men, when, stats] of CP as any[])
    await c.query(`insert into campaigns(name, channel, segment, title_rw, title_fr, title_en, msg_rw, msg_fr, msg_en, scheduled_at, status, stats, created_by, started_at, finished_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [name, ch, JSON.stringify(seg), trw, tfr, ten, mrw, mfr, men, when, status, JSON.stringify(stats), staff.business_manager, status === 'done' ? when : null, status === 'done' ? when : null]);
  const Q: [string, string, string, string, string, string, string, number, string, number][] = [
    ['Five trips today', 'Gukora ingendo 5 uyu munsi', 'Cinq courses aujourd\'hui', 'Complete 5 trips before midnight.', 'trips', 'daily', '', 5, '', 2000], ['Weekly earner', 'Umushoferi w\'icyumweru', 'Chauffeur de la semaine', 'Earn 150,000 RWF in a week.', 'earnings', 'weekly', '', 150000, '', 10000],
    ['Rush-hour driver', 'Umushoferi w\'amasaha y\'urujya n\'uruza', 'Chauffeur des heures de pointe', 'Complete 8 trips during rush hours.', 'peak_hours', 'weekly', '', 8, '', 5000]];
  for (const [en, rw, fr, desc, kind, win, , target, , reward] of Q)
    await c.query(`insert into driver_quests(title_en, title_rw, title_fr, desc_en, kind, target, quest_window, reward, starts_on, ends_on, budget_cap, spent, active, placeholder, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,500000,$11,true,false,$12)`,
      [en, rw, fr, desc, kind, target, win, reward, iso(x.now - 5 * D).slice(0, 10), iso(x.now + 60 * D).slice(0, 10), Math.round(reward * 14), staff.business_manager]);
  const FR: [string, string, string, number, number, number, number, number][] = [['Kigali Airport to City centre', 'Ikibuga cy\'indege - Mu mujyi', 'Aéroport de Kigali - Centre-ville', -1.9686, 30.1395, -1.9441, 30.0619, 9000], ['Kimironko to Nyabugogo', 'Kimironko - Nyabugogo', 'Kimironko - Nyabugogo', -1.9441, 30.126, -1.9395, 30.0430, 4500],
    ['Nyamirambo to Remera', 'Nyamirambo - Remera', 'Nyamirambo - Remera', -1.977, 30.042, -1.957, 30.1127, 5500]];
  for (const [en, rw, fr, a, b, c2, d, price] of FR)
    await c.query(`insert into fixed_routes(name_en, name_rw, name_fr, from_lat, from_lng, from_radius_m, to_lat, to_lng, to_radius_m, service_id, price, bidirectional, active, placeholder, created_by) values ($1,$2,$3,$4,$5,1500,$6,$7,1500,'standard',$8,true,true,false,$9)`, [en, rw, fr, a, b, c2, d, price, staff.business_manager]);

  // ---- partners, codes, business accounts, fleet ----
  const partners: string[] = [];
  for (const [n, contact, status] of [['Hotel Serena Kigali', 'Marie Claire Uwimana', 'active'], ['Kigali Heights Mall', 'David Mugabo', 'active']]) {
    const id = randomUUID(); partners.push(id);
    await c.query(`insert into partners(id, name, contact_name, contact_phone, contact_email, status, billing_terms, created_by, created_at) values ($1,$2,$3,'+250788123456',$4,$5,'{}',$6,$7)`, [id, n, contact, `${contact.split(' ')[0].toLowerCase()}@partner.demo`, status, staff.business_manager, ago(24 * 20)]);
  }
  const CODES: [string, string, string, number, number, number, number, boolean][] = [['SRN4K2', 'Hotel Serena main entrance', 'Hotel Serena Kigali', -1.9507, 30.0646, 0, 214, true], ['MLH7P3', 'Kigali Heights taxi rank', 'Kigali Heights Mall', -1.9535, 30.093, 1, 167, false], ['BUS9X5', 'Nyabugogo bus park gate', '', -1.9395, 30.043, 0, 92, false], ['CNV3M8', 'Convention Centre', '', -1.9543, 30.0937, 0, 58, false]];
  for (const [code, label, pname, lat, lng, pi, scans, bill] of CODES)
    await c.query(`insert into request_codes(code, label, partner_name, lat, lng, default_service, active, scans, created_by, partner_id, bill_to_partner) values ($1,$2,$3,$4,$5,'ride',true,$6,$7,$8,$9)`, [code, label, pname || null, lat, lng, scans, staff.business_manager, pname ? partners[pi] : null, bill]);
  const corp = randomUUID();
  await c.query(`insert into corporate_accounts(id, legal_name, tin, status, billing_mode, credit_limit, monthly_budget, policy, created_by) values ($1,'Kigali Business Group Ltd','102345678','active','credit',2000000,1500000,'{"max_fare":20000}',$2)`, [corp, staff.business_manager]);
  for (const [i, role] of ['admin', 'booker', 'employee', 'employee'].entries())
    await c.query(`insert into corporate_members(corporate_id, user_id, role, spending_limit, cost_centre) values ($1,$2,$3,$4,$5)`, [corp, x.riders[(40 + i) % x.riders.length], role, 200000, ['Sales', 'Finance', 'Operations', 'Sales'][i]]);
  const fleet = randomUUID(), owner = x.drivers[1].id;
  await c.query(`insert into fleets(id, name, owner_user_id, revenue_share_bps, status) values ($1,'Umurage Transport Cooperative',$2,1000,'active')`, [fleet, owner]);
  for (const d of x.drivers.slice(1, Math.min(7, x.drivers.length))) { await c.query('insert into fleet_members(fleet_id, user_id, role) values ($1,$2,$3)', [fleet, d.id, d.id === owner ? 'owner' : 'driver']); await c.query('update driver_profiles set fleet_id=$2 where user_id=$1', [d.id, fleet]); }

  // ---- finance queues ----
  const RF: [string, number, string][] = [['REQUESTED', 3000, 'The trip ended early because the driver felt unwell'], ['APPROVED', 2500, 'Fare dispute settled in favour of the rider'], ['PROCESSED', 4200, 'Charged twice on MTN MoMo'], ['PROCESSED', 1800, 'Promo discount not applied']];
  for (const [i, [status, amount, reason]] of RF.entries()) {
    const bk = x.done[(i * 23 + 11) % x.done.length];
    await c.query(`insert into refunds(booking_id, payment_id, amount, reason, status, requested_by, approved_by, created_at, processed_at, as_credit) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [bk.id, bk.payment_id, amount, reason, status, staff.finance_officer, status === 'REQUESTED' ? null : staff.finance_approver, ago(10 + i * 14), status === 'PROCESSED' ? ago(8 + i * 14) : null, i === 3]);
  }
  const PO: [string, number, string][] = [['REQUESTED', 45000, '0'], ['REQUESTED', 120000, '1'], ['REQUESTED', 30000, '2'], ['REVIEWED', 80000, '3'], ['APPROVED', 65000, '4'], ['REJECTED', 15000, '5']];
  for (const [i, [status, amount]] of PO.entries())
    await c.query(`insert into payouts(owner_user_id, kind, amount, fee, status, provider, msisdn, reviewed_by, approved_by, note, requested_at, idempotency_key) values ($1,'driver',$2,200,$3,'mtn_momo','+250788991001',$4,$5,$6,$7,$8)`,
      [x.drivers[(i + 8) % x.drivers.length].id, amount, status, status === 'REQUESTED' ? null : staff.finance_officer, status === 'APPROVED' ? staff.finance_approver : null, status === 'REJECTED' ? 'Balance changed after the request' : null, ago(6 + i * 7), `demo-payout-${i}`]);
  for (const [i, kind] of (['access', 'deletion', 'correction'] as const).entries())
    await c.query(`insert into privacy_requests(user_id, kind, status, due_at, created_at) values ($1,$2,$3,$4,$5)`, [x.riders[(60 + i) % x.riders.length], kind, i === 0 ? 'in_progress' : 'open', iso(x.now + (20 - i * 6) * D), ago(24 * (3 + i))]);
}

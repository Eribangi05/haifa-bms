// @ts-nocheck
// Seeds credit, loyalty points and settings through the BACKEND's own services (so the ledger stays consistent).
// Run from the backend folder: DATABASE_URL=... node --import tsx ../mobile/e2e/r3-seed.mts <json>
// json: { claims?: [{ action: 'review'|'decide'|'settle', id, staff_id, ... }], credit?: [{ user_id, amount, source? }], loyalty?: [{ user_id, points, lifetime }], settings?: { key: value } }
import { tx, q, pool } from '../../backend/src/db.ts';
import { grantCredit } from '../../backend/src/services/credit.ts';
import { reviewClaim, decideClaim, requestSettlement } from '../../backend/src/services/claims.ts';
import { setSetting } from '../../backend/src/services/settings.ts';
const a = JSON.parse(process.argv[2] ?? '{}');
for (const c of a.credit ?? []) await tx((cl) => grantCredit(cl, c.user_id, c.amount, c.source ?? 'goodwill', { enforceCap: false, notifyUser: false }));
for (const l of a.loyalty ?? []) await q("insert into loyalty_accounts(user_id, points, lifetime_points, tier) values ($1,$2,$3,$4) on conflict (user_id) do update set points=excluded.points, lifetime_points=excluded.lifetime_points, tier=excluded.tier", [l.user_id, l.points, l.lifetime, l.lifetime >= 10000 ? 'gold' : l.lifetime >= 2000 ? 'silver' : 'bronze']);
for (const [k, v] of Object.entries(a.settings ?? {})) await setSetting(k, v, null);
// staff steps on a claim (stand-in staff actor = any existing user id; the admin console path is covered by the backend tests)
for (const c of a.claims ?? []) {
  const staff = { id: c.staff_id, role: 'support_lead' };
  if (c.action === 'review') await reviewClaim(staff, c.id, c.mode, c.message);
  if (c.action === 'decide') await decideClaim(staff, c.id, { outcome: c.outcome, amount: c.amount, reason: c.reason, skip_reply_window: true });
  if (c.action === 'settle') await requestSettlement(staff, c.id, { kind: 'credit', amount: c.amount });
}
await pool.end(); console.log('seeded');

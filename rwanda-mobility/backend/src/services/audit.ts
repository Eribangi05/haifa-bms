import { q, type Db, pool } from '../db.js';

export type Actor = { id: string | null; role?: string | null; ip?: string | null };
export async function audit(
  actor: Actor, action: string, entityType: string, entityId: string | null,
  before?: unknown, after?: unknown, db: Db = pool,
) {
  await q(
    `insert into audit_logs(actor_id, actor_role, action, entity_type, entity_id, before, after, ip)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor.id, actor.role ?? null, action, entityType, entityId,
     before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after), actor.ip ?? null], db);
}

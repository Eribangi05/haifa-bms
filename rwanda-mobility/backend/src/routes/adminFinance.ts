import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requirePerm, actorOf } from '../guards.js';
import { q } from '../db.js';
import * as F from '../services/finance.js';
import { driverBalance } from '../services/ledger.js';
import { audit } from '../services/audit.js';
import { badRequest, forbidden } from '../errors.js';

const idp = z.object({ id: z.string().uuid() });
const csv = (rows: any[]) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => { let s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };   // CSV-injection safe
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
};

export async function adminFinanceRoutes(app: FastifyInstance) {
  const view = requirePerm('finance.view');

  app.get('/admin/finance/payments', { preHandler: view }, async (req) => {
    const b = parse(z.object({ q: z.string().max(60).optional(), status: z.string().optional(), method: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    return { payments: await q(`select p.id, p.reference, p.provider_reference, p.method, p.status, p.amount, p.amount_collected, p.fee_amount, p.failure_reason, p.settlement_status, p.created_at, p.completed_at, bk.ref booking_ref, bk.id booking_id
      from payments p join bookings bk on bk.id=p.booking_id
      where ($1::text is null or p.reference=$1 or p.provider_reference=$1 or bk.ref ilike $2) and ($3::text is null or p.status=$3) and ($4::text is null or p.method=$4) order by p.created_at desc limit $5`,
      [b.q ?? null, `%${b.q ?? ''}%`, b.status ?? null, b.method ?? null, b.limit]) };
  });
  app.get('/admin/finance/position', { preHandler: view }, async () => F.financialPosition());
  app.get('/admin/finance/drivers', { preHandler: view }, async () => {
    const ds = await q<any>('select dp.user_id, u.display_name from driver_profiles dp join users u on u.id=dp.user_id');
    const out = [];
    for (const d of ds) { const bal = await driverBalance(d.user_id); if (bal.payable || bal.cash_held) out.push({ ...d, ...bal }); }
    return { drivers: out };
  });

  // refunds: maker (request) and checker (approve) are different people
  app.get('/admin/finance/refunds', { preHandler: view }, async () => ({ refunds: await q('select r.*, b.ref booking_ref from refunds r join bookings b on b.id=r.booking_id order by r.created_at desc limit 100') }));
  app.post('/admin/finance/refunds', { preHandler: requirePerm('finance.refund.request') }, async (req) => {
    const b = parse(z.object({ booking_id: z.string().uuid(), amount: z.number().int().positive(), reason: z.string().min(5).max(300), driver_clawback: z.number().int().min(0).default(0) }), req.body);
    return F.requestRefund(actorOf(req), b.booking_id, b.amount, b.reason, b.driver_clawback);
  });
  app.post('/admin/finance/refunds/:id/decision', { preHandler: requirePerm('finance.refund.approve') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ approve: z.boolean() }), req.body);
    return F.decideRefund(actorOf(req), id, b.approve);
  });

  // payouts
  app.get('/admin/finance/payouts', { preHandler: view }, async () => ({ payouts: await q('select p.*, u.display_name owner from payouts p join users u on u.id=p.owner_user_id order by p.requested_at desc limit 100') }));
  app.post('/admin/finance/payouts/:id/review', { preHandler: requirePerm('finance.payout.review') }, async (req) => F.reviewPayout(actorOf(req), parse(idp, req.params).id));
  app.post('/admin/finance/payouts/:id/approve', { preHandler: requirePerm('finance.payout.approve') }, async (req) => F.approvePayout(actorOf(req), parse(idp, req.params).id));
  app.post('/admin/finance/payouts/:id/paid', { preHandler: requirePerm('finance.payout.approve') }, async (req) => {
    const b = parse(z.object({ provider_reference: z.string().min(3).max(80) }), req.body);
    return F.markPayoutPaid(actorOf(req), parse(idp, req.params).id, b.provider_reference);
  });
  app.post('/admin/finance/payouts/:id/reject', { preHandler: requirePerm('finance.payout.review') }, async (req) => {
    const b = parse(z.object({ note: z.string().min(5).max(300) }), req.body);
    return F.rejectPayout(actorOf(req), parse(idp, req.params).id, b.note);
  });

  // cash + adjustments
  app.post('/admin/finance/cash-remittance', { preHandler: requirePerm('finance.reconcile') }, async (req) => {
    const b = parse(z.object({ driver_id: z.string().uuid(), amount: z.number().int().positive(), reference: z.string().min(3).max(60) }), req.body);
    return F.recordCashRemittance(actorOf(req), b.driver_id, b.amount, b.reference);
  });
  app.post('/admin/finance/adjustments', { preHandler: requirePerm('finance.refund.approve') }, async (req) => {
    const b = parse(z.object({ driver_id: z.string().uuid(), amount: z.number().int(), reason: z.string().min(10).max(300) }), req.body);
    if (Math.abs(b.amount) > 100000 && !req.auth!.roles.includes('super_admin')) throw forbidden('Adjustments above 100,000 RWF need a super admin');
    return F.postDriverAdjustment(actorOf(req), b.driver_id, b.amount, b.reason);
  });

  // reconciliation
  app.post('/admin/finance/reconcile', { preHandler: requirePerm('finance.reconcile') }, async (req) => {
    const b = parse(z.object({ provider: z.enum(['mtn_momo', 'airtel_money']), run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rows: z.array(z.object({ reference: z.string(), amount: z.number().int(), status: z.enum(['SUCCESS', 'FAILED', 'PENDING']) })).max(5000) }), req.body);
    return F.reconcile(actorOf(req), b.provider, b.run_date, b.rows);
  });
  app.get('/admin/finance/reconciliation', { preHandler: view }, async () => ({
    runs: await q('select * from reconciliation_runs order by created_at desc limit 30'),
    open_items: await q("select i.*, r.provider, r.run_date from reconciliation_items i join reconciliation_runs r on r.id=i.run_id where not i.resolved order by r.created_at desc limit 200"),
    payment_exceptions: await q("select id, reference, method, status, amount, failure_reason, created_at from payments where failure_reason in ('amount_mismatch','late_success_needs_review') or (status='PENDING' and created_at < now() - interval '15 minutes' and method <> 'cash') order by created_at desc"),
    cash_outstanding: await q("select p.id, p.reference, p.amount, p.amount_collected, p.created_at, b.ref from payments p join bookings b on b.id=p.booking_id where p.method='cash' and p.status='PENDING' and p.created_at < now() - interval '1 hour'"),
  }));
  app.post('/admin/finance/reconciliation/items/:id/resolve', { preHandler: requirePerm('finance.reconcile') }, async (req) => {
    const { id } = parse(idp, req.params); const b = parse(z.object({ note: z.string().min(5).max(300) }), req.body);
    await q('update reconciliation_items set resolved=true, note=$2 where id=$1', [id, b.note]); await audit(actorOf(req), 'reconciliation.item_resolved', 'reconciliation_item', id, undefined, b); return { ok: true };
  });

  // exports (audited, formula-injection safe)
  app.get('/admin/finance/export/:kind', { preHandler: view }, async (req, reply) => {
    const { kind } = parse(z.object({ kind: z.enum(['payments', 'ledger', 'trips', 'earnings']) }), req.params);
    const r = parse(z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }), req.query);
    const p = [r.from ?? '1970-01-01', r.to ?? '2999-01-01'];
    const sql = {
      payments: 'select p.reference, p.provider_reference, p.method, p.status, p.amount, p.amount_collected, p.fee_amount, p.settlement_status, p.created_at, p.completed_at, b.ref booking_ref from payments p join bookings b on b.id=p.booking_id where p.created_at between $1 and $2 order by p.created_at',
      ledger: 'select id, txn_id, account_code, owner_user_id, booking_id, debit, credit, memo, created_at from ledger_entries where created_at between $1 and $2 order by id',
      trips: 'select ref, status, service_id, zone_id, payment_method, estimated_fare, final_fare, distance_m, duration_s, requested_at, completed_at, cancel_by, cancel_fee from bookings where created_at between $1 and $2 order by created_at',
      earnings: 'select e.created_at, b.ref booking_ref, e.driver_id, e.fare_subtotal, e.discount, e.tax, e.passthrough, e.commission, e.fleet_share, e.net, e.payment_method, e.collected_by from driver_earnings e join bookings b on b.id=e.booking_id where e.created_at between $1 and $2 order by e.created_at',
    }[kind];
    await audit(actorOf(req), 'export', kind, null, undefined, r);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${kind}.csv"`);
    return csv(await q(sql, p));
  });
}

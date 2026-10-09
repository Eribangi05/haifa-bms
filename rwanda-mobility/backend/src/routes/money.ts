import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { anyAuth, requirePerm, actorOf, routeLimit } from '../guards.js';
import { q, q1 } from '../db.js';
import { notFound } from '../errors.js';
import { normalizeAnyPhone } from '../util/phone.js';
import * as W from '../services/credit.js';
import * as L from '../services/loyalty.js';
import * as Dp from '../services/deposit.js';
import { allSettings } from '../services/settings.js';

const idp = z.object({ id: z.string().uuid() });

/** Customer credit, loyalty, the Abasare deposit and their admin views. See docs/FEATURE_ROUND3.md. */
export async function moneyRoutes(app: FastifyInstance) {
  // ---- customer ----
  app.get('/wallet', { preHandler: anyAuth }, async (req) => W.creditSummary(req.auth!.id));
  app.get('/wallet/statement', { preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.coerce.number().int().optional() }), req.query);
    return W.statement(req.auth!.id, b.limit, b.before);
  });
  app.get('/loyalty', { preHandler: anyAuth }, async (req) => L.loyaltyView(req.auth!.id));
  app.get('/loyalty/tiers', async () => ({ tiers: await L.tiersConfig() }));
  app.post('/loyalty/redeem', { config: routeLimit('WALLET_RATE_MAX', 20), preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({ points: z.number().int().positive() }), req.body);
    return L.redeemPoints(req.auth!.id, b.points, String(req.headers['idempotency-key'] ?? '').slice(0, 100) || undefined);
  });

  // ---- Abasare deposit ----
  app.get('/bookings/:id/deposit', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = await q1<any>('select passenger_id from bookings where id=$1', [id]);
    if (!b || b.passenger_id !== req.auth!.id) throw notFound('booking');
    return { deposit: await Dp.depositView(id) };
  });
  app.post('/bookings/:id/deposit/pay', { config: routeLimit('PAYMENT_RATE_MAX', 10), preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ method: z.enum(['mtn_momo', 'wallet']), msisdn: z.string().max(20).optional() }), req.body);
    return { deposit: await Dp.payDeposit(req.auth!.id, id, b) };
  });

  // ---- admin ----
  const view = requirePerm('wallet.view');
  app.get('/admin/wallet/lookup', { preHandler: view }, async (req) => {
    const b = parse(z.object({ q: z.string().min(3).max(80) }), req.query);
    const phone = normalizeAnyPhone(b.q);
    const users = await q<any>(`select id, phone, display_name, email, status from users where id::text=$1 or ($2::text is not null and phone=$2) or phone like $3 or display_name ilike $4 limit 10`,
      [b.q, phone, `%${b.q.replace(/[^\d+]/g, '')}%`, `%${b.q}%`]);
    return { users: await Promise.all(users.map(async (u) => ({ ...u, balance: await W.balances(u.id), loyalty: await q1('select points, lifetime_points, tier from loyalty_accounts where user_id=$1', [u.id]) }))) };
  });
  app.get('/admin/wallet/:id/statement', { preHandler: view }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.coerce.number().int().optional() }), req.query);
    return { ...(await W.statement(id, b.limit, b.before)), summary: await W.creditSummary(id), loyalty: await L.loyaltyView(id) };
  });
  app.get('/admin/wallet/adjustments', { preHandler: view }, async (req) => {
    const b = parse(z.object({ status: z.enum(['pending', 'applied', 'rejected']).optional() }), req.query);
    return { adjustments: await q(`select a.*, u.phone, u.display_name, r.display_name requested_by_name from wallet_adjustments a join users u on u.id=a.user_id left join users r on r.id=a.requested_by
      where ($1::text is null or a.status=$1) order by a.created_at desc limit 100`, [b.status ?? null]) };
  });
  app.post('/admin/wallet/adjustments', { preHandler: requirePerm('wallet.adjust') }, async (req) => {
    const b = parse(z.object({ user_id: z.string().uuid(), amount: z.number().int(), reason: z.string().min(10).max(300), source: z.enum(['adjustment', 'promo', 'quest', 'goodwill']).default('adjustment') }), req.body);
    return W.requestAdjustment(actorOf(req), b.user_id, b.amount, b.reason, b.source);
  });
  app.post('/admin/wallet/adjustments/:id/decision', { preHandler: requirePerm('wallet.adjust.approve') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ approve: z.boolean() }), req.body);
    return W.decideAdjustment(actorOf(req), id, b.approve);
  });
  app.get('/admin/wallet/reconciliation', { preHandler: view }, async () => W.creditReconciliation());
  app.get('/admin/loyalty/config', { preHandler: view }, async () => {
    const s = await allSettings();
    return { tiers: await L.tiersConfig(), settings: Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith('loyalty.') || k.startsWith('wallet.') || k === 'abasare.deposit_percent')), edit_at: 'Settings > Credit & loyalty (permission settings.manage)' };
  });
  app.get('/admin/deposits', { preHandler: view }, async (req) => {
    const b = parse(z.object({ status: z.string().max(30).optional() }), req.query);
    return { deposits: await q(`select d.*, bk.ref booking_ref, u.phone from booking_deposits d join bookings bk on bk.id=d.booking_id join users u on u.id=d.user_id where ($1::text is null or d.status=$1) order by d.created_at desc limit 100`, [b.status ?? null]) };
  });
}

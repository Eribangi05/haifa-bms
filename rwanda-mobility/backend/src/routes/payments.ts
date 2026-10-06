import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { anyAuth } from '../guards.js';
import { q1 } from '../db.js';
import { config, isProd } from '../config.js';
import { initiateMomo, verifyPayment, handleCallback } from '../services/payments.js';
import { notFound, unauthorized } from '../errors.js';
import { safeEqual } from '../util/crypto.js';
import { can } from '../rbac.js';
import { simulatorState } from '../providers/payment.js';

export async function paymentRoutes(app: FastifyInstance) {
  const view = (p: any) => ({
    id: p.id, booking_id: p.booking_id, method: p.method, status: p.status, amount: p.amount, currency: p.currency, reference: p.reference,
    failure_reason: p.failure_reason, msisdn: p.msisdn_masked, completed_at: p.completed_at,
    simulated: p.method === 'mtn_momo' && config.momo.mode === 'simulator',
  });

  app.post('/payments', { preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({ booking_id: z.string().uuid(), method: z.enum(['mtn_momo', 'airtel_money']).default('mtn_momo'), msisdn: z.string() }), req.body);
    return view(await initiateMomo(req.auth!.id, b.booking_id, b.msisdn, b.method));
  });

  // Reading a PENDING payment re-checks the provider: the status always comes from the provider, never from the client.
  app.get('/payments/:id', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const p = await q1<any>('select p.*, b.passenger_id, b.driver_id from payments p join bookings b on b.id=p.booking_id where p.id=$1', [id]);
    const mine = p && (p.passenger_id === req.auth!.id || p.driver_id === req.auth!.id || can(req.auth!.roles, 'finance.view'));
    if (!mine) throw notFound('payment');
    return view(p.status === 'PENDING' ? await verifyPayment(id, 'poll') : p);
  });

  // Provider server-to-server notification. Authenticated with a shared secret in the callback URL; the body is NEVER trusted:
  // the handler re-queries the provider and only then records the result. Idempotent on (provider, reference, status).
  app.put('/webhooks/payments/:provider', callbackHandler);
  app.post('/webhooks/payments/:provider', callbackHandler);
  async function callbackHandler(req: any) {
    const { provider } = req.params as { provider: string };
    if (!['mtn_momo', 'airtel_money'].includes(provider)) throw notFound('provider');
    const token = String((req.query as any)?.token ?? req.headers['x-callback-token'] ?? '');
    if (!safeEqual(token, config.momo.callbackToken)) throw unauthorized('bad callback credentials');
    return handleCallback(provider, req.body);
  }

  if (!isProd && config.momo.mode === 'simulator') {
    // DEV/TEST ONLY: drive the simulator (SIMULATED provider). Not registered in production.
    app.post('/dev/momo/settle', async (req) => {
      const b = parse(z.object({ reference: z.string(), status: z.enum(['SUCCESS', 'FAILED']) }), req.body);
      const s = simulatorState.get(b.reference); if (!s) throw notFound('simulated transaction');
      s.status = b.status; return { ok: true };
    });
  }
}

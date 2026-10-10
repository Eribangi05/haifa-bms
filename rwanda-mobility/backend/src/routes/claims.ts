import { readUpload, UPLOAD_BODY_LIMIT } from '../util/upload.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { anyAuth, requirePerm, actorOf, routeLimit } from '../guards.js';
import { badRequest } from '../errors.js';
import * as C from '../services/claims.js';

const idp = z.object({ id: z.string().uuid() });

async function claimUpload(req: any): Promise<{ buf: Buffer; caption?: string }> { const u = await readUpload(req); return { buf: u.buf, caption: u.fields.caption }; }

/** Damage / loss / injury claims for the parties of a trip (owner, driver, passenger) and for staff. */
export async function claimRoutes(app: FastifyInstance) {
  // ---- parties ----
  app.post('/bookings/:id/claims', { config: routeLimit('CLAIM_RATE_MAX', 10), preHandler: anyAuth }, async (req, reply) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ type: z.enum(['damage', 'loss', 'injury', 'other']), description: z.string().min(10).max(2000), claimed_amount: z.number().int().min(0).max(100000000).optional() }), req.body);
    const cl = await C.fileClaim(req.auth!.id, id, b);
    reply.code(201);
    return C.claimForParty(req.auth!.id, cl.id);
  });
  app.get('/claims', { preHandler: anyAuth }, async (req) => ({ claims: await C.myClaims(req.auth!.id) }));
  app.get('/claims/:id', { preHandler: anyAuth }, async (req) => C.claimForParty(req.auth!.id, parse(idp, req.params).id));
  app.post('/claims/:id/messages', { config: routeLimit('CLAIM_RATE_MAX', 30), preHandler: anyAuth }, async (req) =>
    C.postMessage(req.auth!.id, parse(idp, req.params).id, parse(z.object({ body: z.string().min(2).max(2000) }), req.body).body));
  app.post('/claims/:id/evidence', { bodyLimit: UPLOAD_BODY_LIMIT, config: routeLimit('UPLOAD_RATE_MAX', 20), preHandler: anyAuth }, async (req) => {
    const u = await claimUpload(req);
    return C.addEvidence({ id: req.auth!.id }, parse(idp, req.params).id, u.buf, u.caption);
  });
  app.post('/claims/:id/withdraw', { preHandler: anyAuth }, async (req) => C.withdrawClaim(req.auth!.id, parse(idp, req.params).id));

  // ---- staff ----
  const view = requirePerm('claims.view'), handle = requirePerm('claims.handle'), decide = requirePerm('claims.decide');
  app.get('/admin/claims', { preHandler: view }, async (req) => {
    const b = parse(z.object({ status: z.string().max(30).optional(), type: z.string().max(20).optional(), assigned: z.enum(['me', 'unassigned']).optional(), overdue: z.coerce.boolean().optional(), q: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    return { claims: await C.listClaims(b, req.auth!.id) };
  });
  app.get('/admin/claims/:id', { preHandler: view }, async (req) => C.claimForStaff(parse(idp, req.params).id));
  app.post('/admin/claims/:id/assign', { preHandler: handle }, async (req) => {
    const b = parse(z.object({ staff_id: z.string().uuid().nullable().optional() }), req.body);
    return C.assignClaim(actorOf(req), parse(idp, req.params).id, b.staff_id === undefined ? req.auth!.id : b.staff_id);
  });
  app.post('/admin/claims/:id/notes', { preHandler: handle }, async (req) => C.internalNote(actorOf(req), parse(idp, req.params).id, parse(z.object({ body: z.string().min(2).max(2000) }), req.body).body));
  app.post('/admin/claims/:id/review', { preHandler: handle }, async (req) => {
    const b = parse(z.object({ action: z.enum(['start', 'request_info']), message: z.string().max(1000).optional() }), req.body);
    return C.reviewClaim(actorOf(req), parse(idp, req.params).id, b.action, b.message);
  });
  app.post('/admin/claims/:id/evidence', { bodyLimit: UPLOAD_BODY_LIMIT, config: routeLimit('UPLOAD_RATE_MAX', 20), preHandler: handle }, async (req) => {
    const u = await claimUpload(req);
    return C.addEvidence({ id: req.auth!.id, staff: true }, parse(idp, req.params).id, u.buf, u.caption);
  });
  app.post('/admin/claims/:id/decision', { preHandler: decide }, async (req) => {
    const b = parse(z.object({ outcome: z.enum(['accepted', 'partially_accepted', 'rejected']), amount: z.number().int().min(0).optional(), reason: z.string().min(10).max(1000), skip_reply_window: z.boolean().optional() }), req.body);
    return C.decideClaim(actorOf(req), parse(idp, req.params).id, b);
  });
  app.post('/admin/claims/:id/settlement', { preHandler: decide }, async (req) => {
    const b = parse(z.object({ kind: z.enum(['credit', 'manual_payout']), amount: z.number().int().positive().optional(), reference: z.string().max(120).optional() }), req.body);
    return C.requestSettlement(actorOf(req), parse(idp, req.params).id, b);
  });
  app.post('/admin/claims/:id/settlement/decision', { preHandler: requirePerm('claims.settle.approve') }, async (req) =>
    C.decideSettlement(actorOf(req), parse(idp, req.params).id, parse(z.object({ approve: z.boolean() }), req.body).approve));
  app.patch('/admin/claims/:id/insurer', { preHandler: handle }, async (req) => {
    const b = parse(z.object({ policy_ref: z.string().max(80).nullable().optional(), insurer_claim_ref: z.string().max(80).nullable().optional(), insurer_status: z.enum(['not_applicable', 'to_submit', 'submitted', 'accepted', 'rejected', 'paid']).optional() }), req.body);
    return C.setInsurer(actorOf(req), parse(idp, req.params).id, b);
  });
  app.post('/admin/claims/:id/close', { preHandler: handle }, async (req) => ({ claim: await C.closeClaim(actorOf(req), parse(idp, req.params).id) }));
}

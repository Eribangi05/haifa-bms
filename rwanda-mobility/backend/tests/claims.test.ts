import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';
import { abasareKit, photo } from './helpersAbasare.ts';

let t: Ctx; let K: ReturnType<typeof abasareKit>;
let agent: any, lead: any, fa: any, fo: any, admin: any;
before(async () => {
  t = await boot('rwanda_mobility_test');
  K = abasareKit(t, await t.staff('driver_verifier'));
  agent = await t.staff('support_agent'); lead = await t.staff('support_lead'); fa = await t.staff('finance_approver'); fo = await t.staff('finance_officer'); admin = await t.staff('super_admin');
});
after(async () => { await t.close(); });

const setSetting = (k: string, v: unknown) => t.db.q("insert into system_settings(key,value) values ($1,$2) on conflict (key) do update set value=excluded.value", [k, JSON.stringify(v)]);
const notes = async (token: string) => (await t.api('GET', '/notifications', { token })).json.notifications as any[];
const ledgerOk = async () => {
  const r = await t.db.q1<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries'); assert.equal(r.d, r.c);
  const rec = await t.api('GET', '/admin/wallet/reconciliation', { token: fo.token }); assert.equal(rec.json.ok, true, JSON.stringify(rec.json));
};
/** An Abasare trip that is complete (photos at pickup and drop-off). */
async function trip() {
  const owner = await t.register(); const c = await K.car(owner); const d = await K.drvr();
  const { res } = await K.book(owner, c.id); assert.equal(res.status, 201, JSON.stringify(res.json));
  const bid = res.json.booking.id; await K.fullTrip(owner, d, bid);
  return { owner, d, bid, c };
}
const file = (token: string, id: string, path = 'claims') => t.api('POST', `/${path}/${id}/evidence`, { token, ...photo() });
async function filed(extra: any = {}) {
  const x = await trip();
  const r = await t.api('POST', `/bookings/${x.bid}/claims`, { token: x.owner.token, body: { type: 'damage', description: 'Scratch on the rear left door after the trip', claimed_amount: 50000, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { ...x, claim: r.json };
}

test('filing: parties only, evidence from the car check-in/out is attached, before/after side by side, privacy, duplicates and the filing window', async () => {
  const { owner, d, bid, claim } = await filed();
  assert.equal(claim.status, 'submitted'); assert.equal(claim.you_are, 'claimant'); assert.equal(claim.claimant_role, 'owner'); assert.equal(claim.respondent_role, 'driver');
  assert.ok(/^CL-/.test(claim.ref));
  assert.equal(claim.evidence.filter((e: any) => e.source === 'handover').length, 4);
  assert.equal(claim.comparison.pickup.photos.length, 2); assert.equal(claim.comparison.dropoff.photos.length, 2);
  assert.equal(claim.comparison.pickup.record.odometer_km, 45210); assert.equal(claim.comparison.dropoff.record.odometer_km, 45224);
  assert.equal((await t.api('GET', claim.evidence[0].url.replace('/api/v1', ''))).status, 200, 'signed link works');

  const dv = await t.api('GET', `/claims/${claim.id}`, { token: d.token });
  assert.equal(dv.status, 200); assert.equal(dv.json.you_are, 'respondent');
  assert.equal((await notes(d.token)).some((n) => n.template_key === 'claim_received'), true);
  assert.equal((await notes(owner.token)).some((n) => n.template_key === 'claim_filed'), true);
  const stranger = await t.register(); const stranger2 = await t.register('driver');
  for (const s of [stranger, stranger2]) { assert.equal((await t.api('GET', `/claims/${claim.id}`, { token: s.token })).status, 404); assert.equal((await t.api('POST', `/claims/${claim.id}/messages`, { token: s.token, body: { body: 'hello there' } })).status, 404); }
  assert.equal((await t.api('POST', `/bookings/${bid}/claims`, { token: stranger.token, body: { type: 'loss', description: 'I was not on this trip at all' } })).status, 404);
  assert.equal((await t.api('GET', '/claims', { token: owner.token })).json.claims.length, 1);
  assert.equal((await t.api('GET', `/admin/claims/${claim.id}`, { token: owner.token })).status, 403);

  const dup = await t.api('POST', `/bookings/${bid}/claims`, { token: owner.token, body: { type: 'damage', description: 'Second scratch on the same trip' } });
  assert.equal(dup.status, 409); assert.equal(dup.json.error.code, 'claim_exists');
  const other = await t.api('POST', `/bookings/${bid}/claims`, { token: owner.token, body: { type: 'loss', description: 'Sunglasses left in the car' } });
  assert.equal(other.status, 201);
  assert.equal((await t.api('POST', `/bookings/${bid}/claims`, { token: owner.token, body: { type: 'damage', description: 'short' } })).status, 400);

  await t.db.q("update bookings set completed_at = now() - interval '5 days' where id=$1", [bid]);
  const late = await t.api('POST', `/bookings/${bid}/claims`, { token: d.token, headers: { 'accept-language': 'rw' }, body: { type: 'other', description: 'Passenger left the car very dirty' } });
  assert.equal(late.status, 409); assert.equal(late.json.error.code, 'claim_window_closed'); assert.match(late.json.error.message, /Igihe/);
});

test('a driver can claim against the passenger of a normal ride (roles), uploads go through the same scanner', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'car' });
  const { res } = await t.book(p.token, 'standard'); const id = res.json.booking.id; await t.runTrip(p, d, id);
  const r = await t.api('POST', `/bookings/${id}/claims`, { token: d.token, body: { type: 'damage', description: 'Seat stained during the trip', claimed_amount: 8000 } });
  assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(r.json.claimant_role, 'driver'); assert.equal(r.json.respondent_role, 'passenger'); assert.equal(r.json.comparison, null);
  assert.equal((await t.api('GET', `/claims/${r.json.id}`, { token: p.token })).json.you_are, 'respondent');
  assert.equal((await file(d.token, r.json.id)).status, 200);
  const bad = await t.api('POST', `/claims/${r.json.id}/evidence`, { token: d.token, payload: Buffer.from('<html>no</html>'), headers: { 'content-type': 'multipart/form-data; boundary=x' } });
  assert.ok([400, 415].includes(bad.status));
  await setSetting('claims.max_evidence', 2);
  assert.equal((await file(d.token, r.json.id)).status, 200);
  const over = await file(d.token, r.json.id); assert.equal(over.status, 409); assert.equal(over.json.error.code, 'too_many_evidence');
  await setSetting('claims.max_evidence', 12);
  const w = await t.api('POST', `/claims/${r.json.id}/withdraw`, { token: d.token }); assert.equal(w.status, 200); assert.equal(w.json.status, 'withdrawn');
  assert.equal((await t.api('POST', `/claims/${r.json.id}/messages`, { token: d.token, body: { body: 'still here?' } })).status, 409);
});

test('review workflow: queue, assignment, internal notes stay internal, info request and answer, state machine, right of reply', async () => {
  const { owner, d, claim } = await filed();
  const q = await t.api('GET', '/admin/claims?status=submitted', { token: agent.token });
  assert.ok(q.json.claims.some((c: any) => c.id === claim.id));
  assert.equal((await t.api('POST', `/admin/claims/${claim.id}/assign`, { token: agent.token, body: {} })).status, 200);
  assert.equal((await t.api('POST', `/admin/claims/${claim.id}/assign`, { token: agent.token, body: { staff_id: owner.id } })).status, 400);
  assert.equal((await t.api('POST', `/admin/claims/${claim.id}/notes`, { token: agent.token, body: { body: 'Photos look consistent with the report' } })).status, 200);
  assert.equal((await t.api('POST', `/admin/claims/${claim.id}/review`, { token: agent.token, body: { action: 'start' } })).status, 200);
  const sv = (await t.api('GET', `/admin/claims/${claim.id}`, { token: agent.token })).json;
  assert.ok(sv.events.some((e: any) => e.kind === 'internal_note')); assert.ok(sv.filer_phone); assert.equal(sv.assigned_to, agent.id);
  for (const who of [owner, d]) { const pv = (await t.api('GET', `/claims/${claim.id}`, { token: who.token })).json; assert.ok(!pv.events.some((e: any) => e.kind === 'internal_note' || e.visibility === 'internal')); assert.equal(pv.policy_ref, undefined); assert.equal(pv.assigned_to, undefined); }

  assert.equal((await t.api('POST', `/admin/claims/${claim.id}/review`, { token: agent.token, body: { action: 'request_info' } })).status, 400);
  const ri = await t.api('POST', `/admin/claims/${claim.id}/review`, { token: agent.token, body: { action: 'request_info', message: 'Please upload a photo of the damage close up' } });
  assert.equal(ri.status, 200); assert.equal(ri.json.status, 'info_requested'); assert.ok(ri.json.info_due_at);
  assert.equal((await notes(owner.token)).some((n) => n.template_key === 'claim_info_requested'), true);
  const bad = await t.api('POST', `/admin/claims/${claim.id}/decision`, { token: lead.token, body: { outcome: 'accepted', reason: 'Decision taken too early on this one' } });
  assert.equal(bad.status, 409); assert.equal(bad.json.error.code, 'claim_transition');
  assert.equal((await t.api('POST', `/claims/${claim.id}/messages`, { token: owner.token, body: { body: 'Here is the close up photo' } })).status, 200);
  assert.equal((await file(owner.token, claim.id)).status, 200);
  assert.equal((await t.api('GET', `/claims/${claim.id}`, { token: owner.token })).json.status, 'under_review');

  // decisions need decide permission and respect the other party's window
  assert.equal((await t.api('POST', `/admin/claims/${claim.id}/decision`, { token: agent.token, body: { outcome: 'rejected', reason: 'An agent cannot decide claims' } })).status, 403);
  const early = await t.api('POST', `/admin/claims/${claim.id}/decision`, { token: lead.token, body: { outcome: 'accepted', reason: 'Clear evidence of the scratch in photos' } });
  assert.equal(early.status, 409); assert.equal(early.json.error.code, 'reply_window_open');
  assert.equal((await t.api('POST', `/claims/${claim.id}/messages`, { token: d.token, body: { body: 'The scratch was there at pickup, see photo 2' } })).status, 200);
  assert.equal((await notes(owner.token)).some((n) => n.template_key === 'claim_reply_added'), true);
  assert.equal((await t.api('GET', `/claims/${claim.id}`, { token: d.token })).json.replied, true);
  const acc = await t.api('POST', `/admin/claims/${claim.id}/decision`, { token: lead.token, body: { outcome: 'accepted', reason: 'Clear evidence of the scratch in photos' } });
  assert.equal(acc.status, 200, JSON.stringify(acc.json)); assert.equal(acc.json.status, 'accepted'); assert.equal(acc.json.decision_amount, 50000);
  const pv = (await t.api('GET', `/claims/${claim.id}`, { token: owner.token })).json;
  assert.equal(pv.decision.amount, 50000); assert.match(pv.decision.reason, /Clear evidence/);
  assert.equal((await notes(d.token)).some((n) => n.template_key === 'claim_accepted'), true);
  assert.equal((await t.db.q("select 1 from audit_logs where action='claim.decided' and entity_id=$1", [claim.id])).length, 1);
});

test('decision rules: partial needs a lower amount, rejection closes, skipping the reply window is audited', async () => {
  const a = await filed({ claimed_amount: 20000 });
  const skip = await t.api('POST', `/admin/claims/${a.claim.id}/decision`, { token: lead.token, body: { outcome: 'partially_accepted', amount: 20000, reason: 'Full amount is not justified here', skip_reply_window: true } });
  assert.equal(skip.status, 400);
  const part = await t.api('POST', `/admin/claims/${a.claim.id}/decision`, { token: lead.token, body: { outcome: 'partially_accepted', amount: 12000, reason: 'Repair estimate is lower than claimed', skip_reply_window: true } });
  assert.equal(part.status, 200, JSON.stringify(part.json)); assert.equal(part.json.decision_amount, 12000);
  assert.equal((await t.db.q1<any>("select params from notifications where user_id=$1 and template_key='claim_partially_accepted' and channel='in_app'", [a.owner.id])).params.amount, 12000);
  const ev = await t.db.q1<any>("select after from audit_logs where action='claim.decided' and entity_id=$1", [a.claim.id]); assert.equal(ev.after.skipped_reply_window, true);

  const b = await filed();
  const rej = await t.api('POST', `/admin/claims/${b.claim.id}/decision`, { token: lead.token, body: { outcome: 'rejected', reason: 'Damage already noted at pickup', skip_reply_window: true } });
  assert.equal(rej.status, 200); assert.equal(rej.json.decision_amount, 0);
  assert.equal((await t.api('POST', `/admin/claims/${b.claim.id}/settlement`, { token: lead.token, body: { kind: 'credit' } })).json.error.code, 'no_settlement_due');
  assert.equal((await t.api('POST', `/admin/claims/${b.claim.id}/close`, { token: agent.token })).json.claim.status, 'closed');
  assert.equal((await t.api('POST', `/admin/claims/${b.claim.id}/close`, { token: agent.token })).status, 409);
});

test('settlement as credit (small: immediate) and as manual payout record (large: second approver), ledger balanced', async () => {
  const a = await filed({ claimed_amount: 30000 });
  await t.api('POST', `/admin/claims/${a.claim.id}/decision`, { token: lead.token, body: { outcome: 'accepted', reason: 'Accepted after photo comparison', skip_reply_window: true } });
  const s = await t.api('POST', `/admin/claims/${a.claim.id}/settlement`, { token: lead.token, body: { kind: 'credit' } });
  assert.equal(s.status, 200, JSON.stringify(s.json)); assert.equal(s.json.needs_approval, false); assert.equal(s.json.status, 'settled');
  assert.equal((await t.api('GET', '/wallet', { token: a.owner.token })).json.available, 30000);
  assert.equal((await t.db.q1<any>("select coalesce(sum(debit),0)::int s from ledger_entries where account_code='CLAIMS_EXPENSE'")).s >= 30000, true);
  assert.equal((await notes(a.owner.token)).some((n) => n.template_key === 'claim_settled'), true);
  assert.equal((await t.api('POST', `/admin/claims/${a.claim.id}/settlement`, { token: lead.token, body: { kind: 'credit' } })).status, 409, 'cannot settle twice');
  await ledgerOk();

  const big = await filed({ claimed_amount: 250000 });
  await t.api('POST', `/admin/claims/${big.claim.id}/decision`, { token: lead.token, body: { outcome: 'accepted', reason: 'Accepted after full inspection report', skip_reply_window: true } });
  assert.equal((await t.api('POST', `/admin/claims/${big.claim.id}/settlement`, { token: lead.token, body: { kind: 'manual_payout' } })).json.error.code, 'reference_required');
  assert.equal((await t.api('POST', `/admin/claims/${big.claim.id}/settlement`, { token: lead.token, body: { kind: 'manual_payout', amount: 999999, reference: 'MOMO-1' } })).json.error.code, 'settlement_exceeds');
  const req = await t.api('POST', `/admin/claims/${big.claim.id}/settlement`, { token: lead.token, body: { kind: 'manual_payout', reference: 'MOMO-778812' } });
  assert.equal(req.status, 200, JSON.stringify(req.json)); assert.equal(req.json.needs_approval, true);
  assert.equal((await t.api('POST', `/admin/claims/${big.claim.id}/settlement`, { token: lead.token, body: { kind: 'credit' } })).json.error.code, 'settlement_pending');
  assert.equal((await t.api('POST', `/admin/claims/${big.claim.id}/settlement/decision`, { token: lead.token, body: { approve: true } })).status, 403, 'lead lacks the approve permission');
  const bank0 = (await t.db.q1<any>("select coalesce(sum(credit),0)::int s from ledger_entries where account_code='PLATFORM_BANK'")).s;
  const ok = await t.api('POST', `/admin/claims/${big.claim.id}/settlement/decision`, { token: fa.token, body: { approve: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.settled, true);
  const row = await t.db.q1<any>('select status, settlement_approved_by, settlement_requested_by from claims where id=$1', [big.claim.id]);
  assert.equal(row.status, 'settled'); assert.equal(row.settlement_approved_by, fa.id); assert.equal(row.settlement_requested_by, lead.id);
  assert.equal((await t.db.q1<any>("select coalesce(sum(credit),0)::int s from ledger_entries where account_code='PLATFORM_BANK'")).s - bank0, 250000);
  assert.equal((await t.api('GET', '/wallet', { token: big.owner.token })).json.available, 0, 'manual payout is not credit');
  await ledgerOk();

  // the requester can never approve their own settlement
  const self = await filed({ claimed_amount: 200000 });
  await t.api('POST', `/admin/claims/${self.claim.id}/decision`, { token: admin.token, body: { outcome: 'accepted', reason: 'Accepted after full inspection report', skip_reply_window: true } });
  await t.api('POST', `/admin/claims/${self.claim.id}/settlement`, { token: admin.token, body: { kind: 'credit' } });
  assert.equal((await t.api('POST', `/admin/claims/${self.claim.id}/settlement/decision`, { token: admin.token, body: { approve: true } })).status, 403);
  const rj = await t.api('POST', `/admin/claims/${self.claim.id}/settlement/decision`, { token: fa.token, body: { approve: false } });
  assert.equal(rj.json.settled, false);
  assert.equal((await t.api('POST', `/admin/claims/${self.claim.id}/settlement`, { token: admin.token, body: { kind: 'credit', amount: 50000 } })).json.needs_approval, false, 'a new request can be made after a rejection');
  await ledgerOk();
});

test('parallel settlement attempts credit only once', async () => {
  const a = await filed({ claimed_amount: 9000 });
  await t.api('POST', `/admin/claims/${a.claim.id}/decision`, { token: lead.token, body: { outcome: 'accepted', reason: 'Accepted after photo comparison', skip_reply_window: true } });
  const rs = await Promise.all([1, 2, 3].map(() => t.api('POST', `/admin/claims/${a.claim.id}/settlement`, { token: lead.token, body: { kind: 'credit' } })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => r.status)));
  assert.equal((await t.api('GET', '/wallet', { token: a.owner.token })).json.available, 9000);
  await ledgerOk();
});

test('insurer fields are staff-only and optional', async () => {
  const a = await filed();
  const r = await t.api('PATCH', `/admin/claims/${a.claim.id}/insurer`, { token: agent.token, body: { policy_ref: 'POL-2026-77', insurer_claim_ref: 'INS-9', insurer_status: 'submitted' } });
  assert.equal(r.status, 200);
  const sv = (await t.api('GET', `/admin/claims/${a.claim.id}`, { token: agent.token })).json;
  assert.equal(sv.policy_ref, 'POL-2026-77'); assert.equal(sv.insurer_status, 'submitted');
  const pv = (await t.api('GET', `/claims/${a.claim.id}`, { token: a.owner.token })).json;
  assert.ok(!JSON.stringify(pv).includes('POL-2026-77'));
  assert.equal((await t.api('PATCH', `/admin/claims/${a.claim.id}/insurer`, { token: agent.token, body: { insurer_status: 'maybe' } })).status, 400);
});

test('timers: SLA warning to staff, reminders to the people who owe an answer, auto-close; notifications in the user language', async () => {
  const a = await filed();
  await t.db.q("update users set preferred_language='rw' where id=$1", [a.d.id]);
  const { claimsSweep } = await import('../src/services/claims.ts');
  assert.equal((await claimsSweep()).actions, 0);
  await t.db.q("update claims set created_at = now() - interval '40 hours', reply_due_at = now() + interval '5 hours' where id=$1", [a.claim.id]);
  const r1 = await claimsSweep(); assert.ok(r1.actions >= 2);
  assert.equal((await t.db.q("select 1 from claim_events where claim_id=$1 and kind='reminder'", [a.claim.id])).length, 1);
  const rem = (await notes(a.d.token)).find((n) => n.template_key === 'claim_reminder_reply'); assert.ok(rem); assert.match(rem.body, /Wibutswe/); assert.ok(!/Reminder/.test(rem.body));
  assert.equal((await claimsSweep()).actions, 0, 'each reminder is sent once');
  assert.equal((await notes(lead.token)).some((n) => n.template_key === 'claim_sla_warning') || (await notes(admin.token)).some((n) => n.template_key === 'claim_sla_warning'), true);

  await t.api('POST', `/admin/claims/${a.claim.id}/review`, { token: agent.token, body: { action: 'request_info', message: 'Please send the repair estimate' } });
  await t.db.q("update claims set info_due_at = now() + interval '5 hours' where id=$1", [a.claim.id]);
  await claimsSweep();
  assert.equal((await notes(a.owner.token)).some((n) => n.template_key === 'claim_reminder_info'), true);

  const b = await filed();
  await t.api('POST', `/admin/claims/${b.claim.id}/decision`, { token: lead.token, body: { outcome: 'accepted', reason: 'Accepted after photo comparison', skip_reply_window: true } });
  await t.api('POST', `/admin/claims/${b.claim.id}/settlement`, { token: lead.token, body: { kind: 'credit', amount: 100 } });
  await t.db.q("update claims set settled_at = now() - interval '9 days' where id=$1", [b.claim.id]);
  await claimsSweep();
  assert.equal((await t.db.q1<any>('select status from claims where id=$1', [b.claim.id])).status, 'closed');
});

test('evidence photos of an open claim are not purged by the handover retention job', async () => {
  const a = await filed();
  const { purgeHandoverPhotos } = await import('../src/jobs.ts');
  await t.db.q("update handover_photos set created_at = now() - interval '200 days' where booking_id=$1", [a.bid]);
  await purgeHandoverPhotos();
  assert.equal((await t.db.q1<any>('select count(*)::int n from handover_photos where booking_id=$1', [a.bid])).n, 4);
  await t.api('POST', `/claims/${a.claim.id}/withdraw`, { token: a.owner.token });
  await purgeHandoverPhotos();
  assert.equal((await t.db.q1<any>('select count(*)::int n from handover_photos where booking_id=$1', [a.bid])).n, 0);
});

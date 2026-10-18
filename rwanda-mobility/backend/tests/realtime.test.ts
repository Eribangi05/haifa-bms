import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });

test('realtime: a held request answers at once when something changes for that user, and only for that user', async () => {
  const a = await t.register('passenger'), b = await t.register('passenger');
  assert.equal((await t.api('GET', '/realtime/wait')).status, 401, 'sign-in required');
  const first = await t.api('GET', '/realtime/wait', { token: a.token });
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.events, [], 'the first call never reports old events');
  const cur = first.json.cursor as number;

  // nothing for A: the request waits for its whole time and comes back empty
  const t0 = Date.now();
  const idle = await t.api('GET', `/realtime/wait?since=${cur}&timeout_s=1`, { token: a.token });
  assert.equal(idle.status, 200); assert.deepEqual(idle.json.events, []); assert.ok(Date.now() - t0 >= 900, 'it waited');

  // a change for B must not wake A, a change for A must
  const { notify } = await import('../src/services/notify.ts');
  const held = t.api('GET', `/realtime/wait?since=${cur}&timeout_s=10`, { token: a.token });
  const heldB = t.api('GET', `/realtime/wait?since=${cur}&timeout_s=2`, { token: b.token });
  await new Promise((r) => setTimeout(r, 100));
  const t1 = Date.now();
  await notify(a.id, 'chat_message', { ref: 'X' });
  const ra = await held;
  assert.ok(ra.json.events.includes('chat_message') && Date.now() - t1 < 3000, 'woken quickly');
  assert.ok(ra.json.cursor > cur);
  assert.deepEqual((await heldB).json.events, [], 'another user is not woken');

  // a change that happened before the next call is returned immediately
  const again = await t.api('GET', `/realtime/wait?since=${cur}&timeout_s=5`, { token: a.token });
  assert.ok(again.json.events.includes('chat_message'));
  assert.equal((await t.api('GET', '/realtime/wait?since=abc', { token: a.token })).status, 400);
});

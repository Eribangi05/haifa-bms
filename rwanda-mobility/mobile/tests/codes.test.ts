import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCode, savePending, takePending, fetchRequestCode } from '../src/lib/codes.ts';
import type { KV } from '../src/lib/net.ts';

const mem = (): KV => { const d = new Map<string, string>(); return { get: async (k) => d.get(k) ?? null, set: async (k, v) => void d.set(k, v), del: async (k) => void d.delete(k) }; };

test('full URL, any host', () => {
  assert.deepEqual(parseCode('https://abasare-api.onrender.com/r/K7M2QX'), { code: 'K7M2QX' });
  assert.deepEqual(parseCode('http://localhost:8080/r/K7M2QX9'), { code: 'K7M2QX9' });
  assert.deepEqual(parseCode('abasare://r/K7M2QX?svc=abasare'), { code: 'K7M2QX', svc: 'abasare' });
});
test('bare code and lowercase / whitespace', () => {
  assert.deepEqual(parseCode('K7M2QX'), { code: 'K7M2QX' });
  assert.deepEqual(parseCode('  k7m2qx \n'), { code: 'K7M2QX' });
  assert.deepEqual(parseCode('https://x.rw/r/k7m2qx'), { code: 'K7M2QX' });
});
test('trailing slash, query and hash', () => {
  assert.deepEqual(parseCode('https://x.rw/r/K7M2QX/'), { code: 'K7M2QX' });
  assert.deepEqual(parseCode('https://x.rw/r/K7M2QX?svc=ride&utm=1'), { code: 'K7M2QX', svc: 'ride' });
  assert.deepEqual(parseCode('https://x.rw/r/K7M2QX?utm=1&svc=abasare#top'), { code: 'K7M2QX', svc: 'abasare' });
  assert.deepEqual(parseCode('https://x.rw/r/K7M2QX?svc=bus'), { code: 'K7M2QX' });
});
test('garbage is rejected', () => {
  for (const g of ['', '   ', 'hello world', 'K7M2', 'K7M2QX9ZZ', 'K7M20X', 'https://x.rw/', 'https://x.rw/r/', 'https://x.rw/r/K7M2QX/extra', 'https://x.rw/p/K7M2QX', '<script>', null, undefined, 42])
    assert.equal(parseCode(g as any), null, String(g));
});
test('pending code survives and is consumed once; stale ones are dropped', async () => {
  const kv = mem();
  await savePending(kv, { code: 'K7M2QX', svc: 'abasare' }, 1000);
  assert.deepEqual(await takePending(kv, 2000), { code: 'K7M2QX', svc: 'abasare' });
  assert.equal(await takePending(kv, 2000), null);
  await savePending(kv, { code: 'K7M2QX' }, 0);
  assert.equal(await takePending(kv, 25 * 3600 * 1000), null);
});
test('fetchRequestCode encodes the code in the path', async () => {
  let path = ''; const client: any = { get: async (p: string) => { path = p; return {}; } };
  await fetchRequestCode(client, 'AB/C'); assert.equal(path, '/request-codes/AB%2FC');
});

// Small load test with plain fetch (no extra dependencies).
// Usage: npx tsx scripts/loadtest.ts [--base http://localhost:8099] [--duration 15] [--concurrency 20] [--json]
//
// Needs a server started with OTP_DEV_ECHO=true (so OTP codes are returned) and relaxed limits, e.g.
//   NODE_ENV=development OTP_DEV_ECHO=true MOMO_MODE=simulator PORT=8099 RATE_LIMIT_MAX=1000000 AUTH_RATE_MAX=1000000 ESTIMATE_RATE_MAX=1000000 npx tsx src/server.ts
// and, for OTP volume, these rows in system_settings: otp.max_per_hour_ip, otp.max_per_hour_phone = 1000000, otp.resend_cooldown_s = 0.
// NEVER point this at production: it creates real accounts.
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8099').replace(/\/$/, '');
const DURATION_S = Number(arg('duration', '15'));
const CONCURRENCY = Number(arg('concurrency', '20'));
const KCC = { lat: -1.954, lng: 30.0927 }, KIMIRONKO = { lat: -1.9496, lng: 30.1262 };

type Stat = { lat: number[]; ok: number; limited: number; err: number; firstError?: string };
const stats: Record<string, Stat> = {};
const stat = (n: string) => (stats[n] ??= { lat: [], ok: 0, limited: 0, err: 0 });

async function timed(name: string, url: string, init: RequestInit = {}) {
  const s = stat(name); const t0 = performance.now();
  try {
    const r = await fetch(BASE + url, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
    const body = await r.text(); s.lat.push(performance.now() - t0);
    if (r.status === 429) s.limited++; else if (r.ok) s.ok++; else { s.err++; s.firstError ??= `${r.status} ${body.slice(0, 120)}`; }
    try { return { status: r.status, json: JSON.parse(body) }; } catch { return { status: r.status, json: null }; }
  } catch (e: any) { s.lat.push(performance.now() - t0); s.err++; s.firstError ??= e.message; return { status: 0, json: null }; }
}

let seq = 0;
const phone = () => `+25078${String(1_000_000 + (Date.now() % 1_000_000) * 3 + ++seq).slice(-7)}`;
async function login() {
  const ph = phone();
  const o = await timed('otp_request', '/api/v1/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone: ph }) });
  if (!o.json?.dev_code) return null;
  const v = await timed('otp_verify_login', '/api/v1/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone: ph, code: o.json.dev_code }), headers: { 'x-device-id': `load-${ph}` } });
  return v.json?.access_token as string | null;
}

async function worker(deadline: number, id: number) {
  const token = await login();
  while (performance.now() < deadline) {
    await timed('health', '/health');
    await timed('config', '/api/v1/config');
    if (token) await timed('estimate', '/api/v1/fares/estimate', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ pickup: KCC, dest: KIMIRONKO }) });
    if (id % 4 === 0) await login();      // a quarter of the workers keep creating sessions to exercise the OTP path
  }
}

const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const f = (n: number) => n.toFixed(1);

const health = await fetch(`${BASE}/health`).catch(() => null);
if (!health?.ok) { console.error(`server not reachable at ${BASE}`); process.exit(1); }
const t0 = performance.now(); const deadline = t0 + DURATION_S * 1000;
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(deadline, i)));
const secs = (performance.now() - t0) / 1000;

const rows = Object.entries(stats).map(([name, s]) => ({
  name, requests: s.lat.length, rps: +(s.lat.length / secs).toFixed(1), ok: s.ok, rate_limited: s.limited, errors: s.err,
  p50_ms: +f(pct(s.lat, 50)), p95_ms: +f(pct(s.lat, 95)), p99_ms: +f(pct(s.lat, 99)), max_ms: +f(Math.max(0, ...s.lat)), first_error: s.firstError,
}));
if (process.argv.includes('--json')) console.log(JSON.stringify({ base: BASE, concurrency: CONCURRENCY, duration_s: +secs.toFixed(1), rows }, null, 2));
else {
  console.log(`load test: ${BASE}  concurrency=${CONCURRENCY}  duration=${secs.toFixed(1)}s  total=${rows.reduce((a, r) => a + r.requests, 0)} requests\n`);
  console.log('| endpoint | requests | req/s | ok | 429 | errors | p50 ms | p95 ms | p99 ms | max ms |\n|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.name} | ${r.requests} | ${r.rps} | ${r.ok} | ${r.rate_limited} | ${r.errors} | ${r.p50_ms} | ${r.p95_ms} | ${r.p99_ms} | ${r.max_ms} |`);
  for (const r of rows) if (r.first_error) console.log(`first error on ${r.name}: ${r.first_error}`);
}
process.exit(0);

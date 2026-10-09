// Quick load test of the hot read paths. Usage: node scripts/loadtest.mjs [http://localhost:8080] [seconds]
// Needs the server started with OTP_DEV_ECHO=true and raised rate limits (RATE_LIMIT_MAX, PLACES_RATE_MAX, AUTH_RATE_MAX), see docs/PERFORMANCE_NOTES.md.
import { execFileSync } from 'node:child_process';
const BASE = process.argv[2] ?? 'http://localhost:8080', SECS = process.argv[3] ?? '10';
const api = (m, p, b, t) => fetch(BASE + '/api/v1' + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}), 'x-device-id': 'load-' + Math.random() }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
const ph = '+25078' + String(1000000 + Math.floor(Math.random() * 8999999));
const o = await api('POST', '/auth/otp/request', { phone: ph });
const v = await api('POST', '/auth/otp/verify', { phone: ph, code: o.dev_code, role: 'passenger' });
const run = (name, url, extra = []) => {
  const out = execFileSync('npx', ['--yes', 'autocannon@7', '-c', '20', '-d', SECS, '--json', '-H', 'authorization=Bearer ' + v.access_token, ...extra, BASE + url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 });
  const j = JSON.parse(out); console.log(`${name.padEnd(34)} ${String(Math.round(j.requests.average)).padStart(6)} req/s  p50 ${j.latency.p50} ms  p99 ${j.latency.p99} ms  non-2xx ${j.non2xx}  errors ${j.errors}`);
};
run('GET /health', '/health');
run('GET /places/popular', '/api/v1/places/popular?lang=en');
run('GET /places/search (offline index)', '/api/v1/places/search?q=hospital&lang=en&lat=-1.95&lng=30.06');
run('GET /places/search (name)', '/api/v1/places/search?q=kimironko&lang=rw');

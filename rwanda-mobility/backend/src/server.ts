import { buildApp } from './app.js';
import { config, configProblems } from './config.js';
import { migrate } from './migrate.js';
import { seedCore, bootstrapAdminIfMissing, resetStaffMfaIfRequested } from './seed.js';
import { startJobs } from './jobs.js';
import { pool } from './db.js';

const app = await buildApp();
const problems = configProblems();
problems.warn.forEach((m) => app.log.warn(`config: ${m}`));
if (problems.fatal.length) {
  problems.fatal.forEach((m) => app.log.error(`config: ${m}`));
  process.exit(1);                                              // refuse to start unsafely configured in production
}
await migrate();
await seedCore();            // idempotent: zones, services, pricing, flags, roles
await bootstrapAdminIfMissing((m) => app.log.warn(m));
await resetStaffMfaIfRequested((m) => app.log.warn(m));   // first deploy only; see BOOTSTRAP_ADMIN_* env vars
const stop = startJobs((m) => app.log.warn(m));
await app.listen({ port: config.port, host: '0.0.0.0' });
if (config.momo.mode === 'simulator') app.log.warn('MOMO_MODE=simulator: mobile-money payments are SIMULATED, not real.');
if (config.smsProvider === 'console') app.log.warn('SMS_PROVIDER=console: OTPs are logged, not sent. Do not use in production.');

// A rejected promise nobody awaited must not kill an API that is serving trips: log it with context and keep going.
process.on('unhandledRejection', (e: any) => app.log.error({ err: e }, 'unhandled rejection'));

// Graceful shutdown: stop scheduling jobs, stop accepting connections and let in-flight requests finish, close the DB pool, then exit.
let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => {
  if (closing) return;
  closing = true;
  app.log.warn(`${sig} received: shutting down`);
  const force = setTimeout(() => { app.log.error('shutdown timed out: forcing exit'); process.exit(1); }, 15_000);
  force.unref();
  try { stop(); await app.close(); await pool.end(); process.exit(0); }
  catch (e: any) { app.log.error({ err: e }, 'error during shutdown'); process.exit(1); }
});

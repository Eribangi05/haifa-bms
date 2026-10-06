import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { seedCore } from './seed.js';
import { startJobs } from './jobs.js';

const app = await buildApp();
await migrate();
await seedCore();            // idempotent: zones, services, pricing, flags, roles
const stop = startJobs((m) => app.log.warn(m));
await app.listen({ port: config.port, host: '0.0.0.0' });
if (config.momo.mode === 'simulator') app.log.warn('MOMO_MODE=simulator: mobile-money payments are SIMULATED, not real.');
if (config.smsProvider === 'console') app.log.warn('SMS_PROVIDER=console: OTPs are logged, not sent. Do not use in production.');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { stop(); await app.close(); process.exit(0); });

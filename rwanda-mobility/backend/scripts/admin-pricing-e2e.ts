// Browser check of the pricing editor: change a price, watch the live preview, propose, approve (self-approval on), and see the new price in real estimates.
// Usage: start a server first, e.g.
//   PORT=8091 DATABASE_URL=postgres://rm:rm@localhost:5432/rwanda_mobility OTP_DEV_ECHO=true node --import tsx src/server.ts &
//   API_ORIGIN=http://localhost:8091 DATABASE_URL=postgres://rm:rm@localhost:5432/rwanda_mobility node --import tsx scripts/admin-pricing-e2e.ts
// NOTE: it really changes the Moto price in the target database (each run raises it), so point it at a scratch/dev database.
// Screenshots go to /tmp/shots/admin-*.png. Stop the server by PID afterwards.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { createStaff } from '../src/seed.ts';
import { totpAt } from '../src/util/crypto.ts';
import { pool } from '../src/db.ts';
const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8091';
mkdirSync('/tmp/shots', { recursive: true });
const mail = `e2e-pricing-${Date.now()}@test.local`, pw = 'Admin-Password-12345';
const adm = await createStaff(mail, pw, 'super_admin', 'E2E Pricing Admin');
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ok = (m: string) => console.log('OK  ', m);
const shot = (p: any, n: string) => p.screenshot({ path: `/tmp/shots/admin-${n}.png`, fullPage: false });
const KCC = { lat: -1.954, lng: 30.0927 }, KIM = { lat: -1.9496, lng: 30.1262 };
let failed = false, token = '';
const call = async (method: string, path: string, body?: any, tok = token) => {
  const r = await fetch(`${ORIGIN}/api/v1${path}`, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) as any };
};
try {
  const A = await (await br.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  A.on('dialog', (d) => d.accept());      // native "leave without saving" confirmations
  await A.goto(ORIGIN + '/admin/'); await A.getByPlaceholder('Email').fill(mail); await A.getByPlaceholder('Password').fill(pw);
  await A.getByPlaceholder('6-digit authenticator code').fill(totpAt(adm.totpSecret)); await A.getByRole('button', { name: 'Sign in' }).click();
  await A.getByRole('button', { name: 'Pricing' }).waitFor(); ok('signed in');
  token = (await call('POST', '/auth/staff/login', { email: mail, password: pw, totp: totpAt(adm.totpSecret) }, '')).json.access_token;
  // a passenger to read real estimates
  const ph = '+25078' + String(Math.floor(1000000 + Math.random() * 8999999));
  const otp = (await call('POST', '/auth/otp/request', { phone: ph }, '')).json;
  const ptok = (await call('POST', '/auth/otp/verify', { phone: ph, code: otp.dev_code, role: 'passenger' }, '')).json.access_token;
  const estimate = async () => (await call('POST', '/fares/estimate', { pickup: KCC, dest: KIM, service_id: 'moto' }, ptok)).json.options[0];
  await call('DELETE', '/admin/settings/pricing.self_approval');      // start from the default (off) so the run is repeatable
  const e0 = await estimate(); const total0 = e0.fare.total; ok(`moto estimate before: ${total0} RWF`);

  // ---- 1. Settings: turn self-approval on (super admin), see the warning banner
  await A.getByRole('button', { name: 'Settings' }).click();
  await A.getByText('Allow self-approval of price changes').waitFor();
  await shot(A, '1-settings');
  await A.getByLabel('Allow self-approval of price changes').check();
  await A.getByRole('button', { name: 'Save', exact: true }).click();
  await A.getByPlaceholder(/Reason/).fill('Two-person team, e2e check'); await A.getByRole('button', { name: 'Turn on' }).click();
  await A.getByText('Self-approval is ON.').first().waitFor(); ok('self-approval switched on from Settings; warning banner visible');
  await shot(A, '2-settings-self-approval');
  // validation + reset to default on a numeric setting
  const fee = A.locator('.setrow', { hasText: 'Late cancellation fee' });
  await fee.getByLabel('Late cancellation fee').fill('99999999'); await fee.getByText(/At most/).waitFor();
  if (!(await fee.getByRole('button', { name: 'Save' }).isDisabled())) throw new Error('save should be disabled for out-of-range value');
  await fee.getByLabel('Late cancellation fee').fill('700'); await fee.getByRole('button', { name: 'Save' }).click();
  await A.getByText('Late cancellation fee saved').waitFor();
  await A.locator('.setrow', { hasText: 'Late cancellation fee' }).getByRole('button', { name: 'Reset to default' }).click();
  await A.getByRole('button', { name: 'Reset', exact: true }).click();
  await A.locator('.setrow', { hasText: 'Late cancellation fee' }).getByText(/using the default/).waitFor(); ok('range validation, inline save, reset to default');

  // ---- 2. Pricing editor
  await A.getByRole('button', { name: 'Pricing' }).click();
  await A.getByText('Self-approval is ON.').first().waitFor();
  await shot(A, '3-pricing-list');
  await A.locator('tr', { hasText: 'Kigali' }).filter({ hasText: /Moto/ }).first().getByRole('button', { name: 'Edit' }).click();
  await A.getByText('Price editor').waitFor();
  const base = A.getByLabel('Base fare', { exact: true }); const before = await base.inputValue();
  await A.getByTestId('preview-total').waitFor(); const prevBefore = await A.getByTestId('preview-total').innerText();
  const newBase = Number(before.replace(/,/g, '')) + 1100;    // always a real change, and >= 1,000 so the separator shows, so the run is repeatable
  await base.fill(String(newBase)); await base.blur(); if (!/^\d{1,3}(,\d{3})+$/.test(await base.inputValue())) throw new Error('thousands separator missing');
  const newBaseNum = Number((await base.inputValue()).replace(/,/g, ''));
  await A.getByLabel('Price per kilometre').fill('300');
  await A.getByText('Fix these first').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
  // validation: negative / too large
  await A.getByLabel('Price per minute').fill('-5'); await A.getByText('At least 0').first().waitFor();
  await A.getByLabel('Price per minute').fill('25');
  // an all-day +10% window so the result does not depend on the clock
  while (await A.locator('.winrow').count()) await A.locator('.winrow').first().getByRole('button', { name: 'Remove' }).click();
  await A.getByRole('button', { name: 'Add a window' }).click();
  const win = A.locator('.winrow').first();
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) await win.getByLabel(d, { exact: true }).uncheck();
  await win.getByLabel('From hour').fill('0'); await win.getByLabel('To hour').fill('24'); await win.getByLabel('Window name').fill('Everyday uplift');
  await A.locator('.preview').getByText('Peak-time adjustment').waitFor({ timeout: 5000 });
  const prevAfter = await A.getByTestId('preview-total').innerText();
  ok(`preview total moved from ${prevBefore} (base ${before}) to ${prevAfter}; peak line itemised`);
  await A.getByText('unsaved change').first().waitFor();
  await shot(A, '4-editor-preview');
  // the UI preview equals the API preview for the same inputs
  const km = await A.getByLabel('Distance', { exact: true }).inputValue(), mins = await A.getByLabel('Duration').inputValue();
  const act0 = (await call('GET', '/admin/pricing')).json.rules.find((r: any) => r.service_id === 'moto' && r.zone_id === 'kigali' && r.status === 'active');
  const keep = ['service_id', 'zone_id', 'model', 'minimum_fare', 'booking_fee', 'wait_per_min', 'free_wait_min', 'airport_fee', 'scheduled_fee', 'tax_bps', 'rounding', 'billing', 'return_per_km', 'night_start_hour', 'night_end_hour', 'night_fee', 'hourly_rate', 'min_hours', 'max_hours', 'long_hire_hours', 'long_hire_rate', 'overtime_per_30min', 'overtime_grace_min'];
  const apiPrev = await call('POST', '/admin/pricing/preview', { rule: { ...Object.fromEntries(keep.map((k) => [k, act0[k]])), base_fare: newBaseNum, per_km: 300, per_min: 25, time_multipliers: [{ label: 'x', days: [], start_hour: 0, end_hour: 24, percent: 10 }] },
    trip: { distance_km: Number(km), duration_min: Number(mins), local_hour: Number(await A.getByLabel('Hour of day').inputValue()), local_dow: Number(await A.getByLabel('Day of week').inputValue()) } });
  const uiTotal = Number(prevAfter.replace(/[^\d]/g, ''));
  if (apiPrev.json.proposed.total !== uiTotal) throw new Error(`preview mismatch ui=${uiTotal} api=${apiPrev.json.proposed.total}`);
  ok('UI preview equals POST /admin/pricing/preview for the same inputs');
  // unsaved-changes guard
  let confirmed = false; A.removeAllListeners('dialog'); A.once('dialog', (d) => { confirmed = true; d.dismiss(); });
  await A.getByRole('button', { name: 'Services' }).click(); await A.waitForTimeout(300);
  if (!confirmed) throw new Error('no unsaved-changes warning'); await A.getByText('Price editor').waitFor(); ok('leaving with unsaved changes asks first, Cancel stays');
  A.on('dialog', (d) => d.accept());
  // propose
  await A.getByRole('button', { name: 'Review and propose' }).click();
  const dlg = A.locator('dialog'); const msg = await dlg.innerText();
  if (!/accepted quotes are unaffected/i.test(msg) || !/Base fare/.test(msg)) throw new Error('confirmation text missing effect: ' + msg);
  await shot(A, '5-confirm'); await dlg.getByRole('button', { name: 'Propose change' }).click();
  await A.getByText('Approve it now?').waitFor(); await dlg.getByRole('button', { name: 'Approve my own change' }).click();
  await A.getByText('Current prices').waitFor(); await A.waitForTimeout(500);
  ok('proposed and self-approved in the console');
  await shot(A, '6-after-approve');
  const e1 = await estimate();
  if (e1.fare.total <= total0) throw new Error(`estimate did not rise: ${total0} -> ${e1.fare.total}`);
  if (!e1.fare.lines.some((l: any) => l.code === 'time_multiplier')) throw new Error('estimate lacks the itemised time line');
  ok(`/fares/estimate now ${e1.fare.total} RWF (was ${total0}), with itemised "${e1.fare.lines.find((l: any) => l.code === 'time_multiplier').label_en}"`);
  const log = (await call('GET', '/admin/audit?action=pricing.approved&limit=1')).json.logs[0];
  if (log.after.self_approved !== true) throw new Error('audit lacks self_approved flag'); ok('audit log records self_approved: true');

  // ---- 3. promotions and services screens render
  await A.getByRole('button', { name: 'Promotions' }).click(); await A.getByText('New promotion').waitFor(); await shot(A, '7-promotions');
  await A.getByRole('button', { name: 'Services' }).click(); await A.getByRole('heading', { name: 'Services' }).waitFor(); await shot(A, '8-services'); ok('promotions and services screens render');
  // restore: switch self-approval back off
  await call('DELETE', '/admin/settings/pricing.self_approval');
} catch (e: any) { failed = true; console.log('FAIL', e.message.split('\n')[0]); await call('DELETE', '/admin/settings/pricing.self_approval').catch(() => {}); }
await br.close(); await pool.end(); process.exit(failed ? 1 : 0);

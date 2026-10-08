// Browser check of the round-3 admin views (credit and loyalty, claims with before/after evidence, USSD log).
// Usage: TEST_DB_NAME=rm_test_b3 node --import tsx scripts/money-e2e.ts      (boots its own server on port 8095 against the scratch database, which it wipes)
import { boot } from '../tests/helpers.ts';
import { abasareKit, photo } from '../tests/helpersAbasare.ts';

process.env.USSD_SHARED_SECRET = 'e2e-ussd-secret-0123456789';
const t = await boot('rm_test_b3');
await t.app.listen({ port: 8095, host: '127.0.0.1' });
const ORIGIN = 'http://127.0.0.1:8095';
let failed = 0;
const check = (m: string, c: any, extra = '') => { if (c) console.log('OK  ', m); else { failed++; console.log('FAIL', m, extra); } };
const pw: any = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core'); const chromium = pw.chromium ?? pw.default.chromium;   // e.g. PLAYWRIGHT_CORE=/opt/node-tools/node_modules/playwright-core/index.js
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
try {
  const verifier = await t.staff('driver_verifier'); const K = abasareKit(t, verifier);
  const admin = await t.staff('super_admin'); const lead = await t.staff('support_lead'); const agent = await t.staff('support_agent');
  // data: a customer with credit, a complete Abasare trip with a damage claim, a USSD sign-up
  const owner = await t.register(); const car = await K.car(owner); const drv = await K.drvr();
  await t.api('POST', '/admin/wallet/adjustments', { token: admin.token, body: { user_id: owner.id, amount: 5000, reason: 'e2e welcome credit for owner' } });
  await t.api('POST', '/admin/wallet/adjustments', { token: admin.token, body: { user_id: owner.id, amount: 90000, reason: 'e2e large credit waits for approval' } });
  const { res } = await K.book(owner, car.id); await K.fullTrip(owner, drv, res.json.booking.id);
  const claim = await t.api('POST', `/bookings/${res.json.booking.id}/claims`, { token: owner.token, body: { type: 'damage', description: 'Scratch on the rear left door after the trip', claimed_amount: 40000 } });
  await t.api('POST', `/claims/${claim.json.id}/evidence`, { token: owner.token, ...photo() });
  await t.api('POST', `/claims/${claim.json.id}/messages`, { token: drv.token, body: { body: 'The scratch was already there at pickup' } });
  await t.app.inject({ method: 'POST', url: '/ussd/callback', payload: 'sessionId=e2e1&phoneNumber=%2B250788777001&text=', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-ussd-secret': process.env.USSD_SHARED_SECRET! } });

  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); const P = await ctx.newPage(); (globalThis as any).__page = P;
  const errors: string[] = []; P.on('pageerror', (e) => errors.push(e.message)); P.on('console', (m) => { if (m.type() === 'error' && !/tile|favicon|403/i.test(m.text())) errors.push(m.text()); });
  await P.goto(ORIGIN + '/admin/'); await P.getByPlaceholder('Email').fill(admin.email); await P.getByPlaceholder('Password').fill(admin.password);
  await P.getByPlaceholder('6-digit authenticator code').fill(t.crypto.totpAt(admin.totpSecret)); await P.getByRole('button', { name: 'Sign in' }).click(); await P.locator('#view').waitFor({ timeout: 15000 });
  const tab = async (name: string) => { await P.locator('nav button', { hasText: new RegExp('^' + name + '$') }).click(); await P.locator('#view:not(.loading)').waitFor(); await P.waitForTimeout(250); };

  await tab('Credit & loyalty');
  check('credit page loads with the no-cash notice', await P.getByText('cannot be topped up with cash').isVisible());
  await P.locator('#view input[type=search]').fill(owner.phone); await P.getByRole('button', { name: 'Search', exact: true }).click(); await P.locator('#view:not(.loading)').waitFor(); await P.waitForTimeout(300);
  check('lookup finds the customer and shows the credit', (await P.locator('#view tbody tr').count()) === 1 && /5,000 RWF/.test(await P.locator('#view tbody').innerText()));
  await P.locator('#view tbody tr').first().click(); await P.locator('dialog[open] h2').waitFor();
  check('statement dialog lists the credit entry', /Credit added/.test(await P.locator('dialog[open]').innerText()));
  await P.screenshot({ path: '/tmp/shots/money-wallet-statement.png' });
  await P.getByRole('button', { name: 'Change credit' }).click(); await P.locator('dialog[open] input[type=number]').fill('2500'); await P.locator('dialog[open] textarea').fill('short');
  await P.getByRole('button', { name: 'Submit' }).click(); await P.waitForTimeout(300);
  check('too-short reason is refused inside the dialog', /at least 10 characters/.test(await P.locator('dialog[open]').last().innerText()));
  await P.locator('dialog[open] textarea').fill('e2e goodwill after a late driver'); await P.getByRole('button', { name: 'Submit' }).click(); await P.waitForTimeout(800);
  check('small change applies at once', (await P.locator('#view').innerText()).includes('2,500') || /Credit changed/.test(await P.locator('#toasts').innerText().catch(() => '')));
  await tab('Credit & loyalty'); await P.getByRole('tab', { name: 'Credit changes' }).click(); await P.locator('#view:not(.loading)').waitFor(); await P.waitForTimeout(300);
  check('large change is waiting for approval', /90,000/.test(await P.locator('#view').innerText()) && (await P.getByRole('button', { name: 'Approve' }).count()) === 1);
  await P.screenshot({ path: '/tmp/shots/money-adjustments.png' });
  await P.getByRole('button', { name: 'Approve' }).click(); await P.locator('dialog[open]').waitFor();
  await P.locator('dialog[open]').getByRole('button', { name: 'Approve' }).click(); await P.waitForTimeout(800);
  check('same person cannot approve their own large change (error shown)', /cannot approve their own|Maker-checker/.test(await P.locator('#toasts').innerText().catch(() => '')));
  await tab('Credit & loyalty'); await P.getByRole('tab', { name: 'Loyalty and tiers' }).click(); await P.locator('#view:not(.loading)').waitFor(); await P.waitForTimeout(300);
  check('loyalty tiers table and reconciliation banner', (await P.locator('#view tbody tr').count()) >= 3 && /reconciliation/i.test(await P.locator('#view').innerText()));

  await tab('Claims');
  check('claims queue shows the claim', (await P.locator('#view tbody tr').count()) === 1);
  await P.locator('#view tbody tr').first().click(); await P.locator('dialog[open] h2', { hasText: 'damage claim' }).waitFor();
  const dlg = P.locator('dialog[open]');
  check('before/after comparison with 4 photos', (await dlg.getByText('At pickup', { exact: true }).count()) === 1 && (await dlg.locator('img[alt^="At "]').count()) === 4, String(await dlg.locator('img[alt^="At "]').count()));
  await P.waitForTimeout(600);
  const loaded = await dlg.locator('img').evaluateAll((imgs) => imgs.filter((i: any) => i.complete && i.naturalWidth > 0).length);
  check('evidence images actually load through signed links', loaded >= 4, String(loaded));
  check('timeline shows the filing and the reply', /Filed/.test(await dlg.innerText()) && /Reply from the other party/.test(await dlg.innerText()));
  await P.screenshot({ path: '/tmp/shots/money-claim-dialog.png', fullPage: false });
  await dlg.getByRole('button', { name: 'Add internal note' }).click(); await P.locator('dialog[open] textarea').last().fill('e2e internal note for staff'); await P.getByRole('button', { name: 'Save' }).click(); await P.waitForTimeout(800);
  check('internal note appears marked staff only', /staff only/.test(await P.locator('dialog[open]').innerText()));
  await P.locator('dialog[open]').getByRole('button', { name: 'Decide' }).click(); await P.locator('dialog[open]').last().waitFor();
  await P.locator('dialog[open]').last().locator('textarea').fill('Photos show the scratch is new since pickup'); await P.getByRole('button', { name: 'Record decision' }).click(); await P.waitForTimeout(900);
  check('decision recorded: status accepted', /Accepted/.test(await P.locator('dialog[open]').innerText()));
  check('settle action offered after acceptance', (await P.locator('dialog[open]').getByRole('button', { name: 'Settle' }).count()) === 1);
  await P.keyboard.press('Escape');

  await tab('USSD channel');
  check('USSD page shows kpis and the masked session log', /USSD sessions/.test(await P.locator('#view').innerText()) && /\*\*\*/.test(await P.locator('#view tbody').last().innerText()));
  await P.screenshot({ path: '/tmp/shots/money-ussd.png' });

  // permission gating: an agent sees claims but not credit; a lead can decide
  const ctx2 = await br.newContext({ viewport: { width: 390, height: 800 } }); const Q = await ctx2.newPage();
  await Q.goto(ORIGIN + '/admin/'); await Q.getByPlaceholder('Email').fill(agent.email); await Q.getByPlaceholder('Password').fill(agent.password);
  await Q.getByPlaceholder('6-digit authenticator code').fill(t.crypto.totpAt(agent.totpSecret)); await Q.getByRole('button', { name: 'Sign in' }).click(); await Q.locator('#view').waitFor({ timeout: 15000 });
  await Q.locator('[data-nav-toggle]').click(); await Q.waitForTimeout(200);
  const navText = await Q.locator('nav#sidenav').innerText();
  check('agent menu: Claims yes, USSD channel no', /Claims/.test(navText) && !/USSD channel/.test(navText));
  await Q.locator('nav button', { hasText: /^Claims$/ }).click(); await Q.locator('#view:not(.loading)').waitFor(); await Q.waitForTimeout(300);
  check('phone layout: no sideways scroll on claims', (await Q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 2);
  await Q.screenshot({ path: '/tmp/shots/money-claims-phone.png' });
  check('no script errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e: any) { failed++; try { const pg = (globalThis as any).__page; if (pg) { await pg.screenshot({ path: '/tmp/shots/money-fail.png' }); console.log((await pg.locator('body').innerText()).slice(0, 600)); } } catch { /* ignore */ } console.log('FAIL script error:', e.message.split('\n').slice(0, 4).join(' | ')); }
await br.close(); await t.close();
console.log(failed ? `\n${failed} problem(s)` : '\nall money console checks passed');
process.exit(failed ? 1 : 0);

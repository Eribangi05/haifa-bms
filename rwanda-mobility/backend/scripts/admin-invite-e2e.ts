// Browser check of the staff-invite flow (admin invites, invitee enrols own authenticator, invitee signs in).
// Usage (server running with OTP not needed): API_ORIGIN=http://localhost:8090 DATABASE_URL=... node --import tsx scripts/admin-invite-e2e.ts
import { chromium } from 'playwright-core';
import { createStaff } from '../src/seed.ts';
import { totpAt } from '../src/util/crypto.ts';
import { pool } from '../src/db.ts';
const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8090';
const mail = `e2e-admin-${Date.now()}@test.local`, pw = 'Admin-Password-12345', invitee = `invitee-${Date.now()}@test.local`, newPw = 'Invitee-Password-12345';
const adm = await createStaff(mail, pw, 'super_admin', 'E2E Admin');
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ok = (m: string) => console.log('OK  ', m);
let failed = false;
try {
  const A = await (await br.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  await A.goto(ORIGIN + '/admin/'); await A.getByPlaceholder('Email').fill(mail); await A.getByPlaceholder('Password').fill(pw);
  await A.getByPlaceholder('6-digit authenticator code').fill(totpAt(adm.totpSecret)); await A.getByRole('button', { name: 'Sign in' }).click();
  await A.getByRole('button', { name: 'Staff' }).click(); ok('admin signed in, opened Staff');
  await A.getByRole('button', { name: 'Invite staff member' }).click();
  await A.getByPlaceholder('Full name').fill('E2E Invitee'); await A.getByPlaceholder('Email').last().fill(invitee);
  await A.locator('dialog select').selectOption('driver_verifier'); await A.getByRole('button', { name: 'Create invitation' }).click();
  const link = await A.locator('dialog input[readonly]').inputValue();
  if (!link.includes('#activate=')) throw new Error('no invite link');
  const body = await A.locator('dialog').innerText(); if (/[A-Z2-7]{32}/.test(body)) throw new Error('admin dialog shows a secret');
  ok('invite link created; admin dialog shows no authenticator secret'); await A.screenshot({ path: '/tmp/shots/invite-1-admin.png' });

  const B = await (await br.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  await B.goto(link.replace(/^https?:\/\/[^/]+/, ORIGIN)); await B.getByText('Welcome, E2E Invitee').waitFor();
  await B.getByRole('button', { name: 'Start setup' }).click(); await B.getByAltText('Authenticator QR code').waitFor();
  await B.getByText('Cannot scan?').click(); const secret = (await B.locator('details code').innerText()).trim();
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('bad secret ' + secret);
  await B.screenshot({ path: '/tmp/shots/invite-2-invitee-qr.png' }); ok('invitee sees own QR + 32-char key');
  await B.getByPlaceholder(/Choose a password/).fill(newPw); await B.getByPlaceholder('Repeat the password').fill(newPw);
  await B.getByPlaceholder('6-digit code from the app').fill(totpAt(secret)); await B.getByRole('button', { name: 'Activate my account' }).click();
  await B.getByText('All set').waitFor(); ok('invitee activated');
  await B.getByRole('button', { name: 'Go to sign in' }).click();
  await B.getByPlaceholder('Email').fill(invitee); await B.getByPlaceholder('Password').fill(newPw); await B.getByPlaceholder('6-digit authenticator code').fill(totpAt(secret));
  await B.getByRole('button', { name: 'Sign in' }).click(); await B.getByRole('heading', { name: 'Drivers' }).waitFor({ timeout: 15000 }); ok('invitee signed in with own password + own authenticator');
} catch (e: any) { failed = true; console.log('FAIL', e.message.split('\n')[0]); }
await br.close(); await pool.end(); process.exit(failed ? 1 : 0);

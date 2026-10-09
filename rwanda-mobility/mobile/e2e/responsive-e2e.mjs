// Responsive / large-text pass: walks the main screens in French (longest strings) and Kinyarwanda at 360 and 320 px wide,
// also with a 1.3x zoom as a stress test for large system fonts, and reports horizontal overflow, clipped text and small touch targets.
// Usage: node e2e/responsive-e2e.mjs <screenshot-dir>    (prereqs: see app-e2e.mjs)
import { chromium } from 'playwright-core';
import { visibleOnly } from './visible.mjs';
const API = (process.env.API_ORIGIN ?? 'http://localhost:8080') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const L = { fr: { label: 'Français', cont: 'Continuer', send: 'Envoyer le code', ok: 'Autoriser', prof: 'Profil', help: 'Aide', ab: 'Abasare' }, rw: { label: 'Kinyarwanda', cont: 'Komeza', send: 'Ohereza kode', ok: 'Emera', prof: 'Umwirondoro', help: 'Ubufasha', ab: 'Abasare' } };

function page_audit() {
  const W = innerWidth, out = { overflowX: document.documentElement.scrollWidth > W + 1, clipped: [], small: [], offscreen: [] };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (r.right > W + 2 && cs.position !== 'fixed' && !el.closest('[style*="overflow"]')) out.offscreen.push((el.innerText || el.tagName).slice(0, 40));
    if (el.children.length === 0 && (el.innerText || '').trim() && el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis') out.clipped.push(el.innerText.slice(0, 40));
    const role = el.getAttribute('role'), tag = el.tagName;
    if ((role === 'button' || role === 'radio' || role === 'checkbox' || tag === 'BUTTON') && (r.height < 43 || r.width < 43)) out.small.push(`${(el.innerText || el.getAttribute('aria-label') || '').slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
}
let bad = 0;
for (const lang of ['fr', 'rw']) for (const [w, zoom] of [[360, 1], [320, 1], [360, 1.3], [320, 1.3]]) {
  const l = L[lang]; const tag = `${lang}-${w}${zoom > 1 ? '-x1.3' : ''}`;
  const ctx = await br.newContext({ viewport: { width: w, height: 740 }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] });
  const page = visibleOnly(await ctx.newPage()); const phone = '+2507885' + String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
  const check = async (name) => { if (zoom > 1) await page.evaluate((z) => { document.body.style.zoom = z; }, zoom); await page.waitForTimeout(300);
    const r = await page.evaluate(page_audit); await page.screenshot({ path: `${OUT}/resp-${tag}-${name}.png` });
    const issues = [r.overflowX && 'horizontal-scroll', r.offscreen.length && 'offscreen:' + r.offscreen.slice(0, 3).join('|'), r.clipped.length && 'clipped:' + r.clipped.slice(0, 3).join('|'), r.small.length && 'small-targets:' + r.small.slice(0, 4).join('|')].filter(Boolean);
    if (issues.length) { bad++; console.log('WARN', tag, name, issues.join(' ; ')); } else console.log('OK  ', tag, name); };
  await page.goto(WEB); await page.getByText(l.label, { exact: true }).click(); await page.waitForTimeout(300); await check('welcome');
  await page.getByText(l.cont, { exact: true }).click(); await page.getByPlaceholder('07X XXX XXXX').fill('0' + phone.slice(4)); await check('phone');
  await page.getByText(l.send, { exact: true }).click();
  const dev = await page.getByText(/(?:code|kode): \d{6}/).first().textContent(); await page.getByPlaceholder('••••••').fill(dev.match(/: (\d{6})/)[1]); await check('otp');
  await page.getByRole('button').filter({ hasText: lang === 'fr' ? /Vérifier|Valider/ : /Emeza/ }).first().click();
  await page.getByTestId('tabbar').waitFor({ timeout: 20000 }); await page.waitForTimeout(1500); await check('home');
  await page.getByTestId('tab-book').click(); await page.getByText(l.ok, { exact: true }).waitFor({ timeout: 20000 }); await check('consent'); await page.getByText(l.ok, { exact: true }).click(); await page.waitForTimeout(1500); await check('book');
  await page.getByText(l.ab, { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(800); await check('abasare');
  for (const k of ['trips', 'wallet', 'account']) { await page.getByTestId('tab-' + k).click(); await page.waitForTimeout(900); await check(k); }
  await page.getByTestId('acc-edit').click(); await page.waitForTimeout(800); await check('profile');
  await page.getByLabel(lang === 'fr' ? 'Retour' : 'Subira inyuma').click(); await page.waitForTimeout(300);
  await page.getByTestId('open-help').click(); await page.waitForTimeout(1200); await check('support');
  await ctx.close();
}
console.log(bad ? `${bad} screens with warnings` : 'all clean'); await br.close();

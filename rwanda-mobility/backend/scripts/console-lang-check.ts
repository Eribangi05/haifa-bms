// Opens every console page as a super admin in Kinyarwanda and in French and lists the visible texts that still look English (never mixing languages is a rule).
// Usage: API_ORIGIN=http://localhost:8080 DATABASE_URL=... node --import tsx scripts/console-lang-check.ts [rw|fr] ; exits 1 when something English is left.
import { chromium } from 'playwright-core';
import { createStaff } from '../src/seed.ts';
import { totpAt } from '../src/util/crypto.ts';
import { pool } from '../src/db.ts';
const O = process.env.API_ORIGIN ?? 'http://localhost:8080';
const langs = process.argv[2] ? [process.argv[2]] : ['rw', 'fr'];
const EN = new Set('the and of to for with you your is are was not no on in at by from this that it be or as an a can will has have if when then than only each any all new more less last first per out up off about over into after before while between without under please check ask enter select choose use add remove save cancel open close show hide search filter loading failed error cannot unable sorry done yes'.split(' '));
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const email = `lang${Date.now()}@x.rw`; const s = await createStaff(email, 'Audit-Password-12345', 'super_admin', 'Lang Check');
const looksEnglish = (t: string) => { const w = t.toLowerCase().match(/[a-z']+/g) ?? []; if (w.length < 1) return false; const hits = w.filter((x) => EN.has(x)); return hits.length >= 1 && (w.length <= 3 ? hits.length >= 1 && w.length === hits.length || /^[A-Z]/.test(t) && hits.length >= 1 : hits.length >= 1); };
let total = 0;
for (const lang of langs) {
  const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(O + '/admin/'); await p.getByPlaceholder(/Email|Imeri|E-mail/).fill(email); await p.locator('input[type=password]').fill('Audit-Password-12345'); await p.locator('input[inputmode=numeric]').fill(totpAt(s.totpSecret)); await p.locator('button[type=submit]').click();
  await p.locator('nav button').first().waitFor({ timeout: 15000 });
  await p.locator('.langsel').selectOption(lang); await p.waitForTimeout(600);
  const tabs = await p.locator('nav button[data-tab]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tab));
  const seen = new Map<string, string>();
  for (const tab of tabs) {
    await p.evaluate((t) => { location.hash = '#/' + t; }, tab); await p.waitForTimeout(1300);
    const texts: string[] = await p.evaluate(() => {
      const out: string[] = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const n = w.currentNode as Text; const t = n.data.trim(); if (!t) continue; const pe = n.parentElement; if (!pe || /^(SCRIPT|STYLE|CODE|PRE)$/.test(pe.tagName) || pe.closest('code,.mono,pre') || (pe as HTMLElement).offsetParent === null && pe.tagName !== 'BODY') continue; out.push(t); }
      document.querySelectorAll('[placeholder],[aria-label],[title]').forEach((e) => { for (const a of ['placeholder', 'aria-label', 'title']) { const v = e.getAttribute(a); if (v) out.push(v); } });
      return out;
    });
    for (const t of texts) if (looksEnglish(t) && !seen.has(t)) seen.set(t, tab);
  }
  console.log(`\n== ${lang}: ${seen.size} texts still look English`);
  for (const [t, tab] of seen) console.log(`${tab}\t${t.slice(0, 160)}`);
  total += seen.size; await p.close();
}
await br.close(); await pool.end(); process.exit(total ? 1 : 0);

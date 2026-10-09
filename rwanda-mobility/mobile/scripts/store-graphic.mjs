// Regenerates ../store/feature-graphic-1024x500.png from the brand assets. Run from rwanda-mobility/mobile: node scripts/store-graphic.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const A = (p) => 'data:image/png;base64,' + readFileSync(new URL('../assets/' + p, import.meta.url).pathname).toString('base64');
const html = `<html><body style="margin:0;width:1024px;height:500px;background:linear-gradient(135deg,#0A5FA8,#0069A8 55%,#0A4B9C);font-family:Inter,Arial,sans-serif;position:relative;overflow:hidden">
<div style="position:absolute;right:-90px;top:-90px;width:340px;height:340px;border-radius:50%;background:#FAD201;opacity:.22"></div>
<div style="position:absolute;right:230px;bottom:-130px;width:300px;height:300px;border-radius:50%;background:#20603D;opacity:.35"></div>
<img src="${A('logo.png')}" style="position:absolute;left:60px;top:70px;width:360px;height:360px;border-radius:70px;box-shadow:0 12px 40px #00000055">
<div style="position:absolute;left:470px;top:92px;color:#fff;font-size:72px;font-weight:800;letter-spacing:2px">Abasare</div>
<div style="position:absolute;left:472px;top:186px;color:#FAD201;font-size:30px;font-weight:800;letter-spacing:4px">RIDE · WORK · EXPLORE</div>
<div style="position:absolute;left:472px;top:240px;color:#fff;font-size:25px;line-height:34px;width:480px;opacity:.95">Safe moto and car rides across Rwanda, and a verified driver for your own car.</div>
<div style="position:absolute;left:472px;top:376px;display:flex;gap:18px">
${['tab_home', 'tab_book', 'tab_trips', 'tab_wallet', 'tab_account'].map((n) => `<img src="${A('icons/' + n + '.png')}" style="width:68px;height:68px;border-radius:17px">`).join('')}</div>
<div style="position:absolute;left:0;right:0;bottom:0;height:18px;display:flex;flex-direction:column"><div style="flex:2;background:#00A1DE"></div><div style="flex:1;background:#FAD201"></div><div style="flex:1;background:#20603D"></div></div>
</body></html>`;
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await br.newPage({ viewport: { width: 1024, height: 500 } });
await page.setContent(html); await page.waitForTimeout(500);
await page.screenshot({ path: new URL('../../store/feature-graphic-1024x500.png', import.meta.url).pathname });
await br.close(); console.log('feature graphic written');

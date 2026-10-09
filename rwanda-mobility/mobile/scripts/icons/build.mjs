// Builds the designed icons (the ones that are not cropped from the supplied artwork) as 192 px PNGs in assets/icons/.
// Style: glossy blue disc (Rwanda sky blue to deep blue) with white / sun-yellow / red glyphs, or a gradient rounded tile for tabs.
// Run: node scripts/icons/build.mjs   (needs Playwright's Chromium; PLAYWRIGHT_BROWSERS_PATH or CHROMIUM_PATH)
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = new URL('../../assets/icons/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const W = '#FFFFFF', Y = '#FAD201', O = '#F59E0B', R = '#E53935', G = '#2BB673', DK = '#0B2E66', SK = '#00A1DE', GR = '#20603D', LB = '#BFE4FA';

const disc = (g, id) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="192" height="192"><defs>
<linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3C97F0"/><stop offset="1" stop-color="#0A4B9C"/></linearGradient>
<linearGradient id="r${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FC0FF"/><stop offset="1" stop-color="#06357A"/></linearGradient>
<radialGradient id="l${id}" cx="50%" cy="0%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<filter id="s${id}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#021a44" flood-opacity=".45"/></filter></defs>
<circle cx="64" cy="64" r="62" fill="url(#r${id})"/><circle cx="64" cy="64" r="57" fill="url(#g${id})"/><ellipse cx="64" cy="28" rx="46" ry="24" fill="url(#l${id})"/>
<g transform="translate(64 66)" filter="url(#s${id})">${g}</g></svg>`;
const tile = (c1, c2, g, id) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="192" height="192"><defs>
<linearGradient id="t${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<radialGradient id="l${id}" cx="30%" cy="0%" r="90%"><stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<filter id="s${id}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#021a44" flood-opacity=".4"/></filter></defs>
<rect x="2" y="2" width="124" height="124" rx="30" fill="url(#t${id})"/><rect x="2" y="2" width="124" height="70" rx="30" fill="url(#l${id})"/>
<g transform="translate(64 66)" filter="url(#s${id})">${g}</g></svg>`;

const P = (d, f, extra = '') => `<path d="${d}" fill="${f}" ${extra}/>`;
const C = (x, y, r, f, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" ${extra}/>`;
const Rc = (x, y, w, h, r, f, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}" ${extra}/>`;
const L = (x1, y1, x2, y2, c, w = 4) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
const star = (cx, cy, r, f) => { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; p.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`); } return `<polygon points="${p.join(' ')}" fill="${f}"/>`; };

const GLYPHS = {
  ride: C(-26, 24, 10, DK) + C(-26, 24, 5, W) + C(28, 24, 10, DK) + C(28, 24, 5, W) + Rc(-36, 6, 66, 12, 6, W) + Rc(-38, -12, 34, 14, 7, Y) + P('M26 24 L14 -22', 'none', `stroke="${W}" stroke-width="8" stroke-linecap="round"`) + L(4, -28, 26, -28, W, 7) + Rc(-6, -8, 24, 16, 7, LB),
  captain: C(0, -2, 17, '#F2C9A0') + P('M-20 -12 Q0 -42 20 -12 Z', W) + Rc(-24, -14, 48, 8, 4, DK) + C(0, -16, 5, Y) + P('M-34 38 Q-34 14 0 14 Q34 14 34 38 Z', W) + P('M-6 16 L0 30 L6 16 Z', R),
  qr: Rc(-32, -32, 26, 26, 5, W) + Rc(6, -32, 26, 26, 5, W) + Rc(-32, 6, 26, 26, 5, W) + Rc(-25, -25, 12, 12, 2, DK) + Rc(13, -25, 12, 12, 2, DK) + Rc(-25, 13, 12, 12, 2, DK) + Rc(8, 8, 10, 10, 2, Y) + Rc(22, 8, 10, 10, 2, W) + Rc(8, 22, 10, 10, 2, W) + Rc(22, 22, 10, 10, 2, Y),
  pin: P('M0 36 C-26 6 -30 -6 -30 -14 A30 30 0 0 1 30 -14 C30 -6 26 6 0 36 Z', R) + C(0, -14, 12, W) + `<ellipse cx="0" cy="38" rx="20" ry="5" fill="#021a44" opacity=".35"/>`,
  road: P('M-12 -34 L12 -34 L34 34 L-34 34 Z', '#3A4A63') + L(0, -28, 0, -16, Y, 4) + L(0, -8, 0, 6, Y, 5) + L(0, 16, 0, 30, Y, 6) + L(-12, -34, -34, 34, W, 3) + L(12, -34, 34, 34, W, 3),
  cash: Rc(-38, -22, 76, 44, 8, G) + Rc(-38, -22, 76, 44, 8, 'none', `stroke="${W}" stroke-width="3"`) + C(0, 0, 13, Y) + `<text x="0" y="6" text-anchor="middle" font-family="Arial" font-weight="900" font-size="17" fill="${GR}">$</text>` + C(-27, 0, 4, W) + C(27, 0, 4, W),
  coins: `<ellipse cx="0" cy="22" rx="28" ry="10" fill="${O}"/><rect x="-28" y="8" width="56" height="14" fill="${O}"/><ellipse cx="0" cy="8" rx="28" ry="10" fill="${Y}"/><rect x="-28" y="-6" width="56" height="14" fill="${O}"/><ellipse cx="0" cy="-6" rx="28" ry="10" fill="${Y}"/><rect x="-28" y="-20" width="56" height="14" fill="${O}"/><ellipse cx="0" cy="-20" rx="28" ry="10" fill="#FFE766"/>`,
  chart: Rc(-34, 6, 16, 28, 4, W) + Rc(-8, -10, 16, 44, 4, Y) + Rc(18, -30, 16, 64, 4, G) + L(-36, 38, 36, 38, W, 4),
  shield: P('M0 -38 L32 -26 V0 C32 20 16 32 0 40 C-16 32 -32 20 -32 0 V-26 Z', W) + P('M0 -30 L24 -21 V0 C24 14 12 24 0 31 Z', G) + P('M-11 2 L-3 11 L13 -9', 'none', `stroke="${W}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"`),
  people: C(-18, -14, 12, W) + P('M-38 30 Q-38 8 -18 8 Q2 8 2 30 Z', W) + C(18, -10, 14, Y) + P('M-2 34 Q-2 8 18 8 Q38 8 38 34 Z', Y),
  siren: Rc(-26, 12, 52, 16, 5, W) + P('M-20 12 V-4 A20 20 0 0 1 20 -4 V12 Z', R) + P('M-10 12 V-2 A10 10 0 0 1 10 -2 V12 Z', '#FF8A80') + L(0, -34, 0, -28, Y, 5) + L(-30, -18, -24, -14, Y, 5) + L(30, -18, 24, -14, Y, 5),
  cross: Rc(-34, -34, 68, 68, 16, W) + Rc(-8, -24, 16, 48, 4, R) + Rc(-24, -8, 48, 16, 4, R),
  flame: P('M0 -38 C6 -22 26 -12 26 8 A26 26 0 0 1 -26 8 C-26 -2 -20 -8 -14 -14 C-12 -4 -8 -2 -4 -4 C-8 -18 -4 -28 0 -38 Z', O) + P('M0 -8 C4 0 14 4 14 14 A14 14 0 0 1 -14 14 C-14 6 -6 4 0 -8 Z', Y),
  lock: P('M-18 -6 V-18 A18 18 0 0 1 18 -18 V-6', 'none', `stroke="${W}" stroke-width="8" stroke-linecap="round"`) + Rc(-30, -6, 60, 42, 10, Y) + C(0, 12, 6, DK) + Rc(-2.5, 12, 5, 14, 2, DK),
  star: star(0, 2, 38, Y) + star(0, 2, 38, 'none'),
  traffic: Rc(-18, -38, 36, 76, 12, DK) + C(0, -22, 9, R) + C(0, 0, 9, Y) + C(0, 22, 9, G),
  search: C(-6, -6, 22, 'none', `stroke="${W}" stroke-width="8"`) + L(10, 10, 32, 32, Y, 10),
  bulb: P('M0 -36 A24 24 0 0 1 14 8 V16 H-14 V8 A24 24 0 0 1 0 -36 Z', Y) + Rc(-12, 18, 24, 6, 3, W) + Rc(-8, 27, 16, 6, 3, W),
  briefcase: Rc(-34, -14, 68, 46, 8, '#C98A3D') + P('M-12 -14 V-22 A4 4 0 0 1 -8 -26 H8 A4 4 0 0 1 12 -22 V-14', 'none', `stroke="${W}" stroke-width="6"`) + Rc(-34, 4, 68, 5, 0, '#8A5A1E') + Rc(-6, 0, 12, 12, 3, Y),
  school: P('M0 -30 L38 -12 L0 6 L-38 -12 Z', W) + P('M-22 0 V16 Q0 30 22 16 V0 L0 10 Z', LB) + L(34, -10, 34, 14, Y, 4) + C(34, 18, 4, Y),
  user: C(0, -14, 16, W) + P('M-32 36 Q-32 8 0 8 Q32 8 32 36 Z', W),
  mobile: Rc(-20, -36, 40, 72, 10, W) + Rc(-15, -28, 30, 50, 3, SK) + C(0, 29, 4, DK) + P('M-6 -12 L-6 2 M6 -14 L6 6', 'none', `stroke="${Y}" stroke-width="5" stroke-linecap="round"`),
  idcard: Rc(-38, -26, 76, 52, 8, W) + C(-18, -6, 9, SK) + P('M-32 20 Q-32 6 -18 6 Q-4 6 -4 20 Z', SK) + L(6, -12, 30, -12, DK, 5) + L(6, 0, 30, 0, '#9AA8C2', 4) + L(6, 11, 24, 11, '#9AA8C2', 4),
  compass: C(0, 0, 36, W) + C(0, 0, 30, SK) + P('M0 -22 L9 0 L0 22 L-9 0 Z', R) + P('M0 -22 L9 0 L-9 0 Z', W) + C(0, 0, 4, DK),
  clock: C(0, 0, 36, W) + L(0, 0, 0, -22, DK, 6) + L(0, 0, 16, 8, R, 5) + C(0, 0, 4, DK),
  camera: Rc(-38, -18, 76, 52, 10, W) + P('M-14 -18 L-8 -30 H8 L14 -18 Z', W) + C(0, 8, 18, DK) + C(0, 8, 11, SK) + C(26, -8, 4, Y),
  flag: L(-24, -34, -24, 38, W, 6) + P('M-22 -32 H34 L22 -14 L34 4 H-22 Z', Y) + Rc(-4, -32, 14, 12, 0, DK) + Rc(10, -20, 12, 12, 0, DK),
  moon: P('M10 -36 A36 36 0 1 0 36 12 A28 28 0 0 1 10 -36 Z', Y) + star(26, -22, 7, W) + star(-8, -26, 5, W),
  seat: P('M-22 -34 H4 A10 10 0 0 1 14 -24 V6 H34 A8 8 0 0 1 34 22 H-6 A12 12 0 0 1 -18 10 Z', W) + Rc(-22, 28, 54, 8, 4, LB),
  van: Rc(-40, -22, 80, 42, 12, W) + Rc(-32, -14, 20, 16, 3, SK) + Rc(-6, -14, 20, 16, 3, SK) + Rc(18, -14, 14, 16, 3, SK) + C(-22, 22, 10, DK) + C(-22, 22, 4, W) + C(22, 22, 10, DK) + C(22, 22, 4, W),
  office: Rc(-26, -36, 52, 72, 6, W) + [-24, -8, 8].map((y) => Rc(-16, y, 10, 10, 2, SK) + Rc(6, y, 10, 10, 2, SK)).join('') + Rc(-8, 24, 16, 12, 2, Y),
  tag: P('M-34 -6 L-6 -34 H30 V2 L2 30 Q-2 34 -6 30 Z', Y) + C(16, -16, 6, DK) + P('M-8 -2 L8 14', 'none', `stroke="${DK}" stroke-width="5" stroke-linecap="round"`),
  link: P('M-6 6 L6 -6', 'none', `stroke="${Y}" stroke-width="8" stroke-linecap="round"`) + P('M-14 4 L-24 14 A12 12 0 0 0 -8 30 L2 20', 'none', `stroke="${W}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"`) + P('M14 -4 L24 -14 A12 12 0 0 0 8 -30 L-2 -20', 'none', `stroke="${W}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"`),
  offline: P('M-34 -6 A48 48 0 0 1 34 -6 M-22 8 A30 30 0 0 1 22 8 M-10 20 A12 12 0 0 1 10 20', 'none', `stroke="${W}" stroke-width="7" stroke-linecap="round"`) + C(0, 32, 5, Y) + L(-34, -34, 34, 36, R, 6),
  party: P('M-34 38 L-10 -14 L18 14 Z', Y) + P('M-34 38 L-22 12 L-6 30 Z', O) + C(14, -22, 5, R) + C(30, -4, 5, W) + C(2, -34, 5, G) + L(22, -30, 30, -22, W, 4) + L(30, 12, 38, 6, R, 4),
  mail: Rc(-38, -26, 76, 52, 8, W) + P('M-36 -22 L0 6 L36 -22', 'none', `stroke="${SK}" stroke-width="6" stroke-linejoin="round"`),
  gold: C(0, 0, 36, Y) + C(0, 0, 28, '#FFE766') + star(0, 2, 18, O),
  silver: C(0, 0, 36, '#D5DCE8') + C(0, 0, 28, '#F2F5FA') + star(0, 2, 18, '#8A97AD'),
  bronze: C(0, 0, 36, '#C98A3D') + C(0, 0, 28, '#E2A86A') + star(0, 2, 18, '#8A5A1E'),
  folder: P('M-38 -22 H-12 L-4 -12 H36 V30 H-38 Z', Y) + P('M-38 -8 H38 V30 H-38 Z', O),
  question: `<text x="0" y="24" text-anchor="middle" font-family="Arial" font-weight="900" font-size="80" fill="${W}">?</text>`,
  undo: P('M-30 -4 H14 A22 22 0 0 1 14 40 H-6', 'none', `stroke="${W}" stroke-width="9" stroke-linecap="round"`) + P('M-18 -22 L-34 -4 L-18 14', 'none', `stroke="${W}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"`),
  check: P('M-26 2 L-8 20 L28 -20', 'none', `stroke="${W}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"`),
  sms: P('M-34 -24 H34 A8 8 0 0 1 42 -16 V12 A8 8 0 0 1 34 20 H-6 L-24 36 V20 H-34 A8 8 0 0 1 -42 12 V-16 A8 8 0 0 1 -34 -24 Z', W) + C(-16, -2, 5, SK) + C(0, -2, 5, SK) + C(16, -2, 5, SK),
  copy: Rc(-14, -36, 48, 56, 8, 'none', `stroke="${W}" stroke-width="7"`) + Rc(-34, -18, 48, 56, 8, W) + L(-24, -4, 4, -4, SK, 5) + L(-24, 8, 4, 8, SK, 5) + L(-24, 20, -6, 20, SK, 5),
  share: C(-26, 0, 10, W) + C(24, -24, 10, W) + C(24, 24, 10, W) + L(-18, -4, 16, -20, W, 6) + L(-18, 4, 16, 20, W, 6),
  wallet: Rc(-38, -22, 76, 52, 10, '#C9D7F0') + Rc(-38, -12, 76, 42, 10, DK) + Rc(14, 0, 28, 18, 8, Y) + C(26, 9, 4, DK),
};
const TILES = {
  tab_jobs: ['#2BD07C', '#0E8A52', C(0, 0, 32, 'none', `stroke="${W}" stroke-width="9"`) + C(0, 0, 8, W) + L(0, 8, 0, 32, W, 9) + L(-8, -3, -32, -8, W, 9) + L(8, -3, 32, -8, W, 9) + `<circle cx="0" cy="0" r="40" fill="none" stroke="${Y}" stroke-width="0"/>`],
  tab_earn: ['#FFD83A', '#F5921E', `<ellipse cx="0" cy="20" rx="30" ry="11" fill="#C9650A"/><rect x="-30" y="4" width="60" height="16" fill="#C9650A"/><ellipse cx="0" cy="4" rx="30" ry="11" fill="#FFE766"/><rect x="-30" y="-12" width="60" height="16" fill="#C9650A"/><ellipse cx="0" cy="-12" rx="30" ry="11" fill="#FFF3A8"/><text x="0" y="-6" text-anchor="middle" font-family="Arial" font-weight="900" font-size="18" fill="#C9650A">R</text>`],
  tab_profile: ['#3C97F0', '#0A4B9C', Rc(-38, -26, 76, 54, 9, W) + C(-18, -6, 10, SK) + P('M-33 22 Q-33 6 -18 6 Q-3 6 -3 22 Z', SK) + L(8, -12, 31, -12, DK, 5) + L(8, 0, 31, 0, '#9AA8C2', 4) + L(8, 11, 25, 11, '#9AA8C2', 4)],
  tab_car: ['#FF6B5E', '#C0392B', P('M-34 6 L-26 -14 Q-24 -20 -16 -20 H16 Q24 -20 26 -14 L34 6 V22 H-34 Z', W) + Rc(-22, -14, 44, 14, 4, SK) + C(-20, 24, 9, DK) + C(20, 24, 9, DK) + C(-22, 8, 4, Y) + C(22, 8, 4, Y)],
};
const files = {}; let n = 0;
for (const [k, g] of Object.entries(GLYPHS)) files[k] = disc(g, ++n);
for (const [k, [a, b, g]] of Object.entries(TILES)) files[k] = tile(a, b, g, ++n);
// The WhatsApp logo: the official green mark with the white handset-in-bubble glyph (glyph outline from simple-icons, CC0). Used only to label the "share on WhatsApp" actions.
const WA = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';
files.whatsapp = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="192" height="192"><defs><linearGradient id="wa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5DF08A"/><stop offset="1" stop-color="#1FB855"/></linearGradient></defs><circle cx="64" cy="64" r="62" fill="#25D366"/><circle cx="64" cy="64" r="62" fill="url(#wa)" opacity=".35"/><g transform="translate(24 24) scale(3.33)"><path d="${WA}" fill="#FFFFFF"/></g></svg>`;
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await br.newPage({ viewport: { width: 192, height: 192 }, deviceScaleFactor: 1 });
for (const [k, svg] of Object.entries(files)) {
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: OUT + k + '.png', omitBackground: true, clip: { x: 0, y: 0, width: 192, height: 192 } });
  writeFileSync(OUT + '_svg_' + k + '.svg.tmp', svg);
}
await br.close();
import { readdirSync, unlinkSync } from 'node:fs'; for (const f of readdirSync(OUT)) if (f.endsWith('.svg.tmp')) unlinkSync(OUT + f);
console.log('icons written:', Object.keys(files).length);

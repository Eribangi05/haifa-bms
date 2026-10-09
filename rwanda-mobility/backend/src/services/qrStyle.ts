import QRCode from 'qrcode';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Branded QR code as vector SVG (prints sharp at any size): rounded dots, Rwanda-blue finder corners, the Abasare mark on a white plate in the middle.
 * Error correction level H (30%) so the logo never stops a phone scanning it; the logo plate hides under 8% of the modules.
 * Dark navy on white keeps the contrast scanners need. Verified by decoding it in a browser (docs/QR_PRINT.md).
 */
export const NAVY = '#0F3554', BLUE = '#0069A8', GOLD = '#FAD201', GREEN = '#20603D';
const MARK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'brand-mark.png');
const markUri = () => (existsSync(MARK) ? 'data:image/png;base64,' + readFileSync(MARK).toString('base64') : '');

export async function brandedQrSvg(text: string, opts: { logo?: boolean } = {}): Promise<string> {
  const logo = opts.logo !== false && !!markUri();
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size, Q = 3, S = n + Q * 2;                // quiet zone of 3 modules inside the white tile (the poster adds more white)
  const get = (r: number, c: number) => qr.modules.get(r, c) === 1;
  const inFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const plate = logo ? Math.max(5, Math.round(n * 0.24)) | 1 : 0;    // odd number of modules, centred
  const p0 = (n - plate) / 2;
  const inPlate = (r: number, c: number) => logo && r >= p0 - 0.5 && r < p0 + plate + 0.5 && c >= p0 - 0.5 && c < p0 + plate + 0.5;
  const x = (c: number) => c + Q, y = (r: number) => r + Q;
  let dots = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!get(r, c) || inFinder(r, c) || inPlate(r, c)) continue;
    dots += `<circle cx="${x(c) + 0.5}" cy="${y(r) + 0.5}" r="0.47"/>`;
  }
  const finder = (r0: number, c0: number) => {
    const X = x(c0), Y = y(r0);
    return `<path fill="${BLUE}" fill-rule="evenodd" d="M${X + 1.6} ${Y}h3.8a1.6 1.6 0 0 1 1.6 1.6v3.8a1.6 1.6 0 0 1-1.6 1.6h-3.8a1.6 1.6 0 0 1-1.6-1.6v-3.8a1.6 1.6 0 0 1 1.6-1.6zM${X + 2.4} ${Y + 1}a1.4 1.4 0 0 0-1.4 1.4v2.2a1.4 1.4 0 0 0 1.4 1.4h2.2a1.4 1.4 0 0 0 1.4-1.4v-2.2a1.4 1.4 0 0 0-1.4-1.4z"/><rect x="${X + 2}" y="${Y + 2}" width="3" height="3" rx="0.9" fill="${NAVY}"/>`;
  };
  let center = '';
  if (logo) {
    const px = x(p0), py = y(p0), w = plate, ar = 278 / 335, lw = w - 1.2, lh = lw * ar;
    center = `<rect x="${px}" y="${py}" width="${w}" height="${w}" rx="1.4" fill="#fff" stroke="${BLUE}" stroke-width="0.18"/><image href="${markUri()}" x="${px + 0.6}" y="${py + (w - lh) / 2}" width="${lw}" height="${lh}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S * 10}" height="${S * 10}" shape-rendering="geometricPrecision"><rect width="${S}" height="${S}" rx="2.2" fill="#fff"/><g fill="${NAVY}">${dots}</g>${finder(0, 0)}${finder(0, n - 7)}${finder(n - 7, 0)}${center}</svg>`;
}

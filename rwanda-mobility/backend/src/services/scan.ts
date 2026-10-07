import net from 'node:net';
import { config } from '../config.js';
import { AppError, badRequest } from '../errors.js';

/**
 * Upload scanning. `scanFile(buf, mime)` runs before any upload is stored and throws an AppError to reject it.
 * Default pipeline: strict structural validation (always) -> ClamAV INSTREAM when CLAMAV_HOST is set.
 * Replace or extend it with `setScanner(fn)` (e.g. a cloud AV API); the function must throw to reject.
 */
export type Scanner = (buf: Buffer, mime: string) => Promise<void>;

export const LIMITS = { maxBytes: 5 * 1024 * 1024, minDim: 16, maxDim: 12000, maxPixels: 100_000_000, minBytes: 100 };

export function sniffMime(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  if (buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const unsupported = (why: string) => badRequest('unsupported_file', `Rejected upload: ${why}`);
const unsafe = (why: string) => badRequest('file_unsafe', `Rejected upload: ${why}`);

// Script / executable markers that never belong in a photo or a scanned document (polyglot defence).
const SCRIPT_MARKERS = [/<\s*script/i, /<\?php/i, /<%@\s*page/i, /<%\s*(eval|request|response|Runtime)/i, /<\s*html/i, /<\s*svg/i, /<\s*iframe/i, /<\s*object/i, /javascript\s*:/i, /\bon(error|load)\s*=/i, /#!\/(bin|usr)\//];
// Active content in PDFs
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|XFA|SubmitForm|ImportData)\b/;

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function checkDims(w: number, h: number) {
  if (!(w >= LIMITS.minDim && h >= LIMITS.minDim)) throw unsupported('image too small');
  if (w > LIMITS.maxDim || h > LIMITS.maxDim || w * h > LIMITS.maxPixels) throw unsupported('image dimensions too large');
}

function checkJpeg(buf: Buffer) {
  let pos = 2, dims: [number, number] | null = null;
  while (pos < buf.length - 1 && !dims) {
    if (buf[pos] !== 0xff) throw unsupported('corrupt JPEG');
    while (buf[pos] === 0xff) pos++;
    const m = buf[pos++];
    if (m === 0xd9 || m === 0xda) break;                        // EOI / start of scan before any frame header
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) continue;      // markers without a length
    if (pos + 2 > buf.length) throw unsupported('corrupt JPEG');
    const len = buf.readUInt16BE(pos);
    if (len < 2 || pos + len > buf.length) throw unsupported('corrupt JPEG');
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (len < 8) throw unsupported('corrupt JPEG');
      dims = [buf.readUInt16BE(pos + 5), buf.readUInt16BE(pos + 3)];
    }
    pos += len;
  }
  if (!dims) throw unsupported('JPEG has no frame header');
  checkDims(dims[0], dims[1]);
  const eoi = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (eoi < 0) throw unsupported('truncated JPEG');
  if (buf.subarray(eoi + 2).some((x) => x !== 0)) throw unsafe('data after end of JPEG');
}

function checkPng(buf: Buffer) {
  let pos = 8, first = true, end = false;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.subarray(pos + 4, pos + 8).toString('latin1');
    if (len > buf.length || pos + 12 + len > buf.length) throw unsupported('corrupt PNG');
    if (!/^[A-Za-z]{4}$/.test(type)) throw unsupported('corrupt PNG');
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) throw unsupported('corrupt PNG (checksum)');
    if (first) {
      if (type !== 'IHDR' || len !== 13) throw unsupported('corrupt PNG');
      checkDims(buf.readUInt32BE(pos + 8), buf.readUInt32BE(pos + 12));
      first = false;
    }
    pos += 12 + len;
    if (type === 'IEND') { end = true; break; }
  }
  if (!end) throw unsupported('truncated PNG');
  if (pos !== buf.length) throw unsafe('data after end of PNG');
}

function checkPdf(buf: Buffer) {
  if (!/^%PDF-1\.[0-7]/.test(buf.subarray(0, 8).toString('latin1'))) throw unsupported('unsupported PDF version');
  const tail = buf.subarray(Math.max(0, buf.length - 1024)).toString('latin1');
  if (!tail.includes('%%EOF')) throw unsupported('truncated PDF');
  if (PDF_ACTIVE.test(buf.toString('latin1'))) throw unsafe('PDF contains active content');
}

/** Strict magic-byte + structure validation. Throws unless `buf` is a well-formed JPEG/PNG/PDF matching the declared mime. */
export async function strictScan(buf: Buffer, mime: string): Promise<void> {
  if (buf.length < LIMITS.minBytes) throw unsupported('file too small');
  if (buf.length > LIMITS.maxBytes) throw badRequest('file_too_large', 'Maximum file size is 5 MB');
  const sniffed = sniffMime(buf);
  if (!sniffed || sniffed !== mime) throw unsupported('content does not match the declared type');
  const text = buf.toString('latin1');
  for (const re of SCRIPT_MARKERS) if (re.test(text)) throw unsafe('embedded script marker');
  if (sniffed === 'image/jpeg') checkJpeg(buf);
  else if (sniffed === 'image/png') checkPng(buf);
  else checkPdf(buf);
}

/** Minimal ClamAV client (clamd INSTREAM over TCP). Resolves on a clean scan, rejects with file_unsafe on a detection. */
export function clamavScan(buf: Buffer, host = config.clamavHost, port = config.clamavPort, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let resp = '';
    const fail = (e: Error) => { sock.destroy(); reject(e); };
    sock.setTimeout(timeoutMs, () => fail(new AppError(503, 'scan_unavailable', 'Virus scanner timed out')));
    sock.on('error', () => fail(new AppError(503, 'scan_unavailable', 'Virus scanner unreachable')));
    sock.on('data', (d) => { resp += d.toString('latin1'); });
    sock.on('end', () => {
      const r = resp.replace(/\0/g, '').trim();
      if (/OK$/.test(r)) resolve();
      else if (/FOUND$/.test(r)) reject(unsafe('malware detected'));
      else reject(new AppError(503, 'scan_unavailable', `Virus scanner error: ${r.slice(0, 80)}`));
    });
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      for (let i = 0; i < buf.length; i += 65536) {
        const chunk = buf.subarray(i, i + 65536), len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length); sock.write(len); sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));                                  // zero-length chunk terminates the stream
    });
  });
}

const defaultScanner: Scanner = async (buf, mime) => {
  await strictScan(buf, mime);
  if (config.clamavHost) await clamavScan(buf);                     // fail closed: an unreachable scanner rejects the upload
};
let scanner: Scanner = defaultScanner;
export const setScanner = (s: Scanner): Scanner => { const p = scanner; scanner = s; return p; };
export const defaultScan = defaultScanner;
export const scanFile = (buf: Buffer, mime: string) => scanner(buf, mime);

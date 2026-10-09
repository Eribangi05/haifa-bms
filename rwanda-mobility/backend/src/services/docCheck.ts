/**
 * First look at an uploaded document photo, before a person reviews it. No image library: the size is read from the JPEG/PNG header and the "bytes per pixel"
 * of a JPEG tells blurry, dark or blank photos (they compress far more than a sharp photo of a page). Results are warnings for the uploader and the reviewer,
 * never a decision: only staff approve or reject a document. PDFs are not inspected.
 */
export type ImageFacts = { width: number; height: number; bytes: number; bytes_per_pixel: number };

export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

export const MIN_SHORT_SIDE_PX = 600;     // a phone photo of a licence or ID is at least this wide on its short side
export const MIN_JPEG_BPP = 0.06;         // below this, a JPEG of a full document is almost always blurry, too dark or nearly blank

export function inspectDocument(buf: Buffer, mime: string): { facts: ImageFacts | null; warnings: ('low_resolution' | 'looks_blurry_or_dark')[] } {
  if (mime === 'application/pdf') return { facts: null, warnings: [] };
  const sz = imageSize(buf); if (!sz || !sz.width || !sz.height) return { facts: null, warnings: [] };
  const bpp = buf.length / (sz.width * sz.height); const warnings: ('low_resolution' | 'looks_blurry_or_dark')[] = [];
  if (Math.min(sz.width, sz.height) < MIN_SHORT_SIDE_PX) warnings.push('low_resolution');
  else if (mime === 'image/jpeg' && bpp < MIN_JPEG_BPP) warnings.push('looks_blurry_or_dark');
  return { facts: { ...sz, bytes: buf.length, bytes_per_pixel: Math.round(bpp * 1000) / 1000 }, warnings };
}

/** Longest plausible validity of a licence or insurance paper: a typo such as 2208 or 2082 is caught here. */
export const MAX_EXPIRY_YEARS = 20;
export const expiryTooFar = (isoDate: string, now = new Date()) => new Date(isoDate).getTime() > now.getTime() + MAX_EXPIRY_YEARS * 365.25 * 864e5;

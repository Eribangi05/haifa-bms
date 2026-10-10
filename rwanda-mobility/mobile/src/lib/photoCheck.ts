/** Longest side and JPEG quality of a photo before it is uploaded: a phone camera photo (3 to 10 MB) becomes about 300 to 700 KB, so it goes through a slow mobile connection and under the server's 5 MB limit. */
export const UPLOAD_MAX_SIDE = 1600;
export const UPLOAD_JPEG_QUALITY = 0.72;
export const UPLOAD_TIMEOUT_MS = 90_000;           // slow networks and a free server that is waking up need far more than the 12 s of a normal call
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Side lengths after shrinking so the longest side is at most `max` (never enlarges), or null when the photo is already small enough. */
export function shrinkTo(width: number, height: number, max = UPLOAD_MAX_SIDE): { width: number; height: number } | null {
  const long = Math.max(width, height); if (!width || !height || long <= max) return null;
  const k = max / long; return { width: Math.round(width * k), height: Math.round(height * k) };
}
export type PhotoFacts = { type: string; width?: number; height?: number; size?: number };
/**
 * First check of a document photo BEFORE it is uploaded (same limits as the server's warnings, backend/src/services/docCheck.ts): a photo whose short side is
 * under 600 px, or a JPEG with almost no detail per pixel (blurry, dark or blank), is sent back to be retaken. Unknown sizes and PDFs pass. Pure: unit-tested.
 */
export function photoProblem(f: PhotoFacts): 'small' | 'blurry' | null {
  if (!f.type.startsWith('image/') || !f.width || !f.height) return null;
  if (Math.min(f.width, f.height) < 600) return 'small';
  if (f.type === 'image/jpeg' && f.size && f.size / (f.width * f.height) < 0.06) return 'blurry';
  return null;
}

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

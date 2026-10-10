import type { FastifyRequest } from 'fastify';
import { badRequest } from '../errors.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Route option for upload routes: a base64 JSON body of a 5 MB file is about 7 MB (the global limit is 1 MB). */
export const UPLOAD_BODY_LIMIT = 8 * 1024 * 1024;

export type Upload = { buf: Buffer; mime?: string; fields: Record<string, string> };

/**
 * Reads an uploaded file in either of two forms, so a phone whose multipart upload keeps failing can still send its photo:
 *  - multipart/form-data with one file part (the normal way), or
 *  - a JSON body { data_base64, mime?, ...other fields } (the fallback the app uses when the multipart request is cut off by the network).
 * Both give the same result and the same 5 MB limit.
 */
export async function readUpload(req: FastifyRequest): Promise<Upload> {
  if (req.isMultipart()) {
    const fields: Record<string, string> = {}; let buf: Buffer | null = null; let mime: string | undefined;
    for await (const p of req.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } })) {
      if (p.type === 'file') { mime = p.mimetype; buf = await p.toBuffer(); if ((p as any).file.truncated) throw badRequest('file_too_large', 'Maximum file size is 5 MB'); }
      else fields[p.fieldname] = String(p.value);
    }
    if (!buf) throw badRequest('file_required', 'Attach a photo or PDF');
    return { buf, mime, fields };
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const raw = typeof b.data_base64 === 'string' ? b.data_base64.replace(/^data:[^,]*,/, '') : '';
  if (!raw) throw badRequest('file_required', 'Attach a photo or PDF');
  if (raw.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8) throw badRequest('file_too_large', 'Maximum file size is 5 MB');
  const buf = Buffer.from(raw, 'base64'); if (!buf.length) throw badRequest('file_required', 'Attach a photo or PDF');
  if (buf.length > MAX_UPLOAD_BYTES) throw badRequest('file_too_large', 'Maximum file size is 5 MB');
  const fields: Record<string, string> = {}; for (const [k, v] of Object.entries(b)) if (k !== 'data_base64' && k !== 'mime' && (typeof v === 'string' || typeof v === 'number')) fields[k] = String(v);
  return { buf, mime: typeof b.mime === 'string' ? b.mime : undefined, fields };
}

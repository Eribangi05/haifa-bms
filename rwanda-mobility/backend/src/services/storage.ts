import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { badRequest, notFound } from '../errors.js';
import { scanFile, sniffMime } from './scan.js';

/** Private local-disk storage. Production should swap this for an S3-compatible private bucket with the same interface. */
const root = () => resolve(config.storageDir);

export { sniffMime } from './scan.js';

/** Validates and stores an upload. `declaredMime` (the client's Content-Type, when known) must match the real content. */
export async function saveFile(buf: Buffer, folder: 'docs' | 'evidence' | 'photos', declaredMime?: string): Promise<{ key: string; mime: string; size: number }> {
  const mime = sniffMime(buf);
  if (!mime) throw badRequest('unsupported_file', 'Only JPEG, PNG or PDF files are accepted');
  if (buf.length > 5 * 1024 * 1024) throw badRequest('file_too_large', 'Maximum file size is 5 MB');
  if (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== mime && !(declaredMime === 'image/jpg' && mime === 'image/jpeg'))
    throw badRequest('unsupported_file', 'File content does not match its declared type');
  await scanFile(buf, mime);                                  // pluggable: strict validation + optional ClamAV; throws to reject
  const key = `${folder}/${randomUUID()}.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`;
  await mkdir(join(root(), folder), { recursive: true });
  await writeFile(join(root(), key), buf, { mode: 0o600 });
  return { key, mime, size: buf.length };
}

export async function readFileByKey(key: string): Promise<Buffer> {
  if (!/^(docs|evidence|photos)\/[0-9a-f-]{36}\.(jpg|png|pdf)$/.test(key)) throw badRequest('bad_key');   // blocks path traversal
  try { return await readFile(join(root(), key)); }
  catch (e: any) { if (e.code === 'ENOENT') throw notFound('file'); throw e; }       // a purged or never-written file is a 404, not a 500
}

export async function deleteFileByKey(key: string): Promise<void> {
  if (!/^(docs|evidence|photos)\/[0-9a-f-]{36}\.(jpg|png|pdf)$/.test(key)) return;
  await rm(join(root(), key), { force: true });
}

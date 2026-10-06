import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { badRequest } from '../errors.js';

/** Private local-disk storage. Production should swap this for an S3-compatible private bucket with the same interface. */
const root = () => resolve(config.storageDir);

export function sniffMime(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 5 && buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

export async function saveFile(buf: Buffer, folder: 'docs' | 'evidence' | 'photos'): Promise<{ key: string; mime: string; size: number }> {
  const mime = sniffMime(buf);
  if (!mime) throw badRequest('unsupported_file', 'Only JPEG, PNG or PDF files are accepted');
  if (buf.length > 5 * 1024 * 1024) throw badRequest('file_too_large', 'Maximum file size is 5 MB');
  const key = `${folder}/${randomUUID()}.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`;
  await mkdir(join(root(), folder), { recursive: true });
  // TODO(production): run a malware scan hook here before accepting the file.
  await writeFile(join(root(), key), buf, { mode: 0o600 });
  return { key, mime, size: buf.length };
}

export async function readFileByKey(key: string): Promise<Buffer> {
  if (!/^(docs|evidence|photos)\/[0-9a-f-]{36}\.(jpg|png|pdf)$/.test(key)) throw badRequest('bad_key');   // blocks path traversal
  return readFile(join(root(), key));
}

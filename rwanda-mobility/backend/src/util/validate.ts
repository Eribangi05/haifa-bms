import { z, type ZodTypeAny } from 'zod';
import { badRequest } from '../errors.js';

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw badRequest('validation_error', 'Invalid input', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}
export const uuid = z.string().uuid();
export const lat = z.number().min(-90).max(90);
export const lng = z.number().min(-180).max(180);

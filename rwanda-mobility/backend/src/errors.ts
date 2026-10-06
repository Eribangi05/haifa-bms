export class AppError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}
export const badRequest = (code: string, msg?: string, d?: unknown) => new AppError(400, code, msg, d);
export const unauthorized = (msg = 'unauthorized') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'forbidden') => new AppError(403, 'forbidden', msg);
export const notFound = (what = 'resource') => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, msg?: string, d?: unknown) => new AppError(409, code, msg, d);
export const tooMany = (msg = 'too many requests') => new AppError(429, 'rate_limited', msg);

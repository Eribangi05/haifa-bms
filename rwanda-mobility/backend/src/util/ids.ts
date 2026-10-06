import { randomBytes } from 'node:crypto';
export const refOf = (p: string) => p + '-' + randomBytes(4).toString('hex').toUpperCase();

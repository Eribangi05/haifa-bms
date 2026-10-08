// Turns any thrown value into a message in the user's language. Platform-free.
import type { TKey } from './i18n';
import type { ApiError } from './net';
const isApiError = (e: unknown): e is ApiError => e instanceof Error && typeof (e as ApiError).status === 'number' && typeof (e as ApiError).code === 'string';

/** Network/timeout/session/server problems use our own localised copy; other API errors carry the backend's message, which it already localises from accept-language. */
export function errorText(t: (k: TKey) => string, e: unknown): string {
  if (isApiError(e)) {
    if (e.isTimeout) return t('err.timeout');
    if (e.isNetwork) return t('err.network');
    if (e.status === 401) return t('err.session');
    if (e.status >= 500) return t('err.server');
    if (e.message && !/^Request failed \(\d+\)$/.test(e.message)) return e.message;
  }
  return t('common.error');
}

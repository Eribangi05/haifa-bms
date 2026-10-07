// Push notifications (Expo push service). Native only: every entry point is a no-op on web, and any failure
// (simulator, no permission, no EAS project id, no FCM config) just logs a warning and returns null.
import { Platform } from 'react-native';
import type { Client } from './net';
import { kv } from './storage';
import { translate, type Lang } from './i18n';
import { showAlert } from '../ui/dialog';

const supported = Platform.OS === 'android' || Platform.OS === 'ios';
const TOKEN_KEY = 'rm_push_token';
export type PushTarget = { name: string; params?: any };

/** Foreground notifications show as a banner (the OS shows them itself when the app is closed). Call once at startup. */
export function initNotifications() {
  if (!supported) return;
  try {
    const N = require('expo-notifications');
    N.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
  } catch (e) { console.warn('[push] notifications unavailable', (e as Error)?.message); }
}

const askRationale = (lang: Lang) => new Promise<boolean>((resolve) => {
  showAlert(translate(lang, 'push.title'), translate(lang, 'push.body'), [
    { text: translate(lang, 'push.later'), style: 'cancel', onPress: () => resolve(false) },
    { text: translate(lang, 'push.allow'), onPress: () => resolve(true) },
  ]);
});

/** Ask (once, with a localized rationale), fetch the Expo token and register it. Returns the token or null. Never throws. */
export async function registerPush(client: Client, lang: Lang, isDriver: boolean): Promise<string | null> {
  if (!supported) return null;
  try {
    const N = require('expo-notifications'); const Device = require('expo-device'); const Constants = require('expo-constants').default;
    if (!Device.isDevice) { console.warn('[push] skipped: not a physical device'); return null; }
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', { name: translate(lang, 'push.channel.default'), importance: N.AndroidImportance.HIGH });
      if (isDriver) await N.setNotificationChannelAsync('offers', { name: translate(lang, 'push.channel.offers'), importance: N.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250], sound: 'default' });
    }
    let perm = await N.getPermissionsAsync();
    if (perm.status !== 'granted') {
      if (!perm.canAskAgain || (await kv.get('rm_push_asked')) === '1') return null;
      await kv.set('rm_push_asked', '1');
      if (!(await askRationale(lang))) return null;
      perm = await N.requestPermissionsAsync();
      if (perm.status !== 'granted') return null;
    }
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) { console.warn('[push] skipped: no EAS projectId in app config (set EAS_PROJECT_ID)'); return null; }
    const token: string = (await N.getExpoPushTokenAsync({ projectId })).data;
    await client.post('/users/me/push-token', { token, platform: Platform.OS }, { retry: false });
    await kv.set(TOKEN_KEY, token);
    return token;
  } catch (e) { console.warn('[push] registration failed', (e as Error)?.message); return null; }
}

/** Remove this device's token from the server. Call BEFORE the session tokens are cleared. */
export async function unregisterPush(client: Client): Promise<void> {
  if (!supported) return;
  try { if (await kv.get(TOKEN_KEY)) { await client.del('/users/me/push-token'); await kv.del(TOKEN_KEY); } } catch { /* best effort */ }
}

/** Where a notification tap should go. Data: { booking_id?, audience?: 'driver'|'passenger', type? }. */
export function routeFor(data: any, isDriver: boolean): PushTarget | null {
  if (!data || typeof data !== 'object') return null;
  const id = typeof data.booking_id === 'string' ? data.booking_id : null;
  const driverMsg = data.audience === 'driver' || data.type === 'offer' || data.type === 'driver_offer';
  if (driverMsg && isDriver) return { name: 'driverHome' };
  if (id) return { name: 'track', params: { id } };
  return isDriver ? { name: 'driverHome' } : null;
}

/** Subscribe to notification taps (including the one that cold-started the app). Returns an unsubscribe function. */
export function listenForTaps(onTarget: (data: any) => void): () => void {
  if (!supported) return () => {};
  try {
    const N = require('expo-notifications');
    const last = N.getLastNotificationResponse?.(); if (last) onTarget(last.notification.request.content.data);
    const sub = N.addNotificationResponseReceivedListener((r: any) => onTarget(r.notification.request.content.data));
    return () => sub.remove();
  } catch { return () => {}; }
}

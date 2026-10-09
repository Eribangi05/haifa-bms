// Driver location while the app is backgrounded: an Android foreground service (type "location"), or on iOS the "location" background mode with the
// blue status-bar indicator, both run through expo-task-manager.
// Started only while a DRIVER is online or on a trip, always with a visible notification, and it needs no ACCESS_BACKGROUND_LOCATION
// because it is started while the app is on screen. iOS asks for "Always" access; if the driver declines, only the in-app foreground watch runs. Inert on web.
// Native modules are loaded lazily with require() so the web bundle never executes them.
import { Platform } from 'react-native';
import { API_URL } from '../config';
import { ApiError, createClient, type Client } from './net';
import { getDeviceId, kv, tokenStore } from './storage';
import { isLang, translate, type Lang } from './i18n';

export const BG_TASK = 'abasare-driver-location';
const FLAG = 'rm_bg_loc_on';
const MIN_GAP_MS = 5000;
export const bgSupported = Platform.OS === 'android' || Platform.OS === 'ios';

let shared: Client | null = null;
let own: Client | null = null;
let lastPost = 0;
/** The app registers its live client so the task shares token refresh with the UI. */
export const setBgClient = (c: Client) => { shared = c; };

async function getClient(): Promise<Client> {
  if (shared) return shared;
  if (own) return own;
  const dev = await getDeviceId(); const l = await kv.get('rm_lang');
  const lang = isLang(l) ? l : 'rw';
  own = createClient({ baseUrl: API_URL, tokens: tokenStore, deviceId: dev, lang: () => lang });
  return own;
}

if (bgSupported) {
  try {
    const TM = require('expo-task-manager');
    TM.defineTask(BG_TASK, async ({ data, error }: { data?: { locations?: any[] }; error?: unknown }) => {
      if (error || !data?.locations?.length) return;
      // Orphaned task (app crashed after the driver went offline / signed out): shut itself down.
      if ((await kv.get(FLAG)) !== '1' || !(await tokenStore.get())) { void stopBgLocation(); return; }
      const l = data.locations[data.locations.length - 1];
      const now = Date.now(); if (now - lastPost < MIN_GAP_MS) return; lastPost = now;
      try {
        const c = await getClient();
        await c.post('/drivers/me/location', { lat: l.coords.latitude, lng: l.coords.longitude, mocked: (l as any).mocked === true ? true : undefined, accuracy: l.coords.accuracy ?? undefined, speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : undefined, recorded_at: new Date(l.timestamp).toISOString() }, { retry: false, timeoutMs: 8000 });
      } catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) void stopBgLocation(); /* network errors: next fix will retry */ }
    });
  } catch { /* task manager unavailable (e.g. Expo Go): foreground tracking only */ }
}

export type BgResult = 'started' | 'unsupported' | 'denied' | 'error';

export async function startBgLocation(lang: Lang): Promise<BgResult> {
  if (!bgSupported) return 'unsupported';
  try {
    const Loc = require('expo-location'); const TM = require('expo-task-manager');
    if (!(await TM.isAvailableAsync())) return 'unsupported';
    const p = await Loc.requestForegroundPermissionsAsync(); if (p.status !== 'granted') return 'denied';
    if (Platform.OS === 'ios') { const b = await Loc.requestBackgroundPermissionsAsync(); if (b.status !== 'granted') return 'denied'; }   // iOS needs "Always" for updates with the screen locked
    await kv.set(FLAG, '1');
    if (await Loc.hasStartedLocationUpdatesAsync(BG_TASK)) return 'started';
    await Loc.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Loc.Accuracy.High, timeInterval: MIN_GAP_MS, distanceInterval: 15, pausesUpdatesAutomatically: false,
      ...(Platform.OS === 'ios' ? { showsBackgroundLocationIndicator: true, activityType: Loc.ActivityType?.AutomotiveNavigation } : {}),
      foregroundService: { notificationTitle: translate(lang, 'drv.bg.notif.title'), notificationBody: translate(lang, 'drv.bg.notif.body'), notificationColor: '#0077B0', killServiceOnDestroy: true },
    });
    return 'started';
  } catch (e) { console.warn('[bgLocation] could not start', (e as Error)?.message); await kv.del(FLAG).catch(() => {}); return 'error'; }
}

export async function stopBgLocation(): Promise<void> {
  if (!bgSupported) return;
  try {
    await kv.del(FLAG);
    const Loc = require('expo-location');
    if (await Loc.hasStartedLocationUpdatesAsync(BG_TASK)) await Loc.stopLocationUpdatesAsync(BG_TASK);
  } catch { /* already stopped */ }
}

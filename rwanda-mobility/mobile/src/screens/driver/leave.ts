import type { Client } from '../../lib/net';
import type { Booking } from '../../lib/types';
import type { TKey } from '../../lib/i18n';
import { showAlert } from '../../ui/dialog';

/**
 * Leave driver mode safely from any screen: never during a trip, and an online driver is taken offline first so no offer arrives while riding as a passenger.
 * Resolves after the mode switch (or immediately when the user declines).
 */
export async function leaveDriverMode(o: { client: Client; setMode: (m: 'passenger' | 'driver') => void; say: (m: string) => void; t: (k: TKey, v?: Record<string, string | number>) => string }): Promise<void> {
  const { client, setMode, t } = o;
  let trip: Booking | null = null; let online = false;
  try { trip = (await client.get<{ booking: Booking | null }>('/bookings/active?role=driver')).booking; } catch { /* offline: fall through to the confirmation below */ }
  try { online = !!(await client.get<{ profile: { is_online?: boolean } }>('/drivers/me/status')).profile.is_online; } catch { online = false; }
  if (trip && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS'].includes(trip.status)) { showAlert(t('drv.leave.title'), t('drv.leave.trip'), [{ text: t('common.close'), style: 'cancel' }]); return; }
  if (!online) { setMode('passenger'); return; }
  showAlert(t('drv.leave.title'), t('drv.leave.body'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), onPress: () => { void (async () => { try { await client.patch('/drivers/me/availability', { online: false }); } catch { /* the server also drops stale drivers */ } setMode('passenger'); })(); } }]);
}

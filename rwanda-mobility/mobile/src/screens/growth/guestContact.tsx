import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { isLive } from '../../lib/trip';
import type { Booking } from '../../lib/types';
import { Btn, Text } from '../../ui/components';
import { C, S, SP } from '../../ui/theme';

/** Driver view of a ride booked for someone else: the guest's first name and a Contact button that asks the server for the number (logged; refused after the trip). */
export function GuestContact({ trip }: { trip: Booking }) {
  const { t, client, errMsg, say } = useApp(); const { busy, run } = useAsync(); const [phone, setPhone] = useState<string | null>(null);
  const can = !!trip.guest?.can_contact && isLive(trip.status);
  const reveal = () => run(async () => { try { const r = await client.post<{ phone: string }>(`/bookings/${trip.id}/guest-contact`, {}); setPhone(r.phone); } catch (e) { say(errMsg(e)); } });
  return (
    <View style={{ backgroundColor: C.skyBg, borderRadius: 10, padding: SP.sm + 2, marginVertical: SP.xs }}>
      <Text testID="r2-guest-driver" style={S.bold}>{t('r2.guest.driverfor', { name: trip.guest?.first_name ?? '' })}</Text>
      {phone ? <><Text selectable style={[S.h2, { color: C.primary }]}>{phone}</Text><Text style={S.muted}>{t('r2.guest.contact.note')}</Text>
        <View style={{ height: SP.xs }} /><Btn kind="ghost" title={`${t('r2.guest.contact')}: ${phone}`} onPress={() => void Linking.openURL(`tel:${phone}`).catch(() => {})} /></>
        : can ? <Btn testID="r2-guest-contact" kind="ghost" title={t('r2.guest.contact')} onPress={reveal} loading={busy} /> : null}
    </View>
  );
}

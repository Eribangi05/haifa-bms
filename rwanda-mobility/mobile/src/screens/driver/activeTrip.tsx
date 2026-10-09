import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { label } from '../../lib/i18n';
import type { Booking } from '../../lib/types';
import { Banner, Btn, Card, Chip, Field, Money, Pill, Text } from '../../ui/components';
import { ChatModal } from '../chat';
import { NavigationModal } from './navigation';
import { useFlag } from '../../lib/flags';
import { MapBox } from '../../ui/MapView';
import { C, S } from '../../ui/theme';
import { HandoverForm } from './handover';
import { R1NavButtons } from '../trust/navHandoff';
import { GuestContact } from '../growth/guestContact';

type LL = { lat: number; lng: number };

/** The driver's current job: every step is one large button; state always comes back from the server (`reload` in `finally`). */
export function ActiveTrip({ trip, pos, reload, mapHeight }: { trip: Booking; pos: LL | null; reload: () => void; mapHeight: number }) {
  const { t, lang, client, say, nav, errMsg } = useApp(); const { busy, run } = useAsync(); const [pin, setPin] = useState(''); const [cash, setCash] = useState(String(Math.round(trip.final_fare ?? trip.estimated_fare ?? 0))); const [cancelling, setCancelling] = useState(false);
  const [chatOpen, setChatOpen] = useState(false); const [navOpen, setNavOpen] = useState(false); const navOn = useFlag('navigation.enabled'); const chatOn = useFlag('chat.enabled');
  const st = trip.status; const act = (path: string, body?: unknown) => run(async () => { try { await client.post(`/bookings/${trip.id}/${path}`, body ?? {}); } finally { reload(); } });
  useEffect(() => { if (trip.payment?.outstanding != null && trip.payment.method === 'cash') setCash(String(Math.round(trip.payment.outstanding))); }, [trip.payment?.outstanding, trip.payment?.method]);
  const ab = trip.abasare; const hs = ab?.handovers ?? []; const pickupH = hs.find((h) => h.phase === 'pickup'); const dropH = hs.find((h) => h.phase === 'dropoff');
  const hourly = ab?.mode === 'hourly';
  const [now, setNow] = useState(Date.now()); useEffect(() => { if (!hourly || st !== 'IN_PROGRESS') return; const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, [hourly, st]);
  const startedAt = (trip as Booking & { started_at?: string }).started_at;
  const elapsedMin = startedAt ? Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 60000)) : 0;
  const rideHome = () => run(async () => {
    const home = (await client.get('/users/me/places')).places.find((p: { label: string }) => p.label === 'home');
    if (!home) { say(t('ab.job.ridehome.need')); return; }
    const from = hourly ? trip.pickup : trip.destination;
    nav.push('options', { pickup: { lat: from.lat, lng: from.lng, name: from.name ?? '' }, dest: { lat: home.lat, lng: home.lng, name: home.name } });
  });
  const cancelWith = (reason: string) => run(async () => { try { await client.post(`/bookings/${trip.id}/cancel`, { reason, as: 'driver' }); } finally { setCancelling(false); reload(); } });
  const startTrip = () => run(async () => { try { await client.post(`/bookings/${trip.id}/start`, { pin }); setPin(''); } catch (e) { const ae = e as { code?: string; details?: { attempts_left?: number } }; if (ae.code === 'pin_invalid') say(`${errMsg(e)} (${ae.details?.attempts_left ?? ''})`); else throw e; } finally { reload(); } });
  const waitingOwner = ab && pickupH && !pickupH.owner_response;
  return (
    <Card style={{ borderColor: C.primary, borderWidth: 2 }}>
      <View style={S.between}><Text style={S.h2}>{trip.ref}</Text><Pill text={label(lang, 'bs', st)} tone="warn" /></View>
      <Text style={S.body}>{t('drv.passenger')}: {trip.passenger?.first_name}</Text>
      {trip.guest?.first_name ? <GuestContact trip={trip} /> : null}
      {['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS'].includes(st) ? <View style={[S.wrap, { marginVertical: 6 }]}>
        {chatOn ? <Chip action glyph="💬" testID="drv-chat" text={trip.unread_messages ? `${t('trip.chat')} · ${t('chat.unread', { n: trip.unread_messages })}` : t('trip.chat')} on={!!trip.unread_messages} onPress={() => setChatOpen(true)} /> : null}
        {navOn && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'].includes(st) && !(ab && hourly) ? <Chip action glyph="🧭" testID="drv-nav" text={t('nav.open')} onPress={() => setNavOpen(true)} /> : null}
      </View> : null}
      {trip.estimated_driver_net != null ? <Text style={S.muted}>{t('drv.earn')}: {trip.estimated_driver_net} RWF</Text> : null}
      {ab ? <View style={{ backgroundColor: C.warnBg, borderRadius: 10, padding: 10, marginVertical: 6 }}>
        <Text style={S.muted}>{t('ab.job.car')} · {hourly ? `${t('ab.trip.hourly')} ${ab.hours} ${t('ab.h')}` : t('ab.trip.home')}</Text>
        <Text style={{ fontSize: 22, fontWeight: '800', letterSpacing: 3 }}>{ab.vehicle.plate}</Text>
        <Text style={S.body}>{[ab.vehicle.color, ab.vehicle.make, ab.vehicle.model].filter(Boolean).join(' ')} · {t(('ab.cls.' + ab.vehicle.vehicle_class) as 'ab.cls.car')}, {ab.vehicle.transmission === 'manual' ? t('ab.car.manual') : t('ab.car.auto')}</Text>
        {hourly && st === 'IN_PROGRESS' ? <Text style={S.muted}>{t('ab.job.timer')}: {Math.floor(elapsedMin / 60)}h {elapsedMin % 60}m / {ab.hours}h</Text> : null}
      </View> : null}
      <Text style={[S.muted, { marginVertical: 4 }]}>{trip.pickup.name}{hourly ? '' : ` → ${trip.destination.name}`}{trip.pickup.note ? `\n${trip.pickup.note}` : ''}</Text>
      <MapBox center={pos ?? trip.pickup} markers={[{ ...trip.pickup, color: '#0077B0', label: 'P' }, { ...trip.destination, color: '#C0392B', label: 'D' }, ...(pos ? [{ ...pos, color: '#1A5FB4', label: '' }] : [])]} height={mapHeight} zoom={14} />
      <View style={{ height: 10 }} />
      {['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(st) ? <View style={{ gap: 8 }}>
        <R1NavButtons trip={trip as never} which="pickup" />
        {st === 'DRIVER_ASSIGNED' ? <Btn title={t('drv.enroute')} onPress={() => act('en-route')} loading={busy} big /> : null}
        <Btn title={t('drv.arrived')} onPress={() => act('arrived')} loading={busy} big />
        {cancelling ? <View style={{ gap: 6 }}><Text style={S.muted}>{t('drv.cancel.why')}</Text>
          <Btn kind="danger" title={t('drv.reason.safety')} onPress={() => cancelWith('safety_concern')} disabled={busy} /><Btn kind="danger" title={t('drv.reason.other')} onPress={() => cancelWith('other')} disabled={busy} /><Btn kind="ghost" title={t('common.no')} onPress={() => setCancelling(false)} /></View>
          : <Btn kind="ghost" title={t('drv.cancel')} onPress={() => setCancelling(true)} />}</View> : null}
      {['DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'].includes(st) && ab && !pickupH ? <HandoverForm trip={trip} phase="pickup" reload={reload} /> : null}
      {['DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'].includes(st) && (!ab || pickupH) ? <View style={{ gap: 8 }}>
        {ab && pickupH?.owner_response === 'issue' ? <Banner kind="bad" text={t('ab.job.disputed')} /> : waitingOwner ? <Banner text={t('ab.job.waitowner')} /> : null}
        <Field label={t('drv.enterpin')} value={pin} onChangeText={(x) => setPin(x.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} returnKeyType="done" onSubmitEditing={() => pin.length === 4 && void startTrip()} style={{ fontSize: 30, textAlign: 'center', letterSpacing: 10 }} />
        <Btn title={t('drv.start')} onPress={startTrip} loading={busy} disabled={pin.length !== 4} big />
        <Btn kind="ghost" title={t('drv.noshow')} onPress={() => act('no-show')} /></View> : null}
      {st === 'IN_PROGRESS' && ab && !dropH ? <HandoverForm trip={trip} phase="dropoff" reload={reload} /> : null}
      {st === 'IN_PROGRESS' && (!ab || dropH) ? <View style={{ gap: 8 }}>{hourly ? null : <R1NavButtons trip={trip as never} which="destination" />}<Btn title={t('drv.complete')} onPress={() => act('complete')} loading={busy} big /></View> : null}
      {['COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED'].includes(st) && ab ? <Btn kind="gold" title={t('ab.job.ridehome')} onPress={rideHome} loading={busy} /> : null}
      {['COMPLETED', 'PAYMENT_PENDING'].includes(st) ? <View style={{ gap: 8 }}>
        <Money n={trip.final_fare} style={{ fontSize: 30, fontWeight: '800', color: C.primary }} />
        {trip.payment_method === 'cash' ? <><Field label={t('drv.collected.q')} value={cash} onChangeText={(x) => setCash(x.replace(/\D/g, ''))} keyboardType="number-pad" />
          <Btn title={t('drv.collect')} onPress={() => run(async () => { const r = await client.post<{ status: string; outstanding?: number }>(`/bookings/${trip.id}/cash-collected`, { amount: Number(cash) }, { retry: true }); if (r.status === 'PARTIAL') say(`${t('drv.collected.partial')}: ${r.outstanding} RWF`); reload(); })} loading={busy} disabled={!Number(cash)} big /></>
          : <Banner text={t('drv.wait.pay')} />}</View> : null}
      <ChatModal id={trip.id} visible={chatOpen} onClose={() => { setChatOpen(false); reload(); }} role="driver" trip={trip} onChanged={reload} />
      <NavigationModal trip={trip} pos={pos} visible={navOpen} onClose={() => setNavOpen(false)} />
    </Card>
  );
}

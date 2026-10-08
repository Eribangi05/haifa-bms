import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { useTrip } from '../../lib/hooks';
import { distM, etaMinutes, fmtDateTime, routeProgress } from '../../lib/format';
import { CANCEL_FEE_STATES, STEP, isCancelled, isLive, isPaid, isPayable, isSearching, tripTitleKey } from '../../lib/trip';
import { POLL_MS } from '../../config';
import { Banner, Btn, Card, Chip, EmptyState, FadeIn, ProgressBar, Screen, Sheet, Skeleton, Spinner, Stepper, Text, useProportionalHeight } from '../../ui/components';
import { MapBox } from '../../ui/MapView';
import { showAlert } from '../../ui/dialog';
import { C, S, SP } from '../../ui/theme';
import { SosButton } from '../sos';
import { DepositCard, DepositNote } from '../r3/deposit';
import { ChatModal, Done, DriverCard, HandoverReview, PayCard } from './tripParts';
import { R1ShareSheet } from '../r1Share';
import { R1DriverEta, R1SafetyLayer } from '../r1Safety';

const STALE_LOC_MS = 120_000;

export function Track({ params }: { params: { id?: string; pending?: boolean; safety?: boolean } }) {
  const { t, client, nav, pendingOutbox, online, errMsg } = useApp();
  const [chat, setChat] = useState(false); const [shareOpen, setShareOpen] = useState(false); const { busy, run } = useAsync();
  const { booking: b, error, stale, reload, loaded } = useTrip(params.id, POLL_MS, [pendingOutbox]);
  const mapH = useProportionalHeight(0.32, 190, 340);
  const home = () => nav.reset('home');
  const searchStart = useRef(Date.now()); const [now, setNow] = useState(Date.now());
  const searching = !!b && isSearching(b.status);
  useEffect(() => { if (!searching) return; const i = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(i); }, [searching]);

  // An offline request is still in the outbox: tell the truth (not confirmed) until the server has it.
  if (!b && (params.pending || pendingOutbox > 0) && (pendingOutbox > 0 || !loaded)) return (
    <Screen title={t('trip.unconfirmed')} onBack={home} footer={<Btn kind="ghost" title={t('common.back')} onPress={home} />}>
      <Banner text={t('net.pending')} /><Spinner />
    </Screen>);
  // The queued request was rejected by the server (or never produced a booking).
  if (!b && params.pending && loaded && pendingOutbox === 0) return (
    <Screen title={t('trip.unconfirmed')} onBack={home} footer={<Btn testID="cta" title={t('trip.rebook')} onPress={home} />}>
      <EmptyState glyph="📡" title={t('trip.pending.failed.title')} body={t('trip.pending.failed')} />
    </Screen>);
  if (!b) return (
    <Screen title={t('trip.title.loading')} onBack={home}>
      {error ? <Banner kind="bad" text={errMsg(error)} action={<Btn kind="ghost" title={t('common.retry')} onPress={reload} />} /> : <Card><Skeleton height={20} width="60%" /><Skeleton height={14} width="40%" style={{ marginTop: 10 }} /><Skeleton height={120} style={{ marginTop: 14 }} /></Card>}
    </Screen>);

  const st = b.status; const live = isLive(st);
  const cancel = () => showAlert(t('trip.cancel.confirm'), (CANCEL_FEE_STATES as readonly string[]).includes(st) ? t('trip.cancel.fee') : '', [
    { text: t('common.no'), style: 'cancel' }, { text: t('common.yes'), style: 'destructive', onPress: () => run(async () => { await client.post(`/bookings/${b.id}/cancel`, { reason: 'changed_mind' }, { retry: true }); reload(); }) }]);
  const loc = b.driver_location; const fresh = loc && (!loc.at || Date.now() - new Date(loc.at).getTime() < STALE_LOC_MS);
  const mapMarkers = [{ lat: b.pickup.lat, lng: b.pickup.lng, label: t('home.pickup'), color: '#0077B0' }, { lat: b.destination.lat, lng: b.destination.lng, label: t('home.dest'), color: '#C0392B' }, ...(loc ? [{ lat: loc.lat, lng: loc.lng, label: t('trip.driver'), color: '#1A5FB4' }] : [])];
  const toPickup = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(st);
  const eta = fresh && loc ? (toPickup ? etaMinutes(distM(loc, b.pickup)) : st === 'IN_PROGRESS' ? etaMinutes(distM(loc, b.destination)) : null) : null;
  const progress = st === 'IN_PROGRESS' && loc ? routeProgress(b.pickup, b.destination, loc) : null;
  const waited = Math.round((now - searchStart.current) / 1000);

  return (
    <Screen title={t(tripTitleKey(st))} onBack={home} right={live ? <SosButton bookingId={b.id} /> : null} onRefresh={async () => { reload(); await new Promise((r) => setTimeout(r, 500)); }} contentStyle={{ paddingHorizontal: 0, paddingTop: 0 }}>
      {!online ? <View style={{ padding: SP.lg, paddingBottom: 0 }}><Banner kind="bad" text={t('net.offline')} /></View> : null}
      {stale ? <View style={{ padding: SP.lg, paddingBottom: 0 }}><Banner text={t('trip.stale')} /></View> : null}
      {st === 'IN_PROGRESS' ? <View style={{ padding: SP.lg, paddingBottom: 0 }}><R1SafetyLayer id={b.id} active openHint={!!params.safety} /></View> : null}
      {live || isSearching(st) ? <View style={{ paddingHorizontal: SP.lg, paddingTop: SP.md }}><MapBox center={loc ?? b.pickup} markers={mapMarkers} height={mapH} zoom={14} /></View> : null}
      <Sheet style={live || isSearching(st) ? { marginTop: -SP.xl } : { marginTop: SP.sm }}>
        {STEP[st] != null ? <Stepper at={STEP[st]} /> : null}

        {(b as { driver_eta_s?: number | null }).driver_eta_s != null ? <R1DriverEta etaS={(b as { driver_eta_s?: number | null }).driver_eta_s} target={(b as { driver_eta_target?: string }).driver_eta_target} stamp={b} /> : null}
        {eta != null && (b as { driver_eta_s?: number | null }).driver_eta_s == null ? <FadeIn><View style={{ marginBottom: SP.md }}>
          <Text accessibilityLiveRegion="polite" style={[S.h2, { color: C.primary }]}>{toPickup ? t('trip.eta.pickup', { n: eta }) : t('trip.eta.dest', { n: eta })}</Text>
          {progress != null ? <View style={{ marginTop: SP.sm }}><ProgressBar value={progress} a11y={t('trip.progress')} label={t('trip.progress')} /></View> : null}
          <Text style={[S.muted, { marginTop: 4 }]}>{t('trip.eta.note')}</Text>
        </View></FadeIn> : null}

        {isSearching(st) && !b.awaiting_deposit ? <View style={{ alignItems: 'center' }}><Spinner /><Text style={[S.body, { textAlign: 'center' }]}>{t('trip.searching.sub')}</Text>{waited > 90 ? <Text style={[S.muted, { textAlign: 'center', marginTop: 6 }]}>{t('trip.searching.slow')}</Text> : null}<View style={{ height: 10, alignSelf: 'stretch' }} /><View style={{ alignSelf: 'stretch' }}><Btn kind="ghost" title={t('trip.cancel')} onPress={cancel} loading={busy} /></View></View> : null}

        {st === 'SCHEDULED' ? <View><Text style={S.body}>{b.scheduled_for ? fmtDateTime(b.scheduled_for) : ''}</Text><View style={{ height: 8 }} /><Btn kind="ghost" title={t('trip.cancel')} onPress={cancel} loading={busy} /></View> : null}
        {st === 'NO_DRIVER_FOUND' ? <View><Text style={S.body}>{t('opt.alt')}</Text><View style={{ height: 8 }} /><Btn title={t('trip.alt.other')} onPress={home} /><View style={{ height: 8 }} /><Btn kind="ghost" title={t('trip.alt.later')} onPress={home} /></View> : null}

        {b.guest?.name && !b.guest.purged ? <View testID="r2-guest-note" style={{ marginBottom: SP.md }}><Banner kind="ok" text={`${t('r2.guest.for', { name: b.guest.name })}. ${t('r2.guest.sms', { name: b.guest.name, phone: b.guest.phone_masked ?? '' })}`} /></View> : null}
        {live && b.driver ? <DriverCard b={b} /> : null}
        {b.trip_pin ? <View style={{ backgroundColor: C.okBg, borderRadius: 14, padding: SP.md, marginTop: SP.md, borderWidth: 1, borderColor: C.primary }}><Text style={S.muted}>{t('trip.pin')}</Text><Text style={{ fontSize: 44, fontWeight: '800', letterSpacing: 10, color: C.primaryDark }}>{b.trip_pin}</Text><Text style={S.muted}>{t('trip.pin.hint')}</Text></View> : null}
        {live ? <View style={[S.wrap, { marginTop: SP.md }]}>
          <Chip glyph="💬" text={t('trip.chat')} onPress={() => setChat(true)} /><Chip glyph="🔗" text={t('trip.share')} onPress={() => setShareOpen(true)} />
          {st !== 'IN_PROGRESS' ? <Chip glyph="✕" text={t('trip.cancel')} onPress={cancel} /> : null}
        </View> : null}
      </Sheet>

      <View style={{ padding: SP.lg }}>
        {b.awaiting_deposit ? <DepositCard b={b} reload={reload} /> : null}
        {b.deposit && !b.awaiting_deposit ? <DepositNote d={b.deposit} /> : null}
        {b.abasare && (live || isPayable(st) || st === 'PAYMENT_COMPLETED') ? <HandoverReview b={b} reload={reload} /> : null}
        {isPayable(st) ? <PayCard b={b} reload={reload} /> : null}
        {isPaid(st) ? <Done b={b} /> : null}
        {isCancelled(st) ? <Card><Text style={S.body}>{b.cancel_fee ? `${t('trip.cancel.fee')} (${b.cancel_fee} RWF)` : t('trip.cancelled')}</Text><View style={{ height: 8 }} /><Btn title={t('trip.rebook')} onPress={home} /></Card> : null}
      </View>
      <ChatModal id={b.id} visible={chat} onClose={() => setChat(false)} />
      <R1ShareSheet id={b.id} visible={shareOpen} onClose={() => setShareOpen(false)} />
    </Screen>
  );
}

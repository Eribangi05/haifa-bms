import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useApp, useAsync, usePoll } from '../lib/app';
import { ApiError } from '../lib/net';
import { kv } from '../lib/storage';
import { Banner, Btn, Card, Chip, Empty, Field, Header, Money, Pill, Screen, Spinner } from '../ui/components';
import { MapBox } from '../ui/MapView';
import { C, S } from '../ui/theme';
import { SosButton } from './shared';

const DOC_LABEL: Record<string, string> = { national_id: 'National ID', driving_licence: 'Driving licence', profile_photo: 'Profile photo', vehicle_registration: 'Vehicle registration', insurance: 'Insurance', inspection: 'Inspection / roadworthiness', transport_permit: 'Transport permit' };
const VTYPES = ['moto', 'car', 'minivan'] as const;

export function DriverHome() {
  const { t, client, me, setMode, nav } = useApp();
  const st = usePoll(() => client.get('/drivers/me/status'), 10000);
  if (!st.data) return <Screen>{st.error ? <><Banner kind="bad" text={st.error.message} /><Btn title={t('common.retry')} onPress={st.reload} /><View style={{ height: 8 }} /><Btn kind="ghost" title={t('common.back')} onPress={() => setMode('passenger')} /></> : <Spinner />}</Screen>;
  const d = st.data;
  const approved = d.profile.status === 'APPROVED';
  if (!approved) return <Onboarding status={d} reload={st.reload} />;
  return <Working status={d} reload={st.reload} />;
}

// ---------------------------------------------------------------- onboarding
function Onboarding({ status, reload }: { status: any; reload: () => void }) {
  const { t, client, setMode, say } = useApp(); const { busy, run } = useAsync();
  const p = status.profile, v = status.vehicle;
  const [f, setF] = useState({ legal_name: p.legal_name ?? '', national_id: '', vehicle_type: (v?.vehicle_type ?? 'moto') as string, make: v?.make ?? '', model: v?.model ?? '', color: v?.color ?? '', plate: v?.plate ?? '', capacity: String(v?.capacity ?? 1), comfort: false, payout: p.payout_msisdn ?? '' });
  const editable = ['APPLICATION_STARTED', 'INFO_REQUIRED', 'REJECTED'].includes(p.status);
  const set = (k: string, val: any) => setF((x) => ({ ...x, [k]: val }));
  const saveApp = () => run(async () => {
    await client.post('/drivers/applications', { legal_name: f.legal_name, national_id: f.national_id || '00000000', payout_msisdn: f.payout || undefined, vehicle: { vehicle_type: f.vehicle_type, make: f.make, model: f.model, color: f.color, plate: f.plate, capacity: Number(f.capacity) || 1, comfort: f.comfort } });
    say(t('common.save')); reload();
  });
  const submit = () => run(async () => { await saveApp(); await client.post('/drivers/applications/submit'); reload(); });
  const need = (status.requirements ?? []).filter((r: any) => r.mandatory || true);
  return (
    <View style={S.screen}><Header title={t('drv.app.title')} onBack={() => setMode('passenger')} />
      <Screen>
        <Card><Text style={S.muted}>{t('drv.status')}</Text><Pill tone={p.status === 'REJECTED' || p.status === 'SUSPENDED' ? 'bad' : p.status === 'APPROVED' ? 'ok' : 'warn'} text={t(('drv.st.' + p.status) as any)} />{p.status_reason ? <Text style={[S.body, { marginTop: 6 }]}>{p.status_reason}</Text> : null}</Card>
        {status.fleet_invites?.length ? <Card><Text style={S.h2}>Fleet invitation</Text>{status.fleet_invites.map((i: any) => <View key={i.id} style={[S.between, { marginTop: 6 }]}><Text style={S.body}>{i.name}</Text><Btn title={t('common.yes')} onPress={() => run(async () => { await client.post('/drivers/me/fleet/accept', { invite_id: i.id }); reload(); })} /></View>)}</Card> : null}
        {editable ? <Card>
          <Field label={t('drv.legalname')} value={f.legal_name} onChangeText={(x) => set('legal_name', x)} /><Field label={t('drv.nid')} value={f.national_id} onChangeText={(x) => set('national_id', x)} keyboardType="number-pad" maxLength={20} placeholder="1 1999 8 0012345 6 78" />
          <Text style={S.muted}>{t('drv.vtype')}</Text><View style={{ flexDirection: 'row', marginVertical: 6 }}>{VTYPES.map((x) => <Chip key={x} text={x} on={f.vehicle_type === x} onPress={() => { set('vehicle_type', x); set('capacity', x === 'moto' ? '1' : x === 'car' ? '4' : '7'); }} />)}</View>
          <Field label={t('drv.make')} value={f.make} onChangeText={(x) => set('make', x)} /><Field label={t('drv.model')} value={f.model} onChangeText={(x) => set('model', x)} /><Field label={t('drv.color')} value={f.color} onChangeText={(x) => set('color', x)} />
          <Field label={t('drv.plate')} value={f.plate} onChangeText={(x) => set('plate', x.toUpperCase())} autoCapitalize="characters" maxLength={12} /><Field label={t('drv.seats')} value={f.capacity} onChangeText={(x) => set('capacity', x.replace(/\D/g, ''))} keyboardType="number-pad" />
          {f.vehicle_type === 'car' ? <Chip text={t('drv.comfort')} on={f.comfort} onPress={() => set('comfort', !f.comfort)} /> : null}
          <Field label={t('drv.payout')} value={f.payout} onChangeText={(x) => set('payout', x)} keyboardType="phone-pad" />
          <Btn kind="ghost" title={t('common.save')} onPress={saveApp} loading={busy} disabled={!f.legal_name || !f.make || !f.plate || f.national_id.length < 8} />
        </Card> : null}
        {v ? <Card><Text style={S.h2}>{t('drv.docs')}</Text>
          {need.map((r: any) => <DocRow key={r.doc_type} req={r} docs={status.documents.filter((d: any) => d.doc_type === r.doc_type)} editable reload={reload} />)}
        </Card> : <Banner text={t('drv.app.title')} />}
        {editable && v ? <Btn big title={t('drv.submit')} onPress={submit} loading={busy} /> : null}
      </Screen></View>
  );
}

function DocRow({ req, docs, reload, editable }: { req: any; docs: any[]; reload: () => void; editable?: boolean }) {
  const { t, client, say } = useApp(); const { busy, run } = useAsync(); const [open, setOpen] = useState(false); const [expiry, setExpiry] = useState('');
  const last = docs[0];
  const upload = (uri: string, name: string, type: string) => run(async () => {
    const fd = new FormData(); fd.append('doc_type', req.doc_type); if (expiry) fd.append('expiry_date', expiry);
    fd.append('file', { uri, name, type } as any);
    await client.post('/drivers/documents', undefined, { form: fd, timeoutMs: 40000 }); setOpen(false); say(t('drv.upload')); reload();
  });
  const camera = async () => { const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) return; const r = await ImagePicker.launchCameraAsync({ quality: 0.6 }); if (!r.canceled) await upload(r.assets[0].uri, 'photo.jpg', 'image/jpeg'); };
  const gallery = async () => { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 }); if (!r.canceled) await upload(r.assets[0].uri, 'photo.jpg', r.assets[0].mimeType ?? 'image/jpeg'); };
  const pdf = async () => { const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'] }); if (!r.canceled) await upload(r.assets[0].uri, r.assets[0].name, r.assets[0].mimeType ?? 'application/pdf'); };
  const tone = !last ? 'warn' : last.review_status === 'approved' ? 'ok' : last.review_status === 'pending' ? 'warn' : 'bad';
  return (
    <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={S.between}><View style={{ flex: 1 }}><Text style={[S.body, { fontWeight: '600' }]}>{DOC_LABEL[req.doc_type] ?? req.doc_type}{req.mandatory ? ' *' : ''}</Text>
        <Pill tone={tone as any} text={last ? last.review_status + (last.expiry_date ? ` · ${String(last.expiry_date).slice(0, 10)}` : '') : '—'} />{last?.review_note ? <Text style={{ color: C.danger, marginTop: 4 }}>{last.review_note}</Text> : null}</View>
        {editable ? <Btn kind="ghost" title={last ? t('drv.replace') : t('drv.upload')} onPress={() => setOpen(!open)} /> : null}</View>
      {open ? <View style={{ marginTop: 8 }}>
        {req.requires_expiry ? <Field label={t('drv.expiry')} value={expiry} onChangeText={setExpiry} placeholder="2028-12-31" maxLength={10} /> : null}
        <View style={{ gap: 8 }}><Btn title={t('drv.photo.take')} onPress={camera} loading={busy} disabled={req.requires_expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)} />
          <Btn kind="ghost" title={t('drv.photo.pick')} onPress={gallery} disabled={req.requires_expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)} /><Btn kind="ghost" title={t('drv.file.pick')} onPress={pdf} disabled={req.requires_expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)} /></View></View> : null}
    </View>
  );
}

// ---------------------------------------------------------------- working (online/offline, offers, trip)
function Working({ status, reload }: { status: any; reload: () => void }) {
  const { t, client, setMode, nav, online, say } = useApp(); const { busy, run } = useAsync();
  const [isOnline, setIsOnline] = useState<boolean>(!!status.profile.is_online); const [consent, setConsent] = useState(false); const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [tab, setTab] = useState<'work' | 'earn'>('work');
  const sub = useRef<Location.LocationSubscription | null>(null);
  useEffect(() => { setIsOnline(!!status.profile.is_online); }, [status.profile.is_online]);
  useEffect(() => { kv.get('rm_drv_loc_consent').then((v) => setConsent(v === '1')); }, []);

  // Foreground location while online: heartbeat + position. (Background tracking is not implemented; disclosed in docs.)
  useEffect(() => {
    if (!isOnline) { sub.current?.remove(); sub.current = null; return; }
    let cancelled = false;
    (async () => {
      const p = await Location.requestForegroundPermissionsAsync(); if (p.status !== 'granted' || cancelled) return;
      sub.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 15 }, (l) => {
        setPos({ lat: l.coords.latitude, lng: l.coords.longitude });
        client.post('/drivers/me/location', { lat: l.coords.latitude, lng: l.coords.longitude, accuracy: l.coords.accuracy ?? undefined, speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : undefined, recorded_at: new Date(l.timestamp).toISOString() }, { retry: false }).catch((e) => { if (e instanceof ApiError && e.status === 403) reload(); });
      });
    })();
    return () => { cancelled = true; sub.current?.remove(); sub.current = null; };
  }, [isOnline, client, reload]);

  const toggle = (on: boolean) => run(async () => {
    if (on && !consent) return;
    try { await client.patch('/drivers/me/availability', { online: on }); setIsOnline(on); reload(); }
    catch (e: any) { if (e?.code === 'not_permitted_to_work') { say(t('drv.notallowed')); reload(); } else throw e; }
  });
  const active = usePoll(() => client.get('/bookings/active?role=driver'), 3000, [isOnline]);
  const offers = usePoll(() => client.get('/drivers/me/offers'), 3000, [isOnline], isOnline && !active.data?.booking);
  const perm = status.permission; const trip = active.data?.booking;

  return (
    <View style={S.screen}>
      <Header title={t('drv.mode')} onBack={() => setMode('passenger')} right={trip ? <SosButton bookingId={trip.id} /> : <Pressable onPress={() => nav.push('support')}><Text style={{ color: C.primary, padding: 8, fontWeight: '700' }}>{t('home.help')}</Text></Pressable>} />
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
        <View style={[S.row, { marginBottom: 10 }]}><Chip text={t('drv.mode')} on={tab === 'work'} onPress={() => setTab('work')} /><Chip text={t('drv.earnings')} on={tab === 'earn'} onPress={() => setTab('earn')} /></View>
        {tab === 'earn' ? <Earnings /> : <>
          <Card>
            <View style={S.between}><View><Text style={S.h2}>{isOnline ? t('drv.online') : t('drv.offline')}</Text><Text style={S.muted}>★ {Number(status.profile.rating_avg).toFixed(1)} · {status.profile.completed_count} {t('drv.trips')}</Text></View>
              <Btn kind={isOnline ? 'danger' : 'primary'} title={isOnline ? t('drv.gooffline') : t('drv.goonline')} onPress={() => (isOnline ? toggle(false) : consent ? toggle(true) : setConsent(false))} loading={busy} disabled={!perm.can_work && !isOnline} /></View>
            {!perm.can_work ? <Banner kind="bad" text={`${t('drv.notallowed')}: ${perm.reasons.join(', ')}${perm.expired_documents.length ? ' · ' + perm.expired_documents.join(', ') : ''}${perm.missing_documents.length ? ' · ' + perm.missing_documents.join(', ') : ''}`} /> : null}
          </Card>
          {!consent && perm.can_work ? <Card><Text style={S.h2}>{t('drv.location.title')}</Text><Text style={[S.body, { marginVertical: 8 }]}>{t('drv.location.body')}</Text><Btn title={t('drv.agree')} onPress={async () => { await kv.set('rm_drv_loc_consent', '1'); try { await client.post('/users/me/consents', { kind: 'background_location', version: 'v1', granted: true }); } catch { /* ok */ } setConsent(true); }} /></Card> : null}
          {status.documents.filter((d: any) => d.expiry_date && new Date(d.expiry_date).getTime() - Date.now() < 30 * 86400000 && d.review_status === 'approved').map((d: any) => <Banner key={d.id} text={`${t('drv.docs.expiring')}: ${DOC_LABEL[d.doc_type] ?? d.doc_type} (${String(d.expiry_date).slice(0, 10)})`} />)}
          {trip ? <ActiveTrip trip={trip} pos={pos} reload={active.reload} /> : isOnline ? <>
            {pos ? <MapBox center={pos} markers={[{ ...pos, label: '', color: '#1A5FB4' }]} height={180} zoom={14} /> : null}
            <Text style={[S.h2, { marginVertical: 10 }]}>{t('drv.offers')}</Text>
            {offers.data?.offers?.length ? offers.data.offers.map((o: any) => <OfferCard key={o.booking_id} o={o} done={() => { offers.reload(); active.reload(); }} />) : <Empty text={t('drv.nooffers')} />}
          </> : null}
          <Text style={[S.muted, { textAlign: 'center', marginTop: 12 }]}>{t('drv.safety.stationary')}</Text>
        </>}
      </ScrollView>
    </View>
  );
}

function OfferCard({ o, done }: { o: any; done: () => void }) {
  const { t, client, say } = useApp(); const { busy, run } = useAsync(); const [left, setLeft] = useState(Math.max(0, Math.round((new Date(o.expires_at).getTime() - Date.now()) / 1000))); const [declining, setDeclining] = useState(false);
  useEffect(() => { const i = setInterval(() => setLeft(Math.max(0, Math.round((new Date(o.expires_at).getTime() - Date.now()) / 1000))), 1000); return () => clearInterval(i); }, [o.expires_at]);
  const accept = () => run(async () => { try { await client.post(`/bookings/${o.booking_id}/accept`); done(); } catch (e: any) { if (['offer_no_longer_available', 'offer_expired', 'offer_not_found'].includes(e?.code)) { say(e.message); done(); } else throw e; } });
  const reject = (reason: string) => run(async () => { await client.post(`/bookings/${o.booking_id}/reject`, { reason }); done(); });
  return (
    <Card style={{ borderColor: C.primary, borderWidth: 2 }}>
      <View style={S.between}><Text style={S.muted}>{t('drv.expires')} {left}s</Text><Pill text={o.payment_method === 'cash' ? 'CASH' : 'MoMo'} tone="warn" /></View>
      <Text style={[S.muted, { marginTop: 6 }]}>{t('drv.earn')}</Text><Money n={o.driver_net} style={{ fontSize: 34, fontWeight: '800', color: C.primary }} />
      <Text style={S.body}>{t('drv.pickupin')}: {(o.distance_m / 1000).toFixed(1)} km · {Math.max(1, Math.round(o.eta_s / 60))} {t('common.min')}</Text>
      <Text style={S.body}>{t('drv.trip')}: {(o.trip_distance_m / 1000).toFixed(1)} km · {Math.max(1, Math.round(o.trip_duration_s / 60))} {t('common.min')}</Text>
      <Text style={[S.muted, { marginTop: 4 }]}>{o.pickup_name ?? ''}{o.pickup_note ? ` · ${o.pickup_note}` : ''} → {o.dest_name ?? ''}</Text>
      <View style={{ height: 10 }} />
      {declining ? <View style={{ gap: 6 }}><Text style={S.muted}>{t('drv.decline.reason')}</Text>
        {([['too_far', 'drv.reason.far'], ['safety_concern', 'drv.reason.safety'], ['connectivity', 'drv.reason.conn'], ['other', 'drv.reason.other']] as const).map(([k, l]) => <Btn key={k} kind="ghost" title={t(l)} onPress={() => reject(k)} />)}</View>
        : <View style={[S.row, { gap: 10 }]}><View style={{ flex: 1 }}><Btn kind="ghost" title={t('drv.reject')} onPress={() => setDeclining(true)} big /></View><View style={{ flex: 2 }}><Btn title={t('drv.accept')} onPress={accept} loading={busy} disabled={left <= 0} big /></View></View>}
    </Card>
  );
}

function ActiveTrip({ trip, pos, reload }: { trip: any; pos: { lat: number; lng: number } | null; reload: () => void }) {
  const { t, client, say } = useApp(); const { busy, run } = useAsync(); const [pin, setPin] = useState(''); const [cash, setCash] = useState(String(Math.round(trip.final_fare ?? trip.estimated_fare ?? 0)));
  const st: string = trip.status; const act = (path: string, body?: unknown) => run(async () => { try { await client.post(`/bookings/${trip.id}/${path}`, body ?? {}); } finally { reload(); } });
  const nav_ = (lat: number, lng: number) => Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}`).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`));
  useEffect(() => { if (trip.payment?.outstanding != null && trip.payment.method === 'cash') setCash(String(Math.round(trip.payment.outstanding))); }, [trip.payment?.outstanding]); // eslint-disable-line
  const pinErr = (e: any) => { if (e?.code === 'pin_invalid') say(`${e.message} (${e.details?.attempts_left ?? ''})`); };
  return (
    <Card style={{ borderColor: C.primary, borderWidth: 2 }}>
      <View style={S.between}><Text style={S.h2}>{trip.ref}</Text><Pill text={st.replace(/_/g, ' ')} tone="warn" /></View>
      <Text style={S.body}>{t('drv.passenger')}: {trip.passenger?.first_name}</Text>
      {trip.estimated_driver_net != null ? <Text style={S.muted}>{t('drv.earn')}: {trip.estimated_driver_net} RWF</Text> : null}
      <Text style={[S.muted, { marginVertical: 4 }]}>{trip.pickup.name} → {trip.destination.name}{trip.pickup.note ? `\n${trip.pickup.note}` : ''}</Text>
      <MapBox center={pos ?? trip.pickup} markers={[{ ...trip.pickup, color: '#00704A', label: 'P' }, { ...trip.destination, color: '#C0392B', label: 'D' }, ...(pos ? [{ ...pos, color: '#1A5FB4', label: '' }] : [])]} height={170} zoom={14} />
      <View style={{ height: 10, }} />
      {['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(st) ? <View style={{ gap: 8 }}>
        <Btn kind="ghost" title={t('drv.navigate')} onPress={() => nav_(trip.pickup.lat, trip.pickup.lng)} />
        {st === 'DRIVER_ASSIGNED' ? <Btn title={t('drv.enroute')} onPress={() => act('en-route')} loading={busy} big /> : null}
        <Btn title={t('drv.arrived')} onPress={() => act('arrived')} loading={busy} big />
        <Btn kind="ghost" title={t('drv.cancel')} onPress={() => Alert.alert(t('drv.cancel'), '', [{ text: t('common.no') }, { text: t('drv.reason.safety'), onPress: () => run(async () => { await client.post(`/bookings/${trip.id}/cancel`, { reason: 'safety_concern', as: 'driver' }); reload(); }) }, { text: t('drv.reason.other'), onPress: () => run(async () => { await client.post(`/bookings/${trip.id}/cancel`, { reason: 'other', as: 'driver' }); reload(); }) }])} /></View> : null}
      {['DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'].includes(st) ? <View style={{ gap: 8 }}>
        <Field label={t('drv.enterpin')} value={pin} onChangeText={(x) => setPin(x.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} style={{ fontSize: 30, textAlign: 'center', letterSpacing: 10 }} />
        <Btn title={t('drv.start')} onPress={() => run(async () => { try { await client.post(`/bookings/${trip.id}/start`, { pin }); setPin(''); } catch (e) { pinErr(e); } finally { reload(); } })} loading={busy} disabled={pin.length !== 4} big />
        <Btn kind="ghost" title={t('drv.noshow')} onPress={() => act('no-show')} /></View> : null}
      {st === 'IN_PROGRESS' ? <View style={{ gap: 8 }}><Btn kind="ghost" title={t('drv.navigate.dest')} onPress={() => nav_(trip.destination.lat, trip.destination.lng)} /><Btn title={t('drv.complete')} onPress={() => act('complete')} loading={busy} big /></View> : null}
      {['COMPLETED', 'PAYMENT_PENDING'].includes(st) ? <View style={{ gap: 8 }}>
        <Money n={trip.final_fare} style={{ fontSize: 30, fontWeight: '800', color: C.primary }} />
        {trip.payment_method === 'cash' ? <><Field label={t('drv.collected.q')} value={cash} onChangeText={(x) => setCash(x.replace(/\D/g, ''))} keyboardType="number-pad" />
          <Btn title={t('drv.collect')} onPress={() => run(async () => { const r = await client.post(`/bookings/${trip.id}/cash-collected`, { amount: Number(cash) }, { retry: true }); if (r.status === 'PARTIAL') say(`${t('drv.collected.partial')}: ${r.outstanding} RWF`); reload(); })} loading={busy} disabled={!Number(cash)} big /></>
          : <Banner text={t('drv.wait.pay')} />}</View> : null}
    </Card>
  );
}

// ---------------------------------------------------------------- earnings & payouts
export function Earnings() {
  const { t, client } = useApp(); const { busy, run } = useAsync(); const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day'); const [amt, setAmt] = useState('');
  const e = usePoll(() => client.get(`/drivers/me/earnings?period=${period}`), 20000, [period]); const w = usePoll(() => client.get('/drivers/me/wallet'), 20000); const po = usePoll(() => client.get('/drivers/me/payouts'), 20000);
  const d = e.data; const bal = d?.balance ?? w.data?.balance;
  return (
    <View>
      <View style={S.row}>{(['day', 'week', 'month'] as const).map((p) => <Chip key={p} text={t(('drv.' + p) as any)} on={period === p} onPress={() => setPeriod(p)} />)}</View>
      {!d ? <Spinner /> : <Card>
        <Text style={S.muted}>{t('drv.net')}</Text><Money n={d.net} style={{ fontSize: 34, fontWeight: '800', color: C.primary }} />
        {([['drv.trips', d.trips], ['drv.fares', d.total_fares], ['drv.commission', d.commission], ['drv.cash', d.cash_collected], ['drv.momo', d.mobile_money_collected]] as const).map(([k, v]) => <View key={k} style={[S.between, { paddingVertical: 4 }]}><Text style={S.body}>{t(k as any)}</Text><Text style={S.body}>{k === 'drv.trips' ? v : `${Number(v).toLocaleString('en-US')} RWF`}</Text></View>)}
        <View style={S.between}><Text style={S.body}>{t('drv.rating')}</Text><Text style={S.body}>★ {d.rating}</Text></View>
      </Card>}
      {bal ? <Card><Text style={S.h2}>{t('drv.wallet')}</Text>
        <View style={[S.between, { paddingVertical: 4 }]}><Text style={S.body}>{t('drv.eligible')}</Text><Money n={bal.eligible_payout} style={{ fontWeight: '800', color: C.primary }} /></View>
        {bal.owed_to_platform > 0 ? <View style={[S.between, { paddingVertical: 4 }]}><Text style={S.body}>{t('drv.owed')}</Text><Money n={bal.owed_to_platform} style={{ color: C.danger, fontWeight: '700' }} /></View> : null}
        <Field label={t('drv.payout.amount')} value={amt} onChangeText={(x) => setAmt(x.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Btn title={t('drv.payout.request')} loading={busy} disabled={!Number(amt)} onPress={() => run(async () => { await client.post('/drivers/me/payouts', { amount: Number(amt) }); setAmt(''); w.reload(); po.reload(); e.reload(); })} /></Card> : null}
      {po.data?.payouts?.length ? <Card><Text style={S.h2}>{t('drv.payout.history')}</Text>{po.data.payouts.map((p: any) => <View key={p.id} style={[S.between, { paddingVertical: 4 }]}><Text style={S.body}>{new Date(p.requested_at).toLocaleDateString('en-GB')}</Text><Money n={p.amount} /><Pill tone={p.status === 'PAID' ? 'ok' : p.status === 'REJECTED' ? 'bad' : 'warn'} text={p.status} /></View>)}</Card> : null}
      {w.data?.transactions?.length ? <Card><Text style={S.h2}>{t('drv.wallet')}</Text>{w.data.transactions.slice(0, 12).map((x: any) => <View key={x.id} style={[S.between, { paddingVertical: 3 }]}><Text style={[S.muted, { flex: 1 }]} numberOfLines={1}>{x.memo}</Text><Text style={{ color: x.credit ? C.primary : C.danger }}>{x.credit ? '+' + x.credit : '−' + x.debit}</Text></View>)}</Card> : null}
    </View>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Share, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useApp, useAsync, usePoll } from '../lib/app';
import { ApiError, uuid } from '../lib/net';
import { kv, loadJson, saveJson } from '../lib/storage';
import { Banner, Btn, Card, Chip, Empty, Field, Header, Money, Pill, Screen, Spinner } from '../ui/components';
import { MapBox } from '../ui/MapView';
import { C, S } from '../ui/theme';
import { showAlert } from '../ui/dialog';
import { KIGALI, POLL_MS } from '../config';
import { SosButton } from './shared';

type Pt = { lat: number; lng: number; name?: string };
type Place = { id?: string; name: string; lat: number; lng: number; kind?: string; designated_pickup?: boolean };
const rad = (d: number) => (d * Math.PI) / 180;
const distM = (a: Pt, b: Pt) => { const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(x)); };
const fmtMin = (s: number) => Math.max(1, Math.round(s / 60));

export function Home() {
  const { t, lang, client, nav, me, online, mode, setMode, say } = useApp();
  const [pickup, setPickup] = useState<Pt | null>(null); const [dest, setDest] = useState<Pt | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null); const [note, setNote] = useState('');
  const [q, setQ] = useState(''); const [results, setResults] = useState<Place[]>([]); const [popular, setPopular] = useState<Place[]>([]);
  const [recents, setRecents] = useState<Pt[]>([]); const [saved, setSaved] = useState<any[]>([]); const [zones, setZones] = useState<[number, number][][]>([]);
  const [mapOk, setMapOk] = useState(true); const [consent, setConsent] = useState<boolean | null>(null); const [when, setWhen] = useState<string | null>(null);

  useEffect(() => { loadJson<Pt[]>('rm_recents', []).then(setRecents); kv.get('rm_loc_consent').then((v) => setConsent(v === '1')); }, []);
  useEffect(() => {
    client.get(`/places/popular?lang=${lang}`).then((r) => setPopular(r.places)).catch(() => {});
    client.get('/coverage').then((r) => setZones(r.zones.map((z: any) => z.polygon))).catch(() => {});
    client.get('/users/me/places').then((r) => setSaved(r.places)).catch(() => {});
  }, [client, lang]);

  const locate = useCallback(async () => {
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (p.status !== 'granted') { say(t('home.nolocation')); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setAccuracy(pos.coords.accuracy ?? null); setPickup({ lat: pos.coords.latitude, lng: pos.coords.longitude, name: t('home.mylocation') });
    } catch { say(t('home.nolocation')); }
  }, [say, t]);
  useEffect(() => { if (consent) void locate(); }, [consent, locate]);

  // search (debounced); falls back to the local landmark list when offline
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const id = setTimeout(() => {
      client.get(`/places/search?q=${encodeURIComponent(q.trim())}&lang=${lang}`).then((r) => setResults(r.places)).catch(() => setResults(popular.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))));
    }, 350);
    return () => clearTimeout(id);
  }, [q, client, lang, popular]);

  const active = usePoll(() => client.get('/bookings/active?role=passenger'), 6000, [mode]);
  const nearest = (p: Pt) => { let best: Place | null = null; let bd = 250; for (const x of popular) { const d = distM(p, x); if (d < bd) { bd = d; best = x; } } return best?.name; };
  const pickDest = async (p: Place | Pt) => {
    const name = (p as Place).name ?? nearest(p) ?? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`; setDest({ lat: p.lat, lng: p.lng, name }); setQ(''); setResults([]);
    const r = [{ lat: p.lat, lng: p.lng, name }, ...recents.filter((x) => x.name !== name)].slice(0, 6); setRecents(r); void saveJson('rm_recents', r);
  };
  const markers = [...(dest ? [{ lat: dest.lat, lng: dest.lng, label: dest.name, color: '#C0392B' }] : [])];
  const go = (schedule?: string | null) => { if (!pickup || !dest) return; nav.push('options', { pickup, dest, note, scheduled_for: schedule ?? undefined }); };
  const activeB = active.data?.booking;

  if (consent === false) return (
    <Screen footer={<><Btn title={t('loc.allow')} onPress={async () => { await kv.set('rm_loc_consent', '1'); try { await client.post('/users/me/consents', { kind: 'location', version: 'v1', granted: true }); } catch { /* retried implicitly later */ } setConsent(true); }} big /><View style={{ height: 8 }} /><Btn kind="ghost" title={t('loc.skip')} onPress={() => setConsent(true)} /></>}>
      <Text style={[S.h1, { marginTop: 24 }]}>{t('loc.title')}</Text><Text style={[S.body, { marginTop: 12 }]}>{t('loc.body')}</Text>
    </Screen>
  );

  return (
    <View style={S.screen}>
      <Header title={t('home.where')} right={
        <View style={S.row}>
          {me?.roles.includes('driver') ? <Chip text={t('drv.mode')} onPress={() => setMode('driver')} /> : null}
          <Pressable onPress={() => nav.push('support')} style={{ padding: 8 }}><Text style={{ color: C.primary, fontWeight: '700' }}>{t('home.help')}</Text></Pressable>
          <Pressable onPress={() => nav.push('profile')} style={{ padding: 8 }}><Text style={{ color: C.primary, fontWeight: '700' }}>{t('home.profile')}</Text></Pressable>
        </View>} />
      <ScrollView contentContainerStyle={{ padding: 14 }} keyboardShouldPersistTaps="handled">
        {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
        {activeB ? <Card style={{ borderColor: C.primary }}><View style={S.between}><View><Text style={S.h2}>{t('home.active')}</Text><Text style={S.muted}>{activeB.ref} · {activeB.status.replace(/_/g, ' ')}</Text></View><Btn title={t('home.resume')} onPress={() => nav.push('track', { id: activeB.id })} /></View></Card> : null}
        {mapOk ? <MapBox center={pickup ?? KIGALI} zoom={14} pin={pickup} markers={markers} zones={zones} onPin={(lat, lng) => setPickup({ lat, lng, name: nearest({ lat, lng }) ?? t('home.mylocation') })} onTap={(lat, lng) => void pickDest({ lat, lng })} onStatus={setMapOk} height={260} />
          : <Banner text={t('home.map.off')} />}
        <Text style={[S.muted, { marginVertical: 6 }]}>{t('home.adjust')}{accuracy ? ` · ${t('home.gps.accuracy')} ±${Math.round(accuracy)} m` : ''}</Text>
        <Card>
          <View style={S.between}><Text style={S.muted}>{t('home.pickup')}</Text><Pressable onPress={locate}><Text style={{ color: C.primary, fontWeight: '700' }}>{t('home.mylocation')}</Text></Pressable></View>
          <Text style={[S.body, { fontWeight: '600', marginBottom: 8 }]}>{pickup ? pickup.name ?? `${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}` : t('home.nolocation')}</Text>
          <Field value={note} onChangeText={setNote} placeholder={t('home.pickupnote')} maxLength={280} />
          <Text style={S.muted}>{t('home.dest')}</Text>
          {dest ? <View style={S.between}><Text style={[S.body, { fontWeight: '700', flex: 1 }]}>{dest.name}</Text><Pressable onPress={() => setDest(null)}><Text style={{ color: C.danger }}>✕</Text></Pressable></View>
            : <Field value={q} onChangeText={setQ} placeholder={t('home.search')} />}
          {results.map((r) => <Pressable key={(r.id ?? '') + r.name + r.lat} onPress={() => void pickDest(r)} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }}><Text style={S.body}>{r.name}</Text></Pressable>)}
        </Card>
        {!dest ? <>
          {saved.length ? <><Text style={[S.h2, { marginBottom: 6 }]}>{t('home.saved')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{saved.map((p) => <Chip key={p.id} text={`${t(('prof.places.' + p.label) as any)} · ${p.name}`} onPress={() => void pickDest(p)} />)}</View></> : null}
          {recents.length ? <><Text style={[S.h2, { marginBottom: 6 }]}>{t('home.recent')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{recents.map((p, i) => <Chip key={i} text={p.name ?? ''} onPress={() => void pickDest(p)} />)}</View></> : null}
          <Text style={[S.h2, { marginBottom: 6 }]}>{t('home.popular')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{popular.map((p) => <Chip key={p.id ?? p.name} text={p.name} onPress={() => void pickDest(p)} />)}</View>
        </> : null}
        <View style={{ height: 12 }} />
        <Btn big title={t('home.seeprices')} onPress={() => go(when)} disabled={!pickup || !dest} />
        <View style={{ height: 10 }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip text={t('home.now')} on={!when} onPress={() => setWhen(null)} />
          {[30, 60, 180].map((m) => <Chip key={m} text={`${t('opt.plus')} ${m >= 60 ? m / 60 + ' h' : m + ' ' + t('common.min')}`} on={!!when && Math.abs(new Date(when).getTime() - (Date.now() + m * 60000)) < 60000} onPress={() => setWhen(new Date(Date.now() + m * 60000 + 30000).toISOString())} />)}
        </View>
        <View style={{ height: 8 }} /><Btn kind="ghost" title={t('home.history')} onPress={() => nav.push('history')} />
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------------------ options & confirm
export function Options({ params }: { params: { pickup: Pt; dest: Pt; note?: string; scheduled_for?: string } }) {
  const { t, lang, client, nav, outbox, cfg, online, say } = useApp();
  const [data, setData] = useState<any>(null); const [err, setErr] = useState<ApiError | null>(null); const [sel, setSel] = useState<string | null>(null);
  const [method, setMethod] = useState('cash'); const [promo, setPromo] = useState(''); const [applied, setApplied] = useState(''); const [biz, setBiz] = useState<any[]>([]); const [corp, setCorp] = useState<string | null>(null);
  const [cc, setCc] = useState(''); const [po, setPo] = useState(''); const { busy, run } = useAsync(); const keyRef = useRef<string | null>(null);

  const load = useCallback(async (code?: string) => {
    setErr(null); setData(null);
    try {
      const r = await client.post('/fares/estimate', { pickup: params.pickup, dest: params.dest, promo_code: code || undefined, scheduled_for: params.scheduled_for }, { retry: true });
      setData(r); const first = r.options.find((o: any) => o.available); setSel((s) => (s && r.options.find((o: any) => o.service_id === s && o.available) ? s : first?.service_id ?? null));
      keyRef.current = null;
    } catch (e) { setErr(e as ApiError); }
  }, [client, params]);
  useEffect(() => { void load(); client.get('/businesses/mine').then((r) => setBiz(r.businesses.filter((b: any) => b.status === 'active'))).catch(() => {}); }, [load, client]);

  const opt = data?.options.find((o: any) => o.service_id === sel);
  const momo = cfg?.payment_methods.find((m) => m.id === 'mtn_momo');
  const confirm = () => run(async () => {
    if (!opt?.quote_id) return;
    keyRef.current = keyRef.current ?? uuid();                         // same key on every retry of this tap: never a duplicate booking
    const body = { quote_id: opt.quote_id, payment_method: corp ? 'corporate' : method, pickup_name: params.pickup.name, pickup_note: params.note || undefined, dest_name: params.dest.name,
      ...(corp ? { corporate_id: corp, cost_centre: cc || undefined, po_ref: po || undefined } : {}) };
    try {
      const r = await client.post('/bookings', body, { idempotencyKey: keyRef.current });
      nav.reset('track', { id: r.booking.id });
    } catch (e: any) {
      if (e instanceof ApiError && e.isNetwork) {
        await outbox.enqueue({ id: 'booking-' + keyRef.current, kind: 'booking', path: '/bookings', body, key: keyRef.current!, treatConflictAsDone: true });
        nav.reset('track', { pending: true });
      } else if (e?.code === 'quote_expired' || e?.code === 'promo_invalid') { say(t('opt.quote.expired')); void load(applied); }
      else if (e?.code === 'active_booking_exists') nav.reset('track', { id: e.details?.id });
      else throw e;
    }
  });

  return (
    <View style={S.screen}>
      <Header title={t('opt.title')} onBack={() => nav.pop()} />
      <ScrollView contentContainerStyle={{ padding: 14 }} keyboardShouldPersistTaps="handled">
        {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
        <Text style={S.muted}>{params.pickup.name} → {params.dest.name}</Text>
        {params.scheduled_for ? <Pill tone="warn" text={`${t('trip.scheduled')} · ${new Date(params.scheduled_for).toLocaleString('en-GB', { timeZone: 'Africa/Kigali' })}`} /> : null}
        {err ? <><Banner kind="bad" text={err.code === 'pickup_outside_coverage' ? err.message : err.isNetwork ? t('net.offline') : err.message} /><Btn title={t('common.retry')} onPress={() => load(applied)} /></> : null}
        {!data && !err ? <Spinner /> : null}
        {data ? <>
          {data.alternatives.length ? <Banner text={`${t('opt.nodrivers')}. ${t('opt.alt')}`} /> : null}
          {data.options.map((o: any) => (
            <Pressable key={o.service_id} disabled={!o.available} onPress={() => setSel(o.service_id)} accessibilityRole="button">
              <Card style={{ borderColor: sel === o.service_id ? C.primary : C.line, borderWidth: sel === o.service_id ? 2 : 1, opacity: o.available ? 1 : 0.55 }}>
                <View style={S.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.h2}>{lang === 'rw' ? o.name_rw : o.name_en}</Text>
                    <Text style={S.muted}>{o.capacity} {t('opt.seats')}{o.pickup_eta_s ? ` · ${t('opt.eta')} ${fmtMin(o.pickup_eta_s)} ${t('common.min')}` : ''}</Text>
                    {!o.available ? <Text style={{ color: C.danger, fontSize: 13 }}>{t('opt.unavailable')}</Text> : null}
                  </View>
                  {o.fare ? <View style={{ alignItems: 'flex-end' }}><Money n={o.fare.total} style={[S.h2, { color: C.primary }]} />{o.fare.discount ? <Text style={{ color: C.primary, fontSize: 12 }}>−{o.fare.discount}</Text> : null}</View> : null}
                </View>
              </Card>
            </Pressable>))}
          {opt?.fare ? <Card>
            <Text style={S.h2}>{t('opt.breakdown')}</Text>
            {opt.fare.lines.map((l: any, i: number) => <View key={i} style={[S.between, { paddingVertical: 3 }]}><Text style={S.body}>{lang === 'rw' ? l.label_rw : l.label_en}</Text><Money n={l.amount} /></View>)}
            <View style={[S.between, { borderTopWidth: 1, borderTopColor: C.line, marginTop: 6, paddingTop: 6 }]}><Text style={[S.body, { fontWeight: '700' }]}>{t('opt.total')}</Text><Money n={opt.fare.total} style={{ fontWeight: '700', fontSize: 17 }} /></View>
            <Text style={[S.muted, { marginTop: 8 }]}>{t('opt.estimate')}{opt.route_source === 'estimate' ? ' ' + t('opt.route.estimate') : ''}</Text>
          </Card> : null}
          <View style={S.row}><View style={{ flex: 1 }}><Field value={promo} onChangeText={setPromo} placeholder={t('opt.promo')} autoCapitalize="characters" /></View><View style={{ width: 8 }} /><Btn kind="ghost" title={t('opt.apply')} onPress={() => { setApplied(promo.trim()); void load(promo.trim()); }} /></View>
          {opt?.promo ? (opt.promo.discount ? <Banner kind="ok" text={`${t('opt.promo.ok')}: −${opt.promo.discount} RWF`} /> : <Banner kind="bad" text={`${t('opt.promo.bad')} (${opt.promo.error})`} />) : null}
          <Text style={[S.h2, { marginVertical: 8 }]}>{t('opt.pay')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip text={t('opt.cash')} on={!corp && method === 'cash'} onPress={() => { setCorp(null); setMethod('cash'); }} />
            {momo?.enabled ? <Chip text={momo.simulated ? t('opt.momo.sim') : t('opt.momo')} on={!corp && method === 'mtn_momo'} onPress={() => { setCorp(null); setMethod('mtn_momo'); }} /> : null}
            {biz.map((b) => <Chip key={b.id} text={`${t('opt.corporate')}: ${b.legal_name}`} on={corp === b.id} onPress={() => setCorp(b.id)} />)}
          </View>
          {corp ? <><Field label={t('biz.cc')} value={cc} onChangeText={setCc} /><Field label={t('biz.po')} value={po} onChangeText={setPo} /></> : null}
          <View style={{ height: 8 }} />
          <Btn big title={t('opt.confirm')} onPress={confirm} loading={busy} disabled={!opt?.available} />
          {!data.options.some((o: any) => o.available) ? <><View style={{ height: 8 }} /><Btn kind="ghost" title={t('trip.alt.later')} onPress={() => nav.pop()} /></> : null}
        </> : null}
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------------------ live trip
const Stars = ({ v, set }: { v: number; set: (n: number) => void }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'center', marginVertical: 8 }}>{[1, 2, 3, 4, 5].map((n) => (
    <Pressable key={n} onPress={() => set(n)} accessibilityLabel={`${n} stars`} style={{ padding: 6 }}><Text style={{ fontSize: 38, color: n <= v ? C.gold : C.line }}>★</Text></Pressable>))}</View>
);

export function Track({ params }: { params: { id?: string; pending?: boolean } }) {
  const { t, lang, client, nav, outbox, pendingOutbox, online, say } = useApp();
  const [chat, setChat] = useState(false); const { busy, run } = useAsync();
  const poll = usePoll(async () => {
    const r = params.id ? await client.get(`/bookings/${params.id}`) : (await client.get('/bookings/active?role=passenger')).booking;
    return r;
  }, POLL_MS, [params.id, pendingOutbox]);
  const b = poll.data; const unconfirmed = !b && (params.pending || pendingOutbox > 0);

  if (unconfirmed) return (
    <Screen footer={<Btn kind="ghost" title={t('common.back')} onPress={() => nav.reset('home')} />}>
      <Banner text={t('net.pending')} /><Pill tone="warn" text={t('trip.unconfirmed')} /><Spinner />
    </Screen>);
  if (!b) return <Screen>{poll.error && !poll.error.isNetwork ? <Banner kind="bad" text={poll.error.message} /> : <Spinner />}<Btn kind="ghost" title={t('common.back')} onPress={() => nav.reset('home')} /></Screen>;

  const st: string = b.status;
  const cancel = () => showAlert(t('trip.cancel.confirm'), ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'].includes(st) ? t('trip.cancel.fee') : '', [
    { text: t('common.no') }, { text: t('common.yes'), style: 'destructive', onPress: () => run(async () => { await client.post(`/bookings/${b.id}/cancel`, { reason: 'changed_mind' }, { retry: true }); poll.reload(); }) }]);
  const share = () => run(async () => { const r = await client.post(`/bookings/${b.id}/share`, {}); await Share.share({ message: `${t('trip.share.msg')} ${r.url}` }); });
  const mapMarkers = [{ lat: b.pickup.lat, lng: b.pickup.lng, label: t('home.pickup'), color: '#00704A' }, { lat: b.destination.lat, lng: b.destination.lng, label: t('home.dest'), color: '#C0392B' }, ...(b.driver_location ? [{ lat: b.driver_location.lat, lng: b.driver_location.lng, label: t('trip.driver'), color: '#1A5FB4' }] : [])];
  const live = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS'].includes(st);
  const title = { SEARCHING_DRIVER: t('trip.searching'), REQUESTED: t('trip.searching'), DRIVER_ASSIGNED: t('trip.assigned'), DRIVER_ARRIVING: t('trip.arriving'), DRIVER_ARRIVED: t('trip.arrived'), AWAITING_PASSENGER_VERIFICATION: t('trip.arrived'), IN_PROGRESS: t('trip.inprogress'),
    COMPLETED: t('trip.completed'), PAYMENT_PENDING: t('trip.completed'), PAYMENT_COMPLETED: t('trip.completed'), NO_DRIVER_FOUND: t('trip.nodriver'), SCHEDULED: t('trip.scheduled') }[st] ?? t('trip.cancelled');

  return (
    <View style={S.screen}>
      <Header title={title} onBack={() => nav.reset('home')} right={live ? <SosButton bookingId={b.id} /> : null} />
      <ScrollView contentContainerStyle={{ padding: 14 }} keyboardShouldPersistTaps="handled">
        {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
        {(live || st === 'SEARCHING_DRIVER') ? <MapBox center={b.driver_location ?? b.pickup} markers={mapMarkers} height={220} zoom={14} /> : null}
        <View style={{ height: 12 }} />

        {(st === 'SEARCHING_DRIVER' || st === 'REQUESTED') ? <Card><Spinner /><Text style={[S.body, { textAlign: 'center' }]}>{t('trip.searching.sub')}</Text><View style={{ height: 10 }} /><Btn kind="ghost" title={t('trip.cancel')} onPress={cancel} loading={busy} /></Card> : null}

        {st === 'SCHEDULED' ? <Card><Text style={S.body}>{new Date(b.scheduled_for).toLocaleString('en-GB', { timeZone: 'Africa/Kigali' })}</Text><View style={{ height: 8 }} /><Btn kind="ghost" title={t('trip.cancel')} onPress={cancel} /></Card> : null}

        {st === 'NO_DRIVER_FOUND' ? <Card><Text style={S.body}>{t('opt.alt')}</Text><View style={{ height: 8 }} /><Btn title={t('trip.alt.other')} onPress={() => nav.reset('home')} /><View style={{ height: 8 }} /><Btn kind="ghost" title={t('trip.alt.later')} onPress={() => nav.reset('home')} /></Card> : null}

        {live && b.driver ? <Card>
          <Text style={S.muted}>{t('trip.verify')}</Text>
          <Text style={[S.h2, { marginTop: 4 }]}>{b.driver.name} · {b.driver.rating_count > 0 ? `★ ${Number(b.driver.rating).toFixed(1)}` : t('trip.newdriver')}</Text>
          <Text style={S.body}>{b.vehicle?.color} {b.vehicle?.make} {b.vehicle?.model}</Text>
          <View style={{ backgroundColor: C.warnBg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'flex-start', marginTop: 8 }}><Text style={{ fontSize: 24, fontWeight: '800', letterSpacing: 3 }}>{b.vehicle?.plate}</Text></View>
        </Card> : null}
        {b.trip_pin ? <Card style={{ backgroundColor: C.okBg, borderColor: C.primary }}><Text style={S.muted}>{t('trip.pin')}</Text><Text style={{ fontSize: 44, fontWeight: '800', letterSpacing: 10, color: C.primaryDark }}>{b.trip_pin}</Text><Text style={S.muted}>{t('trip.pin.hint')}</Text></Card> : null}
        {live ? <View style={{ gap: 8 }}>
          <Btn kind="ghost" title={t('trip.chat')} onPress={() => setChat(true)} /><Btn kind="ghost" title={t('trip.share')} onPress={share} loading={busy} />
          {st !== 'IN_PROGRESS' ? <Btn kind="ghost" title={t('trip.cancel')} onPress={cancel} /> : null}
        </View> : null}

        {['COMPLETED', 'PAYMENT_PENDING'].includes(st) ? <PayCard b={b} reload={poll.reload} /> : null}
        {['PAYMENT_COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(st) ? <Done b={b} /> : null}
        {st.startsWith('CANCELLED') ? <Card><Text style={S.body}>{b.cancel_fee ? `${t('trip.cancel.fee')} (${b.cancel_fee} RWF)` : t('trip.cancelled')}</Text><View style={{ height: 8 }} /><Btn title={t('trip.rebook')} onPress={() => nav.reset('home')} /></Card> : null}
      </ScrollView>
      <ChatModal id={b.id} visible={chat} onClose={() => setChat(false)} />
    </View>
  );
}

function PayCard({ b, reload }: { b: any; reload: () => void }) {
  const { t, client, me, say } = useApp(); const { busy, run } = useAsync(); const [msisdn, setMsisdn] = useState(me?.phone ?? ''); const [payId, setPayId] = useState<string | null>(null);
  const pay = usePoll(() => client.get(`/payments/${payId}`), 3000, [payId], !!payId && b.payment?.status !== 'SUCCESS');
  const p = pay.data ?? b.payment; const momo = b.payment_method === 'mtn_momo' || b.payment_method === 'airtel_money';
  useEffect(() => { if (pay.data?.status === 'SUCCESS') reload(); }, [pay.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => run(async () => { const r = await client.post('/payments', { booking_id: b.id, method: 'mtn_momo', msisdn }, { retry: true }); setPayId(r.id); });
  const toCash = () => run(async () => { await client.post(`/bookings/${b.id}/payment-method`, { method: 'cash' }); setPayId(null); reload(); });
  const toMomo = () => run(async () => { await client.post(`/bookings/${b.id}/payment-method`, { method: 'mtn_momo' }); reload(); });
  if (b.payer_type === 'corporate') return <Card><Text style={S.body}>{t('opt.corporate')}</Text><Money n={b.final_fare} style={S.h1} /></Card>;
  return (
    <Card>
      <Text style={S.muted}>{t('trip.fare.final')}</Text><Money n={b.final_fare} style={[S.h1, { color: C.primary }]} />
      {momo ? <>
        {p?.status === 'PENDING' ? <Banner text={t('trip.pay.waiting')} /> : null}
        {p?.status === 'FAILED' ? <Banner kind="bad" text={t('trip.pay.failed')} /> : null}
        {p?.simulated ? <Banner text="Test mode: this payment is simulated, not real money." /> : null}
        {p?.status !== 'PENDING' ? <><Field label={t('trip.pay.msisdn')} value={msisdn} onChangeText={setMsisdn} keyboardType="phone-pad" /><Btn title={t('trip.pay.momo')} onPress={start} loading={busy} /><View style={{ height: 8 }} /></> : null}
        {p?.status !== 'PENDING' ? <Btn kind="ghost" title={t('trip.pay.cash')} onPress={toCash} /> : null}
      </> : <>
        <Text style={[S.body, { marginVertical: 8 }]}>{t('trip.pay.cashdue')} <Text style={{ fontWeight: '800' }}>{Math.round(b.payment?.outstanding ?? b.final_fare)} RWF</Text></Text>
        <Text style={S.muted}>{t('trip.pay.cashnote')}</Text><View style={{ height: 10 }} /><Btn kind="ghost" title={t('trip.pay.momo')} onPress={toMomo} loading={busy} />
      </>}
    </Card>
  );
}

function Done({ b }: { b: any }) {
  const { t, outbox, nav, client } = useApp(); const [score, setScore] = useState(0); const [comment, setComment] = useState(''); const [sent, setSent] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  useEffect(() => { client.get(`/bookings/${b.id}/receipt`).then(setReceipt).catch(() => {}); }, [client, b.id]);
  const send = async () => { await outbox.enqueue({ id: 'rate-' + b.id, kind: 'rating', path: `/bookings/${b.id}/ratings`, body: { score, comment: comment || undefined }, key: 'rate-' + b.id + '-passenger', treatConflictAsDone: true }); void outbox.flush(); setSent(true); };
  return (
    <Card>
      <Pill text={t('trip.pay.done')} /><Money n={b.final_fare} style={[S.h1, { marginVertical: 6 }]} />
      {receipt ? <Text style={S.muted}>{t('trip.receipt')} {receipt.receipt_no} · {receipt.payment?.method}</Text> : null}
      {sent ? <Text style={[S.h2, { textAlign: 'center', marginVertical: 12 }]}>{t('trip.rate.thanks')}</Text> : <>
        <Text style={[S.h2, { textAlign: 'center', marginTop: 12 }]}>{t('trip.rate')}</Text><Stars v={score} set={setScore} />
        <Field value={comment} onChangeText={setComment} placeholder={t('trip.rate.comment')} multiline /><Btn title={t('trip.rate.send')} onPress={send} disabled={!score} /></>}
      <View style={{ height: 8 }} /><Btn title={t('trip.rebook')} onPress={() => nav.reset('home')} /><View style={{ height: 8 }} />
      <Btn kind="ghost" title={t('trip.problem')} onPress={() => nav.push('support', { booking_id: b.id })} />
    </Card>
  );
}

function ChatModal({ id, visible, onClose }: { id: string; visible: boolean; onClose: () => void }) {
  const { t, client, me } = useApp(); const [text, setText] = useState('');
  const msgs = usePoll(() => client.get(`/bookings/${id}/messages`), 4000, [id], visible);
  const send = async () => { if (!text.trim()) return; const body = text.trim(); setText(''); try { await client.post(`/bookings/${id}/messages`, { body }, { retry: false }); msgs.reload(); } catch { setText(body); } };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen scroll={false} footer={<View style={S.row}><View style={{ flex: 1 }}><Field value={text} onChangeText={setText} placeholder={t('trip.msg.ph')} maxLength={480} /></View><View style={{ width: 8 }} /><Btn title={t('common.send')} onPress={send} /></View>}>
        <Header title={t('trip.chat')} right={<Pressable onPress={onClose}><Text style={{ color: C.primary, padding: 8 }}>{t('common.close')}</Text></Pressable>} />
        <ScrollView contentContainerStyle={{ padding: 14 }}>{(msgs.data?.messages ?? []).map((m: any) => (
          <View key={m.id} style={{ alignSelf: m.sender_id === me?.id ? 'flex-end' : 'flex-start', backgroundColor: m.sender_id === me?.id ? C.okBg : '#fff', borderRadius: 12, padding: 10, marginBottom: 6, maxWidth: '80%', borderWidth: 1, borderColor: C.line }}><Text>{m.body}</Text></View>))}</ScrollView>
      </Screen>
    </Modal>
  );
}

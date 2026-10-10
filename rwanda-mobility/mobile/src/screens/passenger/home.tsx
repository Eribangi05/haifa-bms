import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFlag, useFlagMessage } from '../../lib/flags';
import { Pressable, View } from 'react-native';
import { useApp, usePoll } from '../../lib/app';
import { useLocate } from '../../lib/hooks';
import { isOpen } from '../../lib/trip';
import { kv } from '../../lib/storage';
import type { Booking, CustomerCar, Place, Pt, Svc, Venue } from '../../lib/types';
import { KIGALI } from '../../config';
import { Banner, Btn, Card, Chip, Field, IconBadge, LinkBtn, PermissionCard, Screen, SectionTitle, Text, useProportionalHeight } from '../../ui/components';
import { MapBox } from '../../ui/MapView';
import { C, S, SP } from '../../ui/theme';
import { HowItWorks, RecentTrips, SavedShortcuts, ServiceCards, StatusChip } from './homeParts';
import { usePlaces } from './usePlaces';
import { CreditChip } from '../money/credit';
import { DateTimeField, NumberStepper } from '../../ui/Pickers';
import { carIcon, useNearbyCars } from '../../lib/nearby';
import type { Marker } from '../../ui/MapView';
import { instantAllowed } from '../../lib/calendar';

let resumedOnce = false;   // auto-open the active trip only once per app launch (resume after the app was killed)

export function Home({ params, intent, onActive }: { params?: { venue?: Venue; svc?: Svc }; intent?: { dest?: Place | Pt; svc?: Svc; n: number } | null; onActive?: (b: Booking | null) => void }) {
  const requestsOn = useFlag('booking.requests'); const requestsMsg = useFlagMessage('booking.requests');
  const { t, lang, client, nav, online, mode, say, cfg } = useApp();
  const loc = useLocate(); const places = usePlaces();
  const [pickup, setPickup] = useState<Pt | null>(null); const [dest, setDest] = useState<Pt | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null); const [note, setNote] = useState('');
  const [q, setQ] = useState(''); const [results, setResults] = useState<Place[]>([]); const [searching, setSearching] = useState(false);
  const [custom, setCustom] = useState(false);
  // Where the pickup came from, and whether the person chose it (the phone's location is only a starting suggestion): see "pickup" card below.
  const [pickupSrc, setPickupSrc] = useState<'gps' | 'place' | 'pin' | 'venue' | null>(null); const [pickupChosen, setPickupChosen] = useState(false);
  const [editPickup, setEditPickup] = useState(false); const [q2, setQ2] = useState(''); const [results2, setResults2] = useState<Place[]>([]); const [tapPickup, setTapPickup] = useState(false);
  const gpsAt = useRef<{ lat: number; lng: number } | null>(null);
  const [mapOk, setMapOk] = useState(true); const [consent, setConsent] = useState<boolean | null>(null); const [skipped, setSkipped] = useState(false); const [when, setWhen] = useState<string | null>(null);
  const [svc, setSvcState] = useState<Svc>('ride'); const [cars, setCars] = useState<CustomerCar[]>([]); const [carId, setCarId] = useState<string | null>(null);
  const [forOther, setForOther] = useState(false);
  const [hire, setHire] = useState<'p2p' | 'hourly'>('p2p'); const [hours, setHours] = useState(2);
  const [trips, setTrips] = useState<Booking[]>([]);
  const setSvc = (v: Svc) => { setSvcState(v); void kv.set('rm_svc', v); };
  const mapH = useProportionalHeight(0.34, 200, 380);
  // Arrived from a scanned request code: pickup = the venue, service = its default (or the link's choice), destination empty.
  const [reqCode, setReqCode] = useState<string | null>(params?.venue?.code ?? null);
  const fromCode = useRef(!!params?.venue);
  useEffect(() => {
    const v = params?.venue; if (!v) return;
    setPickup({ lat: v.lat, lng: v.lng, name: v.name }); setPickupSrc('venue'); setPickupChosen(true); setNote(v.note ?? ''); setDest(null); setAccuracy(null);
    if (params?.svc) setSvc(params.svc);
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!params?.svc) kv.get('rm_svc').then((v) => v === 'abasare' && setSvcState('abasare')).catch(() => {}); kv.get('rm_car').then((v) => v && setCarId(v)).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (svc !== 'abasare') return; client.get('/users/me/cars').then((r) => { setCars(r.cars); setCarId((cur) => (r.cars.some((c: CustomerCar) => c.id === cur) ? cur : r.cars[0]?.id ?? null)); }).catch(() => {}); }, [svc, client]);
  useEffect(() => { if (carId) void kv.set('rm_car', carId).catch(() => {}); }, [carId]);
  const lead = (cfg as { booking?: { min_schedule_lead_min?: number } } | null)?.booking?.min_schedule_lead_min ?? 20, days = (cfg as { booking?: { max_scheduled_days?: number } } | null)?.booking?.max_scheduled_days ?? 14;
  const abasareOn = !!cfg?.abasare?.enabled;
  useEffect(() => { if (!abasareOn && svc === 'abasare') setSvcState('ride'); }, [abasareOn, svc]);

  useEffect(() => { kv.get('rm_loc_consent').then((v) => setConsent(v === '1')).catch(() => setConsent(false)); }, []);
  useEffect(() => { client.get('/bookings?role=passenger&limit=3').then((r) => setTrips(r.bookings)).catch(() => {}); }, [client]);

  const chosenRef = useRef(false); chosenRef.current = pickupChosen;
  /** `force` = the person asked for their location; the automatic first look never replaces a pickup they chose themselves. */
  const locate = useCallback(async (force = true) => {
    const fix = await loc.locate();
    if (fix && !force && chosenRef.current) { gpsAt.current = { lat: fix.lat, lng: fix.lng }; return; }
    if (fix) { setAccuracy(fix.accuracy); gpsAt.current = { lat: fix.lat, lng: fix.lng }; setPickupSrc('gps'); setPickup({ lat: fix.lat, lng: fix.lng, name: t('home.mylocation') });
      // name the spot ("Near Gihara") from the server's offline village list; keep "My location" when nothing is close or offline
      client.get(`/places/reverse?lat=${fix.lat.toFixed(5)}&lng=${fix.lng.toFixed(5)}&lang=${lang}`).then((r) => { const n = r?.place?.name as string | undefined; if (n) setPickup((cur) => (cur && cur.lat === fix.lat && cur.lng === fix.lng ? { ...cur, name: t('home.near', { place: n }) } : cur)); }).catch(() => {}); }
    else if (loc.perm === 'granted' || loc.perm === 'unknown') say(t('home.nolocation'));
  }, [loc, say, t, client, lang]);
  const locateRef = useRef(locate); locateRef.current = locate;
  useEffect(() => { if (consent && !skipped && !fromCode.current) void locateRef.current(false); }, [consent, skipped]);
  useEffect(() => {          // search for a PICKUP place (same index as the destination search)
    const term = q2.trim(); if (term.length < 2) { setResults2([]); return; } let live = true;
    const id = setTimeout(() => { client.get(`/places/search?q=${encodeURIComponent(term)}&lang=${lang}${pickup ? `&lat=${pickup.lat.toFixed(4)}&lng=${pickup.lng.toFixed(4)}` : ''}`).then((r) => live && setResults2(r.places)).catch(() => live && setResults2(places.popular.filter((p) => p.name.toLowerCase().includes(term.toLowerCase())))); }, 350);
    return () => { live = false; clearTimeout(id); };
  }, [q2, client, lang, places.popular]); // eslint-disable-line react-hooks/exhaustive-deps

  // search (debounced); falls back to the local landmark list when offline
  useEffect(() => {
    const term = q.trim(); if (term.length < 2) { setResults([]); setSearching(false); return; }
    let live = true; setSearching(true);
    const id = setTimeout(() => {
      client.get(`/places/search?q=${encodeURIComponent(term)}&lang=${lang}${pickup ? `&lat=${pickup.lat.toFixed(4)}&lng=${pickup.lng.toFixed(4)}` : ''}`).then((r) => live && setResults(r.places)).catch(() => live && setResults(places.popular.filter((p) => p.name.toLowerCase().includes(term.toLowerCase())))).finally(() => live && setSearching(false));
    }, 350);
    return () => { live = false; clearTimeout(id); };
  }, [q, client, lang, places.popular]);

  const active = usePoll(() => client.get<{ booking: Booking | null }>('/bookings/active?role=passenger'), 6000, [mode]);
  const activeB = active.data?.booking && isOpen(active.data.booking.status) ? active.data.booking : null;
  useEffect(() => { if (activeB && !resumedOnce && !params?.venue && nav.stack.length === 1) { resumedOnce = true; nav.push('track', { id: activeB.id }); } }, [activeB, params, nav]);
  useEffect(() => { if (active.loaded) resumedOnce = true; }, [active.loaded]);
  useEffect(() => { onActive?.(activeB ?? null); }, [activeB?.id, activeB?.status]); // eslint-disable-line react-hooks/exhaustive-deps   // only the very first answer after launch may auto-open

  const pickDest = (p: Place | Pt) => {
    const name = (p as Place).name ?? places.nearest(p) ?? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
    setDest({ lat: p.lat, lng: p.lng, name }); setQ(''); setResults([]); places.pushRecent({ lat: p.lat, lng: p.lng, name });
  };
  // A destination (or service) chosen on the Home tab: apply it once per tap.
  const seenIntent = useRef(0);
  useEffect(() => { if (!intent || intent.n === seenIntent.current) return; seenIntent.current = intent.n; if (intent.svc) setSvc(intent.svc); if (intent.dest) pickDest(intent.dest); }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveDest = (label: 'home' | 'work') => { if (!dest) return; client.post('/users/me/places', { label, name: dest.name ?? `${dest.lat.toFixed(4)}, ${dest.lng.toFixed(4)}`, lat: dest.lat, lng: dest.lng }).then(() => { places.reloadSaved(); say(t('prof.saved')); }).catch(() => say(t('common.error'))); };
  const [wide, setWide] = useState(false); useEffect(() => { void kv.get('rm_wide').then((v) => setWide(v === '1')).catch(() => {}); }, []);
  const nearby = useNearbyCars(pickup, svc === 'ride' && consent === true, wide);
  const markers = [...(dest ? [{ lat: dest.lat, lng: dest.lng, label: dest.name, color: '#C0392B' } as Marker] : []), ...nearby.cars.map((c) => (c.n && c.n > 1 ? { lat: c.lat, lng: c.lng, bubble: c.n } : { lat: c.lat, lng: c.lng, icon: carIcon(c.type) }) as Marker)];
  const needsDest = svc === 'ride' || hire === 'p2p';
  const guestNeedsPick = svc === 'ride' && forOther && !pickupChosen;      // booking for someone else: the phone's own location is never assumed to be where the guest is
  const ready = !!pickup && !guestNeedsPick && (svc === 'ride' ? !!dest : !!carId && (hire !== 'p2p' || !!dest));
  const go = () => {
    if (!ready || !pickup) return;
    if (svc === 'abasare') nav.push('options', { pickup, request_code: reqCode ?? undefined, dest: hire === 'p2p' ? dest : undefined, note, scheduled_for: when ?? undefined, abasare: { customer_vehicle_id: carId, hours: hire === 'hourly' ? hours : undefined } });
    else nav.push('options', { pickup, request_code: reqCode ?? undefined, dest, note, scheduled_for: when ?? undefined, guest: forOther || undefined });
  };
  const resetPickupSource = () => { fromCode.current = false; setReqCode(null); };
  /** The person chose a pickup: a searched or saved place, a pin or a tap on the map, or their own location on purpose. */
  const choosePickup = (p: Place | Pt, src: 'place' | 'pin') => {
    resetPickupSource(); const name = (p as Place).name ?? places.nearest(p) ?? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
    setPickup({ lat: p.lat, lng: p.lng, name }); setPickupSrc(src); setPickupChosen(true); setAccuracy(null); setEditPickup(false); setTapPickup(false); setQ2(''); setResults2([]);
  };
  const useMyLocation = () => { resetPickupSource(); setPickupChosen(true); setEditPickup(false); setTapPickup(false); void locate(); };
  const toggleOther = () => {
    const on = !forOther; setForOther(on);
    if (on) { if (pickupSrc === 'gps') { setPickup(null); setPickupSrc(null); setPickupChosen(false); } setEditPickup(true); }
    else { setPickupChosen(true); if (!pickup) { resetPickupSource(); void locate(); } }
  };
  const farKm = (() => { const g = gpsAt.current; if (!g || !pickup || pickupSrc === 'gps' || forOther) return 0; const R = 6371, dLa = ((pickup.lat - g.lat) * Math.PI) / 180, dLo = ((pickup.lng - g.lng) * Math.PI) / 180; const a = Math.sin(dLa / 2) ** 2 + Math.cos((g.lat * Math.PI) / 180) * Math.cos((pickup.lat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); })();

  if (consent === null) return <Screen scroll={false}><View /></Screen>;
  if (consent === false) return (
    <Screen footer={<><Btn testID="cta" title={t('loc.allow')} onPress={async () => { await kv.set('rm_loc_consent', '1'); try { await client.post('/users/me/consents', { kind: 'location', version: 'v1', granted: true }); } catch { /* retried implicitly later */ } setConsent(true); }} big /><Btn kind="ghost" title={t('loc.skip')} onPress={() => { setSkipped(true); setConsent(true); }} /></>}>
      <View style={{ alignItems: 'center', marginTop: SP.lg }}><IconBadge glyph="📍" bg={C.skyBg} size={96} /></View>
      <Text accessibilityRole="header" style={[S.h1, { marginTop: SP.lg, textAlign: 'center' }]}>{t('loc.title')}</Text><Text style={[S.body, { marginTop: 12, textAlign: 'center' }]}>{t('loc.body')}</Text>
    </Screen>
  );

  return (
    <Screen
      title={t('book.title')}
      right={<LinkBtn title={t('home.help')} color={C.onHeader} onPress={() => nav.push('support')} />}
      onRefresh={async () => { active.reload(); await Promise.all([client.get('/bookings?role=passenger&limit=3').then((r) => setTrips(r.bookings)).catch(() => {}), new Promise((r) => setTimeout(r, 500))]); }}
      footer={<Btn testID="cta" big title={t('home.seeprices')} onPress={go} disabled={!ready} />}>
      {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
      {!requestsOn ? <Banner kind="bad" text={`${t('flag.requests.off')} ${requestsMsg ?? ''}`.trim()} /> : null}
      <CreditChip />
      {activeB ? (
        <Card style={{ borderColor: C.primary, borderWidth: 2 }}>
          <View style={S.between}><View style={{ flex: 1, paddingRight: SP.sm }}><Text style={S.h2}>{t('home.active')}</Text><Text style={S.muted}>{activeB.ref}</Text><View style={{ marginTop: 4 }}><StatusChip status={activeB.status} /></View></View><Btn title={t('home.resume')} onPress={() => nav.push('track', { id: activeB.id })} /></View>
        </Card>) : null}
            {loc.perm === 'blocked' || loc.perm === 'denied' ? <PermissionCard title={t('perm.loc.title')} body={loc.perm === 'blocked' ? t('perm.loc.blocked') : t('home.nolocation')} actionLabel={loc.perm === 'blocked' ? t('perm.settings') : t('loc.allow')} onAction={loc.perm === 'blocked' ? loc.openSettings : () => { resetPickupSource(); void locate(); }} /> : null}
      {loc.perm === 'off' ? <PermissionCard title={t('perm.gps.title')} body={t('perm.gps.body')} actionLabel={t('perm.settings')} onAction={loc.openSettings} /> : null}

      {mapOk ? <MapBox center={pickup ?? KIGALI} zoom={wide ? 10 : 14} pin={pickup} markers={markers} zones={places.zones} onPin={(lat, lng) => choosePickup({ lat, lng }, 'pin')} onTap={(lat, lng) => (tapPickup ? choosePickup({ lat, lng }, 'pin') : pickDest({ lat, lng }))} onStatus={setMapOk} height={mapH} />
        : <Banner text={t('home.map.off')} />}
      {svc === 'ride' && nearby.loaded ? (
        <View testID="nearby-line" accessibilityLiveRegion="polite" style={{ marginTop: 4 }}>
          <Text style={[S.muted, { color: nearby.count ? C.green : C.muted }]}>{nearby.count ? (wide ? t('nb.wide.count', { n: nearby.count }) : t(nearby.count === 1 ? 'nb.one' : 'nb.count', { n: nearby.count, m: nearby.etaMin ?? 1 })) : t('nb.none')}</Text>
          {nearby.count ? <Text style={[S.muted, { fontSize: 11 }]}>{wide ? t('nb.wide.hint') : t('nb.hint')}</Text> : null}
        </View>
      ) : null}
      {svc === 'ride' ? <View style={S.wrap}><Chip testID="wide-toggle" glyph="🗺️" text={t('nb.wide.chip')} on={wide} onPress={() => { const v = !wide; setWide(v); void kv.set('rm_wide', v ? '1' : '0').catch(() => {}); }} /></View> : null}
      <Text style={[S.muted, { marginVertical: 6 }]}>{t('home.adjust')}{accuracy && pickupSrc === 'gps' ? ` · ${t('home.gps.accuracy')} ±${Math.round(accuracy)} m` : ''}</Text>

      <ServiceCards svc={svc} setSvc={setSvc} abasareOn={abasareOn} onScan={() => nav.push('scan')} />

      {svc === 'abasare' ? <HowItWorks /> : null}
      {svc === 'abasare' ? <Card style={{ borderColor: C.gold, borderWidth: 2 }}>
        <Text style={S.h2}>{t('ab.home.title')}</Text><Text style={[S.muted, { marginBottom: 8 }]}>{t('ab.home.sub')}</Text>
        <Text style={S.muted}>{t('ab.mycar')}</Text>
        {cars.length ? <View style={[S.wrap, { marginVertical: 6 }]}>{cars.map((c) => <Chip key={c.id} text={`${c.plate} · ${c.make ?? ''} ${c.model ?? ''}`.trim()} on={carId === c.id} onPress={() => setCarId(c.id)} />)}</View> : <Banner text={t('ab.nocar')} />}
        <Btn kind="ghost" title={t('ab.addcar')} onPress={() => nav.push('cars')} />
        <View style={[S.wrap, { marginTop: 10 }]}><Chip text={t('ab.mode.home')} on={hire === 'p2p'} onPress={() => setHire('p2p')} /><Chip text={t('ab.mode.hourly')} on={hire === 'hourly'} onPress={() => setHire('hourly')} /></View>
        {hire === 'hourly' ? <><Text style={S.muted}>{t('ab.hours')}</Text><View style={[S.wrap, { marginTop: 6 }]}>{(cfg?.abasare?.packages ?? [2, 4, 8, 12]).map((h) => <Chip key={h} text={`${h} ${t('ab.h')}`} on={hours === h} onPress={() => setHours(h)} />)}</View><NumberStepper testID="hire-hours" label={t('pk.hours.custom')} value={hours} onChange={setHours} min={cfg?.abasare?.min_hours ?? 2} max={cfg?.abasare?.max_hours ?? 12} unit={t('ab.h')} /></> : null}
        <Text style={[S.muted, { marginTop: 4 }]}>{t('ab.night')}</Text>
      </Card> : null}

      <Card>
        <Text style={S.muted}>{t('home.pickup')}</Text>
        <Text testID="pickup-name" style={[S.bold, { marginBottom: 2 }]}>{loc.busy ? t('common.loading') : pickup ? pickup.name ?? `${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}` : t('home.nolocation')}</Text>
        {pickup && pickupSrc ? <Text style={[S.muted, { fontSize: 12, marginBottom: 6 }]}>{t(pickupSrc === 'gps' ? 'pu.src.gps' : pickupSrc === 'pin' ? 'pu.src.pin' : pickupSrc === 'venue' ? 'pu.src.venue' : 'pu.src.place')}</Text> : null}
        <View style={S.wrap}>
          <Chip testID="pickup-mine" glyph="📍" text={t('home.mylocation')} on={pickupSrc === 'gps' && pickupChosen} onPress={useMyLocation} />
          <Chip testID="pickup-edit" glyph="🔎" text={t('pu.search')} on={editPickup} onPress={() => { setEditPickup(!editPickup); setTapPickup(false); }} />
          <Chip testID="pickup-tap" glyph="🗺️" text={t('pu.map')} on={tapPickup} onPress={() => { setTapPickup(!tapPickup); setEditPickup(false); }} />
        </View>
        {tapPickup ? <Text style={[S.muted, { marginTop: 4 }]}>{t('pu.map.hint')}</Text> : null}
        {guestNeedsPick ? <Banner kind="warn" text={t('pu.guest.choose')} /> : null}
        {farKm > 1 ? <Banner text={t('pu.far', { km: farKm.toFixed(1) })} /> : null}
        {editPickup ? <View style={{ marginTop: 6 }}>
          <Field testID="pickup-q" value={q2} onChangeText={setQ2} placeholder={t('pu.search')} returnKeyType="search" autoCorrect={false} autoFocus />
          {q2.trim().length >= 2 && !results2.length ? <Text style={S.muted}>{t('home.noresults')}</Text> : null}
          {results2.map((r) => <Pressable key={(r.id ?? '') + r.name + r.lat} testID="pickup-result" onPress={() => choosePickup(r, 'place')} accessibilityRole="button" accessibilityLabel={t('a11y.chooseplace', { name: r.name })} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}><Text style={S.body}>📍  {r.name}</Text></Pressable>)}
          {!q2.trim() && (places.saved.length || places.recents.length) ? <View style={[S.wrap, { marginTop: 6 }]}>{places.saved.map((p, i) => <Chip key={'s' + i} glyph="⭐" text={p.name ?? ''} onPress={() => choosePickup(p, 'place')} />)}{places.recents.map((p, i) => <Chip key={'r' + i} glyph="🕘" text={p.name ?? ''} onPress={() => choosePickup(p, 'place')} />)}</View> : null}
        </View> : null}
        <View style={{ height: SP.sm }} />
        <Field value={note} onChangeText={setNote} placeholder={t('home.pickupnote')} maxLength={280} returnKeyType="done" />
        {needsDest ? <Text accessibilityRole="header" style={[S.h2, { marginBottom: 6 }]}>{t('home.where')}</Text> : null}
        {needsDest ? <Text style={S.muted}>{t('home.dest')}</Text> : null}
        {!needsDest ? null : dest
          ? <View style={S.between}><Text style={[S.bold, { flex: 1 }]}>{dest.name}</Text><Pressable onPress={() => setDest(null)} accessibilityRole="button" accessibilityLabel={t('a11y.clear')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.danger }}>✕</Text></Pressable></View>
          : <Field value={q} onChangeText={setQ} placeholder={t('home.search')} returnKeyType="search" autoCorrect={false} />}
        {needsDest && searching ? <Text style={S.muted}>{t('common.loading')}</Text> : null}
        {needsDest && !searching && q.trim().length >= 2 && !results.length ? <Text style={S.muted}>{t('home.noresults')}</Text> : null}
        {needsDest ? results.map((r) => <Pressable key={(r.id ?? '') + r.name + r.lat} onPress={() => pickDest(r)} accessibilityRole="button" accessibilityLabel={t('a11y.chooseplace', { name: r.name })} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}><Text style={S.body}>📍  {r.name}</Text></Pressable>) : null}
        {needsDest && dest && !places.saved.some((p) => p.name === dest.name) ? <View style={[S.wrap, { marginTop: SP.sm }]}><Chip glyph="🏠" text={`${t('prof.places.saveHere')} ${t('prof.places.home')}`} onPress={() => saveDest('home')} /><Chip glyph="💼" text={`${t('prof.places.saveHere')} ${t('prof.places.work')}`} onPress={() => saveDest('work')} /></View> : null}
      </Card>

      {svc === 'ride' ? <View style={S.wrap}><Chip glyph="👥" text={t('r2.guest.home')} on={forOther} onPress={toggleOther} /></View> : null}
      <SectionTitle text={t('opt.when')} />
      <View style={S.wrap}>
        <Chip text={t('home.now')} on={!when} onPress={() => setWhen(null)} />
        <Chip testID="when-pick" text={t('pk.datetime')} on={custom} onPress={() => { setCustom(true); if (!when) setWhen(new Date(Date.now() + (lead + 10) * 60000).toISOString()); }} />
        {[30, 60, 180].map((m) => <Chip key={m} text={`${t('opt.plus')} ${m >= 60 ? m / 60 + ' h' : m + ' ' + t('common.min')}`} on={!!when && Math.abs(new Date(when).getTime() - (Date.now() + m * 60000)) < 60000} onPress={() => setWhen(new Date(Date.now() + m * 60000 + 30000).toISOString())} />)}
      </View>
      {custom ? <View style={{ gap: SP.sm }}>
        <DateTimeField testID="when" value={when} onChange={setWhen} min={new Date(Date.now() + lead * 60000)} max={new Date(Date.now() + days * 86400000)} error={when && !instantAllowed(when, lead, days) ? t('pk.sched.bad') : undefined} />
        <Text style={S.muted}>{t('pk.sched.lead', { n: lead, d: days })}</Text>
      </View> : null}
      {needsDest && !dest ? <>
        <SavedShortcuts saved={places.saved} onPick={pickDest} />
        {places.recents.length ? <><SectionTitle text={t('home.recent')} /><View style={S.wrap}>{places.recents.map((p, i) => <Chip key={i} glyph="🕘" text={p.name ?? ''} onPress={() => pickDest(p)} />)}</View></> : null}
        <RecentTrips trips={trips} onAgain={pickDest} />
        {places.popular.length ? <><SectionTitle text={t('home.popular')} /><View style={S.wrap}>{places.popular.map((p) => <Chip key={p.id ?? p.name} text={p.name} onPress={() => pickDest(p)} />)}</View></> : null}
      </> : null}
      
    </Screen>
  );
}

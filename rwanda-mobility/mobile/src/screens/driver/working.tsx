import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync, usePoll } from '../../lib/app';
import { DICTS, label, type TKey } from '../../lib/i18n';
import { useLocate } from '../../lib/hooks';
import { setDriverTracking, useDriverTracking, consentKeyFor } from '../../lib/driverTracking';
import { bgSupported } from '../../lib/bgLocation';
import { kv } from '../../lib/storage';
import type { Booking, DriverStatus, Offer } from '../../lib/types';
import { Banner, Btn, Card, Chip, EmptyState, LinkBtn, PermissionCard, Screen, Spinner, Text, useProportionalHeight } from '../../ui/components';
import { MapBox } from '../../ui/MapView';
import { C, S, SP } from '../../ui/theme';
import { SosButton } from '../sos';
import { ActiveTrip } from './activeTrip';
import { OfferCard } from './offer';
import { QuestsCard } from '../growth/quests';
import { driverToday } from '../../lib/stats';
import { fmtRwf } from '../../lib/format';
import { useTripFeed } from '../../lib/tripFeed';
import { StatRow, StatTile } from '../../ui/dash';
import { leaveDriverMode } from './leave';
import { driverKind, jobTypes } from '../../lib/driverKind';
import { CategoryCard } from './kindUi';
import { GoalCard, StatusStrip } from './workTools';

const GPS_STALE_MS = 45_000;

/** Approved driver: online/offline, accepting modes, offers, the active job and earnings. Location sharing itself lives in DriverTracker (survives navigation). */
export function Working({ status, reload }: { status: DriverStatus; reload: () => void }) {
  const { t, lang, client, setMode, nav, online, say } = useApp(); const feed = useTripFeed(); const { busy, run } = useAsync(); const loc = useLocate(); const tr = useDriverTracking();
  const [isOnline, setIsOnline] = useState<boolean>(!!status.profile.is_online); const [consent, setConsent] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const absPerm = status.abasare?.permission; const rideOk = !!status.permission?.can_work; const absOk = !!absPerm?.can_work;
  const [accepting, setAccepting] = useState<string[]>(() => (status.profile.accepting ?? ['ride']).filter((x) => (x === 'ride' ? rideOk : absOk)));
  const mapH = useProportionalHeight(0.2, 150, 240);
  useEffect(() => { setIsOnline(!!status.profile.is_online); }, [status.profile.is_online]);
  useEffect(() => { kv.get(consentKeyFor()).then((v) => setConsent(v === '1')).catch(() => {}); }, []);
  useEffect(() => { if (tr.forbiddenAt) reload(); }, [tr.forbiddenAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const i = setInterval(() => setTick(Date.now()), 10000); return () => clearInterval(i); }, []);

  const active = usePoll(() => client.get<{ booking: Booking | null }>('/bookings/active?role=driver'), 3000, [isOnline]);
  const trip = active.data?.booking ?? null;
  const offers = usePoll(() => client.get<{ offers: Offer[] }>('/drivers/me/offers'), 3000, [isOnline], isOnline && !trip);
  useEffect(() => { setDriverTracking({ online: isOnline, onTrip: !!trip }); }, [isOnline, trip]);

  const toggle = (on: boolean) => run(async () => {
    if (on && !consent) return;
    if (on && !(await loc.ensure())) return;   // never go online without a location source: the card below explains how to fix it
    try { await client.patch('/drivers/me/availability', on ? { online: true, accepting: accepting.length ? accepting : [rideOk ? 'ride' : 'abasare'] } : { online: false }); setIsOnline(on); reload(); }
    catch (e) { if ((e as { code?: string })?.code === 'not_permitted_to_work') { say(t('drv.notallowed')); reload(); } else throw e; }
  });
  const reasonText = (r: string) => { const k = `rs.${r}`; return k in DICTS[lang] ? t(k as TKey) : t('rs.other'); };
  const blockedText = () => {
    const ps = [(status.vehicle || status.abasare?.status === 'none') ? status.permission : null, status.abasare?.status !== 'none' ? absPerm : null].filter(Boolean) as NonNullable<DriverStatus['permission']>[];
    const reasons = [...new Set(ps.flatMap((p) => p.reasons ?? []))].map(reasonText);
    const docs = [...new Set(ps.flatMap((p) => [...(p.expired_documents ?? []), ...(p.missing_documents ?? [])]))].map((d) => label(lang, 'doc', d));
    return `${t('drv.notallowed')}: ${[...reasons, ...docs].join(' · ')}`;
  };
  const today = useMemo(() => driverToday(feed.trips ?? []), [feed.trips]);
  const gpsLost = isOnline && tr.lastFixAt > 0 && tick - tr.lastFixAt > GPS_STALE_MS;
  const expiring = status.documents.filter((d) => d.expiry_date && new Date(d.expiry_date).getTime() - Date.now() < 30 * 86400000 && d.review_status === 'approved');
  const both = (rideOk && absOk) || absOk;
  const flip = (id: 'ride' | 'abasare') => setAccepting((a) => (a.includes(id) ? (a.length > 1 ? a.filter((x) => x !== id) : a) : [...a, id]));

  return (
    <Screen title={t('drv.mode')} right={trip ? <SosButton bookingId={trip.id} /> : <LinkBtn title={t('home.help')} color={C.onHeader} onPress={() => nav.push('support')} />}
      onRefresh={async () => { reload(); active.reload(); offers.reload(); await new Promise((r) => setTimeout(r, 500)); }}>
      {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
      <>
        <StatusStrip online={isOnline} />
        <Card>
          <View style={S.between}><View style={{ flex: 1, paddingRight: SP.sm }}><Text style={S.h2}>{isOnline ? t('drv.online') : t('drv.offline')}</Text><Text style={S.muted}>★ {Number(status.profile.rating_avg).toFixed(1)} · {status.profile.completed_count} {t('drv.trips')}</Text></View>
            <Btn testID="cta" kind={isOnline ? 'danger' : 'primary'} title={isOnline ? t('drv.gooffline') : t('drv.goonline')} onPress={() => toggle(!isOnline)} loading={busy} disabled={(!rideOk && !absOk && !isOnline) || (!isOnline && !consent)} /></View>
          {both ? <View style={{ marginTop: 10 }}><Text style={S.muted}>{t('ab.accepting')}</Text><View style={[S.wrap, { marginTop: 6 }]}>
            {rideOk ? <Chip glyph="🛵" text={t('ab.accepting.ride')} on={accepting.includes('ride')} onPress={() => flip('ride')} /> : null}
            {absOk ? <Chip glyph="🧑‍✈️" text={t('ab.accepting.abasare')} on={accepting.includes('abasare')} onPress={() => flip('abasare')} /> : null}</View></View> : null}
          {!rideOk && !absOk ? <View style={{ marginTop: SP.md }}><Banner kind="bad" text={blockedText()} /></View> : null}
        </Card>
        <CategoryCard kind={driverKind(status)} jobs={jobTypes({ ridePermitted: rideOk, abasarePermitted: absOk })} onGuide={() => nav.push('driverGuide', { kind: driverKind(status) === 'abasare' ? 'abasare' : 'own' })} />
        <StatRow>
          <StatTile testID="dh-trips" glyph="🧾" value={String(today.trips)} label={`${t('dh.today')} · ${t('dh.stat.trips')}`} />
          <StatTile testID="dh-earned" glyph="💰" value={fmtRwf(today.net || today.fares)} unit="RWF" label={`${t('dh.today')} · ${t('dh.stat.earned')}`} tint={C.warnBg} />
          <StatTile testID="dh-rating" glyph="⭐" value={Number(status.profile.rating_avg) > 0 ? Number(status.profile.rating_avg).toFixed(1) : '—'} label={t('dh.stat.rating')} tint={C.goldBg} />
        </StatRow>
        {rideOk || absOk ? <GoalCard earned={today.net || today.fares} /> : null}
        <Btn testID="claims-about-me" kind="ghost" title={t('cl.title.about')} onPress={() => nav.push('claims')} />
        {rideOk || absOk ? <Btn testID="r1-feedback-open" kind="ghost" title={t('r1.fb.open')} onPress={() => nav.push('r1feedback')} /> : null}
        {rideOk || absOk ? <QuestsCard onOpen={() => nav.push('quests')} /> : null}
        {isOnline && rideOk ? <Btn testID="r2-heat-open" kind="ghost" title={t('r2.heat.entry')} onPress={() => nav.push('heatmap')} /> : null}
        {loc.perm === 'blocked' || loc.perm === 'denied' ? <PermissionCard title={t('perm.loc.title')} body={t('perm.loc.driver')} actionLabel={loc.perm === 'blocked' ? t('perm.settings') : t('loc.allow')} onAction={loc.perm === 'blocked' ? loc.openSettings : () => void loc.request()} /> : null}
        {loc.perm === 'off' ? <PermissionCard title={t('perm.gps.title')} body={t('perm.gps.body')} actionLabel={t('perm.settings')} onAction={loc.openSettings} /> : null}
        {tr.bgDenied ? <Banner text={t('drv.bg.denied')} action={<Btn kind="ghost" title={t('perm.settings')} onPress={loc.openSettings} />} /> : null}
        {gpsLost ? <Banner kind="bad" text={t('drv.gps.lost')} /> : null}
        {!consent && (rideOk || absOk) ? <Card><Text accessibilityRole="header" style={S.h2}>{t('drv.location.title')}</Text><Text style={[S.body, { marginVertical: 8 }]}>{t('drv.location.body')}</Text>
          {bgSupported ? <><Text accessibilityRole="header" style={[S.h2, { fontSize: 16 }]}>{t('drv.bg.title')}</Text><Text style={[S.body, { marginVertical: 8 }]}>{t('drv.bg.body')}</Text></> : null}
          <Btn title={t('drv.agree')} onPress={async () => { await kv.set(consentKeyFor(), '1'); try { await client.post('/users/me/consents', { kind: 'background_location', version: bgSupported ? 'v2' : 'v1', granted: true }); } catch { /* recorded locally; retried on the next agreement */ } setConsent(true); }} /></Card> : null}
        {expiring.map((d) => <Banner key={d.id} text={`${t('drv.docs.expiring')}: ${label(lang, 'doc', d.doc_type)} (${String(d.expiry_date).slice(0, 10)})`} />)}
        {trip ? <ActiveTrip trip={trip} pos={tr.pos} reload={active.reload} mapHeight={mapH} /> : isOnline ? <>
          {tr.pos ? <MapBox center={tr.pos} markers={[{ ...tr.pos, label: '', color: '#1A5FB4' }]} height={mapH} zoom={14} /> : <Banner text={t('drv.gps.wait')} />}
          <Text accessibilityRole="header" style={[S.h2, { marginVertical: 10 }]}>{t('drv.offers')}</Text>
          {!offers.data ? <Spinner /> : offers.data.offers.length ? offers.data.offers.map((o) => <OfferCard key={o.booking_id} o={o} done={() => { offers.reload(); active.reload(); }} />) : <EmptyState glyph="🕐" title={t('drv.nooffers.title')} body={t('drv.nooffers')} />}
        </> : null}
        <Text style={[S.muted, { textAlign: 'center', marginTop: 12 }]}>{t('drv.safety.stationary')}</Text>
        <Btn testID="dh-switch" kind="ghost" title={t('dh.switch')} onPress={() => void leaveDriverMode({ client, setMode, say, t })} />
      </>
    </Screen>
  );
}

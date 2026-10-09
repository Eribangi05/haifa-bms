import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp, usePoll } from '../lib/app';
import { label } from '../lib/i18n';
import { fmtRwf, fmtTime, groupByDay } from '../lib/format';
import { filterTrips, tripStats, type TripFilter } from '../lib/stats';
import { jobKind } from '../lib/driverKind';
import { useTripFeed } from '../lib/tripFeed';
import { statusGlyph, statusTone } from '../lib/trip';
import type { Booking } from '../lib/types';
import { Banner, Btn, Card, Chip, EmptyState, IconBadge, Money, Pill, Screen, SkeletonCard, Text } from '../ui/components';
import { StatRow, StatTile } from '../ui/dash';
import { C, S, SP } from '../ui/theme';
import { HistoryExtras } from './r3/receiptLines';
import { KindPill } from './driver/kindUi';

/** Trips grouped by day (Today / Yesterday / date), each with a status icon and chip. `driver` rows show the fare the driver collected. */
export function TripRows({ bookings, driver }: { bookings: Booking[]; driver?: boolean }) {
  const { t, lang, nav } = useApp();
  const groups = useMemo(() => groupByDay(bookings, (b) => b.requested_at), [bookings]);
  return <>{groups.map((g) => (
    <View key={g.key} style={{ marginBottom: SP.sm }}>
      <Text accessibilityRole="header" style={[S.muted, { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.sm, marginTop: SP.xs }]}>{g.kind === 'today' ? t('common.today') : g.kind === 'yesterday' ? t('common.yesterday') : g.date}</Text>
      {g.items.map((b) => {
        const tone = statusTone(b.status);
        return (
          <Pressable key={b.id} accessibilityRole="button" accessibilityLabel={`${b.pickup.name ?? ''} → ${b.destination.name ?? ''}, ${label(lang, 'bs', b.status)}`} onPress={() => nav.push('track', { id: b.id })} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
            <Card style={{ marginBottom: SP.sm }}>
              <View style={[S.row, { gap: SP.md, alignItems: 'flex-start' }]}>
                <IconBadge glyph={statusGlyph(b.status)} bg={tone === 'bad' ? C.dangerBg : tone === 'ok' ? C.okBg : C.warnBg} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={S.bold} numberOfLines={2}>{b.pickup.name ?? '…'} → {b.destination.name ?? '…'}</Text>
                  <Text style={S.muted}>{fmtTime(b.requested_at)} · {b.ref}{b.guest?.name && !b.guest.purged ? ` · ${t('r2.guest.hist', { name: b.guest.name })}` : ''}</Text>
                  <View style={{ marginTop: SP.xs + 2, flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs + 2 }}><Pill tone={tone} text={label(lang, 'bs', b.status)} />{driver ? <KindPill job={jobKind(b)} /> : null}</View>
                  {driver && b.estimated_driver_net ? <Text style={[S.muted, { marginTop: 4 }]}>{t('dt.net', { n: fmtRwf(b.estimated_driver_net) })}</Text> : null}
                  {driver ? null : <HistoryExtras b={b} />}
                </View>
                <Money n={b.final_fare ?? b.estimated_fare} style={{ fontWeight: '700', color: C.ink }} />
              </View>
            </Card>
          </Pressable>
        );
      })}
    </View>
  ))}</>;
}

/** Summary strip + filter chips + the list; shared by the rider and driver Trips tabs. */
export function TripsPanel({ driver, onBook }: { driver?: boolean; onBook?: () => void }) {
  const { t, errMsg } = useApp(); const feed = useTripFeed(); const [f, setF] = useState<TripFilter>('all'); const [jt, setJt] = useState<'all' | 'ride' | 'abasare'>('all');
  const all = feed.trips; const stats = useMemo(() => tripStats(all ?? []), [all]);
  const shown = useMemo(() => filterTrips(all ?? [], f).filter((b) => !driver || jt === 'all' || jobKind(b) === jt), [all, f, jt, driver]);
  const hasAb = useMemo(() => (all ?? []).some((b) => jobKind(b) === 'abasare'), [all]);
  return <>
    {feed.error && !all ? <Banner kind="bad" text={errMsg(feed.error)} action={<Btn kind="ghost" title={t('common.retry')} onPress={feed.reload} />} /> : null}
    {!all && !feed.error ? <><SkeletonCard /><SkeletonCard /><SkeletonCard /></> : null}
    {all && all.length > 0 ? <>
      <StatRow>
        <StatTile glyph="🧾" value={String(stats.trips)} label={t('ov.stat.trips')} />
        <StatTile glyph="🛣️" value={String(stats.km)} label={t('ov.stat.km')} tint={C.okBg} />
        <StatTile glyph="💵" value={fmtRwf(stats.spent)} unit="RWF" label={driver ? t('drv.fares') : t('ov.stat.spent')} tint={C.warnBg} />
      </StatRow>
      {driver && hasAb ? <View style={S.wrap}>{(['all', 'ride', 'abasare'] as const).map((k) => <Chip key={k} glyph={k === 'ride' ? '🛵' : k === 'abasare' ? '🧑‍✈️' : undefined} text={t(`dt.f.${k}` as 'dt.f.all')} on={jt === k} onPress={() => setJt(k)} />)}</View> : null}
      <View style={S.wrap}>{(['all', 'done', 'upcoming', 'cancelled'] as const).map((k) => <Chip key={k} text={t(`trips.f.${k}` as 'trips.f.all')} on={f === k} onPress={() => setF(k)} />)}</View>
    </> : null}
    {all && all.length === 0 ? <EmptyState glyph="🧾" title={driver ? t('dt.empty.title') : t('hist.empty.title')} body={driver ? t('dt.empty') : t('hist.empty')} action={!driver && onBook ? <Btn title={t('home.where')} onPress={onBook} /> : undefined} /> : null}
    {all && all.length > 0 && shown.length === 0 ? <Card><Text style={[S.muted, { textAlign: 'center' }]}>{t('trips.empty.filter')}</Text></Card> : null}
    <TripRows bookings={shown} driver={driver} />
    {all && all.length >= 50 ? <Text style={[S.muted, { textAlign: 'center', marginTop: SP.sm }]}>{t('trips.latest')}</Text> : null}
  </>;
}

/** Rider Trips tab. */
export function TripsTab({ onBook }: { onBook: () => void }) {
  const { t } = useApp(); const feed = useTripFeed();
  return <Screen title={t('trips.title')} onRefresh={async () => { feed.reload(); await new Promise((r) => setTimeout(r, 600)); }}><TripsPanel onBook={onBook} /></Screen>;
}

/** Stand-alone "My trips" (opened from a notification or another screen): same list with a back button. */
export function History() {
  const { t, client, nav, goTab } = useApp();
  const list = usePoll(() => client.get<{ bookings: Booking[] }>('/bookings?role=passenger&limit=50'), 15000);
  return (
    <Screen title={t('hist.title')} onBack={() => nav.pop()} onRefresh={async () => { list.reload(); await new Promise((r) => setTimeout(r, 600)); }}>
      {!list.data && !list.error ? <SkeletonCard /> : null}
      {list.data && list.data.bookings.length === 0 ? <EmptyState glyph="🧾" title={t('hist.empty.title')} body={t('hist.empty')} action={<Btn title={t('home.where')} onPress={() => goTab('book')} />} /> : null}
      {list.data ? <TripRows bookings={list.data.bookings} /> : null}
    </Screen>
  );
}

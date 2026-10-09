import React, { useMemo } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useApp } from '../../lib/app';
import { fmtRwf } from '../../lib/format';
import { dayPart, tripStats } from '../../lib/stats';
import { useTripFeed } from '../../lib/tripFeed';
import type { Booking, Place, Pt } from '../../lib/types';
import { Banner, Btn, Card, Chip, FadeIn, IconBadge, Screen, SectionTitle, SkeletonCard, Text } from '../../ui/components';
import { Hero, QuickAction, QuickGrid, StatRow, StatTile } from '../../ui/dash';
import { C, FS, R, S, SP } from '../../ui/theme';
import { usePlaces } from '../passenger/usePlaces';
import { PromoBanner, RecentTrips, StatusChip } from '../passenger/homeParts';
import { useWallet } from '../r3/credit';
import { useBecomeDriver } from './account';

/** Rider "Home" tab: greeting and one-tap booking, live trip, quick actions, personal statistics, safety and trending places. */
export function Overview({ active, onBook, refCode }: { active: Booking | null; onBook: (dest?: Place | Pt, svc?: 'ride' | 'abasare') => void; refCode?: string }) {
  const { t, nav, me, online, cfg, setMode, setTab } = useApp(); const become = useBecomeDriver(); const feed = useTripFeed(); const places = usePlaces(); const { wallet } = useWallet();
  const name = (me?.display_name ?? '').trim().split(/\s+/)[0];
  const stats = useMemo(() => tripStats(feed.trips ?? []), [feed.trips]);
  const abasareOn = !!cfg?.abasare?.enabled; const tip = useMemo(() => 1 + (new Date().getDate() % 3), []);
  const nums = cfg?.emergency_numbers ?? { police: '112', ambulance: '912' };
  const isDriver = !!me?.roles.includes('driver');
  const call = (n: string) => { void Linking.openURL(`tel:${n}`).catch(() => {}); };
  const recent: Booking[] = (feed.trips ?? []).slice(0, 3);
  return (
    <Screen onRefresh={async () => { feed.reload(); await new Promise((r) => setTimeout(r, 500)); }}>
      {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
      <FadeIn>
        <Hero testID="ov-hero">
          <Text style={{ color: C.onPrimary, opacity: 0.9, fontSize: FS.md }}>{t(`ov.greet.${dayPart()}` as 'ov.greet.morning')}{name ? `,` : ''}</Text>
          {name ? <Text accessibilityRole="header" style={{ color: C.onPrimary, fontSize: FS.hero - 6, fontWeight: '800', marginBottom: 2 }}>{name}</Text> : null}
          <Text style={{ color: C.onPrimary, opacity: 0.9, marginBottom: SP.md }}>{t('ov.hero.sub')}</Text>
          <Pressable testID="ov-where" onPress={() => onBook()} accessibilityRole="button" accessibilityLabel={`${t('ov.where')}. ${t('ov.where.hint')}`}
            style={({ pressed }) => ({ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: SP.md, opacity: pressed ? 0.85 : 1 })}>
            <Text accessible={false} style={{ fontSize: 20 }}>🔍</Text>
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '800', fontSize: FS.lg - 1 }}>{t('ov.where')}</Text><Text style={S.muted} numberOfLines={1}>{t('ov.where.hint')}</Text></View>
            <Text accessible={false} style={{ color: C.primary, fontSize: 24 }}>›</Text>
          </Pressable>
        </Hero>
      </FadeIn>

      {active ? (
        <Card style={{ borderColor: C.primary, borderWidth: 2 }}>
          <View style={S.between}>
            <View style={{ flex: 1, paddingRight: SP.sm }}><Text style={S.h2}>{t('home.active')}</Text><Text style={S.muted} numberOfLines={1}>{active.destination?.name ?? active.ref}</Text><View style={{ marginTop: 4 }}><StatusChip status={active.status} /></View></View>
            <Btn testID="ov-open-trip" title={t('ov.active.open')} onPress={() => nav.push('track', { id: active.id })} />
          </View>
        </Card>) : null}

      <SectionTitle text={t('ov.quick')} />
      <QuickGrid>
        <QuickAction testID="qa-ride" glyph="🛵" label={t('ov.qa.ride')} onPress={() => onBook(undefined, 'ride')} />
        {abasareOn ? <QuickAction testID="qa-abasare" glyph="🧑‍✈️" label={t('ov.qa.abasare')} tint={C.warnBg} onPress={() => onBook(undefined, 'abasare')} /> : null}
        <QuickAction testID="qa-scan" glyph="▦" label={t('ov.qa.scan')} onPress={() => nav.push('scan')} />
        <QuickAction testID="qa-schedule" glyph="⏰" label={t('ov.qa.schedule')} tint={C.okBg} onPress={() => nav.push('schedules')} />
        <QuickAction testID="qa-places" glyph="📍" label={t('ov.qa.places')} tint={C.okBg} onPress={() => nav.push('profile')} />
        <QuickAction testID="qa-help" glyph="💬" label={t('ov.qa.help')} tint={C.warnBg} onPress={() => nav.push('support')} />
      </QuickGrid>

      <SectionTitle text={t('ov.stats')} />
      {feed.trips === null && !feed.error ? <SkeletonCard /> : stats.trips === 0 ? (
        <Card><View style={[S.row, { gap: SP.md }]}><IconBadge glyph="📊" size={44} /><Text style={[S.muted, { flex: 1 }]}>{t('ov.stats.empty')}</Text></View></Card>
      ) : <>
        <StatRow>
          <StatTile testID="stat-trips" glyph="🧾" value={String(stats.trips)} label={t('ov.stat.trips')} />
          <StatTile testID="stat-km" glyph="🛣️" value={String(stats.km)} label={t('ov.stat.km')} tint={C.okBg} />
        </StatRow>
        <StatRow>
          <StatTile testID="stat-spent" glyph="💵" value={fmtRwf(stats.spent)} unit="RWF" label={t('ov.stat.spent')} tint={C.warnBg} />
          <StatTile testID="stat-credit" glyph="💳" value={wallet ? fmtRwf(wallet.available) : '-'} unit="RWF" label={t('ov.stat.credit')} tint={C.goldBg} />
        </StatRow>
        <Text style={[S.muted, { marginBottom: SP.md }]}>{t('ov.stats.note')}</Text>
      </>}

      <PromoBanner code={refCode} onOpen={() => setTab('account')} />

      <SectionTitle text={t('ov.safety.title')} />
      <Card style={{ borderLeftWidth: 4, borderLeftColor: C.danger }}>
        <Text style={S.muted}>{t('ov.safety.body')}</Text>
        <View style={[S.wrap, { marginTop: SP.sm }]}>
          <Chip glyph="👥" text={t('ov.safety.contacts')} onPress={() => nav.push('profile')} />
          <Chip glyph="🚓" text={t('ov.safety.police', { n: nums.police })} onPress={() => call(nums.police)} />
          <Chip glyph="🚑" text={t('ov.safety.ambulance', { n: nums.ambulance })} onPress={() => call(nums.ambulance)} />
        </View>
      </Card>

      {places.popular.length ? <>
        <SectionTitle text={t('ov.trending')} />
        <Text style={[S.muted, { marginBottom: SP.sm }]}>{t('ov.trending.sub')}</Text>
        <View style={S.wrap}>{places.popular.slice(0, 8).map((p) => <Chip key={p.id ?? p.name} glyph="🔥" text={p.name} onPress={() => onBook(p)} />)}</View>
      </> : null}

      {recent.length ? <>
        <SectionTitle text={t('ov.recent')} right={<Pressable onPress={() => setTab('trips')} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: C.primary, fontWeight: '700' }}>{t('ov.seeall')}</Text></Pressable>} />
        <RecentTrips trips={recent} onAgain={(p) => onBook(p)} />
      </> : null}

      {!isDriver ? (
        <Card style={{ backgroundColor: C.goldBg, borderColor: C.gold }}>
          <View style={[S.row, { gap: SP.md, alignItems: 'flex-start' }]}>
            <IconBadge glyph="🚗" bg={C.gold} size={44} />
            <View style={{ flex: 1 }}><Text style={S.h2}>{t('ov.drive.title')}</Text><Text style={S.muted}>{t('ov.drive.body')}</Text></View>
          </View>
          <View style={{ height: SP.sm }} /><Btn testID="ov-drive" kind="gold" title={t('ov.drive.cta')} onPress={become.go} loading={become.busy} />
        </Card>
      ) : <Btn testID="ov-drive-switch" kind="ghost" title={t('ov.drive.switch')} onPress={() => setMode('driver')} />}

      <Card>
        <View style={[S.row, { gap: SP.md, alignItems: 'flex-start' }]}><IconBadge glyph="💡" bg={C.warnBg} size={40} /><View style={{ flex: 1 }}><Text style={S.bold}>{t('ov.tip.title')}</Text><Text style={S.muted}>{t(`ov.tip.${tip}` as 'ov.tip.1')}</Text></View></View>
      </Card>
    </Screen>
  );
}

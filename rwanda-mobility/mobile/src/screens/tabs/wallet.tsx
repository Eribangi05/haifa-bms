import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp } from '../../lib/app';
import { fmtDate, fmtRwf } from '../../lib/format';
import { byMonth, isDone, tripStats } from '../../lib/stats';
import { useTripFeed } from '../../lib/tripFeed';
import { Banner, Btn, Card, EmptyState, IconBadge, Money, Screen, SectionTitle, SkeletonCard, Text } from '../../ui/components';
import { Hero, MenuGroup, MenuRow, StatRow, StatTile } from '../../ui/dash';
import { C, FS, S, SP } from '../../ui/theme';
import { useWallet } from '../r3/credit';

const methodGlyph = (m?: string) => (m?.startsWith('wallet') ? '💳' : m === 'mtn_momo' ? '📱' : '💵');
const methodKey = (m?: string) => (m?.startsWith('wallet') ? 'wal.mix.credit' : m === 'mtn_momo' ? 'wal.mix.momo' : m === 'cash' ? 'wal.mix.cash' : 'wal.mix.other') as 'wal.mix.cash';

/** Rider "Wallet" tab: credit balance, what you owe, spending totals and payment mix, month by month, and the payment history. All figures come from the user's own trips and wallet. */
export function WalletTab() {
  const { t, client, nav, online } = useApp(); const feed = useTripFeed(); const { wallet } = useWallet(); const [owed, setOwed] = useState(0);
  useEffect(() => { client.get<{ total: number }>('/users/me/debts').then((r) => setOwed(r.total ?? 0)).catch(() => {}); }, [client]);
  const trips = feed.trips ?? []; const stats = useMemo(() => tripStats(trips), [trips]); const months = useMemo(() => byMonth(trips, 6), [trips]);
  const done = useMemo(() => trips.filter((b) => isDone(b.status)).slice(0, 15), [trips]);
  const nowKey = (() => { const d = new Date(Date.now() + 2 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  const thisMonth = months.find((m) => m.key === nowKey);
  const mix = [{ k: 'wal.mix.cash', v: stats.cash, c: C.green }, { k: 'wal.mix.momo', v: stats.momo, c: C.gold }, { k: 'wal.mix.credit', v: stats.credit, c: C.sky }, { k: 'wal.mix.other', v: stats.other, c: C.muted }] as const;
  const total = Math.max(1, stats.spent);
  return (
    <Screen title={t('wal.title')} onRefresh={async () => { feed.reload(); await new Promise((r) => setTimeout(r, 600)); }}>
      {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
      <Hero testID="wal-hero">
        <Text style={{ color: C.onPrimary, opacity: 0.9 }}>{t('wal.credit')}</Text>
        <Text testID="wal-balance" style={{ color: C.onPrimary, fontSize: FS.hero, fontWeight: '800' }}>{wallet ? fmtRwf(wallet.available) : '—'} <Text style={{ fontSize: FS.lg, fontWeight: '700', color: C.onPrimary }}>RWF</Text></Text>
        {wallet && wallet.reserved > 0 ? <Text style={{ color: C.onPrimary, opacity: 0.9 }}>{t('cr.reserved', { n: fmtRwf(wallet.reserved) })}</Text> : null}
        <View style={{ height: SP.md }} /><Btn testID="wal-credit-open" kind="gold" title={t('wal.credit.open')} onPress={() => nav.push('credit')} />
      </Hero>
      {owed > 0 ? <Banner kind="bad" text={`${t('wal.debt.title')}: ${t('wal.debt.body', { n: fmtRwf(owed) })}`} /> : null}

      <SectionTitle text={t('wal.spend')} />
      {feed.trips === null && !feed.error ? <SkeletonCard /> : <>
        <StatRow>
          <StatTile testID="wal-month" glyph="📅" value={fmtRwf(thisMonth?.spent ?? 0)} unit="RWF" label={t('wal.spend.month')} />
          <StatTile glyph="🧾" value={fmtRwf(stats.spent)} unit="RWF" label={t('wal.spend.all')} tint={C.warnBg} />
          <StatTile glyph="📏" value={fmtRwf(stats.avgFare)} unit="RWF" label={t('wal.avg')} tint={C.okBg} />
        </StatRow>
        {stats.spent > 0 ? <Card>
          <Text style={S.bold}>{t('wal.mix')}</Text>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: C.line, marginVertical: SP.sm }}>
            {mix.filter((m) => m.v > 0).map((m) => <View key={m.k} style={{ flex: m.v / total, backgroundColor: m.c }} />)}
          </View>
          {mix.filter((m) => m.v > 0).map((m) => <View key={m.k} style={[S.between, { minHeight: 30 }]}><View style={S.row}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.c, marginRight: SP.sm }} /><Text style={S.body}>{t(m.k)}</Text></View><Text style={S.body}>{fmtRwf(m.v)} RWF · {Math.round((m.v / total) * 100)}%</Text></View>)}
        </Card> : null}
        {months.length ? <>
          <SectionTitle text={t('wal.months')} />
          <Card>{months.map((m, i) => (
            <View key={m.key} style={[S.between, { minHeight: 48, borderBottomWidth: i === months.length - 1 ? 0 : 1, borderBottomColor: C.line }]}>
              <View><Text style={S.bold}>{t(`mo.${m.month}` as 'mo.1')} {m.year}</Text><Text style={S.muted}>{t('wal.month.trips', { n: m.trips })}</Text></View>
              <Money n={m.spent} style={{ fontWeight: '800', color: C.ink }} />
            </View>))}</Card>
        </> : null}
      </>}

      <SectionTitle text={t('wal.history')} />
      {feed.trips !== null && done.length === 0 ? <EmptyState glyph="🧾" title={t('wal.history.empty.title')} body={t('wal.history.empty')} /> : null}
      {done.length ? <Card style={{ paddingVertical: SP.xs }}>{done.map((b, i) => (
        <Pressable key={b.id} testID="wal-row" onPress={() => nav.push('track', { id: b.id })} accessibilityRole="button" accessibilityLabel={`${t('wal.receipt')} ${b.ref}`} style={({ pressed }) => ({ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: SP.md, borderBottomWidth: i === done.length - 1 ? 0 : 1, borderBottomColor: C.line, opacity: pressed ? 0.7 : 1 })}>
          <IconBadge glyph={methodGlyph(b.payment_method)} bg={C.skyBg} size={38} />
          <View style={{ flex: 1 }}><Text style={S.bold} numberOfLines={1}>{b.destination.name ?? b.ref}</Text><Text style={S.muted}>{fmtDate(b.requested_at)} · {t(methodKey(b.payment_method))}</Text></View>
          <Money n={b.final_fare ?? b.estimated_fare} style={{ fontWeight: '800', color: C.ink }} />
        </Pressable>))}</Card> : null}

      <MenuGroup>
        <MenuRow testID="wal-claims" glyph="🛟" title={t('wal.claims')} sub={t('wal.claims.sub')} onPress={() => nav.push('claims')} last />
      </MenuGroup>
      <Card><View style={[S.row, { gap: SP.md, alignItems: 'flex-start' }]}><IconBadge glyph="🔒" bg={C.okBg} size={40} /><View style={{ flex: 1 }}><Text style={S.bold}>{t('wal.methods')}</Text><Text style={S.muted}>{t('wal.methods.body')}</Text></View></View></Card>
    </Screen>
  );
}

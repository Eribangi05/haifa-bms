import React, { useState } from 'react';
import { OfflineNote } from '../../ui/OfflineNote';
import { View } from 'react-native';
import { useApp, useAsync, usePoll } from '../../lib/app';
import { label } from '../../lib/i18n';
import { fmtDate, fmtRwf } from '../../lib/format';
import type { EarningsView } from '../../lib/types';
import { Btn, Card, Chip, EmptyState, Field, Money, Pill, SkeletonCard, Text } from '../../ui/components';
import { C, S } from '../../ui/theme';

type Payout = { id: string; requested_at: string; amount: number; status: string };
type Txn = { id: string; memo: string; credit?: number; debit?: number };

export function Earnings() {
  const { t, lang, client } = useApp(); const { busy, run } = useAsync(); const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day'); const [amt, setAmt] = useState('');
  const e = usePoll(() => client.get<EarningsView>(`/drivers/me/earnings?period=${period}`), 20000, [period], true, `earnings:${period}`);
  const w = usePoll(() => client.get<{ balance?: EarningsView['balance']; transactions?: Txn[] }>('/drivers/me/wallet'), 20000, [], true, 'driver:wallet');
  const po = usePoll(() => client.get<{ payouts?: Payout[] }>('/drivers/me/payouts'), 20000, [], true, 'driver:payouts');
  const d = e.data; const bal = d?.balance ?? w.data?.balance; const amount = Number(amt);
  const tooMuch = !!bal && amount > bal.eligible_payout;
  return (
    <View>
      <OfflineNote at={e.cachedAt} />
      <View style={S.row}>{(['day', 'week', 'month'] as const).map((p) => <Chip key={p} text={t(('drv.' + p) as 'drv.day')} on={period === p} onPress={() => setPeriod(p)} />)}</View>
      {!d ? <SkeletonCard /> : <Card>
        <Text style={S.muted}>{t('drv.net')}</Text><Money n={d.net} style={{ fontSize: 34, fontWeight: '800', color: C.primary }} />
        {([['drv.trips', d.trips], ['drv.fares', d.total_fares], ['drv.commission', d.commission], ['drv.cash', d.cash_collected], ['drv.momo', d.mobile_money_collected]] as const).map(([k, v]) => <View key={k} style={[S.between, { paddingVertical: 4 }]}><Text style={S.body}>{t(k)}</Text><Text style={S.body}>{k === 'drv.trips' ? v : `${fmtRwf(Number(v))} RWF`}</Text></View>)}
        <View style={S.between}><Text style={S.body}>{t('drv.rating')}</Text><Text style={S.body}>{d.rating > 0 ? `★ ${d.rating}` : '—'}</Text></View>
        {d.trips === 0 ? <Text style={[S.muted, { marginTop: 8 }]}>{t('drv.earn.none')}</Text> : null}
      </Card>}
      {bal ? <Card><Text style={S.h2}>{t('drv.wallet')}</Text>
        <View style={[S.between, { paddingVertical: 4 }]}><Text style={S.body}>{t('drv.eligible')}</Text><Money n={bal.eligible_payout} style={{ fontWeight: '800', color: C.primary }} /></View>
        {bal.owed_to_platform > 0 ? <View style={[S.between, { paddingVertical: 4 }]}><Text style={S.body}>{t('drv.owed')}</Text><Money n={bal.owed_to_platform} style={{ color: C.danger, fontWeight: '700' }} /></View> : null}
        <Field label={t('drv.payout.amount')} value={amt} onChangeText={(x) => setAmt(x.replace(/\D/g, ''))} keyboardType="number-pad" returnKeyType="done" error={tooMuch ? t('drv.payout.toomuch') : undefined} />
        <Btn title={t('drv.payout.request')} loading={busy} disabled={!amount || tooMuch} onPress={() => run(async () => { await client.post('/drivers/me/payouts', { amount }); setAmt(''); w.reload(); po.reload(); e.reload(); })} /></Card> : null}
      {!d && !bal && e.error ? <EmptyState glyph="📡" title={t('common.error')} action={<Btn title={t('common.retry')} onPress={e.reload} />} /> : null}
      {po.data?.payouts?.length ? <Card><Text style={S.h2}>{t('drv.payout.history')}</Text>{po.data.payouts.map((p) => <View key={p.id} style={[S.between, { paddingVertical: 4, gap: 6 }]}><Text style={S.body}>{fmtDate(p.requested_at)}</Text><Money n={p.amount} /><Pill tone={p.status === 'PAID' ? 'ok' : p.status === 'REJECTED' || p.status === 'FAILED' ? 'bad' : 'warn'} text={label(lang, 'po', p.status)} /></View>)}</Card> : null}
      {w.data?.transactions?.length ? <Card><Text style={S.h2}>{t('drv.activity')}</Text>{w.data.transactions.slice(0, 12).map((x) => <View key={x.id} style={[S.between, { paddingVertical: 3 }]}><Text style={[S.muted, { flex: 1 }]} numberOfLines={1}>{x.memo}</Text><Text style={{ color: x.credit ? C.primary : C.danger }}>{x.credit ? '+' + x.credit : '−' + x.debit}</Text></View>)}</Card> : null}
    </View>
  );
}

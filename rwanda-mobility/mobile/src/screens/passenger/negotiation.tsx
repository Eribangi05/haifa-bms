import React from 'react';
import { View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import type { Booking } from '../../lib/types';
import { proposalChoices } from '../../lib/negotiation';
import { Banner, Btn, Card, Chip, Money, Text } from '../../ui/components';
import { S } from '../../ui/theme';

/** Before booking: pick the usual price or a lower one to propose. Drivers see it, and a driver may accept, decline or counter once. */
export function ProposePrice({ total, maxPct, step, value, onChange }: { total: number; maxPct: number; step?: number; value: number | null; onChange: (amount: number | null) => void }) {
  const { t } = useApp();
  const list = proposalChoices(total, maxPct, step);
  if (!list.length) return null;
  return (
    <Card>
      <Text style={S.h2}>{t('up.neg.title')}</Text>
      <Text style={S.muted}>{t('up.neg.hint')}</Text>
      <View style={[S.wrap, { marginTop: 8 }]}>
        <Chip text={`${t('up.neg.off')}`} on={value == null} onPress={() => onChange(null)} />
        {list.map((x) => <Chip key={x.pct} text={`-${x.pct}%  ${x.amount}`} on={value === x.amount} onPress={() => onChange(x.amount)} />)}
      </View>
      {value != null ? <View style={[S.between, { marginTop: 8 }]}><Text style={S.body}>{t('up.neg.yours')}</Text><Money n={value} style={{ fontWeight: '700' }} /></View> : null}
    </Card>
  );
}

/** While the search runs: what the rider proposed and any counter-offer waiting for an answer. */
export function NegotiationCard({ b, reload }: { b: Booking; reload: () => void }) {
  const { t, client, say, errMsg } = useApp(); const { busy, run } = useAsync();
  const n = b.negotiation; if (!n) return null;
  if (n.agreed_fare) return <Banner kind="ok" text={t('up.neg.agreed', { amount: n.agreed_fare })} />;
  if (b.status !== 'SEARCHING_DRIVER') return null;
  const answer = (id: string, what: 'accept' | 'decline') => run(async () => { try { await client.post(`/bookings/${b.id}/counters/${id}/${what}`, {}); } catch (e) { say(errMsg(e)); } finally { reload(); } });
  return (
    <View style={{ gap: 8 }}>
      <Banner text={t('up.neg.proposed', { amount: n.proposed_fare })} />
      {n.counters.map((c) => (
        <Card key={c.id}>
          <Text style={S.h2}>{t('up.neg.counter', { name: c.driver_first_name ?? '', amount: c.amount })}</Text>
          <View style={S.row}><Btn title={t('up.neg.accept')} onPress={() => answer(c.id, 'accept')} loading={busy} /><Btn kind="ghost" title={t('up.neg.decline')} onPress={() => answer(c.id, 'decline')} /></View>
        </Card>))}
    </View>
  );
}

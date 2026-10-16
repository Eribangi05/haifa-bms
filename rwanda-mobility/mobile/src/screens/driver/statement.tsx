import React, { useState } from 'react';
import { View } from 'react-native';
import { useApp, usePoll } from '../../lib/app';
import { statementText, type StatementView } from '../../lib/statement';
import { shareText } from '../../lib/shareText';
import { Btn, Card, Chip, Money, SkeletonCard, Text } from '../../ui/components';
import { C, S } from '../../ui/theme';

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/** Weekly statement (Monday to Sunday, Kigali days): earnings per day, totals, and a share button that sends the same figures as plain text. */
export function WeeklyStatement() {
  const { t, client, say } = useApp(); const [week, setWeek] = useState(0);
  const st = usePoll(() => client.get<StatementView>(`/drivers/me/statement?week=${week}`), 60000, [week], true, `statement:${week}`);
  const d = st.data;
  const share = async () => { if (!d) return; const r = await shareText(statementText(d, t)); if (r === 'copied') say(t('st.copied')); };
  return (
    <Card>
      <Text style={S.h2}>{t('st.title')}</Text>
      <View style={S.row}><Chip text={t('st.this')} on={week === 0} onPress={() => setWeek(0)} /><Chip text={t('st.last')} on={week === 1} onPress={() => setWeek(1)} /></View>
      {!d ? (st.error ? <Text style={S.muted}>{t('st.error')}</Text> : <SkeletonCard />) : <View testID="statement">
        <Text style={[S.muted, { marginVertical: 4 }]}>{t('st.week', { from: dm(d.from), to: dm(d.to) })}</Text>
        {d.days.length === 0 ? <Text style={S.muted}>{t('st.none')}</Text> : d.days.map((x) => <View key={x.day} style={[S.between, { paddingVertical: 3 }]}><Text style={S.body}>{dm(x.day)} · {t('st.trips')}: {x.trips}</Text><Money n={x.net} /></View>)}
        <View style={{ borderTopWidth: 1, borderTopColor: C.line, marginTop: 6, paddingTop: 6 }}>
          <View style={S.between}><Text style={S.body}>{t('st.fares')}</Text><Money n={d.totals.fares} /></View>
          <View style={S.between}><Text style={S.body}>{t('st.commission')}</Text><Money n={d.totals.commission} /></View>
          <View style={S.between}><Text style={S.bold}>{t('st.net')}</Text><Money n={d.totals.net} style={{ fontWeight: '800', color: C.primary }} /></View>
          <View style={S.between}><Text style={S.body}>{t('st.cash')}</Text><Money n={d.totals.cash} /></View>
          {d.paid_out.amount > 0 ? <View style={S.between}><Text style={S.body}>{t('st.paid')}</Text><Money n={d.paid_out.amount} /></View> : null}
        </View>
        <Btn title={t('st.share')} kind="light" testID="statement-share" onPress={share} />
      </View>}
    </Card>
  );
}

import React, { useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { orderTags, tagLabel } from '../../lib/trustApi';
import { Banner, Btn, Card, Text } from '../../ui/components';
import { TagChip } from '../../ui/trustParts';
import { Stars } from '../passenger/tripParts';
import { S } from '../../ui/theme';

type PTag = { id: string; kind: 'positive' | 'negative'; label: { en: string; rw: string; fr: string } };

/** After a trip the driver can rate the passenger (stars and a few tags). Other drivers only ever see the average. One rating per trip; the server refuses a second. */
export function RatePassenger({ bookingId }: { bookingId: string }) {
  const { t, lang, client, cfg, errMsg, say } = useApp(); const { busy, run } = useAsync();
  const [score, setScore] = useState(0); const [tags, setTags] = useState<string[]>([]); const [done, setDone] = useState(false);
  const list = ((cfg as unknown as { rating_tags?: { passenger?: PTag[] } } | null)?.rating_tags?.passenger ?? []);
  if (done) return <Banner kind="ok" text={t('up.rate.done')} />;
  const toggle = (id: string) => setTags((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const send = () => run(async () => {
    try { await client.post(`/bookings/${bookingId}/ratings`, { score, tags: tags.length ? tags : undefined }, { retry: true }); setDone(true); }
    catch (e) { const m = (e as { code?: string })?.code; if (m === 'already_rated') setDone(true); else say(errMsg(e)); }
  });
  return (
    <Card>
      <Text style={S.h2}>{t('up.rate.title')}</Text>
      <Stars v={score} set={setScore} />
      {score > 0 ? <View style={[S.wrap, { marginTop: 8 }]}>{orderTags(list as never, score).map((x) => <TagChip key={x.id} text={tagLabel(x, lang)} tone={x.kind === 'negative' ? 'negative' : 'positive'} on={tags.includes(x.id)} onPress={() => toggle(x.id)} />)}</View> : null}
      <Btn title={t('up.rate.send')} onPress={send} disabled={score < 1} loading={busy} />
    </Card>
  );
}

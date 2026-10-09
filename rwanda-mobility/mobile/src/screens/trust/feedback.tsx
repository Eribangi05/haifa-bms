import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useApp } from '../../lib/app';
import { rankTags, type Badge, type RatingTag } from '../../lib/trustApi';
import { Banner, Btn, Card, EmptyState, Money, ProgressBar, Screen, SectionTitle, SkeletonCard, Text } from '../../ui/components';
import { R1Badges } from './badges';
import { C, S, SP } from '../../ui/theme';

type Feedback = { rating_avg: number; rating_count: number; tags: Record<string, number>; tips: { tips: number; momo_total: number; cash_total_informational: number }; badges: Badge[]; catalogue?: Record<string, RatingTag[] | { id: string; label: RatingTag['label'] }[]> };

/** Driver > My feedback: tag counts (totals only), tips received, badges. */
export function R1Feedback() {
  const { t, lang, client, nav, errMsg } = useApp();
  const [d, setD] = useState<Feedback | null>(null); const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => { setErr(null); client.get<Feedback>('/drivers/me/feedback').then(setD).catch(setErr); }, [client]);
  useEffect(load, [load]);
  // labels come from the catalogue the server sent (ride + abasare), in the app language
  const names = new Map<string, string>();
  for (const g of Object.values(d?.catalogue ?? {})) if (Array.isArray(g)) for (const x of g as { id: string; label?: RatingTag['label'] }[]) if (x.label) names.set(x.id, x.label[lang] || x.label.en);
  const ranked = rankTags(d?.tags ?? {}); const top = ranked[0]?.n ?? 1;
  return (
    <Screen title={t('r1.fb.title')} onBack={() => nav.pop()} onRefresh={async () => load()}>
      {err ? <Banner kind="bad" text={errMsg(err)} action={<Btn kind="ghost" title={t('common.retry')} onPress={load} />} /> : null}
      {!d && !err ? <><SkeletonCard /><SkeletonCard /></> : null}
      {d ? <>
        <Card>
          <Text style={S.muted}>{t('r1.fb.rating')}</Text>
          <Text style={{ fontSize: 40, fontWeight: '800', color: C.primary }}>{d.rating_count ? `★ ${Number(d.rating_avg).toFixed(1)}` : '—'}</Text>
          <Text style={S.muted}>{t('r1.fb.count', { n: d.rating_count })}</Text>
        </Card>
        <SectionTitle text={t('r1.fb.tags')} />
        <Card>
          {ranked.length ? ranked.map((r) => (
            <View key={r.id} style={{ marginBottom: SP.md }}>
              <View style={S.between}><Text style={[S.body, { flex: 1 }]}>{names.get(r.id) ?? r.id.replace(/_/g, ' ')}</Text><Text style={S.bold}>{r.n}</Text></View>
              <ProgressBar value={r.n / top} a11y={`${names.get(r.id) ?? r.id}: ${r.n}`} />
            </View>)) : <EmptyState glyph="💬" title={t('r1.fb.tags')} body={t('r1.fb.tags.none')} />}
          <Text style={S.muted}>{t('r1.fb.tags.note')}</Text>
        </Card>
        <SectionTitle text={t('r1.fb.tips')} />
        <Card>
          <View style={S.between}><Text style={[S.body, { flex: 1 }]}>{t('r1.fb.tips.n')}</Text><Text style={S.bold}>{d.tips.tips}</Text></View>
          <View style={[S.between, { marginTop: SP.sm }]}><Text style={[S.body, { flex: 1, paddingRight: 8 }]}>{t('r1.fb.tips.momo')}</Text><Money n={d.tips.momo_total} style={S.bold} /></View>
          <View style={[S.between, { marginTop: SP.sm }]}><Text style={[S.muted, { flex: 1, paddingRight: 8 }]}>{t('r1.fb.tips.cash')}</Text><Money n={d.tips.cash_total_informational} style={S.muted} /></View>
        </Card>
        <SectionTitle text={t('r1.fb.badges')} />
        <Card>{d.badges.length ? <R1Badges badges={d.badges} /> : <Text style={S.muted}>{t('r1.fb.badges.none')}</Text>}</Card>
      </> : null}
    </Screen>
  );
}

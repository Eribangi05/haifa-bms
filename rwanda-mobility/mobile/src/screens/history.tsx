import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useApp, usePoll } from '../lib/app';
import { label } from '../lib/i18n';
import { fmtTime, groupByDay } from '../lib/format';
import { statusGlyph, statusTone } from '../lib/trip';
import type { Booking } from '../lib/types';
import { Banner, Btn, Card, EmptyState, IconBadge, Money, Pill, Screen, SkeletonCard, Text } from '../ui/components';
import { C, S, SP } from '../ui/theme';
import { HistoryExtras } from './r3/receiptLines';

/** Trips grouped by day (Today / Yesterday / date), each with a status icon and chip. Pull down to refresh. */
export function History() {
  const { t, lang, client, nav, errMsg } = useApp();
  const list = usePoll(() => client.get<{ bookings: Booking[] }>('/bookings?role=passenger&limit=50'), 15000);
  const groups = useMemo(() => groupByDay(list.data?.bookings ?? [], (b) => b.requested_at), [list.data]);
  const bookings = list.data?.bookings;
  return (
    <Screen title={t('hist.title')} onBack={() => nav.pop()} onRefresh={async () => { list.reload(); await new Promise((r) => setTimeout(r, 600)); }}>
      {list.error && !bookings ? <Banner kind="bad" text={errMsg(list.error)} action={<Btn kind="ghost" title={t('common.retry')} onPress={list.reload} />} /> : null}
      {!bookings && !list.error ? <><SkeletonCard /><SkeletonCard /><SkeletonCard /></> : null}
      {bookings && bookings.length === 0 ? <EmptyState glyph="🧾" title={t('hist.empty.title')} body={t('hist.empty')} action={<Btn title={t('home.where')} onPress={() => nav.reset('home')} />} /> : null}
      {groups.map((g) => (
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
                      <View style={{ marginTop: SP.xs + 2 }}><Pill tone={tone} text={label(lang, 'bs', b.status)} /></View>
                      <HistoryExtras b={b} />
                    </View>
                    <Money n={b.final_fare ?? b.estimated_fare} style={{ fontWeight: '700', color: C.ink }} />
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}

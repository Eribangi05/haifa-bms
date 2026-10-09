import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { fmtDateTime } from '../../lib/format';
import { WEEK_ORDER, lastRun, scheduleWarning, type Schedule } from '../../lib/growthApi';
import { Banner, Btn, Card, EmptyState, Money, Pill, Screen, SkeletonCard, Text } from '../../ui/components';
import { showAlert } from '../../ui/dialog';
import { C, S, SP } from '../../ui/theme';
import type { ApiError } from '../../lib/net';

/** Recurring rides: list with pause / resume / skip next / end / accept new price, next run, last result and warnings. */
export function Schedules() {
  const { t, client, nav, errMsg, say, online } = useApp(); const { busy, run } = useAsync();
  const [list, setList] = useState<Schedule[] | null>(null); const [err, setErr] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    try { const r = await client.get<{ schedules: Schedule[] }>('/ride-schedules'); setList(r.schedules); setErr(null); } catch (e) { setErr(e as ApiError); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  const act = (id: string, path: string, msg: string) => run(async () => { try { await client.post(`/ride-schedules/${id}/${path}`, {}); say(msg); } finally { await load(); } });
  const end = (id: string) => showAlert(t('r2.sch.end'), t('r2.sch.end.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), style: 'destructive', onPress: () => void run(async () => { try { await client.del(`/ride-schedules/${id}`); say(t('r2.sch.ended.done')); } finally { await load(); } }) }]);
  const skip = (id: string) => run(async () => { try { const r = await client.post<{ booking_cancelled?: boolean }>(`/ride-schedules/${id}/skip-next`, {}); say(r.booking_cancelled ? t('r2.sch.skip.cancelled') : t('r2.sch.skip.done')); } finally { await load(); } });
  return (
    <Screen title={t('r2.sch.title')} onBack={() => nav.pop()} onRefresh={load}>
      {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
      {err && !list ? <Banner kind="bad" text={errMsg(err)} action={<Btn kind="ghost" title={t('common.retry')} onPress={load} />} /> : null}
      {!list && !err ? <><SkeletonCard /><SkeletonCard /></> : null}
      {list && !list.length ? <EmptyState glyph="🔁" title={t('r2.sch.empty.title')} body={t('r2.sch.empty')} action={<Btn title={t('r2.sch.new')} onPress={() => nav.reset('home')} />} /> : null}
      {list?.map((s) => {
        const w = scheduleWarning(s); const lr = lastRun(s); const ended = s.status === 'ended';
        const days = WEEK_ORDER.filter((d) => s.days_of_week.includes(d)).map((d) => t(`r2.day.${d}` as 'r2.day.0')).join(' · ');
        const tone = s.status === 'active' ? 'ok' : s.status === 'paused' ? 'warn' : 'bad';
        return (
          <Card key={s.id} style={ended ? { opacity: 0.65 } : undefined}>
            <View style={[S.between, { alignItems: 'flex-start', gap: SP.sm }]}>
              <View style={{ flex: 1 }}><Text style={S.h2} numberOfLines={2}>{s.label || `${s.pickup_name ?? '…'} → ${s.dest_name ?? '…'}`}</Text>
                {s.label ? <Text style={S.muted} numberOfLines={2}>{s.pickup_name ?? '…'} → {s.dest_name ?? '…'}</Text> : null}</View>
              <Pill tone={tone} text={t(`r2.sch.st.${s.status}` as 'r2.sch.st.active')} />
            </View>
            <Text style={[S.body, { marginTop: SP.sm }]}>{days} · {s.local_time}</Text>
            <Text style={S.muted}>{t('r2.sch.from', { date: s.start_date })}{s.end_date ? ` ${t('r2.sch.until', { date: s.end_date })}` : ''}</Text>
            {s.expected_total != null ? <View style={S.row}><Text style={S.muted}>{t('r2.sch.price')}: </Text><Money n={s.expected_total} style={[S.muted, { fontWeight: '700' }]} /></View> : null}
            {!ended ? <Text style={[S.body, { marginTop: SP.xs }]}>{t('r2.sch.next')}: {s.status === 'paused' ? t('r2.sch.st.paused') : s.next_occurrence ? fmtDateTime(s.next_occurrence) : t('r2.sch.nonext')}</Text> : null}
            {lr ? <View style={[S.row, { marginTop: SP.xs, gap: SP.sm, flexWrap: 'wrap' }]}><Text style={S.muted}>{t('r2.sch.last')}:</Text><Pill tone={lr.status === 'booked' ? 'ok' : 'warn'} text={`${lr.date} · ${t(`r2.run.${lr.status}` as 'r2.run.booked')}`} /></View> : null}
            {w?.kind === 'price_changed' ? <View style={{ marginTop: SP.md }}><Banner text={w.total != null && s.expected_total != null ? t('r2.sch.warn.price', { date: w.date, old: s.expected_total, new: w.total }) : t('r2.sch.warn.price2', { date: w.date })}
              action={<Btn testID="r2-accept-price" title={t('r2.sch.accept')} onPress={() => act(s.id, 'accept-price', t('r2.sch.accepted'))} disabled={busy} />} /></View> : null}
            {w?.kind === 'no_coverage' ? <View style={{ marginTop: SP.md }}><Banner text={t('r2.sch.warn.cover', { date: w.date })} /></View> : null}
            {!ended ? <View style={{ gap: SP.sm, marginTop: SP.md }}>
              {s.status === 'active' ? <Btn kind="ghost" testID="r2-pause" title={t('r2.sch.pause')} onPress={() => act(s.id, 'pause', t('r2.sch.paused.done'))} disabled={busy} /> : <Btn testID="r2-resume" title={t('r2.sch.resume')} onPress={() => act(s.id, 'resume', t('r2.sch.resumed.done'))} disabled={busy} />}
              <Btn kind="ghost" testID="r2-skip" title={t('r2.sch.skip')} onPress={() => skip(s.id)} disabled={busy || !s.next_occurrence} />
              <Btn kind="danger" title={t('r2.sch.end')} onPress={() => end(s.id)} disabled={busy} />
            </View> : null}
          </Card>);
      })}
    </Screen>
  );
}

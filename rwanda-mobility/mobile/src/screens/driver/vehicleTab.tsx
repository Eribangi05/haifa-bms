import React from 'react';
import { View } from 'react-native';
import { useApp, usePoll } from '../../lib/app';
import { label } from '../../lib/i18n';
import type { Badge } from '../../lib/r1';
import type { DriverStatus } from '../../lib/types';
import { Banner, Btn, Card, IconBadge, Pill, Screen, SectionTitle, SkeletonCard, Text } from '../../ui/components';
import { Hero, StatRow, StatTile } from '../../ui/dash';
import { C, FS, S, SP } from '../../ui/theme';
import { R1Badges } from '../r1Badges';
import { DocRow } from './docRow';
import { QuestsCard } from './r2Quests';

const VGLYPH: Record<string, string> = { moto: '🛵', car: '🚗', minivan: '🚐' };

/** Driver "Vehicle" tab: driving record (rating, trips, status, badges), the registered vehicle and the state of every document with renewal. */
export function VehicleTab({ focused }: { focused: boolean }) {
  const { t, lang, client, errMsg, goTab, nav } = useApp();
  const st = usePoll(() => client.get<DriverStatus>('/drivers/me/status'), 20000, [], focused);
  const fb = usePoll(() => client.get<{ badges: Badge[]; rating_avg: number; rating_count: number }>('/drivers/me/feedback'), 60000, [], focused);
  const d = st.data;
  const ok = d?.profile.status === 'APPROVED';
  return (
    <Screen title={t('vh.title')} onRefresh={async () => { st.reload(); fb.reload(); await new Promise((r) => setTimeout(r, 500)); }}>
      {st.error && !d ? <Banner kind="bad" text={errMsg(st.error)} action={<Btn kind="ghost" title={t('common.retry')} onPress={st.reload} />} /> : null}
      {!d && !st.error ? <><SkeletonCard /><SkeletonCard /></> : null}
      {d ? <>
        <Hero testID="vh-hero">
          <Text style={{ color: C.onPrimary, opacity: 0.9 }}>{t('vh.record')}</Text>
          <View style={[S.row, { gap: SP.md, marginTop: SP.xs }]}>
            <Text testID="vh-rating" style={{ color: C.onPrimary, fontSize: FS.hero, fontWeight: '800' }}>{Number(d.profile.rating_avg) > 0 ? `★ ${Number(d.profile.rating_avg).toFixed(1)}` : '—'}</Text>
            <View style={{ flex: 1, alignItems: 'flex-end' }}><Pill tone={ok ? 'ok' : d.profile.status === 'REJECTED' || d.profile.status === 'SUSPENDED' ? 'bad' : 'warn'} text={t(`drv.st.${d.profile.status}` as 'drv.st.APPROVED')} /></View>
          </View>
          <Text style={{ color: C.onPrimary, opacity: 0.9 }}>{d.profile.completed_count} {t('vh.trips')}{fb.data?.rating_count ? ` · ${t('r1.fb.count', { n: fb.data.rating_count })}` : ''}</Text>
        </Hero>
        {fb.data?.badges?.length ? <><SectionTitle text={t('vh.badges')} /><Card><R1Badges badges={fb.data.badges} /></Card></> : null}

        <SectionTitle text={t('vh.vehicle')} />
        {d.vehicle ? (
          <Card>
            <View style={[S.row, { gap: SP.md }]}>
              <IconBadge glyph={VGLYPH[d.vehicle.vehicle_type] ?? '🚗'} bg={C.skyBg} size={52} />
              <View style={{ flex: 1 }}>
                <Text testID="vh-vehicle" style={{ fontSize: FS.lg, fontWeight: '800', color: C.ink }}>{d.vehicle.make} {d.vehicle.model}</Text>
                <Text style={S.muted}>{label(lang, 'ab.cls', d.vehicle.vehicle_type)}{d.vehicle.color ? ` · ${d.vehicle.color}` : ''}</Text>
              </View>
            </View>
            <View style={{ height: SP.md }} />
            <StatRow>
              <StatTile glyph="🔢" value={d.vehicle.plate} label={t('drv.plate')} />
              <StatTile glyph="💺" value={String(d.vehicle.capacity)} label={t('drv.seats')} tint={C.okBg} />
            </StatRow>
          </Card>
        ) : <Banner text={t('vh.novehicle')} action={<Btn kind="ghost" title={t('vh.apply')} onPress={() => goTab('home')} />} />}
        {d.abasare && d.abasare.status !== 'none' ? <Card style={{ borderColor: C.gold, borderWidth: 2 }}><Text style={S.bold}>{t('vh.abasare')}</Text><View style={{ marginTop: 4 }}><Pill tone={d.abasare.status === 'approved' ? 'ok' : d.abasare.status === 'pending' ? 'warn' : 'bad'} text={t(`ab.st.${d.abasare.status}` as 'ab.st.none')} /></View></Card> : null}

        {(d.requirements ?? []).length ? <>
          <SectionTitle text={t('vh.docs')} />
          <Card>{(d.requirements ?? []).map((r) => <DocRow key={r.doc_type} req={r} docs={d.documents.filter((x) => x.doc_type === r.doc_type)} editable reload={st.reload} />)}</Card>
        </> : null}

        {ok ? <>
          <SectionTitle text={t('vh.growth')} />
          <QuestsCard onOpen={() => nav.push('quests')} />
        </> : null}
      </> : null}
    </Screen>
  );
}

import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useApp, usePoll } from '../../lib/app';
import { fmtDate, fmtRwf } from '../../lib/format';
import { driverKind, jobKind, jobTypes } from '../../lib/driverKind';
import { label } from '../../lib/i18n';
import type { Badge } from '../../lib/trustApi';
import { useTripFeed } from '../../lib/tripFeed';
import type { Booking, DriverStatus } from '../../lib/types';
import { Banner, Btn, Card, IconBadge, Money, Pill, Screen, SectionTitle, SkeletonCard, Text } from '../../ui/components';
import { Illustration, Segmented, StatRow, StatTile } from '../../ui/dash';
import { C, FS, S, SP } from '../../ui/theme';
import { R1Badges } from '../trust/badges';
import { DocRow } from './docRow';
import { CategoryCard, KindPill } from './kindUi';
import { QuestsCard } from '../growth/quests';

const VGLYPH: Record<string, string> = { moto: '🛵', car: '🚗', minivan: '🚐' };
type Page = 'overview' | 'vehicle' | 'abasare' | 'documents';

const Row = ({ k, v }: { k: string; v: string }) => <View style={[S.between, { minHeight: 36, gap: SP.md }]}><Text style={[S.muted, { flexShrink: 1 }]}>{k}</Text><Text style={[S.bold, { flex: 1, textAlign: 'right' }]}>{v}</Text></View>;

/** Driver "Profile" tab, four pages: Overview (category, record, permissions), Vehicle (own vehicle and its history), Abasare (skills and customer-car jobs), Documents. */
export function ProfileTab({ focused }: { focused: boolean }) {
  const { t, lang, client, errMsg, nav, goTab } = useApp(); const feed = useTripFeed(); const [page, setPage] = useState<Page>('overview');
  const st = usePoll(() => client.get<DriverStatus>('/drivers/me/status'), 20000, [], focused, 'driver:status');
  const fb = usePoll(() => client.get<{ badges: Badge[]; rating_count: number }>('/drivers/me/feedback'), 60000, [], focused, 'driver:feedback');
  const d = st.data; const kind = driverKind(d); const trips = feed.trips ?? [];
  const rides = useMemo(() => trips.filter((b) => jobKind(b) === 'ride'), [trips]); const abJobs = useMemo(() => trips.filter((b) => jobKind(b) === 'abasare'), [trips]);
  const ridePerm = !!d?.permission?.can_work; const abPerm = !!d?.abasare?.permission?.can_work; const abStatus = d?.abasare?.status ?? 'none';
  const guideKind = kind === 'abasare' ? 'abasare' : 'own';
  const permRow = (job: 'ride' | 'abasare') => {
    const ok = job === 'ride' ? ridePerm : abPerm; const applied = job === 'ride' ? !!d?.vehicle : abStatus !== 'none';
    return <View key={job} testID={`perm-${job}`} style={[S.between, { minHeight: 44 }]}>
      <View style={[S.row, { gap: SP.sm, flex: 1 }]}><IconBadge glyph={job === 'ride' ? '🛵' : '🧑‍✈️'} bg={job === 'ride' ? C.skyBg : C.warnBg} size={34} /><Text style={[S.bold, { flex: 1 }]}>{t(job === 'ride' ? 'pf.perm.ride' : 'pf.perm.abasare')}</Text></View>
      <Pill tone={ok ? 'ok' : applied ? 'warn' : 'bad'} text={ok ? t('pf.allowed') : applied ? t('pf.notyet') : t('pf.notapplied')} />
    </View>;
  };
  const jobRow = (b: Booking, i: number, a: Booking[]) => (
    <View key={b.id} testID="pf-job" style={[S.between, { minHeight: 52, gap: SP.sm, borderBottomWidth: i === a.length - 1 ? 0 : 1, borderBottomColor: C.line }]}>
      <View style={{ flex: 1 }}>
        <Text style={S.bold} numberOfLines={1}>{b.abasare ? (b.abasare.mode === 'hourly' ? t('pf.a.mode.hourly', { h: b.abasare.hours ?? 0 }) : t('pf.a.mode.p2p')) : (b.destination.name ?? b.ref)}</Text>
        <Text style={S.muted} numberOfLines={1}>{fmtDate(b.requested_at)} · {b.abasare?.vehicle?.plate ?? b.vehicle?.plate ?? b.ref}</Text>
      </View>
      <Money n={b.final_fare ?? b.estimated_fare} style={{ fontWeight: '800', color: C.ink }} />
    </View>
  );
  return (
    <Screen title={t('pf.title')} onRefresh={async () => { st.reload(); fb.reload(); feed.reload(); await new Promise((r) => setTimeout(r, 500)); }}>
      {st.error && !d ? <Banner kind="bad" text={errMsg(st.error)} action={<Btn kind="ghost" title={t('common.retry')} onPress={st.reload} />} /> : null}
      {!d && !st.error ? <><SkeletonCard /><SkeletonCard /></> : null}
      {d ? <>
        <Segmented value={page} onChange={(k) => setPage(k as Page)} items={[{ key: 'overview', label: t('pf.overview') }, { key: 'vehicle', label: t('pf.vehicle') }, { key: 'abasare', label: t('pf.abasare') }, { key: 'documents', label: t('pf.documents') }]} />

        {page === 'overview' ? <>
          <CategoryCard kind={kind} jobs={jobTypes({ ridePermitted: ridePerm, abasarePermitted: abPerm })} onGuide={() => nav.push('driverGuide', { kind: guideKind })} />
          <StatRow>
            <StatTile testID="pf-rating" glyph="⭐" value={Number(d.profile.rating_avg) > 0 ? Number(d.profile.rating_avg).toFixed(1) : '—'} label={t('vh.rating')} tint={C.goldBg} />
            <StatTile testID="pf-trips" glyph="🧾" value={String(d.profile.completed_count)} label={t('vh.trips')} />
            <StatTile glyph="🛡️" value={t(`drv.st.${d.profile.status}` as 'drv.st.APPROVED')} label={t('vh.status')} tint={C.okBg} />
          </StatRow>
          <SectionTitle text={t('pf.perm')} />
          <Card>{permRow('ride')}{permRow('abasare')}</Card>
          {fb.data?.badges?.length ? <><SectionTitle text={t('vh.badges')} /><Card><R1Badges badges={fb.data.badges} /></Card></> : null}
          {d.profile.status === 'APPROVED' ? <><SectionTitle text={t('vh.growth')} /><QuestsCard onOpen={() => nav.push('quests')} /></> : null}
        </> : null}

        {page === 'vehicle' ? (d.vehicle ? <>
          {d.vehicle.status && d.vehicle.status !== 'approved' && d.profile.status === 'APPROVED' ? <Btn testID="pf-continue-vehicle" kind="gold" title={t('va.entry')} onPress={() => nav.push('vehicleApply')} /> : null}
          <Card>
            <View style={[S.row, { gap: SP.md }]}>
              <IconBadge glyph={VGLYPH[d.vehicle.vehicle_type] ?? '🚗'} bg={C.skyBg} size={56} />
              <View style={{ flex: 1 }}>
                <Text testID="vh-vehicle" style={{ fontSize: FS.lg, fontWeight: '800', color: C.ink }}>{d.vehicle.make} {d.vehicle.model}</Text>
                <Text style={S.muted}>{label(lang, 'ab.cls', d.vehicle.vehicle_type)}{d.vehicle.color ? ` · ${d.vehicle.color}` : ''}</Text>
              </View>
              <KindPill job="ride" />
            </View>
            <View style={{ height: SP.md }} />
            <StatRow><StatTile glyph="🔢" value={d.vehicle.plate} label={t('drv.plate')} /><StatTile glyph="💺" value={String(d.vehicle.capacity)} label={t('drv.seats')} tint={C.okBg} /></StatRow>
          </Card>
          <SectionTitle text={t('pf.v.recent')} />
          <StatRow><StatTile testID="pf-ride-count" glyph="🛵" value={String(rides.filter((b) => b.status !== 'CANCELLED_BY_DRIVER').length)} label={t('pf.v.rides')} /></StatRow>
          {rides.length ? <Card style={{ paddingVertical: SP.xs }}>{rides.slice(0, 5).map(jobRow)}</Card> : <Card><Text style={[S.muted, { textAlign: 'center' }]}>{t('pf.v.norides')}</Text></Card>}
        </> : <>
          <Illustration glyphs="🧑‍✈️🚗" tint={C.warnBg} />
          <Card><Text testID="pf-no-vehicle" style={S.body}>{t('pf.v.none')}</Text></Card>
          {d.profile.status === 'APPROVED' ? <Btn testID="pf-add-vehicle" title={t('va.entry')} onPress={() => nav.push('vehicleApply')} /> : <Banner text={t('pf.v.add')} action={<Btn kind="ghost" title={t('pf.v.support')} onPress={() => nav.push('support')} />} />}
        </>) : null}

        {page === 'abasare' ? (abStatus === 'none' ? <>
          <Illustration glyphs="🧑‍✈️🚗🏠" tint={C.warnBg} />
          <Card style={{ borderColor: C.gold, borderWidth: 2 }}><Text style={S.h2}>{t('pf.a.apply')}</Text><Text style={[S.muted, { marginVertical: SP.sm }]}>{t('pf.a.apply.sub')}</Text><Btn testID="pf-apply-abasare" kind="gold" title={t('pf.a.apply')} onPress={() => nav.push('abasareApply')} /></Card>
          <Btn testID="pf-ab-guide" kind="ghost" title={t('pf.a.guide')} onPress={() => nav.push('driverGuide', { kind: 'abasare' })} />
        </> : <>
          <Card style={{ borderColor: C.gold, borderWidth: 2 }}>
            <View style={[S.between, { gap: SP.md }]}><View><Text style={S.muted}>{t('pf.a.status')}</Text><Text style={S.h2}>{t('pf.abasare')}</Text></View><Pill tone={abStatus === 'approved' ? 'ok' : abStatus === 'pending' ? 'warn' : 'bad'} text={t(`ab.st.${abStatus}` as 'ab.st.none')} /></View>
            {d.abasare?.reason ? <Text style={[S.muted, { marginTop: SP.sm }]}>{d.abasare.reason}</Text> : null}
          </Card>
          {d.abasare?.skills ? <><SectionTitle text={t('pf.a.skills')} /><Card>
            {d.abasare.skills.licence_since ? <Row k={t('pf.a.licence')} v={String(d.abasare.skills.licence_since).slice(0, 10)} /> : null}
            {d.abasare.skills.years_experience != null ? <Row k={t('pf.a.exp')} v={String(d.abasare.skills.years_experience)} /> : null}
            <Row k={t('pf.a.trans')} v={(d.abasare.skills.transmissions ?? []).map((x) => (x === 'manual' ? t('ab.car.manual') : t('ab.car.auto'))).join(', ') || '—'} />
            <Row k={t('pf.a.classes')} v={(d.abasare.skills.classes ?? []).map((x) => label(lang, 'ab.cls', x)).join(', ') || '—'} />
            {d.abasare.skills.return_mode ? <Row k={t('pf.a.return')} v={t(`ab.apply.ret.${d.abasare.skills.return_mode}` as 'ab.apply.ret.moto')} /> : null}
          </Card></> : null}
          <SectionTitle text={t('pf.a.jobs')} />
          <StatRow><StatTile testID="pf-ab-count" glyph="🧑‍✈️" value={String(abJobs.length)} label={t('pf.a.jobs')} tint={C.warnBg} /></StatRow>
          {abJobs.length ? <Card style={{ paddingVertical: SP.xs }}>{abJobs.slice(0, 8).map(jobRow)}</Card> : <Card><Text style={[S.muted, { textAlign: 'center' }]}>{t('pf.a.jobs.empty')}</Text></Card>}
          <Btn testID="pf-ab-guide" kind="ghost" title={t('pf.a.guide')} onPress={() => nav.push('driverGuide', { kind: 'abasare' })} />
        </>) : null}

        {page === 'documents' ? <>
          <Banner kind="ok" text={t('pf.d.intro')} />
          {(d.requirements ?? []).length ? <Card>{(d.requirements ?? []).map((r) => <DocRow key={r.doc_type} req={r} docs={d.documents.filter((x) => x.doc_type === r.doc_type)} editable reload={st.reload} />)}</Card>
            : <Card><Btn kind="ghost" title={t('vh.apply')} onPress={() => goTab('home')} /></Card>}
        </> : null}
      </> : null}
    </Screen>
  );
}

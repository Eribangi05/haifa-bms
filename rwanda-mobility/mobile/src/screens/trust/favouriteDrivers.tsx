import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import type { Booking } from '../../lib/types';
import type { MyDriver } from '../../lib/trustApi';
import { Banner, Btn, Card, EmptyState, ListRow, Pill, Screen, SectionTitle, SkeletonCard, Text } from '../../ui/components';
import { showAlert } from '../../ui/dialog';
import { R1Badges } from './badges';
import { S, SP } from '../../ui/theme';

/** The server does not expose the driver id on every view, so read it defensively (hidden when absent). */
export const driverIdOf = (b: Booking): string | null => { const x = b as unknown as { driver_id?: string; driver?: { id?: string; driver_id?: string } }; return x.driver?.id ?? x.driver?.driver_id ?? x.driver_id ?? null; };

/** "Add to favourites" / "Don't match me with this driver" for the driver of a finished trip. Private to the passenger. */
export function R1DriverPrefs({ b }: { b: Booking }) {
  const { t, client, say } = useApp(); const { busy, run } = useAsync(); const id = driverIdOf(b);
  const [kind, setKind] = useState<'favourite' | 'blocked' | null>(null);
  useEffect(() => { if (id) client.get<{ drivers: MyDriver[] }>('/users/me/drivers').then((r) => setKind(r.drivers.find((d) => d.driver_id === id)?.kind ?? null)).catch(() => {}); }, [client, id]);
  if (!id || !b.driver) return null;
  const set = (k: 'favourite' | 'blocked') => run(async () => { if (kind === k) await client.del(`/users/me/drivers/${id}`); else await client.request('PUT', `/users/me/drivers/${id}`, { body: { kind: k }, retry: true }); setKind(kind === k ? null : k); say(t('r1.pref.saved')); });
  return (
    <Card>
      <Text accessibilityRole="header" style={S.h2}>{t('r1.pref.title')}</Text>
      <Text style={[S.muted, { marginBottom: SP.sm }]}>{t('r1.pref.private')}</Text>
      <View style={{ gap: SP.sm }}>
        <Btn testID="pref-fav" kind={kind === 'favourite' ? 'primary' : 'ghost'} title={kind === 'favourite' ? `♥ ${t('r1.pref.fav.on')}` : `♡ ${t('r1.pref.fav')}`} onPress={() => set('favourite')} loading={busy} />
        <Btn testID="pref-block" kind={kind === 'blocked' ? 'danger' : 'ghost'} title={kind === 'blocked' ? t('r1.pref.block.on') : t('r1.pref.block')} onPress={() => set('blocked')} loading={busy} />
      </View>
    </Card>
  );
}

/** Profile > My drivers: favourites and blocked drivers with remove. */
export function R1MyDrivers() {
  const { t, client, nav, errMsg } = useApp(); const { run } = useAsync();
  const [list, setList] = useState<MyDriver[] | null>(null); const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => { setErr(null); client.get<{ drivers: MyDriver[] }>('/users/me/drivers').then((r) => setList(r.drivers)).catch(setErr); }, [client]);
  useEffect(load, [load]);
  const remove = (d: MyDriver) => showAlert(t('r1.pref.remove'), t('r1.md.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), style: 'destructive', onPress: () => void run(async () => { await client.del(`/users/me/drivers/${d.driver_id}`); load(); }) }]);
  const section = (kind: 'favourite' | 'blocked') => {
    const rows = (list ?? []).filter((d) => d.kind === kind); if (!rows.length) return null;
    return <>
      <SectionTitle text={kind === 'favourite' ? t('r1.md.fav') : t('r1.md.blocked')} />
      {rows.map((d) => (
        <Card key={d.driver_id}>
          <ListRow glyph={kind === 'favourite' ? '♥' : '⛔'} tint={undefined} title={d.first_name || '—'} subtitle={`${d.rating_avg ? '★ ' + Number(d.rating_avg).toFixed(1) + ' · ' : ''}${d.trips_together === 1 ? t('r1.md.trip1') : t('r1.md.trips', { n: d.trips_together })}`} right={<Pill tone={kind === 'blocked' ? 'bad' : 'ok'} text={kind === 'favourite' ? t('r1.md.fav') : t('r1.md.blocked')} />} />
          {d.badges?.length ? <R1Badges badges={d.badges} compact /> : null}
          <Btn testID={`md-remove-${d.driver_id}`} kind="ghost" title={t('r1.pref.remove')} onPress={() => remove(d)} />
        </Card>))}
    </>;
  };
  return (
    <Screen title={t('r1.md.title')} onBack={() => nav.pop()} onRefresh={async () => load()}>
      <Text style={S.muted}>{t('r1.md.note')}</Text>
      {err ? <Banner kind="bad" text={errMsg(err)} action={<Btn kind="ghost" title={t('common.retry')} onPress={load} />} /> : null}
      {!list && !err ? <><SkeletonCard /><SkeletonCard /></> : null}
      {list && !list.length ? <EmptyState glyph="♡" title={t('r1.md.empty.title')} body={t('r1.md.empty')} /> : null}
      {section('favourite')}{section('blocked')}
    </Screen>
  );
}

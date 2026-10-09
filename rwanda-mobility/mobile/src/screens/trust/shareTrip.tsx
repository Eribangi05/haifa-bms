import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync, useBackHandler } from '../../lib/app';
import { fmtDateTime } from '../../lib/format';
import { expiryLeft, type ShareRow } from '../../lib/trustApi';
import { shareText } from '../../lib/shareText';
import { AppModal } from '../../ui/AppModal';
import { NumberStepper } from '../../ui/Pickers';
import { Banner, Btn, Card, Pill, Screen, SectionTitle, SkeletonCard, Text } from '../../ui/components';
import { showAlert } from '../../ui/dialog';
import { Choice, SwitchRow } from '../../ui/trustParts';
import { S, SP } from '../../ui/theme';

const TTLS = [60, 240, 720];
/** Live-share management for one trip: create a link (OS share sheet), list active links with expiry, revoke, hide destination, per-trip switches. */
export function R1ShareSheet({ id, visible, onClose }: { id: string; visible: boolean; onClose: () => void }) {
  const { t, client, say, errMsg } = useApp(); const { busy, run } = useAsync();
  const [rows, setRows] = useState<ShareRow[] | null>(null); const [err, setErr] = useState<unknown>(null);
  const [ttl, setTtl] = useState(240); const [hide, setHide] = useState(false); const [auto, setAuto] = useState<boolean | null>(null); const [checks, setChecks] = useState<boolean | null>(null);
  useBackHandler(() => { onClose(); return true; }, visible);
  const load = useCallback(() => {
    setErr(null);
    client.get<{ shares: ShareRow[] }>(`/bookings/${id}/shares`).then((r) => setRows(r.shares)).catch(setErr);
    client.patch<{ auto_share: boolean; safety_checks: boolean }>(`/bookings/${id}/safety-settings`, {}).then((r) => { setAuto(r.auto_share); setChecks(r.safety_checks); }).catch(() => {});   // an empty PATCH just reads the current switches
  }, [client, id]);
  useEffect(() => { if (visible) load(); }, [visible, load]);
  const flip = (k: 'auto_share' | 'safety_checks', v: boolean) => {
    const old = k === 'auto_share' ? auto : checks; (k === 'auto_share' ? setAuto : setChecks)(v);
    void run(async () => { try { await client.patch(`/bookings/${id}/safety-settings`, { [k]: v }); } catch (e) { (k === 'auto_share' ? setAuto : setChecks)(old); throw e; } });
  };
  const create = () => run(async () => {
    const r = await client.post<{ url: string }>(`/bookings/${id}/share`, { ttl_minutes: ttl, hide_destination: hide });
    load();
    const res = await shareText(`${t('r1.sh.msg')} ${r.url}`);
    if (res === 'copied') say(t('r1.sh.copied'));
  });
  const revoke = (s: ShareRow) => showAlert(t('r1.sh.revoke'), t('r1.sh.revoke.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), style: 'destructive', onPress: () => void run(async () => { await client.del(`/bookings/${id}/share/${s.id}`); say(t('r1.sh.revoked.ok')); load(); }) }]);
  const revokeAll = () => showAlert(t('r1.sh.revoke.all'), t('r1.sh.revoke.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), style: 'destructive', onPress: () => void run(async () => { await client.del(`/bookings/${id}/share`); say(t('r1.sh.revoked.ok')); load(); }) }]);
  const now = Date.now();
  const activeCount = (rows ?? []).filter((s) => ['min', 'hours', 'open'].includes(expiryLeft(s.expires_at, s.revoked_at, now).kind)).length;
  return (
    <AppModal visible={visible} onClose={onClose}>
      <Screen title={t('r1.sh.title')} onBack={onClose} footer={<Btn testID="cta" big title={t('r1.sh.create')} onPress={create} loading={busy} />}>
        <Text style={S.muted}>{t('r1.sh.sub')}</Text>
        <SectionTitle text={t('r1.tc.title')} />
        <Card>
          {auto != null ? <SwitchRow testID="trip-autoshare" label={t('r1.tc.trip.title')} hint={t('r1.tc.trip.hint')} value={auto} onChange={(v) => flip('auto_share', v)} /> : <Text style={S.muted}>{t('common.loading')}</Text>}
          {checks != null ? <SwitchRow testID="trip-safety" label={t('r1.sh.safety')} hint={t('r1.sh.safety.hint')} value={checks} onChange={(v) => flip('safety_checks', v)} /> : null}
        </Card>
        <SectionTitle text={t('r1.sh.new')} />
        <Card>
          <Text style={S.bold}>{t('r1.sh.ttl')}</Text>
          <Choice value={ttl} onPick={setTtl} options={TTLS.map((m) => ({ v: m, text: t('r1.sh.ttl.h', { n: m / 60 }) }))} />
          <NumberStepper testID="share-ttl" label={t('pk.share.custom')} value={ttl} onChange={setTtl} min={10} max={1440} step={10} unit={t('pk.min')} />
          <SwitchRow testID="share-hide" label={t('r1.sh.hide')} hint={t('r1.sh.hide.hint')} value={hide} onChange={setHide} />
        </Card>
        <SectionTitle text={t('r1.sh.active')} />
        {err ? <Banner kind="bad" text={errMsg(err)} action={<Btn kind="ghost" title={t('common.retry')} onPress={load} />} /> : null}
        {!rows && !err ? <SkeletonCard /> : null}
        {rows && !rows.length ? <Text style={S.muted}>{t('r1.sh.none')}</Text> : null}
        {(rows ?? []).map((s) => {
          const ex = expiryLeft(s.expires_at, s.revoked_at, now); const live = ex.kind === 'min' || ex.kind === 'hours' || ex.kind === 'open';
          const title = s.auto ? (s.contact_name ? t('r1.sh.auto', { name: s.contact_name }) : t('r1.sh.auto.plain')) : t('r1.sh.mine');
          const when = ex.kind === 'revoked' ? t('r1.sh.revoked') : ex.kind === 'expired' ? t('r1.sh.expired') : ex.kind === 'min' ? t('r1.sh.exp.min', { n: ex.n }) : ex.kind === 'hours' ? t('r1.sh.exp.h', { n: ex.n }) : t('r1.sh.exp.open');
          return (
            <Card key={s.id} style={{ opacity: live ? 1 : 0.6 }}>
              <Text style={S.bold}>{title}</Text>
              <Text style={S.muted}>{fmtDateTime(s.created_at)}</Text>
              <View style={[S.wrap, { gap: SP.xs, marginVertical: SP.xs }]}><Pill tone={live ? 'ok' : 'warn'} text={when} />{s.hide_destination ? <Pill tone="warn" text={t('r1.sh.hidden.pill')} /> : null}</View>
              {live ? <Btn testID={`revoke-${s.id}`} kind="ghost" title={t('r1.sh.revoke')} onPress={() => revoke(s)} /> : null}
            </Card>); })}
        {activeCount > 1 ? <Btn kind="ghost" title={t('r1.sh.revoke.all')} onPress={revokeAll} /> : null}
      </Screen>
    </AppModal>
  );
}

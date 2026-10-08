import React, { useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { isIsoDate } from '../../lib/format';
import type { DriverStatus } from '../../lib/types';
import { Banner, Btn, Card, Chip, Field, Pill, Screen, Text, useFormFocus } from '../../ui/components';
import { C, S } from '../../ui/theme';
import { DocRow } from './docRow';

const VTYPES = ['moto', 'car', 'minivan'] as const;
const ALL_CLASSES = ['car', 'suv', 'minivan', 'pickup', 'moto'] as const;

/** Driver application: choose a path (own vehicle / Abasare), fill details, upload documents, submit for review. */
export function Onboarding({ status, reload }: { status: DriverStatus; reload: () => void }) {
  const { t, client, setMode, say } = useApp(); const { busy, run } = useAsync();
  const p = status.profile, v = status.vehicle; const ab = status.abasare ?? { status: 'none', skills: {} };
  const [showRide, setShowRide] = useState(!!v); const [showAb, setShowAb] = useState(ab.status !== 'none');
  const [af, setAf] = useState({ licence_since: ab.skills?.licence_since ?? '', years: String(ab.skills?.years_experience ?? ''), transmissions: ab.skills?.transmissions ?? ['manual'], classes: ab.skills?.classes ?? ['car'], return_mode: ab.skills?.return_mode ?? 'moto' });
  const toggleIn = (key: 'transmissions' | 'classes', x: string) => setAf((a) => ({ ...a, [key]: a[key].includes(x) ? a[key].filter((y) => y !== x) : [...a[key], x] }));
  const [f, setF] = useState({ legal_name: p.legal_name ?? '', national_id: '', vehicle_type: v?.vehicle_type ?? 'moto', make: v?.make ?? '', model: v?.model ?? '', color: v?.color ?? '', plate: v?.plate ?? '', capacity: String(v?.capacity ?? 1), comfort: false, payout: p.payout_msisdn ?? '' });
  const editable = ['APPLICATION_STARTED', 'INFO_REQUIRED', 'REJECTED'].includes(p.status);
  const set = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF((x) => ({ ...x, [k]: val }));
  const fr = useFormFocus(8); const fa = useFormFocus(5);
  const nidOk = /^\d{8,20}$/.test(f.national_id.replace(/\s/g, ''));
  const licenceOk = isIsoDate(af.licence_since, { notFuture: true });
  const saveApp = () => run(async () => {
    await client.post('/drivers/applications', { legal_name: f.legal_name.trim(), national_id: f.national_id.replace(/\s/g, ''), payout_msisdn: f.payout || undefined, vehicle: { vehicle_type: f.vehicle_type, make: f.make.trim(), model: f.model.trim(), color: f.color.trim(), plate: f.plate.trim(), capacity: Number(f.capacity) || 1, comfort: f.comfort } });
    say(t('common.save')); reload();
  });
  const saveAb = () => run(async () => {
    await client.post('/abasare/apply', { legal_name: f.legal_name.trim(), national_id: f.national_id.replace(/\s/g, ''), payout_msisdn: f.payout || undefined, licence_since: af.licence_since, years_experience: Number(af.years) || 0, transmissions: af.transmissions, classes: af.classes, return_mode: af.return_mode });
    say(t('common.save')); reload();
  });
  const submit = () => run(async () => { await client.post('/drivers/applications/submit'); reload(); });
  const hasPath = !!v || ab.status !== 'none';
  const need = status.requirements ?? [];
  return (
    <Screen title={t('drv.app.title')} onBack={() => setMode('passenger')} footer={editable && hasPath ? <Btn testID="cta" big title={t('drv.submit')} onPress={submit} loading={busy} /> : undefined}>
      <Card><Text style={S.muted}>{t('drv.status')}</Text><Pill tone={p.status === 'REJECTED' || p.status === 'SUSPENDED' ? 'bad' : p.status === 'APPROVED' ? 'ok' : 'warn'} text={t(('drv.st.' + p.status) as 'drv.st.APPROVED')} />{p.status_reason ? <Text style={[S.body, { marginTop: 6 }]}>{p.status_reason}</Text> : null}</Card>
      {status.fleet_invites?.length ? <Card><Text style={S.h2}>{t('drv.fleet.invite')}</Text>{status.fleet_invites.map((i) => <View key={i.id} style={[S.between, { marginTop: 6 }]}><Text style={[S.body, { flex: 1 }]}>{i.name}</Text><Btn title={t('common.yes')} onPress={() => run(async () => { await client.post('/drivers/me/fleet/accept', { invite_id: i.id }); reload(); })} /></View>)}</Card> : null}
      {editable && !showRide && !showAb ? <Card><Text style={S.h2}>{t('drv.become')}</Text><Text style={[S.muted, { marginBottom: 10 }]}>{t('ab.apply.sub')}</Text>
        <Btn title={t('ab.apply.path.abasare')} onPress={() => setShowAb(true)} big /><View style={{ height: 10 }} /><Btn kind="ghost" title={t('ab.apply.path.ride')} onPress={() => setShowRide(true)} /></Card> : null}
      {editable && (showRide || showAb) ? <View style={S.wrap}><Chip text={t('ab.apply.path.ride')} on={showRide} onPress={() => setShowRide(!showRide || !showAb)} /><Chip text={t('ab.apply.path.abasare')} on={showAb} onPress={() => setShowAb(!showAb || !showRide)} /></View> : null}
      {editable && showAb ? <Card style={{ borderColor: C.gold, borderWidth: 2 }}>
        <Text style={S.h2}>{t('ab.apply.title')}</Text><Text style={[S.muted, { marginBottom: 8 }]}>{t('ab.apply.need')}</Text>
        {ab.status !== 'none' ? <View style={{ marginBottom: 8 }}><Text style={S.muted}>{t('ab.apply.status')}</Text><Pill tone={ab.status === 'approved' ? 'ok' : ab.status === 'pending' ? 'warn' : 'bad'} text={t(('ab.st.' + ab.status) as 'ab.st.none')} />{ab.reason ? <Text style={S.muted}>{ab.reason}</Text> : null}</View> : null}
        {!showRide ? <>
          <Field {...fa(0)} label={t('drv.legalname')} value={f.legal_name} onChangeText={(x) => set('legal_name', x)} autoComplete="name" />
          <Field {...fa(1)} label={t('drv.nid')} value={f.national_id} onChangeText={(x) => set('national_id', x.replace(/[^\d\s]/g, ''))} keyboardType="number-pad" maxLength={24} error={f.national_id.length > 0 && !nidOk ? t('drv.nid.bad') : undefined} />
          <Field {...fa(2)} label={t('drv.payout')} value={f.payout} onChangeText={(x) => set('payout', x)} keyboardType="phone-pad" maxLength={16} /></> : null}
        <Field {...fa(3)} label={t('ab.apply.licence')} value={af.licence_since} onChangeText={(x) => setAf({ ...af, licence_since: x })} placeholder="2018-03-15" maxLength={10} keyboardType="numbers-and-punctuation" error={af.licence_since.length === 10 && !licenceOk ? t('drv.date.bad') : undefined} />
        <Field {...fa(4)} label={t('ab.apply.exp')} value={af.years} onChangeText={(x) => setAf({ ...af, years: x.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={2} />
        <Text style={S.muted}>{t('ab.apply.trans')}</Text><View style={[S.wrap, { marginVertical: 6 }]}>{(['manual', 'automatic'] as const).map((x) => <Chip key={x} text={x === 'manual' ? t('ab.car.manual') : t('ab.car.auto')} on={af.transmissions.includes(x)} onPress={() => toggleIn('transmissions', x)} />)}</View>
        <Text style={S.muted}>{t('ab.apply.classes')}</Text><View style={[S.wrap, { marginVertical: 6 }]}>{ALL_CLASSES.map((x) => <Chip key={x} text={t(('ab.cls.' + x) as 'ab.cls.car')} on={af.classes.includes(x)} onPress={() => toggleIn('classes', x)} />)}</View>
        <Text style={S.muted}>{t('ab.apply.return')}</Text><View style={[S.wrap, { marginVertical: 6 }]}>{(['moto', 'taxi', 'own', 'walk'] as const).map((x) => <Chip key={x} text={t(('ab.apply.ret.' + x) as 'ab.apply.ret.moto')} on={af.return_mode === x} onPress={() => setAf({ ...af, return_mode: x })} />)}</View>
        <Btn kind="ghost" title={t('ab.apply.save')} onPress={saveAb} loading={busy} disabled={ab.status === 'pending' || ab.status === 'approved' || !f.legal_name.trim() || (!showRide && !nidOk) || !licenceOk || !af.transmissions.length || !af.classes.length} />
      </Card> : null}
      {editable && showRide ? <Card>
        <Field {...fr(0)} label={t('drv.legalname')} value={f.legal_name} onChangeText={(x) => set('legal_name', x)} autoComplete="name" />
        <Field {...fr(1)} label={t('drv.nid')} value={f.national_id} onChangeText={(x) => set('national_id', x.replace(/[^\d\s]/g, ''))} keyboardType="number-pad" maxLength={24} placeholder="1 1999 8 0012345 6 78" error={f.national_id.length > 0 && !nidOk ? t('drv.nid.bad') : undefined} />
        <Text style={S.muted}>{t('drv.vtype')}</Text><View style={[S.wrap, { marginVertical: 6 }]}>{VTYPES.map((x) => <Chip key={x} text={t(('ab.cls.' + x) as 'ab.cls.car')} on={f.vehicle_type === x} onPress={() => { set('vehicle_type', x); set('capacity', x === 'moto' ? '1' : x === 'car' ? '4' : '7'); }} />)}</View>
        <Field {...fr(2)} label={t('drv.make')} value={f.make} onChangeText={(x) => set('make', x)} maxLength={40} /><Field {...fr(3)} label={t('drv.model')} value={f.model} onChangeText={(x) => set('model', x)} maxLength={40} /><Field {...fr(4)} label={t('drv.color')} value={f.color} onChangeText={(x) => set('color', x)} maxLength={30} />
        <Field {...fr(5)} label={t('drv.plate')} value={f.plate} onChangeText={(x) => set('plate', x.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={12} /><Field {...fr(6)} label={t('drv.seats')} value={f.capacity} onChangeText={(x) => set('capacity', x.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />
        {f.vehicle_type === 'car' ? <Chip text={t('drv.comfort')} on={f.comfort} onPress={() => set('comfort', !f.comfort)} /> : null}
        <Field {...fr(7, saveApp)} label={t('drv.payout')} value={f.payout} onChangeText={(x) => set('payout', x)} keyboardType="phone-pad" maxLength={16} />
        <Btn kind="ghost" title={t('common.save')} onPress={saveApp} loading={busy} disabled={!f.legal_name.trim() || !f.make.trim() || !f.plate.trim() || !nidOk} />
      </Card> : null}
      {hasPath ? <Card><Text style={S.h2}>{t('drv.docs')}</Text>
        {need.map((r) => <DocRow key={r.doc_type} req={r} docs={status.documents.filter((d) => d.doc_type === r.doc_type)} editable reload={reload} />)}
      </Card> : <Banner text={t('drv.savefirst')} />}
    </Screen>
  );
}

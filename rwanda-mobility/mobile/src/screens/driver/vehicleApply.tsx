import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync, usePoll } from '../../lib/app';
import { label } from '../../lib/i18n';
import type { DriverStatus } from '../../lib/types';
import { Banner, Btn, Card, Chip, Field, Pill, Screen, SectionTitle, Text } from '../../ui/components';
import { S, SP } from '../../ui/theme';
import { DocRow } from './docRow';

type VA = {
  can_apply: boolean; driver_status: string; stage: 'none' | 'draft' | 'in_review' | 'approved' | 'rejected'; review_target_hours: number;
  vehicle: { vehicle_type: string; make: string; model: string; color: string; year?: number | null; plate: string; capacity: number; comfort?: boolean; review_note?: string | null } | null;
  checklist: { doc_type: string; mandatory: boolean; requires_expiry: boolean; status: string; note: string | null }[];
};
const VTYPES = ['moto', 'car', 'minivan', 'pickup', 'truck'] as const;
const SEATS: Record<string, string> = { moto: '1', car: '4', minivan: '8', pickup: '2', truck: '2' };

/** An approved driver (typically an Abasare driver who bought a car) adds a vehicle: details, its documents, then "send for review". */
export function VehicleApply() {
  const { t, lang, client, nav, say } = useApp(); const { busy, run } = useAsync();
  const va = usePoll(() => client.get<VA>('/drivers/me/vehicle-application'), 8000);
  const ds = usePoll(() => client.get<DriverStatus>('/drivers/me/status'), 8000);
  const v = va.data?.vehicle; const stage = va.data?.stage ?? 'none';
  const [f, setF] = useState({ vehicle_type: 'car', make: '', model: '', color: '', plate: '', year: '', capacity: '4', comfort: false });
  const [filled, setFilled] = useState(false);
  useEffect(() => { if (v && !filled) { setF({ vehicle_type: v.vehicle_type, make: v.make, model: v.model, color: v.color, plate: v.plate, year: v.year ? String(v.year) : '', capacity: String(v.capacity), comfort: !!v.comfort }); setFilled(true); } }, [v, filled]);
  const set = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF((x) => ({ ...x, [k]: val }));
  const editable = stage === 'none' || stage === 'draft' || stage === 'rejected';
  const valid = f.make.trim() && f.model.trim() && f.color.trim() && f.plate.replace(/\s/g, '').length >= 4 && Number(f.capacity) >= 1;
  const save = () => run(async () => {
    await client.post('/drivers/me/vehicle-application', { vehicle_type: f.vehicle_type, make: f.make.trim(), model: f.model.trim(), color: f.color.trim(), plate: f.plate.trim(), year: f.year ? Number(f.year) : undefined, capacity: Number(f.capacity), comfort: f.comfort });
    say(t('va.saved')); va.reload(); ds.reload();
  });
  const submit = () => run(async () => { await client.post('/drivers/me/vehicle-application/submit'); say(t('va.sent')); va.reload(); });
  const docsReady = (va.data?.checklist ?? []).filter((c) => c.mandatory).every((c) => c.status !== 'missing' && c.status !== 'rejected');
  const stageText = stage === 'rejected' ? t('va.stage.rejected', { note: v?.review_note ?? '' }) : stage === 'none' ? '' : t(`va.stage.${stage}` as 'va.stage.draft');
  return (
    <Screen title={t('va.title')} onBack={() => nav.pop()} footer={editable && stage !== 'none' ? <Btn testID="va-submit" big title={t('va.submit')} onPress={submit} loading={busy} disabled={!docsReady} /> : undefined}>
      <Text style={S.muted}>{t('va.sub')}</Text>
      {stageText ? <Banner kind={stage === 'approved' ? 'ok' : stage === 'rejected' ? 'bad' : 'warn'} text={stageText} /> : null}
      {stage === 'in_review' ? <Text style={S.muted}>{t('va.target', { h: va.data?.review_target_hours ?? 24 })}</Text> : null}
      {va.data && !va.data.can_apply && stage === 'none' ? <Banner kind="bad" text={t('drv.notallowed')} /> : null}
      <Card>
        <Text style={S.muted}>{t('drv.vtype')}</Text>
        <View style={[S.wrap, { marginVertical: SP.sm }]}>{VTYPES.map((x) => <Chip key={x} text={t(('ab.cls.' + x) as 'ab.cls.car')} on={f.vehicle_type === x} onPress={() => { if (!editable) return; set('vehicle_type', x); set('capacity', SEATS[x]); }} />)}</View>
        <Field label={t('drv.make')} value={f.make} onChangeText={(x) => set('make', x)} editable={editable} />
        <Field label={t('drv.model')} value={f.model} onChangeText={(x) => set('model', x)} editable={editable} />
        <Field label={t('drv.color')} value={f.color} onChangeText={(x) => set('color', x)} editable={editable} />
        <Field label={t('drv.plate')} value={f.plate} onChangeText={(x) => set('plate', x.toUpperCase())} autoCapitalize="characters" editable={editable} />
        <Field label={t('drv.seats')} value={f.capacity} onChangeText={(x) => set('capacity', x.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" editable={editable} />
        {f.vehicle_type === 'car' ? <Chip text={t('drv.comfort')} on={f.comfort} onPress={() => editable && set('comfort', !f.comfort)} /> : null}
        {editable ? <Btn testID="va-save" title={t('va.save')} onPress={save} loading={busy} disabled={!valid} style={{ marginTop: SP.md }} /> : null}
      </Card>
      {stage !== 'none' ? <>
        <SectionTitle text={t('va.docs')} />
        <Card>
          {(va.data?.checklist ?? []).map((c) => <DocRow key={c.doc_type} req={{ doc_type: c.doc_type, mandatory: c.mandatory, requires_expiry: c.requires_expiry }} docs={(ds.data?.documents ?? []).filter((d) => d.doc_type === c.doc_type)} reload={() => { ds.reload(); va.reload(); }} editable={stage !== 'approved' && stage !== 'in_review'} />)}
        </Card>
        {v ? <View style={S.row}><Pill tone={stage === 'approved' ? 'ok' : stage === 'rejected' ? 'bad' : 'warn'} text={`${label(lang, 'ab.cls', v.vehicle_type)} · ${v.plate}`} /></View> : null}
      </> : null}
    </Screen>
  );
}

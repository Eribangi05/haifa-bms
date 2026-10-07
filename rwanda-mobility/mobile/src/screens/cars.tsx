import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApp, useAsync } from '../lib/app';
import { Banner, Btn, Card, Chip, Empty, Field, Header, Pill, Screen } from '../ui/components';
import { C, S } from '../ui/theme';
import { showAlert } from '../ui/dialog';

const CLASSES = ['car', 'suv', 'minivan', 'pickup', 'moto'] as const;

/** The customer's own cars: Abasare drivers are matched on the car's type and transmission. */
export function Cars() {
  const { t, client, nav } = useApp(); const { busy, run } = useAsync();
  const [cars, setCars] = useState<any[] | null>(null); const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ plate: '', make: '', model: '', color: '', vehicle_class: 'car', transmission: 'manual', insured: false });
  const load = () => client.get('/users/me/cars').then((r) => setCars(r.cars)).catch(() => setCars([]));
  useEffect(() => { void load(); }, []); // eslint-disable-line
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = () => run(async () => {
    await client.post('/users/me/cars', { plate: f.plate, make: f.make || undefined, model: f.model || undefined, color: f.color || undefined, vehicle_class: f.vehicle_class, transmission: f.transmission, insurance_confirmed: f.insured });
    setAdding(false); setF({ plate: '', make: '', model: '', color: '', vehicle_class: 'car', transmission: 'manual', insured: false }); await load();
  });
  return (
    <View style={S.screen}><Header title={t('ab.cars.title')} onBack={() => nav.pop()} />
      <Screen embedded>
        {cars && !cars.length && !adding ? <Empty text={t('ab.cars.empty')} /> : null}
        {(cars ?? []).map((c) => (
          <Card key={c.id}>
            <View style={S.between}><View><Text style={[S.h2, { letterSpacing: 2 }]}>{c.plate}</Text><Text style={S.muted}>{[c.color, c.make, c.model].filter(Boolean).join(' ')}</Text></View>
              <Pressable onPress={() => showAlert(t('ab.car.remove'), c.plate, [{ text: t('common.cancel') }, { text: t('common.confirm'), style: 'destructive', onPress: () => run(async () => { await client.del(`/users/me/cars/${c.id}`); await load(); }) }])} accessibilityRole="button" accessibilityLabel={`${t('ab.car.remove')}: ${c.plate}`} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={{ color: C.danger }}>{t('ab.car.remove')}</Text></Pressable></View>
            <View style={[S.row, { marginTop: 8, flexWrap: 'wrap', gap: 6 }]}><Pill text={t(('ab.cls.' + c.vehicle_class) as any)} /><Pill text={c.transmission === 'manual' ? t('ab.car.manual') : t('ab.car.auto')} />{c.insurance_confirmed ? <Pill text={'✓ ' + t('ab.car.insok')} /> : <Pill tone="warn" text={t('ab.car.insno')} />}</View>
          </Card>))}
        {adding ? (
          <Card>
            <Field label={t('ab.car.plate')} value={f.plate} onChangeText={(x) => set('plate', x.toUpperCase())} autoCapitalize="characters" maxLength={12} />
            <Field label={t('ab.car.make')} value={f.make} onChangeText={(x) => set('make', x)} /><Field label={t('ab.car.model')} value={f.model} onChangeText={(x) => set('model', x)} /><Field label={t('ab.car.color')} value={f.color} onChangeText={(x) => set('color', x)} />
            <Text style={S.muted}>{t('ab.car.class')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 6 }}>{CLASSES.map((x) => <Chip key={x} text={t(('ab.cls.' + x) as any)} on={f.vehicle_class === x} onPress={() => set('vehicle_class', x)} />)}</View>
            <Text style={S.muted}>{t('ab.car.trans')}</Text><View style={{ flexDirection: 'row', marginVertical: 6 }}><Chip text={t('ab.car.manual')} on={f.transmission === 'manual'} onPress={() => set('transmission', 'manual')} /><Chip text={t('ab.car.auto')} on={f.transmission === 'automatic'} onPress={() => set('transmission', 'automatic')} /></View>
            <Chip text={(f.insured ? '☑ ' : '☐ ') + t('ab.car.insured')} on={f.insured} onPress={() => set('insured', !f.insured)} />
            <Text style={[S.muted, { marginBottom: 10 }]}>{t('ab.car.insured.hint')}</Text>
            <Btn title={t('ab.car.save')} onPress={save} loading={busy} disabled={f.plate.length < 4} />
          </Card>) : <Btn title={t('ab.addcar')} onPress={() => setAdding(true)} />}
      </Screen></View>
  );
}

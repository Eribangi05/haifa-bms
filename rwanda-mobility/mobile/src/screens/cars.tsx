import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp, useAsync, useBackHandler } from '../lib/app';
import type { CustomerCar } from '../lib/types';
import { Banner, Btn, Card, Chip, EmptyState, Field, IconBadge, Pill, Screen, SkeletonCard, Text, useFormFocus } from '../ui/components';
import { C, S } from '../ui/theme';
import { showAlert } from '../ui/dialog';

const CLASSES = ['car', 'suv', 'minivan', 'pickup', 'moto'] as const;
const BLANK = { plate: '', make: '', model: '', color: '', vehicle_class: 'car', transmission: 'manual', insured: false };

/** The customer's own cars: Abasare drivers are matched on the car's type and transmission. */
export function Cars() {
  const { t, client, nav } = useApp(); const { busy, run } = useAsync();
  const [cars, setCars] = useState<CustomerCar[] | null>(null); const [failed, setFailed] = useState(false); const [adding, setAdding] = useState(false);
  const [f, setF] = useState(BLANK); const ff = useFormFocus(4);
  useBackHandler(() => { setAdding(false); return true; }, adding);   // system back closes the form first
  const load = useCallback(() => client.get('/users/me/cars').then((r) => { setCars(r.cars); setFailed(false); }).catch(() => setFailed(true)), [client]);
  useEffect(() => { void load(); }, [load]);
  const set = <K extends keyof typeof BLANK>(k: K, v: (typeof BLANK)[K]) => setF((x) => ({ ...x, [k]: v }));
  const valid = f.plate.trim().length >= 4;
  const save = () => { if (!valid) return; void run(async () => {
    await client.post('/users/me/cars', { plate: f.plate.trim(), make: f.make.trim() || undefined, model: f.model.trim() || undefined, color: f.color.trim() || undefined, vehicle_class: f.vehicle_class, transmission: f.transmission, insurance_confirmed: f.insured });
    setAdding(false); setF(BLANK); await load();
  }); };
  return (
    <Screen title={t('ab.cars.title')} onBack={() => (adding ? setAdding(false) : nav.pop())} footer={adding ? <Btn testID="cta" title={t('ab.car.save')} onPress={save} loading={busy} disabled={!valid} /> : <Btn testID="cta" title={t('ab.addcar')} onPress={() => setAdding(true)} />}>
      {failed && !cars ? <Banner kind="bad" text={t('common.error')} action={<Btn kind="ghost" title={t('common.retry')} onPress={() => void load()} />} /> : null}
      {!cars && !failed ? <SkeletonCard /> : null}
      {cars && !cars.length && !adding ? <EmptyState glyph="🚗" title={t('ab.cars.empty')} body={t('ab.nocar')} /> : null}
      {!adding ? (cars ?? []).map((c) => (
        <Card key={c.id}>
          <View style={[S.between, { alignItems: 'flex-start' }]}>
            <View style={[S.row, { gap: 12, flex: 1 }]}><IconBadge glyph="🚗" bg={C.warnBg} /><View style={{ flex: 1 }}><Text style={[S.h2, { letterSpacing: 2 }]}>{c.plate}</Text><Text style={S.muted}>{[c.color, c.make, c.model].filter(Boolean).join(' ')}</Text></View></View>
            <Pressable onPress={() => showAlert(t('ab.car.remove'), c.plate, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), style: 'destructive', onPress: () => run(async () => { await client.del(`/users/me/cars/${c.id}`); await load(); }) }])} accessibilityRole="button" accessibilityLabel={`${t('ab.car.remove')}: ${c.plate}`} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={{ color: C.danger }}>{t('ab.car.remove')}</Text></Pressable>
          </View>
          <View style={[S.row, { marginTop: 8, flexWrap: 'wrap', gap: 6 }]}><Pill text={t(('ab.cls.' + c.vehicle_class) as 'ab.cls.car')} /><Pill text={c.transmission === 'manual' ? t('ab.car.manual') : t('ab.car.auto')} />{c.insurance_confirmed ? <Pill text={t('ab.car.insok')} glyph="✓" /> : <Pill tone="warn" text={t('ab.car.insno')} />}</View>
        </Card>)) : null}
      {adding ? (
        <Card>
          <Field {...ff(0)} label={t('ab.car.plate')} value={f.plate} onChangeText={(x) => set('plate', x.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={12} />
          <Field {...ff(1)} label={t('ab.car.make')} value={f.make} onChangeText={(x) => set('make', x)} maxLength={40} />
          <Field {...ff(2)} label={t('ab.car.model')} value={f.model} onChangeText={(x) => set('model', x)} maxLength={40} />
          <Field {...ff(3, save)} label={t('ab.car.color')} value={f.color} onChangeText={(x) => set('color', x)} maxLength={30} />
          <Text style={S.muted}>{t('ab.car.class')}</Text><View style={[S.wrap, { marginVertical: 6 }]}>{CLASSES.map((x) => <Chip key={x} text={t(('ab.cls.' + x) as 'ab.cls.car')} on={f.vehicle_class === x} onPress={() => set('vehicle_class', x)} />)}</View>
          <Text style={S.muted}>{t('ab.car.trans')}</Text><View style={[S.wrap, { marginVertical: 6 }]}><Chip text={t('ab.car.manual')} on={f.transmission === 'manual'} onPress={() => set('transmission', 'manual')} /><Chip text={t('ab.car.auto')} on={f.transmission === 'automatic'} onPress={() => set('transmission', 'automatic')} /></View>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: f.insured }} onPress={() => set('insured', !f.insured)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ fontSize: 22, color: C.primary }}>{f.insured ? '☑' : '☐'}</Text><Text style={[S.body, { flex: 1 }]}>{t('ab.car.insured')}</Text></Pressable>
          <Text style={[S.muted, { marginBottom: 6 }]}>{t('ab.car.insured.hint')}</Text>
        </Card>) : null}
    </Screen>
  );
}

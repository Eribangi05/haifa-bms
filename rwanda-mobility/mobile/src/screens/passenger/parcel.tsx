import React from 'react';
import { View } from 'react-native';
import { useApp } from '../../lib/app';
import { checkGuest } from '../../lib/growthApi';
import type { TKey } from '../../lib/i18n';
import { Banner, Card, Chip, Field, Text } from '../../ui/components';
import { S } from '../../ui/theme';

export type ParcelForm = { name: string; phone: string; size: 'small' | 'medium' | 'large'; description: string };
export const emptyParcel = (): ParcelForm => ({ name: '', phone: '', size: 'small', description: '' });
export const parcelOk = (p: ParcelForm, ownPhone?: string | null) => checkGuest({ name: p.name, phone: p.phone, language: 'en' }, ownPhone).ok;
export const parcelBody = (p: ParcelForm, lang: 'rw' | 'fr' | 'en') => ({ recipient_name: p.name.trim().slice(0, 60), recipient_phone: p.phone.trim(), size: p.size, description: p.description.trim() || undefined, language: lang });

/** Courier service: who gets the parcel, how big it is, what is inside. Shown instead of the guest section. */
export function ParcelSection({ value, onChange, showErrors }: { value: ParcelForm; onChange: (p: ParcelForm) => void; showErrors: boolean }) {
  const { t, me } = useApp();
  const ok = parcelOk(value, me?.phone);
  return (
    <Card>
      <Text style={S.h2}>{t('up.parcel.title')}</Text>
      <Field label={t('up.parcel.recipient')} value={value.name} onChangeText={(name) => onChange({ ...value, name })} autoCapitalize="words" />
      <Field label={t('up.parcel.phone')} value={value.phone} onChangeText={(phone) => onChange({ ...value, phone })} keyboardType="phone-pad" />
      <Text style={[S.muted, { marginTop: 8 }]}>{t('up.parcel.size')}</Text>
      <View style={S.wrap}>{(['small', 'medium', 'large'] as const).map((k) => <Chip key={k} text={t(`up.parcel.${k}` as TKey)} on={value.size === k} onPress={() => onChange({ ...value, size: k })} />)}</View>
      <Field label={t('up.parcel.desc')} value={value.description} onChangeText={(description) => onChange({ ...value, description })} />
      <Text style={[S.muted, { marginTop: 6 }]}>{t('up.parcel.note')}</Text>
      {showErrors && !ok ? <Banner kind="bad" text={t('up.parcel.invalid')} /> : null}
    </Card>
  );
}

export const parcelLine = (t: (k: TKey, v?: Record<string, string | number>) => string, p: { size: 'small' | 'medium' | 'large'; recipient: string; description?: string | null }) =>
  `${t('up.parcel.for', { name: p.recipient, size: t(`up.parcel.${p.size}` as TKey).split(':')[0] })}${p.description ? ` · ${p.description}` : ''}`;

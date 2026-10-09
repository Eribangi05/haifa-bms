import React from 'react';
import { Switch, View } from 'react-native';
import { useApp } from '../../lib/app';
import { checkGuest, type GuestForm } from '../../lib/growthApi';
import { LANGS } from '../../lib/i18n';
import { Banner, Card, Chip, Field, Text, useFormFocus } from '../../ui/components';
import { C, S, SP } from '../../ui/theme';

export type GuestState = GuestForm & { on: boolean };
export const emptyGuest = (lang: GuestForm['language'], on = false): GuestState => ({ on, name: '', phone: '', language: lang });

/** "Book for someone else": switch + guest name, phone and SMS language. Hidden for Abasare (the server refuses it). */
export function GuestSection({ value, onChange, disabled, error }: { value: GuestState; onChange: (g: GuestState) => void; disabled?: boolean; error?: string | null }) {
  const { t, me } = useApp(); const f = useFormFocus(2);
  const chk = checkGuest(value, me?.phone); const show = value.on && !disabled;
  return (
    <Card>
      <View style={[S.between, { minHeight: 48 }]}>
        <Text style={[S.h2, { flex: 1, paddingRight: SP.sm }]}>{t('r2.guest.switch')}</Text>
        <Switch testID="r2-guest-switch" accessibilityLabel={t('r2.guest.switch')} value={value.on && !disabled} disabled={disabled} onValueChange={(v) => onChange({ ...value, on: v })} trackColor={{ true: C.primary }} />
      </View>
      {disabled ? <Text style={S.muted}>{t('r2.guest.na')}</Text> : <Text style={S.muted}>{t('r2.guest.explain')}</Text>}
      {show ? <View style={{ marginTop: SP.md }}>
        <Field {...f(0)} label={t('r2.guest.name')} value={value.name} onChangeText={(x) => onChange({ ...value, name: x })} maxLength={60} autoComplete="name" error={value.name.length > 0 && chk.name ? t('r2.guest.err.name') : undefined} />
        <Field {...f(1)} label={t('r2.guest.phone')} value={value.phone} onChangeText={(x) => onChange({ ...value, phone: x })} keyboardType="phone-pad" maxLength={16}
          error={value.phone.length > 3 && chk.phone ? (chk.phone === 'phone_own' ? t('r2.guest.err.own') : t('r2.guest.err.phone')) : undefined} />
        <Text style={S.muted}>{t('r2.guest.lang')}</Text>
        <View style={[S.wrap, { marginTop: 6 }]} accessibilityRole="radiogroup">{LANGS.map((l) => <Chip key={l.code} text={l.label} on={value.language === l.code} onPress={() => onChange({ ...value, language: l.code })} />)}</View>
        {error ? <Banner kind="bad" text={error} /> : null}
      </View> : null}
    </Card>
  );
}

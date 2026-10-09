import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp } from '../../lib/app';
import { creditBookingFields, splitCredit } from '../../lib/money3';
import { label } from '../../lib/i18n';
import { Card, Chip, Field, Glyph, Money, Text } from '../../ui/components';
import { C, R, S, SP } from '../../ui/theme';
import { useWallet } from './credit';

/**
 * "Use my credit" choice for Options. Returns the split (pure, from the quoted fare and the free balance) and the booking fields to merge;
 * the server still validates and reserves: a 409 insufficient_credit is mapped by the caller. Not offered for company billing.
 */
export function useCreditChoice(fare: number | null | undefined, method: string, hidden: boolean) {
  const { t, lang } = useApp(); const { wallet } = useWallet(!hidden);
  const [use, setUse] = useState(false); const [part, setPart] = useState(false); const [amt, setAmt] = useState('');
  const avail = wallet?.available ?? 0;
  const custom = part && amt.trim() ? Number(amt.replace(/\D/g, '')) : null;
  const split = splitCredit(fare, avail, use && !hidden, custom);
  const fields = creditBookingFields(split, method);
  const show = !hidden && !!wallet;
  const node = !show ? null : (
    <Card style={use ? { borderColor: C.primary, borderWidth: 2 } : undefined}>
      <Pressable testID="use-credit" onPress={() => avail > 0 && setUse(!use)} accessibilityRole="checkbox" accessibilityState={{ checked: use, disabled: avail <= 0 }} accessibilityLabel={`${t('cr.use')}. ${avail > 0 ? t('cr.use.avail', { n: Math.round(avail).toLocaleString('en-US') }) : t('cr.use.none')}`}
        style={[S.row, { gap: SP.md, minHeight: 48, opacity: avail > 0 ? 1 : 0.6 }]}>
        <Text accessible={false} style={{ fontSize: 24 }}>{use ? '☑' : '☐'}</Text>
        <View style={{ flex: 1 }}><View style={[S.row, { gap: SP.sm }]}><Glyph g="💳" size={24} /><Text style={S.bold}>{t('cr.use')}</Text></View><Text style={S.muted}>{avail > 0 ? t('cr.use.avail', { n: Math.round(avail).toLocaleString('en-US') }) : t('cr.use.none')}</Text></View>
      </Pressable>
      {use && avail > 0 ? <>
        <View style={[S.wrap, { marginTop: SP.sm }]}><Chip text={t('cr.use.all')} on={!part} onPress={() => { setPart(false); setAmt(''); }} /><Chip text={t('cr.use.part')} on={part} onPress={() => setPart(true)} /></View>
        {part ? <Field testID="credit-amount" label={t('cr.amount')} value={amt} onChangeText={(v) => setAmt(v.replace(/\D/g, '').slice(0, 7))} keyboardType="number-pad" returnKeyType="done" /> : null}
        {split.mode !== 'none' ? (
          <View testID="credit-breakdown" accessible accessibilityLabel={t('cr.break')} style={{ backgroundColor: C.bg, borderRadius: R.sm, padding: SP.md }}>
            <Text style={S.bold}>{t('cr.break')}</Text>
            <View style={[S.between, { paddingVertical: 2 }]}><Text style={S.body}>{t('cr.break.credit')}</Text><Money n={split.credit} style={S.bold} /></View>
            {split.remainder > 0 ? <View style={[S.between, { paddingVertical: 2 }]}><Text style={[S.body, { flex: 1, paddingRight: 8 }]}>{t('cr.break.rest', { method: method === 'mtn_momo' ? label(lang, 'pm', 'mtn_momo') : label(lang, 'pm', 'cash') })}</Text><Money n={split.remainder} style={S.bold} /></View> : <Text style={{ color: C.green, fontWeight: '700', marginTop: 4 }}>{t('cr.break.full')}</Text>}
            <Text style={[S.muted, { marginTop: 6 }]}>{t('cr.break.note')}</Text>
          </View>) : null}
      </> : null}
    </Card>
  );
  return { split, fields, node, active: split.mode !== 'none' };
}

import React from 'react';
import { Pressable, View } from 'react-native';
import { useApp } from '../../lib/app';
import { label } from '../../lib/i18n';
import { receiptParts } from '../../lib/moneyFmt';
import type { Booking } from '../../lib/types';
import { Pill, Text } from '../../ui/components';
import { C, S, SP } from '../../ui/theme';

/** Credit / deposit lines of a trip, from the booking view only: fare, credit used, deposit used, and what the other method collected. */
export function PaidLines({ b }: { b: Booking }) {
  const { t, lang } = useApp(); const p = receiptParts(b);
  if (!p.hasExtra) return null;
  const method = b.payment?.method && b.payment.method !== 'wallet' ? label(lang, 'pm', b.payment.method) : label(lang, 'pm', b.payment_method);
  const Row = ({ k, n, minus, tid }: { k: string; n: number; minus?: boolean; tid?: string }) => <View testID={tid} style={[S.between, { paddingVertical: 2 }]}><Text style={[S.body, { flex: 1, paddingRight: SP.sm }]}>{k}</Text><Text style={S.body}>{minus ? '- ' : ''}{Math.round(n).toLocaleString('en-US')} RWF</Text></View>;
  return (
    <View testID="paid-lines" style={{ backgroundColor: C.okBg, borderRadius: 10, padding: SP.md, marginVertical: SP.sm }}>
      <Row k={t('opt.total')} n={p.total} />
      {p.credit > 0 ? <Row tid="line-credit" k={t('cr.applied')} n={p.credit} minus /> : null}
      {p.deposit > 0 ? <Row tid="line-deposit" k={t('cr.deposit.used')} n={p.deposit} minus /> : null}
      {p.other > 0 ? <Row k={t('cr.paid.by', { method })} n={p.other} /> : <View style={{ marginTop: SP.xs }}><Pill text={t('cr.paid.credit')} /></View>}
      {p.refundedCredit > 0 ? <Text style={[S.muted, { marginTop: 4 }]}>{t('dp.refunded', { n: p.refundedCredit.toLocaleString('en-US') })}</Text> : null}
    </View>
  );
}

/** History card extras: credit used on the trip, and a way to report a problem on a finished trip. */
export function HistoryExtras({ b }: { b: Booking }) {
  const { t, nav } = useApp(); const p = receiptParts(b);
  const done = ['COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(b.status);
  return (
    <View>
      {p.credit > 0 || p.deposit > 0 ? <Text style={[S.muted, { marginTop: 4 }]}>{p.credit > 0 ? t('cr.hist.credit', { n: p.credit.toLocaleString('en-US') }) : ''}{p.credit > 0 && p.deposit > 0 ? ' · ' : ''}{p.deposit > 0 ? `${t('cr.deposit.used')} ${p.deposit.toLocaleString('en-US')} RWF` : ''}</Text> : null}
      {done ? <Pressable onPress={() => nav.push('claimNew', { booking_id: b.id, ref: b.ref })} accessibilityRole="button" accessibilityLabel={t('cl.history.report')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: C.primary, fontWeight: '700' }}>{t('cl.history.report')}</Text></Pressable> : null}
    </View>
  );
}

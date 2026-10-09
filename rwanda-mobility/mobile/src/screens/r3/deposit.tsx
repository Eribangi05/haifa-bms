import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync, usePoll } from '../../lib/app';
import { ApiError, uuid } from '../../lib/net';
import { fmtTime } from '../../lib/format';
import { depositMinutesLeft, depositUi, type DepositView } from '../../lib/money3';
import { PAY_SLOW_MS } from '../../lib/trip';
import type { Booking } from '../../lib/types';
import type { TKey } from '../../lib/i18n';
import { Banner, Btn, Card, Field, Glyph, Money, Pill, Text } from '../../ui/components';
import { showAlert } from '../../ui/dialog';
import { C, S, SP } from '../../ui/theme';
import { useWallet } from './credit';

const MSISDN = /^(?:\+?250|0)?7[2389]\d{7}$/;

/**
 * Abasare deposit step on Track. All states come from the server's `deposit` object (booking poll + a faster poll while a MoMo request is open):
 * the app never claims "paid" itself, and the booking only dispatches once the server says so.
 */
export function DepositCard({ b, reload }: { b: Booking; reload: () => void }) {
  const { t, client, me, say, errMsg, nav } = useApp(); const { busy, run } = useAsync(); const { wallet, reload: reloadWallet } = useWallet();
  const [msisdn, setMsisdn] = useState(me?.phone ?? ''); const keyRef = useRef<string | null>(null);
  const live = b.deposit && ['awaiting_payment', 'pending', 'failed'].includes(b.deposit.status);
  const poll = usePoll(() => client.get<{ deposit: DepositView }>(`/bookings/${b.id}/deposit`), 3000, [b.id], !!live && b.deposit!.status === 'pending');
  const d: DepositView | null = poll.data?.deposit ?? b.deposit ?? null;
  const ui = depositUi(d);
  const since = useRef<number | null>(null); const [now, setNow] = useState(Date.now());
  if (ui === 'pending' && since.current == null) since.current = Date.now(); if (ui !== 'pending') since.current = null;
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(i); }, []);
  useEffect(() => { if (d && d.status !== b.deposit?.status) { reload(); reloadWallet(); } }, [d?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || ui === 'none') return null;

  const slow = ui === 'pending' && since.current != null && now - since.current >= PAY_SLOW_MS;
  const left = depositMinutesLeft(d.pay_by, now);
  const msisdnOk = MSISDN.test(msisdn.replace(/[\s-]/g, ''));
  const pay = (method: 'wallet' | 'mtn_momo') => run(async () => {
    if (ui === 'failed') keyRef.current = null;
    keyRef.current = keyRef.current ?? uuid();
    try {
      await client.post(`/bookings/${b.id}/deposit/pay`, method === 'wallet' ? { method } : { method, msisdn: msisdn.replace(/[\s-]/g, '') }, { idempotencyKey: keyRef.current });
      poll.reload(); reload(); reloadWallet();
    } catch (e) {
      const code = (e as ApiError)?.code;
      if (code === 'deposit_already_paid') { say(t('dp.err.already')); reload(); }
      else if (code === 'deposit_closed') { say(t('dp.err.closed')); reload(); }
      else if (code === 'insufficient_credit') { say(t('cr.err.insufficient_credit')); reloadWallet(); }
      else throw e;
    }
  });
  const cancel = () => showAlert(t('trip.cancel.confirm'), t('dp.cancel.note'), [{ text: t('common.no'), style: 'cancel' }, { text: t('common.yes'), style: 'destructive', onPress: () => void run(async () => { await client.post(`/bookings/${b.id}/cancel`, { reason: 'changed_mind' }, { retry: true }); reload(); reloadWallet(); }) }]);
  const credit = wallet?.available ?? 0; const canCredit = credit >= d.amount;

  if (ui === 'ask' || ui === 'pending' || ui === 'failed') return (
    <Card style={{ borderColor: C.gold, borderWidth: 2 } as never}>
      <View style={S.between}><View style={[S.row, { gap: SP.sm, flexShrink: 1 }]}><Glyph g="🔐" size={28} /><Text accessibilityRole="header" style={S.h2}>{t('dp.title')}</Text></View><Pill tone="warn" text={t(`dp.st.${d.status}` as TKey)} /></View>
      <Text style={[S.body, { marginTop: SP.sm }]}>{t('dp.body', { n: d.amount.toLocaleString('en-US'), p: d.percent })}</Text>
      <View style={[S.between, { marginVertical: SP.sm }]}><Text style={S.muted}>{t('dp.amount')}</Text><Money n={d.amount} style={{ fontSize: 24, fontWeight: '800', color: C.primary }} /></View>
      <Banner kind="ok" text={t('dp.wait')} />
      {d.pay_by ? <Text style={[S.muted, { marginBottom: SP.sm }]}>{t('dp.payby', { time: fmtTime(d.pay_by) })}{left != null && left > 0 ? ` · ${t('dp.left', { n: left })}` : ''}</Text> : null}
      {ui === 'failed' ? <Banner kind="bad" text={t('dp.failed')} /> : null}
      {ui === 'pending' ? <Banner text={t('dp.pending')} /> : null}
      {slow ? <Banner kind="bad" text={t('dp.slow')} action={<Btn kind="ghost" title={t('dp.check')} onPress={() => { poll.reload(); reload(); }} />} /> : null}
      {ui !== 'pending' ? <>
        {wallet && credit > 0 ? <><Btn testID="deposit-credit" title={t('dp.pay.credit')} onPress={() => pay('wallet')} loading={busy} disabled={!canCredit} />{!canCredit ? <Text style={[S.muted, { marginTop: 4 }]}>{t('dp.pay.credit.low', { n: Math.round(credit).toLocaleString('en-US') })}</Text> : null}<View style={{ height: SP.sm }} /></> : null}
        <Field testID="deposit-msisdn" label={t('dp.msisdn')} value={msisdn} onChangeText={setMsisdn} keyboardType="phone-pad" maxLength={16} returnKeyType="done" error={msisdn.length > 4 && !msisdnOk ? t('auth.invalid') : undefined} />
        <Btn testID="deposit-momo" kind={wallet && credit > 0 ? 'ghost' : 'primary'} title={ui === 'failed' ? t('common.retry') : t('dp.pay.momo')} onPress={() => pay('mtn_momo')} loading={busy} disabled={!msisdnOk} />
      </> : null}
      <Text style={[S.muted, { marginTop: SP.md }]}>{t('dp.cancel.note')}</Text>
      <View style={{ height: SP.sm }} /><Btn kind="ghost" title={t('trip.cancel')} onPress={cancel} />
    </Card>
  );
  return <DepositNote d={d} />;
}

/** One-line outcome of the deposit (paid / used for the trip / returned / expired). */
export function DepositNote({ d }: { d: DepositView }) {
  const { t } = useApp(); const ui = depositUi(d); const n = (x: number) => Math.round(x).toLocaleString('en-US');
  if (ui === 'paid') return <Banner kind="ok" text={t('dp.paid')} />;
  if (ui === 'applied') return <Banner kind="ok" text={[t('dp.applied', { n: n(d.applied) }), d.refunded > 0 ? t('dp.refunded', { n: n(d.refunded) }) : ''].filter(Boolean).join(' ')} />;
  if (ui === 'refunded' && d.refunded <= 0) return null;
  if (ui === 'refunded') return <Banner kind="ok" text={[t('dp.refunded', { n: n(d.refunded) }), d.retained > 0 ? t('dp.retained', { n: n(d.retained) }) : ''].filter(Boolean).join(' ')} />;
  if (ui === 'closed') return <Banner kind="bad" text={t('dp.closed')} />;
  return null;
}

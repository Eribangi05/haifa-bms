import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useApp, useAsync, usePoll } from '../../lib/app';
import { API_URL } from '../../config';
import { label, pick } from '../../lib/i18n';
import { fmtDateTime, fmtTime } from '../../lib/format';
import { payUi } from '../../lib/trip';
import type { Booking, ChatMessage, HandoverRec, Receipt } from '../../lib/types';
import { AppModal } from '../../ui/AppModal';
import { Banner, Btn, Card, EmptyState, Field, IconBadge, Money, Pill, RemoteImage, Screen, Text } from '../../ui/components';
import { C, R, S, SP } from '../../ui/theme';
import { R1Badges } from '../trust/badges';
import { R1DriverPrefs } from '../trust/favouriteDrivers';
import { kv } from '../../lib/storage';
import { ratedKey } from '../../lib/trustApi';
import { PaidLines } from '../money/receiptLines';

export const Stars = ({ v, set }: { v: number; set: (n: number) => void }) => {
  const { t } = useApp();
  return <View style={{ flexDirection: 'row', justifyContent: 'center', marginVertical: 8 }}>{[1, 2, 3, 4, 5].map((n) => (
    <Pressable key={n} onPress={() => set(n)} accessibilityRole="button" accessibilityLabel={t('a11y.stars', { n })} accessibilityState={{ selected: n === v }} style={{ padding: 4, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 36, color: n <= v ? C.gold : C.line }}>★</Text></Pressable>))}</View>;
};

/** Driver identity card: photo, name, rating, vehicle and a large plate: what the passenger must verify before boarding. */
export function DriverCard({ b }: { b: Booking }) {
  const { t } = useApp();
  if (!b.driver) return null;
  const d = b.driver; const rating = d.rating_count > 0 ? `★ ${Number(d.rating).toFixed(1)}` : b.abasare ? t('ab.trip.new') : t('trip.newdriver');
  const plate = b.abasare ? b.abasare.vehicle.plate : b.vehicle?.plate;
  return (
    <View>
      <Text style={S.muted}>{b.abasare ? t('ab.trip.verify') : t('trip.verify')}</Text>
      <View style={[S.row, { gap: SP.md, marginTop: SP.sm }]}>
        {d.photo_url ? <RemoteImage url={API_URL + d.photo_url} label={t('a11y.driverphoto')} size={{ width: 64, height: 64, radius: 32 }} /> : <IconBadge glyph="🧑" bg={C.skyBg} size={64} />}
        <View style={{ flex: 1 }}>
          <Text style={S.h2} numberOfLines={1}>{d.name}</Text>
          <Text style={S.muted}>{rating}{b.abasare ? ` · ${d.abasare?.years_experience ?? '-'} ${t('ab.trip.exp')}` : ''}</Text>
          {b.abasare ? <View style={{ marginTop: 4 }}><Pill text={b.abasare.mode === 'hourly' ? `${t('ab.trip.hourly')} · ${b.abasare.hours} ${t('ab.h')}` : t('ab.trip.home')} tone="warn" /></View> : <Text style={S.body} numberOfLines={1}>{[b.vehicle?.color, b.vehicle?.make, b.vehicle?.model].filter(Boolean).join(' ')}</Text>}
        </View>
      </View>
      <R1Badges badges={(d as { badges?: import('../../lib/trustApi').Badge[] }).badges} />
      {b.abasare ? <Text style={[S.muted, { marginTop: SP.sm }]}>{t('ab.trip.yourcar')}</Text> : null}
      {plate ? <View accessibilityLabel={`${t('trip.plate')} ${plate}`} accessible style={{ backgroundColor: C.warnBg, borderRadius: R.sm, paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'flex-start', marginTop: SP.sm }}><Text style={{ fontSize: 24, fontWeight: '800', letterSpacing: 3 }}>{plate}</Text></View> : null}
      {b.abasare && d.abasare?.return_mode ? <Text style={[S.muted, { marginTop: 6 }]}>{t('ab.trip.returns')}</Text> : null}
    </View>
  );
}

export function HandoverReview({ b, reload }: { b: Booking; reload: () => void }) {
  const { t, client } = useApp(); const { busy, run } = useAsync(); const [issue, setIssue] = useState<string | null>(null); const [note, setNote] = useState('');
  const hs: HandoverRec[] = b.abasare?.handovers ?? [];
  const respond = (phase: string, response: 'ok' | 'issue') => run(async () => { await client.post(`/bookings/${b.id}/handover/${phase}/respond`, { response, note: response === 'issue' ? note.trim() : undefined }); setIssue(null); setNote(''); reload(); });
  return (
    <View>
      {b.status === 'DRIVER_ARRIVED' && !hs.some((h) => h.phase === 'pickup') ? <Banner text={t('ab.check.waiting')} /> : null}
      {hs.map((h) => (
        <Card key={h.phase} style={{ borderColor: h.owner_response ? C.line : C.gold, borderWidth: h.owner_response ? 1 : 2 }}>
          <Text style={S.h2}>{h.phase === 'pickup' ? t('ab.check.pickup') : t('ab.check.dropoff')}</Text>
          {!h.owner_response ? <Text style={S.muted}>{t('ab.check.review')}</Text> : null}
          <Text style={S.body}>{t('ab.check.odo')}: {Number(h.odometer_km).toLocaleString('en-US')} km · {t('ab.check.fuel')}: {h.fuel_percent}%</Text>
          {h.notes ? <Text style={S.muted}>{t('ab.check.notes')}: {h.notes}</Text> : null}
          <View style={[S.wrap, { gap: 6, marginVertical: 8 }]}>{h.photos.map((u, i) => <RemoteImage key={u.split('?')[0]} url={API_URL + u} size={{ width: 84, height: 64, radius: 8 }} label={t('a11y.photo', { n: i + 1 })} />)}</View>
          {h.owner_response === 'ok' ? <Pill text={t('ab.check.confirmed')} /> : h.owner_response === 'issue' ? <Banner kind="bad" text={t('ab.check.disputed')} /> : issue === h.phase ? <>
            <Field value={note} onChangeText={setNote} placeholder={t('ab.check.issue.ph')} multiline maxLength={400} /><Btn kind="danger" title={t('ab.check.issue')} onPress={() => respond(h.phase, 'issue')} loading={busy} disabled={note.trim().length < 5} /></>
            : <View style={{ gap: 8 }}><Btn title={t('ab.check.ok')} onPress={() => respond(h.phase, 'ok')} loading={busy} /><Btn kind="ghost" title={t('ab.check.issue')} onPress={() => setIssue(h.phase)} /></View>}
        </Card>))}
    </View>
  );
}

/**
 * Payment after the trip. The UI state comes ONLY from the server (booking.payment / GET /payments/:id): MoMo is never "paid" until the server says SUCCESS,
 * a long PENDING shows a "still waiting" help state instead of spinning forever, and FAILED offers a retry or cash.
 */
export function PayCard({ b, reload }: { b: Booking; reload: () => void }) {
  const { t, client, me } = useApp(); const { busy, run } = useAsync(); const [msisdn, setMsisdn] = useState(me?.phone ?? ''); const [payId, setPayId] = useState<string | null>(b.payment?.id ?? null);
  const since = useRef<number | null>(null); const [now, setNow] = useState(Date.now());
  const momo = b.payment_method === 'mtn_momo' || b.payment_method === 'airtel_money';
  const pay = usePoll(() => client.get<NonNullable<Booking['payment']>>(`/payments/${payId}`), 3000, [payId], !!payId && momo && b.payment?.status !== 'SUCCESS');
  const p = pay.data ?? b.payment;
  if (p?.status === 'PENDING' && since.current == null) since.current = Date.now(); if (p?.status !== 'PENDING') since.current = null;
  useEffect(() => { if (p?.status !== 'PENDING') return; const i = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(i); }, [p?.status]);
  const ui = payUi(p?.status, since.current ? now - since.current : 0);
  useEffect(() => { if (pay.data?.status === 'SUCCESS') reload(); }, [pay.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => run(async () => { const r = await client.post('/payments', { booking_id: b.id, method: 'mtn_momo', msisdn }, { retry: true }); setPayId(r.id); pay.reload(); });   // the server reuses a live payment, so a retried POST never double-charges
  const toCash = () => run(async () => { await client.post(`/bookings/${b.id}/payment-method`, { method: 'cash' }); setPayId(null); reload(); });
  const toMomo = () => run(async () => { await client.post(`/bookings/${b.id}/payment-method`, { method: 'mtn_momo' }); reload(); });
  const msisdnOk = /^(?:\+?250|0)?7[2389]\d{7}$/.test(msisdn.replace(/[\s-]/g, ''));
  if (b.payer_type === 'corporate') return <Card><Text style={S.body}>{t('opt.corporate')}</Text><Money n={b.final_fare} style={S.h1} /></Card>;
  return (
    <Card>
      <Text style={S.muted}>{t('trip.fare.final')}</Text><Money n={b.final_fare} style={[S.h1, { color: C.primary, fontSize: 34 }]} />
      <PaidLines b={b} />
      {momo ? <>
        {ui === 'pending' ? <Banner text={t('trip.pay.waiting')} /> : null}
        {ui === 'slow' ? <Banner kind="bad" text={t('trip.pay.slow')} action={<Btn kind="ghost" title={t('trip.pay.check')} onPress={() => { pay.reload(); reload(); }} />} /> : null}
        {ui === 'failed' ? <Banner kind="bad" text={t('trip.pay.failed')} /> : null}
        {p?.simulated ? <Banner text={t('trip.test.sim')} /> : null}
        {ui !== 'pending' && ui !== 'slow' ? <>
          <Field label={t('trip.pay.msisdn')} value={msisdn} onChangeText={setMsisdn} keyboardType="phone-pad" maxLength={16} returnKeyType="done" onSubmitEditing={() => msisdnOk && void start()} error={msisdn.length > 4 && !msisdnOk ? t('auth.invalid') : undefined} />
          <Btn title={ui === 'failed' ? t('common.retry') : t('trip.pay.momo')} onPress={start} loading={busy} disabled={!msisdnOk} /><View style={{ height: 8 }} /></> : null}
        {ui !== 'pending' ? <Btn kind="ghost" title={t('trip.pay.cash')} onPress={toCash} /> : null}
      </> : <>
        <Text style={[S.body, { marginVertical: 8 }]}>{t('trip.pay.cashdue')} <Text style={{ fontWeight: '800' }}>{Math.round(b.payment?.outstanding ?? b.final_fare ?? 0)} RWF</Text></Text>
        <Text style={S.muted}>{t('trip.pay.cashnote')}</Text><View style={{ height: 10 }} /><Btn kind="ghost" title={t('trip.pay.momo')} onPress={toMomo} loading={busy} />
      </>}
    </Card>
  );
}

/** Payment confirmed (by the server): receipt with fare lines, then rating. Ratings go through the outbox so they survive being offline. */
export function Done({ b }: { b: Booking }) {
  const { t, lang, nav, client } = useApp(); const [sent, setSent] = useState(false);
  useEffect(() => { kv.get(ratedKey(b.id)).then((v) => setSent(v === '1')).catch(() => {}); }, [b.id]);
  const [receipt, setReceipt] = useState<Receipt | null>(null); const [showReceipt, setShowReceipt] = useState(false);
  useEffect(() => { client.get<Receipt>(`/bookings/${b.id}/receipt`).then(setReceipt).catch(() => {}); }, [client, b.id]);
  return (
    <Card>
      <View style={[S.row, { gap: SP.sm }]}><IconBadge glyph="✓" bg={C.okBg} size={36} /><Pill text={t('trip.pay.done')} /></View>
      <Money n={b.final_fare} style={[S.h1, { marginVertical: 6, fontSize: 34 }]} />
      <PaidLines b={b} />
      {receipt ? <Text style={S.muted}>{t('trip.receipt')} {receipt.receipt_no} · {receipt.payment?.method === 'wallet' ? t('cr.method.wallet') : label(lang, 'pm', receipt.payment?.method)}</Text> : null}
      {receipt ? <Pressable onPress={() => setShowReceipt(!showReceipt)} accessibilityRole="button" accessibilityState={{ expanded: showReceipt }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: C.primary, fontWeight: '700' }}>{showReceipt ? t('trip.receipt.hide') : t('trip.receipt.view')}</Text></Pressable> : null}
      {receipt && showReceipt ? (
        <View style={{ backgroundColor: C.bg, borderRadius: R.sm, padding: SP.md, marginBottom: SP.sm }}>
          <Text style={S.muted}>{receipt.route.from ?? ''} → {receipt.route.to ?? ''}</Text>
          {receipt.fare?.lines.map((l, i) => <View key={i} style={[S.between, { paddingVertical: 2 }]}><Text style={[S.body, { flex: 1, paddingRight: 8 }]}>{pick(lang, l, 'label')}</Text><Money n={l.amount} /></View>)}
          <View style={[S.between, { borderTopWidth: 1, borderTopColor: C.line, marginTop: 4, paddingTop: 4 }]}><Text style={S.bold}>{t('opt.total')}</Text><Money n={receipt.total} style={S.bold} /></View>
          {receipt.payment?.paid_at ? <Text style={[S.muted, { marginTop: 4 }]}>{t('trip.receipt.paid')}: {fmtDateTime(receipt.payment.paid_at)}</Text> : null}
        </View>) : null}
      {sent ? <Text style={[S.h2, { textAlign: 'center', marginVertical: 12 }]}>{t('trip.rate.thanks')}</Text> : <>
        <Text style={[S.h2, { textAlign: 'center', marginTop: 12 }]}>{t('trip.rate')}</Text><Stars v={0} set={(n) => nav.push('r1rate', { id: b.id, score: n })} />
        <Btn testID="rate-open" kind="ghost" title={t('r1.rate.stars.cta')} onPress={() => nav.push('r1rate', { id: b.id })} /></>}
      <R1DriverPrefs b={b} />
      <View style={{ height: 8 }} /><Btn title={t('trip.rebook')} onPress={() => nav.reset('home')} /><View style={{ height: 8 }} />
      <Btn testID="report-claim" kind="ghost" title={t('cl.report')} onPress={() => nav.push('claimNew', { booking_id: b.id, ref: b.ref })} /><View style={{ height: 8 }} />
      <Btn kind="ghost" title={t('trip.problem')} onPress={() => nav.push('support', { booking_id: b.id })} />
    </Card>
  );
}

export { ChatModal } from '../chat';

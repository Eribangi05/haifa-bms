import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { label } from '../../lib/i18n';
import type { Offer } from '../../lib/types';
import { Btn, Card, Money, Pill, Text } from '../../ui/components';
import { C, S } from '../../ui/theme';

const secondsLeft = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
const GONE = ['offer_no_longer_available', 'offer_expired', 'offer_not_found'];

/** A trip offer with a live countdown. At 0 the accept button disables and the list refreshes once (the server also rejects late accepts). */
export function OfferCard({ o, done }: { o: Offer; done: () => void }) {
  const { t, lang, client, say, errMsg } = useApp(); const { busy, run } = useAsync();
  const [left, setLeft] = useState(secondsLeft(o.expires_at)); const [declining, setDeclining] = useState(false); const expiredNotified = useRef(false);
  useEffect(() => { const i = setInterval(() => setLeft(secondsLeft(o.expires_at)), 1000); return () => clearInterval(i); }, [o.expires_at]);
  useEffect(() => { if (left <= 0 && !expiredNotified.current) { expiredNotified.current = true; done(); } }, [left, done]);
  const accept = () => run(async () => {
    try { await client.post(`/bookings/${o.booking_id}/accept`); done(); }
    catch (e) { if (GONE.includes((e as { code?: string }).code ?? '')) { say(errMsg(e)); done(); } else throw e; }
  });
  const reject = (reason: string) => run(async () => { await client.post(`/bookings/${o.booking_id}/reject`, { reason }); done(); });
  return (
    <Card style={{ borderColor: left > 0 ? C.primary : C.line, borderWidth: 2, opacity: left > 0 ? 1 : 0.6 }}>
      <View style={S.between}><Text style={S.muted}>{left > 0 ? `${t('drv.expires')} ${left}${t('unit.s')}` : t('drv.offer.expired')}</Text><View style={S.row}>{o.hire_mode ? <Pill text="ABASARE" tone="ok" /> : null}<View style={{ width: 6 }} /><Pill text={o.payment_method === 'wallet' ? t('cr.prepaid') : label(lang, 'pm', o.payment_method)} tone="warn" /></View></View>
      {o.hire_mode ? <Text style={[S.body, { fontWeight: '700', marginTop: 6 }]}>{o.hire_mode === 'hourly' ? `${t('ab.offer.hourly')} · ${o.hours_booked} ${t('ab.h')}` : t('ab.offer.home')} · {t(('ab.cls.' + o.cv_class) as 'ab.cls.car')}, {o.cv_transmission === 'manual' ? t('ab.car.manual') : t('ab.car.auto')}</Text> : null}
      <Text style={[S.muted, { marginTop: 6 }]}>{t('drv.earn')}</Text><Money n={o.driver_net} style={{ fontSize: 34, fontWeight: '800', color: C.primary }} />
      <Text style={S.body}>{t('drv.pickupin')}: {(o.distance_m / 1000).toFixed(1)} km · {Math.max(1, Math.round(o.eta_s / 60))} {t('common.min')}</Text>
      {o.hire_mode === 'hourly' ? null : <Text style={S.body}>{t('drv.trip')}: {(o.trip_distance_m / 1000).toFixed(1)} km · {Math.max(1, Math.round(o.trip_duration_s / 60))} {t('common.min')}</Text>}
      <Text style={[S.muted, { marginTop: 4 }]}>{o.pickup_name ?? ''}{o.pickup_note ? ` · ${o.pickup_note}` : ''}{o.hire_mode === 'hourly' ? '' : ` → ${o.dest_name ?? ''}`}</Text>
      <View style={{ height: 10 }} />
      {declining ? <View style={{ gap: 6 }}><Text style={S.muted}>{t('drv.decline.reason')}</Text>
        {([['too_far', 'drv.reason.far'], ['safety_concern', 'drv.reason.safety'], ['connectivity', 'drv.reason.conn'], ['other', 'drv.reason.other']] as const).map(([k, l]) => <Btn key={k} kind="ghost" title={t(l)} onPress={() => reject(k)} disabled={busy} />)}
        <Btn kind="ghost" title={t('common.back')} onPress={() => setDeclining(false)} /></View>
        : <View style={[S.row, { gap: 10 }]}><View style={{ flex: 1 }}><Btn kind="ghost" title={t('drv.reject')} onPress={() => setDeclining(true)} big /></View><View style={{ flex: 2 }}><Btn title={t('drv.accept')} onPress={accept} loading={busy} disabled={left <= 0} big /></View></View>}
    </Card>
  );
}

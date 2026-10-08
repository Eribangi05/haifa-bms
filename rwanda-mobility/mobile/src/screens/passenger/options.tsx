import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { pick } from '../../lib/i18n';
import { ApiError, uuid } from '../../lib/net';
import { fmtDateTime, fmtMin } from '../../lib/format';
import type { Estimate, FareOption, Pt } from '../../lib/types';
import { Banner, Btn, Card, Chip, Field, IconBadge, Money, Pill, Screen, SectionTitle, SkeletonCard, Text, useFormFocus } from '../../ui/components';
import { C, R, S, SHADOW, SP } from '../../ui/theme';
import { SwitchRow } from '../../ui/r1Parts';
import { useCreditChoice } from '../r3/creditPay';
import { checkGuest, guestBody, isGuestError, optKey } from '../../lib/r2';
import { GuestSection, emptyGuest, type GuestState } from './r2Guest';
import { RepeatSection } from './r2Repeat';

type Params = { pickup: Pt; request_code?: string; dest?: Pt; note?: string; scheduled_for?: string; abasare?: { customer_vehicle_id: string; hours?: number }; guest?: boolean };
const GLYPH: Record<string, string> = { moto: '🛵', car: '🚗', comfort: '🚙', minivan: '🚐', abasare: '🧑‍✈️' };

export function Options({ params }: { params: Params }) {
  const { t, lang, client, nav, outbox, cfg, online, say, errMsg, me } = useApp();
  const [data, setData] = useState<Estimate | null>(null); const [err, setErr] = useState<ApiError | null>(null); const [sel, setSel] = useState<string | null>(null);
  const [method, setMethod] = useState('cash'); const [promo, setPromo] = useState(''); const [applied, setApplied] = useState(''); const [biz, setBiz] = useState<{ id: string; legal_name: string }[]>([]); const [corp, setCorp] = useState<string | null>(null);
  const [cc, setCc] = useState(''); const [po, setPo] = useState(''); const { busy, run } = useAsync(); const keyRef = useRef<string | null>(null);
  const [guest, setGuest] = useState<GuestState>(() => emptyGuest(lang, !!params.guest)); const [guestErr, setGuestErr] = useState<string | null>(null); const [att, setAtt] = useState(false); const [prefer, setPrefer] = useState(true); const [favs, setFavs] = useState(0); const f = useFormFocus(2); const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (code?: string) => {
    setErr(null); setRefreshing(true);
    try {
      const r = await client.post<Estimate>('/fares/estimate', { pickup: params.pickup, dest: params.dest, abasare: params.abasare, promo_code: code || undefined, scheduled_for: params.scheduled_for }, { retry: true });
      setData(r); const first = r.options.find((o) => o.available); setSel((s) => (s && r.options.find((o) => optKey(o) === s && o.available) ? s : first ? optKey(first) : null));
      keyRef.current = null;   // a new quote means a new booking attempt
    } catch (e) { setErr(e as ApiError); }
    finally { setRefreshing(false); }
  }, [client, params]);
  useEffect(() => { void load(); client.get('/users/me/drivers').then((r) => setFavs((r.drivers ?? []).filter((d: { kind: string }) => d.kind === 'favourite').length)).catch(() => {}); client.get('/businesses/mine').then((r) => setBiz(r.businesses.filter((b: { status: string }) => b.status === 'active'))).catch(() => {}); }, [load, client]);

  const opt = data?.options.find((o) => optKey(o) === sel);
  const guestOn = guest.on && !params.abasare; const guestOk = !guestOn || checkGuest(guest, me?.phone).ok;
  const momo = cfg?.payment_methods.find((m) => m.id === 'mtn_momo');
  const cc3 = useCreditChoice(opt?.fare?.total, method, !!corp);   // round 3: pay with credit (full / partial)
  const confirm = () => run(async () => {
    if (!opt?.quote_id) return;
    keyRef.current = keyRef.current ?? uuid();                         // same key on every retry of this tap: never a duplicate booking
    const body = { quote_id: opt.quote_id, payment_method: corp ? 'corporate' : method, ...(corp ? {} : cc3.fields), pickup_name: params.pickup.name, pickup_note: params.note || undefined, request_code: params.request_code, prefer_favourite: prefer, dest_name: params.dest?.name ?? params.pickup.name,
      ...(params.abasare ? { customer_vehicle_id: params.abasare.customer_vehicle_id, owner_attested: att } : {}),
      ...(guestOn ? { for_guest: guestBody(guest) } : {}),
      ...(corp ? { corporate_id: corp, cost_centre: cc || undefined, po_ref: po || undefined } : {}) };
    setGuestErr(null);
    try {
      const r = await client.post('/bookings', body, { idempotencyKey: keyRef.current });
      nav.reset('track', { id: r.booking.id });
    } catch (e) {
      const ae = e as ApiError;
      if (ae instanceof ApiError && ae.isNetwork) {
        await outbox.enqueue({ id: 'booking-' + keyRef.current, kind: 'booking', path: '/bookings', body, key: keyRef.current!, treatConflictAsDone: true });
        nav.reset('track', { pending: true });
      } else if (ae?.code === 'quote_expired' || ae?.code === 'promo_invalid') { say(t('opt.quote.expired')); void load(applied); }
      else if (guestOn && isGuestError(ae?.code)) setGuestErr(errMsg(e));
      else if (ae?.code === 'active_booking_exists') nav.reset('track', { id: (ae.details as { id?: string } | undefined)?.id });
      else if (ae?.code === 'insufficient_credit') say(t('cr.err.insufficient_credit'));
      else throw e;
    }
  });
  const applyPromo = () => { if (!promo.trim()) return; setApplied(promo.trim()); void load(promo.trim()); };
  const canConfirm = !!opt?.available && !(params.abasare && !att) && guestOk;
  const total = opt?.fare?.total;
  const title = params.abasare ? t('ab.options.title') : t('opt.title');
  const summary = `${params.pickup.name ?? ''}${params.dest ? ` → ${params.dest.name}` : params.abasare?.hours ? ` · ${params.abasare.hours} ${t('ab.h')}` : ''}`;

  return (
    <Screen title={title} onBack={() => nav.pop()} onRefresh={() => load(applied)}
      footer={data ? <>
        {total != null ? <View style={S.between}><Text style={S.muted}>{t('opt.total')}</Text><Money n={total} style={{ fontSize: 20, fontWeight: '800', color: C.primary }} /></View> : null}
        <Btn testID="cta" big title={params.abasare && !att ? t('ab.attest.need') : t('opt.confirm')} onPress={confirm} loading={busy} disabled={!canConfirm} />
        {!data.options.some((o) => o.available) ? <Btn kind="ghost" title={t('trip.alt.later')} onPress={() => nav.pop()} /> : null}
      </> : undefined}>
      {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
      <Text style={S.muted}>{summary}</Text>
      {params.scheduled_for ? <View style={{ marginTop: 6 }}><Pill tone="warn" glyph="⏰" text={`${t('trip.scheduled')} · ${fmtDateTime(params.scheduled_for)}`} /></View> : null}
      <View style={{ height: SP.md }} />
      {err ? <Banner kind="bad" text={err.code === 'pickup_outside_coverage' ? err.message : errMsg(err)} action={<Btn title={t('common.retry')} onPress={() => load(applied)} loading={refreshing} />} /> : null}
      {!data && !err ? <><SkeletonCard /><SkeletonCard /></> : null}
      {data ? <>
        {data.alternatives.length ? <Banner text={`${t('opt.nodrivers')}. ${t('opt.alt')}`} /> : null}
        {data.options.map((o: FareOption) => (
          <Pressable key={optKey(o)} testID={o.fixed_price ? 'opt-fixed' : undefined} disabled={!o.available} onPress={() => setSel(optKey(o))} accessibilityRole="radio" accessibilityLabel={`${o.fixed_price ? t('r2.fixed.badge') + ', ' : ''}${pick(lang, o.fixed_price && o.fixed_route ? o.fixed_route : o, 'name')}`} accessibilityState={{ selected: sel === optKey(o), disabled: !o.available }}>
            <Card style={[{ borderColor: sel === optKey(o) ? C.primary : C.line, borderWidth: sel === optKey(o) ? 2 : 1, opacity: o.available ? 1 : 0.55 }, sel === optKey(o) ? SHADOW.raised : null]}>
              <View style={[S.row, { gap: SP.md }]}>
                <IconBadge glyph={GLYPH[o.service_id] ?? (o.kind === 'abasare' ? '🧑‍✈️' : '🚗')} bg={sel === optKey(o) ? C.okBg : C.bg} />
                <View style={{ flex: 1 }}>
                  {o.fixed_price ? <View style={{ marginBottom: 4 }}><Pill tone="warn" glyph="🏷" text={t('r2.fixed.badge')} /></View> : null}
                  <Text style={S.h2}>{o.fixed_price && o.fixed_route ? pick(lang, o.fixed_route, 'name') : pick(lang, o, 'name')}</Text>
                  <Text style={S.muted}>{o.kind === 'abasare' ? t('ab.trip.yourcar') : `${o.capacity} ${t('opt.seats')}`}{o.pickup_eta_s ? ` · ${t('opt.eta')} ${fmtMin(o.pickup_eta_s)} ${t('common.min')}` : ''}</Text>
                  {!o.available ? <Text style={{ color: C.danger, fontSize: 13 }}>{t('opt.unavailable')}</Text> : null}
                </View>
                {o.fare ? <View style={{ alignItems: 'flex-end' }}><Money n={o.fare.total} style={[S.h2, { color: C.primary }]} />{o.fare.discount ? <Text style={{ color: C.primary, fontSize: 12 }}>−{o.fare.discount}</Text> : null}</View> : null}
              </View>
            </Card>
          </Pressable>))}
        {opt?.fare ? <Card>
          <Text style={S.h2}>{t('opt.breakdown')}</Text>
          {opt.fare.lines.map((l, i) => <View key={i} style={[S.between, { paddingVertical: 3 }]}><Text style={[S.body, { flex: 1, paddingRight: 8 }]}>{pick(lang, l, 'label')}</Text><Money n={l.amount} /></View>)}
          <View style={[S.between, { borderTopWidth: 1, borderTopColor: C.line, marginTop: 6, paddingTop: 6 }]}><Text style={[S.body, { fontWeight: '700' }]}>{t('opt.total')}</Text><Money n={opt.fare.total} style={{ fontWeight: '700', fontSize: 17 }} /></View>
          {opt.fixed_price ? <Text style={[S.muted, { marginTop: 8 }]}>{t('r2.fixed.note')}</Text> : null}
          <Text style={[S.muted, { marginTop: 8 }]}>{params.abasare ? t('ab.fare.note') : t('opt.estimate') + (opt.route_source === 'estimate' ? ' ' + t('opt.route.estimate') : '')}</Text>
        </Card> : null}
        <View style={[S.row, { alignItems: 'flex-start' }]}><View style={{ flex: 1 }}><Field value={promo} onChangeText={setPromo} placeholder={t('opt.promo')} autoCapitalize="characters" autoCorrect={false} returnKeyType="done" onSubmitEditing={applyPromo} /></View><View style={{ width: 8 }} /><Btn kind="ghost" title={t('opt.apply')} onPress={applyPromo} disabled={!promo.trim()} /></View>
        {opt?.promo ? (opt.promo.discount ? <Banner kind="ok" text={`${t('opt.promo.ok')}: −${opt.promo.discount} RWF`} /> : <Banner kind="bad" text={t('opt.promo.bad')} />) : null}
        <Card><SwitchRow testID="opt-prefer-fav" label={t('r1.opt.prefer')} hint={favs ? t('r1.opt.prefer.hint') : t('r1.opt.prefer.none')} value={prefer} onChange={setPrefer} /></Card>
        <SectionTitle text={t('opt.pay')} />
        <View style={S.wrap}>
          <Chip glyph="💵" text={t('opt.cash')} on={!corp && method === 'cash'} onPress={() => { setCorp(null); setMethod('cash'); }} />
          {momo?.enabled ? <Chip glyph="📱" text={momo.simulated ? t('opt.momo.sim') : t('opt.momo')} on={!corp && method === 'mtn_momo'} onPress={() => { setCorp(null); setMethod('mtn_momo'); }} /> : null}
          {biz.map((b) => <Chip key={b.id} glyph="🏢" text={`${t('opt.corporate')}: ${b.legal_name}`} on={corp === b.id} onPress={() => setCorp(b.id)} />)}
        </View>
        {corp ? <><Field {...f(0)} label={t('biz.cc')} value={cc} onChangeText={setCc} maxLength={60} /><Field {...f(1)} label={t('biz.po')} value={po} onChangeText={setPo} maxLength={60} /></> : null}
        <GuestSection value={guest} onChange={(g) => { setGuest(g); setGuestErr(null); }} disabled={!!params.abasare} error={guestErr} />
        <RepeatSection canRepeat={!!(params.dest || params.abasare?.hours) && !!opt}
          build={(f) => opt ? { service_id: opt.service_id, pickup: params.pickup, dest: params.dest ?? params.pickup, days_of_week: f.days, local_time: f.time, start_date: f.start, end_date: f.end, payment_method: method === 'mtn_momo' && !corp ? 'mtn_momo' : 'cash', ...(params.abasare ? { customer_vehicle_id: params.abasare.customer_vehicle_id, hours: params.abasare.hours, owner_attested: att } : {}) } : null}
          onSaved={() => nav.replace('schedules')} />
        {cc3.node}
        {params.abasare ? <Text style={[S.muted, { marginBottom: SP.sm }]}>{t('dp.opt.note')}</Text> : null}
        {params.abasare ? <Pressable onPress={() => setAtt(!att)} accessibilityRole="checkbox" accessibilityState={{ checked: att }} accessibilityLabel={t('ab.attest')} style={{ marginTop: SP.sm }}><Card style={{ borderColor: att ? C.primary : C.line, borderRadius: R.md }}><Text style={S.body}>{att ? '☑ ' : '☐ '}{t('ab.attest')}</Text></Card></Pressable> : null}
      </> : null}
    </Screen>
  );
}

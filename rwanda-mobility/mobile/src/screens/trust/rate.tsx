import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync, usePoll } from '../../lib/app';
import { ApiError, uuid } from '../../lib/net';
import { kv } from '../../lib/storage';
import { payUi } from '../../lib/trip';
import { checkTip, orderTags, parseAmount, ratedKey, tagLabel, tipPresets, type R1Config, type TipResult } from '../../lib/trustApi';
import type { Booking, PaymentView } from '../../lib/types';
import { Banner, Btn, Card, Chip, EmptyState, Field, Screen, SectionTitle, Skeleton, Text } from '../../ui/components';
import { TagChip } from '../../ui/trustParts';
import { Stars } from '../passenger/tripParts';
import { R1DriverPrefs } from './favouriteDrivers';
import { C, S, SP } from '../../ui/theme';
import type { TKey } from '../../lib/i18n';

type TipState = { phase: 'idle' | 'sending' | 'pending' | 'done' | 'failed'; msg?: string; paymentId?: string; method?: string };

/**
 * After a completed trip: stars, localized tag chips (ride vs Abasare, from /config), comment and an optional tip (cash or MoMo).
 * The rating is saved FIRST on its own; a tip problem never loses it (the tip is retried or skipped separately).
 */
export function R1Rate({ params }: { params: { id: string; score?: number } }) {
  const { t, lang, client, cfg, me, nav, outbox, errMsg, online } = useApp(); const { busy, run } = useAsync();
  const [b, setB] = useState<Booking | null>(null); const [loadErr, setLoadErr] = useState<ApiError | null>(null);
  const [score, setScore] = useState(params.score ?? 0); const [tags, setTags] = useState<string[]>([]); const [comment, setComment] = useState('');
  const [amount, setAmount] = useState<number | null>(null); const [custom, setCustom] = useState(''); const [method, setMethod] = useState<'cash_tip' | 'mtn_momo'>('cash_tip'); const [msisdn, setMsisdn] = useState(me?.phone ?? '');
  const [saved, setSaved] = useState<'no' | 'online' | 'offline'>('no'); const [tip, setTip] = useState<TipState>({ phase: 'idle' }); const [existing, setExisting] = useState<TipResult | null>(null);
  const tipKey = useRef(uuid()); const since = useRef<number | null>(null); const [now, setNow] = useState(Date.now());
  const c = (cfg ?? {}) as R1Config; const tipCfg = c.tips?.enabled ? c.tips : null;
  const load = () => { setLoadErr(null); client.get<Booking>(`/bookings/${params.id}`).then(setB).catch((e) => setLoadErr(e)); };
  useEffect(() => { load(); client.get<{ tip: TipResult | null }>(`/bookings/${params.id}/tip`).then((r) => setExisting(r.tip)).catch(() => {}); }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const isAb = !!b?.abasare; const scope = isAb ? 'abasare' : 'ride';
  const list = useMemo(() => orderTags(c.rating_tags?.[scope] ?? [], score || 5), [c.rating_tags, scope, score]);
  const typed = parseAmount(custom); const chosen = typed ?? amount; const check = tipCfg && chosen != null ? checkTip(chosen, tipCfg.min_amount, tipCfg.max_amount) : 'empty';
  const msisdnOk = /^(?:\+?250|0)?7[2389]\d{7}$/.test(msisdn.replace(/[\s-]/g, ''));
  const tipReady = !!tipCfg && check === 'ok' && (method === 'cash_tip' || msisdnOk);
  const wantTip = !!tipCfg && chosen != null;
  const driverName = b?.driver?.name ?? '';

  // MoMo tip: poll the payment like a fare payment; the UI state comes only from the server.
  const pay = usePoll(() => client.get<PaymentView>(`/payments/${tip.paymentId}`), 3000, [tip.paymentId], tip.phase === 'pending' && !!tip.paymentId);
  useEffect(() => {
    const st = pay.data?.status; if (!st || tip.phase !== 'pending') return;
    if (st === 'SUCCESS') setTip({ phase: 'done', method: 'mtn_momo' }); else if (payUi(st, 0) === 'failed') setTip({ phase: 'failed', msg: pay.data?.failure_reason ?? undefined, method: 'mtn_momo' });
  }, [pay.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tip.phase !== 'pending') { since.current = null; return; } since.current = since.current ?? Date.now(); const i = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(i); }, [tip.phase]);
  const slow = tip.phase === 'pending' && since.current != null && payUi('PENDING', now - since.current) === 'slow';

  const sendTip = async () => {
    if (!tipReady || chosen == null) return;
    setTip({ phase: 'sending' });
    try {
      const r = await client.post<TipResult>(`/bookings/${params.id}/tip`, { amount: chosen, method, ...(method === 'mtn_momo' ? { msisdn } : {}) }, { idempotencyKey: tipKey.current });
      if (r.method === 'cash_tip' || r.status === 'SUCCESS' || r.status === 'recorded') setTip({ phase: 'done', method: r.method });
      else if (r.status === 'FAILED') { tipKey.current = uuid(); setTip({ phase: 'failed' }); }
      else setTip({ phase: 'pending', paymentId: r.payment_id ?? undefined, method: r.method });
    } catch (e) {
      tipKey.current = uuid();   // a definitive refusal: the next attempt is a new request
      if ((e as ApiError).code === 'tip_exists') { setTip({ phase: 'done', method }); return; }
      setTip({ phase: 'failed', msg: errMsg(e) });
    }
  };
  const submit = () => run(async () => {
    if (!score) return;
    if (saved === 'no') {
      const body = { score, comment: comment.trim() || undefined, tags: tags.length ? tags : undefined };
      try { await client.post(`/bookings/${params.id}/ratings`, body, { idempotencyKey: 'rate-' + params.id + '-passenger' }); setSaved('online'); }
      catch (e) {
        const ae = e as ApiError;
        if (ae.code === 'already_rated') setSaved('online');
        else if (ae.isNetwork || ae.isTimeout) { await outbox.enqueue({ id: 'rate-' + params.id, kind: 'rating', path: `/bookings/${params.id}/ratings`, body, key: 'rate-' + params.id + '-passenger', treatConflictAsDone: true }); void outbox.flush(); setSaved('offline'); }
        else throw e;
      }
      try { await kv.set(ratedKey(params.id), '1'); } catch { /* optional */ }
    }
    if (wantTip && tipReady && !existing && tip.phase === 'idle') await sendTip();
  });
  const toggle = (id: string) => setTags((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const home = () => nav.reset('home');

  if (!b) return (
    <Screen title={t('r1.rate.title')} onBack={() => nav.pop()}>
      {loadErr ? <Banner kind="bad" text={errMsg(loadErr)} action={<Btn kind="ghost" title={t('common.retry')} onPress={load} />} /> : <Card><Skeleton height={22} width="60%" /><Skeleton height={40} style={{ marginTop: 14 }} /></Card>}
    </Screen>);

  const finished = saved !== 'no' && (!wantTip || existing != null || tip.phase === 'done' || tip.phase === 'idle' && !tipReady);
  const tipBusy = tip.phase === 'sending' || tip.phase === 'pending';
  return (
    <Screen title={t('r1.rate.title')} onBack={() => nav.pop()}
      footer={saved === 'no'
        ? <Btn testID="cta" big title={wantTip && tipReady && !existing ? t('r1.rate.send.tip', { amount: chosen ?? 0 }) : t('r1.rate.send')} onPress={submit} loading={busy} disabled={!score || (wantTip && !existing && !tipReady)} />
        : <Btn testID="cta" big title={t('r1.rate.home')} onPress={home} disabled={tipBusy} />}>
      {saved !== 'no' ? <Banner kind="ok" text={saved === 'offline' ? t('r1.rate.saved.offline') : t('r1.rate.saved')} /> : null}

      <Card>
        <Text style={[S.h2, { textAlign: 'center' }]}>{(isAb ? t('r1.rate.how.ab', { name: driverName }) : t('r1.rate.how', { name: driverName })).replace(/\s+\?/, ' ?').replace('  ', ' ')}</Text>
        <Stars v={score} set={saved === 'no' ? setScore : () => {}} />
        <Text accessibilityLiveRegion="polite" style={[S.bold, { textAlign: 'center', color: score ? C.primary : C.muted }]}>{score ? t(`r1.rate.s${score}` as TKey) : t('r1.rate.tap')}</Text>
      </Card>

      {saved === 'no' && list.length ? <>
        <SectionTitle text={t('r1.rate.tags')} />
        <Text style={[S.muted, { marginBottom: SP.sm }]}>{t('r1.rate.tags.hint')}</Text>
        <View style={S.wrap}>{list.map((x) => <TagChip key={x.id} text={tagLabel(x, lang)} tone={x.kind} on={tags.includes(x.id)} onPress={() => toggle(x.id)} />)}</View>
        <Field value={comment} onChangeText={setComment} placeholder={t('trip.rate.comment')} multiline maxLength={400} />
      </> : null}

      {tipCfg ? <>
        <SectionTitle text={t('r1.tip.title')} />
        <Card>
          {existing ? <Text style={S.body}>{t('r1.tip.already', { amount: existing.amount })}</Text> : tip.phase === 'done' ? <Banner kind="ok" text={tip.method === 'cash_tip' ? t('r1.tip.cash.done') : t('r1.tip.done')} /> : <>
            <Text style={S.muted}>{t('r1.tip.sub')}</Text>
            <View style={[S.wrap, { marginTop: SP.sm }]}>
              <Chip text={t('r1.tip.none')} on={chosen == null} onPress={() => { setAmount(null); setCustom(''); }} />
              {tipPresets(tipCfg.min_amount, tipCfg.max_amount).map((a) => <Chip key={a} text={`${a.toLocaleString('en-US')} RWF`} on={typed == null && amount === a} onPress={() => { setAmount(a); setCustom(''); }} />)}
            </View>
            <Field label={t('r1.tip.custom')} value={custom} onChangeText={(x) => { setCustom(x.replace(/\D/g, '').slice(0, 7)); }} keyboardType="number-pad" maxLength={7}
              error={chosen != null && check === 'low' ? t('r1.tip.low', { min: tipCfg.min_amount }) : chosen != null && check === 'high' ? t('r1.tip.high', { max: tipCfg.max_amount }) : undefined} />
            {chosen != null ? <>
              <Text style={S.muted}>{t('r1.tip.method')}</Text>
              <View style={[S.wrap, { marginTop: SP.xs }]}>
                {tipCfg.methods.includes('cash_tip') ? <Chip glyph="💵" text={t('r1.tip.cash')} on={method === 'cash_tip'} onPress={() => setMethod('cash_tip')} /> : null}
                {tipCfg.methods.includes('mtn_momo') ? <Chip glyph="📱" text={t('r1.tip.momo')} on={method === 'mtn_momo'} onPress={() => setMethod('mtn_momo')} /> : null}
              </View>
              {method === 'cash_tip' ? <Text style={S.muted}>{t('r1.tip.cash.note')}</Text>
                : <Field label={t('trip.pay.msisdn')} value={msisdn} onChangeText={setMsisdn} keyboardType="phone-pad" maxLength={16} error={msisdn.length > 4 && !msisdnOk ? t('auth.invalid') : undefined} />}
            </> : null}
          </>}
          {tip.phase === 'sending' ? <Banner text={t('common.loading')} /> : null}
          {tip.phase === 'pending' ? <Banner text={slow ? t('r1.tip.slow') : t('r1.tip.pending')} action={slow ? <Btn kind="ghost" title={t('r1.tip.check')} onPress={pay.reload} /> : undefined} /> : null}
          {tip.phase === 'failed' ? <Banner kind="bad" text={`${t('r1.tip.failed')}${tip.msg ? ' ' + tip.msg : ''}`} action={<View style={{ gap: 8 }}>
            {saved !== 'no' && tipReady ? <Btn testID="tip-retry" kind="ghost" title={t('r1.tip.retry')} onPress={() => { setTip({ phase: 'idle' }); setTimeout(() => void sendTip(), 0); }} disabled={!online} /> : null}
            <Btn kind="ghost" title={t('r1.tip.skip')} onPress={() => { setTip({ phase: 'idle' }); setAmount(null); setCustom(''); }} /></View>} /> : null}
        </Card>
      </> : null}

      {saved !== 'no' && b ? <R1DriverPrefs b={b} /> : null}
    </Screen>
  );
}

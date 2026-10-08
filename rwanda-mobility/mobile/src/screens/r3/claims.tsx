import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, View, useWindowDimensions } from 'react-native';
import { API_URL } from '../../config';
import { useApp, useAsync, usePoll } from '../../lib/app';
import { explainCameraDenied } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { label, type TKey } from '../../lib/i18n';
import { ApiError } from '../../lib/net';
import { CLAIM_TYPES, claimCanAddEvidence, claimCanAddInfo, claimCanReply, claimCanWithdraw, claimFormValid, claimGlyph, claimIsOpen, claimTone, dueIn, type ClaimType } from '../../lib/money3';
import { appendFile, pickPhoto, type Picked } from '../../lib/upload';
import { Banner, Btn, Card, Chip, EmptyState, Field, IconBadge, LinkBtn, Money, Pill, RemoteImage, Screen, SectionTitle, SkeletonCard, Text } from '../../ui/components';
import { showAlert } from '../../ui/dialog';
import { C, R, S, SP } from '../../ui/theme';

export type ClaimBrief = {
  id: string; ref: string; booking_id: string; type: string; status: string; claimed_amount: number; description: string; you_are: 'claimant' | 'respondent'; claimant_role: string; respondent_role: string;
  reply_due_at: string | null; replied: boolean; info_due_at: string | null; decision: { amount: number; reason: string; at: string } | null; settlement: { kind: string; amount: number; at: string } | null; created_at: string; updated_at: string;
};
type Ev = { id: number; author_role: string; kind: string; body: string | null; meta: Record<string, any>; created_at: string };
type Evid = { id: string; source: string; phase?: string | null; caption?: string | null; at: string; url: string };
type Side = { record: { odometer_km: number; fuel_percent: number; notes?: string | null; damage_noted?: boolean } | null; photos: string[] };
type ClaimFull = ClaimBrief & { events: Ev[]; evidence: Evid[]; booking: { ref: string; pickup?: string; destination?: string; completed_at?: string; abasare: boolean } | null; comparison: { pickup: Side; dropoff: Side } | null };
const MAX_PHOTOS = 5;

const mapClaimError = (t: (k: TKey) => string, e: unknown): string | null => {
  const c = (e as ApiError)?.code; const k = c ? (`cl.err.${c}` as TKey) : null;
  return k && ['claim_window_closed', 'claim_exists', 'too_many_evidence', 'claim_closed', 'claim_transition'].includes(c as string) ? t(k) : null;
};

/** Camera / gallery buttons; the picked file goes to `onPick`. Handles permission refusal with the shared explanation. */
function PhotoButtons({ onPick, disabled }: { onPick: (f: Picked) => void | Promise<void>; disabled?: boolean }) {
  const { t, say } = useApp();
  const go = async (src: 'camera' | 'gallery') => {
    try { const r = await pickPhoto(src); if ('denied' in r) { explainCameraDenied(t, r.blocked); return; } if ('file' in r) await onPick(r.file); } catch { say(t('cl.photo.denied')); }
  };
  return <View style={S.wrap}><Chip glyph="📷" text={t('drv.photo.take')} onPress={() => !disabled && void go('camera')} /><Chip glyph="🖼️" text={t('drv.photo.pick')} onPress={() => !disabled && void go('gallery')} /></View>;
}

export function ClaimStatusPill({ status }: { status: string }) {
  const { t } = useApp(); return <Pill tone={claimTone(status)} glyph={claimGlyph(status)} text={t(`cl.st.${status}` as TKey)} />;
}
const typeLabel = (t: (k: TKey) => string, ty: string) => (CLAIM_TYPES as readonly string[]).includes(ty) ? t(`cl.type.${ty}` as TKey) : t('cl.type.other');

// ------------------------------------------------------------------ list
export function ClaimsList({ params }: { params?: { ref?: string } }) {
  const { t, client, nav, errMsg, mode } = useApp(); const driver = mode === 'driver';
  const list = usePoll(() => client.get<{ claims: ClaimBrief[] }>('/claims'), 20000);
  const all = list.data?.claims; const claims = all && driver ? all.filter((c) => c.you_are === 'respondent') : all;
  useEffect(() => { const hit = params?.ref ? all?.find((c) => c.ref === params.ref) : null; if (hit) nav.replace('claimDetail', { id: hit.id }); }, [all, params?.ref]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Screen title={driver ? t('cl.title.about') : t('cl.title')} onBack={() => nav.pop()} onRefresh={async () => { list.reload(); await new Promise((r) => setTimeout(r, 500)); }}>
      {list.error && !all ? <Banner kind="bad" text={errMsg(list.error)} action={<Btn kind="ghost" title={t('common.retry')} onPress={list.reload} />} /> : null}
      {!all && !list.error ? <><SkeletonCard /><SkeletonCard /></> : null}
      {claims && !claims.length ? <EmptyState glyph="🛡️" title={t('cl.empty.title')} body={driver ? t('cl.empty.driver') : t('cl.empty')} /> : null}
      {claims?.map((c) => {
        const reply = c.you_are === 'respondent' && claimIsOpen(c.status) && !c.replied ? dueIn(c.reply_due_at) : null;
        const info = c.you_are === 'claimant' && c.status === 'info_requested' ? dueIn(c.info_due_at) : null;
        const due = reply ?? info;
        return (
          <Pressable key={c.id} testID="claim-row" onPress={() => nav.push('claimDetail', { id: c.id })} accessibilityRole="button" accessibilityLabel={`${c.ref}, ${typeLabel(t, c.type)}, ${t(`cl.st.${c.status}` as TKey)}`} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
            <Card>
              <View style={[S.row, { gap: SP.md, alignItems: 'flex-start' }]}>
                <IconBadge glyph={claimGlyph(c.status)} bg={C.skyBg} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={S.bold}>{typeLabel(t, c.type)} · {c.ref}</Text>
                  <Text style={S.muted} numberOfLines={2}>{c.description}</Text>
                  <View style={{ marginTop: SP.xs + 2 }}><ClaimStatusPill status={c.status} /></View>
                  <Text style={[S.muted, { marginTop: 4 }]}>{t(`cl.role.${c.you_are}` as TKey)} · {fmtDateTime(c.created_at)}</Text>
                  {due ? <Text style={{ color: due.late ? C.danger : C.warn, fontWeight: '700', marginTop: 2 }}>{reply ? (due.late ? t('cl.due.reply.late') : t('cl.due.reply', { n: due.hours })) : due.late ? t('cl.due.info.late') : t('cl.due.info', { n: due.hours })}</Text> : null}
                </View>
                <Money n={c.claimed_amount} style={{ fontWeight: '700', color: C.ink }} />
              </View>
            </Card>
          </Pressable>);
      })}
    </Screen>
  );
}

// ------------------------------------------------------------------ new claim
export function ClaimNew({ params }: { params: { booking_id: string; ref?: string } }) {
  const { t, client, nav, say, errMsg } = useApp(); const { busy, run } = useAsync();
  const [type, setType] = useState<ClaimType>('damage'); const [desc, setDesc] = useState(''); const [amount, setAmount] = useState(''); const [photos, setPhotos] = useState<Picked[]>([]); const [err, setErr] = useState<string | null>(null);
  const keyDone = useRef<string | null>(null);   // a claim created by a previous tap on this screen (never create twice)
  const valid = claimFormValid(desc, amount);
  const submit = () => run(async () => {
    setErr(null);
    try {
      let id = keyDone.current;
      if (!id) { const r = await client.post<{ id: string; ref: string }>(`/bookings/${params.booking_id}/claims`, { type, description: desc.trim(), claimed_amount: Number(amount) }, { retry: false }); id = r.id; keyDone.current = id; say(t('cl.sent', { ref: r.ref })); }
      let failed = 0;
      for (const p of photos.splice(0, photos.length)) {
        try { const fd = new FormData(); await appendFile(fd, 'file', p); await client.post(`/claims/${id}/evidence`, undefined, { form: fd, timeoutMs: 40000 }); } catch { failed++; }
      }
      if (failed) say(t('cl.sent.photos', { n: failed }));
      nav.replace('claimDetail', { id });
    } catch (e) { setErr(mapClaimError(t, e) ?? errMsg(e)); }
  });
  return (
    <Screen title={t('cl.new')} onBack={() => nav.pop()} footer={<Btn testID="cta" big title={busy ? t('cl.sending') : t('cl.submit')} onPress={submit} loading={busy} disabled={!valid} />}>
      <Text style={[S.body, { marginBottom: SP.md }]}>{t('cl.new.intro')}</Text>
      {err ? <Banner kind="bad" text={err} /> : null}
      <Text accessibilityRole="header" style={S.bold}>{t('cl.type')}</Text>
      <View style={[S.wrap, { marginVertical: SP.sm }]}>{CLAIM_TYPES.map((x) => <Chip key={x} text={t(`cl.type.${x}` as TKey)} on={type === x} onPress={() => setType(x)} />)}</View>
      <Field testID="claim-desc" label={t('cl.desc')} value={desc} onChangeText={setDesc} multiline maxLength={2000} placeholder={t('cl.desc.hint')} blurOnSubmit={false} returnKeyType="default" />
      <Field testID="claim-amount" label={t('cl.amount')} value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 9))} keyboardType="number-pad" returnKeyType="done" error={amount.length > 0 && !/^[1-9]\d*$/.test(amount) ? t('cl.amount.hint') : undefined} />
      <Text accessibilityRole="header" style={S.bold}>{t('cl.photos')}</Text>
      <Text style={S.muted}>{t('cl.photos.hint')} {t('cl.photos.max', { n: MAX_PHOTOS })}</Text>
      <View style={[S.wrap, { marginVertical: SP.sm, gap: SP.sm }]}>
        {photos.map((p, i) => (
          <View key={p.uri + i}>
            <Image source={{ uri: p.uri }} accessibilityLabel={t('cl.photo.n', { n: i + 1 })} style={{ width: 84, height: 64, borderRadius: 8, backgroundColor: C.line }} />
            <Pressable onPress={() => setPhotos(photos.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={t('cl.photo.remove', { n: i + 1 })} style={{ position: 'absolute', top: -10, right: -10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800' }}>✕</Text></View></Pressable>
          </View>))}
      </View>
      {photos.length < MAX_PHOTOS ? <PhotoButtons onPick={(f) => setPhotos((x) => (x.length < MAX_PHOTOS ? [...x, f] : x))} disabled={busy} /> : null}
    </Screen>
  );
}

// ------------------------------------------------------------------ detail
function Compare({ cmp }: { cmp: NonNullable<ClaimFull['comparison']> }) {
  const { t } = useApp(); const { width } = useWindowDimensions(); const narrow = width < 340;
  const col = (title: string, s: Side) => (
    <View style={{ flex: 1, minWidth: 130 }}>
      <Text style={S.bold}>{title}</Text>
      {s.record ? <Text style={S.muted}>{t('cl.compare.odo', { n: Number(s.record.odometer_km).toLocaleString('en-US'), f: s.record.fuel_percent })}</Text> : null}
      {s.photos.length ? <View style={[S.wrap, { gap: 6, marginTop: 4 }]}>{s.photos.map((u, i) => <RemoteImage key={u.split('?')[0]} url={API_URL + u} size={{ width: 84, height: 64, radius: 8 }} label={`${title} ${i + 1}`} />)}</View> : <Text style={S.muted}>{t('cl.compare.none')}</Text>}
    </View>);
  return <Card><Text accessibilityRole="header" style={S.h2}>{t('cl.compare')}</Text><View style={{ flexDirection: narrow ? 'column' : 'row', gap: SP.md, marginTop: SP.sm }}>{col(t('cl.compare.pickup'), cmp.pickup)}{col(t('cl.compare.dropoff'), cmp.dropoff)}</View></Card>;
}

export function ClaimDetail({ params }: { params: { id: string } }) {
  const { t, lang, client, nav, say, errMsg } = useApp(); const { busy, run } = useAsync();
  const poll = usePoll(() => client.get<ClaimFull>(`/claims/${params.id}`), 30000, [params.id]);
  const c = poll.data; const [msg, setMsg] = useState(''); const [upBusy, setUpBusy] = useState(false);
  const act = useCallback((fn: () => Promise<void>) => run(async () => { try { await fn(); } catch (e) { const m = mapClaimError(t, e); if (m) { say(m); poll.reload(); } else throw e; } }), [run, t, say, poll]);
  const events = useMemo(() => (c?.events ?? []).filter((e) => e.kind !== 'reminder'), [c?.events]);
  if (!c) return (
    <Screen title={t('cl.title')} onBack={() => nav.pop()}>
      {poll.error ? <Banner kind="bad" text={errMsg(poll.error)} action={<Btn kind="ghost" title={t('common.retry')} onPress={poll.reload} />} /> : <SkeletonCard />}
    </Screen>);
  const send = (kind: 'reply' | 'info') => act(async () => { await client.post(`/claims/${c.id}/messages`, { body: msg.trim() }, { retry: false }); setMsg(''); say(t(kind === 'reply' ? 'cl.reply.sent' : 'cl.info.sent')); poll.reload(); });
  const addPhoto = async (f: Picked) => { setUpBusy(true); try { await act(async () => { const fd = new FormData(); await appendFile(fd, 'file', f); await client.post(`/claims/${c.id}/evidence`, undefined, { form: fd, timeoutMs: 40000 }); say(t('cl.evidence.uploaded')); poll.reload(); }); } finally { setUpBusy(false); } };
  const withdraw = () => showAlert(t('cl.withdraw'), t('cl.withdraw.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), style: 'destructive', onPress: () => void act(async () => { await client.post(`/claims/${c.id}/withdraw`, {}, { retry: false }); say(t('cl.withdrawn')); poll.reload(); }) }]);
  const reply = claimCanReply(c); const info = claimCanAddInfo(c);
  const dueReply = c.you_are === 'respondent' && !c.replied ? dueIn(c.reply_due_at) : null; const dueInfo = info ? dueIn(c.info_due_at) : null;
  const whoLabel = (r: string) => (['owner', 'passenger', 'driver', 'staff', 'system'].includes(r) ? t(`cl.who.${r}` as TKey) : t('cl.who.system'));
  return (
    <Screen title={t('cl.detail', { ref: c.ref })} onBack={() => nav.pop()} onRefresh={async () => { poll.reload(); await new Promise((r) => setTimeout(r, 500)); }}>
      <Card>
        <View style={S.between}><Text style={S.h2}>{typeLabel(t, c.type)}</Text><ClaimStatusPill status={c.status} /></View>
        <Text style={[S.muted, { marginTop: 2 }]}>{t(`cl.role.${c.you_are}` as TKey)}{c.booking ? ` · ${t('cl.trip', { ref: c.booking.ref })}` : ''}</Text>
        <Text style={[S.body, { marginTop: SP.sm }]}>{c.description}</Text>
        <Text style={[S.bold, { marginTop: SP.sm }]}>{t('cl.amount.asked', { n: Math.round(c.claimed_amount).toLocaleString('en-US') })}</Text>
        {c.status === 'submitted' ? <Text style={[S.muted, { marginTop: 4 }]}>{t('cl.sla')}</Text> : null}
        {dueReply && claimIsOpen(c.status) ? <Text style={{ color: dueReply.late ? C.danger : C.warn, fontWeight: '700', marginTop: 4 }}>{dueReply.late ? t('cl.due.reply.late') : t('cl.due.reply', { n: dueReply.hours })}</Text> : null}
        {dueInfo ? <Text style={{ color: dueInfo.late ? C.danger : C.warn, fontWeight: '700', marginTop: 4 }}>{dueInfo.late ? t('cl.due.info.late') : t('cl.due.info', { n: dueInfo.hours })}</Text> : null}
      </Card>

      {c.decision ? <Card>
        <Text accessibilityRole="header" style={S.h2}>{t('cl.decision')}</Text>
        {c.status !== 'rejected' ? <Text testID="decision-amount" style={[S.bold, { color: C.green }]}>{t('cl.decision.amount', { n: Math.round(c.decision.amount).toLocaleString('en-US') })}</Text> : null}
        <Text style={[S.muted, { marginTop: 4 }]}>{t('cl.decision.reason')}</Text><Text testID="decision-reason" style={S.body}>{c.decision.reason}</Text>
      </Card> : null}
      {c.you_are === 'claimant' && ['accepted', 'partially_accepted', 'settled', 'closed'].includes(c.status) ? <Card>
        <Text accessibilityRole="header" style={S.h2}>{t('cl.settlement')}</Text>
        <Text style={S.body}>{c.settlement ? t(`cl.settlement.${c.settlement.kind === 'credit' ? 'credit' : 'manual_payout'}` as TKey, { n: Math.round(c.settlement.amount).toLocaleString('en-US') }) : t('cl.settlement.none')}</Text>
      </Card> : null}

      {c.comparison ? <Compare cmp={c.comparison} /> : null}

      <SectionTitle text={t('cl.timeline')} />
      <Card>
        {events.map((e, i) => {
          const head = e.kind === 'status' ? t('cl.ev.status', { s: label(lang, 'cl.st', String(e.meta?.to ?? '')) }) : t(`cl.ev.${e.kind}` as TKey);
          const showBody = !!e.body && ['filed', 'message', 'reply', 'info_request', 'decision'].includes(e.kind);
          return (
            <View key={e.id} testID="claim-event" style={{ flexDirection: 'row', gap: SP.md, paddingBottom: i < events.length - 1 ? SP.md : 0 }}>
              <View style={{ alignItems: 'center', width: 14 }}><View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.primary, marginTop: 4 }} />{i < events.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: C.line }} /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={S.bold}>{head}</Text><Text style={S.muted}>{whoLabel(e.author_role)} · {fmtDateTime(e.created_at)}</Text>
                {showBody ? <Text style={[S.body, { marginTop: 2 }]}>{e.body}</Text> : null}
              </View>
            </View>);
        })}
      </Card>

      <SectionTitle text={t('cl.evidence')} />
      <Card>
        {c.evidence.length ? <View style={[S.wrap, { gap: 6 }]}>{c.evidence.map((e, i) => <RemoteImage key={e.id} url={API_URL + e.url} size={{ width: 84, height: 64, radius: 8 }} label={e.caption || t('cl.photo.n', { n: i + 1 })} />)}</View> : <Text style={S.muted}>{t('cl.evidence.none')}</Text>}
        <Text style={[S.muted, { marginTop: SP.sm }]}>{t('cl.refresh.note')}</Text>
        {claimCanAddEvidence(c) ? <View style={{ marginTop: SP.sm }}><Text style={S.bold}>{t('cl.evidence.add')}</Text><PhotoButtons onPick={addPhoto} disabled={upBusy} /></View> : null}
      </Card>

      {reply ? (c.replied ? <Banner kind="ok" text={t('cl.reply.done')} /> : null) : null}
      {reply || info ? <Card style={{ borderColor: C.gold, borderWidth: 2 }}>
        <Text accessibilityRole="header" style={S.h2}>{reply ? t('cl.reply.title') : t('cl.info.title')}</Text>
        <Text style={[S.muted, { marginBottom: SP.sm }]}>{reply ? t('cl.reply.hint') : t('cl.info.hint')}</Text>
        <Field testID="claim-msg" value={msg} onChangeText={setMsg} multiline maxLength={2000} placeholder={t('cl.msg.ph')} blurOnSubmit={false} returnKeyType="default" />
        <Btn testID="claim-send" title={reply ? t('cl.reply.send') : t('cl.info.send')} onPress={() => send(reply ? 'reply' : 'info')} loading={busy} disabled={msg.trim().length < 2} />
      </Card> : null}
      {claimCanWithdraw(c) ? <Btn kind="ghost" title={t('cl.withdraw')} onPress={withdraw} loading={busy} /> : null}
    </Screen>
  );
}

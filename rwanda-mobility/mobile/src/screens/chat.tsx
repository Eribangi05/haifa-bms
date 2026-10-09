import React, { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { useApp, usePoll } from '../lib/app';
import { fmtTime } from '../lib/format';
import { useFlag } from '../lib/flags';
import type { Booking, ChatMessage } from '../lib/types';
import { AppModal } from '../ui/AppModal';
import { Banner, Btn, Card, EmptyState, Field, Screen, Text } from '../ui/components';
import { SwitchRow } from '../ui/trustParts';
import { C, FS, R, S, SP } from '../ui/theme';

const QUICK = { driver: ['chat.q.d1', 'chat.q.d2', 'chat.q.d3', 'chat.q.d4'], passenger: ['chat.q.r1', 'chat.q.r2', 'chat.q.r3', 'chat.q.r4'] } as const;

/**
 * Rider <-> driver chat for the active trip. Quick replies in the sender's language, read ticks, and phone numbers hidden unless a person chooses to
 * share theirs for this trip (the server decides what to include: `contact_phone` only appears after the other person shared it).
 */
export function ChatModal({ id, visible, onClose, role = 'passenger', trip, onChanged }: { id: string; visible: boolean; onClose: () => void; role?: 'passenger' | 'driver'; trip?: Pick<Booking, 'phone_sharing' | 'contact_phone'>; onChanged?: () => void }) {
  const { t, client, me, say, errMsg } = useApp(); const [text, setText] = useState(''); const [sending, setSending] = useState(false); const scroll = useRef<ScrollView>(null);
  const on = useFlag('chat.enabled');
  const [shared, setShared] = useState<boolean | null>(null);
  const msgs = usePoll(() => client.get<{ messages: ChatMessage[] }>(`/bookings/${id}/messages`), 4000, [id], visible && on);
  const list = msgs.data?.messages ?? [];
  const send = async (raw?: string) => { const body = (raw ?? text).trim(); if (!body || sending) return; setSending(true); if (!raw) setText(''); try { await client.post(`/bookings/${id}/messages`, { body }, { retry: false }); msgs.reload(); } catch (e) { if (!raw) setText(body); say(errMsg(e)); } finally { setSending(false); } };
  const iShare = shared ?? !!trip?.phone_sharing?.i_share;
  const toggleShare = async (v: boolean) => { setShared(v); try { await client.post(`/bookings/${id}/share-phone`, { share: v }, { retry: false }); onChanged?.(); } catch (e) { setShared(!v); say(errMsg(e)); } };
  const other = role === 'driver' ? 'rider' : 'driver';
  return (
    <AppModal visible={visible} onClose={onClose}>
      <Screen title={t('trip.chat')} onBack={onClose} scroll={false}
        footer={on ? <View style={{ gap: SP.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: SP.sm }}>
            {QUICK[role].map((k) => <Pressable key={k} accessibilityRole="button" accessibilityLabel={t(k)} onPress={() => void send(t(k))} disabled={sending} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: SP.md, borderRadius: R.pill, borderWidth: 1, borderColor: C.primary, backgroundColor: pressed ? C.skyBg : C.card })}><Text style={{ color: C.primary, fontWeight: '600' }}>{t(k)}</Text></Pressable>)}
          </ScrollView>
          <View style={[S.row, { alignItems: 'flex-start', gap: SP.sm }]}><View style={{ flex: 1 }}><Field value={text} onChangeText={setText} placeholder={t('trip.msg.ph')} maxLength={480} returnKeyType="send" onSubmitEditing={() => void send()} blurOnSubmit={false} /></View><Btn testID="cta" title={t('common.send')} onPress={() => void send()} disabled={!text.trim()} loading={sending} /></View></View> : undefined}>
        {!on ? <Banner text={t('chat.off')} /> : <>
          <Card style={{ marginHorizontal: SP.lg, marginTop: SP.sm }}>
            <SwitchRow testID="chat-share" label={t(role === 'driver' ? 'chat.share.driver' : 'chat.share.rider')} hint={t('chat.share.hint')} value={iShare} onChange={(v) => void toggleShare(v)} />
            {trip?.contact_phone ? <Btn testID="chat-call" kind="ghost" title={`${t(other === 'rider' ? 'chat.call.rider' : 'chat.call.driver')} · ${trip.contact_phone}`} onPress={() => void Linking.openURL(`tel:${trip.contact_phone}`).catch(() => {})} /> : null}
          </Card>
          <ScrollView ref={scroll} contentContainerStyle={{ padding: SP.lg, flexGrow: 1 }} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
            {!list.length ? <EmptyState glyph="💬" title={t('chat.empty.title')} body={t('chat.empty')} /> : null}
            {list.map((m) => { const mine = m.sender_id === me?.id; return (
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', backgroundColor: mine ? C.primary : C.card, borderRadius: R.md, padding: SP.md - 2, marginBottom: 6, maxWidth: '82%', borderWidth: mine ? 0 : 1, borderColor: C.line }}>
                <Text style={{ color: mine ? C.onPrimary : C.ink }}>{m.body}</Text>
                <Text style={{ color: mine ? C.onPrimary : C.muted, fontSize: FS.xs, marginTop: 2, textAlign: 'right' }}>{m.created_at ? fmtTime(m.created_at) : ''}{mine ? `  ${m.read_at ? '✓✓' : '✓'}` : ''}</Text>
              </View>); })}
          </ScrollView></>}
      </Screen>
    </AppModal>
  );
}

/** Chat chip label with the number of unread messages: "Messages · 2 new". */
export const chatLabel = (t: (k: 'chat.open' | 'chat.unread', v?: Record<string, number>) => string, unread?: number) => (unread ? `${t('chat.open')} · ${t('chat.unread', { n: unread })}` : t('chat.open'));

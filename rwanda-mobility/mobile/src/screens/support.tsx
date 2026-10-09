import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp, useAsync } from '../lib/app';
import { label, pick } from '../lib/i18n';
import type { Faq, SupportCase } from '../lib/types';
import { Banner, Btn, Card, Chip, Field, Pill, Screen, SectionTitle, Text, useFormFocus } from '../ui/components';
import { C, FS, S, SP } from '../ui/theme';
import { SosButton } from './sos';
import { SUPPORT } from '../config';
import { callNumber, openSms, openWhatsApp } from '../lib/contact';
import { Hero } from '../ui/dash';
import { IconBadge } from '../ui/components';
import { UssdCard } from './r3/ussd';

const CATS = ['booking', 'payment', 'refund', 'driver_complaint', 'lost_item', 'safety', 'fare_dispute', 'other'] as const;

export function Support({ params }: { params?: { booking_id?: string } }) {
  const { t, lang, client, nav, say } = useApp(); const { busy, run } = useAsync();
  const reach = async (ok: Promise<boolean>, app: string) => { if (!(await ok)) say(t('sup.err.open', { app, phone: SUPPORT.display })); };
  const [faq, setFaq] = useState<Faq[]>([]); const [open, setOpen] = useState<string | null>(null); const [cat, setCat] = useState<string>(params?.booking_id ? 'booking' : 'other');
  const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [cases, setCases] = useState<SupportCase[]>([]); const [done, setDone] = useState('');
  const f = useFormFocus(2);
  const load = useCallback(() => { client.get('/support/cases').then((r) => setCases(r.cases)).catch(() => {}); }, [client]);
  useEffect(() => { client.get('/support/faq').then((r) => setFaq(r.faq)).catch(() => {}); load(); }, [client, load]);
  const valid = subject.trim().length >= 3 && body.trim().length >= 3;
  const send = () => { if (!valid) return; void run(async () => { const r = await client.post('/support/cases', { category: cat, subject: subject.trim(), body: body.trim(), booking_id: params?.booking_id }); setDone(r.ref); setSubject(''); setBody(''); load(); }); };
  return (
    <Screen title={t('support.title')} onBack={() => nav.pop()} right={<SosButton bookingId={params?.booking_id} />}
      footer={<Btn testID="cta" title={t('common.send')} disabled={!valid} loading={busy} onPress={send} />}>
      <Hero testID="support-contact">
        <View style={[S.row, { gap: SP.md }]}>
          <IconBadge glyph="📞" size={56} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.onPrimary, opacity: 0.9, fontSize: FS.sm }}>{t('sup.contact.role')}</Text>
            <Text testID="support-name" accessibilityRole="header" style={{ color: C.onPrimary, fontSize: FS.lg + 2, fontWeight: '800' }}>{SUPPORT.name}</Text>
            <Text testID="support-phone" selectable style={{ color: C.gold, fontWeight: '800', fontSize: FS.lg }}>{SUPPORT.display}</Text>
          </View>
        </View>
        <Text style={{ color: C.onPrimary, opacity: 0.92, marginVertical: SP.sm }}>{t('sup.contact.sub')}</Text>
        <View style={{ flexDirection: 'row', gap: SP.sm }}>
          <View style={{ flex: 1 }}><Btn testID="support-call" kind="gold" title={t('sup.call')} onPress={() => void reach(callNumber(SUPPORT.phone), t('sup.call'))} /></View>
          <View style={{ flex: 1 }}><Btn testID="support-whatsapp" kind="light" title={t('sup.whatsapp')} onPress={() => void reach(openWhatsApp(t('sup.hello'), SUPPORT.phone), 'WhatsApp')} /></View>
          <View style={{ flex: 1 }}><Btn testID="support-sms" kind="light" title={t('sup.sms')} onPress={() => void reach(openSms(t('sup.hello'), SUPPORT.phone), t('sup.sms'))} /></View>
        </View>
      </Hero>
      <UssdCard />
      <SectionTitle text={t('support.faq')} />
      {faq.map((q) => (
        <Pressable key={q.id} accessibilityRole="button" accessibilityState={{ expanded: open === q.id }} onPress={() => setOpen(open === q.id ? null : q.id)}>
          <Card style={{ marginBottom: 8 }}><View style={S.between}><Text style={[S.body, { fontWeight: '700', flex: 1 }]}>{pick(lang, q, 'q')}</Text><Text accessible={false} style={{ color: C.primary, fontSize: 18 }}>{open === q.id ? '−' : '+'}</Text></View>{open === q.id ? <Text style={[S.body, { marginTop: 6 }]}>{pick(lang, q, 'a')}</Text> : null}</Card>
        </Pressable>))}
      <SectionTitle text={t('support.new')} />
      <View style={S.wrap}>{CATS.map((c) => <Chip key={c} text={t(('support.cat.' + c) as 'support.cat.other')} on={cat === c} onPress={() => setCat(c)} />)}</View>
      <Field {...f(0)} label={t('support.subject')} value={subject} onChangeText={setSubject} maxLength={140} />
      <Field {...f(1)} label={t('support.body')} value={body} onChangeText={setBody} multiline maxLength={1900} blurOnSubmit={false} returnKeyType="default" />
      {done ? <Banner kind="ok" text={`${t('support.sent')}: ${done}`} /> : null}
      {cases.length ? <><SectionTitle text={t('support.mycases')} />{cases.map((c) => <Card key={c.id}><Text style={S.body}>{c.ref} · {c.subject}</Text><View style={{ marginTop: 4 }}><Pill tone={c.status === 'resolved' || c.status === 'closed' ? 'ok' : 'warn'} text={label(lang, 'cs', c.status)} /></View></Card>)}</> : null}
    </Screen>
  );
}

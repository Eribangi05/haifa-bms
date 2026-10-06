import React, { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, Switch, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useApp, useAsync, usePoll } from '../lib/app';
import { Banner, Btn, Card, Chip, Empty, Field, Header, Money, Pill, Screen, Spinner } from '../ui/components';
import { C, S } from '../ui/theme';
import { uuid } from '../lib/net';

/** Safety actions look different from normal actions: red, always labelled, one tap to open, explicit send. */
export function SosButton({ bookingId }: { bookingId?: string }) {
  const { t, client } = useApp(); const [open, setOpen] = useState(false); const [res, setRes] = useState<any>(null); const { busy, run } = useAsync();
  const send = () => run(async () => {
    let loc: { lat?: number; lng?: number } = {};
    try { const p = await Location.getLastKnownPositionAsync(); if (p) loc = { lat: p.coords.latitude, lng: p.coords.longitude }; } catch { /* sent without location */ }
    setRes(await client.post('/safety/sos', { booking_id: bookingId, ...loc }, { retry: true, idempotencyKey: uuid() }));
  });
  const call = (n: string) => Linking.openURL(`tel:${n}`);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="SOS" style={{ backgroundColor: C.danger, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 8 }}><Text style={{ color: '#fff', fontWeight: '800' }}>{t('sos.button')}</Text></Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen footer={<Btn kind="ghost" title={t('common.close')} onPress={() => { setOpen(false); setRes(null); }} />}>
          <Text style={[S.h1, { color: C.danger, marginTop: 16 }]}>{t('sos.title')}</Text>
          <Text style={[S.body, { marginVertical: 12 }]}>{t('sos.body')}</Text>
          <Btn kind="danger" big title={t('sos.callpolice')} onPress={() => call('112')} /><View style={{ height: 10 }} />
          <Btn kind="danger" big title={t('sos.callamb')} onPress={() => call('912')} /><View style={{ height: 18 }} />
          {res ? <Banner kind="ok" text={`${t('sos.sent')} (${res.incident}). ${t('sos.notconfirmed')}`} /> : <Btn kind="ghost" title={t('sos.send')} onPress={send} loading={busy} />}
        </Screen>
      </Modal>
    </>
  );
}

export function History() {
  const { t, client, nav } = useApp();
  const list = usePoll(() => client.get('/bookings?role=passenger&limit=30'), 15000);
  return (
    <View style={S.screen}><Header title={t('hist.title')} onBack={() => nav.pop()} />
      <Screen>{!list.data ? <Spinner /> : list.data.bookings.length === 0 ? <Empty text={t('hist.empty')} /> : list.data.bookings.map((b: any) => (
        <Pressable key={b.id} onPress={() => nav.push('track', { id: b.id })}><Card>
          <View style={S.between}><Text style={S.h2}>{b.pickup.name ?? '…'} → {b.destination.name ?? '…'}</Text></View>
          <View style={[S.between, { marginTop: 4 }]}><Text style={S.muted}>{b.ref} · {new Date(b.requested_at).toLocaleDateString('en-GB')}</Text><Money n={b.final_fare ?? b.estimated_fare} style={{ fontWeight: '700' }} /></View>
          <View style={{ marginTop: 6 }}><Pill tone={b.status.startsWith('CANCEL') ? 'bad' : b.status === 'PAYMENT_COMPLETED' ? 'ok' : 'warn'} text={b.status.replace(/_/g, ' ')} /></View>
        </Card></Pressable>))}</Screen></View>
  );
}

export function Profile() {
  const { t, lang, setLang, me, refreshMe, client, nav, signOut, setMode, say } = useApp(); const { busy, run } = useAsync();
  const [name, setName] = useState(me?.display_name ?? ''); const [prefs, setPrefs] = useState<any>(me?.notif_prefs ?? {});
  const [contacts, setContacts] = useState<any[]>([]); const [cn, setCn] = useState(''); const [cp, setCp] = useState(''); const [ref, setRef] = useState<any>(null); const [biz, setBiz] = useState<any[]>([]);
  const load = () => { client.get('/users/me/emergency-contacts').then((r) => setContacts(r.contacts)).catch(() => {}); };
  useEffect(() => { load(); client.get('/users/me/referral').then(setRef).catch(() => {}); client.get('/businesses/mine').then((r) => setBiz(r.businesses)).catch(() => {}); }, []); // eslint-disable-line
  const save = () => run(async () => { await client.patch('/users/me', { display_name: name || undefined, notif_prefs: prefs }); await refreshMe(); say(t('common.save')); });
  const priv = (kind: 'deletion' | 'access') => run(async () => { await client.post('/users/me/privacy-requests', { kind }); Alert.alert(t('prof.privacy'), t('prof.delete.confirm')); });
  const becomeDriver = () => run(async () => { await client.post('/drivers/enroll'); await client.refresh(); await refreshMe(); setMode('driver'); });
  return (
    <View style={S.screen}><Header title={t('prof.title')} onBack={() => nav.pop()} />
      <Screen>
        <Card><Text style={S.muted}>{me?.phone}</Text><Field label={t('prof.name')} value={name} onChangeText={setName} />
          <Text style={S.muted}>{t('prof.language')}</Text><View style={{ flexDirection: 'row', marginVertical: 6 }}><Chip text="Kinyarwanda" on={lang === 'rw'} onPress={() => setLang('rw')} /><Chip text="English" on={lang === 'en'} onPress={() => setLang('en')} /></View>
          <Text style={[S.h2, { marginTop: 8 }]}>{t('prof.notifs')}</Text>
          {(['sms', 'marketing'] as const).map((k) => <View key={k} style={[S.between, { paddingVertical: 6 }]}><Text style={S.body}>{k === 'sms' ? t('prof.sms') : t('prof.promos')}</Text><Switch value={!!prefs[k]} onValueChange={(v) => setPrefs({ ...prefs, [k]: v })} trackColor={{ true: C.primary }} /></View>)}
          <Btn title={t('common.save')} onPress={save} loading={busy} /></Card>
        <Card><Text style={S.h2}>{t('prof.contacts')}</Text>
          {contacts.map((c) => <View key={c.id} style={[S.between, { paddingVertical: 6 }]}><Text style={S.body}>{c.name} · {c.phone}</Text><Pressable onPress={() => run(async () => { await client.del(`/users/me/emergency-contacts/${c.id}`); load(); })}><Text style={{ color: C.danger }}>✕</Text></Pressable></View>)}
          <Field label={t('prof.contact.name')} value={cn} onChangeText={setCn} /><Field label={t('prof.contact.phone')} value={cp} onChangeText={setCp} keyboardType="phone-pad" />
          <Btn kind="ghost" title={t('prof.contacts.add')} disabled={!cn || !cp} onPress={() => run(async () => { await client.post('/users/me/emergency-contacts', { name: cn, phone: cp }); setCn(''); setCp(''); load(); })} /></Card>
        {ref ? <Card><Text style={S.h2}>{t('prof.referral')}</Text><Text style={S.muted}>{t('prof.referral.code')}</Text><Text style={{ fontSize: 28, fontWeight: '800', letterSpacing: 3, color: C.primary }}>{ref.code}</Text><Text style={S.muted}>{ref.rewarded}/{ref.total}</Text></Card> : null}
        {biz.length ? <Card><Text style={S.h2}>{t('prof.business')}</Text>{biz.map((b) => <View key={b.id} style={{ marginTop: 6 }}><Text style={S.body}>{b.legal_name} · {b.role}</Text>{b.status !== 'active' ? <Pill tone="warn" text={t('biz.pending')} /> : <Pill text="active" />}</View>)}</Card> : null}
        {!me?.roles.includes('driver') ? <Card><Text style={S.h2}>{t('prof.driver')}</Text><Text style={S.muted}>{t('drv.become.sub')}</Text><View style={{ height: 8 }} /><Btn kind="gold" title={t('drv.enroll')} onPress={becomeDriver} loading={busy} /></Card> : <Btn kind="ghost" title={t('drv.mode')} onPress={() => setMode('driver')} />}
        <View style={{ height: 10 }} />
        <Card><Text style={S.h2}>{t('prof.privacy')}</Text><Btn kind="ghost" title={t('prof.export')} onPress={() => priv('access')} /><View style={{ height: 8 }} /><Btn kind="ghost" title={t('prof.delete')} onPress={() => Alert.alert(t('prof.delete'), t('prof.delete.confirm'), [{ text: t('common.cancel') }, { text: t('common.confirm'), style: 'destructive', onPress: () => priv('deletion') }])} /></Card>
        <Btn kind="ghost" title={t('common.signout')} onPress={signOut} />
      </Screen></View>
  );
}

const CATS = ['booking', 'payment', 'refund', 'driver_complaint', 'lost_item', 'safety', 'fare_dispute', 'other'] as const;
export function Support({ params }: { params?: { booking_id?: string } }) {
  const { t, lang, client, nav } = useApp(); const { busy, run } = useAsync();
  const [faq, setFaq] = useState<any[]>([]); const [open, setOpen] = useState<string | null>(null); const [cat, setCat] = useState<string>(params?.booking_id ? 'booking' : 'other');
  const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [cases, setCases] = useState<any[]>([]); const [done, setDone] = useState('');
  const load = () => { client.get('/support/cases').then((r) => setCases(r.cases)).catch(() => {}); };
  useEffect(() => { client.get('/support/faq').then((r) => setFaq(r.faq)).catch(() => {}); load(); }, []); // eslint-disable-line
  return (
    <View style={S.screen}><Header title={t('support.title')} onBack={() => nav.pop()} right={<SosButton bookingId={params?.booking_id} />} />
      <Screen>
        <Text style={[S.h2, { marginBottom: 8 }]}>{t('support.faq')}</Text>
        {faq.map((f) => <Pressable key={f.id} onPress={() => setOpen(open === f.id ? null : f.id)}><Card><Text style={[S.body, { fontWeight: '700' }]}>{lang === 'rw' ? f.q_rw : f.q_en}</Text>{open === f.id ? <Text style={[S.body, { marginTop: 6 }]}>{lang === 'rw' ? f.a_rw : f.a_en}</Text> : null}</Card></Pressable>)}
        <Text style={[S.h2, { marginVertical: 8 }]}>{t('support.new')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{CATS.map((c) => <Chip key={c} text={t(('support.cat.' + c) as any)} on={cat === c} onPress={() => setCat(c)} />)}</View>
        <Field label={t('support.subject')} value={subject} onChangeText={setSubject} maxLength={140} /><Field label={t('support.body')} value={body} onChangeText={setBody} multiline maxLength={1900} />
        {done ? <Banner kind="ok" text={`${t('support.sent')}: ${done}`} /> : null}
        <Btn title={t('common.send')} disabled={subject.length < 3 || body.length < 3} loading={busy} onPress={() => run(async () => { const r = await client.post('/support/cases', { category: cat, subject, body, booking_id: params?.booking_id }); setDone(r.ref); setSubject(''); setBody(''); load(); })} />
        {cases.length ? <><Text style={[S.h2, { marginVertical: 12 }]}>{t('support.mycases')}</Text>{cases.map((c) => <Card key={c.id}><Text style={S.body}>{c.ref} · {c.subject}</Text><Pill tone={c.status === 'resolved' ? 'ok' : 'warn'} text={c.status.replace(/_/g, ' ')} /></Card>)}</> : null}
      </Screen></View>
  );
}

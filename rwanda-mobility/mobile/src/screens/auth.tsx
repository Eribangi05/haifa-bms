import React, { useEffect, useState } from 'react';
import { Image, Text, View, useWindowDimensions } from 'react-native';
import { useApp, useAsync } from '../lib/app';
import { Banner, Btn, FadeIn, Field, IconBadge, LangPicker, Screen } from '../ui/components';
import { C, S } from '../ui/theme';
import { APP_NAME } from '../config';
import { ApiError } from '../lib/net';
import { tokenStore } from '../lib/storage';

export function Welcome() {
  const narrow = useWindowDimensions().width < 340;
  const { t, lang, setLang, nav } = useApp();
  const feats: [string, string][] = [['🛡️', t('welcome.f1')], ['💰', t('welcome.f2')], ['🆘', t('welcome.f3')], ['🚗', t('welcome.f4')]];
  return (
    <Screen footer={<Btn title={t('common.continue')} onPress={() => nav.replace('phone')} big />}>
      <FadeIn>
        <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 20, backgroundColor: C.card, borderRadius: 28, paddingVertical: 22, paddingHorizontal: 16, borderWidth: 1, borderColor: C.line }}>
          <Image source={require('../../assets/logo.png')} accessibilityLabel={APP_NAME} style={{ width: 170, height: 170, borderRadius: 36, marginBottom: 12 }} />
          <Text accessibilityRole="header" style={[S.h1, { textAlign: 'center' }]}>{APP_NAME}</Text>
          <Text style={[S.muted, { textAlign: 'center', marginTop: 6, fontSize: 15 }]}>{t('app.tagline')}</Text>
        </View>
      </FadeIn>
      <FadeIn delay={120}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 18 }}>
          {feats.map(([g, l]) => <View key={l} style={{ width: narrow ? '100%' : '50%', paddingRight: 8, paddingBottom: 8 }}><View style={[S.row, { backgroundColor: C.card, borderRadius: 14, padding: 10, borderWidth: 1, borderColor: C.line }]}><IconBadge glyph={g} size={36} /><Text style={[S.body, { flex: 1, marginLeft: 8, fontSize: 13, fontWeight: '600' }]}>{l}</Text></View></View>)}
        </View>
      </FadeIn>
      <Text accessibilityRole="header" style={[S.h2, { marginBottom: 10 }]}>{t('auth.language')}</Text>
      <LangPicker lang={lang} onPick={setLang} />
    </Screen>
  );
}

export function Phone() {
  const { t, client, nav, lang, say } = useApp();
  const [phone, setPhone] = useState(''); const [ref, setRef] = useState(''); const { busy, run } = useAsync();
  const valid = /^(?:\+?250|0)?7[2389]\d{7}$/.test(phone.replace(/[\s-]/g, ''));
  const send = () => run(async () => {
    try {
      const r = await client.post('/auth/otp/request', { phone, language: lang }, { auth: false });
      nav.push('otp', { phone, referral: ref.trim() || undefined, dev: r.dev_code, resend: r.resend_in ?? 60 });
    } catch (e) { if (e instanceof ApiError && e.code === 'otp_cooldown') nav.push('otp', { phone, referral: ref.trim() || undefined, resend: 60 }); else throw e; }
  });
  return (
    <Screen footer={<Btn title={t('auth.sendcode')} onPress={send} disabled={!valid} loading={busy} big />}>
      <Text style={[S.h1, { marginTop: 24, marginBottom: 16 }]}>{t('auth.phone')}</Text>
      <View style={[S.row, { gap: 8 }]}>
        <View style={[S.input, { justifyContent: 'center' }]}><Text style={{ fontSize: 16 }}>+250</Text></View>
        <View style={{ flex: 1 }}><Field value={phone} onChangeText={setPhone} placeholder={t('auth.phone.hint')} keyboardType="phone-pad" autoComplete="tel" maxLength={16} accessibilityLabel={t('auth.phone')} /></View>
      </View>
      {phone.length > 4 && !valid ? <Text style={{ color: C.danger, marginBottom: 8 }}>{t('auth.invalid')}</Text> : null}
      <Field label={t('auth.referral')} value={ref} onChangeText={setRef} autoCapitalize="characters" maxLength={12} />
      <Text style={S.muted}>{t('auth.terms')}</Text>
    </Screen>
  );
}

export function Otp({ params }: { params: { phone: string; referral?: string; dev?: string; resend: number } }) {
  const { t, client, signedIn, nav, lang } = useApp();
  const [code, setCode] = useState(''); const [left, setLeft] = useState(params.resend); const { busy, run } = useAsync();
  const [err, setErr] = useState('');
  useEffect(() => { const i = setInterval(() => setLeft((x) => (x > 0 ? x - 1 : 0)), 1000); return () => clearInterval(i); }, []);
  const verify = () => run(async () => {
    setErr('');
    try {
      const r = await client.post('/auth/otp/verify', { phone: params.phone, code, language: lang, referral_code: params.referral }, { auth: false });
      await tokenStore.set({ access_token: r.access_token, refresh_token: r.refresh_token });
      await signedIn(r.roles);
    } catch (e: any) { setErr(e.message); }
  }, { silent: true });
  const resend = () => run(async () => { try { const r = await client.post('/auth/otp/request', { phone: params.phone, language: lang }, { auth: false }); setLeft(r.resend_in ?? 60); } catch (e: any) { setErr(e.message); } });
  return (
    <Screen footer={<Btn title={t('auth.verify')} onPress={verify} disabled={code.length !== 6} loading={busy} big />}>
      <Text style={[S.h1, { marginTop: 24 }]}>{t('auth.code')}</Text>
      <Text style={[S.muted, { marginVertical: 8 }]}>{t('auth.code.sent')} {params.phone}</Text>
      {params.dev ? <Banner text={`${t('auth.dev')}: ${params.dev}`} /> : null}
      <Field value={code} onChangeText={(x) => setCode(x.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" placeholder="••••••" maxLength={6} style={{ letterSpacing: 8, fontSize: 24, textAlign: 'center' }} />
      {err ? <Text style={{ color: C.danger, marginBottom: 8 }}>{err}</Text> : null}
      <Btn kind="ghost" title={left > 0 ? `${t('auth.resend.in')} ${left}s` : t('auth.resend')} onPress={resend} disabled={left > 0} />
      <View style={{ height: 8 }} /><Btn kind="ghost" title={t('common.back')} onPress={() => nav.pop()} />
    </Screen>
  );
}

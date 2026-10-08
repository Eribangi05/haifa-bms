import React, { useEffect, useState } from 'react';
import { Image, View, useWindowDimensions } from 'react-native';
import { useApp, useAsync } from '../lib/app';
import { Banner, Btn, FadeIn, Field, IconBadge, LangPicker, Screen, Text, useFormFocus } from '../ui/components';
import { C, R, S, SP } from '../ui/theme';
import { APP_NAME } from '../config';
import { ApiError } from '../lib/net';
import { tokenStore } from '../lib/storage';

export function Welcome() {
  const narrow = useWindowDimensions().width < 340;
  const { t, lang, setLang, nav } = useApp();
  const feats: [string, string][] = [['🛡️', t('welcome.f1')], ['💰', t('welcome.f2')], ['🆘', t('welcome.f3')], ['🚗', t('welcome.f4')]];
  return (
    <Screen footer={<Btn testID="cta" title={t('common.continue')} onPress={() => nav.replace('phone')} big />}>
      <FadeIn>
        <View style={{ alignItems: 'center', marginTop: SP.md, marginBottom: SP.lg, backgroundColor: C.card, borderRadius: R.xl, paddingVertical: SP.lg, paddingHorizontal: SP.lg, borderWidth: 1, borderColor: C.line }}>
          <Image source={require('../../assets/logo.png')} accessibilityLabel={APP_NAME} style={{ width: 140, height: 140, borderRadius: 32, marginBottom: SP.md }} />
          <Text accessibilityRole="header" style={[S.h1, { textAlign: 'center' }]}>{APP_NAME}</Text>
          <Text style={[S.muted, { textAlign: 'center', marginTop: 6, fontSize: 15 }]}>{t('app.tagline')}</Text>
        </View>
      </FadeIn>
      <FadeIn delay={120}>
        <View style={S.wrap}>
          {feats.map(([g, l]) => <View key={l} style={{ width: narrow ? '100%' : '50%', paddingRight: SP.sm, paddingBottom: SP.sm }}><View style={[S.row, { backgroundColor: C.card, borderRadius: R.md, padding: SP.sm + 2, borderWidth: 1, borderColor: C.line }]}><IconBadge glyph={g} size={36} /><Text style={[S.body, { flex: 1, marginLeft: SP.sm, fontSize: 13, fontWeight: '600' }]}>{l}</Text></View></View>)}
        </View>
      </FadeIn>
      <Text accessibilityRole="header" style={[S.h2, { marginVertical: SP.sm + 2 }]}>{t('auth.language')}</Text>
      <LangPicker lang={lang} onPick={setLang} />
    </Screen>
  );
}

export function Phone() {
  const { t, client, nav, lang } = useApp();
  const [phone, setPhone] = useState(''); const [ref, setRef] = useState(''); const { busy, run } = useAsync();
  const valid = /^(?:\+?250|0)?7[2389]\d{7}$/.test(phone.replace(/[\s-]/g, ''));
  const f = useFormFocus(2);
  const send = () => { if (!valid) return; void run(async () => {
    try {
      const r = await client.post('/auth/otp/request', { phone, language: lang }, { auth: false });
      nav.push('otp', { phone, referral: ref.trim() || undefined, dev: r.dev_code, resend: r.resend_in ?? 60 });
    } catch (e) { if (e instanceof ApiError && e.code === 'otp_cooldown') nav.push('otp', { phone, referral: ref.trim() || undefined, resend: 60 }); else throw e; }
  }); };
  return (
    <Screen title={t('auth.phone')} onBack={() => nav.replace('welcome')} footer={<Btn testID="cta" title={t('auth.sendcode')} onPress={send} disabled={!valid} loading={busy} big />}>
      <View style={[S.row, { gap: SP.sm, alignItems: 'flex-start' }]}>
        <View style={[S.input, { justifyContent: 'center', marginTop: 0 }]}><Text style={{ fontSize: 16 }}>+250</Text></View>
        <View style={{ flex: 1 }}><Field {...f(0)} value={phone} onChangeText={setPhone} placeholder={t('auth.phone.hint')} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={16} accessibilityLabel={t('auth.phone')} error={phone.length > 4 && !valid ? t('auth.invalid') : undefined} /></View>
      </View>
      <Field {...f(1, send)} label={t('auth.referral')} value={ref} onChangeText={setRef} autoCapitalize="characters" autoCorrect={false} maxLength={12} />
      <Text style={S.muted}>{t('auth.terms')}</Text>
    </Screen>
  );
}

export function Otp({ params }: { params: { phone: string; referral?: string; dev?: string; resend: number } }) {
  const { t, client, signedIn, nav, lang, errMsg } = useApp();
  const [code, setCode] = useState(''); const [left, setLeft] = useState(params.resend); const { busy, run } = useAsync();
  const [err, setErr] = useState('');
  useEffect(() => { const i = setInterval(() => setLeft((x) => (x > 0 ? x - 1 : 0)), 1000); return () => clearInterval(i); }, []);
  const verify = () => { if (code.length !== 6) return; void run(async () => {
    setErr('');
    try {
      const r = await client.post('/auth/otp/verify', { phone: params.phone, code, language: lang, referral_code: params.referral }, { auth: false });
      await tokenStore.set({ access_token: r.access_token, refresh_token: r.refresh_token });
      await signedIn(r.roles);
    } catch (e) { setErr(errMsg(e)); }
  }, { silent: true }); };
  const resend = () => run(async () => { setErr(''); try { const r = await client.post('/auth/otp/request', { phone: params.phone, language: lang }, { auth: false }); setLeft(r.resend_in ?? 60); } catch (e) { setErr(errMsg(e)); } }, { silent: true });
  return (
    <Screen title={t('auth.code')} onBack={() => nav.pop()} footer={<Btn testID="cta" title={t('auth.verify')} onPress={verify} disabled={code.length !== 6} loading={busy} big />}>
      <Text style={[S.muted, { marginBottom: SP.sm }]}>{t('auth.code.sent')} {params.phone}</Text>
      {params.dev ? <Banner text={`${t('auth.dev')}: ${params.dev}`} /> : null}
      <Field value={code} onChangeText={(x) => { setCode(x.replace(/\D/g, '').slice(0, 6)); setErr(''); }} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" placeholder="••••••" maxLength={6} returnKeyType="done" onSubmitEditing={verify} style={{ letterSpacing: 8, fontSize: 24, textAlign: 'center' }} accessibilityLabel={t('auth.code')} error={err || undefined} />
      <Btn kind="ghost" title={left > 0 ? `${t('auth.resend.in')} ${left}s` : t('auth.resend')} onPress={resend} disabled={left > 0} />
    </Screen>
  );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useApp, useBackHandler } from '../lib/app';
import { ApiError } from '../lib/net';
import { fetchRequestCode, parseCode, type ParsedCode, type RequestCodeInfo, type Svc } from '../lib/codes';
import { Banner, Btn, Card, Field, Screen, Spinner, Text, useProportionalHeight } from '../ui/components';
import { QrCamera, cameraSupported } from '../ui/QrCamera';
import { S } from '../ui/theme';

/** Scan / type a request code, confirm the venue, then hand over to Home with the pickup prefilled. */
export function Scan({ params }: { params?: { code?: string; svc?: Svc } }) {
  const { t, client, nav, mode, setMode, errMsg } = useApp();
  const [typed, setTyped] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<RequestCodeInfo | null>(null); const [svc, setSvc] = useState<Svc>('ride');
  const last = useRef<ParsedCode | null>(null); const lock = useRef(false); const lastScan = useRef({ data: '', at: 0 });
  const camH = useProportionalHeight(0.38, 220, 380);
  const back = () => { if (info) { setInfo(null); setErr(''); } else nav.pop(); };
  useBackHandler(() => { if (info) { setInfo(null); setErr(''); return true; } return false; }, !!info);

  const resolve = useCallback(async (p: ParsedCode) => {
    if (lock.current) return; lock.current = true; last.current = p; setBusy(true); setErr('');
    try { const r = await fetchRequestCode(client, p.code); setInfo(r); setSvc(p.svc ?? r.default_service); }
    catch (e) { setErr(e instanceof ApiError && e.isNetwork ? t('scan.offline') : errMsg(e)); }
    finally { setBusy(false); setTimeout(() => { lock.current = false; }, 1200); }
  }, [client, t, errMsg]);

  useEffect(() => { if (params?.code) { const p = parseCode(params.code); if (p) void resolve({ ...p, svc: params.svc ?? p.svc }); else setErr(t('scan.bad')); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fromText = (s: string) => { const p = parseCode(s); if (!p) { if (!lock.current) setErr(t('scan.bad')); return; } void resolve(p); };
  // The camera reports the same frame many times a second: ignore repeats for 2.5 s so an invalid code does not flicker.
  const fromCamera = (data: string) => { const n = Date.now(); if (data === lastScan.current.data && n - lastScan.current.at < 2500) return; lastScan.current = { data, at: n }; fromText(data); };

  const proceed = () => {
    if (!info) return;
    if (mode === 'driver') setMode('passenger');
    nav.reset('home', { venue: { lat: info.lat, lng: info.lng, name: info.label, note: info.pickup_note ?? '', code: info.code }, svc });
  };

  if (info) return (
    <Screen title={t('scan.title')} onBack={back} footer={<Btn testID="cta" big title={svc === 'abasare' ? t('scan.go.abasare') : t('scan.go')} onPress={proceed} />}>
      {!info.zone_ok ? <Banner text={t('scan.zone')} /> : null}
      <Card>
        <Text style={S.muted}>{t('scan.pickup')}</Text>
        <Text accessibilityRole="header" style={S.h2}>{info.label}</Text>
        {info.partner_name && info.partner_name !== info.label ? <Text style={S.muted}>{info.partner_name}</Text> : null}
        {info.pickup_note ? <Text style={[S.body, { marginTop: 6 }]}>{info.pickup_note}</Text> : null}
        {svc === 'abasare' ? <Text style={[S.muted, { marginTop: 6 }]}>{t('scan.abasare')}</Text> : null}
        <Banner kind="ok" text={`✓ ${t('scan.found')}`} />
      </Card>
    </Screen>
  );

  return (
    <Screen title={t('scan.title')} onBack={back} footer={<Btn testID="cta" title={t('common.continue')} onPress={() => fromText(typed)} disabled={!typed.trim() || busy} loading={busy} />}>
      {cameraSupported ? <QrCamera onData={fromCamera} height={camH} /> : <Banner text={t('scan.web')} />}
      {busy ? <><Text style={S.muted}>{t('scan.checking')}</Text><Spinner /></> : null}
      {err ? <><Banner kind="bad" text={err} action={last.current && err === t('scan.offline') ? <Btn kind="ghost" title={t('common.retry')} onPress={() => void resolve(last.current!)} /> : undefined} /></> : null}
      <View style={{ marginTop: 8 }}>
        <Text style={[S.h2, { marginBottom: 6 }]}>{t('scan.type')}</Text>
        <Field value={typed} onChangeText={(x) => { setTyped(x); setErr(''); }} placeholder={t('scan.type.ph')} autoCapitalize="characters" autoCorrect={false} maxLength={200} returnKeyType="go" accessibilityLabel={t('scan.type')} onSubmitEditing={() => fromText(typed)} />
      </View>
    </Screen>
  );
}

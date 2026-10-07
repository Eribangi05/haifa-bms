import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../lib/app';
import { ApiError } from '../lib/net';
import { fetchRequestCode, parseCode, type ParsedCode, type RequestCodeInfo, type Svc } from '../lib/codes';
import { Banner, Btn, Card, Field, Header, Screen, Spinner } from '../ui/components';
import { QrCamera, cameraSupported } from '../ui/QrCamera';
import { S } from '../ui/theme';

/** Scan / type a request code, confirm the venue, then hand over to Home with the pickup prefilled. */
export function Scan({ params }: { params?: { code?: string; svc?: Svc } }) {
  const { t, client, nav, mode, setMode } = useApp();
  const [typed, setTyped] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<RequestCodeInfo | null>(null); const [svc, setSvc] = useState<Svc>('ride');
  const last = useRef<ParsedCode | null>(null); const lock = useRef(false);

  const resolve = useCallback(async (p: ParsedCode) => {
    if (lock.current) return; lock.current = true; last.current = p; setBusy(true); setErr('');
    try { const r = await fetchRequestCode(client, p.code); setInfo(r); setSvc(p.svc ?? r.default_service); }
    catch (e) { setErr(e instanceof ApiError && e.isNetwork ? t('scan.offline') : (e as Error).message); }
    finally { setBusy(false); setTimeout(() => { lock.current = false; }, 1200); }
  }, [client, t]);

  useEffect(() => { if (params?.code) { const p = parseCode(params.code); if (p) void resolve({ ...p, svc: params.svc ?? p.svc }); else setErr(t('scan.bad')); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fromText = (s: string) => { const p = parseCode(s); if (!p) { if (!lock.current) setErr(t('scan.bad')); return; } void resolve(p); };

  const proceed = () => {
    if (!info) return;
    if (mode === 'driver') setMode('passenger');
    nav.reset('home', { venue: { lat: info.lat, lng: info.lng, name: info.label, note: info.pickup_note ?? '', code: info.code }, svc });
  };

  if (info) return (
    <View style={S.screen}><Header title={t('scan.title')} onBack={() => { setInfo(null); setErr(''); }} />
    <Screen embedded footer={<Btn big title={svc === 'abasare' ? t('scan.go.abasare') : t('scan.go')} onPress={proceed} />}>
      {!info.zone_ok ? <Banner text={t('scan.zone')} /> : null}
      <Card>
        <Text style={S.muted}>{t('scan.pickup')}</Text>
        <Text accessibilityRole="header" style={S.h2}>{info.label}</Text>
        {info.partner_name && info.partner_name !== info.label ? <Text style={S.muted}>{info.partner_name}</Text> : null}
        {info.pickup_note ? <Text style={[S.body, { marginTop: 6 }]}>{info.pickup_note}</Text> : null}
        {svc === 'abasare' ? <Text style={[S.muted, { marginTop: 6 }]}>{t('scan.abasare')}</Text> : null}
        <Banner kind="ok" text={`✓ ${t('scan.found')}`} />
      </Card>
    </Screen></View>
  );

  return (
    <View style={S.screen}><Header title={t('scan.title')} onBack={() => nav.pop()} />
    <Screen embedded>
      {cameraSupported ? <QrCamera onData={fromText} /> : <Banner text={t('scan.web')} />}
      {busy ? <><Text style={S.muted}>{t('scan.checking')}</Text><Spinner /></> : null}
      {err ? <><Banner kind="bad" text={err} />{last.current && err === t('scan.offline') ? <Btn kind="ghost" title={t('common.retry')} onPress={() => void resolve(last.current!)} /> : null}</> : null}
      <Text style={[S.h2, { marginTop: 8, marginBottom: 6 }]}>{t('scan.type')}</Text>
      <Field value={typed} onChangeText={(x) => { setTyped(x); setErr(''); }} placeholder={t('scan.type.ph')} autoCapitalize="characters" autoCorrect={false} maxLength={200} accessibilityLabel={t('scan.type')} onSubmitEditing={() => fromText(typed)} />
      <Btn title={t('common.continue')} onPress={() => fromText(typed)} disabled={!typed.trim() || busy} loading={busy} />
    </Screen></View>
  );
}

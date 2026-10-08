import React, { useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import * as Location from 'expo-location';
import { useApp, useAsync } from '../lib/app';
import { uuid } from '../lib/net';
import { AppModal } from '../ui/AppModal';
import { Banner, Btn, Screen, Text } from '../ui/components';
import { C, R, S, SP } from '../ui/theme';

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => new Promise<T>((res, rej) => { const id = setTimeout(() => rej(new Error('timeout')), ms); p.then((v) => { clearTimeout(id); res(v); }, (e) => { clearTimeout(id); rej(e); }); });

/** Safety actions look different from normal actions: red, always labelled, one tap to open, explicit send. Never claims an agency was contacted. */
export function SosButton({ bookingId }: { bookingId?: string }) {
  const { t, client, cfg, say } = useApp(); const [open, setOpen] = useState(false); const [res, setRes] = useState<{ incident: string } | null>(null); const [noLoc, setNoLoc] = useState(false);
  const { busy, run } = useAsync(); const key = useRef<string | null>(null);   // one key per opening: a double tap or retry never records two alerts
  const close = () => { setOpen(false); setRes(null); key.current = null; };
  const send = () => run(async () => {
    key.current = key.current ?? uuid();
    let loc: { lat?: number; lng?: number } = {};
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      const p = perm.granted ? await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 5000).catch(() => Location.getLastKnownPositionAsync()) : await Location.getLastKnownPositionAsync();
      if (p) loc = { lat: p.coords.latitude, lng: p.coords.longitude };
    } catch { /* sent without location */ }
    setNoLoc(loc.lat == null);
    setRes(await client.post('/safety/sos', { booking_id: bookingId, ...loc }, { retry: true, idempotencyKey: key.current }));
  });
  const call = (n: string) => Linking.openURL(`tel:${n}`).catch(() => say(t('sos.callfail', { n })));
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={t('sos.button')} style={{ backgroundColor: C.danger, borderRadius: R.pill, paddingHorizontal: SP.lg, minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: C.onDanger, fontWeight: '800' }}>{t('sos.button')}</Text></Pressable>
      <AppModal visible={open} onClose={close}>
        <Screen title={t('sos.title')} onBack={close} footer={<Btn kind="ghost" title={t('common.close')} onPress={close} />}>
          <Text style={[S.body, { marginVertical: SP.md }]}>{t('sos.body')}</Text>
          <View style={{ gap: 10 }}>
            <Btn kind="danger" big title={t('sos.callpolice')} onPress={() => call(cfg?.emergency_numbers.police ?? '112')} />
            <Btn kind="danger" big title={t('sos.callamb')} onPress={() => call(cfg?.emergency_numbers.ambulance ?? '912')} />
          </View>
          <View style={{ height: SP.lg }} />
          {res ? <><Banner kind="ok" text={`${t('sos.sent')} (${res.incident}). ${t('sos.notconfirmed')}`} />{noLoc ? <Banner text={t('sos.noloc')} /> : null}</> : <Btn kind="ghost" title={t('sos.send')} onPress={send} loading={busy} />}
        </Screen>
      </AppModal>
    </>
  );
}

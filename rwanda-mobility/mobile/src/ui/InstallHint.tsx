import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { useApp } from '../lib/app';
import { kv } from '../lib/storage';
import { Btn, Card, IconBadge, Text } from './components';
import { C, S, SP } from './theme';

const KEY = 'rm_pwa_hint';
/** iPhone Safari only (the web app): how to add Abasare to the Home Screen. Hidden inside the installed app and after "Got it". */
export function InstallHint() {
  const { t } = useApp(); const [show, setShow] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent); const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches);
    if (!ios || standalone) return;
    kv.get(KEY).then((v) => setShow(v !== '1')).catch(() => setShow(true));
  }, []);
  if (!show) return null;
  return (
    <Card style={{ backgroundColor: C.skyBg, borderColor: C.primary }}>
      <View testID="install-hint" style={[S.row, { gap: SP.md, alignItems: 'flex-start' }]}>
        <IconBadge glyph="📱" size={44} />
        <View style={{ flex: 1 }}><Text accessibilityRole="header" style={S.bold}>{t('pwa.title')}</Text><Text style={S.muted}>{t('pwa.body')}</Text></View>
      </View>
      <View style={{ height: SP.sm }} /><Btn testID="install-hint-ok" kind="ghost" title={t('pwa.ok')} onPress={() => { setShow(false); void kv.set(KEY, '1').catch(() => {}); }} />
    </Card>
  );
}

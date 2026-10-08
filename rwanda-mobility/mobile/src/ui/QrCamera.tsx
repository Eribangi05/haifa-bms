import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useApp } from '../lib/app';
import { Banner, Btn, Text } from './components';
import { C, S } from './theme';

/** Native QR scanner (expo-camera). The web build uses QrCamera.web.tsx, which renders nothing. */
export const cameraSupported = true;
export function QrCamera({ onData, height = 320 }: { onData: (data: string) => void; height?: number }) {
  const { t } = useApp();
  const [perm, ask] = useCameraPermissions();
  const [torch, setTorch] = React.useState(false);
  if (!perm) return <View style={{ height: Math.min(height, 280) }} />;
  if (!perm.granted) return (
    <View style={{ marginBottom: 12 }}>
      <Banner text={`${t('scan.perm.title')}. ${t('scan.perm.body')}`} />
      {perm.canAskAgain ? <Btn title={t('scan.perm.allow')} onPress={() => void ask()} /> : <Btn title={t('scan.perm.settings')} onPress={() => void Linking.openSettings()} />}
    </View>
  );
  return (
    <View style={{ height, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', marginBottom: 12 }}>
      <CameraView style={{ flex: 1 }} facing="back" enableTorch={torch} accessibilityLabel={t('scan.a11y')}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => onData(r.data)} />
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 200, height: 200, borderWidth: 3, borderColor: '#fff', borderRadius: 20, opacity: 0.9 }} />
      </View>
      <Text style={{ position: 'absolute', top: 12, left: 12, right: 12, textAlign: 'center', color: '#fff', fontWeight: '700' }}>{t('scan.hint')}</Text>
      <Pressable onPress={() => setTorch((x) => !x)} accessibilityRole="button" accessibilityState={{ selected: torch }} accessibilityLabel={t('scan.torch')}
        style={{ position: 'absolute', bottom: 12, right: 12, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: torch ? C.gold : 'rgba(0,0,0,0.55)' }}>
        <Text style={{ color: torch ? '#000' : '#fff', fontWeight: '700' }}>🔦 {t('scan.torch')}</Text>
      </Pressable>
    </View>
  );
}

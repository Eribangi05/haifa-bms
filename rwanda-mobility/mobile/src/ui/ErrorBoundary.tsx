import React from 'react';
import { Platform, Text, View } from 'react-native';
import { useApp } from '../lib/app';
import { reportError } from '../lib/report';
import { Btn } from './components';
import { C, S } from './theme';

function Fallback({ onReload }: { onReload: () => void }) {
  const { t } = useApp();
  return (
    <View accessibilityRole="alert" style={[S.screen, { justifyContent: 'center', padding: 24 }]}>
      <Text accessibilityRole="header" style={[S.h1, { textAlign: 'center' }]}>{t('err.title')}</Text>
      <Text style={[S.body, { textAlign: 'center', marginVertical: 14, color: C.muted }]}>{t('err.body')}</Text>
      <Btn big title={t('err.reload')} onPress={onReload} />
    </View>
  );
}

/** Catches render errors below it, reports them and offers a reload. Must sit inside AppProvider (needs the language). */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; onReset: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { reportError(error, true); }
  reload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') { window.location.reload(); return; }
    this.setState({ failed: false }); this.props.onReset();
  };
  render() { return this.state.failed ? <Fallback onReload={this.reload} /> : this.props.children; }
}

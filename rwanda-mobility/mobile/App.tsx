import React from 'react';
import { Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/lib/app';
import { Welcome, Phone, Otp } from './src/screens/auth';
import { Home, Options, Track } from './src/screens/passenger';
import { History, Profile, Support } from './src/screens/shared';
import { DriverHome } from './src/screens/driver';
import { Cars } from './src/screens/cars';
import { Spinner } from './src/ui/components';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { installErrorReporting } from './src/lib/report';
import { initNotifications, listenForTaps, registerPush, routeFor } from './src/lib/push';
import './src/lib/bgLocation';   // registers the driver location task at startup (native Android only; inert elsewhere)
import { C } from './src/ui/theme';

// Respect the user's font-size setting but cap it so layouts do not break (accessibility vs. layout).
(Text as any).defaultProps = { ...((Text as any).defaultProps ?? {}), maxFontSizeMultiplier: 1.4 };

initNotifications();

/** Wires error reporting, push registration and notification taps to the app context. Renders nothing. */
function Bridges() {
  const { client, lang, nav, me, ready } = useApp();
  const live = React.useRef({ lang, nav, me }); live.current = { lang, nav, me };
  React.useEffect(() => { installErrorReporting({ client, lang: () => live.current.lang, screen: () => live.current.nav.stack[live.current.nav.stack.length - 1]?.name ?? 'unknown' }); }, [client]);
  const uid = me?.id; const isDriver = !!me?.roles.includes('driver');
  React.useEffect(() => { if (uid) void registerPush(client, live.current.lang, isDriver); }, [uid, isDriver, client]);
  React.useEffect(() => {
    if (!ready || !uid) return;
    return listenForTaps((data) => { const go = routeFor(data, !!live.current.me?.roles.includes('driver')); if (go) live.current.nav.push(go.name, go.params); });
  }, [ready, uid]);
  return null;
}

function Router() {
  const { ready, nav, toast } = useApp();
  const route = nav.stack[nav.stack.length - 1];
  let screen: React.ReactNode;
  if (!ready || route.name === 'boot') screen = <Spinner />;
  else switch (route.name) {
    case 'welcome': screen = <Welcome />; break;
    case 'phone': screen = <Phone />; break;
    case 'otp': screen = <Otp params={route.params} />; break;
    case 'home': screen = <Home />; break;
    case 'options': screen = <Options params={route.params} />; break;
    case 'track': screen = <Track key={route.params?.id ?? 'pending'} params={route.params ?? {}} />; break;
    case 'history': screen = <History />; break;
    case 'profile': screen = <Profile />; break;
    case 'support': screen = <Support params={route.params} />; break;
    case 'cars': screen = <Cars />; break;
    case 'driverHome': screen = <DriverHome />; break;
    default: screen = <Home />;
  }
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {screen}
      {toast ? <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: 36, backgroundColor: '#14281D', borderRadius: 12, padding: 12 }}><Text style={{ color: '#fff' }}>{toast}</Text></View> : null}
    </View>
  );
}

function Guarded() {
  const { nav, me } = useApp();
  return <ErrorBoundary onReset={() => nav.reset(me ? 'home' : 'welcome')}><Router /></ErrorBoundary>;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppProvider><Bridges /><Guarded /></AppProvider>
    </SafeAreaProvider>
  );
}

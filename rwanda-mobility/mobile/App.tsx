import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/lib/app';
import { Welcome, Phone, Otp } from './src/screens/auth';
import { Scan } from './src/screens/scan';
import { Options, Track } from './src/screens/passenger';
import { PassengerShell, DriverShell } from './src/screens/tabs/shells';
import { DriverGuide } from './src/screens/driver/guide';
import { Invite } from './src/screens/invite';
import { AbasareApply } from './src/screens/driver/abasareApply';
import { History } from './src/screens/history';
import { Profile } from './src/screens/profile';
import { Support } from './src/screens/support';
import { DriverTracker } from './src/lib/driverTracking';
import { InsetsGate } from './src/ui/insets';
import { Cars } from './src/screens/cars';
import { CreditScreen } from './src/screens/money/credit';
import { ClaimsList, ClaimNew, ClaimDetail } from './src/screens/money/claims';
import { VehicleApply } from './src/screens/driver/vehicleApply';
import { R1Settings } from './src/screens/trust/appearance';
import { R1Rate } from './src/screens/trust/rate';
import { R1MyDrivers } from './src/screens/trust/favouriteDrivers';
import { R1Feedback } from './src/screens/trust/feedback';
import { AppLock } from './src/ui/AppLock';
import { Schedules } from './src/screens/growth/schedules';
import { Quests } from './src/screens/growth/quests';
import { Heatmap } from './src/screens/growth/heatmap';
import { Spinner, Toast } from './src/ui/components';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { installErrorReporting } from './src/lib/report';
import { initNotifications, listenForTaps, registerPush, routeFor } from './src/lib/push';
import './src/lib/bgLocation';   // registers the driver location task at startup (native Android only; inert elsewhere)
import { C } from './src/ui/theme';
import { appearance, useAppearance } from './src/lib/appearance';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { parseCode, savePending, takePending, type ParsedCode } from './src/lib/codes';
import { kv } from './src/lib/storage';

initNotifications();
void appearance.load();

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
  // Request-code deep links (abasare://r/CODE, or ?code=CODE on web). Signed out: remember the code and continue after sign-in.
  const deliver = React.useCallback((p: ParsedCode | null) => {
    if (!p) return;
    if (live.current.me) live.current.nav.push('scan', { code: p.code, svc: p.svc }); else void savePending(kv, p);
  }, []);
  React.useEffect(() => {
    if (!ready) return;
    let sub: { remove: () => void } | undefined;
    if (Platform.OS === 'web') {
      try { const q = new URLSearchParams(window.location.search); const c = parseCode(q.get('code')); if (c) { const sv = q.get('svc'); deliver(sv === 'ride' || sv === 'abasare' ? { ...c, svc: sv } : c); window.history.replaceState(null, '', window.location.pathname); } } catch { /* no window */ }
    } else {
      Linking.getInitialURL().then((u) => { if (u && u !== handledInitial) { handledInitial = u; deliver(parseCode(u)); } }).catch(() => {});
      sub = Linking.addEventListener('url', (e) => deliver(parseCode(e.url)));
    }
    return () => sub?.remove();
  }, [ready, deliver]);
  React.useEffect(() => {
    if (!ready || !uid) return;
    void takePending(kv).then((p) => { if (p) live.current.nav.push('scan', { code: p.code, svc: p.svc }); });
  }, [ready, uid]);
  return null;
}

let handledInitial: string | null = null;

function Router() {
  const { ready, nav, toast } = useApp();
  const ap = useAppearance();
  const route = nav.stack[nav.stack.length - 1];
  let screen: React.ReactNode;
  if (!ready || !ap.loaded || route.name === 'boot') screen = <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Spinner /></View>;
  else switch (route.name) {
    case 'welcome': screen = <Welcome />; break;
    case 'phone': screen = <Phone />; break;
    case 'otp': screen = <Otp params={route.params} />; break;
    case 'home': screen = <PassengerShell params={route.params} />; break;
    case 'scan': screen = <Scan params={route.params} />; break;
    case 'options': screen = <Options params={route.params} />; break;
    case 'track': screen = <Track key={route.params?.id ?? 'pending'} params={route.params ?? {}} />; break;
    case 'history': screen = <History />; break;
    case 'profile': screen = <Profile />; break;
    case 'support': screen = <Support params={route.params} />; break;
    case 'cars': screen = <Cars />; break;
    case 'credit': screen = <CreditScreen />; break;
    case 'claims': screen = <ClaimsList params={route.params} />; break;
    case 'claimNew': screen = <ClaimNew params={route.params} />; break;
    case 'claimDetail': screen = <ClaimDetail key={route.params?.id} params={route.params} />; break;
    case 'r1settings': screen = <R1Settings />; break;
    case 'r1rate': screen = <R1Rate key={route.params?.id} params={route.params} />; break;
    case 'r1drivers': screen = <R1MyDrivers />; break;
    case 'r1feedback': screen = <R1Feedback />; break;
    case 'schedules': screen = <Schedules />; break;
    case 'quests': screen = <Quests />; break;
    case 'heatmap': screen = <Heatmap />; break;
    case 'invite': screen = <Invite />; break;
    case 'vehicleApply': screen = <VehicleApply />; break;
    case 'driverGuide': screen = <DriverGuide params={route.params} />; break;
    case 'abasareApply': screen = <AbasareApply />; break;
    case 'driverHome': screen = <DriverShell />; break;
    default: screen = <PassengerShell />;
  }
  return (
    <View key={ap.version} style={{ flex: 1, backgroundColor: C.bg }}>
      {screen}
      <Toast text={toast} lift={route.name === 'home' || route.name === 'driverHome' ? 58 : 0} />
    </View>
  );
}

function Guarded() {
  const { nav, me } = useApp();
  return <ErrorBoundary onReset={() => nav.reset(me ? 'home' : 'welcome')}><Router /></ErrorBoundary>;
}

// The top bar is always the dark brand blue, so the status-bar icons are always light.
function ThemedStatusBar() { return <StatusBar style="light" />; }

export default function App() {
  return (
    <SafeAreaProvider>
      <InsetsGate>
        <ThemedStatusBar />
        <AppProvider><Bridges /><DriverTracker /><Guarded /><AppLock /></AppProvider>
      </InsetsGate>
    </SafeAreaProvider>
  );
}

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
import { C } from './src/ui/theme';

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

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppProvider><Router /></AppProvider>
    </SafeAreaProvider>
  );
}

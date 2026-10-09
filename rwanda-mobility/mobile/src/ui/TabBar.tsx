import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'react-native';
import { Text } from './components';
import { ICONS, type IconName } from './icons';
import { C, FS, MAX_W, R, SHADOW, SP } from './theme';

export type TabDef = { key: string; icon: IconName; label: string; badge?: boolean; testID?: string };

/** True while the on-screen keyboard is open (the bar hides so it never rides above the keyboard). */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return open;
}

/** Bottom navigation: one tap to any main area. 56 dp targets, labelled, safe-area aware, flag-yellow marker on the active tab. */
export function TabBar({ tabs, active, onPick }: { tabs: TabDef[]; active: string; onPick: (k: string) => void }) {
  const insets = useSafeAreaInsets(); const { width } = useWindowDimensions(); const kb = useKeyboardOpen();
  if (kb) return null;
  const cap = width > MAX_W + 40 ? { width: MAX_W, alignSelf: 'center' as const } : null;
  return (
    <View testID="tabbar" accessibilityRole="tablist" style={{ backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right, ...SHADOW.sheet }}>
      <View style={[{ flexDirection: 'row' }, cap]}>
        {tabs.map((tb) => {
          const on = tb.key === active;
          return (
            <Pressable key={tb.key} testID={tb.testID ?? `tab-${tb.key}`} onPress={() => onPick(tb.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={tb.label}
              style={({ pressed }) => ({ flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center', paddingTop: SP.xs, paddingHorizontal: 2, opacity: pressed ? 0.7 : 1 })}>
              <View style={{ position: 'absolute', top: 0, height: 3, width: 28, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: on ? C.gold : 'transparent' }} />
              <View style={{ width: 36, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                <Image accessibilityElementsHidden source={ICONS[tb.icon]} resizeMode="contain" style={{ width: on ? 34 : 29, height: on ? 34 : 29, opacity: on ? 1 : 0.62 }} />
                {tb.badge ? <View style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: C.danger, borderWidth: 1.5, borderColor: C.card }} /> : null}
              </View>
              <Text accessible={false} numberOfLines={1} style={{ fontSize: FS.xs, marginTop: 2, fontWeight: on ? '800' : '600', color: on ? C.primaryDark : C.muted }}>{tb.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Content area above the bar. Nested screens must not add the bottom inset again, so it is zeroed for them (the bar already covers it). */
export function TabShell({ tabs, active, onPick, children }: { tabs: TabDef[]; active: string; onPick: (k: string) => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1 }}>
        <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>{children}</SafeAreaInsetsContext.Provider>
      </View>
      <TabBar tabs={tabs} active={active} onPick={onPick} />
    </View>
  );
}

/** Keeps a tab's screen mounted once it has been opened (so a half-made booking survives a peek at another tab) but hidden while inactive. */
export function TabPane({ active, lazy = true, children }: { active: boolean; lazy?: boolean; children: React.ReactNode }) {
  const [seen, setSeen] = useState(active);
  useEffect(() => { if (active) setSeen(true); }, [active]);
  if (lazy && !seen && !active) return null;
  return <View style={active ? { flex: 1 } : { display: 'none' }} pointerEvents={active ? 'auto' : 'none'}>{children}</View>;
}

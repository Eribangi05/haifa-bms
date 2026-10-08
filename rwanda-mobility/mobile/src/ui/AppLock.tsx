import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { useApp } from '../lib/app';
import { useAppearance } from '../lib/appearance';
import { bioAuthenticate, bioSupport } from '../lib/biometric';
import { STRESS_SIGNOUT_AFTER, lockOnColdStart, shouldLockAfterBackground } from '../lib/lock';
import { showAlert } from './dialog';
import { Banner, Btn, EmptyState, Screen } from './components';
import { C } from './theme';

/**
 * Full-screen lock above the whole app. Locks on cold start and after N minutes in the background; unlocks with fingerprint / face / device PIN.
 * Never a trap: "Sign out" is always on the lock screen, and if the device can no longer authenticate the lock stays open. Inert on web.
 */
export function AppLock() {
  const { t, ready, me, signOut, registerBack } = useApp(); const ap = useAppearance();
  const [locked, setLocked] = useState(false); const [fails, setFails] = useState(0); const [busy, setBusy] = useState(false);
  const bgAt = useRef<number | null>(null); const cold = useRef(false); const trying = useRef(false);
  const enabled = ap.lockEnabled && Platform.OS !== 'web' && !!me;

  useEffect(() => {   // cold start
    if (cold.current || !ready || !ap.loaded) return; cold.current = true;
    if (enabled) void bioSupport().then((s) => { if (lockOnColdStart(true, s)) setLocked(true); });
  }, [ready, ap.loaded, enabled]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') { bgAt.current = Date.now(); return; }
      if (st !== 'active' || !enabled || locked) return;
      if (shouldLockAfterBackground(bgAt.current, Date.now(), ap.lockMinutes)) void bioSupport().then((s) => { if (s === 'ready') setLocked(true); });
      bgAt.current = null;
    });
    return () => sub.remove();
  }, [enabled, locked, ap.lockMinutes]);
  useEffect(() => (locked ? registerBack(() => true) : undefined), [locked, registerBack]);   // system back must not reveal the app
  useEffect(() => { if (!enabled && locked) setLocked(false); }, [enabled, locked]);

  const unlock = useCallback(async () => {
    if (trying.current) return; trying.current = true; setBusy(true);
    const ok = await bioAuthenticate(t('r1.lock.prompt'), t('common.cancel'));
    trying.current = false; setBusy(false);
    if (ok) { setLocked(false); setFails(0); } else setFails((n) => n + 1);
  }, [t]);
  useEffect(() => { if (locked) void unlock(); }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = () => showAlert(t('common.signout'), t('prof.signout.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.signout'), style: 'destructive', onPress: () => { setLocked(false); void signOut(); } }]);

  if (!locked) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, zIndex: 1000 }]} testID="applock" accessibilityViewIsModal>
      <Screen scroll={false} footer={<><Btn testID="cta" big title={t('r1.lock.unlock')} onPress={() => void unlock()} loading={busy} /><Btn kind="ghost" title={t('common.signout')} onPress={out} /></>}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState glyph="🔒" title={t('r1.lock.title')} body={t('r1.lock.body')} />
          {fails >= STRESS_SIGNOUT_AFTER ? <Banner text={t('r1.lock.stuck')} /> : null}
        </View>
      </Screen>
    </View>
  );
}

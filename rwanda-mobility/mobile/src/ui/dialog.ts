import { Alert, AlertButton, Platform } from 'react-native';

/** Alert.alert on native; window.confirm on web (React Native Web's Alert is a no-op). The last non-cancel button is the "confirm" action on web. */
export function showAlert(title: string, message?: string, buttons: AlertButton[] = [{ text: 'OK' }]) {
  if (Platform.OS !== 'web') { Alert.alert(title, message, buttons); return; }
  const actions = buttons.filter((b) => b.style !== 'cancel' && b.onPress);
  if (!actions.length) { window.alert([title, message].filter(Boolean).join('\n\n')); return; }
  if (window.confirm([title, message].filter(Boolean).join('\n\n'))) actions[actions.length - 1].onPress?.();
}

import React from 'react';
import { Modal } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { InsetsGate } from './insets';

/** Full-screen modal that has its own safe-area context (Android modals are separate windows) and closes on the system back gesture. */
export function AppModal({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent presentationStyle="fullScreen">
      <SafeAreaProvider><InsetsGate>{children}</InsetsGate></SafeAreaProvider>
    </Modal>
  );
}

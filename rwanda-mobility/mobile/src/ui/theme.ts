import { StyleSheet } from 'react-native';
// Abasare brand palette (logo navy, gold, Rwanda green accents) - original identity, configurable here.
export const C = {
  primary: '#0B3A9E', primaryDark: '#082B75', gold: '#F5B700', sky: '#1A5FB4',
  bg: '#F3F6FB', card: '#FFFFFF', ink: '#0F1B3D', muted: '#5A6685', line: '#DAE1EF',
  danger: '#C0392B', dangerBg: '#FDECEA', warn: '#8A6500', warnBg: '#FFF4CC', okBg: '#E3F4EC',
};
export const S = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: { fontSize: 24, fontWeight: '700', color: C.ink },
  h2: { fontSize: 18, fontWeight: '700', color: C.ink },
  body: { fontSize: 15, color: C.ink },
  muted: { fontSize: 13, color: C.muted },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: '#fff', color: C.ink },
  gap8: { gap: 8 }, gap12: { gap: 12 },
});

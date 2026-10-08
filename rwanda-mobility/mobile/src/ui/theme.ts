import { Platform, StyleSheet } from 'react-native';
import { DARK, LIGHT, type Palette } from '../lib/palette';
// Rwanda flag palette: sky blue #00A1DE (darkened to #0077B0 for text contrast), sun yellow #FAD201, green #20603D.
export const C: Palette = { ...LIGHT };
/** Switch the live palette (mutates `C` in place; the app remounts its screens afterwards so every style re-reads it). */
export function applyPalette(mode: 'light' | 'dark') { Object.assign(C, mode === 'dark' ? DARK : LIGHT); Object.assign(S, buildS()); }
/** Spacing, radius and type scale: use these instead of ad-hoc numbers so screens stay consistent. */
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const R = { sm: 10, md: 14, lg: 20, xl: 28, pill: 99 } as const;
export const FS = { xs: 11, sm: 13, md: 15, lg: 18, xl: 24, hero: 34 } as const;
/** Soft elevation. Android uses elevation, iOS shadow*, web box-shadow. */
const shadow = (o: number, r: number, y: number, el: number) => Platform.select({
  android: { elevation: el },
  ios: { shadowColor: '#0F1B3D', shadowOpacity: o, shadowRadius: r, shadowOffset: { width: 0, height: y } },
  default: { boxShadow: `0 ${y}px ${r * 2}px rgba(15,27,61,${o})` } as object,
}) as object;
export const SHADOW = { card: shadow(0.06, 4, 2, 2), raised: shadow(0.12, 8, 4, 6), sheet: shadow(0.16, 12, -4, 12) };
export const MAX_W = 640;
const buildS = () => StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: SP.lg },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  h1: { fontSize: FS.xl, fontWeight: '700', color: C.ink },
  h2: { fontSize: FS.lg, fontWeight: '700', color: C.ink },
  body: { fontSize: FS.md, color: C.ink },
  bold: { fontSize: FS.md, color: C.ink, fontWeight: '700' },
  muted: { fontSize: FS.sm, color: C.muted },
  card: { backgroundColor: C.card, borderRadius: R.md, padding: SP.md + 2, borderWidth: 1, borderColor: C.line, marginBottom: SP.md },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: R.md - 2, paddingHorizontal: SP.md + 2, paddingVertical: SP.md, fontSize: 16, backgroundColor: C.card, color: C.ink },
  gap8: { gap: SP.sm }, gap12: { gap: SP.md },
});
export const S = buildS();

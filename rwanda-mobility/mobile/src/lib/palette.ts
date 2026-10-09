// Colour palettes and contrast maths. Platform-free so it is unit-tested in plain Node (tests/palette.test.ts).
// Flag colours (sky blue, sun yellow, green) stay as brand accents in both modes; text/background pairs are tuned for contrast.
export const LIGHT = {
  primary: '#0077B0', primaryDark: '#005A87', gold: '#FAD201', sky: '#00A1DE', green: '#20603D',
  bg: '#F3F6FB', card: '#FFFFFF', ink: '#0F1B3D', muted: '#5A6685', line: '#DAE1EF',
  danger: '#C0392B', dangerBg: '#FDECEA', warn: '#8A6500', warnBg: '#FFF4CC', okBg: '#EDF8F3',
  goldBg: '#FFFBEA', skyBg: '#EDF7FC', toast: '#14281D', onPrimary: '#FFFFFF', onDanger: '#FFFFFF', onGold: '#0F1B3D', placeholder: '#6B7A8F', mapBg: '#E7EEE9',
  header: '#0069A8', onHeader: '#FFFFFF',   // brand header bar (sky blue, darkened for white text)
};
export type Palette = typeof LIGHT;
export const DARK: Palette = {
  primary: '#5BBDEB', primaryDark: '#8FD3F4', gold: '#FAD201', sky: '#00A1DE', green: '#23744A',
  bg: '#0B1220', card: '#151F33', ink: '#EAF0FA', muted: '#A7B4CF', line: '#2C3A58',
  danger: '#FF8F80', dangerBg: '#3B1E1C', warn: '#F2CB5A', warnBg: '#3A3114', okBg: '#12301F',
  goldBg: '#2E2911', skyBg: '#10293A', toast: '#223A2C', onPrimary: '#06202F', onDanger: '#2B0B07', onGold: '#0F1B3D', placeholder: '#8B9AB8', mapBg: '#1B2638',
  header: '#0F3554', onHeader: '#EAF0FA',
};
export type ThemePref = 'system' | 'light' | 'dark';
export const isThemePref = (x: unknown): x is ThemePref => x === 'system' || x === 'light' || x === 'dark';
export const resolveTheme = (pref: ThemePref, system: string | null | undefined): 'light' | 'dark' => (pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref);

/** WCAG relative luminance / contrast ratio of two #RRGGBB colours. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Text/background pairs the UI really uses; every one must reach 4.5:1 in both palettes. */
export const TEXT_PAIRS: [keyof Palette, keyof Palette][] = [
  ['ink', 'bg'], ['ink', 'card'], ['muted', 'bg'], ['muted', 'card'], ['primary', 'card'], ['primary', 'bg'], ['primaryDark', 'okBg'], ['primary', 'okBg'], ['primary', 'skyBg'],
  ['onPrimary', 'primary'], ['onDanger', 'danger'], ['danger', 'card'], ['danger', 'dangerBg'], ['warn', 'warnBg'], ['warn', 'card'], ['ink', 'warnBg'], ['ink', 'okBg'], ['ink', 'goldBg'], ['onGold', 'gold'], ['ink', 'skyBg'], ['onHeader', 'header'],
];

export const LARGE_TEXT_FACTOR = 1.25;
export const MAX_FONT_MULT = 1.4;
/** Font scale cap passed to Text: with the large-text factor applied by us, the OS scale may only add up to the overall 1.4 cap. */
export const fontCap = (large: boolean) => (large ? MAX_FONT_MULT / LARGE_TEXT_FACTOR : MAX_FONT_MULT);

/** Generalised for the four text sizes: with our own scale applied, the OS font scale may only add up to the overall cap. */
export const fontCapFor = (scale: number) => Math.max(1, MAX_FONT_MULT / Math.max(1, scale));

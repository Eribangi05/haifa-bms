/** Normalise Rwandan mobile numbers to +250XXXXXXXXX. Accepts 07XXXXXXXX, 2507XXXXXXXX, +2507XXXXXXXX, 7XXXXXXXX. */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/[\s\-().]/g, '');
  let m = d.match(/^(?:\+?250|0)?(7[2389]\d{7})$/);   // 072/073 Airtel, 078/079 MTN (prefix list configurable here)
  return m ? `+250${m[1]}` : null;
}

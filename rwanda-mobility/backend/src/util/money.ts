/** All money is integer RWF. Basis-point helpers use integer math with round-half-up. */
export const bps = (amount: number, rateBps: number) => Math.floor((amount * rateBps + 5000) / 10000);
export function roundTo(amount: number, step: number): number {
  if (step <= 1) return Math.round(amount);
  return Math.floor((amount + step / 2) / step) * step;
}
export const maskMsisdn = (m: string) => m.replace(/^(\+250)(\d{2})\d{4}(\d{3})$/, '$1$2****$3');

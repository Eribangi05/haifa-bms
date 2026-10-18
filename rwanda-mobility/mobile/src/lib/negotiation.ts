/** Prices a rider may propose for a platform price: steps of 5% down to the largest allowed discount, rounded up to the price step so the server always accepts them. */
export function proposalChoices(total: number, maxPct: number, step = 50): { pct: number; amount: number }[] {
  const out: { pct: number; amount: number }[] = [];
  for (let pct = 5; pct <= maxPct; pct += 5) out.push({ pct, amount: Math.min(total, Math.ceil(Math.ceil((total * (100 - pct)) / 100) / step) * step) });
  return out.filter((x, i, a) => x.amount < total && a.findIndex((y) => y.amount === x.amount) === i);
}


/** Prices a driver may answer with: three even steps from the rider's proposal up to the usual price, rounded up to the price step. */
export function counterChoices(proposed: number, usual: number, step = 50): number[] {
  return [...new Set([1, 2, 3].map((k) => Math.min(usual, Math.ceil((proposed + ((usual - proposed) * k) / 3) / step) * step)))].filter((a) => a > proposed && a <= usual);
}

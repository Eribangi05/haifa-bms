// Weekly driver statement: the text a driver shares (WhatsApp, SMS, e-mail) from GET /drivers/me/statement. Pure, unit-tested in tests/statement.test.ts.
export type StatementView = {
  statement_no: string; week: number; from: string; to: string; driver: string;
  days: { day: string; trips: number; fares: number; commission: number; fleet_share: number; net: number; cash: number }[];
  totals: { trips: number; fares: number; commission: number; fleet_share: number; net: number; cash: number };
  paid_out: { amount: number; n: number }; rating: { avg: number; count: number };
};
type Tr = (k: any, v?: Record<string, string | number>) => string;
const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/** Plain-text statement in the app language (`tr` is the app's own translator, so the text never mixes languages). */
export function statementText(s: StatementView, tr: Tr): string {
  const L = [tr('st.msg.head', { no: s.statement_no }), s.driver ? tr('st.msg.driver', { name: s.driver }) : '', tr('st.week', { from: dm(s.from), to: dm(s.to) }), ''];
  for (const d of s.days) L.push(`${dm(d.day)}: ${tr('st.msg.day', { trips: d.trips, net: money(d.net) })}`);
  if (!s.days.length) L.push(tr('st.none'));
  L.push('', `${tr('st.trips')}: ${s.totals.trips}`, `${tr('st.fares')}: ${money(s.totals.fares)}`, `${tr('st.commission')}: ${money(s.totals.commission)}`);
  if (s.totals.fleet_share > 0) L.push(`${tr('st.fleet')}: ${money(s.totals.fleet_share)}`);
  L.push(`${tr('st.net')}: ${money(s.totals.net)}`, `${tr('st.cash')}: ${money(s.totals.cash)}`);
  if (s.paid_out.amount > 0) L.push(`${tr('st.paid')}: ${money(s.paid_out.amount)}`);
  if (s.rating.count > 0) L.push(`${tr('st.rating')}: ${s.rating.avg.toFixed(2)} (${s.rating.count})`);
  return L.filter((x, i, a) => !(x === '' && (i === 0 || a[i - 1] === ''))).join('\n');
}

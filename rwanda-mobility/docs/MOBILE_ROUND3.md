# Mobile Round 3 progress notes (credit, deposit, claims, USSD, receipts)

Status labels: "built" = code written, tsc clean, unit tests green; "web-tested" = Playwright run against a local backend; nothing here was run on a device.

## Item 1: credit and loyalty - built
- `src/screens/r3/credit.tsx`: `CreditScreen` (balance, reserved, expiry notice, statement grouped by day with source icons, loyalty card with tier ring, perks, redeem in steps with confirmation and idempotency key), `CreditChip` on Home, `useWallet`.
- `src/screens/r3/creditPay.tsx`: `useCreditChoice` in Options (use credit full/partial, breakdown, `wallet` / `wallet_partial` fields, `insufficient_credit` message).
- `src/screens/r3/receiptLines.tsx`: `PaidLines` (credit / deposit / remainder) in Pay card and receipt; `HistoryExtras` (credit line + report link) in History.
- Pure logic: `src/lib/money3.ts`, tests `tests/money3.test.ts`. Strings: `locales/r3.*.ts` (generated, rw/fr/en).
- Entry points: Home chip, Profile card. Route `credit` in App.tsx.

## Item 2: Abasare deposit - built
- `src/screens/r3/deposit.tsx`: `DepositCard` on Track while `awaiting_deposit` (credit or MoMo, pending/slow/failed/retry, cancel), `DepositNote` for paid/applied/refunded/expired. The searching spinner is hidden while a deposit is due.

## Item 3: claims - built
- `src/screens/r3/claims.tsx`: `ClaimsList`, `ClaimNew` (type, description, amount, photos uploaded after creation), `ClaimDetail` (timeline, evidence, before/after comparison, decision, settlement, reply box for respondent, info-requested flow, withdraw). Routes `claims`, `claimNew`, `claimDetail`; push routing in `push.ts` via `claimRoute`.
- Entries: Profile, Done card and History row (Report a problem), driver mode "Claims about me".

## Item 4: USSD - built
- `src/screens/r3/ussd.tsx`: `UssdCard` in Help and Profile; shortcode shown only if `/config` returns `ussd.shortcode` (it does not today, so the generic text shows).

## Item 5: receipts - built (see PaidLines).

## Caveats
- Credit cannot be applied after the trip (contract: reserved at booking); the Pay card only shows the breakdown.
- Drivers can read and answer claims about them; filing a claim as a driver is not exposed in the UI.

## Tests (final)
- `npm test` green (tests/money3.test.ts added). `npx tsc --noEmit` clean for the round 3 files.
- `node e2e/r3-e2e.mjs /tmp/shots-r3`: ALL OK (rw + fr): credit statement, redeem via seeded points, full and partial credit booking, deposit gating with MoMo failure/retry/pending/credit/refund, claim with photo, driver reply, staff decision and credit settlement (staff steps via backend services, `e2e/r3-seed.mts`), USSD card, History credit line.
- Existing e2e on the round 3 build: driver, abasare, i18n, responsive pass; scan passes after making its locale loading independent of the extensionless locale imports; app-e2e fails only at the rating step (round 1 changed the rating UI wording); layout-e2e fails at the Profile "Emergency contacts" text (round 1 profile change). Neither touches round 3 code.

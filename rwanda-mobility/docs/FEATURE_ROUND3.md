# Round 3: customer credit and loyalty, Abasare deposit, claims, USSD

Contract for the mobile client and the admin console. All paths are under `/api/v1` unless stated. Money is integer RWF. Errors keep the usual shape `{ "error": { "code", "message", "details" } }` and the `message` follows `Accept-Language` (rw, fr, en; never mixed). Everything that touches an MTN, telecom or insurer system is **SIMULATED or PENDING**; regulated money handling is deliberately avoided: **credit cannot be topped up with cash and cannot be withdrawn**.

Migrations: `014_credit_loyalty_deposit.sql`, `015_claims.sql`, `016_ussd.sql` (additive, idempotent).
USSD details (what the telecom must configure, message limits): `docs/USSD.md`.

## 1. Customer credit and loyalty

Credit sits on the ledger as a liability per customer (`WALLET_CREDIT`), credit reserved for an open booking in `WALLET_HELD`, deposits in `DEPOSIT_HELD`. Sources: refunds issued as credit, promo / referral / quest / goodwill credits, claim settlements, loyalty redemption, staff adjustments. `GET /admin/wallet/reconciliation` proves the ledger equals the per-customer lots, reservations and deposits; the bank reconciliation run now also reports `credit_reconciled`.

### Customer endpoints

`GET /wallet`
```json
{ "currency": "RWF", "available": 12500, "reserved": 2050, "next_expiry": null, "expiring_within_30_days": 0,
  "note": "Credit can only be spent on trips. It cannot be withdrawn or topped up with cash." }
```
(`available` is what can be spent now, `reserved` is held for an open booking.)

`GET /wallet/statement?limit=30&before=<id>` (newest first, `next_before` pages)
```json
{ "balance": { "available": 12500, "held": 0 },
  "entries": [ { "id": 41, "kind": "spend", "source": "booking", "available_delta": 0, "held_delta": -2050, "available_after": 12500, "held_after": 0, "booking_id": "…", "memo": "Paid for a trip", "created_at": "…" } ],
  "next_before": null }
```
`kind`: `credit | debit | hold | release | spend | expire`. Show `available_delta` / `held_delta`; `memo` is English staff text for adjustments, so render your own label from `kind` and `source`.

`GET /loyalty`
```json
{ "enabled": true, "points": 700, "lifetime_points": 2500, "tier": "silver", "credit_value_rwf": 700,
  "next_tier": { "tier": "gold", "points_needed": 7500 },
  "earn": { "rwf_per_point": 100, "bonus_pct": 10 },
  "redeem": { "rwf_per_100_points": 100, "min_points": 500, "step": 100 },
  "tiers": [ { "tier": "bronze", "min_points": 0, "bonus_pct": 0, "extra_free_cancel_s": 0 }, { "tier": "silver", "min_points": 2000, "bonus_pct": 10, "extra_free_cancel_s": 30 }, { "tier": "gold", "min_points": 10000, "bonus_pct": 25, "extra_free_cancel_s": 60 } ],
  "events": [ { "kind": "earn", "points": 20, "booking_id": "…", "memo": "Completed trip", "created_at": "…" } ] }
```
`GET /loyalty/tiers` (public) returns just `{ "tiers": [...] }`.

`POST /loyalty/redeem` body `{ "points": 500 }`, optional `Idempotency-Key`. Returns `{ "replay": false, "redeemed_points": 500, "credit_added": 500, ...loyalty view }`. Errors: `invalid_points` (not a multiple of 100), `below_min_redeem`, `insufficient_points` (409), `credit_cap_exceeded` (409), `loyalty_disabled`.

Points are earned when a trip's payment settles (1 point per `loyalty.earn_rwf_per_point` RWF of final fare, plus the tier bonus). Tier is by lifetime points. Perk implemented: extra free-cancel seconds per tier. A `loyalty_tier_up` notification is sent.

### Paying a booking with credit

`POST /bookings` accepts two new `payment_method` values:

| payment_method | extra fields | behaviour |
|---|---|---|
| `wallet` | none | The whole estimated fare is reserved at booking. Needs `available >= estimated_fare` else `409 insufficient_credit` with `details: { available, needed }`. |
| `wallet_partial` | `wallet_amount` (optional, default = all free credit up to the fare), `remainder_method` (`cash` default, or `mtn_momo`) | Reserves that amount; the rest is paid normally after the trip. If `wallet_amount` covers the fare it becomes `wallet`. |

The booking view gains (passenger and staff views):
```json
{ "channel": "app",
  "wallet": { "mode": "partial", "reserved": 400, "applied": 0 },
  "deposit": null, "awaiting_deposit": false,
  "payment_method": "cash" }
```
For `wallet_partial` the stored `payment_method` is the remainder method. At completion the final fare is applied to the reserved credit; unused reserved credit goes back to `available`; if the final fare is higher than reserved, a full-`wallet` booking tops up from free credit and any shortfall is collected in cash. `payment.amount` (what the driver or MoMo must collect) is the remainder only; a fully prepaid booking gets a `payment` with `method: "wallet"`, `status: "SUCCESS"` and settles at once. `wallet.applied` shows what was used. Cancelling (by anyone, or no driver found) returns the reserved credit immediately. Wallet cannot be combined with corporate or partner billing.

### Refund as credit

`POST /admin/finance/refunds` takes `"as_credit": true` (default false). On approval the refund becomes customer credit (ledger `REFUNDS` to `WALLET_CREDIT`) instead of a manual provider payout; the decision response includes `refunded_as_credit`. Refunds of bookings paid with credit always return as credit.

### Referral rewards as credit

Setting `referral.reward_credit` above 0 pays both sides that many RWF as credit instead of the one-time promo code.

### Credit expiry

Setting `wallet.credit_expiry_days` (0 = never). New credit expires FIFO per grant; expired credit moves to `CREDIT_EXPIRED_REVENUE`; a `credit_expiring` notification goes out 7 days before.

### Admin endpoints

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /admin/wallet/lookup?q=` | `wallet.view` | phone, name or user id; returns balances and points |
| `GET /admin/wallet/:userId/statement` | `wallet.view` | statement + summary + loyalty view |
| `POST /admin/wallet/adjustments` `{user_id, amount, reason (>=10 chars), source: adjustment\|promo\|quest\|goodwill}` | `wallet.adjust` | `amount` may be negative (only for `adjustment`). Below `wallet.adjust_approval_threshold` applies at once (`status: applied`); at or above it returns `needs_approval: true`, `status: pending`. Audited. |
| `GET /admin/wallet/adjustments?status=pending` | `wallet.view` | |
| `POST /admin/wallet/adjustments/:id/decision` `{approve}` | `wallet.adjust.approve` | maker-checker: the requester gets 403 |
| `GET /admin/wallet/reconciliation` | `wallet.view` | `{ ok, credit_mismatches, hold_mismatches, deposit_mismatches, negative_balances, totals }` |
| `GET /admin/loyalty/config` | `wallet.view` | tiers + the relevant settings; edit them on the Settings page (group "Credit & loyalty", permission `settings.manage`) |
| `GET /admin/deposits` | `wallet.view` | deposit rows |

Settings (all in Settings with labels, units and ranges): `wallet.enabled`, `wallet.credit_expiry_days`, `wallet.max_balance`, `wallet.adjust_approval_threshold`, `referral.reward_credit`, `loyalty.enabled`, `loyalty.earn_rwf_per_point`, `loyalty.redeem_rwf_per_100_points`, `loyalty.min_redeem_points`, `loyalty.silver_min_points`, `loyalty.gold_min_points`, `loyalty.silver_bonus_pct`, `loyalty.gold_bonus_pct`, `loyalty.silver_extra_grace_s`, `loyalty.gold_extra_grace_s`.

## 2. Abasare deposit (pay before the trip)

Setting `abasare.deposit_percent` (default 0 = off). When above 0, an Abasare booking (not corporate-billed) is created **but never dispatched** until the deposit is paid: `status` stays `REQUESTED` (or `SCHEDULED`), `awaiting_deposit: true`.

Booking view `deposit`:
```json
{ "required": true, "status": "awaiting_payment", "percent": 30, "amount": 4500, "held": 0, "applied": 0, "refunded": 0, "retained": 0,
  "pay_by": "2026-10-08T10:12:00Z", "paid_at": null, "paid_with": null, "last_attempt": null }
```
`status`: `awaiting_payment | pending | failed | paid | captured | applied | refunded | expired | cancelled`. `last_attempt`: `{ method, status, failure_reason }`.

* `GET /bookings/:id/deposit` returns `{ "deposit": {...} }`.
* `POST /bookings/:id/deposit/pay` `{ "method": "mtn_momo", "msisdn": "0788123456" }` or `{ "method": "wallet" }` returns `{ "deposit": {...} }`. MoMo uses the same provider layer as fares (SIMULATOR: numbers ending `0000` fail, `9999` stay pending). Repeating while a request is in flight does not create a second charge. Poll the booking or deposit until `status` is `paid`; the booking then dispatches by itself.
* Errors: `deposit_already_paid` (409), `deposit_closed` (409: cancelled or expired), `payment_method_unavailable`, `invalid_phone`, `insufficient_credit` (409, wallet), `provider_error` (502).

Lifecycle: failed or timed-out attempts (15 min) can be retried until `pay_by` (`abasare.deposit_timeout_min` after booking; for scheduled bookings the scheduled time). After that the booking is cancelled by the system (`deposit_expired` notification). **A payment that succeeds after the deposit expired or the booking was cancelled is kept as customer credit and never dispatches** (`deposit_late_credit` notification). Provider callbacks for deposit references are handled by the existing `/webhooks/payments/:provider` endpoint.

At completion the deposit is applied to the final fare: any excess is refunded as credit, any shortfall is collected normally (`payment.amount` is the remainder; a deposit that covers the fare settles immediately). Cancelling before a driver is assigned (or inside the free window) refunds the full deposit as credit. Cancelling after the free window keeps the cancellation fee from the deposit first (`retained`) and refunds the rest as credit; no extra debt is created for the part the deposit covered. Refunds to the MoMo wallet itself are not available (no refund API); they are always credit.

## 3. Damage, loss and injury claims

Parties are the booking's passenger (called `owner` on Abasare bookings) and driver. Strangers get `404` for everything; internal notes, assignment and insurer data never reach the parties.

Statuses: `submitted -> under_review <-> info_requested -> accepted | partially_accepted | rejected -> settled -> closed`, plus `withdrawn` (claimant, before a decision). `submitted` may go straight to `info_requested`.

### Party endpoints

`POST /bookings/:id/claims` body `{ "type": "damage|loss|injury|other", "description": "...(10-2000)", "claimed_amount": 40000 }` returns `201` and the claim view below. Errors: `claim_window_closed` (409, `claims.filing_window_hours` after the trip ended, details `{hours}`), `claim_exists` (409, one open claim per booking, person and type), `404` if not a party. For Abasare bookings all handover photos are attached automatically.

`GET /claims` returns `{ "claims": [brief] }`. `GET /claims/:id`:
```json
{ "id": "…", "ref": "CL-1A2B3C4D", "booking_id": "…", "type": "damage", "status": "under_review", "claimed_amount": 40000,
  "description": "...", "you_are": "claimant", "claimant_role": "owner", "respondent_role": "driver",
  "reply_due_at": "…", "replied": false, "info_due_at": null,
  "decision": null, "settlement": null, "created_at": "…", "updated_at": "…",
  "events": [ { "id": 1, "author_role": "owner", "kind": "filed", "visibility": "public", "body": "...", "meta": {}, "created_at": "…" } ],
  "evidence": [ { "id": "…", "source": "handover", "phase": "pickup", "caption": null, "at": "…", "url": "/api/v1/files/evidence/….jpg?token=…" } ],
  "booking": { "ref": "RM-…", "pickup": "…", "destination": "…", "completed_at": "…", "abasare": true },
  "comparison": { "pickup": { "record": { "odometer_km": 45210, "fuel_percent": 50, "notes": "…", "damage_noted": false, "owner_response": "ok", "owner_note": null }, "photos": ["url"] },
                  "dropoff": { "record": { "...": "..." }, "photos": ["url"] } } }
```
`you_are` is `claimant` or `respondent`; `comparison` is `null` for normal rides. Evidence and photo URLs are signed and expire after 5 minutes: fetch the claim again for fresh links. After a decision `decision` is `{ amount, reason, at }`; after settlement `settlement` is `{ kind: "credit|manual_payout", amount, at }`.

* `POST /claims/:id/messages` `{ "body": "..." }`. From the respondent this is the **right of reply** (the first one is recorded as `replied`). From the claimant while `info_requested` it returns the claim to `under_review`.
* `POST /claims/:id/evidence` multipart: field `file` (JPEG, PNG or PDF, 5 MB, same scanner and private storage as Abasare handover photos), optional field `caption`. At most `claims.max_evidence` files (`too_many_evidence`, 409). Allowed while the claim is open (`submitted`, `under_review`, `info_requested`); `claim_closed` (409) otherwise.
* `POST /claims/:id/withdraw` (claimant only).

Notifications (in the user's language): `claim_filed`, `claim_received` (to the other party, with the reply deadline), `claim_info_requested`, `claim_reply_added`, `claim_accepted`, `claim_partially_accepted`, `claim_rejected`, `claim_settled`, reminders `claim_reminder_reply`, `claim_reminder_info`. Time limits: `claims.sla_hours` (first response, staff warned at 75%), `claims.reply_hours`, `claims.info_reply_hours`, `claims.auto_close_days`.

### Staff endpoints

| Endpoint | Permission |
|---|---|
| `GET /admin/claims?status&type&assigned=me\|unassigned&overdue=true&q` | `claims.view` |
| `GET /admin/claims/:id` (full timeline incl. internal notes, phones, insurer fields, evidence, comparison) | `claims.view` |
| `POST /admin/claims/:id/assign` `{staff_id?}` (default: me) | `claims.handle` |
| `POST /admin/claims/:id/notes` `{body}` (internal) | `claims.handle` |
| `POST /admin/claims/:id/review` `{action: "start"\|"request_info", message?}` | `claims.handle` |
| `POST /admin/claims/:id/evidence` multipart | `claims.handle` |
| `POST /admin/claims/:id/decision` `{outcome: accepted\|partially_accepted\|rejected, amount?, reason (>=10), skip_reply_window?}` | `claims.decide` |
| `POST /admin/claims/:id/settlement` `{kind: credit\|manual_payout, amount?, reference?}` | `claims.decide` |
| `POST /admin/claims/:id/settlement/decision` `{approve}` | `claims.settle.approve` |
| `PATCH /admin/claims/:id/insurer` `{policy_ref?, insurer_claim_ref?, insurer_status?}` | `claims.handle` |
| `POST /admin/claims/:id/close` | `claims.handle` |

Rules: a decision waits until the other party replied or `reply_due_at` passed (`reply_window_open`, 409) unless `skip_reply_window` is sent (audited). `accepted` grants the full claimed amount, `partially_accepted` needs a lower positive amount, `rejected` grants 0. Settlement from `accepted` / `partially_accepted` only: `credit` adds customer credit (ledger `CLAIMS_EXPENSE` to `WALLET_CREDIT`), `manual_payout` needs a `reference` and records a transfer made outside the platform (ledger `CLAIMS_EXPENSE` to `PLATFORM_BANK`). Amounts at or above `claims.settlement_approval_threshold` return `needs_approval: true` and wait for a different person with `claims.settle.approve`. Insurer fields are entered by hand: **no insurer integration exists (PENDING)**. Handover photos of a booking with an open claim are exempt from the retention purge.

## 4. USSD channel

`POST /ussd/callback` (outside `/api/v1`). See `docs/USSD.md`. Bookings made there carry `channel: "ussd"` (visible in the booking view and admin) and use `*_ussd` SMS templates. Admin: `GET /admin/ussd/sessions`, `GET /admin/ussd/stats?days=30` (permission `ussd.view`).

## 5. Admin console

New file `admin-web/views-money.js`, three tabs: **Credit & loyalty** (lookup, statement, adjust, pending approvals, tiers and reconciliation), **Claims** (queue, timeline, before/after evidence, decision, settlement, insurer), **USSD channel** (stats and session log). Tabs show only for roles holding `wallet.view`, `claims.view`, `ussd.view`.

## 6. New permissions

`wallet.view` (support_agent, support_lead, finance_officer, finance_approver, business_manager), `wallet.adjust` (finance_officer), `wallet.adjust.approve` (finance_approver), `claims.view` (support_agent, support_lead, finance_officer, finance_approver), `claims.handle` (support_agent, support_lead), `claims.decide` (support_lead), `claims.settle.approve` (finance_approver), `ussd.view` (support_lead, business_manager, analyst). `super_admin` has all. `docs/PERMISSION_MATRIX.md` and `docs/API.md` were deliberately not regenerated; run `npm run docs` after the other branches are merged.

## 7. Notification and error codes added

Templates: `credit_received`, `credit_expiring`, `loyalty_tier_up`, `deposit_paid`, `deposit_failed`, `deposit_expired`, `deposit_refunded`, `deposit_late_credit`, `claim_*` (above), `claim_sla_warning` (staff), `booking_confirmed_ussd`, `driver_assigned_ussd`, `driver_arrived_ussd`, `trip_completed_ussd`. Error codes (rw and fr texts in `services/moneyErrors.ts`): `insufficient_credit`, `credit_cap_exceeded`, `wallet_disabled`, `loyalty_disabled`, `invalid_points`, `below_min_redeem`, `insufficient_points`, `deposit_already_paid`, `deposit_closed`, `deposit_required`, `claim_window_closed`, `claim_exists`, `claim_transition`, `reply_window_open`, `claim_closed`, `too_many_evidence`, `no_settlement_due`, `settlement_pending`, `settlement_exceeds`, `reference_required`, `invalid_assignee`.

## 8. Known limits

* Credit has no cash-in or cash-out by design; money paid late to a closed deposit is kept as credit rather than returned to MoMo (no refund API integrated).
* Claim settlement does not recover money from the other party; staff can use the existing driver adjustment for that.
* A driver-side loyalty or credit view does not exist; credit is for passengers and owners.
* USSD: not run on a real network. Insurer: no integration. MoMo: simulator and sandbox only.

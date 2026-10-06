# Operations and support guide

## Roles on shift

| Role | Console tabs | Typical work |
|---|---|---|
| Dispatcher | Live map, Bookings | Watch searching bookings; manually assign; restart searches; PIN override (reason mandatory) |
| Driver verifier | Drivers | Review documents, approve/reject/ask for more info, suspend/reinstate |
| Support agent / lead | Support, Bookings, Passengers, Safety (lead) | Answer cases, mark disputes, request refunds (lead), restrict accounts (lead) |
| Finance officer / approver | Finance | Reconcile, review payouts, approve refunds/payouts/fare changes, record cash remittances |
| Business manager | Pricing, Promotions, Business & fleets | Propose fares/commissions, verify companies/fleets, issue invoices |
| Super admin | everything + Settings, Audit, Staff | Flags, templates, staff accounts |

## Daily routine

1. **Morning**: Overview -> check Pending verification, Support overdue, Open safety incidents, Refunds pending. Finance -> *Payment exceptions* and *Cash outstanding > 1 hour*.
2. **Reconciliation** (finance, once a day): download the MTN settlement report, paste rows into Finance -> Reconciliation (`reference`, `amount`, `status`), run it. Resolve each `MISSING_INTERNAL`, `MISSING_PROVIDER`, `AMOUNT_MISMATCH`, `STATUS_MISMATCH` with a note. Late-success items (`late_success_needs_review`) mean the passenger paid after our timeout: **never mark paid manually from a screenshot** - confirm in the provider portal, then ask a super admin/finance approver to settle via a documented adjustment or refund.
3. **Cash**: drivers owe commission on cash trips. Finance records bank/MoMo remittances (Finance -> cash remittance API) - the driver's `owed_to_platform` goes down.
4. **Payouts**: review -> approve (large ones need a different approver) -> pay manually via MoMo -> *Mark paid* with the MoMo transaction id. Automated disbursement is a pending integration.
5. **Document expiry**: the system reminds drivers at 30/14/7/1 days and removes ineligible drivers from dispatch automatically. Verifiers should clear the *Documents expired* list daily.

## Handling common cases

| Case | Steps |
|---|---|
| "Driver never came" | Open booking -> timeline. If the driver was assigned and never reached "arrived", cancel (no fee is charged when the driver is at fault), mark driver cancellation if needed, add a case note. |
| "Charged wrong fare" | Compare receipt breakdown (waiting minutes/extras are itemised). If wrong: *Mark disputed* -> request refund (maker) -> finance approver approves. A refund creates ledger entries; the original payment is never edited. |
| "Paid but app says unpaid" | Finance -> Transactions: search the payment reference. If `PENDING`, the sweeper re-checks the provider every 30 s. If `FAILED(timeout)` and the provider shows success -> late-success exception (see above). |
| Passenger lost their phone (PIN) | Dispatcher *PIN override* with a written reason after verifying identity by an out-of-band call; it is audited. |
| Driver complaint (harassment etc.) | Case is auto-marked *sensitive* (support_lead only). Suspend the driver pending investigation (reason required), add a safety block for the passenger if appropriate. |
| Account deletion request | Privacy tab -> Execute (30-day SLA). It fails while trips/balances are open - settle first. |

## Case priorities & SLAs (defaults)

Safety **urgent**, 2 h (SOS cases 15 min); payment/refund/fare dispute **high**, 8-24 h; others normal, 24-72 h. Overdue cases are highlighted red.

## Settings you will touch

Admin -> Settings: offer timeout, max rounds, group size (1 = sequential offers), cancellation grace/fee, no-show wait/fee, payout minimum/fee/large threshold, safety escalation contacts (SMS recipients for SOS), feature flags, notification templates (Kinyarwanda/English). Every change is audited.

## Escalation

L1 support -> support lead -> super admin (system) / finance approver (money) -> external (police/ambulance via humans, MTN merchant support for payment disputes).

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

## Abasare operations

* **Applications** (Admin -> Abasare): check licence issue date (>= 2 years), national ID, photo and **police clearance** (valid, not expired), then *Approve Abasare*. Approval also approves the driver account if they have no vehicle. Documents expiring remove the driver from dispatch automatically (hourly job + on every dispatch).
* **"Car condition issue" cases** are urgent and sensitive (support lead only). Open the booking: the **check-in and check-out photos, odometer, fuel and notes** are on the booking detail (links expire in 5 minutes). Compare phases, call both parties, record the outcome. Photos are kept while the case is open and purged after 90 days otherwise: **close cases promptly and export evidence if you need it longer**.
* **Pickup dispute blocks the trip start.** Resolve it with the owner (re-confirm) or cancel the booking; a dispatcher PIN override does not bypass the check-in requirement.
* **Hourly overtime** is billed in 30-minute blocks after a 10-minute grace and shown on the receipt; refunds go through the normal two-person refund process.
* **No insurance promises**: do not tell customers damage will be paid; follow the legal position agreed with counsel/insurer.

## Case priorities & SLAs (defaults)

Safety **urgent**, 2 h (SOS cases 15 min); payment/refund/fare dispute **high**, 8-24 h; others normal, 24-72 h. Overdue cases are highlighted red.

## Settings you will touch

Admin -> Settings (grouped by topic, each with its unit, allowed range, default and a Reset button): offer timeout, max rounds, group size (1 = sequential offers), cancellation grace/fee, no-show wait/fee, payout minimum/fee/large threshold, safety escalation contacts (SMS recipients for SOS), feature flags, notification templates (Kinyarwanda/English). Every change is audited.

## How to change prices

1. **Admin -> Pricing**. Under *Current prices* find the service and zone (for example Moto, Kigali) and press **Edit**. To price a new service or zone, press *Add or change a price*, pick the service and zone, and optionally *Copy values from* an existing price.
2. Change the fields you need. Each has a unit and a hint; a red message appears if a value is out of range. Amounts are whole RWF; tax is a percentage.
3. Optional: add **peak / off-peak windows** (for example +20% Monday to Friday 07:00-09:00, or -10% on Sundays). They show as their own line on the receipt, and can never push the fare above the rule's maximum surge (+50% by default) or below -50%.
4. Watch the **Live fare preview** on the right: enter a distance, time, day and hour (and hours for Abasare hourly hire) to see the fare line by line, the current price next to the proposed one, and the difference. Below it, *Current vs proposed* lists exactly what you changed.
5. Press **Review and propose**. The confirmation states the effect, for example "This changes the Moto fare in Kigali: Base fare 620 RWF -> 700 RWF. It applies to new bookings once approved; accepted quotes are unaffected." Optionally set a *start date* first to schedule the change; the old price stays live until then.
6. A **different person** with approval rights (finance approver or super admin) opens *Pricing -> Waiting for approval*, reads the list of changes and presses **Approve** (or Reject). Customers see the new price in new estimates immediately; trips already quoted keep their price.
7. **Very small team?** A super admin can switch on *Settings -> Pricing & approvals -> Allow self-approval*. The proposer can then approve their own change. A red banner shows on Pricing and Settings while it is on, and every self-approved change is marked `self_approved` in the audit log. Turn it off again as soon as a second approver exists.
8. If a change was a mistake, propose the old values again (use *Audit log -> pricing* to find them). Never edit the database directly.

Other business settings follow the same pattern: **Settings** (grouped by topic, with default values and *Reset to default*; the page shows who changed each value last), **Promotions** (audience, start/end dates and budget), and **Services** (switch a service on or off per zone, rename it, set seats).

## Escalation

L1 support -> support lead -> super admin (system) / finance approver (money) -> external (police/ambulance via humans, MTN merchant support for payment disputes).

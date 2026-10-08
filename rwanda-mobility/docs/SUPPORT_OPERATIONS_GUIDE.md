# Operations and support guide

## Using the console

Sign in at `/admin/` with your email, password and the 6-digit code from your authenticator app. The left menu (a drawer behind the menu button on a tablet or phone) only lists the pages your role may use; if a page you expect is missing, ask a super admin about your role. If you are signed out (session ended or revoked) the sign-in page appears with a message: sign in again and you return to the page you were on.

* **Tables**: click a column heading to sort, type in *Filter these rows* to narrow what is on screen, and use *Download CSV* to save the rows currently shown (filtered and sorted). Large tables show 50 rows per page. Searches that ask the server (bookings, drivers, support, payments, audit) return at most 200 rows: narrow the search to see older ones.
* **Dialogs** close with the Esc key, the x button or Cancel. Actions that change money, accounts or driver status ask for a reason; it is stored in the audit log.
* **Dark mode**: the moon/sun button in the top bar. The choice is remembered in this browser.
* The **Live map** needs access to `tile.openstreetmap.org`. If the network blocks it, a notice says so and the tables under the map still list every driver and booking position.

## Roles on shift

| Role | Pages in the console | Typical work |
|---|---|---|
| Dispatcher | Overview, Live map, Bookings, Drivers, Abasare, Safety | Watch searching bookings; manually assign (pick the driver from the list); restart searches; PIN override and cancel (reason mandatory); respond to SOS |
| Driver verifier | Drivers, Abasare | Review documents, approve/reject/ask for more info, suspend/reinstate, approve Abasare applications |
| Support agent | Live map, Bookings, Drivers and Abasare (view), Passengers, Support | Answer cases, mark bookings disputed |
| Support lead | As support agent, plus Safety, Privacy, Request codes | Sensitive cases, request refunds, waive cancellation fees, restrict accounts, privacy requests, venue QR codes |
| Finance officer | Overview, Drivers and Abasare (view), Finance | Reconcile, review payouts, request refunds, waive fees, record cash remittances |
| Finance approver | Overview, Finance, Pricing | Approve refunds, payouts and fare/commission changes (never your own, unless self-approval is switched on) |
| Business manager | Overview, Live map, Bookings, Drivers and Abasare (view), Pricing, Services, Promotions, Request codes, Business & fleets | Propose fares/commissions, switch services per zone, promotions, venue QR codes, verify companies/fleets, issue invoices |
| Analyst | Overview, Request codes | Read-only numbers and scan counts |
| Super admin | Everything, plus Settings, Audit log, Staff | Settings, flags, templates, staff accounts |

The exact permission list per role is in [`PERMISSION_MATRIX.md`](PERMISSION_MATRIX.md).

## Staff accounts

* **Invite**: Staff -> *Invite staff member* (name, email, role). Send the one-time link to that person only. They choose their own password (12+ characters) and scan their own authenticator QR code; you never see their secret. Unused invitations are listed under *Pending invitations* and can be revoked.
* **Leaver or lost laptop**: Staff -> *Revoke sessions* signs them out everywhere at once; *Disable* (with a reason) blocks sign-in until you press *Enable*.
* **Lost phone / authenticator**: this needs an engineer (there is no self-service reset on purpose): see the "Reset a staff member's authenticator" section of [`OPERATIONS_RUNBOOK.md`](OPERATIONS_RUNBOOK.md).

## Help centre, deadlines and wording (admin-editable)

Under **Content and rules**: the help-centre FAQ (each entry needs English, Kinyarwanda and French before it can be published), the response deadline, priority and sensitivity per support category (safety stays urgent/high, sensitive, within 24 h; changes apply to new cases), driver document rules, and notification wording. See `docs/ADMIN_FLEXIBILITY.md`.

## Daily routine

1. **Morning**: Overview -> read *Needs attention* (drivers waiting for verification, refunds awaiting approval, support cases past SLA, open safety incidents, disputed trips, requests with no driver found); each card opens the page that fixes it. Finance -> Reconciliation -> *Payment exceptions* and *Cash outstanding for more than 1 hour*.
2. **Reconciliation** (finance, once a day): download the MTN settlement report, paste rows into Finance -> Reconciliation (`reference`, `amount`, `status`), run it. Resolve each `MISSING_INTERNAL`, `MISSING_PROVIDER`, `AMOUNT_MISMATCH`, `STATUS_MISMATCH` with a note. Late-success items (`late_success_needs_review`) mean the passenger paid after our timeout: **never mark paid manually from a screenshot** - confirm in the provider portal, then ask a super admin/finance approver to settle via a documented adjustment or refund.
3. **Cash**: drivers owe commission on cash trips. Finance records bank/MoMo remittances through the API (`POST /admin/finance/cash-remittance`; there is no console screen for it yet) - the driver's `owed_to_platform` goes down.
3b. **Cancellation and no-show fees**: Finance -> *Cancellation fee debts* lists passengers who owe a fee (it is added to their next trip automatically). Waive one only with a clear reason, for example the driver was at fault; the waiver is audited.
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
| Hotel or bar asks for a QR poster | Request codes -> *New request code* (venue name, latitude/longitude, optional pickup note and expiry), then *Print poster* (A5, in Kinyarwanda, French and English) or *Download QR*. The *Scans*, *Bookings* and *Completed* columns show whether the venue uses it; *Deactivate* stops a code at once. |
| Passenger says they were charged a cancellation fee unfairly | Finance -> Cancellation fee debts -> find the passenger -> *Waive* with the reason. If it was already collected, request a refund from the booking instead. |

## Abasare operations

* **Applications** (Admin -> Abasare): check licence issue date (>= 2 years), national ID, photo and **police clearance** (valid, not expired), then *Approve Abasare*. Approval also approves the driver account if they have no vehicle. Documents expiring remove the driver from dispatch automatically (hourly job + on every dispatch).
* **"Car condition issue" cases** are urgent and sensitive (support lead only). Open the booking: the **check-in and check-out photos, odometer, fuel and notes** are on the booking detail (links expire in 5 minutes). Compare phases, call both parties, record the outcome. Photos are kept while the case is open and purged after 90 days otherwise: **close cases promptly and export evidence if you need it longer**.
* **Pickup dispute blocks the trip start.** Resolve it with the owner (re-confirm) or cancel the booking; a dispatcher PIN override does not bypass the check-in requirement.
* **Hourly overtime** is billed in 30-minute blocks after a 10-minute grace and shown on the receipt; refunds go through the normal two-person refund process.
* **No insurance promises**: do not tell customers damage will be paid; follow the legal position agreed with counsel/insurer.

## Case priorities & SLAs (defaults)

Safety **urgent**, 2 h (SOS cases 15 min); payment/refund/fare dispute **high**, 8-24 h; others normal, 24-72 h. Overdue cases are shown in red with "(overdue)" and are counted on the Overview.

## Settings you will touch

Admin -> Settings (grouped by topic, each with its unit, allowed range, default and a Reset button): offer timeout, max rounds, group size (1 = sequential offers), cancellation grace/fee, no-show wait/fee, payout minimum/fee/large threshold, safety escalation contacts (SMS recipients for SOS), feature flags, notification templates (Kinyarwanda, French and English: a message is only ever sent in one language). Every change is audited.

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

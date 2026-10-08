# Role and permission matrix

> Generated from `src/rbac.ts`. Permissions are enforced on the server for every endpoint; object-level checks (own bookings, own fleet, own company) apply on top. `*` = everything.

## Staff roles (web console, mandatory TOTP MFA)

| Role | Permissions |
|---|---|
| `super_admin` | `*` |
| `dispatcher` | `bookings.view_all`, `bookings.dispatch`, `drivers.view`, `analytics.view`, `safety.respond` |
| `support_agent` | `bookings.view_all`, `support.handle`, `drivers.view`, `users.view`, `wallet.view`, `claims.view`, `claims.handle` |
| `support_lead` | `bookings.view_all`, `support.handle`, `support.sensitive`, `safety.respond`, `drivers.view`, `users.view`, `users.restrict`, `privacy.handle`, `finance.refund.request`, `finance.waive_fee`, `diagnostics.view`, `codes.view`, `codes.manage`, `wallet.view`, `claims.view`, `claims.handle`, `claims.decide`, `ussd.view` |
| `driver_verifier` | `drivers.review`, `drivers.view`, `drivers.docs` |
| `finance_officer` | `finance.view`, `finance.refund.request`, `finance.payout.review`, `finance.reconcile`, `finance.waive_fee`, `analytics.view`, `drivers.view`, `wallet.view`, `wallet.adjust`, `claims.view` |
| `finance_approver` | `finance.view`, `finance.refund.approve`, `finance.payout.approve`, `finance.payout.review`, `pricing.approve`, `analytics.view`, `wallet.view`, `wallet.adjust.approve`, `claims.view`, `claims.settle.approve` |
| `business_manager` | `analytics.view`, `pricing.manage`, `promotions.manage`, `corporate.manage`, `fleet.manage`, `drivers.view`, `bookings.view_all`, `codes.view`, `codes.manage`, `growth.manage`, `partners.manage`, `wallet.view`, `ussd.view` |
| `analyst` | `analytics.view`, `diagnostics.view`, `codes.view`, `ussd.view` |
| `partner_manager` | `partner.portal` |

## End-user roles (mobile app)

| Role | Scope |
|---|---|
| `passenger` | Own profile, saved places, bookings, payments, ratings, support cases. Default for every new account. |
| `driver` | Own driver profile/vehicle/documents, offers and trips assigned to them, own earnings/wallet/payouts. Dispatch only after approval. |
| `fleet_manager` | Only the fleet(s) they belong to: drivers, vehicles, trips, earnings, invites, fleet payouts (owner only). |
| `corporate_admin` | Their company: members, policy, all company bookings, statements, invoices. |
| `corporate_booker` / employee | Book on the company account within policy and personal spending limit; see only their own company trips. |

## Maker-checker rules (two different people)

| Action | Maker | Checker |
|---|---|---|
| Fare change | `pricing.manage` | `pricing.approve` (not the maker, unless the super-admin-only setting `pricing.self_approval` is on; then allowed and audited as `self_approved`) |
| Commission change / exemption | `pricing.manage` | `pricing.approve` (same self-approval rule as fare changes) |
| Refund | `finance.refund.request` | `finance.refund.approve` (not the requester) |
| Large payout (>= configurable threshold) | `finance.payout.review` | `finance.payout.approve` (not the reviewer), release by someone other than the approver |
| Enable regulated flags (surge, negotiated fares, wallet) | any `settings.manage` holder cannot | `super_admin` only |

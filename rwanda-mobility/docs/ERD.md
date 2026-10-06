# Entity-relationship overview

Full DDL: `backend/migrations/001_init.sql` (constraints, partial unique indexes, triggers). Diagram shows the core relationships.

```mermaid
erDiagram
  users ||--o{ user_roles : has
  users ||--o{ sessions : has
  users ||--o| driver_profiles : "is driver"
  users ||--o{ saved_places : saves
  users ||--o{ emergency_contacts : lists
  driver_profiles ||--o{ driver_documents : uploads
  driver_profiles ||--o{ vehicles : drives
  driver_profiles }o--o| fleets : "belongs to"
  fleets ||--o{ fleet_members : staff
  fleets ||--o{ fleet_invites : invites
  corporate_accounts ||--o{ corporate_members : employs
  service_categories ||--o{ pricing_rules : priced_by
  service_zones ||--o{ zone_services : offers
  users ||--o{ fare_quotes : requests
  fare_quotes ||--o| bookings : "accepted as"
  users ||--o{ bookings : books
  driver_profiles ||--o{ bookings : serves
  corporate_accounts ||--o{ bookings : funds
  bookings ||--o{ booking_events : "status history"
  bookings ||--o{ dispatch_offers : offered
  bookings ||--o{ driver_locations : tracked
  bookings ||--o{ trip_shares : shared
  bookings ||--o{ trip_messages : chat
  bookings ||--o{ ratings : rated
  bookings ||--o{ payments : paid_by
  payments ||--o{ payment_provider_events : "provider notifications"
  bookings ||--o| driver_earnings : yields
  payments ||--o{ refunds : refunded_by
  ledger_accounts ||--o{ ledger_entries : holds
  users ||--o{ payouts : requests
  users ||--o{ support_cases : opens
  support_cases ||--o{ case_events : thread
  bookings ||--o{ safety_incidents : "may raise"
  promotions ||--o{ promotion_redemptions : used
  users ||--o{ notifications : receives
  users ||--o{ audit_logs : "acts (append-only)"
```

## Tables by module

| Module | Tables |
|---|---|
| Identity | `users`, `user_roles`, `roles`, `role_permissions`, `otp_challenges`, `sessions`, `consents`, `privacy_requests` |
| Rider | `saved_places`, `emergency_contacts` |
| Catalogue | `service_categories`, `service_zones`, `zone_services`, `places` |
| Pricing | `pricing_rules` (versioned, effective-dated, maker-checker status), `commission_rules`, `fare_quotes`, `promotions`, `promotion_redemptions`, `referrals` |
| Drivers | `driver_profiles`, `driver_documents`, `document_requirements`, `driver_status_history`, `vehicles` |
| Fleet / corporate | `fleets`, `fleet_members`, `fleet_invites`, `corporate_accounts`, `corporate_members`, `corporate_invoices` |
| Booking | `bookings`, `booking_events`, `dispatch_offers`, `driver_locations`, `trip_shares`, `trip_messages`, `ratings`, `safety_blocks` |
| Money | `payments`, `payment_provider_events`, `ledger_accounts`, `ledger_entries`, `driver_earnings`, `payouts`, `refunds`, `reconciliation_runs`, `reconciliation_items` |
| Support / safety | `support_cases`, `case_events`, `safety_incidents` |
| Platform | `notifications`, `notification_templates`, `feature_flags`, `system_settings`, `audit_logs` |

## Notable constraints

* `ledger_balanced` constraint trigger (deferred): sum(debit) = sum(credit) per `txn_id`.
* `ledger_immutable`, `audit_immutable`: UPDATE/DELETE raise.
* `one_active_trip_per_driver`, `one_active_trip_per_vehicle`, `one_open_request_per_passenger`, `one_live_payment_per_booking`, `one_active_vehicle_per_driver`.
* `bookings (passenger_id, idempotency_key)` unique; `payments.reference` unique; `driver_earnings.booking_id` unique (settle exactly once).
* Phone check `^\+250[0-9]{9}$`; amounts `>= 0`; integer money columns.

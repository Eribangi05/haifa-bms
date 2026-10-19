# Abasare Business portal

A web portal at `/business/` (for example https://abasare-api.onrender.com/business/) for two kinds of customers:

- **Companies** (hotels, NGOs, schools, tour operators): book rides for their team, set rules, see who spent what, download the monthly statement.
- **Fleets** (an owner with several drivers and vehicles): see drivers, vehicles, trips and earnings, invite drivers, request a payout.

It uses the same phone accounts and the same API as the phone app. Every rule (who may see which company, budgets, spending limits, fare ceilings) is enforced by the server. The page only shows what the API returns.

## Languages

Kinyarwanda, French and English, one language at a time. The choice is remembered in the browser.

## Companies

| Tab | Who | What |
|---|---|---|
| Overview | administrator | spent this month, trip count, budget, spend by cost centre |
| Rides | everyone in the company (administrators see all, others see their own) | list with status and fare |
| Book a ride | administrators and bookers | search pickup and destination, see prices (with the price per km), book for the company with a cost centre and a purchase-order reference |
| Team | administrator | add people by phone with a role (administrator, booker, employee), a per-ride spending limit and a cost centre; remove people |
| Monthly statement | administrator | trips for a month, totals, totals by cost centre, CSV download, print or save as PDF |
| Invoices | administrator | consolidated invoices |
| Rules | administrator | highest fare per ride, monthly budget, hours rides are allowed, allowed services |

A new company waits for manual verification by the Abasare team (Business accounts in the operations console) before bookings are allowed. The page says so.

## Fleets

Drivers (status, online now, rating, completed and cancelled counts, vehicle), vehicles (suspend or reinstate, documents expiring within 30 days), trips, earnings (gross fares, commission, fleet share, paid to drivers, balance) with a payout request for the owner, and driver invitations by phone. A fleet must be verified before it can invite drivers.

## Safety notes

- Sign-in is the same phone code as the app. On a test server that has no SMS provider yet (the server returns the code), the portal shows the code in a green box and fills it in, so a tester can get in; a production server never returns it. Tokens live in the tab's session storage and are dropped when the tab closes.
- The page loads only its own scripts (`script-src 'self'`) and builds every element with text nodes, never HTML strings.
- CSV downloads prefix any cell that starts with `=`, `+`, `-` or `@` so a name cannot run as a spreadsheet formula.
- What is typed in a form survives a background refresh of the same screen and is cleared after a successful save.

## Files

`backend/business-web/` (`index.html`, `app.js`, `i18n.js`, `style.css`), served by `backend/src/app.ts`. No build step. Browser test: `mobile/e2e/business-e2e.mjs`.

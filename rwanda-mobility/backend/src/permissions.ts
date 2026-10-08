// The permission catalogue: every permission a route can demand, with a plain-English description and a group for the role editor.
// Adding a permission = add it here AND demand it in a route (tests/audit.test.ts E-04 scans routes and fails on anything missing from this list).
export type PermInfo = { key: string; group: string; label: string; description: string };

export const PERMISSION_GROUPS = ['Operations', 'People and support', 'Money', 'Business', 'Partner', 'Administration'] as const;

export const PERMISSION_CATALOGUE: PermInfo[] = [
  { key: 'bookings.view_all', group: 'Operations', label: 'See all bookings', description: 'Open the live map and any booking, whoever booked it.' },
  { key: 'bookings.dispatch', group: 'Operations', label: 'Dispatch trips', description: 'Assign or re-search a driver, cancel a trip, add extra charges, override a trip PIN.' },
  { key: 'drivers.view', group: 'Operations', label: 'See drivers', description: 'View driver profiles, vehicles and status.' },
  { key: 'drivers.review', group: 'Operations', label: 'Approve drivers', description: 'Review documents and approve, reject or suspend driver applications.' },
  { key: 'drivers.docs', group: 'Operations', label: 'Open driver documents', description: 'Open the uploaded document images of a driver.' },
  { key: 'analytics.view', group: 'Operations', label: 'See reports', description: 'Dashboard, analytics and demand map.' },
  { key: 'diagnostics.view', group: 'Operations', label: 'See diagnostics', description: 'App error reports and technical diagnostics.' },
  { key: 'safety.respond', group: 'Operations', label: 'Respond to safety incidents', description: 'See SOS and safety incidents, update them, block a driver from a passenger.' },
  { key: 'ussd.view', group: 'Operations', label: 'See the USSD channel', description: 'View USSD sessions and usage (no personal data beyond what is needed).' },

  { key: 'support.handle', group: 'People and support', label: 'Handle support cases', description: 'Read and answer support cases and open fare disputes.' },
  { key: 'support.sensitive', group: 'People and support', label: 'Handle sensitive cases', description: 'See cases marked sensitive (safety, driver complaints).' },
  { key: 'users.view', group: 'People and support', label: 'Look up customers', description: 'Search and open passenger and driver accounts.' },
  { key: 'users.restrict', group: 'People and support', label: 'Restrict customers', description: 'Restrict or deactivate a customer account (never a colleague).' },
  { key: 'privacy.handle', group: 'People and support', label: 'Handle privacy requests', description: 'Export or delete a customer\'s data on request.' },
  { key: 'claims.view', group: 'People and support', label: 'See claims', description: 'Read damage, loss and injury claims.' },
  { key: 'claims.handle', group: 'People and support', label: 'Work on claims', description: 'Assign claims, add notes and request evidence.' },
  { key: 'claims.decide', group: 'People and support', label: 'Decide claims', description: 'Propose a decision on a claim.' },

  { key: 'finance.view', group: 'Money', label: 'See finance', description: 'Payments, ledger position, refunds and payouts (read).' },
  { key: 'finance.refund.request', group: 'Money', label: 'Request refunds', description: 'Propose a refund (a different person approves).' },
  { key: 'finance.refund.approve', group: 'Money', label: 'Approve refunds', description: 'Approve a refund proposed by someone else.' },
  { key: 'finance.payout.review', group: 'Money', label: 'Review payouts', description: 'Review driver payouts.' },
  { key: 'finance.payout.approve', group: 'Money', label: 'Approve payouts', description: 'Approve large payouts reviewed by someone else.' },
  { key: 'finance.reconcile', group: 'Money', label: 'Reconcile payments', description: 'Match provider payments against the ledger.' },
  { key: 'finance.waive_fee', group: 'Money', label: 'Waive fees', description: 'Waive a cancellation fee or outstanding debt.' },
  { key: 'wallet.view', group: 'Money', label: 'See customer credit', description: 'View customer credit and loyalty balances.' },
  { key: 'wallet.adjust', group: 'Money', label: 'Adjust customer credit', description: 'Propose a credit adjustment with a reason.' },
  { key: 'wallet.adjust.approve', group: 'Money', label: 'Approve credit adjustments', description: 'Second approval for large credit adjustments.' },
  { key: 'claims.settle.approve', group: 'Money', label: 'Approve claim settlements', description: 'Approve paying out a claim.' },

  { key: 'pricing.manage', group: 'Business', label: 'Propose prices', description: 'Propose fare and commission changes; switch services on or off.' },
  { key: 'pricing.approve', group: 'Business', label: 'Approve prices', description: 'Approve or reject a fare or commission change proposed by someone else.' },
  { key: 'promotions.manage', group: 'Business', label: 'Manage promotions', description: 'Create and edit promo codes.' },
  { key: 'corporate.manage', group: 'Business', label: 'Manage business accounts', description: 'Approve company accounts and issue invoices.' },
  { key: 'fleet.manage', group: 'Business', label: 'Manage fleets', description: 'Approve fleet owners.' },
  { key: 'codes.view', group: 'Business', label: 'See request codes', description: 'View venue request codes and their usage.' },
  { key: 'codes.manage', group: 'Business', label: 'Manage request codes', description: 'Create, deactivate and print request codes.' },
  { key: 'growth.manage', group: 'Business', label: 'Manage growth tools', description: 'Fixed-price routes, driver quests and campaigns.' },
  { key: 'partners.manage', group: 'Business', label: 'Manage venue partners', description: 'Create venue partners and invite their managers.' },

  { key: 'partner.portal', group: 'Partner', label: 'Venue partner portal', description: 'See only their own venue\'s codes, requests and statement.' },

  { key: 'users.manage', group: 'Administration', label: 'Manage staff', description: 'Invite, edit, disable, remove and recover staff accounts.' },
  { key: 'roles.manage', group: 'Administration', label: 'Manage roles', description: 'Create custom roles and change which permissions a role holds.' },
  { key: 'settings.manage', group: 'Administration', label: 'Settings and feature flags', description: 'Change system settings, feature flags and notification wording.' },
  { key: 'audit.view', group: 'Administration', label: 'Read the audit log', description: 'See who did what and when.' },
  { key: 'places.manage', group: 'Administration', label: 'Manage places', description: 'Add, edit, disable and import landmarks and pickup points.' },
  { key: 'zones.manage', group: 'Administration', label: 'Manage zones', description: 'Create, edit and disable service zones (coverage areas).' },
  { key: 'faq.manage', group: 'Administration', label: 'Edit the help centre', description: 'Edit the FAQ shown in the app (English, Kinyarwanda, French).' },
  { key: 'requirements.manage', group: 'Administration', label: 'Driver document rules', description: 'Choose which documents each vehicle type needs and which expire.' },
  { key: 'support.configure', group: 'Administration', label: 'Support categories and deadlines', description: 'Priority, response deadline (SLA) and sensitivity per support category.' },
];

export const PERMISSION_KEYS = new Set(PERMISSION_CATALOGUE.map((p) => p.key));
/** Permissions that only a super admin may grant to a custom role (they open the keys to staff, money rules or the role system itself). */
export const SUPER_ONLY_PERMISSIONS = new Set(['users.manage', 'roles.manage', 'settings.manage', 'audit.view', 'requirements.manage', 'support.configure']);

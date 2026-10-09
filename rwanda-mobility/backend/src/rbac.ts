export const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['*'],
  dispatcher: ['bookings.view_all', 'bookings.dispatch', 'drivers.view', 'analytics.view', 'safety.respond'],
  support_agent: ['bookings.view_all', 'support.handle', 'drivers.view', 'users.view', 'wallet.view', 'claims.view', 'claims.handle'],
  support_lead: ['bookings.view_all', 'faq.manage', 'support.handle', 'support.sensitive', 'safety.respond', 'alerts.view', 'drivers.view', 'users.view', 'users.restrict', 'privacy.handle', 'finance.refund.request', 'finance.waive_fee', 'diagnostics.view', 'codes.view', 'codes.manage', 'wallet.view', 'claims.view', 'claims.handle', 'claims.decide', 'ussd.view'],
  driver_verifier: ['drivers.review', 'drivers.view', 'drivers.docs'],
  finance_officer: ['finance.view', 'finance.refund.request', 'finance.payout.review', 'finance.reconcile', 'finance.waive_fee', 'analytics.view', 'drivers.view', 'wallet.view', 'wallet.adjust', 'claims.view'],
  finance_approver: ['finance.view', 'finance.refund.approve', 'finance.payout.approve', 'finance.payout.review', 'pricing.approve', 'analytics.view', 'wallet.view', 'wallet.adjust.approve', 'claims.view', 'claims.settle.approve'],
  business_manager: ['analytics.view', 'places.manage', 'zones.manage', 'pricing.manage', 'promotions.manage', 'corporate.manage', 'fleet.manage', 'drivers.view', 'bookings.view_all', 'codes.view', 'codes.manage', 'growth.manage', 'partners.manage', 'wallet.view', 'ussd.view'],
  analyst: ['analytics.view', 'diagnostics.view', 'codes.view', 'ussd.view'],
  partner_manager: ['partner.portal'],   // venue partner: sees ONLY their own partner's codes, requests and statement (row-level, see routes/partners.ts)
  passenger: [], driver: [], fleet_manager: [], corporate_admin: [], corporate_booker: [],
};
export const STAFF_ROLES = ['super_admin', 'dispatcher', 'support_agent', 'support_lead', 'driver_verifier', 'finance_officer', 'finance_approver', 'business_manager', 'analyst', 'partner_manager'];

/**
 * Data-driven permissions. services/rolesStore.ts loads roles + role_permissions from the database and installs a snapshot here (short cache,
 * explicit invalidation on every change). Until the first load, and for built-in roles nobody has customised, the static defaults above apply,
 * so a fresh install or an empty roles table behaves exactly as before.
 */
export type RbacSnapshot = { perms: Map<string, string[]>; staff: Set<string> };
let snapshot: RbacSnapshot | null = null;
export const setRbacSnapshot = (s: RbacSnapshot | null) => { snapshot = s; };
export const permsOfRole = (role: string): string[] => snapshot ? (snapshot.perms.get(role) ?? []) : (ROLE_PERMISSIONS[role] ?? []);
export const staffRoleNames = (): string[] => snapshot ? [...snapshot.staff] : STAFF_ROLES;

export function can(roles: string[], perm: string): boolean {
  return roles.some((r) => {
    const p = permsOfRole(r);
    return p.includes('*') || p.includes(perm);
  });
}
/** The union of what these roles allow, with '*' collapsing everything (what the console receives at sign-in). */
export function effectivePermissions(roles: string[]): string[] {
  const all = new Set(roles.flatMap((r) => permsOfRole(r)));
  return all.has('*') ? ['*'] : [...all].sort();
}
export const isStaff = (roles: string[]) => { const s = staffRoleNames(); return roles.some((r) => s.includes(r)); };

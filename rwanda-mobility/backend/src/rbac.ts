export const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['*'],
  dispatcher: ['bookings.view_all', 'bookings.dispatch', 'drivers.view', 'analytics.view', 'safety.respond'],
  support_agent: ['bookings.view_all', 'support.handle', 'drivers.view', 'users.view'],
  support_lead: ['bookings.view_all', 'support.handle', 'support.sensitive', 'safety.respond', 'drivers.view', 'users.view', 'users.restrict', 'privacy.handle', 'finance.refund.request', 'finance.waive_fee', 'diagnostics.view'],
  driver_verifier: ['drivers.review', 'drivers.view', 'drivers.docs'],
  finance_officer: ['finance.view', 'finance.refund.request', 'finance.payout.review', 'finance.reconcile', 'finance.waive_fee', 'analytics.view', 'drivers.view'],
  finance_approver: ['finance.view', 'finance.refund.approve', 'finance.payout.approve', 'finance.payout.review', 'pricing.approve', 'analytics.view'],
  business_manager: ['analytics.view', 'pricing.manage', 'promotions.manage', 'corporate.manage', 'fleet.manage', 'drivers.view', 'bookings.view_all'],
  analyst: ['analytics.view', 'diagnostics.view'],
  passenger: [], driver: [], fleet_manager: [], corporate_admin: [], corporate_booker: [],
};
export const STAFF_ROLES = ['super_admin', 'dispatcher', 'support_agent', 'support_lead', 'driver_verifier', 'finance_officer', 'finance_approver', 'business_manager', 'analyst'];

export function can(roles: string[], perm: string): boolean {
  return roles.some((r) => {
    const p = ROLE_PERMISSIONS[r] ?? [];
    return p.includes('*') || p.includes(perm);
  });
}
export const isStaff = (roles: string[]) => roles.some((r) => STAFF_ROLES.includes(r));

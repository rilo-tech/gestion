export const DEFAULT_BUSINESS_ID = 'rilo-default';

export const JWT_SECRET =
  process.env.JWT_SECRET ?? 'rilo-dev-jwt-secret-change-in-production';

export const ASSIGNABLE_PERMISSIONS = [
  'records.edit',
  'records.delete',
  'cash.access',
  'accounts.viewBalance',
  'economics.view',
  'reports.view',
  'orders.viewSalePrice',
  'orders.personalization',
  'orders.viewAll',
  'orders.viewDelivered',
  'orders.print',
  'sales.create',
  'sales.viewHistory',
  'sales.viewSummary',
  'purchases.access',
  'prices.view',
  'prices.manage',
  'payables.access',
] as const;

export type AssignablePermission = (typeof ASSIGNABLE_PERMISSIONS)[number];

export const DEFAULT_STAFF_PERMISSIONS: AssignablePermission[] = [
  'orders.personalization',
  'orders.viewSalePrice',
];

export type UserRole = 'supervisor' | 'admin' | 'staff';
export type ThemePreference = 'light' | 'dark';

export function isPrivilegedRole(rol: unknown): rol is 'supervisor' | 'admin' {
  return rol === 'supervisor' || rol === 'admin';
}

export function sanitizeStaffPermissions(
  permisos: unknown
): AssignablePermission[] {
  const allowed = new Set<string>(ASSIGNABLE_PERMISSIONS);
  const defaults = new Set<string>(DEFAULT_STAFF_PERMISSIONS);
  const selected = Array.isArray(permisos)
    ? permisos.filter(
        (permission): permission is AssignablePermission =>
          typeof permission === 'string' && allowed.has(permission)
      )
    : [];
  return [...new Set([...defaults, ...selected])];
}

export function userHasPermission(
  rol: UserRole,
  permisos: unknown,
  permission: AssignablePermission
): boolean {
  if (isPrivilegedRole(rol)) return true;
  return sanitizeStaffPermissions(permisos).includes(permission);
}

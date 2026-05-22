export const PERMISSIONS = {
  ORDERS_VIEW_ECONOMICS: 'orders.viewEconomics',
  ORDERS_VIEW_SALE_PRICE: 'orders.viewSalePrice',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type UserRole = 'admin' | 'staff';

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: [PERMISSIONS.ORDERS_VIEW_ECONOMICS, PERMISSIONS.ORDERS_VIEW_SALE_PRICE],
  staff: [PERMISSIONS.ORDERS_VIEW_SALE_PRICE],
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function getPermissionsForRole(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  staff: 'Usuario',
};

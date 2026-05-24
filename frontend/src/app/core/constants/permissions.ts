export const PERMISSIONS = {
  RECORDS_EDIT: 'records.edit',
  RECORDS_DELETE: 'records.delete',
  CASH_ACCESS: 'cash.access',
  ECONOMICS_VIEW: 'economics.view',
  REPORTS_VIEW: 'reports.view',
  ORDERS_VIEW_SALE_PRICE: 'orders.viewSalePrice',
  ORDERS_PERSONALIZATION: 'orders.personalization',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type UserRole = 'supervisor' | 'admin' | 'staff';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  supervisor: 'Administrador',
  admin: 'Administrador delegado',
  staff: 'Operador',
};

/** Permisos que tiene un usuario staff recién creado. */
export const DEFAULT_STAFF_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.ORDERS_PERSONALIZATION,
  PERMISSIONS.ORDERS_VIEW_SALE_PRICE,
];

export interface PermissionMeta {
  key: Permission;
  label: string;
  description?: string;
}

/** Permisos que el administrador de empresa puede activar o desactivar por operador. */
export const ADMIN_ASSIGNABLE_PERMISSIONS: readonly PermissionMeta[] = [
  {
    key: PERMISSIONS.RECORDS_EDIT,
    label: 'Editar registros',
    description: 'Modificar clientes, pedidos, ventas, productos, etc.',
  },
  {
    key: PERMISSIONS.RECORDS_DELETE,
    label: 'Eliminar registros',
    description: 'Eliminar clientes, pedidos, ventas, productos, etc.',
  },
  {
    key: PERMISSIONS.CASH_ACCESS,
    label: 'Ver y usar caja',
    description: 'Módulo de caja, cobros, pagos y movimientos manuales.',
  },
  {
    key: PERMISSIONS.ECONOMICS_VIEW,
    label: 'Ver costos y ganancias',
    description: 'Costos de stock, compras, ganancia estimada y KPIs económicos.',
  },
  {
    key: PERMISSIONS.REPORTS_VIEW,
    label: 'Ver reportes',
    description: 'Acceso al módulo de reportes.',
  },
  {
    key: PERMISSIONS.ORDERS_VIEW_SALE_PRICE,
    label: 'Precio de venta',
    description: 'Ver y cargar precios en pedidos y ventas.',
  },
  {
    key: PERMISSIONS.ORDERS_PERSONALIZATION,
    label: 'Costos de personalización',
    description: 'Ingresar costos extra de personalización en pedidos y ventas.',
  },
];

export const ROLE_PRESETS: Record<
  string,
  { label: string; permisos: Permission[] }
> = {
  caja: {
    label: 'Caja',
    permisos: [PERMISSIONS.CASH_ACCESS, PERMISSIONS.ORDERS_VIEW_SALE_PRICE],
  },
  ventas: {
    label: 'Ventas',
    permisos: [
      PERMISSIONS.RECORDS_EDIT,
      PERMISSIONS.ORDERS_VIEW_SALE_PRICE,
      PERMISSIONS.ORDERS_PERSONALIZATION,
    ],
  },
  stock: {
    label: 'Stock',
    permisos: [PERMISSIONS.RECORDS_EDIT, PERMISSIONS.ECONOMICS_VIEW],
  },
  produccion: {
    label: 'Producción',
    permisos: [PERMISSIONS.RECORDS_EDIT, PERMISSIONS.ORDERS_PERSONALIZATION],
  },
};

const ASSIGNABLE_SET = new Set<Permission>(ADMIN_ASSIGNABLE_PERMISSIONS.map((item) => item.key));

export function isPrivilegedRole(role: UserRole): boolean {
  return role === 'supervisor' || role === 'admin';
}

export function sanitizeStaffPermissions(permisos: readonly Permission[] | undefined): Permission[] {
  const defaults = new Set<Permission>(DEFAULT_STAFF_PERMISSIONS);
  const selected = (permisos ?? []).filter((permission) => ASSIGNABLE_SET.has(permission));
  return [...new Set([...defaults, ...selected])];
}

export function userHasPermission(
  role: UserRole,
  permisos: readonly Permission[] | undefined,
  permission: Permission
): boolean {
  if (isPrivilegedRole(role)) return true;
  return sanitizeStaffPermissions(permisos).includes(permission);
}

export function canManageUsers(role: UserRole): boolean {
  return role === 'supervisor';
}

export function canManageSettings(role: UserRole): boolean {
  return role === 'supervisor' || role === 'admin';
}

/** @deprecated Usar PERMISSIONS.ECONOMICS_VIEW en plantillas nuevas. */
export const STOCK_VIEW_COSTS = PERMISSIONS.ECONOMICS_VIEW;

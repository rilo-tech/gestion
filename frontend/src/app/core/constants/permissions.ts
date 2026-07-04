import { normalizeOrderStatus } from './order-status';

export const PERMISSIONS = {
  RECORDS_EDIT: 'records.edit',
  RECORDS_DELETE: 'records.delete',
  CASH_ACCESS: 'cash.access',
  ACCOUNT_BALANCE_VIEW: 'accounts.viewBalance',
  ECONOMICS_VIEW: 'economics.view',
  /** Alias de ECONOMICS_VIEW (costos de stock). */
  STOCK_VIEW_COSTS: 'economics.view',
  REPORTS_VIEW: 'reports.view',
  ORDERS_VIEW_SALE_PRICE: 'orders.viewSalePrice',
  ORDERS_PERSONALIZATION: 'orders.personalization',
  ORDERS_VIEW_ALL: 'orders.viewAll',
  ORDERS_VIEW_DELIVERED: 'orders.viewDelivered',
  ORDERS_CHANGE_STATUS: 'orders.changeStatus',
  ORDERS_PRINT: 'orders.print',
  STOCK_VIEW_PRICES: 'stock.viewPrices',
  SALES_CREATE: 'sales.create',
  SALES_VIEW_HISTORY: 'sales.viewHistory',
  SALES_VIEW_SUMMARY: 'sales.viewSummary',
  PURCHASES_ACCESS: 'purchases.access',
  PRICES_VIEW: 'prices.view',
  PRICES_MANAGE: 'prices.manage',
  PAYABLES_ACCESS: 'payables.access',
  COLLABORATORS_ACCESS: 'collaborators.access',
  SETTINGS_MANAGE: 'settings.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type UserRole = 'supervisor' | 'admin' | 'staff';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  supervisor: 'Administrador',
  admin: 'Administrador delegado',
  staff: 'Operador',
};

/** Permisos que tiene un usuario staff recién creado (sin asignar hasta que el admin elija). */
export const DEFAULT_STAFF_PERMISSIONS: readonly Permission[] = [];

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
    key: PERMISSIONS.PAYABLES_ACCESS,
    label: 'Ver cuentas a pagar',
    description: 'Acceso al módulo de vencimientos, pagos y obligaciones mensuales.',
  },
  {
    key: PERMISSIONS.COLLABORATORS_ACCESS,
    label: 'Ver colaboradores',
    description: 'Horarios, sueldos, extras y pagos del personal.',
  },
  {
    key: PERMISSIONS.ACCOUNT_BALANCE_VIEW,
    label: 'Ver saldos de cuenta corriente',
    description:
      'Saldo que deben los clientes, lo que debemos a proveedores y saldo pendiente de cada pedido.',
  },
  {
    key: PERMISSIONS.ECONOMICS_VIEW,
    label: 'Ver costos y ganancias',
    description: 'Costos de stock, ganancia estimada y montos de compras en el historial.',
  },
  {
    key: PERMISSIONS.PURCHASES_ACCESS,
    label: 'Ver y registrar compras',
    description: 'Acceso al módulo de compras para cargar mercadería al stock.',
  },
  {
    key: PERMISSIONS.SALES_CREATE,
    label: 'Registrar ventas',
    description: 'Cargar ventas de mostrador y registrar entregas de pedidos, sin ver todo el historial.',
  },
  {
    key: PERMISSIONS.SALES_VIEW_HISTORY,
    label: 'Ver historial de ventas',
    description: 'Listado completo de ventas, detalle y edición.',
  },
  {
    key: PERMISSIONS.SALES_VIEW_SUMMARY,
    label: 'Ver resumen de ventas',
    description: 'Tarjetas de ventas registradas, facturado, cobrado y saldo pendiente.',
  },
  {
    key: PERMISSIONS.REPORTS_VIEW,
    label: 'Ver reportes',
    description: 'Acceso al módulo de reportes.',
  },
  {
    key: PERMISSIONS.SETTINGS_MANAGE,
    label: 'Gestionar configuración',
    description:
      'Acceso a listas del negocio (etiquetas, tipos, conceptos de caja, etc.) y quitar opciones configuradas.',
  },
  {
    key: PERMISSIONS.ORDERS_VIEW_SALE_PRICE,
    label: 'Precio de venta',
    description:
      'Ver y cargar precios en pedidos y ventas, y ver pagos y saldo pendiente de cada pedido.',
  },
  {
    key: PERMISSIONS.ORDERS_VIEW_ALL,
    label: 'Ver todos los pedidos',
    description: 'Ver pedidos en cualquier estado activo (no solo en producción).',
  },
  {
    key: PERMISSIONS.ORDERS_VIEW_DELIVERED,
    label: 'Ver pedidos entregados',
    description: 'Acceder a pedidos ya entregados o entregados con saldo.',
  },
  {
    key: PERMISSIONS.ORDERS_CHANGE_STATUS,
    label: 'Cambiar estado del pedido',
    description:
      'Mover pedidos entre pendiente, en proceso, listo y entrega, sin editar productos ni montos.',
  },
  {
    key: PERMISSIONS.ORDERS_PERSONALIZATION,
    label: 'Costos de personalización',
    description: 'Ingresar costos extra de personalización en pedidos y ventas.',
  },
  {
    key: PERMISSIONS.ORDERS_PRINT,
    label: 'Imprimir pedidos',
    description: 'Imprimir fichas de pedido en formato A4 desde el listado o el detalle.',
  },
  {
    key: PERMISSIONS.PRICES_VIEW,
    label: 'Ver catálogo de precios',
    description: 'Consultar el catálogo de precios de venta y sugerencias en pedidos.',
  },
  {
    key: PERMISSIONS.PRICES_MANAGE,
    label: 'Gestionar catálogo de precios',
    description: 'Crear, editar y eliminar referencias del catálogo de precios de venta.',
  },
  {
    key: PERMISSIONS.STOCK_VIEW_PRICES,
    label: 'Ver precios en stock',
    description: 'Ver precio sugerido de venta en productos, sin costos de compra ni valor en depósito.',
  },
];

export interface StaffPermissionGroup {
  label: string;
  permissions: PermissionMeta[];
}

const PERMISSION_META_BY_KEY = new Map<Permission, PermissionMeta>(
  ADMIN_ASSIGNABLE_PERMISSIONS.map((item) => [item.key, item])
);

function permissionGroup(...keys: Permission[]): PermissionMeta[] {
  return keys
    .map((key) => PERMISSION_META_BY_KEY.get(key))
    .filter((item): item is PermissionMeta => !!item);
}

/** Permisos agrupados para el formulario de operadores. */
export const STAFF_PERMISSION_GROUPS: readonly StaffPermissionGroup[] = [
  {
    label: 'Caja y pagos',
    permissions: permissionGroup(
      PERMISSIONS.CASH_ACCESS,
      PERMISSIONS.PAYABLES_ACCESS,
      PERMISSIONS.COLLABORATORS_ACCESS,
      PERMISSIONS.ACCOUNT_BALANCE_VIEW
    ),
  },
  {
    label: 'Ventas',
    permissions: permissionGroup(
      PERMISSIONS.SALES_CREATE,
      PERMISSIONS.SALES_VIEW_HISTORY,
      PERMISSIONS.SALES_VIEW_SUMMARY
    ),
  },
  {
    label: 'Pedidos',
    permissions: permissionGroup(
      PERMISSIONS.ORDERS_VIEW_ALL,
      PERMISSIONS.ORDERS_VIEW_DELIVERED,
      PERMISSIONS.ORDERS_CHANGE_STATUS,
      PERMISSIONS.ORDERS_VIEW_SALE_PRICE,
      PERMISSIONS.ORDERS_PERSONALIZATION,
      PERMISSIONS.ORDERS_PRINT
    ),
  },
  {
    label: 'Stock',
    permissions: permissionGroup(PERMISSIONS.STOCK_VIEW_PRICES),
  },
  {
    label: 'Compras y costos',
    permissions: permissionGroup(
      PERMISSIONS.PURCHASES_ACCESS,
      PERMISSIONS.ECONOMICS_VIEW,
      PERMISSIONS.PRICES_VIEW,
      PERMISSIONS.PRICES_MANAGE
    ),
  },
  {
    label: 'General',
    permissions: permissionGroup(
      PERMISSIONS.RECORDS_EDIT,
      PERMISSIONS.RECORDS_DELETE,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.SETTINGS_MANAGE
    ),
  },
];

export const ROLE_PRESETS: Record<
  string,
  { label: string; permisos: Permission[] }
> = {
  caja: {
    label: 'Caja',
    permisos: [
      PERMISSIONS.CASH_ACCESS,
      PERMISSIONS.PAYABLES_ACCESS,
      PERMISSIONS.COLLABORATORS_ACCESS,
      PERMISSIONS.ACCOUNT_BALANCE_VIEW,
      PERMISSIONS.ORDERS_VIEW_ALL,
      PERMISSIONS.ORDERS_VIEW_DELIVERED,
      PERMISSIONS.ORDERS_VIEW_SALE_PRICE,
      PERMISSIONS.SALES_CREATE,
      PERMISSIONS.SALES_VIEW_HISTORY,
      PERMISSIONS.SALES_VIEW_SUMMARY,
    ],
  },
  ventas: {
    label: 'Ventas',
    permisos: [
      PERMISSIONS.RECORDS_EDIT,
      PERMISSIONS.ORDERS_VIEW_ALL,
      PERMISSIONS.ORDERS_VIEW_SALE_PRICE,
      PERMISSIONS.PRICES_VIEW,
      PERMISSIONS.ORDERS_PERSONALIZATION,
      PERMISSIONS.SALES_CREATE,
      PERMISSIONS.SALES_VIEW_HISTORY,
      PERMISSIONS.SALES_VIEW_SUMMARY,
    ],
  },
  stock: {
    label: 'Stock',
    permisos: [
      PERMISSIONS.RECORDS_EDIT,
      PERMISSIONS.PURCHASES_ACCESS,
      PERMISSIONS.ECONOMICS_VIEW,
    ],
  },
  produccion: {
    label: 'Producción',
    permisos: [
      PERMISSIONS.RECORDS_EDIT,
      PERMISSIONS.ORDERS_PERSONALIZATION,
      PERMISSIONS.ORDERS_PRINT,
    ],
  },
  operador: {
    label: 'Operador (pedidos)',
    permisos: [
      PERMISSIONS.ORDERS_VIEW_ALL,
      PERMISSIONS.ORDERS_CHANGE_STATUS,
      PERMISSIONS.ORDERS_VIEW_SALE_PRICE,
      PERMISSIONS.ACCOUNT_BALANCE_VIEW,
      PERMISSIONS.STOCK_VIEW_PRICES,
      PERMISSIONS.ORDERS_PRINT,
    ],
  },
  operador_horas: {
    label: 'Operador (mis horas)',
    permisos: [PERMISSIONS.COLLABORATORS_ACCESS],
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

export function canStaffViewOrder(
  role: UserRole,
  permisos: readonly Permission[] | undefined,
  estado?: string
): boolean {
  if (isPrivilegedRole(role)) return true;

  const perms = sanitizeStaffPermissions(permisos);
  const status = normalizeOrderStatus(estado);

  if (status === 'entregado' || status === 'entregado_con_saldo') {
    return perms.includes(PERMISSIONS.ORDERS_VIEW_DELIVERED);
  }

  if (status === 'cancelado') {
    return perms.includes(PERMISSIONS.ORDERS_VIEW_ALL);
  }

  if (perms.includes(PERMISSIONS.ORDERS_VIEW_ALL)) {
    return status !== 'otro';
  }

  return status === 'en_produccion';
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

export function canManageSettings(
  role: UserRole,
  permisos?: readonly Permission[]
): boolean {
  if (role === 'supervisor' || role === 'admin') return true;
  return userHasPermission(role, permisos, PERMISSIONS.SETTINGS_MANAGE);
}

/** @deprecated Usar PERMISSIONS.ECONOMICS_VIEW o PERMISSIONS.STOCK_VIEW_COSTS. */
export const STOCK_VIEW_COSTS = PERMISSIONS.STOCK_VIEW_COSTS;

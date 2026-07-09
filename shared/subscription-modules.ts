/** Módulos comercializables del ERP (plan plantilla + overrides por empresa). */
export const SUBSCRIPTION_MODULE_IDS = [
  'core',
  'pedidos',
  'caja',
  'payables',
  'collaborators',
  'price_catalog',
  'reports',
  'economics',
  'order_photos',
] as const;

export type SubscriptionModuleId = (typeof SUBSCRIPTION_MODULE_IDS)[number];

export type ModuleOverrideState = 'inherit' | 'on' | 'off';

export type SubscriptionModulesMap = Record<SubscriptionModuleId, boolean>;

export type ModuleOverridesMap = Partial<Record<SubscriptionModuleId, ModuleOverrideState>>;

export interface SubscriptionModuleMeta {
  id: SubscriptionModuleId;
  label: string;
  description: string;
  /** Precio addon sugerido en catálogo global (ARS/mes). */
  defaultAddonPrice: number;
  /** Si false, no se puede desactivar (core). */
  alwaysOn?: boolean;
  /** Si false, no se ofrece en panel de Plataforma todavía. */
  sellable?: boolean;
}

export const SUBSCRIPTION_MODULE_CATALOG: readonly SubscriptionModuleMeta[] = [
  {
    id: 'core',
    label: 'Operación base',
    description: 'Clientes, proveedores, stock, compras y ventas.',
    defaultAddonPrice: 0,
    alwaysOn: true,
  },
  {
    id: 'pedidos',
    label: 'Pedidos',
    description: 'Flujo de pedidos, estados, impresión y preparación.',
    defaultAddonPrice: 8000,
  },
  {
    id: 'caja',
    label: 'Caja',
    description: 'Movimientos de caja, cobros y medios de pago.',
    defaultAddonPrice: 6000,
  },
  {
    id: 'payables',
    label: 'Cuentas a pagar',
    description: 'Vencimientos, obligaciones y préstamos.',
    defaultAddonPrice: 5000,
  },
  {
    id: 'collaborators',
    label: 'Colaboradores',
    description: 'Horas, extras y pagos del personal.',
    defaultAddonPrice: 4000,
  },
  {
    id: 'price_catalog',
    label: 'Catálogo de precios',
    description: 'Lista de precios de venta y sugerencias.',
    defaultAddonPrice: 3000,
  },
  {
    id: 'reports',
    label: 'Reportes',
    description: 'Informes y resúmenes del negocio.',
    defaultAddonPrice: 4000,
  },
  {
    id: 'economics',
    label: 'Costos y márgenes',
    description: 'Costos de stock, ganancia estimada y valor en depósito.',
    defaultAddonPrice: 5000,
  },
  {
    id: 'order_photos',
    label: 'Fotos en pedidos',
    description: 'Adjuntar fotos de referencia en pedidos.',
    defaultAddonPrice: 2000,
    sellable: false,
  },
];

export const SELLABLE_SUBSCRIPTION_MODULE_CATALOG = SUBSCRIPTION_MODULE_CATALOG.filter(
  (module) => module.sellable !== false
);

/** Módulos que superadmin puede forzar on/off por empresa (incluye los no facturables como fotos). */
export const PLATFORM_OVERRIDE_MODULE_CATALOG = SUBSCRIPTION_MODULE_CATALOG.filter(
  (module) => module.id !== 'core'
);

export const DEFAULT_PLAN_MODULES: Record<string, SubscriptionModulesMap> = {
  plan_basico: {
    core: true,
    pedidos: true,
    caja: false,
    payables: false,
    collaborators: false,
    price_catalog: false,
    reports: false,
    economics: false,
    order_photos: true,
  },
  plan_intermedio: {
    core: true,
    pedidos: true,
    caja: true,
    payables: false,
    collaborators: false,
    price_catalog: false,
    reports: true,
    economics: false,
    order_photos: true,
  },
  plan_profesional: {
    core: true,
    pedidos: true,
    caja: true,
    payables: true,
    collaborators: true,
    price_catalog: true,
    reports: true,
    economics: true,
    order_photos: true,
  },
};

export function emptyModulesMap(enabled = false): SubscriptionModulesMap {
  return SUBSCRIPTION_MODULE_IDS.reduce(
    (acc, id) => {
      acc[id] = id === 'core' ? true : enabled;
      return acc;
    },
    {} as SubscriptionModulesMap
  );
}

export function normalizeModulesMap(
  raw: Partial<Record<string, boolean>> | undefined,
  planId?: string
): SubscriptionModulesMap {
  const defaults =
    (planId && DEFAULT_PLAN_MODULES[planId]) || emptyModulesMap(false);
  const next = { ...defaults };
  for (const id of SUBSCRIPTION_MODULE_IDS) {
    if (raw && typeof raw[id] === 'boolean') {
      next[id] = raw[id] === true;
    }
  }
  next.core = true;
  return next;
}

export function normalizeModuleOverrides(
  raw: ModuleOverridesMap | undefined
): ModuleOverridesMap {
  const next: ModuleOverridesMap = {};
  if (!raw) return next;
  for (const id of SUBSCRIPTION_MODULE_IDS) {
    const value = raw[id];
    if (value === 'on' || value === 'off' || value === 'inherit') {
      next[id] = value;
    }
  }
  return next;
}

export function resolveEffectiveModules(
  planModules: SubscriptionModulesMap,
  overrides?: ModuleOverridesMap
): SubscriptionModulesMap {
  const effective = { ...planModules };
  effective.core = true;
  for (const id of SUBSCRIPTION_MODULE_IDS) {
    if (id === 'core') continue;
    const override = overrides?.[id] ?? 'inherit';
    if (override === 'on') effective[id] = true;
    else if (override === 'off') effective[id] = false;
  }
  // Fotos en pedidos van incluidas con Pedidos (salvo override explícito off).
  if (effective.pedidos && overrides?.order_photos !== 'off') {
    effective.order_photos = true;
  }
  return effective;
}

export function isModuleBillableAddon(
  moduleId: SubscriptionModuleId,
  planModules: SubscriptionModulesMap,
  effective: SubscriptionModulesMap
): boolean {
  if (moduleId === 'core') return false;
  return effective[moduleId] === true && planModules[moduleId] !== true;
}

export interface MonthlyFeeLine {
  concepto: string;
  monto: number;
}

export interface MonthlyFeeBreakdown {
  lineas: MonthlyFeeLine[];
  subtotal: number;
  descuento: number;
  total: number;
}

export interface MonthlyFeeInput {
  precioBase: number;
  precioPorAdministrador: number;
  precioPorOperador: number;
  limiteAdministradores: number;
  limiteOperadores: number;
  planModules: SubscriptionModulesMap;
  effectiveModules: SubscriptionModulesMap;
  addonPrices: Partial<Record<SubscriptionModuleId, number>>;
  descuentoMensual?: number;
}

export function calculateMonthlyFee(input: MonthlyFeeInput): MonthlyFeeBreakdown {
  const lineas: MonthlyFeeLine[] = [];

  if (input.precioBase > 0) {
    lineas.push({ concepto: 'Cuota base del plan', monto: input.precioBase });
  }

  const adminsCharge = input.limiteAdministradores * input.precioPorAdministrador;
  if (adminsCharge > 0) {
    lineas.push({
      concepto: `${input.limiteAdministradores} admin × $${input.precioPorAdministrador}`,
      monto: adminsCharge,
    });
  }

  const opsCharge = input.limiteOperadores * input.precioPorOperador;
  if (opsCharge > 0) {
    lineas.push({
      concepto: `${input.limiteOperadores} operadores × $${input.precioPorOperador}`,
      monto: opsCharge,
    });
  }

  for (const meta of SUBSCRIPTION_MODULE_CATALOG) {
    if (!isModuleBillableAddon(meta.id, input.planModules, input.effectiveModules)) continue;
    const addon = Math.max(0, Number(input.addonPrices[meta.id]) || meta.defaultAddonPrice);
    if (addon <= 0) continue;
    lineas.push({ concepto: `Módulo: ${meta.label}`, monto: addon });
  }

  const subtotal = lineas.reduce((sum, line) => sum + line.monto, 0);
  const descuento = Math.max(0, Number(input.descuentoMensual) || 0);
  const total = Math.max(0, subtotal - descuento);

  return { lineas, subtotal, descuento, total };
}

/** Ruta Angular → módulo requerido (undefined = solo core). */
export const ROUTE_MODULE_MAP: Partial<Record<string, SubscriptionModuleId>> = {
  '/orders': 'pedidos',
  '/cash': 'caja',
  '/payables': 'payables',
  '/collaborators': 'collaborators',
  '/price-catalog': 'price_catalog',
  '/reports': 'reports',
};

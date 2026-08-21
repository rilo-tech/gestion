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
  /** Precio addon sugerido en catálogo global. */
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
    defaultAddonPrice: 0,
  },
  {
    id: 'caja',
    label: 'Caja',
    description: 'Movimientos de caja, cobros y medios de pago.',
    defaultAddonPrice: 0,
  },
  {
    id: 'payables',
    label: 'Cuentas a pagar',
    description: 'Vencimientos, obligaciones y préstamos.',
    defaultAddonPrice: 0,
  },
  {
    id: 'collaborators',
    label: 'Colaboradores',
    description: 'Horas, extras y pagos del personal.',
    defaultAddonPrice: 490,
  },
  {
    id: 'price_catalog',
    label: 'Catálogo de precios',
    description: 'Lista de precios de venta y sugerencias.',
    defaultAddonPrice: 0,
  },
  {
    id: 'reports',
    label: 'Reportes',
    description: 'Informes y resúmenes del negocio.',
    defaultAddonPrice: 490,
  },
  {
    id: 'economics',
    label: 'Costos y márgenes',
    description: 'Costos de stock, ganancia estimada y valor en depósito.',
    defaultAddonPrice: 0,
  },
  {
    id: 'order_photos',
    label: 'Fotos en pedidos',
    description: 'Adjuntar fotos de referencia en pedidos.',
    defaultAddonPrice: 0,
    sellable: false,
  },
];

export type ErpFeaturePackId = 'negocio' | 'equipo' | 'analisis';

export interface ErpFeaturePack {
  id: ErpFeaturePackId;
  label: string;
  description: string;
  modules: readonly SubscriptionModuleId[];
  /** Incluido en prueba y en todos los productos Panel/Completo por defecto. */
  includedByDefault: boolean;
  /** Cobro extra sugerido si se activa por encima del default. */
  suggestedAddonMonthly: number;
}

/**
 * Stock queda DENTRO del producto (core): sacarlo confunde al microcomercio.
 * Prueba = máximo valor operativo; Colaboradores y Reportes se suman después.
 */
export const ERP_FEATURE_PACKS: readonly ErpFeaturePack[] = [
  {
    id: 'negocio',
    label: 'Negocio (incluye stock)',
    description:
      'Clientes, stock, compras, ventas, pedidos, caja, cuentas a pagar, catálogo y márgenes.',
    modules: ['pedidos', 'caja', 'payables', 'price_catalog', 'economics', 'order_photos'],
    includedByDefault: true,
    suggestedAddonMonthly: 0,
  },
  {
    id: 'equipo',
    label: 'Equipo',
    description: 'Colaboradores: horas, extras y pagos del personal.',
    modules: ['collaborators'],
    includedByDefault: false,
    suggestedAddonMonthly: 490,
  },
  {
    id: 'analisis',
    label: 'Análisis',
    description: 'Reportes e informes del negocio.',
    modules: ['reports'],
    includedByDefault: false,
    suggestedAddonMonthly: 490,
  },
];

/** Módulos de prueba / default comercial: todo menos colaboradores y reportes. */
export const TRIAL_DEFAULT_MODULES: SubscriptionModulesMap = {
  core: true,
  pedidos: true,
  caja: true,
  payables: true,
  collaborators: false,
  price_catalog: true,
  reports: false,
  economics: true,
  order_photos: true,
};

/** 1 admin incluido en el precio base; el resto son extras cobrables. */
export const INCLUDED_ADMIN_SEATS = 1;

/** 1 WhatsApp incluido en RILO Bot / Completo; líneas adicionales se cobran aparte. */
export const INCLUDED_WHATSAPP_SEATS = 1;

export const SELLABLE_SUBSCRIPTION_MODULE_CATALOG = SUBSCRIPTION_MODULE_CATALOG.filter(
  (module) => module.sellable !== false
);

/** Módulos que superadmin puede forzar on/off por empresa (incluye los no facturables como fotos). */
export const PLATFORM_OVERRIDE_MODULE_CATALOG = SUBSCRIPTION_MODULE_CATALOG.filter(
  (module) => module.id !== 'core'
);

export const DEFAULT_PLAN_MODULES: Record<string, SubscriptionModulesMap> = {
  plan_basico: { ...TRIAL_DEFAULT_MODULES },
  plan_intermedio: { ...TRIAL_DEFAULT_MODULES },
  plan_profesional: { ...TRIAL_DEFAULT_MODULES },
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
    (planId && DEFAULT_PLAN_MODULES[planId]) || { ...TRIAL_DEFAULT_MODULES };
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

export function isFeaturePackEnabled(
  pack: ErpFeaturePack,
  effective: SubscriptionModulesMap
): boolean {
  return pack.modules.every((id) => effective[id] === true);
}

/** Aplica un pack on/off como overrides respecto a la plantilla del plan. */
export function applyFeaturePackOverride(
  pack: ErpFeaturePack,
  enabled: boolean,
  planModules: SubscriptionModulesMap,
  current: ModuleOverridesMap
): ModuleOverridesMap {
  const next = { ...current };
  for (const id of pack.modules) {
    const inPlan = planModules[id] === true;
    if (enabled === inPlan) {
      delete next[id];
    } else {
      next[id] = enabled ? 'on' : 'off';
    }
  }
  return next;
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
  /** Texto legible para UI / factura. */
  concepto: string;
  /** Código estable para facturación (ej. BASE, ADMIN_EXTRA, OP, WA_EXTRA, MOD:reports). */
  codigo?: string;
  cantidad?: number;
  precioUnitario?: number;
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
  /** Admins incluidos en el precio base (default 1). */
  includedAdministradores?: number;
  /** Líneas WhatsApp habilitadas (números autorizados). */
  whatsappLines?: number;
  /** WhatsApp incluidos en el precio base (default 1). */
  includedWhatsapp?: number;
  precioPorWhatsapp?: number;
  planModules: SubscriptionModulesMap;
  effectiveModules: SubscriptionModulesMap;
  addonPrices: Partial<Record<SubscriptionModuleId, number>>;
  descuentoMensual?: number;
}

export function calculateMonthlyFee(input: MonthlyFeeInput): MonthlyFeeBreakdown {
  const lineas: MonthlyFeeLine[] = [];

  if (input.precioBase > 0) {
    lineas.push({
      codigo: 'BASE',
      concepto: 'Cuota base (1 usuario incluido)',
      cantidad: 1,
      precioUnitario: input.precioBase,
      monto: input.precioBase,
    });
  }

  const includedAdmins = Math.max(0, input.includedAdministradores ?? INCLUDED_ADMIN_SEATS);
  const extraAdmins = Math.max(0, input.limiteAdministradores - includedAdmins);
  const adminsCharge = extraAdmins * input.precioPorAdministrador;
  if (adminsCharge > 0) {
    lineas.push({
      codigo: 'ADMIN_EXTRA',
      concepto: `Administrador extra`,
      cantidad: extraAdmins,
      precioUnitario: input.precioPorAdministrador,
      monto: adminsCharge,
    });
  }

  const opsCharge = input.limiteOperadores * input.precioPorOperador;
  if (opsCharge > 0) {
    lineas.push({
      codigo: 'OPERADOR',
      concepto: `Operador`,
      cantidad: input.limiteOperadores,
      precioUnitario: input.precioPorOperador,
      monto: opsCharge,
    });
  }

  const whatsappLines = Math.max(0, Number(input.whatsappLines) || 0);
  const includedWa = Math.max(0, input.includedWhatsapp ?? INCLUDED_WHATSAPP_SEATS);
  const precioWa = Math.max(0, Number(input.precioPorWhatsapp) || 0);
  const extraWa = Math.max(0, whatsappLines - includedWa);
  const waCharge = extraWa * precioWa;
  if (waCharge > 0) {
    lineas.push({
      codigo: 'WA_EXTRA',
      concepto: `WhatsApp extra`,
      cantidad: extraWa,
      precioUnitario: precioWa,
      monto: waCharge,
    });
  }

  for (const meta of SUBSCRIPTION_MODULE_CATALOG) {
    if (!isModuleBillableAddon(meta.id, input.planModules, input.effectiveModules)) continue;
    const addon = Math.max(0, Number(input.addonPrices[meta.id]) || meta.defaultAddonPrice);
    if (addon <= 0) continue;
    lineas.push({
      codigo: `MOD:${meta.id}`,
      concepto: `Módulo: ${meta.label}`,
      cantidad: 1,
      precioUnitario: addon,
      monto: addon,
    });
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

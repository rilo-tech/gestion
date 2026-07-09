import type { PlanRecord } from './plans.ts';
import {
  calculateMonthlyFee,
  emptyModulesMap,
  normalizeModuleOverrides,
  normalizeModulesMap,
  resolveEffectiveModules,
  SUBSCRIPTION_MODULE_CATALOG,
  type ModuleOverridesMap,
  type MonthlyFeeBreakdown,
  type SubscriptionModuleId,
  type SubscriptionModulesMap,
} from '../../shared/subscription-modules.ts';
import type { FrozenPlanSnapshot } from './plan-snapshot.ts';

export type BusinessSubscriptionRecord = {
  limiteAdministradores?: number | null;
  limiteOperadores?: number | null;
  limiteUsuariosTotal?: number | null;
  maxAmbitosCaja?: number | null;
  modulosOverride?: ModuleOverridesMap;
  precioBaseOverride?: number | null;
  precioPorAdministradorOverride?: number | null;
  precioPorOperadorOverride?: number | null;
  preciosAddonModuloOverride?: Partial<Record<SubscriptionModuleId, number>>;
  descuentoMensual?: number;
  notasComerciales?: string;
  /** Congela plantilla del plan para esta empresa (cambios al plan no aplican). */
  planFrozen?: FrozenPlanSnapshot;
};

export type EffectiveSubscriptionLimits = {
  limiteAdministradores: number;
  limiteOperadores: number;
  limiteUsuariosTotal: number;
  maxAmbitosCaja: number;
};

export type ResolvedBusinessSubscription = {
  planModules: SubscriptionModulesMap;
  moduleOverrides: ModuleOverridesMap;
  entitlements: SubscriptionModulesMap;
  limits: EffectiveSubscriptionLimits;
  precioBase: number;
  precioPorAdministrador: number;
  precioPorOperador: number;
  addonPrices: Partial<Record<SubscriptionModuleId, number>>;
  descuentoMensual: number;
  cuota: MonthlyFeeBreakdown;
  montoMensualEsperado: number;
  suscripcion: BusinessSubscriptionRecord;
};

function numOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function optionalNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseBusinessSubscription(
  data: Record<string, unknown> | undefined
): BusinessSubscriptionRecord {
  const raw = (data?.suscripcion as Record<string, unknown>) ?? data ?? {};
  return {
    limiteAdministradores: optionalNum(raw.limiteAdministradores),
    limiteOperadores: optionalNum(raw.limiteOperadores),
    limiteUsuariosTotal: optionalNum(raw.limiteUsuariosTotal),
    maxAmbitosCaja: optionalNum(raw.maxAmbitosCaja),
    modulosOverride: normalizeModuleOverrides(
      raw.modulosOverride as ModuleOverridesMap | undefined
    ),
    precioBaseOverride: optionalNum(raw.precioBaseOverride),
    precioPorAdministradorOverride: optionalNum(raw.precioPorAdministradorOverride),
    precioPorOperadorOverride: optionalNum(raw.precioPorOperadorOverride),
    preciosAddonModuloOverride:
      (raw.preciosAddonModuloOverride as Partial<Record<SubscriptionModuleId, number>>) ??
      undefined,
    descuentoMensual: numOr(raw.descuentoMensual, 0),
    notasComerciales:
      typeof raw.notasComerciales === 'string' ? raw.notasComerciales.trim() : undefined,
  };
}

export function resolveAddonPrices(
  plan: PlanRecord,
  suscripcion: BusinessSubscriptionRecord
): Partial<Record<SubscriptionModuleId, number>> {
  const prices: Partial<Record<SubscriptionModuleId, number>> = {
    ...plan.preciosAddonModulo,
  };
  for (const meta of SUBSCRIPTION_MODULE_CATALOG) {
    if (prices[meta.id] === undefined) {
      prices[meta.id] = meta.defaultAddonPrice;
    }
  }
  if (suscripcion.preciosAddonModuloOverride) {
    for (const [key, value] of Object.entries(suscripcion.preciosAddonModuloOverride)) {
      const moduleId = key as SubscriptionModuleId;
      if (typeof value === 'number' && value >= 0) {
        prices[moduleId] = value;
      }
    }
  }
  return prices;
}

export function resolveBusinessSubscription(
  plan: PlanRecord,
  suscripcion: BusinessSubscriptionRecord
): ResolvedBusinessSubscription {
  const frozen = suscripcion.planFrozen;
  const planModules = normalizeModulesMap(
    frozen?.modulosIncluidos ?? plan.modulosIncluidos,
    plan.id
  );
  const moduleOverrides = normalizeModuleOverrides(suscripcion.modulosOverride);
  const entitlements = resolveEffectiveModules(planModules, moduleOverrides);

  const limits: EffectiveSubscriptionLimits = {
    limiteAdministradores:
      suscripcion.limiteAdministradores ??
      frozen?.limiteAdministradores ??
      plan.limiteAdministradores,
    limiteOperadores:
      suscripcion.limiteOperadores ?? frozen?.limiteOperadores ?? plan.limiteOperadores,
    limiteUsuariosTotal:
      suscripcion.limiteUsuariosTotal ??
      frozen?.limiteUsuariosTotal ??
      plan.limiteUsuariosTotal,
    maxAmbitosCaja:
      suscripcion.maxAmbitosCaja ?? frozen?.maxAmbitosCaja ?? plan.maxAmbitosCaja,
  };

  const precioBase =
    suscripcion.precioBaseOverride ?? frozen?.precioBaseMensual ?? plan.precioBaseMensual;
  const precioPorAdministrador =
    suscripcion.precioPorAdministradorOverride ??
    frozen?.precioPorAdministrador ??
    plan.precioPorAdministrador;
  const precioPorOperador =
    suscripcion.precioPorOperadorOverride ??
    frozen?.precioPorOperador ??
    plan.precioPorOperador;
  const addonPrices = resolveAddonPrices(
    {
      ...plan,
      preciosAddonModulo: frozen?.preciosAddonModulo ?? plan.preciosAddonModulo,
    },
    suscripcion
  );
  const descuentoMensual = Math.max(0, Number(suscripcion.descuentoMensual) || 0);

  const cuota = calculateMonthlyFee({
    precioBase,
    precioPorAdministrador,
    precioPorOperador,
    limiteAdministradores: limits.limiteAdministradores,
    limiteOperadores: limits.limiteOperadores,
    planModules,
    effectiveModules: entitlements,
    addonPrices,
    descuentoMensual,
  });

  return {
    planModules,
    moduleOverrides,
    entitlements,
    limits,
    precioBase,
    precioPorAdministrador,
    precioPorOperador,
    addonPrices,
    descuentoMensual,
    cuota,
    montoMensualEsperado: cuota.total,
    suscripcion,
  };
}

export function sanitizeBusinessSubscriptionPayload(
  payload: Record<string, unknown>
): BusinessSubscriptionRecord | null {
  if (payload.suscripcion === undefined && payload.modulosOverride === undefined) {
    return null;
  }

  const raw =
    payload.suscripcion !== undefined && typeof payload.suscripcion === 'object'
      ? (payload.suscripcion as Record<string, unknown>)
      : payload;

  const next: BusinessSubscriptionRecord = {};

  if (raw.limiteAdministradores !== undefined) {
    next.limiteAdministradores = optionalNum(raw.limiteAdministradores);
  }
  if (raw.limiteOperadores !== undefined) {
    next.limiteOperadores = optionalNum(raw.limiteOperadores);
  }
  if (raw.limiteUsuariosTotal !== undefined) {
    next.limiteUsuariosTotal = optionalNum(raw.limiteUsuariosTotal);
  }
  if (raw.maxAmbitosCaja !== undefined) {
    next.maxAmbitosCaja = optionalNum(raw.maxAmbitosCaja);
  }
  if (raw.modulosOverride !== undefined) {
    next.modulosOverride = normalizeModuleOverrides(
      raw.modulosOverride as ModuleOverridesMap
    );
  }
  if (raw.precioBaseOverride !== undefined) {
    next.precioBaseOverride = optionalNum(raw.precioBaseOverride);
  }
  if (raw.precioPorAdministradorOverride !== undefined) {
    next.precioPorAdministradorOverride = optionalNum(raw.precioPorAdministradorOverride);
  }
  if (raw.precioPorOperadorOverride !== undefined) {
    next.precioPorOperadorOverride = optionalNum(raw.precioPorOperadorOverride);
  }
  if (raw.preciosAddonModuloOverride !== undefined) {
    next.preciosAddonModuloOverride =
      raw.preciosAddonModuloOverride as Partial<Record<SubscriptionModuleId, number>>;
  }
  if (raw.descuentoMensual !== undefined) {
    next.descuentoMensual = numOr(raw.descuentoMensual, 0);
  }
  if (typeof raw.notasComerciales === 'string') {
    next.notasComerciales = raw.notasComerciales.trim();
  }

  return next;
}

export function businessHasModule(
  resolved: ResolvedBusinessSubscription,
  moduleId: SubscriptionModuleId
): boolean {
  if (moduleId === 'core') return true;
  if (moduleId === 'order_photos') {
    if (resolved.entitlements.order_photos === true) return true;
    if (resolved.moduleOverrides?.order_photos === 'off') return false;
    return resolved.entitlements.pedidos === true;
  }
  return resolved.entitlements[moduleId] === true;
}

export function defaultPlanModulesForId(planId: string): SubscriptionModulesMap {
  return normalizeModulesMap(undefined, planId);
}

export { emptyModulesMap };

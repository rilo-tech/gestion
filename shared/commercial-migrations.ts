import {
  clampCommercialCatalog,
  DEFAULT_COMMERCIAL_CATALOG,
  type CommercialCatalog,
} from './commercial-catalog.ts';

const LEGACY_BOT_ACTIONS = 1000;
const LEGACY_COMPLETO_ACTIONS = 2000;

export function needsIncludedAi200Migration(catalog: CommercialCatalog): boolean {
  if (catalog.migrations?.includedAi200AppliedAt) return false;
  return (
    catalog.products.whatsapp.includedAi === LEGACY_BOT_ACTIONS ||
    catalog.products.completo.includedAi === LEGACY_COMPLETO_ACTIONS
  );
}

/**
 * Una sola vez: 1000/2000 acciones → 200 en Bot/Completo.
 * Después Superadmin es la fuente. No toca precios.
 */
export function applyIncludedAi200Migration(
  catalog: CommercialCatalog,
  at = new Date()
): { catalog: CommercialCatalog; changed: boolean } {
  if (!needsIncludedAi200Migration(catalog)) {
    return { catalog, changed: false };
  }
  const botOld = catalog.products.whatsapp.includedAi === LEGACY_BOT_ACTIONS;
  const fullOld = catalog.products.completo.includedAi === LEGACY_COMPLETO_ACTIONS;
  const next = clampCommercialCatalog({
    ...catalog,
    products: {
      ...catalog.products,
      whatsapp: botOld
        ? {
            ...catalog.products.whatsapp,
            includedAi: DEFAULT_COMMERCIAL_CATALOG.products.whatsapp.includedAi,
          }
        : catalog.products.whatsapp,
      completo: fullOld
        ? {
            ...catalog.products.completo,
            includedAi: DEFAULT_COMMERCIAL_CATALOG.products.completo.includedAi,
          }
        : catalog.products.completo,
    },
    migrations: {
      ...catalog.migrations,
      includedAi200AppliedAt: at.toISOString(),
    },
  });
  return { catalog: next, changed: true };
}

export function needsCashProductSeed(catalog: CommercialCatalog): boolean {
  if (catalog.migrations?.cashProductSeedAppliedAt) return false;
  // One-shot: catálogos publicados antes de RILO Caja deben persistir el 4º producto.
  // clampCommercialCatalog ya mergea defaults en memoria; esta bandera evita reescrituras.
  return true;
}

/**
 * One-shot: agrega producto RILO Caja al catálogo publicado si falta.
 * No modifica precios de productos existentes.
 */
export function applyCashProductSeed(
  catalog: CommercialCatalog,
  at = new Date()
): { catalog: CommercialCatalog; changed: boolean } {
  if (!needsCashProductSeed(catalog)) {
    return { catalog, changed: false };
  }
  const next = clampCommercialCatalog({
    ...catalog,
    products: {
      ...catalog.products,
      cash: DEFAULT_COMMERCIAL_CATALOG.products.cash,
    },
    migrations: {
      ...catalog.migrations,
      cashProductSeedAppliedAt: at.toISOString(),
    },
  });
  return { catalog: next, changed: true };
}

/** Precios viejos 1490/2490/3490. NO aplicar en lecturas. Solo script explícito. */
export function isLegacyListPriceCatalog(catalog: CommercialCatalog): boolean {
  return (
    catalog.products.whatsapp.amountMonthlyUY === 1490 &&
    catalog.products.erp.amountMonthlyUY === 2490 &&
    catalog.products.completo.amountMonthlyUY === 3490
  );
}

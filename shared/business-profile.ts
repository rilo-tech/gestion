/**
 * Perfil operativo del negocio (cómo trabaja), separado del producto contratado.
 * Empresas sin perfil persistido usan legacyFullProfile().
 */

export type BusinessMode = 'products' | 'services' | 'mixed' | 'cash_only';

export const BUSINESS_FEATURE_IDS = [
  'cash',
  'clients',
  'catalog',
  'products',
  'services',
  'stock',
  'orders',
  'sales',
  'purchases',
  'suppliers',
  'payables',
  'collaborators',
] as const;

export type BusinessFeatureId = (typeof BUSINESS_FEATURE_IDS)[number];

export type BusinessEnabledFeatures = Record<BusinessFeatureId, boolean>;

export interface BusinessProfileTerminology {
  catalogSingular?: string;
  catalogPlural?: string;
  orderSingular?: string;
  orderPlural?: string;
}

export interface BusinessProfileOnboarding {
  completed: boolean;
  step: string;
  completedAt?: string | null;
}

/** Defaults operativos configurables una vez (ERP + Bot comparten fuente). */
export interface BusinessProfileDefaults {
  currency?: string;
  defaultCashAccountId?: string;
  defaultPaymentMethod?: string;
  sales?: {
    defaultPaymentMethod?: string;
  };
  purchases?: {
    defaultPaymentMethod?: string;
    defaultTaxMode?: 'net' | 'gross';
    costPolicy?: 'never_update_catalog' | 'initialize_if_missing' | 'update_on_purchase';
  };
  stock?: {
    enabled?: boolean;
  };
}

export interface BusinessProfile {
  version: 1;
  mode: BusinessMode;
  enabledFeatures: BusinessEnabledFeatures;
  terminology?: BusinessProfileTerminology;
  defaults?: BusinessProfileDefaults;
  onboarding: BusinessProfileOnboarding;
}

export function emptyEnabledFeatures(enabled = false): BusinessEnabledFeatures {
  return BUSINESS_FEATURE_IDS.reduce(
    (acc, id) => {
      acc[id] = enabled;
      return acc;
    },
    {} as BusinessEnabledFeatures
  );
}

/** Perfil completo para empresas legacy (RILO y similares sin BusinessProfile). */
export function legacyFullProfile(): BusinessProfile {
  return {
    version: 1,
    mode: 'mixed',
    enabledFeatures: emptyEnabledFeatures(true),
    onboarding: {
      completed: true,
      step: 'legacy',
      completedAt: null,
    },
  };
}

export function defaultFeaturesForMode(mode: BusinessMode): BusinessEnabledFeatures {
  const allOff = emptyEnabledFeatures(false);
  switch (mode) {
    case 'cash_only':
      return { ...allOff, cash: true };
    case 'services':
      return {
        ...allOff,
        cash: true,
        clients: true,
        catalog: true,
        services: true,
        sales: true,
      };
    case 'products':
      return {
        ...allOff,
        cash: true,
        clients: true,
        catalog: true,
        products: true,
        stock: true,
        orders: true,
        sales: true,
        purchases: true,
        suppliers: true,
      };
    case 'mixed':
    default:
      return {
        ...allOff,
        cash: true,
        clients: true,
        catalog: true,
        products: true,
        services: true,
        stock: true,
        orders: true,
        sales: true,
        purchases: true,
        suppliers: true,
      };
  }
}

export function defaultProfileForMode(mode: BusinessMode): BusinessProfile {
  return {
    version: 1,
    mode,
    enabledFeatures: defaultFeaturesForMode(mode),
    onboarding: {
      completed: false,
      step: 'mode',
      completedAt: null,
    },
  };
}

/** Perfil inicial al alta según producto comercial contratado. */
export function initialProfileForTrialProduct(
  product: import('./platform-access.ts').TrialProductId
): BusinessProfile {
  switch (product) {
    case 'cash':
      return defaultProfileForMode('cash_only');
    case 'erp':
      return defaultProfileForMode('products');
    case 'whatsapp':
      // Perfil mixed genérico hasta onboarding (no asumir "services").
      return {
        ...defaultProfileForMode('mixed'),
        onboarding: {
          completed: false,
          step: 'sells',
          completedAt: null,
        },
      };
    case 'completo':
    default:
      return defaultProfileForMode('mixed');
  }
}

export function hasStoredBusinessProfile(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const row = raw as Partial<BusinessProfile>;
  return row.version === 1 && typeof row.mode === 'string';
}

function normalizeEnabledFeatures(raw: unknown): BusinessEnabledFeatures {
  const base = emptyEnabledFeatures(false);
  if (!raw || typeof raw !== 'object') return base;
  const map = raw as Partial<Record<string, unknown>>;
  for (const id of BUSINESS_FEATURE_IDS) {
    if (typeof map[id] === 'boolean') {
      base[id] = map[id] === true;
    }
  }
  return base;
}

function normalizeDefaults(raw: unknown): BusinessProfileDefaults | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const defaults: BusinessProfileDefaults = {};
  if (typeof row.currency === 'string' && row.currency.trim()) {
    defaults.currency = row.currency.trim();
  }
  if (typeof row.defaultCashAccountId === 'string' && row.defaultCashAccountId.trim()) {
    defaults.defaultCashAccountId = row.defaultCashAccountId.trim().toLowerCase();
  }
  if (typeof row.defaultPaymentMethod === 'string' && row.defaultPaymentMethod.trim()) {
    defaults.defaultPaymentMethod = row.defaultPaymentMethod.trim().toLowerCase();
  }
  const sales = row.sales;
  if (sales && typeof sales === 'object') {
    const s = sales as Record<string, unknown>;
    defaults.sales = {};
    if (typeof s.defaultPaymentMethod === 'string' && s.defaultPaymentMethod.trim()) {
      defaults.sales.defaultPaymentMethod = s.defaultPaymentMethod.trim().toLowerCase();
    }
  }
  const purchases = row.purchases;
  if (purchases && typeof purchases === 'object') {
    const p = purchases as Record<string, unknown>;
    defaults.purchases = {};
    if (typeof p.defaultPaymentMethod === 'string' && p.defaultPaymentMethod.trim()) {
      defaults.purchases.defaultPaymentMethod = p.defaultPaymentMethod.trim().toLowerCase();
    }
    if (p.defaultTaxMode === 'net' || p.defaultTaxMode === 'gross') {
      defaults.purchases.defaultTaxMode = p.defaultTaxMode;
    }
    if (
      p.costPolicy === 'never_update_catalog' ||
      p.costPolicy === 'initialize_if_missing' ||
      p.costPolicy === 'update_on_purchase'
    ) {
      defaults.purchases.costPolicy = p.costPolicy;
    }
  }
  const stock = row.stock;
  if (stock && typeof stock === 'object' && typeof (stock as { enabled?: unknown }).enabled === 'boolean') {
    defaults.stock = { enabled: (stock as { enabled: boolean }).enabled };
  }
  return Object.keys(defaults).length ? defaults : undefined;
}

export function normalizeBusinessProfile(raw: Partial<BusinessProfile>): BusinessProfile {
  const mode: BusinessMode =
    raw.mode === 'products' ||
    raw.mode === 'services' ||
    raw.mode === 'mixed' ||
    raw.mode === 'cash_only'
      ? raw.mode
      : 'mixed';
  const defaults = defaultFeaturesForMode(mode);
  const enabled = normalizeEnabledFeatures(raw.enabledFeatures);
  const merged: BusinessEnabledFeatures = { ...defaults };
  for (const id of BUSINESS_FEATURE_IDS) {
    if (raw.enabledFeatures && typeof raw.enabledFeatures[id] === 'boolean') {
      merged[id] = enabled[id];
    }
  }
  return {
    version: 1,
    mode,
    enabledFeatures: merged,
    defaults: normalizeDefaults(raw.defaults),
    terminology:
      raw.terminology && typeof raw.terminology === 'object'
        ? {
            catalogSingular:
              typeof raw.terminology.catalogSingular === 'string'
                ? raw.terminology.catalogSingular.trim()
                : undefined,
            catalogPlural:
              typeof raw.terminology.catalogPlural === 'string'
                ? raw.terminology.catalogPlural.trim()
                : undefined,
            orderSingular:
              typeof raw.terminology.orderSingular === 'string'
                ? raw.terminology.orderSingular.trim()
                : undefined,
            orderPlural:
              typeof raw.terminology.orderPlural === 'string'
                ? raw.terminology.orderPlural.trim()
                : undefined,
          }
        : undefined,
    onboarding: {
      completed: raw.onboarding?.completed === true,
      step:
        typeof raw.onboarding?.step === 'string' && raw.onboarding.step.trim()
          ? raw.onboarding.step.trim()
          : 'welcome',
      completedAt:
        typeof raw.onboarding?.completedAt === 'string'
          ? raw.onboarding.completedAt
          : raw.onboarding?.completedAt === null
            ? null
            : undefined,
    },
  };
}

/** Resuelve perfil persistido o legacyFullProfile si no hay uno válido. */
export function resolveBusinessProfile(raw?: Partial<BusinessProfile> | null): BusinessProfile {
  if (hasStoredBusinessProfile(raw)) {
    return normalizeBusinessProfile(raw as Partial<BusinessProfile>);
  }
  return legacyFullProfile();
}

export function isBusinessFeatureEnabled(
  profile: BusinessProfile,
  feature: BusinessFeatureId
): boolean {
  return profile.enabledFeatures[feature] === true;
}

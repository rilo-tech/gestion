import type { TrialProductId } from './platform-access.ts';
import { TRIAL_PRODUCT_DESCRIPTIONS, TRIAL_PRODUCT_LABELS } from './platform-access.ts';
import {
  DEFAULT_COMMERCIAL_CATALOG,
  amountMonthlyFor,
  erpPlanPricesFromCatalog,
  extraErpUserPriceFor,
  formatCatalogPriceLabel,
} from './commercial-catalog.ts';

export type BillingCountryCode = 'UY' | 'AR';
export type BillingCurrency = 'UYU' | 'ARS';
export type BillingInterval = 'month' | 'year';

/** Selector ARS en landing/planes. Oculto hasta tener cobro en Argentina. */
export const SHOW_ARGENTINA_BILLING = false;

/** Pago anual = 10 cuotas mensuales (2 meses de bonificación). */
export const YEARLY_MONTHS_CHARGED = 10;
export const YEARLY_COVERAGE_MONTHS = 12;

export interface BillingProductPrice {
  country: BillingCountryCode;
  currency: BillingCurrency;
  amountMonthly: number;
  label: string;
  /** Precio mensual por usuario extra del ERP (además del incluido en el plan). */
  extraUserMonthly: number;
}

export function yearlyAmountFromMonthly(amountMonthly: number): number {
  return Math.round(Math.max(0, amountMonthly) * YEARLY_MONTHS_CHARGED);
}

export function formatMoneyLabel(currency: BillingCurrency, amount: number, suffix: string): string {
  const formatted = amount.toLocaleString('es-UY');
  return `${currency} ${formatted} ${suffix}`;
}

export interface BillingProductMeta {
  id: TrialProductId;
  name: string;
  description: string;
  /** Plan ERP interno al convertir. */
  erpPlanId: string;
  featured?: boolean;
}

export interface BillingProduct extends BillingProductMeta {
  prices: BillingProductPrice[];
}

/** Precio sugerido por usuario extra ERP (UY / AR) cuando el plan no define override. */
export const DEFAULT_EXTRA_USER_MONTHLY: Record<BillingCountryCode, number> = {
  UY: 190,
  AR: 4900,
};

/**
 * Metadatos de producto (sin montos).
 * Los precios salen siempre de DEFAULT_COMMERCIAL_CATALOG / Firestore vía commercial-catalog.
 */
export const BILLING_PRODUCT_META: BillingProductMeta[] = [
  {
    id: 'cash',
    name: TRIAL_PRODUCT_LABELS.cash,
    description: TRIAL_PRODUCT_DESCRIPTIONS.cash,
    erpPlanId: 'plan_caja',
  },
  {
    id: 'whatsapp',
    name: TRIAL_PRODUCT_LABELS.whatsapp,
    description: TRIAL_PRODUCT_DESCRIPTIONS.whatsapp,
    erpPlanId: 'plan_basico',
  },
  {
    id: 'erp',
    name: TRIAL_PRODUCT_LABELS.erp,
    description: TRIAL_PRODUCT_DESCRIPTIONS.erp,
    erpPlanId: 'plan_intermedio',
  },
  {
    id: 'completo',
    name: TRIAL_PRODUCT_LABELS.completo,
    description: TRIAL_PRODUCT_DESCRIPTIONS.completo,
    erpPlanId: 'plan_profesional',
    featured: true,
  },
];

/** Mapeo plantilla ERP ← producto landing. */
export const ERP_PLAN_BILLING_DEFAULTS: Record<
  string,
  { productId: TrialProductId; nombre: string }
> = {
  plan_caja: { productId: 'cash', nombre: TRIAL_PRODUCT_LABELS.cash },
  plan_basico: { productId: 'whatsapp', nombre: TRIAL_PRODUCT_LABELS.whatsapp },
  plan_intermedio: { productId: 'erp', nombre: TRIAL_PRODUCT_LABELS.erp },
  plan_profesional: { productId: 'completo', nombre: TRIAL_PRODUCT_LABELS.completo },
};

export function resolveBillingCountry(pais: string | null | undefined): BillingCountryCode {
  if (!SHOW_ARGENTINA_BILLING) return 'UY';

  const raw = String(pais ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (!raw) return 'UY';
  if (raw === 'ar' || raw === 'arg' || raw.includes('argentina') || raw === '54') {
    return 'AR';
  }
  return 'UY';
}

export function resolveCheckoutAmount(
  amountMonthly: number,
  interval: BillingInterval
): { amount: number; coverageMonths: number; titleSuffix: string } {
  if (interval === 'year') {
    return {
      amount: yearlyAmountFromMonthly(amountMonthly),
      coverageMonths: YEARLY_COVERAGE_MONTHS,
      titleSuffix: '12 meses',
    };
  }
  return { amount: amountMonthly, coverageMonths: 1, titleSuffix: '1 mes' };
}

function currencyFor(country: BillingCountryCode): BillingCurrency {
  return country === 'AR' ? 'ARS' : 'UYU';
}

export function getBillingProductMeta(productId: string): BillingProductMeta | null {
  return BILLING_PRODUCT_META.find((p) => p.id === productId) ?? null;
}

export function getProductPriceForCountry(
  productId: string,
  country: BillingCountryCode
): BillingProductPrice | null {
  if (!getBillingProductMeta(productId)) return null;
  const id = productId as TrialProductId;
  const amountMonthly = amountMonthlyFor(DEFAULT_COMMERCIAL_CATALOG, id, country);
  const extraUserMonthly = extraErpUserPriceFor(DEFAULT_COMMERCIAL_CATALOG, id, country);
  const currency = currencyFor(country);
  return {
    country,
    currency,
    amountMonthly,
    label: formatCatalogPriceLabel(country, amountMonthly),
    extraUserMonthly,
  };
}

export function getBillingProducts(): BillingProduct[] {
  return BILLING_PRODUCT_META.map((meta) => ({
    ...meta,
    prices: [
      getProductPriceForCountry(meta.id, 'UY')!,
      getProductPriceForCountry(meta.id, 'AR')!,
    ],
  }));
}

/** Compat: mismos datos que getBillingProducts(), precios desde commercial-catalog. */
export const BILLING_PRODUCTS: BillingProduct[] = new Proxy([] as BillingProduct[], {
  get(_target, prop, receiver) {
    const products = getBillingProducts();
    if (prop === 'length') return products.length;
    if (prop === Symbol.iterator) return products[Symbol.iterator].bind(products);
    if (typeof prop === 'string' && /^\d+$/.test(prop)) return products[Number(prop)];
    const value = Reflect.get(products, prop, receiver);
    return typeof value === 'function' ? value.bind(products) : value;
  },
});

export function getBillingProduct(productId: string): BillingProduct | null {
  const meta = getBillingProductMeta(productId);
  if (!meta) return null;
  return {
    ...meta,
    prices: [
      getProductPriceForCountry(meta.id, 'UY')!,
      getProductPriceForCountry(meta.id, 'AR')!,
    ],
  };
}

export function listProductsForCountry(country: BillingCountryCode) {
  return BILLING_PRODUCT_META.map((product) => {
    const price = getProductPriceForCountry(product.id, country)!;
    const amountYearly = yearlyAmountFromMonthly(price.amountMonthly);
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      featured: Boolean(product.featured),
      currency: price.currency,
      amountMonthly: price.amountMonthly,
      amountYearly,
      extraUserMonthly: price.extraUserMonthly,
      priceLabel: price.label,
      priceLabelYearly: formatMoneyLabel(price.currency, amountYearly, '/ año'),
      erpPlanId: product.erpPlanId,
      country,
    };
  });
}

/** Precios de plantilla ERP alineados al catálogo comercial (país de referencia). */
export function getErpPlanTemplatePrices(
  planId: string,
  country: BillingCountryCode = 'UY'
): {
  precioBaseMensual: number;
  precioPorOperador: number;
  precioPorAdministrador: number;
  currency: BillingCurrency;
  productId: TrialProductId | null;
  productName: string | null;
} | null {
  return erpPlanPricesFromCatalog(DEFAULT_COMMERCIAL_CATALOG, planId, country);
}

import type { TrialProductId } from './platform-access.ts';

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

export interface BillingProduct {
  id: TrialProductId;
  name: string;
  description: string;
  /** Plan ERP interno al convertir. */
  erpPlanId: string;
  prices: BillingProductPrice[];
  featured?: boolean;
}

/** Precio sugerido por usuario extra ERP (UY / AR) cuando el plan no define override. */
export const DEFAULT_EXTRA_USER_MONTHLY: Record<BillingCountryCode, number> = {
  UY: 490,
  AR: 9900,
};

/** Catálogo comercial público (checkout). Montos enteros en moneda local. */
export const BILLING_PRODUCTS: BillingProduct[] = [
  {
    id: 'whatsapp',
    name: 'RiloBot (WhatsApp)',
    description: 'Pedidos, ventas y cobros por WhatsApp con confirmación.',
    erpPlanId: 'plan_basico',
    featured: true,
    prices: [
      {
        country: 'UY',
        currency: 'UYU',
        amountMonthly: 1490,
        label: 'UYU 1.490 / mes',
        extraUserMonthly: DEFAULT_EXTRA_USER_MONTHLY.UY,
      },
      {
        country: 'AR',
        currency: 'ARS',
        amountMonthly: 36900,
        label: 'ARS 36.900 / mes',
        extraUserMonthly: DEFAULT_EXTRA_USER_MONTHLY.AR,
      },
    ],
  },
  {
    id: 'erp',
    name: 'Panel web',
    description: 'Caja, clientes, stock, compras, ventas y reportes.',
    erpPlanId: 'plan_intermedio',
    prices: [
      {
        country: 'UY',
        currency: 'UYU',
        amountMonthly: 2490,
        label: 'UYU 2.490 / mes',
        extraUserMonthly: DEFAULT_EXTRA_USER_MONTHLY.UY,
      },
      {
        country: 'AR',
        currency: 'ARS',
        amountMonthly: 59900,
        label: 'ARS 59.900 / mes',
        extraUserMonthly: DEFAULT_EXTRA_USER_MONTHLY.AR,
      },
    ],
  },
  {
    id: 'completo',
    name: 'RiloBot + Panel',
    description: 'WhatsApp para cargar + panel para controlar.',
    erpPlanId: 'plan_profesional',
    prices: [
      {
        country: 'UY',
        currency: 'UYU',
        amountMonthly: 3490,
        label: 'UYU 3.490 / mes',
        extraUserMonthly: DEFAULT_EXTRA_USER_MONTHLY.UY,
      },
      {
        country: 'AR',
        currency: 'ARS',
        amountMonthly: 84900,
        label: 'ARS 84.900 / mes',
        extraUserMonthly: DEFAULT_EXTRA_USER_MONTHLY.AR,
      },
    ],
  },
];

/** Mapeo plantilla ERP ← producto landing (precio base UY por defecto en plataforma). */
export const ERP_PLAN_BILLING_DEFAULTS: Record<
  string,
  { productId: TrialProductId; nombre: string }
> = {
  plan_basico: { productId: 'whatsapp', nombre: 'RiloBot (WhatsApp)' },
  plan_intermedio: { productId: 'erp', nombre: 'Panel web' },
  plan_profesional: { productId: 'completo', nombre: 'RiloBot + Panel' },
};

export function resolveBillingCountry(pais: string | null | undefined): BillingCountryCode {
  if (!SHOW_ARGENTINA_BILLING) return 'UY';

  const raw = String(pais ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (!raw) return 'UY';
  if (
    raw === 'ar' ||
    raw === 'arg' ||
    raw.includes('argentina') ||
    raw === '54'
  ) {
    return 'AR';
  }
  return 'UY';
}

export function getBillingProduct(productId: string): BillingProduct | null {
  return BILLING_PRODUCTS.find((p) => p.id === productId) ?? null;
}

export function getProductPriceForCountry(
  productId: string,
  country: BillingCountryCode
): BillingProductPrice | null {
  const product = getBillingProduct(productId);
  if (!product) return null;
  return product.prices.find((p) => p.country === country) ?? null;
}

export function listProductsForCountry(country: BillingCountryCode) {
  return BILLING_PRODUCTS.map((product) => {
    const price = product.prices.find((p) => p.country === country)!;
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

/** Precios de plantilla ERP alineados al catálogo de la landing (país de referencia). */
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
  const mapping = ERP_PLAN_BILLING_DEFAULTS[planId];
  if (!mapping) return null;
  const price = getProductPriceForCountry(mapping.productId, country);
  if (!price) return null;
  return {
    precioBaseMensual: price.amountMonthly,
    precioPorOperador: price.extraUserMonthly,
    precioPorAdministrador: 0,
    currency: price.currency,
    productId: mapping.productId,
    productName: mapping.nombre,
  };
}

import type { TrialProductId } from './platform-access.ts';
import {
  ERP_PLAN_BILLING_DEFAULTS,
  formatMoneyLabel,
  listProductsForCountry,
  yearlyAmountFromMonthly,
  type BillingCountryCode,
  type BillingCurrency,
} from './billing-catalog.ts';

export type CommercialProductQuote = {
  amountMonthlyUY: number;
  amountMonthlyAR: number;
  includedAi: number;
};

export type CommercialCatalog = {
  trialDays: number;
  /** Acciones IA por mes durante la prueba (uso generoso para que carguen el negocio). */
  trialAccionesIaMes: number;
  lite: {
    maxClientes: number;
    maxProductos: number;
    maxAccionesIaMes: number;
    /** Altas por WhatsApp (pedido/venta/compra/cobro/caja) en plan libre. Consultas no cuentan. */
    maxOperacionesMes: number;
  };
  /** Promo al pasar a pago (0 = no mostrar). Se edita desde la plataforma. */
  introDiscountMonths: number;
  introDiscountPercent: number;
  extraUserMonthlyUY: number;
  extraUserMonthlyAR: number;
  products: Record<TrialProductId, CommercialProductQuote>;
  updatedAt?: string | null;
};

export function trialCtaLabel(days: number, productLabel?: string): string {
  const n = Math.max(1, Math.round(Number(days) || 30));
  return productLabel ? `Probar ${productLabel} ${n} días gratis` : `Probar ${n} días gratis`;
}

export type CommercialFunnelStep = {
  step: string;
  title: string;
  body: string;
};

/** 1) 30 días a full → 2) seguís gratis → 3) pagás solo si te pasás. */
export function commercialFunnelSteps(catalog: CommercialCatalog): CommercialFunnelStep[] {
  return [
    {
      step: '1',
      title: `${catalog.trialDays} días a full`,
      body: 'Sin tarjeta. Probá todo el producto con tu negocio real.',
    },
    {
      step: '2',
      title: 'Seguís gratis',
      body: 'Un feriante o taller chico puede vivir ahí. No te cobramos por haber probado.',
    },
    {
      step: '3',
      title: 'Pagás cuando lo necesitás',
      body:
        `Si pasás de ${catalog.lite.maxOperacionesMes} cargas al mes, se te acaba la IA, ` +
        `o se te llenan clientes/productos (${catalog.lite.maxClientes} / ${catalog.lite.maxProductos}).`,
    },
  ];
}

/** Embudo: $0 para enganchar → techos cuando el volumen es real → pago porque lo necesitan. */
export const DEFAULT_COMMERCIAL_CATALOG: CommercialCatalog = {
  trialDays: 30,
  trialAccionesIaMes: 150,
  lite: {
    maxClientes: 40,
    maxProductos: 50,
    maxAccionesIaMes: 20,
    maxOperacionesMes: 100,
  },
  extraUserMonthlyUY: 490,
  extraUserMonthlyAR: 9900,
  introDiscountMonths: 6,
  introDiscountPercent: 70,
  products: {
    whatsapp: { amountMonthlyUY: 1490, amountMonthlyAR: 36900, includedAi: 1000 },
    erp: { amountMonthlyUY: 2490, amountMonthlyAR: 59900, includedAi: 0 },
    completo: { amountMonthlyUY: 3490, amountMonthlyAR: 84900, includedAi: 2000 },
  },
  updatedAt: null,
};

export function amountMonthlyFor(
  catalog: CommercialCatalog,
  productId: TrialProductId,
  country: BillingCountryCode
): number {
  const row = catalog.products[productId];
  return country === 'AR' ? row.amountMonthlyAR : row.amountMonthlyUY;
}

export function extraUserMonthlyFor(
  catalog: CommercialCatalog,
  country: BillingCountryCode
): number {
  return country === 'AR' ? catalog.extraUserMonthlyAR : catalog.extraUserMonthlyUY;
}

export function formatCatalogPriceLabel(
  country: BillingCountryCode,
  amount: number
): string {
  const currency = country === 'AR' ? 'ARS' : 'UYU';
  return `${currency} ${amount.toLocaleString('es-UY')} / mes`;
}

export function clampCommercialCatalog(raw: Partial<CommercialCatalog> | null | undefined): CommercialCatalog {
  const base = DEFAULT_COMMERCIAL_CATALOG;
  const lite = raw?.lite ?? base.lite;
  const products = raw?.products ?? base.products;
  const num = (value: unknown, fallback: number, min = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.round(n)) : fallback;
  };
  const product = (id: TrialProductId): CommercialProductQuote => {
    const row = products[id] ?? base.products[id];
    return {
      amountMonthlyUY: num(row.amountMonthlyUY, base.products[id].amountMonthlyUY, 0),
      amountMonthlyAR: num(row.amountMonthlyAR, base.products[id].amountMonthlyAR, 0),
      includedAi: num(row.includedAi, base.products[id].includedAi, 0),
    };
  };
  return {
    trialDays: num(raw?.trialDays, base.trialDays, 1),
    trialAccionesIaMes: num(raw?.trialAccionesIaMes, base.trialAccionesIaMes, 0),
    lite: {
      maxClientes: num(lite.maxClientes, base.lite.maxClientes, 1),
      maxProductos: num(lite.maxProductos, base.lite.maxProductos, 1),
      maxAccionesIaMes: num(lite.maxAccionesIaMes, base.lite.maxAccionesIaMes, 0),
      maxOperacionesMes: num(
        'maxOperacionesMes' in lite ? lite.maxOperacionesMes : undefined,
        base.lite.maxOperacionesMes,
        0
      ),
    },
    extraUserMonthlyUY: num(raw?.extraUserMonthlyUY, base.extraUserMonthlyUY, 0),
    extraUserMonthlyAR: num(raw?.extraUserMonthlyAR, base.extraUserMonthlyAR, 0),
    introDiscountMonths: Math.min(24, num(raw?.introDiscountMonths, base.introDiscountMonths, 0)),
    introDiscountPercent: Math.min(90, num(raw?.introDiscountPercent, base.introDiscountPercent, 0)),
    products: {
      whatsapp: product('whatsapp'),
      erp: product('erp'),
      completo: product('completo'),
    },
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

export function overlayProductsForCountry(
  catalog: CommercialCatalog,
  country: BillingCountryCode
) {
  return listProductsForCountry(country).map((product) => {
    const amountMonthly = amountMonthlyFor(catalog, product.id, country);
    const extraUserMonthly = extraUserMonthlyFor(catalog, country);
    const amountYearly = yearlyAmountFromMonthly(amountMonthly);
    const currency = product.currency as BillingCurrency;
    return {
      ...product,
      amountMonthly,
      amountYearly,
      extraUserMonthly,
      includedAi: catalog.products[product.id].includedAi,
      trialDays: catalog.trialDays,
      priceLabel: formatMoneyLabel(currency, amountMonthly, '/ mes'),
      priceLabelYearly: formatMoneyLabel(currency, amountYearly, '/ año'),
    };
  });
}

export function erpPlanPricesFromCatalog(
  catalog: CommercialCatalog,
  planId: string,
  country: BillingCountryCode = 'UY'
) {
  const mapping = ERP_PLAN_BILLING_DEFAULTS[planId];
  if (!mapping) return null;
  const currency: BillingCurrency = country === 'AR' ? 'ARS' : 'UYU';
  return {
    precioBaseMensual: amountMonthlyFor(catalog, mapping.productId, country),
    precioPorOperador: extraUserMonthlyFor(catalog, country),
    precioPorAdministrador: 0,
    currency,
    productId: mapping.productId,
    productName: mapping.nombre,
  };
}

export function litePitch(catalog: CommercialCatalog): string {
  return stayFreePitch(catalog);
}

export function stayFreePitch(catalog: CommercialCatalog): string {
  return (
    `${catalog.trialDays} días a full, sin tarjeta. Después seguís gratis. ` +
    `Un feriante o taller chico puede vivir ahí. ` +
    `Pagan cuando pasan de ${catalog.lite.maxOperacionesMes} cargas al mes, se les acaba la IA, ` +
    `o se les llenan clientes/productos.`
  );
}

export function trialMicrocopy(catalog: CommercialCatalog): string {
  return `${catalog.trialDays} días a full, sin tarjeta. Después seguís gratis si no te pasás.`;
}

export function hasIntroDiscount(catalog: CommercialCatalog): boolean {
  return catalog.introDiscountMonths > 0 && catalog.introDiscountPercent > 0;
}

export function discountedMonthly(amountMonthly: number, percent: number): number {
  const p = Math.min(90, Math.max(0, Math.round(percent)));
  return Math.round(Math.max(0, amountMonthly) * (100 - p) / 100);
}

export function introDiscountLabel(catalog: CommercialCatalog): string {
  if (!hasIntroDiscount(catalog)) return '';
  return `${catalog.introDiscountMonths} meses con ${catalog.introDiscountPercent}% off`;
}

export function introPriceLabel(
  catalog: CommercialCatalog,
  productId: TrialProductId,
  country: BillingCountryCode
): string {
  const list = amountMonthlyFor(catalog, productId, country);
  return formatCatalogPriceLabel(country, discountedMonthly(list, catalog.introDiscountPercent));
}

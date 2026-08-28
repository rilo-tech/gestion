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
  /** Burbujas de salida de WhatsApp incluidas (SÍ/NO cuenta). 0 = no hay bot. */
  includedWhatsapp: number;
};

/** Pack de cupo extra (este mes). Lo publica Superadmin y se cobra por Mercado Pago. */
export type UsagePackId = 'whatsapp' | 'ai';

export type CommercialUsagePack = {
  quantity: number;
  amountUY: number;
  amountAR: number;
};

export type CommercialCatalog = {
  trialDays: number;
  /** Acciones IA por mes durante la prueba (uso generoso para que carguen el negocio). */
  trialAccionesIaMes: number;
  /** Burbujas de WhatsApp por mes durante la prueba. */
  trialWhatsappMensajes: number;
  lite: {
    maxClientes: number;
    maxProductos: number;
    maxAccionesIaMes: number;
    /** Altas por WhatsApp (pedido/venta/compra/cobro/caja) en plan libre. Consultas no cuentan. */
    maxOperacionesMes: number;
    /** Burbujas de salida (incluye SÍ/NO) en plan libre. */
    maxWhatsappMensajes: number;
  };
  /** Promo al pasar a pago (0 = no mostrar). Se edita desde la plataforma. */
  introDiscountMonths: number;
  introDiscountPercent: number;
  extraUserMonthlyUY: number;
  extraUserMonthlyAR: number;
  /** Packs de cupo extra (este mes). Mismos números en landing, Planes y checkout. */
  usagePacks: Record<UsagePackId, CommercialUsagePack>;
  products: Record<TrialProductId, CommercialProductQuote>;
  updatedAt?: string | null;
};

export function trialCtaLabel(days: number, productLabel?: string): string {
  const n = Math.max(1, Math.round(Number(days) || 30));
  return productLabel ? `${productLabel} ${n} días gratis` : `${n} días gratis`;
}

export type CommercialFunnelStep = {
  step: string;
  title: string;
  body: string;
};

/** 1) 30 días gratis → 2) usá el producto → 3) contratá mensual. */
export function commercialFunnelSteps(catalog: CommercialCatalog): CommercialFunnelStep[] {
  return [
    {
      step: '1',
      title: `${catalog.trialDays} días gratis`,
      body: 'Sin tarjeta. Elegí RILO Bot, RILO Gestión o RILO Completo y probá con tu negocio real.',
    },
    {
      step: '2',
      title: 'Usá lo que contrataste',
      body: 'Cargá por WhatsApp, controlá en la web, o combiná los dos. Es la misma información.',
    },
    {
      step: '3',
      title: 'Activá el plan mensual',
      body: 'Al vencer la prueba tus datos siguen. Para seguir operando, contratás el plan. Cancelás cuando quieras.',
    },
  ];
}

/** Precios de lanzamiento MVP (UYU). Superadmin puede publicarlos distintos. */
export const DEFAULT_COMMERCIAL_CATALOG: CommercialCatalog = {
  trialDays: 30,
  trialAccionesIaMes: 150,
  trialWhatsappMensajes: 400,
  lite: {
    maxClientes: 40,
    maxProductos: 50,
    maxAccionesIaMes: 20,
    maxOperacionesMes: 100,
    maxWhatsappMensajes: 200,
  },
  extraUserMonthlyUY: 190,
  extraUserMonthlyAR: 4900,
  usagePacks: {
    whatsapp: { quantity: 500, amountUY: 390, amountAR: 9900 },
    ai: { quantity: 500, amountUY: 90, amountAR: 2500 },
  },
  introDiscountMonths: 0,
  introDiscountPercent: 0,
  products: {
    whatsapp: {
      amountMonthlyUY: 690,
      amountMonthlyAR: 16900,
      includedAi: 1000,
      includedWhatsapp: 800,
    },
    erp: {
      amountMonthlyUY: 590,
      amountMonthlyAR: 14900,
      includedAi: 0,
      includedWhatsapp: 0,
    },
    completo: {
      amountMonthlyUY: 990,
      amountMonthlyAR: 24900,
      includedAi: 2000,
      includedWhatsapp: 1200,
    },
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

export function usagePackAmountFor(
  catalog: CommercialCatalog,
  packId: UsagePackId,
  country: BillingCountryCode
): number {
  const pack = catalog.usagePacks[packId];
  return country === 'AR' ? pack.amountAR : pack.amountUY;
}

export function usagePackTitle(packId: UsagePackId, quantity: number): string {
  if (packId === 'whatsapp') {
    return `${quantity.toLocaleString('es-UY')} mensajes de WhatsApp`;
  }
  return `${quantity.toLocaleString('es-UY')} acciones IA`;
}

export function formatCatalogAmountLabel(
  country: BillingCountryCode,
  amount: number
): string {
  const currency = country === 'AR' ? 'ARS' : 'UYU';
  return `${currency} ${amount.toLocaleString('es-UY')}`;
}

export function usagePackPriceLabel(
  catalog: CommercialCatalog,
  packId: UsagePackId,
  country: BillingCountryCode
): string {
  return `${formatCatalogAmountLabel(country, usagePackAmountFor(catalog, packId, country))} · este mes`;
}

export function overlayUsagePacksForCountry(
  catalog: CommercialCatalog,
  country: BillingCountryCode
) {
  const packs = catalog.usagePacks ?? DEFAULT_COMMERCIAL_CATALOG.usagePacks;
  return (['whatsapp', 'ai'] as UsagePackId[])
    .map((id) => {
      const pack = packs[id] ?? DEFAULT_COMMERCIAL_CATALOG.usagePacks[id];
      const amount = country === 'AR' ? pack.amountAR : pack.amountUY;
      return {
        id,
        quantity: pack.quantity,
        amount,
        currency: (country === 'AR' ? 'ARS' : 'UYU') as BillingCurrency,
        title: usagePackTitle(id, pack.quantity),
        priceLabel: `${formatCatalogAmountLabel(country, amount)} · este mes`,
        hint:
          id === 'whatsapp'
            ? 'SÍ/NO también cuentan. Sirve para este mes; el plan se renueva solo.'
            : 'Parser, foto de boleta y match de catálogo. Este mes.',
      };
    })
    .filter((row) => row.amount > 0 && row.quantity > 0);
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
      includedWhatsapp: num(row.includedWhatsapp, base.products[id].includedWhatsapp, 0),
    };
  };
  return {
    trialDays: num(raw?.trialDays, base.trialDays, 1),
    trialAccionesIaMes: num(raw?.trialAccionesIaMes, base.trialAccionesIaMes, 0),
    trialWhatsappMensajes: num(raw?.trialWhatsappMensajes, base.trialWhatsappMensajes, 0),
    lite: {
      maxClientes: num(lite.maxClientes, base.lite.maxClientes, 1),
      maxProductos: num(lite.maxProductos, base.lite.maxProductos, 1),
      maxAccionesIaMes: num(lite.maxAccionesIaMes, base.lite.maxAccionesIaMes, 0),
      maxOperacionesMes: num(
        'maxOperacionesMes' in lite ? lite.maxOperacionesMes : undefined,
        base.lite.maxOperacionesMes,
        0
      ),
      maxWhatsappMensajes: num(
        'maxWhatsappMensajes' in lite ? lite.maxWhatsappMensajes : undefined,
        base.lite.maxWhatsappMensajes,
        0
      ),
    },
    extraUserMonthlyUY: num(raw?.extraUserMonthlyUY, base.extraUserMonthlyUY, 0),
    extraUserMonthlyAR: num(raw?.extraUserMonthlyAR, base.extraUserMonthlyAR, 0),
    usagePacks: {
      whatsapp: {
        quantity: num(
          raw?.usagePacks?.whatsapp?.quantity,
          base.usagePacks.whatsapp.quantity,
          1
        ),
        amountUY: num(raw?.usagePacks?.whatsapp?.amountUY, base.usagePacks.whatsapp.amountUY, 0),
        amountAR: num(raw?.usagePacks?.whatsapp?.amountAR, base.usagePacks.whatsapp.amountAR, 0),
      },
      ai: {
        quantity: num(raw?.usagePacks?.ai?.quantity, base.usagePacks.ai.quantity, 1),
        amountUY: num(raw?.usagePacks?.ai?.amountUY, base.usagePacks.ai.amountUY, 0),
        amountAR: num(raw?.usagePacks?.ai?.amountAR, base.usagePacks.ai.amountAR, 0),
      },
    },
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
      featured: product.id === 'completo',
      amountMonthly,
      amountYearly,
      extraUserMonthly,
      includedAi: catalog.products[product.id].includedAi,
      includedWhatsapp: catalog.products[product.id].includedWhatsapp,
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
  return `${catalog.trialDays} días gratis, sin tarjeta. Cancelás cuando quieras. Al vencer, tus datos siguen: para operar de nuevo, activá un plan.`;
}

export function trialMicrocopy(catalog: CommercialCatalog): string {
  return `${catalog.trialDays} días gratis, sin tarjeta. Configuración guiada. Cancelás cuando quieras.`;
}

export function completeVsSeparate(
  catalog: CommercialCatalog,
  country: BillingCountryCode
): { separate: number; completo: number; saving: number } {
  const separate =
    amountMonthlyFor(catalog, 'whatsapp', country) + amountMonthlyFor(catalog, 'erp', country);
  const completo = amountMonthlyFor(catalog, 'completo', country);
  return { separate, completo, saving: Math.max(0, separate - completo) };
}

export function trialCtaForProduct(productId: TrialProductId): string {
  if (productId === 'whatsapp') return 'Probar RILO Bot';
  if (productId === 'erp') return 'Probar RILO Gestión';
  return 'Probar RILO Completo';
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

/** Meses de promo que todavía le quedan a esta cuenta (cada período cobrado cuenta 1). */
export function introMonthsRemaining(paymentsUsed: number, catalog: CommercialCatalog): number {
  if (!hasIntroDiscount(catalog)) return 0;
  return Math.max(0, catalog.introDiscountMonths - Math.max(0, Math.floor(paymentsUsed || 0)));
}

export function introPriceLabel(
  catalog: CommercialCatalog,
  productId: TrialProductId,
  country: BillingCountryCode
): string {
  const list = amountMonthlyFor(catalog, productId, country);
  return formatCatalogPriceLabel(country, discountedMonthly(list, catalog.introDiscountPercent));
}

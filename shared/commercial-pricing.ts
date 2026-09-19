import type { BillingCountryCode } from './billing-catalog.ts';
import type { TrialProductId } from './platform-access.ts';
import {
  amountMonthlyFor,
  extraErpUserPriceFor,
  extraWhatsappNumberPriceFor,
  includedErpUsersFor,
  includedWhatsappNumbersFor,
  maxWhatsappNumbersFor,
  monthlyActionLimitFor,
  parseUsageMode,
  riloBotUsageModeFor,
  type CommercialCatalog,
  type CommercialUsageMode,
} from './commercial-catalog.ts';
import {
  productSellsErpUserAddons,
  productSellsWhatsappNumberAddons,
} from './commercial-seat-policy.ts';

/**
 * Recurrencia: Mercado Pago Preapproval (suscripciones oficiales).
 * Checkout Pro queda para packs one-shot. No guardamos tarjetas.
 *
 * Política de add-ons (no inventar prorrateo):
 * - El add-on se habilita ahora (usuario ERP) o cuando la línea WhatsApp queda activa.
 * - El período ya pago (paidUntil) no se recobra.
 * - El nuevo total se sincroniza con PUT /preapproval si hay renovación automática.
 * - Si no hay Preapproval, entra en el próximo Checkout Pro / alta de suscripción.
 */
export const ADDON_BILLING_EFFECTIVE_AT = 'next_renewal' as const;

export type AddonBillingEffectiveAt = typeof ADDON_BILLING_EFFECTIVE_AT;

export const ADDON_BILLING_POLICY_COPY =
  'Se suma a tu próxima renovación. Este período ya está pago. No hay cobro extra ahora.';

export function addonPolicyCopy(autoRenew: boolean): string {
  return autoRenew
    ? 'Actualizamos el importe de tu renovación automática en Mercado Pago. Este período ya está pago. No hay cobro extra ahora.'
    : ADDON_BILLING_POLICY_COPY;
}

export type CommercialSourceFlag = 'default' | 'override';

export type CommercialOverrides = {
  includedErpUsers?: number | null;
  extraErpUserPrice?: number | null;
  includedWhatsappNumbers?: number | null;
  extraWhatsappNumberPrice?: number | null;
  monthlyActionLimit?: number | null;
  usageMode?: CommercialUsageMode | null;
  maxWhatsappNumbers?: number | null;
  /** Precio final personalizado: reemplaza el total calculado. */
  precioFinal?: number | null;
};

export type ResolvedCommercialRates = {
  productId: TrialProductId;
  country: BillingCountryCode;
  currency: 'UYU' | 'ARS';
  baseAmount: number;
  includedErpUsers: number;
  extraErpUserPrice: number;
  includedWhatsappNumbers: number;
  extraWhatsappNumberPrice: number;
  monthlyActionLimit: number;
  usageMode: CommercialUsageMode;
  maxWhatsappNumbers: number | null;
  precioFinal: number | null;
  sources: {
    includedErpUsers: CommercialSourceFlag;
    extraErpUserPrice: CommercialSourceFlag;
    includedWhatsappNumbers: CommercialSourceFlag;
    extraWhatsappNumberPrice: CommercialSourceFlag;
    monthlyActionLimit: CommercialSourceFlag;
    usageMode: CommercialSourceFlag;
    maxWhatsappNumbers: CommercialSourceFlag;
    precioFinal: CommercialSourceFlag;
  };
};

export type CommercialFeeLine = {
  code: 'BASE' | 'ERP_EXTRA' | 'WA_EXTRA' | 'ADDON' | 'DISCOUNT' | 'CUSTOM';
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type CommercialMonthlyQuote = {
  rates: ResolvedCommercialRates;
  extraErpUsers: number;
  extraWhatsappNumbers: number;
  extraErpCost: number;
  extraWhatsappCost: number;
  addonTotal: number;
  discount: number;
  subtotal: number;
  total: number;
  lines: CommercialFeeLine[];
  customTotal: boolean;
  effectiveAt: AddonBillingEffectiveAt;
};

export type AddonChangeQuote = {
  kind: 'erp_user' | 'whatsapp_number';
  extraUnit: number;
  extraQuantityAfter: number;
  oldTotal: number;
  newTotal: number;
  delta: number;
  effectiveAt: AddonBillingEffectiveAt;
  policyCopy: string;
  paidUntil?: string | null;
};

export type WhatsappLineBillable = {
  businessId: string;
  enabled: boolean;
  phone?: string | null;
  status?: string | null;
};

export function extraSeatCount(active: number, included: number): number {
  return Math.max(0, Math.round(Number(active) || 0) - Math.max(0, Math.round(Number(included) || 0)));
}

export function isWhatsappLineBillable(line: WhatsappLineBillable): boolean {
  if (!line.enabled) return false;
  const phone = String(line.phone ?? '').trim();
  if (!phone) return false;
  const status = String(line.status ?? 'active').trim().toLowerCase();
  return status === 'active' || status === '';
}

export function billableWhatsappCount(lines: WhatsappLineBillable[]): number {
  return lines.filter(isWhatsappLineBillable).length;
}

/** Cupo de acciones: por empresa/suscripción, no por número. */
export function sharedActionUsage(
  perLine: Record<string, number>,
  monthlyActionLimit: number
): { used: number; max: number; remaining: number; perLine: Record<string, number> } {
  const used = Object.values(perLine).reduce((sum, n) => sum + Math.max(0, Number(n) || 0), 0);
  const max = Math.max(0, Math.round(Number(monthlyActionLimit) || 0));
  return {
    used,
    max,
    remaining: Math.max(0, max - used),
    perLine: { ...perLine },
  };
}

export function canConfirmCommercialBilling(rol: string | undefined | null): boolean {
  const r = String(rol ?? '').trim();
  return r === 'supervisor' || r === 'admin' || r === 'platform';
}

function overrideNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function resolveCommercialRates(input: {
  catalog: CommercialCatalog;
  productId: TrialProductId;
  country: BillingCountryCode;
  overrides?: CommercialOverrides | null;
}): ResolvedCommercialRates {
  const { catalog, productId, country } = input;
  const overrides = input.overrides ?? {};
  const pick = (
    override: number | null | undefined,
    fallback: number
  ): { value: number; source: CommercialSourceFlag } => {
    const n = overrideNum(override);
    if (n != null) return { value: n, source: 'override' };
    return { value: fallback, source: 'default' };
  };

  const includedErp = pick(overrides.includedErpUsers, includedErpUsersFor(catalog, productId));
  const sellsErpUsers = productSellsErpUserAddons(productId);
  const sellsWaNumbers = productSellsWhatsappNumberAddons(productId);
  const extraErp = pick(
    overrides.extraErpUserPrice,
    sellsErpUsers ? extraErpUserPriceFor(catalog, productId, country) : 0
  );
  const includedWa = pick(
    overrides.includedWhatsappNumbers,
    sellsWaNumbers ? includedWhatsappNumbersFor(catalog, productId) : 0
  );
  const extraWa = pick(
    overrides.extraWhatsappNumberPrice,
    sellsWaNumbers ? extraWhatsappNumberPriceFor(catalog, productId, country) : 0
  );
  const actions = pick(overrides.monthlyActionLimit, monthlyActionLimitFor(catalog, productId));
  const catalogMode = riloBotUsageModeFor(catalog, productId);
  const usageMode: CommercialUsageMode = overrides.usageMode
    ? parseUsageMode(overrides.usageMode)
    : catalogMode;
  const maxDefault = maxWhatsappNumbersFor(catalog, productId);
  const maxOverride = overrideNum(overrides.maxWhatsappNumbers);
  const precioFinal = overrideNum(overrides.precioFinal);

  return {
    productId,
    country,
    currency: country === 'AR' ? 'ARS' : 'UYU',
    baseAmount: amountMonthlyFor(catalog, productId, country),
    includedErpUsers: includedErp.value,
    extraErpUserPrice: extraErp.value,
    includedWhatsappNumbers: includedWa.value,
    extraWhatsappNumberPrice: extraWa.value,
    monthlyActionLimit: actions.value,
    usageMode,
    maxWhatsappNumbers: maxOverride != null ? maxOverride : maxDefault,
    precioFinal,
    sources: {
      includedErpUsers: includedErp.source,
      extraErpUserPrice: extraErp.source,
      includedWhatsappNumbers: includedWa.source,
      extraWhatsappNumberPrice: extraWa.source,
      monthlyActionLimit: actions.source,
      usageMode: overrides.usageMode ? 'override' : 'default',
      maxWhatsappNumbers: maxOverride != null ? 'override' : 'default',
      precioFinal: precioFinal != null ? 'override' : 'default',
    },
  };
}

export function quoteCommercialMonthly(input: {
  catalog: CommercialCatalog;
  productId: TrialProductId;
  country: BillingCountryCode;
  overrides?: CommercialOverrides | null;
  activeErpUsers: number;
  billableWhatsappNumbers: number;
  addonTotal?: number;
  discount?: number;
}): CommercialMonthlyQuote {
  const rates = resolveCommercialRates(input);
  const extraErpUsers = extraSeatCount(input.activeErpUsers, rates.includedErpUsers);
  const extraWhatsappNumbers = extraSeatCount(
    input.billableWhatsappNumbers,
    rates.includedWhatsappNumbers
  );
  const extraErpCost = extraErpUsers * rates.extraErpUserPrice;
  const extraWhatsappCost = extraWhatsappNumbers * rates.extraWhatsappNumberPrice;
  const addonTotal = Math.max(0, Math.round(Number(input.addonTotal) || 0));
  const discount = Math.max(0, Math.round(Number(input.discount) || 0));
  const lines: CommercialFeeLine[] = [];

  if (rates.baseAmount > 0) {
    lines.push({
      code: 'BASE',
      label: 'Plan base',
      quantity: 1,
      unitPrice: rates.baseAmount,
      amount: rates.baseAmount,
    });
  }
  if (extraErpCost > 0) {
    lines.push({
      code: 'ERP_EXTRA',
      label: 'Usuarios de RILO Gestión adicionales',
      quantity: extraErpUsers,
      unitPrice: rates.extraErpUserPrice,
      amount: extraErpCost,
    });
  }
  if (extraWhatsappCost > 0) {
    lines.push({
      code: 'WA_EXTRA',
      label: 'Números de WhatsApp adicionales',
      quantity: extraWhatsappNumbers,
      unitPrice: rates.extraWhatsappNumberPrice,
      amount: extraWhatsappCost,
    });
  }
  if (addonTotal > 0) {
    lines.push({
      code: 'ADDON',
      label: 'Otros add-ons',
      quantity: 1,
      unitPrice: addonTotal,
      amount: addonTotal,
    });
  }

  const subtotal = rates.baseAmount + extraErpCost + extraWhatsappCost + addonTotal;
  if (discount > 0) {
    lines.push({
      code: 'DISCOUNT',
      label: 'Descuento',
      quantity: 1,
      unitPrice: -discount,
      amount: -discount,
    });
  }

  let total = Math.max(0, subtotal - discount);
  let customTotal = false;
  if (rates.precioFinal != null) {
    total = rates.precioFinal;
    customTotal = true;
    lines.push({
      code: 'CUSTOM',
      label: 'Precio final personalizado',
      quantity: 1,
      unitPrice: total,
      amount: total,
    });
  }

  return {
    rates,
    extraErpUsers,
    extraWhatsappNumbers,
    extraErpCost,
    extraWhatsappCost,
    addonTotal,
    discount,
    subtotal,
    total,
    lines,
    customTotal,
    effectiveAt: ADDON_BILLING_EFFECTIVE_AT,
  };
}

export function quoteAddErpUser(input: {
  catalog: CommercialCatalog;
  productId: TrialProductId;
  country: BillingCountryCode;
  overrides?: CommercialOverrides | null;
  activeErpUsers: number;
  billableWhatsappNumbers: number;
  addonTotal?: number;
  discount?: number;
  paidUntil?: string | null;
}): AddonChangeQuote {
  if (!productSellsErpUserAddons(input.productId)) {
    const current = quoteCommercialMonthly(input);
    return {
      kind: 'erp_user',
      extraUnit: 0,
      extraQuantityAfter: 0,
      oldTotal: current.total,
      newTotal: current.total,
      delta: 0,
      effectiveAt: ADDON_BILLING_EFFECTIVE_AT,
      policyCopy: 'Este plan no incluye usuarios adicionales de RILO Gestión. Sumá el panel o un número de WhatsApp según corresponda.',
      paidUntil: input.paidUntil ?? null,
    };
  }
  const current = quoteCommercialMonthly(input);
  const next = quoteCommercialMonthly({
    ...input,
    activeErpUsers: input.activeErpUsers + 1,
  });
  return {
    kind: 'erp_user',
    extraUnit: current.rates.extraErpUserPrice,
    extraQuantityAfter: next.extraErpUsers,
    oldTotal: current.total,
    newTotal: next.total,
    delta: next.total - current.total,
    effectiveAt: ADDON_BILLING_EFFECTIVE_AT,
    policyCopy: ADDON_BILLING_POLICY_COPY,
    paidUntil: input.paidUntil ?? null,
  };
}

export function quoteAddWhatsappNumber(input: {
  catalog: CommercialCatalog;
  productId: TrialProductId;
  country: BillingCountryCode;
  overrides?: CommercialOverrides | null;
  activeErpUsers: number;
  billableWhatsappNumbers: number;
  addonTotal?: number;
  discount?: number;
  paidUntil?: string | null;
}): AddonChangeQuote {
  if (!productSellsWhatsappNumberAddons(input.productId)) {
    const current = quoteCommercialMonthly(input);
    return {
      kind: 'whatsapp_number',
      extraUnit: 0,
      extraQuantityAfter: 0,
      oldTotal: current.total,
      newTotal: current.total,
      delta: 0,
      effectiveAt: ADDON_BILLING_EFFECTIVE_AT,
      policyCopy: 'Este plan no incluye números de WhatsApp. Sumá RILO Bot o Completo para conectarlos.',
      paidUntil: input.paidUntil ?? null,
    };
  }
  const current = quoteCommercialMonthly(input);
  const next = quoteCommercialMonthly({
    ...input,
    billableWhatsappNumbers: input.billableWhatsappNumbers + 1,
  });
  return {
    kind: 'whatsapp_number',
    extraUnit: current.rates.extraWhatsappNumberPrice,
    extraQuantityAfter: next.extraWhatsappNumbers,
    oldTotal: current.total,
    newTotal: next.total,
    delta: next.total - current.total,
    effectiveAt: ADDON_BILLING_EFFECTIVE_AT,
    policyCopy: ADDON_BILLING_POLICY_COPY,
    paidUntil: input.paidUntil ?? null,
  };
}

export function quoteRemoveErpUser(input: {
  catalog: CommercialCatalog;
  productId: TrialProductId;
  country: BillingCountryCode;
  overrides?: CommercialOverrides | null;
  activeErpUsers: number;
  billableWhatsappNumbers: number;
  addonTotal?: number;
  discount?: number;
}): CommercialMonthlyQuote {
  return quoteCommercialMonthly({
    ...input,
    activeErpUsers: Math.max(0, input.activeErpUsers - 1),
  });
}

export function quoteReleaseWhatsappNumber(input: {
  catalog: CommercialCatalog;
  productId: TrialProductId;
  country: BillingCountryCode;
  overrides?: CommercialOverrides | null;
  activeErpUsers: number;
  billableWhatsappNumbers: number;
  addonTotal?: number;
  discount?: number;
}): CommercialMonthlyQuote {
  return quoteCommercialMonthly({
    ...input,
    billableWhatsappNumbers: Math.max(0, input.billableWhatsappNumbers - 1),
  });
}

export type CommercialPriceSnapshot = {
  catalogVersion: string;
  productId: TrialProductId;
  basePrice: number;
  currency: 'UYU' | 'ARS';
  includedUsers: number;
  extraUserPrice: number;
  includedAiActions: number;
  includedWhatsappNumbers: number;
  extraWhatsappNumberPrice: number;
  monthlyTotal: number;
  capturedAt: string;
};

/** Motor único de cotización (alias explícito para EF). */
export const quotePrice = quoteCommercialMonthly;

export function buildCommercialPriceSnapshot(input: {
  catalog: CommercialCatalog;
  quote: CommercialMonthlyQuote;
  productId: TrialProductId;
  capturedAt?: string;
}): CommercialPriceSnapshot {
  const { quote, productId } = input;
  return {
    catalogVersion: input.catalog.priceVersion ?? 'unknown',
    productId,
    basePrice: quote.rates.baseAmount,
    currency: quote.rates.currency,
    includedUsers: quote.rates.includedErpUsers,
    extraUserPrice: quote.rates.extraErpUserPrice,
    includedAiActions: quote.rates.monthlyActionLimit,
    includedWhatsappNumbers: quote.rates.includedWhatsappNumbers,
    extraWhatsappNumberPrice: quote.rates.extraWhatsappNumberPrice,
    monthlyTotal: quote.total,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

export type CommercialHistoryEventType =
  | 'user_added'
  | 'user_removed'
  | 'whatsapp_number_added'
  | 'whatsapp_number_released'
  | 'addon_added'
  | 'addon_removed'
  | 'price_changed'
  | 'plan_changed';

export type CommercialHistoryEvent = {
  type: CommercialHistoryEventType;
  businessId: string;
  actor: string;
  date: string;
  oldValue: unknown;
  newValue: unknown;
  billingImpact: {
    oldTotal: number;
    newTotal: number;
    delta: number;
    effectiveAt: AddonBillingEffectiveAt;
  };
};

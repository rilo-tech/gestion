import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import type { BillingCountryCode } from '../../../../../shared/billing-catalog.ts';
import type { TrialProductId } from '../../../../../shared/platform-access.ts';
import {
  DEFAULT_COMMERCIAL_CATALOG,
  litePitch,
  overlayProductsForCountry,
  overlayUsagePacksForCountry,
  parseUsageMode,
  type CommercialCatalog,
  type CommercialUsageMode,
  type CommercialUsagePack,
  type UsagePackId,
} from '../../../../../shared/commercial-catalog.ts';

export type PublicCommercialProduct = {
  id: TrialProductId;
  label: string;
  description: string;
  whatsapp: boolean;
  panel: boolean;
  featured: boolean;
  trialDays: number;
  includedAi: number;
  includedWhatsapp: number;
  includedErpUsers?: number;
  extraErpUserPrice?: number;
  includedWhatsappNumbers?: number;
  extraWhatsappNumberPrice?: number;
  maxWhatsappNumbers?: number | null;
  usageMode?: CommercialUsageMode;
  riloBotUsageMode?: CommercialUsageMode;
  amountMonthly: number;
  amountYearly: number;
  extraUserMonthly: number;
  extraWhatsappNumberMonthly?: number;
  priceLabel: string;
  priceLabelYearly: string;
};

export type PublicUsagePack = {
  id: UsagePackId;
  quantity: number;
  amount: number;
  currency: string;
  title: string;
  priceLabel: string;
  hint: string;
};

export type PublicCommercialResponse = {
  country: BillingCountryCode;
  trialDays: number;
  trialAccionesIaMes: number;
  trialWhatsappMensajes: number;
  lite: CommercialCatalog['lite'];
  introDiscountMonths: number;
  introDiscountPercent: number;
  extraUserMonthly: number;
  extraWhatsappNumberMonthly?: number;
  usagePacks: PublicUsagePack[];
  usagePacksRaw?: CommercialCatalog['usagePacks'];
  litePitch: string;
  products: PublicCommercialProduct[];
  updatedAt: string | null;
};

@Injectable({ providedIn: 'root' })
export class CommercialCatalogService {
  private http = inject(HttpClient);

  load(country: BillingCountryCode): Observable<{
    catalog: CommercialCatalog;
    public: PublicCommercialResponse;
  }> {
    return this.http.get<PublicCommercialResponse>(`/api/public/commercial?country=${country}`).pipe(
      map((row) => ({
        catalog: catalogFromPublic(row, country),
        public: row,
      })),
      catchError(() => of(fallback(country)))
    );
  }
}

function catalogFromPublic(
  row: PublicCommercialResponse,
  country: BillingCountryCode
): CommercialCatalog {
  return {
    trialDays: row.trialDays,
    trialAccionesIaMes: row.trialAccionesIaMes,
    trialWhatsappMensajes:
      row.trialWhatsappMensajes ?? DEFAULT_COMMERCIAL_CATALOG.trialWhatsappMensajes,
    lite: row.lite,
    introDiscountMonths: row.introDiscountMonths ?? DEFAULT_COMMERCIAL_CATALOG.introDiscountMonths,
    introDiscountPercent: row.introDiscountPercent ?? DEFAULT_COMMERCIAL_CATALOG.introDiscountPercent,
    extraUserMonthlyUY:
      country === 'UY' ? row.extraUserMonthly : DEFAULT_COMMERCIAL_CATALOG.extraUserMonthlyUY,
    extraUserMonthlyAR:
      country === 'AR' ? row.extraUserMonthly : DEFAULT_COMMERCIAL_CATALOG.extraUserMonthlyAR,
    extraWhatsappNumberMonthlyUY:
      country === 'UY'
        ? row.extraWhatsappNumberMonthly ?? DEFAULT_COMMERCIAL_CATALOG.extraWhatsappNumberMonthlyUY
        : DEFAULT_COMMERCIAL_CATALOG.extraWhatsappNumberMonthlyUY,
    extraWhatsappNumberMonthlyAR:
      country === 'AR'
        ? row.extraWhatsappNumberMonthly ?? DEFAULT_COMMERCIAL_CATALOG.extraWhatsappNumberMonthlyAR
        : DEFAULT_COMMERCIAL_CATALOG.extraWhatsappNumberMonthlyAR,
    usagePacks: reconstructUsagePacks(row, country),
    products: {
      whatsapp: productQuote(row, country, 'whatsapp'),
      erp: productQuote(row, country, 'erp'),
      completo: productQuote(row, country, 'completo'),
    },
    updatedAt: row.updatedAt,
  };
}

function productQuote(
  row: PublicCommercialResponse,
  country: BillingCountryCode,
  id: TrialProductId
) {
  const defaults = DEFAULT_COMMERCIAL_CATALOG.products[id];
  return {
    amountMonthlyUY: country === 'UY' ? productAmount(row, id) : defaults.amountMonthlyUY,
    amountMonthlyAR: country === 'AR' ? productAmount(row, id) : defaults.amountMonthlyAR,
    includedAi: productAi(row, id),
    includedWhatsapp: productWhatsapp(row, id),
    includedErpUsers: productNum(row, id, 'includedErpUsers', defaults.includedErpUsers ?? 1),
    extraErpUserPriceUY:
      country === 'UY'
        ? productNum(row, id, 'extraErpUserPrice', defaults.extraErpUserPriceUY)
        : defaults.extraErpUserPriceUY,
    extraErpUserPriceAR:
      country === 'AR'
        ? productNum(row, id, 'extraErpUserPrice', defaults.extraErpUserPriceAR)
        : defaults.extraErpUserPriceAR,
    includedWhatsappNumbers: productNum(
      row,
      id,
      'includedWhatsappNumbers',
      defaults.includedWhatsappNumbers ?? (id === 'erp' ? 0 : 1)
    ),
    extraWhatsappNumberPriceUY:
      country === 'UY'
        ? productNum(row, id, 'extraWhatsappNumberPrice', defaults.extraWhatsappNumberPriceUY)
        : defaults.extraWhatsappNumberPriceUY,
    extraWhatsappNumberPriceAR:
      country === 'AR'
        ? productNum(row, id, 'extraWhatsappNumberPrice', defaults.extraWhatsappNumberPriceAR)
        : defaults.extraWhatsappNumberPriceAR,
    maxWhatsappNumbers: productMax(row, id, defaults.maxWhatsappNumbers),
    usageMode: productMode(row, id),
  };
}

function productNum(
  row: PublicCommercialResponse,
  id: TrialProductId,
  key:
    | 'includedErpUsers'
    | 'extraErpUserPrice'
    | 'includedWhatsappNumbers'
    | 'extraWhatsappNumberPrice',
  fallback: number | undefined
): number {
  const n = row.products.find((p) => p.id === id)?.[key];
  return typeof n === 'number' ? n : fallback ?? 0;
}

function productMax(
  row: PublicCommercialResponse,
  id: TrialProductId,
  fallback: number | null | undefined
): number | null {
  const n = row.products.find((p) => p.id === id)?.maxWhatsappNumbers;
  if (n == null) return fallback ?? null;
  return n > 0 ? n : null;
}

function productAmount(row: PublicCommercialResponse, id: TrialProductId): number {
  return row.products.find((p) => p.id === id)?.amountMonthly ?? 0;
}

function productAi(row: PublicCommercialResponse, id: TrialProductId): number {
  return (
    row.products.find((p) => p.id === id)?.includedAi ??
    DEFAULT_COMMERCIAL_CATALOG.products[id].includedAi
  );
}

function productWhatsapp(row: PublicCommercialResponse, id: TrialProductId): number {
  return (
    row.products.find((p) => p.id === id)?.includedWhatsapp ??
    DEFAULT_COMMERCIAL_CATALOG.products[id].includedWhatsapp
  );
}

function productMode(row: PublicCommercialResponse, id: TrialProductId): CommercialUsageMode {
  return parseUsageMode(
    row.products.find((p) => p.id === id)?.usageMode ??
      DEFAULT_COMMERCIAL_CATALOG.products[id].usageMode
  );
}

function reconstructUsagePacks(
  row: PublicCommercialResponse,
  country: BillingCountryCode
): CommercialCatalog['usagePacks'] {
  if (row.usagePacksRaw?.whatsapp && row.usagePacksRaw?.ai) {
    return {
      whatsapp: mergePack(row.usagePacksRaw.whatsapp, DEFAULT_COMMERCIAL_CATALOG.usagePacks.whatsapp),
      ai: mergePack(row.usagePacksRaw.ai, DEFAULT_COMMERCIAL_CATALOG.usagePacks.ai),
    };
  }
  return {
    whatsapp: packFromOverlay(row, country, 'whatsapp'),
    ai: packFromOverlay(row, country, 'ai'),
  };
}

function mergePack(raw: CommercialUsagePack, fallback: CommercialUsagePack): CommercialUsagePack {
  const num = (value: unknown, fallbackValue: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallbackValue;
  };
  return {
    quantity: Math.max(1, num(raw.quantity, fallback.quantity)),
    amountUY: num(raw.amountUY, fallback.amountUY),
    amountAR: num(raw.amountAR, fallback.amountAR),
  };
}

function packFromOverlay(
  row: PublicCommercialResponse,
  country: BillingCountryCode,
  id: UsagePackId
): CommercialUsagePack {
  const fallback = DEFAULT_COMMERCIAL_CATALOG.usagePacks[id];
  const overlay = row.usagePacks?.find((p) => p.id === id);
  return {
    quantity: overlay?.quantity ?? fallback.quantity,
    amountUY: country === 'UY' ? overlay?.amount ?? fallback.amountUY : fallback.amountUY,
    amountAR: country === 'AR' ? overlay?.amount ?? fallback.amountAR : fallback.amountAR,
  };
}

function fallback(country: BillingCountryCode): {
  catalog: CommercialCatalog;
  public: PublicCommercialResponse;
} {
  const catalog = DEFAULT_COMMERCIAL_CATALOG;
  const products = overlayProductsForCountry(catalog, country);
  return {
    catalog,
    public: {
      country,
      trialDays: catalog.trialDays,
      trialAccionesIaMes: catalog.trialAccionesIaMes,
      trialWhatsappMensajes: catalog.trialWhatsappMensajes,
      lite: catalog.lite,
      introDiscountMonths: catalog.introDiscountMonths,
      introDiscountPercent: catalog.introDiscountPercent,
      extraUserMonthly: country === 'AR' ? catalog.extraUserMonthlyAR : catalog.extraUserMonthlyUY,
      extraWhatsappNumberMonthly:
        country === 'AR' ? catalog.extraWhatsappNumberMonthlyAR : catalog.extraWhatsappNumberMonthlyUY,
      usagePacks: overlayUsagePacksForCountry(catalog, country),
      usagePacksRaw: catalog.usagePacks,
      litePitch: litePitch(catalog),
      products: products.map((row) => ({
        id: row.id,
        label: row.name,
        description: row.description,
        whatsapp: row.id !== 'erp',
        panel: row.id !== 'whatsapp',
        featured: Boolean(row.featured),
        trialDays: catalog.trialDays,
        includedAi: row.includedAi,
        includedWhatsapp: row.includedWhatsapp,
        includedErpUsers: row.includedErpUsers,
        extraErpUserPrice: row.extraErpUserPrice,
        includedWhatsappNumbers: row.includedWhatsappNumbers,
        extraWhatsappNumberPrice: row.extraWhatsappNumberPrice,
        maxWhatsappNumbers: row.maxWhatsappNumbers,
        usageMode: row.usageMode ?? 'limited',
        amountMonthly: row.amountMonthly,
        amountYearly: row.amountYearly,
        extraUserMonthly: row.extraUserMonthly,
        extraWhatsappNumberMonthly: row.extraWhatsappNumberMonthly,
        priceLabel: row.priceLabel,
        priceLabelYearly: row.priceLabelYearly,
      })),
      updatedAt: null,
    },
  };
}

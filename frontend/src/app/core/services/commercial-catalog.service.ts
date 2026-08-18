import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import type { BillingCountryCode } from '../../../../../shared/billing-catalog.ts';
import type { TrialProductId } from '../../../../../shared/platform-access.ts';
import {
  DEFAULT_COMMERCIAL_CATALOG,
  litePitch,
  overlayProductsForCountry,
  type CommercialCatalog,
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
  amountMonthly: number;
  amountYearly: number;
  extraUserMonthly: number;
  priceLabel: string;
  priceLabelYearly: string;
};

export type PublicCommercialResponse = {
  country: BillingCountryCode;
  trialDays: number;
  trialAccionesIaMes: number;
  lite: CommercialCatalog['lite'];
  introDiscountMonths: number;
  introDiscountPercent: number;
  extraUserMonthly: number;
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
        catalog: {
          trialDays: row.trialDays,
          trialAccionesIaMes: row.trialAccionesIaMes,
          lite: row.lite,
          introDiscountMonths: row.introDiscountMonths ?? DEFAULT_COMMERCIAL_CATALOG.introDiscountMonths,
          introDiscountPercent: row.introDiscountPercent ?? DEFAULT_COMMERCIAL_CATALOG.introDiscountPercent,
          extraUserMonthlyUY:
            country === 'UY' ? row.extraUserMonthly : DEFAULT_COMMERCIAL_CATALOG.extraUserMonthlyUY,
          extraUserMonthlyAR:
            country === 'AR' ? row.extraUserMonthly : DEFAULT_COMMERCIAL_CATALOG.extraUserMonthlyAR,
          products: {
            whatsapp: {
              amountMonthlyUY:
                country === 'UY'
                  ? productAmount(row, 'whatsapp')
                  : DEFAULT_COMMERCIAL_CATALOG.products.whatsapp.amountMonthlyUY,
              amountMonthlyAR:
                country === 'AR'
                  ? productAmount(row, 'whatsapp')
                  : DEFAULT_COMMERCIAL_CATALOG.products.whatsapp.amountMonthlyAR,
              includedAi: productAi(row, 'whatsapp'),
            },
            erp: {
              amountMonthlyUY:
                country === 'UY'
                  ? productAmount(row, 'erp')
                  : DEFAULT_COMMERCIAL_CATALOG.products.erp.amountMonthlyUY,
              amountMonthlyAR:
                country === 'AR'
                  ? productAmount(row, 'erp')
                  : DEFAULT_COMMERCIAL_CATALOG.products.erp.amountMonthlyAR,
              includedAi: productAi(row, 'erp'),
            },
            completo: {
              amountMonthlyUY:
                country === 'UY'
                  ? productAmount(row, 'completo')
                  : DEFAULT_COMMERCIAL_CATALOG.products.completo.amountMonthlyUY,
              amountMonthlyAR:
                country === 'AR'
                  ? productAmount(row, 'completo')
                  : DEFAULT_COMMERCIAL_CATALOG.products.completo.amountMonthlyAR,
              includedAi: productAi(row, 'completo'),
            },
          },
          updatedAt: row.updatedAt,
        },
        public: row,
      })),
      catchError(() => of(fallback(country)))
    );
  }
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
      lite: catalog.lite,
      introDiscountMonths: catalog.introDiscountMonths,
      introDiscountPercent: catalog.introDiscountPercent,
      extraUserMonthly: country === 'AR' ? catalog.extraUserMonthlyAR : catalog.extraUserMonthlyUY,
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
        amountMonthly: row.amountMonthly,
        amountYearly: row.amountYearly,
        extraUserMonthly: row.extraUserMonthly,
        priceLabel: row.priceLabel,
        priceLabelYearly: row.priceLabelYearly,
      })),
      updatedAt: null,
    },
  };
}

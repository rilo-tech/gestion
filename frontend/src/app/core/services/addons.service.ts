import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';
import type { AddonChangeQuote, CommercialMonthlyQuote, ResolvedCommercialRates } from '../../../../../shared/commercial-pricing.ts';

export type ClientWhatsappLine = {
  id: string;
  phone: string;
  name: string;
  enabled: boolean;
  kind?: 'primary' | 'extra';
  status?: 'active' | 'pending' | 'disconnected';
  addedAt?: string;
  createdAt?: string;
};

export type AddonsSnapshot = {
  productId: string;
  country: string;
  currency: string;
  rates: ResolvedCommercialRates;
  quote: CommercialMonthlyQuote;
  paidUntil: string | null;
  policyCopy: string;
  erp: {
    included: number;
    extraContracted: number;
    active: number;
    extraUnit: number;
    extraCost: number;
  };
  whatsapp: {
    included: number;
    extraContracted: number;
    billable: number;
    extraUnit: number;
    extraCost: number;
    max: number | null;
    lines: ClientWhatsappLine[];
  };
};

@Injectable({ providedIn: 'root' })
export class AddonsService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getSnapshot(): Observable<AddonsSnapshot> {
    return this.http.get<AddonsSnapshot>(`/api/business/${this.businessId}/addons`);
  }

  quoteUser(): Observable<AddonChangeQuote> {
    return this.http.get<AddonChangeQuote>(`/api/business/${this.businessId}/addons/quote-user`);
  }

  quoteWhatsapp(): Observable<AddonChangeQuote> {
    return this.http.get<AddonChangeQuote>(`/api/business/${this.businessId}/addons/quote-whatsapp`);
  }

  addWhatsappNumber(confirmBilling = true, name?: string) {
    return this.http.post<{ line: ClientWhatsappLine; quote: AddonChangeQuote; policyCopy: string }>(
      `/api/business/${this.businessId}/addons/whatsapp`,
      { confirmBilling, name }
    );
  }

  sendWhatsappCode(lineId: string, phone: string) {
    return this.http.post<{ phone: string; whatsappSent: boolean; devCode?: string }>(
      `/api/business/${this.businessId}/addons/whatsapp/${lineId}/send-code`,
      { phone }
    );
  }

  verifyWhatsapp(lineId: string, phone: string, code: string) {
    return this.http.post<{ phone: string; quote: CommercialMonthlyQuote }>(
      `/api/business/${this.businessId}/addons/whatsapp/${lineId}/verify`,
      { phone, code }
    );
  }

  releaseWhatsapp(lineId: string) {
    return this.http.post<{ ok: boolean; quote: CommercialMonthlyQuote }>(
      `/api/business/${this.businessId}/addons/whatsapp/${lineId}/release`,
      {}
    );
  }

  replacePrimary(phone: string, code?: string) {
    return this.http.post<{ phone?: string; step?: string; quote?: CommercialMonthlyQuote; devCode?: string }>(
      `/api/business/${this.businessId}/addons/whatsapp/replace-primary`,
      { phone, code }
    );
  }
}

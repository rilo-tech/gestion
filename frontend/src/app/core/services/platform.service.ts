import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  PublicBusinessInfo,
  PublicPlanInfo,
  SubscriptionPayment,
  BusinessSubscriptionInfo,
} from './business.service';
import type {
  SubscriptionModuleId,
  SubscriptionModulesMap,
  SubscriptionModuleMeta,
} from '../../../../../shared/subscription-modules.ts';
import type { ClientPlatformAccess } from '../../../../../shared/platform-access.ts';
import type { CommercialCatalog } from '../../../../../shared/commercial-catalog.ts';

export type SubscriptionStatus = 'activa' | 'suspendida' | 'vencida';

export interface CreateBusinessPayload {
  id: string;
  nombre: string;
  planId: string;
  trialProduct?: 'whatsapp' | 'erp' | 'completo';
  enPrueba?: boolean;
  trialStartDate?: string;
  trialEndDate?: string;
  suscripcion?: BusinessSubscriptionInfo;
  supervisor: {
    nombre: string;
    email?: string;
    phone?: string;
    loginUsername: string;
    password?: string;
  };
}

export interface UpdateBusinessPayload {
  nombre?: string;
  planId?: string;
  estadoSuscripcion?: SubscriptionStatus;
  enPrueba?: boolean;
  trialStartDate?: string;
  trialEndDate?: string;
  trialStatus?: 'active' | 'expired' | 'converted' | 'cancelled';
  historyNote?: string;
  suscripcion?: BusinessSubscriptionInfo;
}

export interface SubscriptionHistoryEntry {
  id: string;
  date: string;
  changedBy?: string;
  changeType: string;
  note?: string;
  previousPlanId?: string;
  newPlanId?: string;
  previousTrialStatus?: string | null;
  newTrialStatus?: string | null;
  previousEnPrueba?: boolean;
  newEnPrueba?: boolean;
}

export interface UpdatePlanResponse {
  plan: PublicPlanInfo;
  affectedBusinessCount: number;
  applyToExistingBusinesses: boolean;
  frozenBusinessCount: number;
  clearedFrozenCount: number;
}

export interface PlatformTrialRow {
  businessId: string;
  nombre: string;
  ownerName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  email: string | null;
  emailVerified: boolean;
  whatsappOptIn: boolean;
  planNombre: string;
  trialProduct: string | null;
  trialStartDate: string | null;
  trialEndDate: string | null;
  trialDaysRemaining: number | null;
  trialStatus: string | null;
  source: string | null;
  lastLoginAt: string | null;
  usage: {
    ordersCount: number;
    salesCount: number;
    productsCount: number;
    cashMovementsCount: number;
  };
}

export interface PlatformPendingTrialRegistration {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  pais: string;
  ciudad: string;
  status: string;
  emailVerified: boolean;
  trialProduct: string | null;
  trialDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanPayload {
  id: string;
  nombre: string;
  limiteAdministradores: number;
  limiteOperadores: number;
  limiteUsuariosTotal?: number;
  precioMensual?: number;
  precioBaseMensual?: number;
  precioPorAdministrador?: number;
  precioPorOperador?: number;
  modulosIncluidos?: SubscriptionModulesMap;
  preciosAddonModulo?: Partial<Record<SubscriptionModuleId, number>>;
  maxAmbitosCaja?: number;
  activo?: boolean;
}

export interface UpdatePlanPayload {
  nombre?: string;
  limiteAdministradores?: number;
  limiteOperadores?: number;
  limiteUsuariosTotal?: number;
  precioMensual?: number;
  precioBaseMensual?: number;
  precioPorAdministrador?: number;
  precioPorOperador?: number;
  modulosIncluidos?: SubscriptionModulesMap;
  preciosAddonModulo?: Partial<Record<SubscriptionModuleId, number>>;
  maxAmbitosCaja?: number;
  activo?: boolean;
  applyToExistingBusinesses?: boolean;
}

export interface RegisterSubscriptionPaymentPayload {
  periodo?: string;
  monto?: number;
  fechaPago?: string;
  notas?: string;
  coverageMonths?: number;
}

export interface BillingCatalogProduct {
  id: string;
  name: string;
  description: string;
  featured: boolean;
  currency: string;
  amountMonthly: number;
  amountYearly?: number;
  extraUserMonthly: number;
  priceLabel: string;
  priceLabelYearly?: string;
  erpPlanId: string;
  country: 'UY' | 'AR';
}

export interface MarkPaidPayload {
  productId?: string;
  country?: 'UY' | 'AR';
  registerPayment?: boolean;
  amount?: number;
  billingInterval?: 'month' | 'year';
  enablePerUserPricing?: boolean;
  precioPorOperador?: number;
}

@Injectable({
  providedIn: 'root',
})
export class PlatformService {
  private http = inject(HttpClient);

  getModuleCatalog(): Observable<SubscriptionModuleMeta[]> {
    return this.http.get<SubscriptionModuleMeta[]>('/api/platform/modules');
  }

  getBillingCatalog(country: 'UY' | 'AR' = 'UY'): Observable<{
    country: 'UY' | 'AR';
    products: BillingCatalogProduct[];
  }> {
    return this.http.get<{ country: 'UY' | 'AR'; products: BillingCatalogProduct[] }>(
      `/api/platform/billing-catalog?country=${country}`
    );
  }

  syncPlansFromLanding(): Observable<{ plans: PublicPlanInfo[]; message: string }> {
    return this.http.post<{ plans: PublicPlanInfo[]; message: string }>(
      '/api/platform/plans/sync-landing',
      {}
    );
  }

  getCommercialCatalog(): Observable<CommercialCatalog> {
    return this.http.get<CommercialCatalog>('/api/platform/commercial');
  }

  saveCommercialCatalog(payload: CommercialCatalog): Observable<{
    catalog: CommercialCatalog;
    plans: PublicPlanInfo[];
    message: string;
  }> {
    return this.http.put<{ catalog: CommercialCatalog; plans: PublicPlanInfo[]; message: string }>(
      '/api/platform/commercial',
      payload
    );
  }

  getPlans(): Observable<PublicPlanInfo[]> {
    return this.http.get<PublicPlanInfo[]>('/api/platform/plans');
  }

  createPlan(payload: CreatePlanPayload): Observable<PublicPlanInfo> {
    return this.http.post<PublicPlanInfo>('/api/platform/plans', payload);
  }

  updatePlan(planId: string, payload: UpdatePlanPayload): Observable<UpdatePlanResponse> {
    return this.http.patch<UpdatePlanResponse>(`/api/platform/plans/${planId}`, payload);
  }

  getBusinesses(): Observable<PublicBusinessInfo[]> {
    return this.http.get<PublicBusinessInfo[]>('/api/platform/businesses');
  }

  getBusiness(businessId: string): Observable<PublicBusinessInfo> {
    return this.http.get<PublicBusinessInfo>(`/api/platform/businesses/${businessId}`);
  }

  createBusiness(payload: CreateBusinessPayload): Observable<{
    business: PublicBusinessInfo;
    supervisor: { id: string; nombre: string; loginUsername: string };
  }> {
    return this.http.post('/api/platform/businesses', payload);
  }

  updateBusiness(
    businessId: string,
    payload: UpdateBusinessPayload
  ): Observable<PublicBusinessInfo> {
    return this.http.patch<PublicBusinessInfo>(
      `/api/platform/businesses/${businessId}`,
      payload
    );
  }

  updateBusinessContact(
    businessId: string,
    payload: {
      ownerName?: string;
      email?: string;
      phone?: string;
      pais?: string;
      ciudad?: string;
      rubro?: string;
      whatsappOptIn?: boolean;
    }
  ): Observable<PublicBusinessInfo> {
    return this.http.put<PublicBusinessInfo>(
      `/api/platform/businesses/${businessId}/contact`,
      payload
    );
  }

  sendBusinessInvoiceEmail(
    businessId: string,
    payload?: { to?: string; periodo?: string; notes?: string }
  ): Observable<{
    ok: boolean;
    sent: boolean;
    devOnly: boolean;
    to: string;
    periodo: string;
    total: number;
    message: string;
  }> {
    return this.http.post<{
      ok: boolean;
      sent: boolean;
      devOnly: boolean;
      to: string;
      periodo: string;
      total: number;
      message: string;
    }>(`/api/platform/businesses/${businessId}/send-invoice-email`, payload ?? {});
  }

  extendBusinessTrial(businessId: string, days: number): Observable<PublicBusinessInfo> {
    return this.http.post<PublicBusinessInfo>(
      `/api/platform/businesses/${businessId}/extend-trial`,
      { days }
    );
  }

  offboardBusiness(businessId: string): Observable<
    PublicBusinessInfo & { releasedEmail?: boolean; releasedPhone?: boolean }
  > {
    return this.http.post<PublicBusinessInfo & { releasedEmail?: boolean; releasedPhone?: boolean }>(
      `/api/platform/businesses/${businessId}/offboard`,
      {}
    );
  }

  markBusinessAsPaid(businessId: string, payload: MarkPaidPayload): Observable<PublicBusinessInfo> {
    return this.http.post<PublicBusinessInfo>(
      `/api/platform/businesses/${businessId}/mark-paid`,
      payload
    );
  }

  updatePlatformAccess(
    businessId: string,
    payload: Partial<
      Pick<ClientPlatformAccess, 'erpWebEnabled' | 'whatsappEnabled' | 'aiEnabled' | 'trialProduct'>
    >
  ): Observable<ClientPlatformAccess> {
    return this.http.put<ClientPlatformAccess>(
      `/api/platform/businesses/${businessId}/platform-access`,
      payload
    );
  }

  getBusinessPayments(businessId: string): Observable<SubscriptionPayment[]> {
    return this.http.get<SubscriptionPayment[]>(
      `/api/platform/businesses/${businessId}/payments`
    );
  }

  getSubscriptionHistory(businessId: string): Observable<SubscriptionHistoryEntry[]> {
    return this.http.get<SubscriptionHistoryEntry[]>(
      `/api/platform/businesses/${businessId}/subscription-history`
    );
  }

  getTrials(
    status: 'active' | 'expiring' | 'expired' | 'all' = 'active',
    source?: string
  ): Observable<PlatformTrialRow[]> {
    const params = new URLSearchParams({ status });
    if (source) params.set('source', source);
    return this.http.get<PlatformTrialRow[]>(`/api/platform/trials?${params}`);
  }

  getPendingTrialRegistrations(): Observable<PlatformPendingTrialRegistration[]> {
    return this.http
      .get<{ registrations: PlatformPendingTrialRegistration[] }>(
        '/api/platform/trial-registrations/pending'
      )
      .pipe(map((res) => res.registrations ?? []));
  }

  releaseTrialContactClaim(
    type: 'email' | 'phone',
    value: string,
    options?: { force?: boolean }
  ): Observable<{
    ok: boolean;
    released: boolean;
    wasBoundToBusinessId: string | null;
    type: string;
    value: string;
  }> {
    const encoded = encodeURIComponent(value.trim().toLowerCase());
    const force = options?.force ? '?force=1' : '';
    return this.http.delete<{
      ok: boolean;
      released: boolean;
      wasBoundToBusinessId: string | null;
      type: string;
      value: string;
    }>(`/api/platform/trial-contact-claims/${type}/${encoded}${force}`);
  }

  getBusinessUsers(
    businessId: string,
    options?: { includeInactive?: boolean }
  ): Observable<
    Array<{
      id: string;
      nombre: string;
      email: string;
      loginUsername?: string;
      rol: string;
      permisos?: string[];
      activo: boolean;
      hasPassword?: boolean;
      hasGoogle?: boolean;
    }>
  > {
    const params = options?.includeInactive ? '?includeInactive=1' : '';
    return this.http.get(`/api/platform/businesses/${businessId}/users${params}`);
  }

  createBusinessUser(
    businessId: string,
    payload: {
      nombre: string;
      email?: string;
      loginUsername?: string;
      password?: string;
      rol: 'supervisor' | 'admin' | 'staff';
      activo?: boolean;
      permisos?: string[];
    }
  ): Observable<{
    id: string;
    nombre: string;
    email: string;
    rol: string;
    activo: boolean;
  }> {
    return this.http.post(`/api/platform/businesses/${businessId}/users`, payload);
  }

  updateBusinessUser(
    businessId: string,
    userId: string,
    payload: Partial<{
      nombre: string;
      email: string;
      loginUsername: string;
      password: string;
      rol: 'supervisor' | 'admin' | 'staff';
      activo: boolean;
      permisos: string[];
    }>
  ): Observable<{
    id: string;
    nombre: string;
    email: string;
    rol: string;
    activo: boolean;
  }> {
    return this.http.patch(`/api/platform/businesses/${businessId}/users/${userId}`, payload);
  }

  deleteBusinessUser(businessId: string, userId: string): Observable<{ id: string; ok: boolean }> {
    return this.http.delete(`/api/platform/businesses/${businessId}/users/${userId}`);
  }

  getWhatsappUsers(businessId: string): Observable<{
    users: PlatformWhatsappUser[];
    enabledCount: number;
  }> {
    return this.http.get(`/api/platform/businesses/${businessId}/whatsapp-users`);
  }

  addWhatsappUser(
    businessId: string,
    payload: {
      phone: string;
      name: string;
      role?: string;
      enabled?: boolean;
      erpUserId?: string | null;
    }
  ): Observable<PlatformWhatsappUser> {
    return this.http.post(`/api/platform/businesses/${businessId}/whatsapp-users`, payload);
  }

  updateWhatsappUser(
    businessId: string,
    userId: string,
    payload: Partial<{
      phone: string;
      name: string;
      role: string;
      enabled: boolean;
      erpUserId: string | null;
    }>
  ): Observable<PlatformWhatsappUser> {
    return this.http.patch(
      `/api/platform/businesses/${businessId}/whatsapp-users/${userId}`,
      payload
    );
  }

  deleteWhatsappUser(businessId: string, userId: string): Observable<{ ok: boolean }> {
    return this.http.delete(`/api/platform/businesses/${businessId}/whatsapp-users/${userId}`);
  }

  registerBusinessPayment(
    businessId: string,
    payload: RegisterSubscriptionPaymentPayload
  ): Observable<SubscriptionPayment> {
    return this.http.post<SubscriptionPayment>(
      `/api/platform/businesses/${businessId}/payments`,
      payload
    );
  }

  simulateWhatsappMessage(payload: {
    businessId: string;
    message: string;
    phone?: string;
  }): Observable<{
    result: { reply: string; intent: string; executed: boolean; businessId?: string };
    platformAccess: ClientPlatformAccess;
  }> {
    return this.http.post<{
      result: { reply: string; intent: string; executed: boolean; businessId?: string };
      platformAccess: ClientPlatformAccess;
    }>('/api/platform/bot/simulate', payload);
  }
}

export interface PlatformWhatsappUser {
  id: string;
  phone: string;
  name: string;
  role: 'supervisor' | 'admin' | 'operador';
  enabled: boolean;
  erpUserId: string | null;
}

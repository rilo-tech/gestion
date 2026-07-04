import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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

export type SubscriptionStatus = 'activa' | 'suspendida' | 'vencida';

export interface CreateBusinessPayload {
  id: string;
  nombre: string;
  planId: string;
  enPrueba?: boolean;
  trialStartDate?: string;
  trialEndDate?: string;
  suscripcion?: BusinessSubscriptionInfo;
  supervisor: {
    nombre: string;
    email?: string;
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
}

@Injectable({
  providedIn: 'root',
})
export class PlatformService {
  private http = inject(HttpClient);

  getModuleCatalog(): Observable<SubscriptionModuleMeta[]> {
    return this.http.get<SubscriptionModuleMeta[]>('/api/platform/modules');
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

  registerBusinessPayment(
    businessId: string,
    payload: RegisterSubscriptionPaymentPayload
  ): Observable<SubscriptionPayment> {
    return this.http.post<SubscriptionPayment>(
      `/api/platform/businesses/${businessId}/payments`,
      payload
    );
  }
}

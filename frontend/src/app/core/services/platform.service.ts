import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PublicBusinessInfo, PublicPlanInfo } from './business.service';

export type SubscriptionStatus = 'activa' | 'suspendida' | 'vencida';

export interface CreateBusinessPayload {
  id: string;
  nombre: string;
  planId: string;
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
}

export interface CreatePlanPayload {
  id: string;
  nombre: string;
  limiteAdministradores: number;
  limiteOperadores: number;
  limiteUsuariosTotal?: number;
  activo?: boolean;
}

export interface UpdatePlanPayload {
  nombre?: string;
  limiteAdministradores?: number;
  limiteOperadores?: number;
  limiteUsuariosTotal?: number;
  activo?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PlatformService {
  private http = inject(HttpClient);

  getPlans(): Observable<PublicPlanInfo[]> {
    return this.http.get<PublicPlanInfo[]>('/api/platform/plans');
  }

  createPlan(payload: CreatePlanPayload): Observable<PublicPlanInfo> {
    return this.http.post<PublicPlanInfo>('/api/platform/plans', payload);
  }

  updatePlan(planId: string, payload: UpdatePlanPayload): Observable<PublicPlanInfo> {
    return this.http.patch<PublicPlanInfo>(`/api/platform/plans/${planId}`, payload);
  }

  getBusinesses(): Observable<PublicBusinessInfo[]> {
    return this.http.get<PublicBusinessInfo[]>('/api/platform/businesses');
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
}

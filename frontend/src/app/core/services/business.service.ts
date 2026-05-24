import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type SubscriptionStatus = 'activa' | 'suspendida' | 'vencida';

export interface PublicPlanInfo {
  id: string;
  nombre: string;
  limiteAdministradores: number;
  limiteOperadores: number;
  limiteUsuariosTotal: number;
  activo: boolean;
}

export interface PublicBusinessInfo {
  id: string;
  nombre: string;
  planId: string;
  plan: PublicPlanInfo;
  estadoSuscripcion: SubscriptionStatus;
  administradoresActivos: number;
  operadoresActivos: number;
  usuariosActivos: number;
  administradoresDisponibles: number;
  operadoresDisponibles: number;
  usuariosDisponibles: number;
}

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  activa: 'Activa',
  suspendida: 'Suspendida',
  vencida: 'Vencida',
};

@Injectable({
  providedIn: 'root',
})
export class BusinessService {
  private http = inject(HttpClient);

  getBusinessInfo(businessId: string): Observable<PublicBusinessInfo> {
    return this.http.get<PublicBusinessInfo>(`/api/business/${businessId}`);
  }
}

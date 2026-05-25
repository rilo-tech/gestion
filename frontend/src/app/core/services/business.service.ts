import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type SubscriptionStatus = 'activa' | 'suspendida' | 'vencida';
export type SubscriptionPaymentStatus = 'al_dia' | 'pendiente' | 'vencido';

export interface PublicPlanInfo {
  id: string;
  nombre: string;
  limiteAdministradores: number;
  limiteOperadores: number;
  limiteUsuariosTotal: number;
  precioMensual: number;
  activo: boolean;
}

export interface SubscriptionPayment {
  id: string;
  periodo: string;
  monto: number;
  fechaPago: string;
  notas?: string;
  createdAt?: string;
}

export interface PublicBusinessInfo {
  id: string;
  nombre: string;
  planId: string;
  plan: PublicPlanInfo;
  estadoSuscripcion: SubscriptionStatus;
  estadoPago: SubscriptionPaymentStatus;
  periodoPagoActual: string;
  montoMensualEsperado: number;
  ultimoPagoPeriodo?: string;
  ultimoPagoFecha?: string;
  ultimoPagoMonto?: number;
  createdAt?: string;
  administradoresActivos: number;
  operadoresActivos: number;
  usuariosActivos: number;
  administradoresDisponibles: number;
  operadoresDisponibles: number;
  usuariosDisponibles: number;
}

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  activa: 'Activa',
  suspendida: 'Desactivada',
  vencida: 'Vencida',
};

export const SUBSCRIPTION_PAYMENT_STATUS_LABELS: Record<SubscriptionPaymentStatus, string> = {
  al_dia: 'Al día',
  pendiente: 'Pendiente',
  vencido: 'Vencido',
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

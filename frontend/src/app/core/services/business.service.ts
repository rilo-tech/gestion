import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  ModuleOverrideState,
  MonthlyFeeBreakdown,
  SubscriptionModuleId,
  SubscriptionModulesMap,
} from '../../../../../shared/subscription-modules.ts';
import type {
  TrialContactVerification,
  TrialLifecycle,
} from '../../../../../shared/trial-registration.ts';
import type { ClientPlatformAccess } from '../../../../../shared/platform-access.ts';

export type SubscriptionStatus = 'activa' | 'suspendida' | 'vencida';
export type SubscriptionPaymentStatus = 'al_dia' | 'pendiente' | 'vencido';

export interface PublicPlanInfo {
  id: string;
  nombre: string;
  limiteAdministradores: number;
  limiteOperadores: number;
  limiteUsuariosTotal: number;
  precioMensual: number;
  precioBaseMensual: number;
  precioPorAdministrador: number;
  precioPorOperador: number;
  modulosIncluidos: SubscriptionModulesMap;
  preciosAddonModulo: Partial<Record<SubscriptionModuleId, number>>;
  maxAmbitosCaja: number;
  activo: boolean;
}

export interface BusinessSubscriptionInfo {
  limiteAdministradores?: number | null;
  limiteOperadores?: number | null;
  limiteUsuariosTotal?: number | null;
  maxAmbitosCaja?: number | null;
  modulosOverride?: Partial<Record<SubscriptionModuleId, ModuleOverrideState>>;
  precioBaseOverride?: number | null;
  precioPorAdministradorOverride?: number | null;
  precioPorOperadorOverride?: number | null;
  preciosAddonModuloOverride?: Partial<Record<SubscriptionModuleId, number>>;
  descuentoMensual?: number;
  notasComerciales?: string;
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
  cuotaDesglose?: MonthlyFeeBreakdown;
  entitlements?: SubscriptionModulesMap;
  modulosOverride?: Partial<Record<SubscriptionModuleId, ModuleOverrideState>>;
  limitesEfectivos?: {
    limiteAdministradores: number;
    limiteOperadores: number;
    limiteUsuariosTotal: number;
    maxAmbitosCaja: number;
  };
  suscripcion?: BusinessSubscriptionInfo;
  ultimoPagoPeriodo?: string;
  ultimoPagoFecha?: string;
  ultimoPagoMonto?: number;
  enPrueba: boolean;
  trialStartDate?: string | null;
  trialEndDate?: string | null;
  trialStatus?: 'active' | 'expired' | 'converted' | 'cancelled' | null;
  trialDaysRemaining?: number | null;
  trialExpiringSoon?: boolean;
  trialBillingActive?: boolean;
  createdAt?: string;
  administradoresActivos: number;
  operadoresActivos: number;
  usuariosActivos: number;
  administradoresDisponibles: number;
  operadoresDisponibles: number;
  usuariosDisponibles: number;
  contactVerification?: TrialContactVerification | null;
  lifecycle?: TrialLifecycle | null;
  source?: string | null;
  platformAccess?: ClientPlatformAccess;
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

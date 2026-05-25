import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export type PayableTipo = 'unico' | 'mensual';
export type PayableDisplayEstado = 'pendiente' | 'pagada' | 'vencida';

export interface PayableObligation {
  id: string;
  beneficiario: string;
  monto: number;
  tipo: PayableTipo;
  cantidadCuotas: number;
  fechaPrimerVencimiento: string;
  activo: boolean;
  ambito?: string;
  notas?: string;
  createdAt?: string;
}

export interface PayableInstallment {
  id: string;
  obligacionId: string;
  beneficiario: string;
  numeroCuota: number;
  fechaVencimiento: string;
  monto: number;
  estado: 'pendiente' | 'pagada';
  fechaPago?: string;
  tipo: PayableTipo;
  ambito?: string;
  displayEstado: PayableDisplayEstado;
}

export interface CreatePayableObligationPayload {
  beneficiario: string;
  monto: number;
  tipo: PayableTipo;
  cantidadCuotas: number;
  fechaPrimerVencimiento: string;
  ambito?: string;
  notas?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PayablesService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getInstallments(): Observable<PayableInstallment[]> {
    return this.http.get<PayableInstallment[]>(
      `/api/payables/${this.businessId}/installments`
    );
  }

  getObligations(): Observable<PayableObligation[]> {
    return this.http.get<PayableObligation[]>(
      `/api/payables/${this.businessId}/obligations`
    );
  }

  createObligation(payload: CreatePayableObligationPayload): Observable<{
    obligation: PayableObligation;
    cuotasCreated: number;
  }> {
    return this.http.post(`/api/payables/${this.businessId}/obligations`, payload);
  }

  setInstallmentPaid(cuotaId: string, paid: boolean): Observable<PayableInstallment> {
    return this.http.patch<PayableInstallment>(
      `/api/payables/${this.businessId}/installments/${cuotaId}/paid`,
      { paid }
    );
  }

  setObligationActive(obligacionId: string, activo: boolean): Observable<PayableObligation> {
    return this.http.patch<PayableObligation>(
      `/api/payables/${this.businessId}/obligations/${obligacionId}/active`,
      { activo }
    );
  }

  deleteObligation(obligacionId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `/api/payables/${this.businessId}/obligations/${obligacionId}`
    );
  }
}

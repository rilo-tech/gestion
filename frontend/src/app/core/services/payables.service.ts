import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export type PayableTipo = 'unico' | 'mensual';
export type PayableDisplayEstado = 'pendiente' | 'pagada' | 'vencida';
export type PayableOrigenTipo = 'manual' | 'compra' | 'tarjeta' | 'prestamo';

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
  categoriaId?: string;
  medioPagoId?: string;
  createdAt?: string;
  origenTipo?: PayableOrigenTipo;
  compraId?: string;
  compraLabel?: string;
  tarjetaId?: string;
  tarjetaLabel?: string;
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
  origenTipo?: PayableOrigenTipo;
  compraId?: string;
  compraLabel?: string;
  tarjetaId?: string;
  tarjetaLabel?: string;
  descripcion?: string;
  cuotaTotal?: number;
  movimientoCajaId?: string;
  medioPagoId?: string;
}

export interface CardStatementSummary {
  tarjetaId: string;
  tarjetaLabel: string;
  medioPagoId: string;
  medioPagoLabel: string;
  mes: string;
  ambito: string;
  cuotaIds: string[];
  total: number;
  cuotasCount: number;
}

export interface PayCardStatementPayload {
  tarjetaId: string;
  mes: string;
  medioPagoId: string;
  ambito?: string;
  notas?: string;
  montoPago?: number;
}

export interface CreatePayableObligationPayload {
  beneficiario: string;
  monto: number;
  tipo: PayableTipo;
  cantidadCuotas: number;
  fechaPrimerVencimiento: string;
  ambito?: string;
  notas?: string;
  categoriaId?: string;
  origenTipo?: PayableOrigenTipo;
  medioPagoId?: string;
  tarjetaId?: string;
  tarjetaLabel?: string;
}

export interface CreatePayableLoanPayload {
  beneficiario: string;
  montoCuota: number;
  cantidadCuotas: number;
  fechaPrimerVencimiento: string;
  ambito?: string;
  notas?: string;
  categoriaId?: string;
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

  getObligation(obligacionId: string): Observable<PayableObligation> {
    return this.http.get<PayableObligation>(
      `/api/payables/${this.businessId}/obligations/${obligacionId}`
    );
  }

  getCardStatements(mes?: string): Observable<CardStatementSummary[]> {
    const params: Record<string, string> = {};
    if (mes) params.mes = mes;
    return this.http.get<CardStatementSummary[]>(
      `/api/payables/${this.businessId}/card-statements`,
      { params }
    );
  }

  payCardStatement(payload: PayCardStatementPayload): Observable<{
    cuotasPagadas: number;
    cuotasParciales: number;
    total: number;
    saldoPendiente: number;
    movimientoCajaIds: string[];
  }> {
    return this.http.post(`/api/payables/${this.businessId}/card-statements/pay`, payload);
  }

  createObligation(payload: CreatePayableObligationPayload): Observable<{
    obligation: PayableObligation;
    cuotasCreated: number;
  }> {
    return this.http.post(`/api/payables/${this.businessId}/obligations`, payload);
  }

  updateObligation(
    obligacionId: string,
    payload: CreatePayableObligationPayload
  ): Observable<{
    obligation: PayableObligation;
    cuotasCreated: number;
  }> {
    return this.http.put(
      `/api/payables/${this.businessId}/obligations/${obligacionId}`,
      payload
    );
  }

  createLoan(payload: CreatePayableLoanPayload): Observable<{
    obligation: PayableObligation;
    cuotasCreated: number;
  }> {
    return this.createObligation({
      beneficiario: payload.beneficiario,
      monto: payload.montoCuota,
      tipo: 'unico',
      cantidadCuotas: payload.cantidadCuotas,
      fechaPrimerVencimiento: payload.fechaPrimerVencimiento,
      ambito: payload.ambito,
      notas: payload.notas,
      categoriaId: payload.categoriaId,
      origenTipo: 'prestamo',
    });
  }

  setInstallmentPaid(
    cuotaId: string,
    paid: boolean,
    medioPagoId?: string,
    options?: { montoPago?: number; concepto?: string }
  ): Observable<PayableInstallment> {
    return this.http.patch<PayableInstallment>(
      `/api/payables/${this.businessId}/installments/${cuotaId}/paid`,
      {
        paid,
        ...(medioPagoId ? { medioPagoId } : {}),
        ...(options?.montoPago != null ? { montoPago: options.montoPago } : {}),
        ...(options?.concepto != null ? { concepto: options.concepto } : {}),
      }
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

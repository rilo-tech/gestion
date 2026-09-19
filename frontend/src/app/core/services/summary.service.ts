import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export type ResumenHoyDto = {
  ventasHoy: number;
  cobradoHoy: number;
  cajaSaldo: number;
  pedidosAbiertos: number;
  paraHoy: number;
  porCobrar: number;
  pagosProximosCount: number;
  pagosProximosMonto: number;
};

export type ResumenActivityItem = {
  at: string;
  kind: string;
  label: string;
  amount?: number;
  entityId?: string;
};

export type ResumenOrderItem = {
  id: string;
  label: string;
  clientName: string;
  fechaEntrega: string | null;
  estadoId: string;
  estadoLabel: string;
  total: number;
  saldo: number;
  whatsappPrefill: string;
};

export type ResumenClientBalance = {
  id: string;
  name: string;
  balance: number;
};

export type ResumenCashDto = {
  ingresosHoy: number;
  egresosHoy: number;
  saldo: number;
};

export type ResumenPayableItem = {
  id: string;
  beneficiario: string;
  fechaVencimiento: string;
  monto: number;
  displayEstado: string;
};

@Injectable({
  providedIn: 'root',
})
export class SummaryService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getHoy(): Observable<ResumenHoyDto> {
    return this.http.get<ResumenHoyDto>(`/api/summary/${this.businessId}/hoy`);
  }

  getActivity(limit = 20): Observable<ResumenActivityItem[]> {
    return this.http.get<ResumenActivityItem[]>(`/api/summary/${this.businessId}/activity`, {
      params: { limit: String(limit) },
    });
  }

  getOrders(): Observable<ResumenOrderItem[]> {
    return this.http.get<ResumenOrderItem[]>(`/api/summary/${this.businessId}/orders`);
  }

  getBalances(): Observable<ResumenClientBalance[]> {
    return this.http.get<ResumenClientBalance[]>(`/api/summary/${this.businessId}/balances`);
  }

  getCash(): Observable<ResumenCashDto> {
    return this.http.get<ResumenCashDto>(`/api/summary/${this.businessId}/cash`);
  }

  getPayables(): Observable<ResumenPayableItem[]> {
    return this.http.get<ResumenPayableItem[]>(`/api/summary/${this.businessId}/payables`);
  }
}

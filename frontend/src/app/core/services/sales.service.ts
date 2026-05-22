import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SaleLine {
  stockItemId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface Sale {
  id?: string;
  ventaLabel?: string;
  origen: 'mostrador' | 'pedido';
  pedidoId?: string | null;
  numeroPedidoLabel?: string | null;
  pedidoDescripcion?: string | null;
  clienteId?: string | null;
  clienteNombre?: string;
  items: SaleLine[];
  total: number;
  totalPagadoAnterior?: number;
  montoCobrado: number;
  saldoPendiente: number;
  medioPago?: string;
  notas?: string;
  fecha: string;
  movimientoCajaId?: string;
}

export interface EligibleOrderForSale {
  id: string;
  clienteId?: string;
  clienteNombre?: string;
  estado?: string;
  descripcion?: string;
  total: number;
  totalPagadoAnterior: number;
  saldoPedido: number;
  numeroPedido?: number;
  numeroPedidoLabel?: string;
  items: SaleLine[];
}

export interface CompromisoPagoPayload {
  cantidadCuotas: number;
  fechaPrimerVencimiento: string;
  notas?: string;
}

export interface CreateSalePayload {
  origen: 'mostrador' | 'pedido';
  pedidoId?: string;
  clienteId?: string;
  items?: Array<{
    stockItemId: string;
    nombre?: string;
    cantidad: number;
    precioUnitario: number;
  }>;
  montoCobrado?: number;
  medioPago?: string;
  notas?: string;
  compromisoPago?: CompromisoPagoPayload;
}

@Injectable({
  providedIn: 'root',
})
export class SalesService {
  private http = inject(HttpClient);
  private businessId = 'rilo-default';

  getSales(): Observable<Sale[]> {
    return this.http.get<Sale[]>(`/api/sales/${this.businessId}`);
  }

  getEligibleOrders(params?: {
    clienteId?: string;
    q?: string;
  }): Observable<EligibleOrderForSale[]> {
    const query = new URLSearchParams();
    if (params?.clienteId) query.set('clienteId', params.clienteId);
    if (params?.q?.trim()) query.set('q', params.q.trim());
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.http.get<EligibleOrderForSale[]>(
      `/api/sales/${this.businessId}/eligible-orders${suffix}`
    );
  }

  createSale(payload: CreateSalePayload): Observable<{
    id: string;
    ventaLabel: string;
    total: number;
    montoCobrado: number;
    saldoPendiente: number;
    pedidoId?: string;
    totalPagadoAnterior?: number;
  }> {
    return this.http.post<{
      id: string;
      ventaLabel: string;
      total: number;
      montoCobrado: number;
      saldoPendiente: number;
      pedidoId?: string;
      totalPagadoAnterior?: number;
    }>(`/api/sales/${this.businessId}`, payload);
  }
}

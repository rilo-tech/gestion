import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SaleLineExtraCost {
  nombre: string;
  costo: number;
}

export interface SaleLine {
  stockItemId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  costoUnitario?: number;
  costoPersonalizacion?: number;
  costosExtra?: SaleLineExtraCost[];
}

export interface Sale {
  id?: string;
  numeroVenta?: number;
  ventaLabel?: string;
  origen: 'mostrador' | 'pedido';
  pedidoId?: string | null;
  numeroPedidoLabel?: string | null;
  pedidoDescripcion?: string | null;
  clienteId?: string | null;
  clienteNombre?: string;
  items: SaleLine[];
  total: number;
  costoReal?: number;
  gananciaEstimada?: number;
  totalPagadoAnterior?: number;
  montoCobrado: number;
  saldoPendiente: number;
  medioPago?: string;
  notas?: string;
  fecha: string;
  movimientoCajaId?: string;
  cobros?: Array<{
    id: string;
    monto: number;
    fecha: string;
    medioPago?: string;
    notas?: string;
    movimientoCajaId?: string;
  }>;
}

export function formatSaleLabel(sale: Pick<Sale, 'numeroVenta' | 'ventaLabel'>): string {
  if (sale.ventaLabel) return sale.ventaLabel;
  if (sale.numeroVenta) return String(sale.numeroVenta).padStart(5, '0');
  return '—';
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
  costoReal?: number;
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
    costoUnitario?: number;
    costoPersonalizacion?: number;
    costosExtra?: SaleLineExtraCost[];
  }>;
  montoCobrado?: number;
  medioPago?: string;
  notas?: string;
  compromisoPago?: CompromisoPagoPayload;
}

export interface UpdateSalePayload {
  clienteId?: string;
  items?: Array<{
    stockItemId: string;
    nombre?: string;
    cantidad: number;
    precioUnitario: number;
    costoUnitario?: number;
    costoPersonalizacion?: number;
    costosExtra?: SaleLineExtraCost[];
  }>;
  montoCobrado?: number;
  medioPago?: string;
  notas?: string;
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

  getSale(ventaId: string): Observable<Sale> {
    return this.http.get<Sale>(`/api/sales/${this.businessId}/${ventaId}`);
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

  updateSale(
    ventaId: string,
    payload: UpdateSalePayload
  ): Observable<{
    id: string;
    ventaLabel: string;
    total: number;
    montoCobrado: number;
    saldoPendiente: number;
  }> {
    return this.http.patch<{
      id: string;
      ventaLabel: string;
      total: number;
      montoCobrado: number;
      saldoPendiente: number;
    }>(`/api/sales/${this.businessId}/${ventaId}`, payload);
  }

  deleteSale(ventaId: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`/api/sales/${this.businessId}/${ventaId}`);
  }

  collectSaleBalance(
    ventaId: string,
    payload: { monto: number; medioPago?: string; notas?: string }
  ): Observable<{
    id: string;
    ventaLabel: string;
    montoCobrado: number;
    saldoPendiente: number;
    movimientoCajaId: string;
  }> {
    return this.http.post<{
      id: string;
      ventaLabel: string;
      montoCobrado: number;
      saldoPendiente: number;
      movimientoCajaId: string;
    }>(`/api/sales/${this.businessId}/${ventaId}/cobros`, payload);
  }
}

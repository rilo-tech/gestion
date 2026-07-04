import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';
import type { ComprobanteTipoId, NotaMotivoId } from '../../../../../shared/comprobantes-config.ts';

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
  tipoLinea?: 'producto' | 'concepto';
  descripcion?: string;
  mueveStock?: boolean;
}

export interface Sale {
  id?: string;
  estado?: string;
  numeroVenta?: number;
  ventaLabel?: string;
  origen: 'mostrador' | 'pedido';
  tipoComprobante?: ComprobanteTipoId;
  motivo?: NotaMotivoId | null;
  descripcionMotivo?: string | null;
  comprobanteRelacionadoId?: string | null;
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
  /** Total $0: donación; gananciaEstimada refleja el costo en negativo. */
  esDonacion?: boolean;
  fecha: string;
  movimientoCajaId?: string;
  /** Caja asignada en la venta o en el cobro inicial; null si hay que elegir al cobrar saldo. */
  ambito?: string | null;
  cobros?: Array<{
    id: string;
    monto: number;
    fecha: string;
    medioPago?: string;
    notas?: string;
    movimientoCajaId?: string;
  }>;
}

export function formatSaleLabel(sale: Pick<Sale, 'numeroVenta' | 'ventaLabel' | 'estado'>): string {
  if (sale.estado === 'borrador') return 'Borrador';
  if (sale.ventaLabel && sale.ventaLabel !== 'Borrador') return sale.ventaLabel;
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
    stockItemId?: string;
    nombre?: string;
    descripcion?: string;
    tipoLinea?: 'producto' | 'concepto';
    cantidad: number;
    precioUnitario: number;
    costoUnitario?: number;
    costoPersonalizacion?: number;
    costosExtra?: SaleLineExtraCost[];
    mueveStock?: boolean;
  }>;
  montoCobrado?: number;
  medioPago?: string;
  notas?: string;
  fecha?: string;
  tipoComprobante?: ComprobanteTipoId;
  motivo?: NotaMotivoId | '';
  descripcionMotivo?: string;
  comprobanteRelacionadoId?: string;
  compromisoPago?: CompromisoPagoPayload;
  draft?: boolean;
  ventaId?: string;
}

export interface UpdateSalePayload {
  clienteId?: string;
  items?: Array<{
    stockItemId?: string;
    nombre?: string;
    descripcion?: string;
    tipoLinea?: 'producto' | 'concepto';
    cantidad: number;
    precioUnitario: number;
    costoUnitario?: number;
    costoPersonalizacion?: number;
    costosExtra?: SaleLineExtraCost[];
    mueveStock?: boolean;
  }>;
  montoCobrado?: number;
  medioPago?: string;
  notas?: string;
  fecha?: string;
  tipoComprobante?: ComprobanteTipoId;
  motivo?: NotaMotivoId | '';
  descripcionMotivo?: string;
  comprobanteRelacionadoId?: string;
}

export interface PaginatedSales {
  items: Sale[];
  nextCursor: string | null;
  hasMore: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class SalesService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getSales(): Observable<Sale[]> {
    return this.http.get<Sale[]>(`/api/sales/${this.businessId}`);
  }

  getSalesPage(limit = 120, cursor?: string): Observable<PaginatedSales> {
    const params: Record<string, string> = { paged: '1', limit: String(limit) };
    if (cursor) params.cursor = cursor;
    return this.http.get<PaginatedSales>(`/api/sales/${this.businessId}`, { params });
  }

  getMonthlySummary(mes: number, anio: number): Observable<{
    mes: number;
    anio: number;
    count: number;
    totalFacturado: number;
    totalGanancia: number;
    bonificacionOfertas?: number;
    donacionesCount?: number;
    donacionesCosto?: number;
  }> {
    const params = new URLSearchParams({
      mes: String(mes),
      anio: String(anio),
    });
    return this.http.get<{
      mes: number;
      anio: number;
      count: number;
      totalFacturado: number;
      totalGanancia: number;
      bonificacionOfertas?: number;
      donacionesCount?: number;
      donacionesCosto?: number;
    }>(`/api/sales/${this.businessId}/monthly-summary?${params}`);
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
    payload: { monto: number; medioPago?: string; notas?: string; ambito?: string }
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

  confirmSale(ventaId: string): Observable<{
    id: string;
    ventaLabel: string;
    total: number;
    montoCobrado: number;
    saldoPendiente: number;
  }> {
    return this.http.post<{
      id: string;
      ventaLabel: string;
      total: number;
      montoCobrado: number;
      saldoPendiente: number;
    }>(`/api/sales/${this.businessId}/${ventaId}/confirm`, {});
  }
}

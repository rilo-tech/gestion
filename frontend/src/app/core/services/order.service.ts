import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export interface OrderExtraCost {
  tipo: string;
  nombre: string;
  cantidad: number;
  costoUnitario: number;
  total: number;
}

export interface OrderLineExtraCost {
  nombre: string;
  costo: number;
}

export interface OrderLineItem {
  stockItemId: string;
  nombre: string;
  cantidad: number;
  costoUnitario: number;
  /** Suma de costosExtra; se mantiene por compatibilidad al guardar. */
  costoPersonalizacion?: number;
  costosExtra?: OrderLineExtraCost[];
  precioVenta: number | null;
  /** Enriquecido desde stock al armar el pedido; no se persiste. */
  precioSugerido?: number;
  /** Referencia del catálogo de precios; no se persiste. */
  priceCatalogId?: string;
  /** Enriquecido desde stock al armar el pedido; no se persiste. */
  controlaStock?: boolean;
  stockDisponible?: number;
  cantidadReservada?: number;
  cantidadUsada?: number;
  cantidadFaltante?: number;
  estadoStockItem?: string;
}

export interface OrderPayment {
  id?: string;
  tipo: 'seña' | 'cuota' | 'pago' | 'extra';
  monto: number;
  fecha: string;
  movimientoCajaId?: string;
  notas?: string;
}

export interface Order {
  id?: string;
  clienteId: string;
  estado: string;
  fechaEntrega: string;
  movimientoSeniaId?: string;
  seniaBloqueada?: boolean;
  descripcion: string;
  total: number;
  costoReal: number;
  gananciaEstimada: number;
  margen: number;
  senia: number;
  totalPagado?: number;
  saldo: number;
  pagos?: OrderPayment[];
  stockDescontado?: boolean;
  stockPreparado?: boolean;
  estadoStock?: string;
  numeroPedido?: number;
  numeroPedidoLabel?: string;
  createdAt?: string;
  ventaId?: string;
  entregadoAt?: string;
  items: OrderLineItem[];
  stockItemId?: string;
  cantidad?: number;
  costosExtra?: OrderExtraCost[];
}

export function formatOrderNumber(order: Pick<Order, 'numeroPedido' | 'numeroPedidoLabel'>): string {
  if (order.numeroPedidoLabel) return order.numeroPedidoLabel;
  if (order.numeroPedido) return String(order.numeroPedido).padStart(5, '0');
  return '';
}

export function resolveOrderBalance(
  order: Pick<
    Order,
    'total' | 'senia' | 'totalPagado' | 'pagos' | 'seniaBloqueada' | 'movimientoSeniaId'
  >
): { pagado: number; saldo: number; senia: number } {
  const total = Number(order.total) || 0;
  const pagos = order.pagos ?? [];
  const pagadoFromPagos = pagos
    .filter((pago) => pago.tipo !== 'extra')
    .reduce((sum, pago) => sum + (Number(pago.monto) || 0), 0);
  const seniaFromPagos = pagos
    .filter((pago) => pago.tipo === 'seña')
    .reduce((sum, pago) => sum + (Number(pago.monto) || 0), 0);

  const seniaCollected =
    seniaFromPagos > 0
      ? seniaFromPagos
      : order.seniaBloqueada || order.movimientoSeniaId
        ? Number(order.senia) || 0
        : 0;

  let pagado = 0;
  if (pagadoFromPagos > 0) {
    pagado = pagadoFromPagos;
  } else if (
    order.totalPagado != null &&
    (order.seniaBloqueada || order.movimientoSeniaId || pagos.length > 0)
  ) {
    pagado = Number(order.totalPagado) || 0;
  }

  return {
    pagado,
    saldo: Math.max(0, total - pagado),
    senia: seniaCollected,
  };
}

export function normalizeOrderForPrint(order: Order): Order {
  const balance = resolveOrderBalance(order);
  return {
    ...order,
    senia: balance.senia,
    totalPagado: balance.pagado,
    saldo: balance.saldo,
  };
}

export interface OrderUpdateResult {
  id: string;
  estado?: string;
  pagos?: OrderPayment[];
  totalPagado?: number;
  saldo?: number;
  entregadoAt?: string;
  ventaId?: string;
  ventaLabel?: string;
  deliveryPaymentApplied?: boolean;
  saleCreated?: boolean;
  locked?: boolean;
  items?: OrderLineItem[];
  estadoStock?: string;
  stockPreparado?: boolean;
  stockDescontado?: boolean;
}

export interface OrderStockPreparationLine {
  lineIndex: number;
  stockItemId: string;
  nombre: string;
  cantidadPedida: number;
  cantidadReservada: number;
  cantidadUsada: number;
  cantidadFaltante: number;
  stockReal: number;
  stockReservadoGlobal: number;
  stockDisponible: number;
  sugeridoReservar: number;
  controlaStock: boolean;
}

export interface OrderStockPreparationView {
  orderId: string;
  orderLabel: string;
  estado: string;
  estadoStock: string;
  stockPreparado: boolean;
  lines: OrderStockPreparationLine[];
}

export interface ReservationSourceOrder {
  orderId: string;
  orderLabel: string;
  lineIndex: number;
  cantidadReservada: number;
  cantidadUsada: number;
  cantidadTransferible: number;
}

export interface ReservationTargetOrder {
  orderId: string;
  orderLabel: string;
  lineIndex: number;
  cantidadPendiente: number;
  cantidadRoom: number;
}

export interface StockShortageRow {
  orderId: string;
  orderLabel: string;
  orderEstado: string;
  lineIndex: number;
  stockItemId: string;
  productoNombre: string;
  cantidadPedida: number;
  cantidadReservada: number;
  cantidadUsada: number;
  cantidadFaltante: number;
  esEstimado?: boolean;
}

export interface StockShortageGroup {
  stockItemId: string;
  productoNombre: string;
  faltanteTotal: number;
  pedidos: Array<{ orderId: string; orderLabel: string }>;
  detalle: StockShortageRow[];
}

@Injectable({
  providedIn: 'root',
})
export class OrderService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getOrders(): Observable<Order[]> {
    return this.http.get<Order[]>(`/api/orders/${this.businessId}`);
  }

  getOrder(orderId: string): Observable<Order> {
    return this.http.get<Order>(`/api/orders/${this.businessId}/${orderId}`);
  }

  createOrder(order: Order): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/orders/${this.businessId}`, order);
  }

  updateOrder(orderId: string, order: Partial<Order>): Observable<OrderUpdateResult> {
    return this.http.patch<OrderUpdateResult>(`/api/orders/${this.businessId}/${orderId}`, order);
  }

  updateOrderStatus(orderId: string, status: string): Observable<OrderUpdateResult> {
    return this.http.patch<OrderUpdateResult>(`/api/orders/${this.businessId}/${orderId}`, {
      estado: status,
    });
  }

  deleteOrder(orderId: string): Observable<{ id: string; estado: string }> {
    return this.http.delete<{ id: string; estado: string }>(
      `/api/orders/${this.businessId}/${orderId}`
    );
  }

  addOrderPayment(
    orderId: string,
    payment: { monto: number; tipo?: 'cuota' | 'pago'; allowExtra?: boolean; notas?: string }
  ): Observable<{
    id: string;
    pago: OrderPayment;
    pagos?: OrderPayment[];
    allPagos?: OrderPayment[];
    totalPagado: number;
    saldo: number;
  }> {
    return this.http.post<{
      id: string;
      pago: OrderPayment;
      pagos?: OrderPayment[];
      allPagos?: OrderPayment[];
      totalPagado: number;
      saldo: number;
    }>(`/api/orders/${this.businessId}/${orderId}/pagos`, payment);
  }

  getStockPreparation(orderId: string): Observable<OrderStockPreparationView> {
    return this.http.get<OrderStockPreparationView>(
      `/api/orders/${this.businessId}/${orderId}/stock-preparation`
    );
  }

  confirmStockPreparation(
    orderId: string,
    allocations: Array<{ lineIndex: number; cantidadReservar?: number; cantidadFaltante?: number }>
  ): Observable<{
    id: string;
    items: OrderLineItem[];
    estadoStock: string;
    stockPreparado: boolean;
  }> {
    return this.http.post<{
      id: string;
      items: OrderLineItem[];
      estadoStock: string;
      stockPreparado: boolean;
    }>(`/api/orders/${this.businessId}/${orderId}/stock-preparation`, { allocations });
  }

  transferStockReservation(params: {
    sourceOrderId: string;
    targetOrderId: string;
    stockItemId: string;
    cantidad: number;
    sourceLineIndex?: number;
    targetLineIndex?: number;
  }): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `/api/orders/${this.businessId}/${params.sourceOrderId}/stock-transfer`,
      params
    );
  }

  getReservationSources(stockItemId: string, excludeOrderId?: string): Observable<ReservationSourceOrder[]> {
    const params = new URLSearchParams({ stockItemId });
    if (excludeOrderId) params.set('excludeOrderId', excludeOrderId);
    return this.http.get<ReservationSourceOrder[]>(
      `/api/orders/${this.businessId}/stock-reservation-sources?${params}`
    );
  }

  getReservationTargets(stockItemId: string, sourceOrderId?: string): Observable<ReservationTargetOrder[]> {
    const params = new URLSearchParams({ stockItemId });
    if (sourceOrderId) params.set('sourceOrderId', sourceOrderId);
    return this.http.get<ReservationTargetOrder[]>(
      `/api/orders/${this.businessId}/stock-reservation-targets?${params}`
    );
  }
}

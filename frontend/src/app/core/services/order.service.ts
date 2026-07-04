import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { TenantService } from './tenant.service';

export interface OrderExtraCost {
  tipo: string;
  nombre: string;
  cantidad: number;
  costoUnitario: number;
  total: number;
}

export interface OrderPhoto {
  id: string;
  name: string;
  storagePath?: string;
  contentType?: string;
  url: string;
  createdAt?: string;
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
  permitirStockNegativo?: boolean;
  stockDisponible?: number;
  cantidadReservada?: number;
  cantidadUsada?: number;
  cantidadFaltante?: number;
  estadoStockItem?: string;
}

export interface OrderPayment {
  id?: string;
  tipo: 'seña' | 'cuota' | 'pago';
  monto: number;
  fecha: string;
  movimientoCajaId?: string;
  notas?: string;
}

export interface Order {
  id?: string;
  clienteId: string;
  /** Nombre del cliente resuelto en lectura (evita mostrar el id). */
  clienteNombre?: string;
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
  entregaConSaldo?: boolean;
  /** Total $0: donación; la venta asociada impacta ganancias por el costo. */
  esDonacion?: boolean;
  stockOperaciones?: Array<{ fecha: string; tipo: string; total: number; detalle: string }>;
  items: OrderLineItem[];
  /** Presente en listado API para búsqueda sin traer líneas completas. */
  productoNombres?: string[];
  stockItemId?: string;
  cantidad?: number;
  costosExtra?: OrderExtraCost[];
  /** Fotos de referencia guardadas en Firebase Storage. */
  fotos?: OrderPhoto[];
}

export function formatOrderNumber(order: Pick<Order, 'numeroPedido' | 'numeroPedidoLabel'>): string {
  if (order.numeroPedidoLabel) return order.numeroPedidoLabel;
  if (order.numeroPedido) return String(order.numeroPedido).padStart(5, '0');
  return '';
}

export function coerceOrderLineItems(raw: unknown): OrderLineItem[] {
  if (Array.isArray(raw)) {
    return raw.filter((line) => line && typeof line === 'object') as OrderLineItem[];
  }
  if (raw && typeof raw === 'object') {
    return Object.values(raw as Record<string, OrderLineItem>).filter(
      (line) => line && typeof line === 'object'
    );
  }
  return [];
}

/** Líneas listas para impresión: ítems del pedido o formato legacy de un solo producto. */
export function orderLineItemsForPrint(order: Order): OrderLineItem[] {
  const fromItems = coerceOrderLineItems(order.items);
  if (fromItems.length) return fromItems;

  const stockItemId = String(order.stockItemId ?? '').trim();
  if (!stockItemId) return [];

  return [
    {
      stockItemId,
      nombre: order.productoNombres?.[0]?.trim() || 'Producto',
      cantidad: Number(order.cantidad) || 1,
      costoUnitario: 0,
      precioVenta: Number(order.total) || null,
    },
  ];
}

import {
  resolveOrderBalance as resolveSharedOrderBalance,
  type OrderBalanceInput,
} from '../../../../../shared/order-balance.ts';

export function resolveOrderBalance(
  order: Pick<
    Order,
    'total' | 'senia' | 'totalPagado' | 'pagos' | 'seniaBloqueada' | 'movimientoSeniaId' | 'items'
  > & { items?: OrderBalanceInput['items'] }
): { pagado: number; saldo: number; senia: number; total: number } {
  const balance = resolveSharedOrderBalance(order);
  const pagos = order.pagos ?? [];
  const seniaFromPagos = pagos
    .filter((pago) => pago.tipo === 'seña')
    .reduce((sum, pago) => sum + (Number(pago.monto) || 0), 0);
  const seniaCollected =
    seniaFromPagos > 0
      ? seniaFromPagos
      : order.seniaBloqueada || order.movimientoSeniaId
        ? Number(order.senia) || 0
        : 0;

  return {
    pagado: balance.pagado,
    saldo: balance.saldo,
    total: balance.total,
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
  entregaConSaldo?: boolean;
  items?: OrderLineItem[];
  estadoStock?: string;
  stockPreparado?: boolean;
  stockDescontado?: boolean;
  stockWarning?: string;
  stockOperaciones?: Array<{ fecha: string; tipo: string; total: number; detalle: string }>;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
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
  permitirStockNegativo: boolean;
}

export interface OrderStockPreparationView {
  orderId: string;
  orderLabel: string;
  clienteNombre?: string;
  estado: string;
  estadoStock: string;
  stockPreparado: boolean;
  lines: OrderStockPreparationLine[];
}

export type OrderPhysicalStockScope = 'solo_reservado' | 'pedido_completo';

export interface OrderStockDiscountPreviewLine {
  nombre: string;
  stockItemId: string;
  cantidadPedida: number;
  cantidadReservada: number;
  pendiente: number;
  aDescontarReservado: number;
  aDescontarCompleto: number;
  stockDisponible: number;
  faltante: number;
  controlaStock: boolean;
}

export interface OrderStockDiscountPreview {
  willConsume: boolean;
  nextEstado: string;
  nextEstadoLabel: string;
  defaultScope: OrderPhysicalStockScope;
  canChooseScope: boolean;
  requiresFullStock: boolean;
  blocked: boolean;
  blockReason?: string;
  lines: OrderStockDiscountPreviewLine[];
  totalReservado: number;
  totalCompleto: number;
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

  /**
   * Caché en memoria de pedidos ya vistos (listados o abiertos). Permite que el
   * formulario muestre los datos al instante mientras revalida contra el backend,
   * evitando que los campos queden en blanco unos segundos al entrar al pedido.
   */
  private orderCache = new Map<string, Order>();

  private get businessId(): string {
    return this.tenant.businessId;
  }

  private cacheKey(orderId: string): string {
    return `${this.businessId}/${orderId}`;
  }

  private cacheOrder(order: Order | null | undefined): void {
    if (!order?.id) return;
    this.orderCache.set(this.cacheKey(order.id), order);
  }

  private cacheOrders(orders: Array<Order | null | undefined>): void {
    for (const order of orders) this.cacheOrder(order);
  }

  /** Devuelve el último pedido conocido (sin pegarle al backend), o null. */
  getCachedOrder(orderId: string): Order | null {
    return this.orderCache.get(this.cacheKey(orderId)) ?? null;
  }

  /** Actualiza la caché local tras guardar sin volver a pedir el pedido completo. */
  patchCachedOrder(orderId: string, patch: Partial<Order>): void {
    const cached = this.getCachedOrder(orderId);
    if (!cached) return;
    this.cacheOrder({ ...cached, ...patch, id: orderId });
  }

  getOrders(): Observable<Order[]> {
    return this.http
      .get<Order[]>(`/api/orders/${this.businessId}`)
      .pipe(tap((orders) => this.cacheOrders(orders)));
  }

  getOrdersPage(limit = 120, cursor?: string): Observable<PaginatedResponse<Order>> {
    const params: Record<string, string> = { paged: '1', limit: String(limit) };
    if (cursor) params.cursor = cursor;
    return this.http
      .get<PaginatedResponse<Order>>(`/api/orders/${this.businessId}`, { params })
      .pipe(tap((page) => this.cacheOrders(page?.items ?? [])));
  }

  getOrder(orderId: string, options?: { includePhotoUrls?: boolean }): Observable<Order> {
    let params = new HttpParams();
    if (options?.includePhotoUrls) {
      params = params.set('photoUrls', '1');
    }
    return this.http
      .get<Order>(`/api/orders/${this.businessId}/${orderId}`, { params })
      .pipe(tap((order) => this.cacheOrder(order)));
  }

  createOrder(order: Order): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/orders/${this.businessId}`, order);
  }

  updateOrder(orderId: string, order: Partial<Order>): Observable<OrderUpdateResult> {
    return this.http.patch<OrderUpdateResult>(`/api/orders/${this.businessId}/${orderId}`, order);
  }

  updateOrderStatus(
    orderId: string,
    status: string,
    options?: { descuentoFisicoAlcance?: OrderPhysicalStockScope }
  ): Observable<OrderUpdateResult> {
    return this.http.patch<OrderUpdateResult>(`/api/orders/${this.businessId}/${orderId}`, {
      estado: status,
      ...(options?.descuentoFisicoAlcance
        ? { descuentoFisicoAlcance: options.descuentoFisicoAlcance }
        : {}),
    });
  }

  getStockDiscountPreview(
    orderId: string,
    nextEstado: string
  ): Observable<OrderStockDiscountPreview> {
    return this.http.get<OrderStockDiscountPreview>(
      `/api/orders/${this.businessId}/${orderId}/stock-discount-preview`,
      { params: { nextEstado } }
    );
  }

  deleteOrder(orderId: string): Observable<{ id: string; estado: string }> {
    return this.http
      .delete<{ id: string; estado: string }>(`/api/orders/${this.businessId}/${orderId}`)
      .pipe(tap(() => this.orderCache.delete(this.cacheKey(orderId))));
  }

  addOrderPayment(
    orderId: string,
    payment: { monto: number; notas?: string }
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

  removeOrderPayment(
    orderId: string,
    paymentId: string
  ): Observable<{
    id: string;
    pagos: OrderPayment[];
    totalPagado: number;
    saldo: number;
    seniaBloqueada?: boolean;
    movimientoSeniaId?: string | null;
  }> {
    return this.http
      .delete<{
        id: string;
        pagos: OrderPayment[];
        totalPagado: number;
        saldo: number;
        seniaBloqueada?: boolean;
        movimientoSeniaId?: string | null;
      }>(`/api/orders/${this.businessId}/${orderId}/pagos/${paymentId}`)
      .pipe(tap(() => this.orderCache.delete(this.cacheKey(orderId))));
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
  }): Observable<{
    ok: boolean;
    orderId?: string;
    estadoStock?: string;
    stockPreparado?: boolean;
    lines?: OrderStockPreparationLine[];
  }> {
    return this.http.post<{
      ok: boolean;
      orderId?: string;
      estadoStock?: string;
      stockPreparado?: boolean;
      lines?: OrderStockPreparationLine[];
    }>(
      `/api/orders/${this.businessId}/${params.sourceOrderId}/stock-transfer`,
      params
    );
  }

  consumePendingReservedStock(
    orderId: string,
    lines: Array<{ lineIndex: number; cantidad: number }> = []
  ): Observable<OrderUpdateResult> {
    return this.http.post<OrderUpdateResult>(
      `/api/orders/${this.businessId}/${orderId}/consume-pending-stock`,
      lines.length ? { lines } : {}
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

  uploadOrderPhoto(
    orderId: string,
    payload: { data: string; contentType: string; name: string }
  ): Observable<{ id: string; foto: OrderPhoto; fotos: OrderPhoto[] }> {
    return this.http
      .post<{ id: string; foto: OrderPhoto; fotos: OrderPhoto[] }>(
        `/api/orders/${this.businessId}/${orderId}/fotos`,
        payload
      )
      .pipe(
        tap((result) => {
          const cached = this.getCachedOrder(orderId);
          if (cached) {
            this.cacheOrder({ ...cached, fotos: result.fotos });
          }
        })
      );
  }

  deleteOrderPhoto(orderId: string, photoId: string): Observable<{ id: string; fotos: OrderPhoto[] }> {
    return this.http
      .delete<{ id: string; fotos: OrderPhoto[] }>(
        `/api/orders/${this.businessId}/${orderId}/fotos/${photoId}`
      )
      .pipe(
        tap((result) => {
          const cached = this.getCachedOrder(orderId);
          if (cached) {
            this.cacheOrder({ ...cached, fotos: result.fotos });
          }
        })
      );
  }
}

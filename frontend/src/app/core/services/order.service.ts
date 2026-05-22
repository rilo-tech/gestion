import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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
  precioVenta: number;
  /** Enriquecido desde stock al armar el pedido; no se persiste. */
  controlaStock?: boolean;
  stockDisponible?: number;
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
  numeroPedido?: number;
  numeroPedidoLabel?: string;
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

@Injectable({
  providedIn: 'root',
})
export class OrderService {
  private http = inject(HttpClient);
  private businessId = 'rilo-default';

  getOrders(): Observable<Order[]> {
    return this.http.get<Order[]>(`/api/orders/${this.businessId}`);
  }

  getOrder(orderId: string): Observable<Order> {
    return this.http.get<Order>(`/api/orders/${this.businessId}/${orderId}`);
  }

  createOrder(order: Order): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/orders/${this.businessId}`, order);
  }

  updateOrder(orderId: string, order: Partial<Order>): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(`/api/orders/${this.businessId}/${orderId}`, order);
  }

  updateOrderStatus(orderId: string, status: string): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(`/api/orders/${this.businessId}/${orderId}`, {
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
}

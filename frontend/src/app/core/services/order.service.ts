import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Order {
  id?: string;
  clienteId: string;
  estado: string;
  fechaEntrega: string;
  descripcion: string;
  total: number;
  costoReal: number;
  gananciaEstimada: number;
  margen: number;
  senia: number;
  saldo: number;
  items: any[];
}

@Injectable({
  providedIn: 'root'
})
export class OrderService {
  private http = inject(HttpClient);
  private businessId = 'rilo-default';

  getOrders(): Observable<Order[]> {
    return this.http.get<Order[]>(`/api/orders/${this.businessId}`);
  }

  createOrder(order: Order): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/orders/${this.businessId}`, order);
  }

  updateOrderStatus(orderId: string, status: string): Observable<any> {
    return this.http.patch(`/api/orders/${this.businessId}/${orderId}`, { status });
  }
}

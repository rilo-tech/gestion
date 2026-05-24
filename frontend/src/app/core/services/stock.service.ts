import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export interface StockItem {
  id?: string;
  nombre: string;
  nombreBase?: string;
  tipo: string;
  categoria?: string;
  talle?: string;
  color?: string;
  stockActual: number;
  stockMinimo?: number;
  stockReservado?: number;
  /** Si es false, el pedido puede descontar stock por debajo de cero. Default: true. */
  controlaStock?: boolean;
  costo?: number;
  precioSugerido?: number;
}

export function itemControlsStock(item: Pick<StockItem, 'controlaStock'> | undefined): boolean {
  return item?.controlaStock !== false;
}

export type StockOrigenGrupo = 'compra' | 'pedido' | 'ajuste' | 'carga_inicial' | 'otro';

export interface StockMovement {
  id?: string;
  productoId: string;
  productoNombre?: string | null;
  tipo: 'entrada' | 'salida';
  cantidad: number;
  fecha: string;
  motivo?: string;
  origenId?: string | null;
  origenTipo?: string;
  origenGrupo?: StockOrigenGrupo;
  origenLabel?: string;
  pedidoId?: string | null;
  numeroPedidoLabel?: string | null;
  ventaId?: string | null;
  ventaLabel?: string | null;
  compraId?: string | null;
  negocioId?: string;
}

@Injectable({
  providedIn: 'root'
})
export class StockService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getStock(): Observable<StockItem[]> {
    return this.http.get<StockItem[]>(`/api/stock/${this.businessId}`);
  }

  getMovements(): Observable<StockMovement[]> {
    return this.http.get<StockMovement[]>(`/api/stock/${this.businessId}/movements`);
  }

  searchStock(query: string, limit = 20): Observable<StockItem[]> {
    const params = new URLSearchParams({
      q: query.trim(),
      limit: String(limit),
    });
    return this.http.get<StockItem[]>(`/api/stock/${this.businessId}/search?${params}`);
  }

  getItem(itemId: string): Observable<StockItem> {
    return this.http.get<StockItem>(`/api/stock/${this.businessId}/${itemId}`);
  }

  createItem(item: StockItem): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/stock/${this.businessId}`, item);
  }

  updateItem(itemId: string, item: StockItem): Observable<{ id: string }> {
    return this.http.put<{ id: string }>(`/api/stock/${this.businessId}/${itemId}`, item);
  }

  deleteItem(itemId: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`/api/stock/${this.businessId}/${itemId}`);
  }

  adjustStock(itemId: string, quantity: number, motivo: string): Observable<any> {
    return this.http.patch(`/api/stock/${this.businessId}/${itemId}`, {
      quantity,
      motivo,
      usuarioId: 'admin' // Placeholder
    });
  }
}

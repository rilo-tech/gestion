import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';
import type { StockShortageGroup, StockShortageRow } from './order.service';

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
  /** Si es false, no exige stock físico al reservar. Default: true. */
  controlaStock?: boolean;
  costo?: number;
  precioSugerido?: number;
}

export function itemControlsStock(item: Pick<StockItem, 'controlaStock'> | undefined): boolean {
  return item?.controlaStock !== false;
}

export function itemIsLowStock(
  item: Pick<StockItem, 'stockActual' | 'stockMinimo' | 'stockReservado' | 'controlaStock'> | undefined
): boolean {
  if (!itemControlsStock(item)) return false;
  const disponible = getStockDisponible(item);
  return disponible <= (Number(item?.stockMinimo) || 0);
}

export function getStockDisponible(
  item: Pick<StockItem, 'stockActual' | 'stockReservado'> | undefined
): number {
  return Math.max(0, (Number(item?.stockActual) || 0) - (Number(item?.stockReservado) || 0));
}

export type StockOrigenGrupo = 'compra' | 'pedido' | 'venta' | 'ajuste' | 'carga_inicial' | 'otro' | (string & {});

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
  clienteId?: string | null;
  clienteNombre?: string | null;
  ventaId?: string | null;
  ventaLabel?: string | null;
  compraId?: string | null;
  negocioId?: string;
}

export interface StockReservationRow {
  orderId: string;
  orderLabel: string;
  orderEstado: string;
  clienteId: string;
  clienteNombre: string;
  stockItemId: string;
  productoNombre: string;
  lineIndex: number;
  cantidadReservada: number;
  cantidadUsada: number;
  cantidadActiva: number;
  stockPreparado: boolean;
}

export interface StockReservationGroup {
  stockItemId: string;
  productoNombre: string;
  reservadoTotal: number;
  reservas: StockReservationRow[];
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

  deleteMovement(movementId: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(
      `/api/stock/${this.businessId}/movements/${movementId}`
    );
  }

  adjustStock(itemId: string, quantity: number, motivo: string): Observable<any> {
    return this.http.patch(`/api/stock/${this.businessId}/${itemId}`, {
      quantity,
      motivo,
      usuarioId: 'admin' // Placeholder
    });
  }

  getShortages(): Observable<{ grouped: StockShortageGroup[]; rows: StockShortageRow[] }> {
    return this.http.get<{ grouped: StockShortageGroup[]; rows: StockShortageRow[] }>(
      `/api/stock/${this.businessId}/faltantes`
    );
  }

  getReservations(stockItemId?: string): Observable<{
    rows: StockReservationRow[];
    grouped: StockReservationGroup[];
  }> {
    const params = stockItemId ? `?stockItemId=${encodeURIComponent(stockItemId)}` : '';
    return this.http.get<{ rows: StockReservationRow[]; grouped: StockReservationGroup[] }>(
      `/api/stock/${this.businessId}/reservations${params}`
    );
  }
}

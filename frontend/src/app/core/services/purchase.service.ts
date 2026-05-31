import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';
import type { PurchaseLineTipo } from '../../../../../shared/finance-config.ts';

export interface PurchaseLine {
  id?: string;
  tipoLinea?: PurchaseLineTipo;
  ambito?: string;
  categoriaId?: string;
  categoriaLabel?: string;
  descripcion?: string;
  productoId?: string;
  productoNombre?: string;
  cantidad?: number;
  costoUnitario?: number;
  importe?: number;
  subtotal?: number;
}

export interface Purchase {
  id?: string;
  estado?: string;
  numeroCompra?: number;
  compraLabel?: string;
  proveedorId?: string;
  proveedor?: string;
  notas?: string;
  numeroComprobante?: string;
  items: PurchaseLine[];
  total: number;
  totalNegocio?: number;
  totalPersonal?: number;
  fecha: string;
  negocioId?: string;
  pago?: {
    medioPagoId?: string;
    tarjetaId?: string;
    cuotas?: number;
    fechaPrimerVencimiento?: string;
  };
}

export interface CreatePurchaseLinePayload {
  id?: string;
  tipoLinea?: PurchaseLineTipo;
  ambito?: string;
  categoriaId?: string;
  descripcion?: string;
  productoId?: string;
  productoNombre?: string;
  cantidad?: number;
  costoUnitario?: number;
  importe?: number;
}

export interface CreatePurchasePayload {
  proveedorId?: string;
  proveedor?: string;
  notas?: string;
  numeroComprobante?: string;
  fecha?: string;
  items: CreatePurchaseLinePayload[];
  pago?: {
    medioPagoId: string;
    tarjetaId?: string;
    cuotas?: number;
    fechaPrimerVencimiento?: string;
  };
  draft?: boolean;
  compraId?: string;
}

export interface PaginatedPurchases {
  items: Purchase[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function formatPurchaseLabel(
  purchase: Pick<Purchase, 'numeroCompra' | 'compraLabel' | 'estado' | 'id'>
): string {
  if (purchase.estado === 'borrador') return 'Borrador';
  if (purchase.compraLabel && purchase.compraLabel !== 'Borrador') return purchase.compraLabel;
  if (purchase.numeroCompra) return String(purchase.numeroCompra).padStart(5, '0');
  if (purchase.id) return purchase.id.slice(-6).toUpperCase();
  return '—';
}

@Injectable({
  providedIn: 'root',
})
export class PurchaseService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getPurchases(): Observable<Purchase[]> {
    return this.http.get<Purchase[]>(`/api/purchases/${this.businessId}`);
  }

  getPurchasesPage(limit = 120, cursor?: string): Observable<PaginatedPurchases> {
    const params: Record<string, string> = { paged: '1', limit: String(limit) };
    if (cursor) params.cursor = cursor;
    return this.http.get<PaginatedPurchases>(`/api/purchases/${this.businessId}`, { params });
  }

  getPurchase(compraId: string): Observable<Purchase> {
    return this.http.get<Purchase>(`/api/purchases/${this.businessId}/${compraId}`);
  }

  createPurchase(payload: CreatePurchasePayload): Observable<{ id: string; compraLabel: string; draft?: boolean }> {
    return this.http.post<{ id: string; compraLabel: string; draft?: boolean }>(
      `/api/purchases/${this.businessId}`,
      payload
    );
  }

  confirmPurchase(compraId: string): Observable<{ id: string; compraLabel: string }> {
    return this.http.post<{ id: string; compraLabel: string }>(
      `/api/purchases/${this.businessId}/${compraId}/confirm`,
      {}
    );
  }
}

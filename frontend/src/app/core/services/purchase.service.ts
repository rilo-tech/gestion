import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export interface PurchaseLine {
  productoId: string;
  productoNombre: string;
  cantidad: number;
  costoUnitario: number;
  subtotal: number;
}

export interface Purchase {
  id?: string;
  compraLabel?: string;
  proveedorId?: string;
  proveedor?: string;
  notas?: string;
  items: PurchaseLine[];
  total: number;
  fecha: string;
  negocioId?: string;
}

export interface CreatePurchasePayload {
  proveedorId?: string;
  proveedor?: string;
  notas?: string;
  items: Array<{
    productoId: string;
    productoNombre?: string;
    cantidad: number;
    costoUnitario: number;
  }>;
}

export interface PaginatedPurchases {
  items: Purchase[];
  nextCursor: string | null;
  hasMore: boolean;
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

  createPurchase(payload: CreatePurchasePayload): Observable<{ id: string; compraLabel: string }> {
    return this.http.post<{ id: string; compraLabel: string }>(
      `/api/purchases/${this.businessId}`,
      payload
    );
  }
}

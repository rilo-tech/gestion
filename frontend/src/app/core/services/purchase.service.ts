import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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
  proveedor?: string;
  notas?: string;
  items: PurchaseLine[];
  total: number;
  fecha: string;
  negocioId?: string;
}

export interface CreatePurchasePayload {
  proveedor?: string;
  notas?: string;
  items: Array<{
    productoId: string;
    productoNombre?: string;
    cantidad: number;
    costoUnitario: number;
  }>;
}

@Injectable({
  providedIn: 'root',
})
export class PurchaseService {
  private http = inject(HttpClient);
  private businessId = 'rilo-default';

  getPurchases(): Observable<Purchase[]> {
    return this.http.get<Purchase[]>(`/api/purchases/${this.businessId}`);
  }

  createPurchase(payload: CreatePurchasePayload): Observable<{ id: string; compraLabel: string }> {
    return this.http.post<{ id: string; compraLabel: string }>(
      `/api/purchases/${this.businessId}`,
      payload
    );
  }
}

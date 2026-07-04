import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { TenantService } from './tenant.service';
import type { PurchaseLineTipo } from '../../../../../shared/finance-config.ts';
import type { ComprobanteTipoId } from '../../../../../shared/comprobantes-config.ts';

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
  enOferta?: boolean;
  descuentoOfertaPct?: number;
  ahorroOferta?: number;
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
  tipoComprobante?: ComprobanteTipoId;
  items: PurchaseLine[];
  total: number;
  totalNegocio?: number;
  totalPersonal?: number;
  ahorroOfertaTotal?: number;
  fecha: string;
  negocioId?: string;
  pago?: {
    medioPagoId?: string;
    tarjetaId?: string;
    tarjetaLabel?: string;
    medioPagoLabel?: string;
    displayLabel?: string;
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
  enOferta?: boolean;
  descuentoOfertaPct?: number;
}

export interface CreatePurchasePayload {
  proveedorId?: string;
  proveedor?: string;
  notas?: string;
  numeroComprobante?: string;
  tipoComprobante?: ComprobanteTipoId;
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

/** Número para badge en encabezado de edición (vacío en borrador). */
export function formatPurchaseNumberBadge(
  purchase: Pick<Purchase, 'numeroCompra' | 'compraLabel' | 'estado' | 'id'> | null | undefined
): string {
  if (!purchase || purchase.estado === 'borrador') return '';
  const label = formatPurchaseLabel(purchase);
  return label === 'Borrador' || label === '—' ? '' : label;
}

@Injectable({
  providedIn: 'root',
})
export class PurchaseService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);
  private readonly listChangedSubject = new Subject<void>();

  /** Emite cuando una compra o borrador se crea, actualiza o elimina. */
  readonly listChanged$ = this.listChangedSubject.asObservable();

  notifyListChanged(): void {
    this.listChangedSubject.next();
  }

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

  updatePurchase(
    compraId: string,
    payload: CreatePurchasePayload
  ): Observable<{ id: string; compraLabel: string }> {
    return this.http.put<{ id: string; compraLabel: string }>(
      `/api/purchases/${this.businessId}/${compraId}`,
      payload
    );
  }

  deletePurchase(compraId: string): Observable<{ id: string; compraLabel: string }> {
    return this.http.delete<{ id: string; compraLabel: string }>(
      `/api/purchases/${this.businessId}/${compraId}`
    );
  }

  repairPurchasePayables(compraId: string): Observable<{ cuotasCreated: number }> {
    return this.http.post<{ cuotasCreated: number }>(
      `/api/purchases/${this.businessId}/${compraId}/repair-payables`,
      {}
    );
  }
}

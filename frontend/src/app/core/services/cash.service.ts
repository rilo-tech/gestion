import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export type CashOrigenGrupo = 'pedido' | 'venta' | 'compra' | 'manual' | 'otro' | (string & {});

export type CashAmbito = string;

export interface CashMovement {
  id?: string;
  tipo: 'ingreso' | 'egreso';
  monto: number;
  medio?: string;
  concepto: string;
  /** Detalle opcional del movimiento manual. */
  descripcion?: string | null;
  /** Categoría de gasto (Finanzas) cuando el egreso manual eligió una categoría. */
  categoriaId?: string | null;
  fecha: string;
  ambito?: CashAmbito;
  origenId?: string;
  origenTipo?: string;
  origenGrupo?: CashOrigenGrupo;
  origenLabel?: string;
  pedidoId?: string | null;
  numeroPedido?: number | null;
  numeroPedidoLabel?: string | null;
  ventaId?: string | null;
  ventaLabel?: string | null;
  clienteId?: string | null;
  negocioId?: string;
}

export interface PaginatedCashMovements {
  items: CashMovement[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CashPeriodSummary {
  mes: number;
  anio: number;
  /** Saldo arrastrado del mes anterior + ingresos del período. */
  ingreso: number;
  /** Solo egresos del período. */
  egreso: number;
}

export interface CashAmbitoSummary {
  ingreso: number;
  egreso: number;
  saldo: number;
  periodo?: CashPeriodSummary;
}

export interface CashSummary {
  ingreso: number;
  egreso: number;
  saldo: number;
  periodo?: CashPeriodSummary;
  ambitos: Record<string, CashAmbitoSummary>;
}

@Injectable({
  providedIn: 'root',
})
export class CashService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getMovements(): Observable<CashMovement[]> {
    return this.http.get<CashMovement[]>(`/api/cash/${this.businessId}`);
  }

  getMovementsPage(limit = 120, cursor?: string): Observable<PaginatedCashMovements> {
    const params: Record<string, string> = { paged: '1', limit: String(limit) };
    if (cursor) params.cursor = cursor;
    return this.http.get<PaginatedCashMovements>(`/api/cash/${this.businessId}`, { params });
  }

  getSummary(mes?: number, anio?: number): Observable<CashSummary> {
    const params: Record<string, string> = {};
    if (mes != null) params.mes = String(mes);
    if (anio != null) params.anio = String(anio);
    return this.http.get<CashSummary>(`/api/cash/${this.businessId}/summary`, { params });
  }

  createMovement(
    movement: Omit<CashMovement, 'id' | 'fecha'> & { fecha?: string }
  ): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/cash/${this.businessId}`, movement);
  }

  updateMovement(
    movementId: string,
    movement: Pick<
      CashMovement,
      'tipo' | 'monto' | 'concepto' | 'medio' | 'ambito' | 'descripcion' | 'fecha'
    >
  ): Observable<{ id: string }> {
    return this.http.put<{ id: string }>(
      `/api/cash/${this.businessId}/${movementId}`,
      movement
    );
  }

  deleteMovement(movementId: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(
      `/api/cash/${this.businessId}/${movementId}`
    );
  }
}

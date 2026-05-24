import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export type CashOrigenGrupo = 'pedido' | 'venta' | 'manual' | 'otro';

export interface CashMovement {
  id?: string;
  tipo: 'ingreso' | 'egreso';
  monto: number;
  medio?: string;
  concepto: string;
  fecha: string;
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

  createMovement(movement: Omit<CashMovement, 'id' | 'fecha'>): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/cash/${this.businessId}`, movement);
  }

  updateMovement(
    movementId: string,
    movement: Pick<CashMovement, 'tipo' | 'monto' | 'concepto' | 'medio'>
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

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export type ActivityModule =
  | 'clients'
  | 'suppliers'
  | 'stock'
  | 'purchases'
  | 'orders'
  | 'sales'
  | 'cash'
  | 'payables'
  | 'price_catalog'
  | 'collaborators';

export type ActivityAction = 'create' | 'update' | 'delete' | 'payment' | 'cancel';

export interface ActivityLogEntry {
  id: string;
  module: ActivityModule;
  action: ActivityAction;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  userId: string;
  userNombre: string;
  userRol: string;
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export const ACTIVITY_MODULE_LABELS: Record<ActivityModule, string> = {
  clients: 'Clientes',
  suppliers: 'Proveedores',
  stock: 'Stock',
  purchases: 'Compras',
  orders: 'Pedidos',
  sales: 'Ventas',
  cash: 'Caja',
  payables: 'Cuentas a pagar',
  price_catalog: 'Catálogo de precios',
  collaborators: 'Colaboradores',
};

export const ACTIVITY_ACTION_LABELS: Record<ActivityAction, string> = {
  create: 'Alta',
  update: 'Edición',
  delete: 'Eliminación',
  payment: 'Pago / cobro',
  cancel: 'Anulación',
};

@Injectable({
  providedIn: 'root',
})
export class ActivityService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  getModuleActivity(module: ActivityModule, limit = 10): Observable<ActivityLogEntry[]> {
    return this.getActivity(module, { limit });
  }

  getEntityActivity(
    module: ActivityModule,
    entityId: string,
    limit = 120
  ): Observable<ActivityLogEntry[]> {
    return this.getActivity(module, { entityId, limit });
  }

  private getActivity(
    module: ActivityModule,
    options: { limit?: number; entityId?: string }
  ): Observable<ActivityLogEntry[]> {
    const params: Record<string, string> = { module };
    if (options.limit != null) params['limit'] = String(options.limit);
    if (options.entityId) params['entityId'] = options.entityId;
    return this.http.get<ActivityLogEntry[]>(
      `/api/activity/${this.tenant.businessId}`,
      { params }
    );
  }
}

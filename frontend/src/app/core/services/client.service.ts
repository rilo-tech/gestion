import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of, throwError, EMPTY } from 'rxjs';
import { catchError, expand, map, reduce, shareReplay, tap } from 'rxjs/operators';
import { TenantService } from './tenant.service';

export interface ClientReferenceSummary {
  ventas: boolean;
  pedidos: boolean;
  movimientosCaja: boolean;
  compromisosPago: boolean;
}

export interface ClientDeletionGuard {
  canDelete: boolean;
  references: ClientReferenceSummary;
  message: string | null;
}

export interface Client {
  id?: string;
  nombre: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  redes?: {
    igWeb?: string;
    instagram?: string;
  };
  etiquetas?: string[];
  activo?: boolean;
  saldoPendiente?: number;
  debe?: boolean;
}

export interface ClientCatalogChange {
  type?: 'upsert' | 'remove' | 'invalidate';
  client?: Client;
  removedId?: string;
}

export interface ClientAccountLineItem {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface ClientAccountOrder {
  id: string;
  numeroPedidoLabel?: string;
  descripcion?: string;
  estado?: string;
  total: number;
  totalPagado: number;
  saldo: number;
  ventaId?: string | null;
  fecha?: string | null;
  fechaEntrega?: string | null;
  pagos?: ClientAccountPayment[];
  lineas?: ClientAccountLineItem[];
}

export interface ClientAccountPayment {
  id: string;
  tipo: string;
  monto: number;
  fecha: string;
  notas?: string;
  movimientoCajaId?: string | null;
}

export interface ClientAccountCashMovement {
  id: string;
  tipo: 'ingreso' | 'egreso';
  monto: number;
  fecha: string;
  concepto: string;
  origenTipo: string;
  origenGrupo?: string;
  pedidoId?: string | null;
  ventaId?: string | null;
  ventaLabel?: string | null;
  numeroPedidoLabel?: string | null;
  medio?: string;
}

export interface ClientHistorialPayment {
  id: string;
  fecha: string;
  monto: number;
  concepto: string;
  origenTipo: string;
  pedidoId?: string | null;
  ventaId?: string | null;
  ventaLabel?: string | null;
  numeroPedidoLabel?: string | null;
  medio?: string;
}

export interface ClientAccountSale {
  id: string;
  ventaLabel?: string;
  origen: string;
  pedidoId?: string | null;
  numeroPedidoLabel?: string | null;
  total: number;
  montoCobrado: number;
  saldoPendiente: number;
  fecha?: string | null;
  /** Caja asignada en la venta o en el cobro inicial; null si hay que elegir al cobrar saldo. */
  ambito?: string | null;
  lineas?: ClientAccountLineItem[];
}

export interface ClientAccountCuota {
  compromisoId?: string;
  referenciaLabel?: string;
  cuotaNumero: number;
  monto: number;
  fechaVencimiento: string;
}

export interface ClientAccountCompromiso {
  id: string;
  referenciaLabel?: string;
  montoTotal?: number;
  saldoRestante?: number;
  cantidadCuotas?: number;
  cuotas?: Array<{
    numero: number;
    monto: number;
    fechaVencimiento: string;
    estado: string;
  }>;
  fecha?: string;
}

export interface ClientCollectionAllocation {
  kind: 'pedido' | 'venta';
  id: string;
  label: string;
  monto: number;
  movimientoCajaId: string;
}

export interface ClientAccount {
  cliente: Client;
  saldoTotal: number;
  debe: boolean;
  saldoPedidos: number;
  saldoVentasMostrador: number;
  totalFacturado?: number;
  totalCobrado?: number;
  pedidos: ClientAccountOrder[];
  ventas: ClientAccountSale[];
  compromisos: ClientAccountCompromiso[];
  proximosCobros: ClientAccountCuota[];
  movimientosCaja?: ClientAccountCashMovement[];
  historialPagos?: ClientHistorialPayment[];
}

export interface ProximoCobro {
  compromisoId: string;
  clienteId: string;
  clienteNombre: string;
  referenciaLabel?: string;
  origenTipo?: string;
  cuotaNumero: number;
  monto: number;
  fechaVencimiento: string;
}

export interface PaginatedClients {
  items: Client[];
  nextCursor: string | null;
  hasMore: boolean;
}

const PICKER_PAGE_SIZE = 300;

function toPickerClient(client: Client): Client | null {
  const id = String(client.id ?? '').trim();
  const nombre = String(client.nombre ?? '').trim();
  if (!id || !nombre) return null;
  if (client.activo === false) return null;
  return { id, nombre, activo: true };
}

@Injectable({
  providedIn: 'root',
})
export class ClientService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);
  private readonly clientsChanged = new Subject<ClientCatalogChange | void>();

  /** Emite cuando se crea, edita, activa/desactiva o elimina un cliente. */
  readonly clientsChanged$ = this.clientsChanged.asObservable();

  private pickerCache: Client[] | null = null;
  private pickerCacheBusinessId = '';
  private pickerCacheComplete = false;
  private pickerRequest: Observable<Client[]> | null = null;
  private pickerEpoch = 0;

  private get businessId(): string {
    return this.tenant.businessId;
  }

  notifyClientsChanged(change?: ClientCatalogChange): void {
    if (change?.type === 'upsert' && change.client) {
      this.upsertPickerCache(change.client);
    } else if (change?.type === 'remove' && change.removedId) {
      this.removeFromPickerCache(change.removedId);
    } else {
      this.invalidatePickerCache();
    }
    this.clientsChanged.next(change);
  }

  clearPickerCaches(): void {
    this.invalidatePickerCache();
  }

  /**
   * Clientes activos para buscadores de pedidos/ventas/cobros.
   * Carga el catálogo completo (paginado) y lo cachea hasta el próximo cambio.
   */
  getActiveClientsForPicker(): Observable<Client[]> {
    if (
      this.pickerCache &&
      this.pickerCacheComplete &&
      this.pickerCacheBusinessId === this.businessId
    ) {
      return of(this.pickerCache);
    }

    if (this.pickerRequest && this.pickerCacheBusinessId === this.businessId) {
      return this.pickerRequest;
    }

    const epoch = this.pickerEpoch;
    const seed = [...(this.pickerCache ?? [])];
    this.pickerCacheBusinessId = this.businessId;
    this.pickerRequest = this.loadAllActiveClientsForPicker().pipe(
      map((clients) => {
        const byId = new Map<string, Client>();
        for (const client of [...clients, ...seed]) {
          if (client.id) byId.set(client.id, client);
        }
        return [...byId.values()].sort((a, b) =>
          String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' })
        );
      }),
      tap((clients) => {
        if (epoch !== this.pickerEpoch) return;
        this.pickerCache = clients;
        this.pickerCacheComplete = true;
      }),
      catchError((error) => {
        if (epoch === this.pickerEpoch) {
          this.invalidatePickerCache();
        }
        return throwError(() => error);
      }),
      shareReplay(1)
    );

    return this.pickerRequest;
  }

  private invalidatePickerCache(): void {
    this.pickerEpoch += 1;
    this.pickerCache = null;
    this.pickerCacheBusinessId = '';
    this.pickerCacheComplete = false;
    this.pickerRequest = null;
  }

  private upsertPickerCache(client: Client): void {
    const next = toPickerClient(client);
    const id = String(client.id ?? '').trim();

    if (
      this.pickerCache &&
      this.pickerCacheComplete &&
      this.pickerCacheBusinessId === this.businessId
    ) {
      if (!next?.id) {
        if (id) this.removeFromPickerCache(id);
        return;
      }
      const without = this.pickerCache.filter((row) => row.id !== next.id);
      this.pickerCache = [next, ...without].sort((a, b) =>
        String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' })
      );
      return;
    }

    // Catálogo incompleto o vacío: sembrar el alta e invalidar la carga en curso.
    this.pickerEpoch += 1;
    this.pickerRequest = null;
    this.pickerCacheComplete = false;
    this.pickerCacheBusinessId = this.businessId;
    if (!next?.id) {
      this.pickerCache = null;
      return;
    }
    const existing = (this.pickerCache ?? []).filter((row) => row.id !== next.id);
    this.pickerCache = [next, ...existing];
  }

  private removeFromPickerCache(clientId: string): void {
    if (!this.pickerCache || this.pickerCacheBusinessId !== this.businessId) {
      this.invalidatePickerCache();
      return;
    }
    this.pickerCache = this.pickerCache.filter((row) => row.id !== clientId);
    if (!this.pickerCacheComplete) {
      this.pickerRequest = null;
    }
  }

  private loadAllActiveClientsForPicker(): Observable<Client[]> {
    const loadPage = (cursor?: string): Observable<PaginatedClients> =>
      this.getClientsPage(PICKER_PAGE_SIZE, cursor, { soloActivos: true });

    return loadPage().pipe(
      expand((page) =>
        page.hasMore && page.nextCursor ? loadPage(page.nextCursor) : EMPTY
      ),
      reduce((acc: Client[], page) => {
        for (const item of page.items ?? []) {
          const slim = toPickerClient(item);
          if (slim) acc.push(slim);
        }
        return acc;
      }, []),
      map((clients) => {
        const byId = new Map<string, Client>();
        for (const client of clients) {
          if (client.id) byId.set(client.id, client);
        }
        return [...byId.values()].sort((a, b) =>
          String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' })
        );
      })
    );
  }

  getClients(options?: { soloActivos?: boolean }): Observable<Client[]> {
    const params: Record<string, string> = {};
    if (options?.soloActivos) params.soloActivos = '1';
    return this.http.get<Client[]>(`/api/clients/${this.businessId}`, { params });
  }

  getClientsPage(
    limit = 120,
    cursor?: string,
    options?: { soloActivos?: boolean }
  ): Observable<PaginatedClients> {
    const params: Record<string, string> = { paged: '1', limit: String(limit) };
    if (cursor) params.cursor = cursor;
    if (options?.soloActivos) params.soloActivos = '1';
    return this.http.get<PaginatedClients>(`/api/clients/${this.businessId}`, { params });
  }

  getClient(clientId: string): Observable<Client> {
    return this.http.get<Client>(`/api/clients/${this.businessId}/${clientId}`);
  }

  getClientAccount(clientId: string): Observable<ClientAccount> {
    return this.http.get<ClientAccount>(`/api/clients/${this.businessId}/${clientId}/cuenta`);
  }

  collectClientBalance(
    clientId: string,
    payload: { monto: number; medioPago?: string; notas?: string; ambito?: string }
  ): Observable<{
    monto: number;
    saldoAnterior: number;
    saldoRestante: number;
    allocations: ClientCollectionAllocation[];
  }> {
    return this.http.post<{
      monto: number;
      saldoAnterior: number;
      saldoRestante: number;
      allocations: ClientCollectionAllocation[];
    }>(`/api/clients/${this.businessId}/${clientId}/cobros`, payload);
  }

  getProximosCobros(): Observable<ProximoCobro[]> {
    return this.http.get<ProximoCobro[]>(`/api/clients/${this.businessId}/cobros-proximos`);
  }

  createClient(client: Client): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/clients/${this.businessId}`, client).pipe(
      tap((response) => {
        this.notifyClientsChanged({
          type: 'upsert',
          client: {
            ...client,
            id: response.id,
            activo: client.activo !== false,
          },
        });
      })
    );
  }

  updateClient(clientId: string, client: Client): Observable<{ id: string }> {
    return this.http
      .patch<{ id: string }>(`/api/clients/${this.businessId}/${clientId}`, client)
      .pipe(
        tap(() => {
          this.notifyClientsChanged({
            type: 'upsert',
            client: {
              ...client,
              id: clientId,
              activo: client.activo !== false,
            },
          });
        })
      );
  }

  getClientDeletionGuard(clientId: string): Observable<ClientDeletionGuard> {
    return this.http.get<ClientDeletionGuard>(
      `/api/clients/${this.businessId}/${clientId}/deletion-guard`
    );
  }

  deleteClient(clientId: string): Observable<{ id: string }> {
    return this.http
      .delete<{ id: string }>(`/api/clients/${this.businessId}/${clientId}`)
      .pipe(
        tap(() => {
          this.notifyClientsChanged({ type: 'remove', removedId: clientId });
        })
      );
  }

  setClientActive(clientId: string, activo: boolean): Observable<{ id: string }> {
    return this.http
      .patch<{ id: string }>(`/api/clients/${this.businessId}/${clientId}`, {
        activo,
      })
      .pipe(
        tap(() => {
          if (activo) {
            this.getClient(clientId).subscribe({
              next: (client) => {
                this.notifyClientsChanged({
                  type: 'upsert',
                  client: { ...client, id: clientId, activo: true },
                });
              },
              error: () => this.notifyClientsChanged({ type: 'invalidate' }),
            });
            return;
          }
          this.notifyClientsChanged({ type: 'remove', removedId: clientId });
        })
      );
  }
}

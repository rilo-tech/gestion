import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

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
  saldoPendiente?: number;
  debe?: boolean;
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
  fechaEntrega?: string | null;
  pagos?: ClientAccountPayment[];
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

@Injectable({
  providedIn: 'root',
})
export class ClientService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getClients(): Observable<Client[]> {
    return this.http.get<Client[]>(`/api/clients/${this.businessId}`);
  }

  getClient(clientId: string): Observable<Client> {
    return this.http.get<Client>(`/api/clients/${this.businessId}/${clientId}`);
  }

  getClientAccount(clientId: string): Observable<ClientAccount> {
    return this.http.get<ClientAccount>(`/api/clients/${this.businessId}/${clientId}/cuenta`);
  }

  collectClientBalance(
    clientId: string,
    payload: { monto: number; medioPago?: string; notas?: string }
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
    return this.http.post<{ id: string }>(`/api/clients/${this.businessId}`, client);
  }

  updateClient(clientId: string, client: Client): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(
      `/api/clients/${this.businessId}/${clientId}`,
      client
    );
  }

  deleteClient(clientId: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(
      `/api/clients/${this.businessId}/${clientId}`
    );
  }
}

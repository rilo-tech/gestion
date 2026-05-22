import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Client {
  id?: string;
  nombre: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  redes?: {
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

export interface ClientAccount {
  cliente: Client;
  saldoTotal: number;
  debe: boolean;
  saldoPedidos: number;
  saldoVentasMostrador: number;
  pedidos: ClientAccountOrder[];
  ventas: ClientAccountSale[];
  compromisos: ClientAccountCompromiso[];
  proximosCobros: ClientAccountCuota[];
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
  private businessId = 'rilo-default';

  getClients(): Observable<Client[]> {
    return this.http.get<Client[]>(`/api/clients/${this.businessId}`);
  }

  getClient(clientId: string): Observable<Client> {
    return this.http.get<Client>(`/api/clients/${this.businessId}/${clientId}`);
  }

  getClientAccount(clientId: string): Observable<ClientAccount> {
    return this.http.get<ClientAccount>(`/api/clients/${this.businessId}/${clientId}/cuenta`);
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

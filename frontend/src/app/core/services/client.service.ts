import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Client {
  id?: string;
  nombre: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  etiquetas?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ClientService {
  private http = inject(HttpClient);
  private businessId = 'rilo-default'; // In a real app we'd get this from context

  getClients(): Observable<Client[]> {
    return this.http.get<Client[]>(`/api/clients/${this.businessId}`);
  }

  createClient(client: Client): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/clients/${this.businessId}`, client);
  }
}

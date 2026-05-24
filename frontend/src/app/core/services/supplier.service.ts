import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export interface Supplier {
  id?: string;
  nombre: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  redes?: {
    igWeb?: string;
  };
  etiquetas?: string[];
}

@Injectable({
  providedIn: 'root',
})
export class SupplierService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getSuppliers(): Observable<Supplier[]> {
    return this.http.get<Supplier[]>(`/api/suppliers/${this.businessId}`);
  }

  getSupplier(supplierId: string): Observable<Supplier> {
    return this.http.get<Supplier>(`/api/suppliers/${this.businessId}/${supplierId}`);
  }

  createSupplier(supplier: Supplier): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/suppliers/${this.businessId}`, supplier);
  }

  updateSupplier(supplierId: string, supplier: Supplier): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(
      `/api/suppliers/${this.businessId}/${supplierId}`,
      supplier
    );
  }

  deleteSupplier(supplierId: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(
      `/api/suppliers/${this.businessId}/${supplierId}`
    );
  }
}

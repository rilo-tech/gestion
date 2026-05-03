import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface StockItem {
  id?: string;
  nombre: string;
  tipo: 'producto' | 'insumo';
  stockActual: number;
  stockMinimo?: number;
  costo?: number;
}

@Injectable({
  providedIn: 'root'
})
export class StockService {
  private http = inject(HttpClient);
  private businessId = 'rilo-default';

  getStock(): Observable<StockItem[]> {
    return this.http.get<StockItem[]>(`/api/stock/${this.businessId}`);
  }

  adjustStock(itemId: string, quantity: number, motivo: string): Observable<any> {
    return this.http.patch(`/api/stock/${this.businessId}/${itemId}`, {
      quantity,
      motivo,
      usuarioId: 'admin' // Placeholder
    });
  }
}

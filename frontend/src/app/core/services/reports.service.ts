import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';
import type { CollaboratorsPeriodSummary } from './collaborators.service';

export type ReportGroupBy = 'product' | 'category' | 'type' | 'size' | 'color' | 'client';

export interface ReportQuery {
  from?: string;
  to?: string;
  clienteId?: string;
  productoId?: string;
  categoria?: string;
  tipo?: string;
  talle?: string;
  color?: string;
  groupBy?: ReportGroupBy;
}

export interface ReportGroupRow {
  key: string;
  label: string;
  cantidad: number;
  facturado: number;
  costo: number;
  ganancia: number;
  ventasCount: number;
  stockActual?: number;
  ventaDiariaPromedio?: number;
  stockSugeridoMes?: number;
  faltanteMes?: number;
}

export interface ReportMonthlyRow {
  periodo: string;
  label: string;
  cantidad: number;
  facturado: number;
  costo: number;
  ganancia: number;
  ventasCount: number;
}

export interface ReportInactiveClientRow {
  clienteId: string;
  nombre: string;
  ultimaCompra: string | null;
  diasSinComprar: number | null;
  totalHistorico: number;
  ventasCount: number;
}

export interface ReportResult {
  period: { from: string; to: string; days: number };
  filters: ReportQuery & { groupBy: ReportGroupBy };
  summary: {
    ventasCount: number;
    unidadesVendidas: number;
    facturado: number;
    cobrado: number;
    costo: number;
    ganancia: number;
    ticketPromedio: number;
  };
  groups: ReportGroupRow[];
  monthlyTrend: ReportMonthlyRow[];
  promedioMensual: {
    cantidad: number;
    facturado: number;
    costo: number;
    ganancia: number;
    mesesConDatos: number;
  };
  clientDetail?: {
    clienteId: string;
    clienteNombre: string;
    ventas: Array<{
      id: string;
      fecha: string;
      ventaLabel: string;
      total: number;
      cantidadItems: number;
    }>;
    productos: Array<{
      productoId: string;
      nombre: string;
      cantidad: number;
      facturado: number;
    }>;
  };
  inactiveClients: ReportInactiveClientRow[];
  collaboratorsSummary?: CollaboratorsPeriodSummary;
}

export const REPORT_GROUP_BY_OPTIONS: Array<{ value: ReportGroupBy; label: string }> = [
  { value: 'product', label: 'Producto' },
  { value: 'category', label: 'Categoría' },
  { value: 'type', label: 'Tipo / modelo' },
  { value: 'size', label: 'Talle' },
  { value: 'color', label: 'Color' },
  { value: 'client', label: 'Cliente' },
];

export function defaultReportFromDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().slice(0, 10);
}

export function defaultReportToDate(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  getReport(query: ReportQuery): Observable<ReportResult> {
    let params = new HttpParams();
    const entries = Object.entries(query) as Array<[keyof ReportQuery, string | undefined]>;
    for (const [key, value] of entries) {
      if (value?.trim()) params = params.set(key, value.trim());
    }
    return this.http.get<ReportResult>(`/api/reports/${this.tenant.businessId}`, { params });
  }
}

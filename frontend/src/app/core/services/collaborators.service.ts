import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export type CollaboratorModalidad = 'por_hora' | 'fijo' | 'mixto';
export type CollaboratorPeriodoReferencia = 'semana' | 'quincena' | 'mes';
export type CollaboratorMovementTipo = 'horas' | 'extra' | 'pago';
export type CollaboratorExtraTipo =
  | 'reparto'
  | 'premio'
  | 'aguinaldo'
  | 'bonificacion'
  | 'otro';

export interface Collaborator {
  id?: string;
  nombre: string;
  telefono?: string;
  email?: string;
  notas?: string;
  modalidad: CollaboratorModalidad;
  valorHora?: number;
  montoFijoPeriodo?: number;
  periodoReferencia: CollaboratorPeriodoReferencia;
  activo: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CollaboratorMovement {
  id?: string;
  colaboradorId: string;
  colaboradorNombre?: string;
  tipo: CollaboratorMovementTipo;
  fecha: string;
  horas?: number;
  valorHora?: number;
  extraTipo?: CollaboratorExtraTipo;
  concepto?: string;
  monto: number;
  periodoDesde?: string;
  periodoHasta?: string;
  notas?: string;
  medioPagoId?: string;
  movimientoCajaId?: string;
  createdAt?: string;
}

export interface CollaboratorSummaryRow {
  colaboradorId: string;
  nombre: string;
  activo: boolean;
  horas: number;
  montoHoras: number;
  montoExtras: number;
  devengado: number;
  pagado: number;
  pendientePeriodo: number;
  saldoAcumulado: number;
  movimientosCount: number;
}

export interface CollaboratorsPeriodSummary {
  from: string;
  to: string;
  totalHoras: number;
  totalDevengado: number;
  totalExtras: number;
  totalPagado: number;
  totalPendientePeriodo: number;
  totalSaldoAcumulado: number;
  colaboradores: CollaboratorSummaryRow[];
  extrasPorTipo: Array<{ tipo: string; label: string; monto: number }>;
}

export const MODALIDAD_LABELS: Record<CollaboratorModalidad, string> = {
  por_hora: 'Por hora',
  fijo: 'Monto fijo',
  mixto: 'Hora + extras',
};

export const PERIODO_LABELS: Record<CollaboratorPeriodoReferencia, string> = {
  semana: 'Semanal',
  quincena: 'Quincenal',
  mes: 'Mensual',
};

export const MOVEMENT_TIPO_LABELS: Record<CollaboratorMovementTipo, string> = {
  horas: 'Horas',
  extra: 'Extra',
  pago: 'Pago',
};

export const EXTRA_TIPO_LABELS: Record<CollaboratorExtraTipo, string> = {
  reparto: 'Reparto',
  premio: 'Premio',
  aguinaldo: 'Aguinaldo',
  bonificacion: 'Bonificación',
  otro: 'Otro',
};

export function weekStartDate(): string {
  const date = new Date();
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date.toISOString().slice(0, 10);
}

export function monthStartDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable({ providedIn: 'root' })
export class CollaboratorsService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get baseUrl(): string {
    return `/api/collaborators/${this.tenant.businessId}`;
  }

  getCollaborators(): Observable<Collaborator[]> {
    return this.http.get<Collaborator[]>(this.baseUrl);
  }

  getCollaborator(id: string): Observable<Collaborator> {
    return this.http.get<Collaborator>(`${this.baseUrl}/${id}`);
  }

  createCollaborator(payload: Partial<Collaborator>): Observable<Collaborator> {
    return this.http.post<Collaborator>(this.baseUrl, payload);
  }

  updateCollaborator(id: string, payload: Partial<Collaborator>): Observable<Collaborator> {
    return this.http.patch<Collaborator>(`${this.baseUrl}/${id}`, payload);
  }

  deleteCollaborator(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/${id}`);
  }

  getMovements(filters: {
    from?: string;
    to?: string;
    colaboradorId?: string;
  }): Observable<CollaboratorMovement[]> {
    let params = new HttpParams();
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.colaboradorId) params = params.set('colaboradorId', filters.colaboradorId);
    return this.http.get<CollaboratorMovement[]>(`${this.baseUrl}/movimientos`, { params });
  }

  createMovement(payload: Partial<CollaboratorMovement>): Observable<CollaboratorMovement> {
    return this.http.post<CollaboratorMovement>(`${this.baseUrl}/movimientos`, payload);
  }

  updateMovement(id: string, payload: Partial<CollaboratorMovement>): Observable<CollaboratorMovement> {
    return this.http.patch<CollaboratorMovement>(`${this.baseUrl}/movimientos/${id}`, payload);
  }

  deleteMovement(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/movimientos/${id}`);
  }

  getSummary(from: string, to: string): Observable<CollaboratorsPeriodSummary> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<CollaboratorsPeriodSummary>(`${this.baseUrl}/resumen`, { params });
  }
}

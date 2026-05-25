import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';

export interface PriceCatalogQuantityRange {
  cantidadMin: number;
  cantidadMax: number | null;
  precioUnitario: number;
}

export interface PriceCatalogVariant {
  nombre: string;
  /** Precio unitario de referencia (ej. 1 u.) si no hay rango que aplique. */
  precioReferencia?: number;
  rangosCantidad: PriceCatalogQuantityRange[];
}

export interface PriceCatalogEntry {
  id?: string;
  nombre: string;
  variantes: PriceCatalogVariant[];
  notas?: string;
  activo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PriceSummaryRow {
  variantNombre: string;
  cells: Array<{ label: string; precio: number }>;
}

export function formatQuantityRangeLabel(range: PriceCatalogQuantityRange): string {
  if (range.cantidadMax == null) {
    return `${range.cantidadMin}+ u.`;
  }
  if (range.cantidadMin === range.cantidadMax) {
    return `${range.cantidadMin} u.`;
  }
  return `${range.cantidadMin}–${range.cantidadMax} u.`;
}

export function resolveVariantUnitPrice(
  variant: Pick<PriceCatalogVariant, 'precioReferencia' | 'rangosCantidad'>,
  cantidad: number
): number {
  const qty = Math.max(1, Number(cantidad) || 1);
  const ranges = [...(variant.rangosCantidad ?? [])].sort(
    (a, b) => a.cantidadMin - b.cantidadMin
  );

  for (const range of ranges) {
    const withinMax = range.cantidadMax == null || qty <= range.cantidadMax;
    if (qty >= range.cantidadMin && withinMax) {
      return range.precioUnitario;
    }
  }

  return Number(variant.precioReferencia) || 0;
}

export function buildVariantPriceCells(
  variant: PriceCatalogVariant
): Array<{ label: string; precio: number }> {
  const cells: Array<{ label: string; precio: number }> = [];

  for (const range of variant.rangosCantidad ?? []) {
    if (range.precioUnitario > 0) {
      cells.push({
        label: formatQuantityRangeLabel(range),
        precio: range.precioUnitario,
      });
    }
  }

  if (!cells.length && (variant.precioReferencia ?? 0) > 0) {
    cells.push({ label: '1 u.', precio: Number(variant.precioReferencia) });
  }

  return cells;
}

export function buildPriceSummary(entry: Pick<PriceCatalogEntry, 'variantes'>): PriceSummaryRow[] {
  return (entry.variantes ?? [])
    .filter((variant) => variant.nombre.trim())
    .map((variant) => ({
      variantNombre: variant.nombre.trim(),
      cells: buildVariantPriceCells(variant),
    }))
    .filter((row) => row.cells.length > 0);
}

export function matchCatalogEntry(
  entries: PriceCatalogEntry[],
  item: {
    nombre?: string;
    nombreBase?: string;
  }
): PriceCatalogEntry | undefined {
  const candidates = entries.filter((entry) => entry.activo !== false);
  if (!candidates.length) return undefined;

  const names = [item.nombreBase, item.nombre]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (!names.length) return undefined;

  const scored = candidates
    .map((entry) => {
      const entryName = entry.nombre.trim().toLowerCase();
      let score = 0;

      for (const name of names) {
        if (name === entryName) score = Math.max(score, 100);
        else if (name.includes(entryName) || entryName.includes(name)) {
          score = Math.max(score, 60);
        }
      }

      return score > 0 ? { entry, score } : null;
    })
    .filter((item): item is { entry: PriceCatalogEntry; score: number } => item != null)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.entry;
}

export function createEmptyVariant(nombre = ''): PriceCatalogVariant {
  return {
    nombre,
    precioReferencia: 0,
    rangosCantidad: [],
  };
}

export function createEmptyPriceCatalogEntry(): PriceCatalogEntry {
  return {
    nombre: '',
    variantes: [createEmptyVariant('Sin estampado')],
    activo: true,
  };
}

export function normalizePriceCatalogVariant(variant: PriceCatalogVariant): PriceCatalogVariant {
  return {
    nombre: variant.nombre.trim(),
    precioReferencia: Number(variant.precioReferencia) || 0,
    rangosCantidad: (variant.rangosCantidad ?? [])
      .map((row) => ({
        cantidadMin: Math.max(1, Number(row.cantidadMin) || 1),
        cantidadMax:
          row.cantidadMax == null || row.cantidadMax === ('' as unknown as number)
            ? null
            : Math.max(Number(row.cantidadMin) || 1, Number(row.cantidadMax) || 1),
        precioUnitario: Number(row.precioUnitario) || 0,
      }))
      .filter((row) => row.precioUnitario > 0)
      .sort((a, b) => a.cantidadMin - b.cantidadMin),
  };
}

export function normalizePriceCatalogEntry(entry: PriceCatalogEntry): PriceCatalogEntry {
  const variantes = (entry.variantes ?? [])
    .map(normalizePriceCatalogVariant)
    .filter((variant) => variant.nombre);

  return {
    ...entry,
    nombre: entry.nombre.trim(),
    variantes: variantes.length ? variantes : [createEmptyVariant('Sin estampado')],
    notas: entry.notas?.trim() || undefined,
    activo: entry.activo !== false,
  };
}

@Injectable({
  providedIn: 'root',
})
export class PriceCatalogService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);

  private get businessId(): string {
    return this.tenant.businessId;
  }

  getEntries(): Observable<PriceCatalogEntry[]> {
    return this.http.get<PriceCatalogEntry[]>(`/api/price-catalog/${this.businessId}`);
  }

  getEntry(entryId: string): Observable<PriceCatalogEntry> {
    return this.http.get<PriceCatalogEntry>(
      `/api/price-catalog/${this.businessId}/${entryId}`
    );
  }

  createEntry(entry: PriceCatalogEntry): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/price-catalog/${this.businessId}`, entry);
  }

  updateEntry(entryId: string, entry: PriceCatalogEntry): Observable<{ id: string }> {
    return this.http.patch<{ id: string }>(
      `/api/price-catalog/${this.businessId}/${entryId}`,
      entry
    );
  }

  deleteEntry(entryId: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(
      `/api/price-catalog/${this.businessId}/${entryId}`
    );
  }
}

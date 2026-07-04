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

export interface PaginatedPriceCatalogEntries {
  items: PriceCatalogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PriceSummaryRow {
  variantNombre: string;
  cells: Array<{ label: string; precio: number }>;
}

export interface PriceCatalogListDetailRow {
  detalle: string;
  peakUnitPrice: number;
  ranges: Array<{ label: string; precio: number }>;
}

export interface PriceCatalogListRow {
  key: string;
  entryId: string;
  entryNombre: string;
  entryActivo: boolean;
  entryNotas?: string;
  /** Mayor precio unitario entre todos los detalles. */
  peakUnitPrice: number;
  detalles: PriceCatalogListDetailRow[];
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
  const ranges = [...(variant.rangosCantidad ?? [])].sort(
    (a, b) => a.cantidadMin - b.cantidadMin
  );

  ranges.forEach((range, index) => {
    if (range.precioUnitario <= 0) return;
    const label =
      index === 0 && range.cantidadMin === 1 && range.cantidadMax == null
        ? 'Desde 1 u.'
        : formatQuantityRangeLabel(range);
    cells.push({
      label,
      precio: range.precioUnitario,
    });
  });

  if (!cells.length && (variant.precioReferencia ?? 0) > 0) {
    cells.push({ label: 'Desde 1 u.', precio: Number(variant.precioReferencia) });
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

export function getVariantPeakUnitPrice(variant: PriceCatalogVariant): number {
  const cells = buildVariantPriceCells(variant);
  if (!cells.length) return 0;
  return Math.max(...cells.map((cell) => cell.precio));
}

export function buildPriceCatalogListRows(entries: PriceCatalogEntry[]): PriceCatalogListRow[] {
  const rows: PriceCatalogListRow[] = [];

  for (const entry of entries) {
    if (!entry.id) continue;

    const detalles = (entry.variantes ?? [])
      .map((variant) => normalizePriceCatalogVariant(variant))
      .filter((variant) => variant.nombre.trim())
      .map((variant) => {
        const ranges = buildVariantPriceCells(variant);
        if (!ranges.length) return null;

        return {
          detalle: variant.nombre.trim(),
          peakUnitPrice: getVariantPeakUnitPrice(variant),
          ranges,
        };
      })
      .filter((detail): detail is PriceCatalogListDetailRow => detail != null);

    if (!detalles.length) continue;

    rows.push({
      key: entry.id,
      entryId: entry.id,
      entryNombre: entry.nombre.trim(),
      entryActivo: entry.activo !== false,
      entryNotas: entry.notas?.trim() || undefined,
      peakUnitPrice: Math.max(...detalles.map((detail) => detail.peakUnitPrice)),
      detalles,
    });
  }

  return rows;
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
    rangosCantidad: [{ cantidadMin: 1, cantidadMax: null, precioUnitario: 0 }],
  };
}

/** Asegura rango base 1 u. y migra precioReferencia legacy. */
export function ensureVariantQuantityRanges(variant: PriceCatalogVariant): PriceCatalogVariant {
  const ref = Number(variant.precioReferencia) || 0;
  let ranges = [...(variant.rangosCantidad ?? [])];

  if (!ranges.length && ref > 0) {
    ranges = [{ cantidadMin: 1, cantidadMax: null, precioUnitario: ref }];
  }

  if (!ranges.length) {
    ranges = [{ cantidadMin: 1, cantidadMax: null, precioUnitario: 0 }];
  }

  ranges = [...ranges].sort((a, b) => a.cantidadMin - b.cantidadMin);
  if (ranges[0].cantidadMin !== 1) {
    ranges.unshift({
      cantidadMin: 1,
      cantidadMax: null,
      precioUnitario: ref || ranges[0].precioUnitario || 0,
    });
  }

  return {
    ...variant,
    rangosCantidad: ranges,
    precioReferencia: ref || ranges[0]?.precioUnitario || 0,
  };
}

export function getVariantBaseRange(variant: PriceCatalogVariant): PriceCatalogQuantityRange {
  return ensureVariantQuantityRanges(variant).rangosCantidad[0];
}

export function getVariantExtraRanges(variant: PriceCatalogVariant): PriceCatalogQuantityRange[] {
  return ensureVariantQuantityRanges(variant).rangosCantidad.slice(1);
}

export function createEmptyPriceCatalogEntry(): PriceCatalogEntry {
  return {
    nombre: '',
    variantes: [createEmptyVariant('Sin estampado')],
    activo: true,
  };
}

export function normalizePriceCatalogVariant(variant: PriceCatalogVariant): PriceCatalogVariant {
  const prepared = ensureVariantQuantityRanges(variant);
  const base = prepared.rangosCantidad[0];
  const extras = prepared.rangosCantidad.slice(1);

  const normalizeRange = (row: PriceCatalogQuantityRange) => ({
    cantidadMin: Math.max(1, Number(row.cantidadMin) || 1),
    cantidadMax:
      row.cantidadMax == null || row.cantidadMax === ('' as unknown as number)
        ? null
        : Math.max(Number(row.cantidadMin) || 1, Number(row.cantidadMax) || 1),
    precioUnitario: Number(row.precioUnitario) || 0,
  });

  const baseRange = normalizeRange({ ...base, cantidadMin: 1 });
  const extraRanges = extras
    .map(normalizeRange)
    .filter((row) => row.precioUnitario > 0)
    .sort((a, b) => a.cantidadMin - b.cantidadMin);

  const rangosCantidad =
    baseRange.precioUnitario > 0 ? [baseRange, ...extraRanges] : extraRanges;

  const basePrice = baseRange.precioUnitario || Number(prepared.precioReferencia) || 0;

  return {
    nombre: variant.nombre.trim(),
    precioReferencia: basePrice > 0 ? basePrice : 0,
    rangosCantidad,
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

  getEntriesPage(limit = 120, cursor?: string): Observable<PaginatedPriceCatalogEntries> {
    const params: Record<string, string> = { paged: '1', limit: String(limit) };
    if (cursor) params.cursor = cursor;
    return this.http.get<PaginatedPriceCatalogEntries>(
      `/api/price-catalog/${this.businessId}`,
      { params }
    );
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

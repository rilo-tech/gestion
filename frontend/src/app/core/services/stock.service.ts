import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of, shareReplay, tap, map, catchError } from 'rxjs';
import { TenantService } from './tenant.service';
import type { StockShortageGroup, StockShortageRow } from './order.service';
import { itemControlsStock as resolveItemControlsStock } from '../utils/stock-product';
import {
  filterStockListSearchEntries,
  filterStockSearchEntries,
  type StockSearchEntry,
} from '../../../../../shared/stock-search.ts';

export interface StockItem {
  id?: string;
  nombre: string;
  nombreBase?: string;
  tipo: string;
  categoria?: string;
  talle?: string;
  color?: string;
  codigo?: string;
  codigoBarras?: string;
  stockActual: number;
  stockMinimo?: number;
  stockReservado?: number;
  /** Si es false, no exige stock físico (servicio / personalización). Default: true. */
  controlaStock?: boolean;
  /** Si es true (default), pedidos pueden dejar depósito negativo para este producto. */
  permitirStockNegativo?: boolean;
  costo?: number;
  precioSugerido?: number;
}

export function itemControlsStock(
  item: Pick<StockItem, 'controlaStock' | 'categoria'> | undefined
): boolean {
  return resolveItemControlsStock(item);
}

export function itemIsLowStock(
  item: Pick<StockItem, 'stockActual' | 'stockMinimo' | 'stockReservado' | 'controlaStock' | 'categoria'> | undefined
): boolean {
  if (!itemControlsStock(item)) return false;
  const disponible = getStockDisponible(item);
  return disponible <= (Number(item?.stockMinimo) || 0);
}

export function getStockDisponible(
  item: Pick<StockItem, 'stockActual' | 'stockReservado'> | undefined
): number {
  return Math.max(0, (Number(item?.stockActual) || 0) - (Number(item?.stockReservado) || 0));
}

/** Unidades en depósito: disponible + reservado (sin contar dos veces). */
export function getStockEnDeposito(
  item: Pick<StockItem, 'stockActual' | 'stockReservado'> | undefined
): number {
  const reservado = Math.max(0, Number(item?.stockReservado) || 0);
  return getStockDisponible(item) + reservado;
}

export type StockOrigenGrupo = 'compra' | 'pedido' | 'venta' | 'ajuste' | 'carga_inicial' | 'otro' | (string & {});

export interface StockMovement {
  id?: string;
  productoId: string;
  productoNombre?: string | null;
  tipo: 'entrada' | 'salida';
  cantidad: number;
  fecha: string;
  motivo?: string;
  origenId?: string | null;
  origenTipo?: string;
  origenGrupo?: StockOrigenGrupo;
  origenLabel?: string;
  pedidoId?: string | null;
  numeroPedidoLabel?: string | null;
  clienteId?: string | null;
  clienteNombre?: string | null;
  ventaId?: string | null;
  ventaLabel?: string | null;
  compraId?: string | null;
  negocioId?: string;
}

export interface StockReservationRow {
  orderId: string;
  orderLabel: string;
  orderEstado: string;
  clienteId: string;
  clienteNombre: string;
  stockItemId: string;
  productoNombre: string;
  lineIndex: number;
  cantidadReservada: number;
  cantidadUsada: number;
  cantidadActiva: number;
  stockPreparado: boolean;
}

export interface StockReservationGroup {
  stockItemId: string;
  productoNombre: string;
  reservadoTotal: number;
  reservas: StockReservationRow[];
}

export interface PaginatedStockItems {
  items: StockItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PaginatedStockMovements {
  items: StockMovement[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PaginatedStockReservations {
  rows: StockReservationRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface StockMetrics {
  totalItems: number;
  lowStockCount: number;
  /** Suma costo × depósito por producto con control de stock. */
  valorDepositoEstimado: number;
  updatedAt: string;
}

export type StockCatalogChange = {
  item?: StockItem;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Valor estimado de un producto (costo × depósito; stock 0 → 0). */
export function computeItemValorEstimado(item: StockItem): number {
  if (!itemControlsStock(item)) return 0;
  const deposito = getStockEnDeposito(item);
  if (deposito <= 0) return 0;
  return roundMoney(deposito * (Number(item.costo) || 0));
}

/** Suma costo × unidades en depósito (misma regla que métricas persistidas). */
export function computeValorDepositoEstimado(items: StockItem[]): number {
  const total = items.reduce(
    (sum, item) => sum + computeItemValorEstimado(item),
    0
  );
  return roundMoney(total);
}

@Injectable({
  providedIn: 'root'
})
export class StockService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);
  private readonly catalogChanged = new Subject<StockCatalogChange | void>();

  /** Emite cuando el catálogo o el stock de un producto cambia (alta/baja, costo, etc.). */
  readonly stockCatalogChanged$ = this.catalogChanged.asObservable();

  private searchIndexCache: StockSearchEntry[] | null = null;
  private searchIndexBusinessId = '';
  private searchIndexRequest: Observable<StockSearchEntry[]> | null = null;

  /** Cache de items por negocio para abrir el formulario sin esperar la red. */
  private readonly itemCache = new Map<string, StockItem>();
  private itemCacheBusinessId = '';

  private get businessId(): string {
    return this.tenant.businessId;
  }

  private ensureItemCacheTenant(): void {
    if (this.itemCacheBusinessId !== this.businessId) {
      this.itemCache.clear();
      this.itemCacheBusinessId = this.businessId;
    }
  }

  private cacheItem(item: StockItem | undefined | null): void {
    if (!item?.id) return;
    this.ensureItemCacheTenant();
    this.itemCache.set(item.id, item);
  }

  private cacheItems(items: StockItem[] | undefined | null): void {
    if (!items?.length) return;
    this.ensureItemCacheTenant();
    for (const item of items) {
      if (item?.id) this.itemCache.set(item.id, item);
    }
  }

  /** Item ya conocido (lista/detalle previos), sin tocar la red. */
  peekItem(itemId: string): StockItem | null {
    this.ensureItemCacheTenant();
    return this.itemCache.get(itemId) ?? null;
  }

  notifyCatalogChanged(change?: StockCatalogChange): void {
    this.invalidateSearchIndex();
    this.catalogChanged.next(change);
  }

  /** Fuerza recarga del índice de búsqueda en el próximo listado. */
  clearListCaches(): void {
    this.invalidateSearchIndex();
  }

  private invalidateSearchIndex(): void {
    this.searchIndexCache = null;
    this.searchIndexBusinessId = '';
    this.searchIndexRequest = null;
  }

  /** Precarga el índice de búsqueda (una sola vez por sesión de catálogo). */
  preloadSearchIndex(): void {
    this.ensureSearchIndex().subscribe({ error: () => undefined });
  }

  isSearchIndexReady(): boolean {
    return (
      this.searchIndexCache !== null &&
      this.searchIndexBusinessId === this.businessId
    );
  }

  filterSearchIndex(query: string, limit = 20): StockItem[] {
    if (!this.searchIndexCache) return [];
    return filterStockSearchEntries(this.searchIndexCache, query, limit) as StockItem[];
  }

  private ensureSearchIndex(): Observable<StockSearchEntry[]> {
    if (
      this.searchIndexCache &&
      this.searchIndexBusinessId === this.businessId
    ) {
      return of(this.searchIndexCache);
    }

    if (
      this.searchIndexRequest &&
      this.searchIndexBusinessId === this.businessId
    ) {
      return this.searchIndexRequest;
    }

    this.searchIndexBusinessId = this.businessId;
    this.searchIndexRequest = this.http
      .get<StockSearchEntry[]>(`/api/stock/${this.businessId}/search-index`)
      .pipe(
        tap((items) => {
          this.searchIndexCache = items;
        }),
        catchError(() => {
          this.invalidateSearchIndex();
          return of([] as StockSearchEntry[]);
        }),
        shareReplay(1)
      );

    return this.searchIndexRequest;
  }

  getStock(): Observable<StockItem[]> {
    return this.http
      .get<StockItem[]>(`/api/stock/${this.businessId}`)
      .pipe(tap((items) => this.cacheItems(items)));
  }

  getStockMetrics(options?: { refresh?: boolean }): Observable<StockMetrics> {
    const params: Record<string, string> = {};
    if (options?.refresh) params['refresh'] = '1';
    return this.http.get<StockMetrics>(`/api/stock/${this.businessId}/metrics`, { params });
  }

  getStockPage(limit = 120, cursor?: string): Observable<PaginatedStockItems> {
    const params: Record<string, string> = { paged: '1', limit: String(limit) };
    if (cursor) params.cursor = cursor;
    return this.http
      .get<PaginatedStockItems>(`/api/stock/${this.businessId}`, { params })
      .pipe(tap((page) => this.cacheItems(page?.items)));
  }

  getMovements(): Observable<StockMovement[]> {
    return this.http.get<StockMovement[]>(`/api/stock/${this.businessId}/movements`);
  }

  getMovementsPage(limit = 120, cursor?: string): Observable<PaginatedStockMovements> {
    const params: Record<string, string> = { paged: '1', limit: String(limit) };
    if (cursor) params.cursor = cursor;
    return this.http.get<PaginatedStockMovements>(
      `/api/stock/${this.businessId}/movements`,
      { params }
    );
  }

  searchStock(query: string, limit = 20): Observable<StockItem[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return of([]);
    }

    if (this.isSearchIndexReady()) {
      return of(this.filterSearchIndex(trimmed, limit));
    }

    return this.ensureSearchIndex().pipe(
      map((items) => filterStockSearchEntries(items, trimmed, limit) as StockItem[])
    );
  }

  /** Búsqueda del listado de productos: todo el catálogo, solo nombre y código. */
  searchStockForList(query: string): Observable<StockItem[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return of([]);
    }

    if (this.isSearchIndexReady()) {
      return of(this.filterSearchIndexForList(trimmed));
    }

    return this.ensureSearchIndex().pipe(
      map((items) => filterStockListSearchEntries(items, trimmed) as StockItem[])
    );
  }

  filterSearchIndexForList(query: string): StockItem[] {
    if (!this.searchIndexCache) return [];
    return filterStockListSearchEntries(this.searchIndexCache, query) as StockItem[];
  }

  previewNextCode(categoria: string): Observable<{ codigo: string }> {
    const params = new URLSearchParams({ categoria: categoria.trim() });
    return this.http.get<{ codigo: string }>(
      `/api/stock/${this.businessId}/next-code?${params}`
    );
  }

  checkCodigoAvailability(
    codigo: string,
    options?: { excludeId?: string; categoria?: string }
  ): Observable<{
    available: boolean;
    prefijoConflict: { categoria: string; prefijo: string } | null;
  }> {
    const params = new URLSearchParams({ codigo: codigo.trim() });
    const excludeId = options?.excludeId?.trim();
    const categoria = options?.categoria?.trim();
    if (excludeId) params.set('excludeId', excludeId);
    if (categoria) params.set('categoria', categoria);
    return this.http.get<{
      available: boolean;
      prefijoConflict: { categoria: string; prefijo: string } | null;
    }>(`/api/stock/${this.businessId}/codigo-check?${params}`);
  }

  checkBarcodeAvailability(
    codigoBarras: string,
    options?: { excludeId?: string }
  ): Observable<{ available: boolean }> {
    const params = new URLSearchParams({ codigoBarras: codigoBarras.trim() });
    const excludeId = options?.excludeId?.trim();
    if (excludeId) params.set('excludeId', excludeId);
    return this.http.get<{ available: boolean }>(
      `/api/stock/${this.businessId}/barcode-check?${params}`
    );
  }

  getItemByBarcode(code: string): Observable<StockItem> {
    const params = new URLSearchParams({ code: code.trim() });
    return this.http
      .get<StockItem>(`/api/stock/${this.businessId}/by-barcode?${params}`)
      .pipe(tap((item) => this.cacheItem(item)));
  }

  getItem(itemId: string): Observable<StockItem> {
    return this.http
      .get<StockItem>(`/api/stock/${this.businessId}/${itemId}`)
      .pipe(tap((item) => this.cacheItem(item)));
  }

  getItemsByIds(itemIds: string[]): Observable<StockItem[]> {
    const ids = [...new Set(itemIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
    if (ids.length === 0) return of([]);
    const params = new URLSearchParams({ ids: ids.join(',') });
    return this.http
      .get<StockItem[]>(`/api/stock/${this.businessId}/by-ids?${params}`)
      .pipe(tap((items) => this.cacheItems(items)));
  }

  createItem(item: StockItem): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/stock/${this.businessId}`, item);
  }

  updateItem(itemId: string, item: StockItem): Observable<{ id: string }> {
    return this.http.put<{ id: string }>(`/api/stock/${this.businessId}/${itemId}`, item);
  }

  deleteItem(itemId: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`/api/stock/${this.businessId}/${itemId}`).pipe(
      tap(() => {
        this.ensureItemCacheTenant();
        this.itemCache.delete(itemId);
      })
    );
  }

  deleteMovement(movementId: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(
      `/api/stock/${this.businessId}/movements/${movementId}`
    );
  }

  adjustStock(itemId: string, quantity: number, motivo: string): Observable<any> {
    return this.http.patch(`/api/stock/${this.businessId}/${itemId}`, {
      quantity,
      motivo,
      usuarioId: 'admin' // Placeholder
    });
  }

  getShortages(): Observable<{ grouped: StockShortageGroup[]; rows: StockShortageRow[] }> {
    return this.http.get<{ grouped: StockShortageGroup[]; rows: StockShortageRow[] }>(
      `/api/stock/${this.businessId}/faltantes`
    );
  }

  getReservations(stockItemId?: string): Observable<{
    rows: StockReservationRow[];
    grouped: StockReservationGroup[];
  }> {
    const params = stockItemId ? `?stockItemId=${encodeURIComponent(stockItemId)}` : '';
    return this.http.get<{ rows: StockReservationRow[]; grouped: StockReservationGroup[] }>(
      `/api/stock/${this.businessId}/reservations${params}`
    );
  }

  getReservationsPage(
    limit = 30,
    cursor?: string,
    stockItemId?: string
  ): Observable<PaginatedStockReservations> {
    const params: Record<string, string> = { paged: '1', limit: String(limit) };
    if (cursor) params.cursor = cursor;
    if (stockItemId) params.stockItemId = stockItemId;
    return this.http.get<PaginatedStockReservations>(
      `/api/stock/${this.businessId}/reservations`,
      { params }
    );
  }
}

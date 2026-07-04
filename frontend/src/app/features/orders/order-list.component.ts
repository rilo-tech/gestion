import { Component, DestroyRef, Injector, inject, OnDestroy, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OrderService, Order, formatOrderNumber, resolveOrderBalance } from '../../core/services/order.service';
import type { Client } from '../../core/services/client.service';
import { OrderPrintService } from '../../core/services/order-print.service';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import { CatalogConfigService, AppConfig, DEFAULT_APP_CONFIG, getOrderStatusLabelFromConfig } from '../../core/services/catalog-config.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  getOrderStatusBadgeClass,
  getOrderStatusLabel,
  isOrderPendingDelivery,
  normalizeOrderStatus,
  getOrderStatusCardBorderClass,
  getOrderStatusCardEstados,
  getOrderStatusCardTitleClass,
  getOrderStatusCardValueClass,
  orderMatchesStatusCardFilter,
  orderHasEntregaConSaldo,
  ORDER_STATUS_OPTIONS,
} from '../../core/constants/order-status';
import type { OrderEstadoConfig } from '../../core/constants/order-config';
import { normalizeOrderEstadoValue, orderHasStockControlledLines } from '../../core/constants/order-config';
import {
  getOrderStockStatusBadgeClass,
  getOrderStockStatusLabel,
  getOrderStockStatusShortLabel,
} from '../../core/constants/order-stock-status';
import {
  ICON_ACTION_LINK_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { CompactListRowComponent } from '../../shared/components/compact-list/compact-list-row.component';
import {
  COMPACT_LIST_EMPTY_CLASS,
  DESKTOP_TABLE_TD_CLASS,
  DESKTOP_TABLE_TH_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { LucideAngularModule } from 'lucide-angular';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
} from '../../shared/components/list-pagination/list-pagination.component';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { ListLoadMoreComponent } from '../../shared/components/list-load-more/list-load-more.component';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import { bindListPageRefreshOnReturn } from '../../core/utils/list-page-refresh';
import {
  PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE,
  PROGRESSIVE_LIST_FIRST_PAGE_SIZE,
  ProgressiveListSession,
} from '../../core/utils/progressive-list-load';

type OrderSortColumn = 'fecha' | 'pedido' | 'entrega' | 'estado';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink, ListPaginationComponent, CompactListRowComponent, ModulePageHeaderComponent, CompactDataListComponent, ListLoadMoreComponent, ListRowActionsComponent, ListSearchFieldComponent],
  template: `
    <div [class]="pageShellClass" (click)="clearStatusCardFilter()">
      <app-module-page-header
        title="Pedidos"
        description="Gestiona tus pedidos personalizados y su producción."
        [showMobileSearch]="true"
        [searchQuery]="searchQuery"
        (searchQueryChange)="onSearchQueryChange($event)"
        searchFieldName="ordersSearchQueryMobile"
        activityModule="orders"
        [showRefresh]="true"
        [refreshing]="loading"
        (refreshClick)="reloadList()">
        <a
          headerActions
          routerLink="/orders/new"
          [class]="iconActionLinkClass"
          aria-label="Nuevo pedido"
          title="Nuevo pedido">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          <span class="hidden sm:inline">Nuevo pedido</span>
        </a>
      </app-module-page-header>

      <div
        class="sm:hidden mb-3 px-2"
        (click)="$event.stopPropagation()">
        <div class="grid grid-cols-3 gap-1.5">
          <button
            *ngFor="let card of mobileStatusEstados; let i = index; trackBy: trackStatusCard"
            type="button"
            [disabled]="!canShowStatusCard(card.value)"
            (click)="toggleStatusCardFilter(card.value, $event)"
            [class]="mobileStatusChipClass(card.value, i)">
            <span
              class="block text-[9px] font-semibold uppercase leading-tight truncate"
              [ngClass]="getOrderStatusCardTitleClass(i)">
              {{ getMobileEstadoChipLabel(card.value) }}
            </span>
            <span
              class="block text-[11px] font-bold tabular-nums leading-tight mt-0.5"
              [ngClass]="getOrderStatusCardValueClass(i)">
              {{ statusCounts[card.value] ?? 0 }}
            </span>
          </button>
        </div>
      </div>

      <div
        class="module-summary-kpis hidden sm:grid gap-3 sm:gap-4 mb-6 sm:mb-8"
        [ngClass]="statusCardGridClass"
        (click)="$event.stopPropagation()">
        <button
          *ngFor="let card of statusCardEstados; let i = index; trackBy: trackStatusCard"
          type="button"
          (click)="setStatusCardFilter(card.value, $event)"
          [class]="statusCardClass(card.value, getOrderStatusCardBorderClass(i))">
          <p class="text-xs font-bold uppercase mb-1" [ngClass]="getOrderStatusCardTitleClass(i)">
            {{ getOrderEstadoCardLabel(card.value) }}
          </p>
          <p class="text-xl font-bold tabular-nums" [ngClass]="getOrderStatusCardValueClass(i)">
            {{ statusCounts[card.value] ?? 0 }}
          </p>
        </button>
      </div>

      <div
        *ngIf="statusCardFilter"
        class="mb-3 sm:mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg sm:rounded-xl border border-teal-100 dark:border-teal-900/50 bg-teal-50 dark:bg-teal-950/40 px-3 py-2 sm:px-4 sm:py-3 text-xs sm:text-sm text-teal-800 dark:text-teal-200">
        <span class="min-w-0 truncate">
          <span class="sm:hidden">Filtrado: </span>
          <span class="hidden sm:inline">Mostrando solo pedidos en «{{ getOrderEstadoCardLabel(statusCardFilter) }}». Hacé click fuera de las tarjetas para ver todos.</span>
          <span class="sm:hidden font-semibold">{{ getOrderEstadoCardLabel(statusCardFilter) }}</span>
        </span>
        <button
          type="button"
          (click)="clearStatusCardFilter(); $event.stopPropagation()"
          class="shrink-0 font-semibold text-teal-700 dark:text-teal-300 hover:underline">
          Ver todos
        </button>
      </div>

      <div
        *ngIf="listFilter === 'pendientes-entrega'"
        class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <span>Pedidos confirmados que aún no fueron entregados.</span>
        <a routerLink="/orders" class="font-semibold text-blue-700 hover:underline">Ver todos</a>
      </div>

      <div
        *ngIf="!auth.canViewAllOrders"
        class="mb-4 rounded-xl border border-purple-100 bg-purple-50 px-4 py-3 text-sm text-purple-800">
        Solo ves pedidos en proceso. Pedí acceso al administrador para ver el resto o los entregados.
      </div>

      <app-compact-data-list [showSearch]="true">
        <div listSearch [class]="desktopListSearchWrapClass">
          <app-list-search-field
            mode="filter"
            [query]="searchQuery"
            (queryChange)="onSearchQueryChange($event)"
            name="ordersSearchQuery"
            placeholder="Buscar por pedido, cliente, descripción, estado o producto...">
          </app-list-search-field>
        </div>
        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <app-compact-list-row
            *ngFor="let order of paginatedDisplayOrders; trackBy: trackOrder"
            (activate)="openEditOrder(order)">
            <div compactTitle class="compact-list-title flex items-baseline gap-1.5 min-w-0">
              <span class="shrink-0 tabular-nums">
                {{ getOrderNumber(order) ? ('#' + getOrderNumber(order)) : 'Pedido' }}
              </span>
              <span class="truncate min-w-0 font-normal text-gray-600">{{ getClientName(order) }}</span>
            </div>
            <div compactSubtitle class="compact-list-subtitle truncate">
              Entrega: {{ order.fechaEntrega ? (order.fechaEntrega | date:'dd/MM/yyyy') : '—' }}
            </div>
            <span
              compactTrailing
              class="inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold shrink-0 whitespace-nowrap"
              [ngClass]="getOrderStatusBadgeClass(order.estado)">
              {{ getOrderStatusLabelFor(order.estado) }}
            </span>
          </app-compact-list-row>
          <p *ngIf="loading" [class]="compactListEmptyClass">Cargando pedidos...</p>
          <p
            *ngIf="!loading && visibleOrders.length > 0 && displayOrders.length === 0"
            [class]="compactListEmptyClass">
            <ng-container *ngIf="listFilter === 'pendientes-entrega' && !searchQuery.trim()">
              No hay pedidos confirmados pendientes de entrega.
            </ng-container>
            <ng-container *ngIf="listFilter !== 'pendientes-entrega' || searchQuery.trim()">
              No se encontraron pedidos para "{{ searchQuery }}".
            </ng-container>
          </p>
          <p *ngIf="!loading && visibleOrders.length === 0" [class]="compactListEmptyClass">
            No hay pedidos registrados.
          </p>
        </div>
        <div listDesktop class="hidden sm:block" [class]="tableScrollClass">
        <table [class]="nativeCompactTableClass + ' sm:table-fixed max-w-full'">
          <colgroup class="hidden sm:table-column-group">
            <col class="w-[5.5rem]" />
            <col class="w-[4.75rem]" />
            <col />
            <col class="w-[5.5rem]" />
            <col class="w-[8.5rem]" />
            <col *ngIf="auth.canViewOrderBalance" class="w-[7rem]" />
            <col class="w-[5.5rem]" />
          </colgroup>
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="hidden sm:table-cell" [class]="desktopThClass">
                <button type="button" (click)="toggleSort('fecha')" [class]="sortHeaderClass('fecha')">
                  Fecha
                  <i-lucide
                    *ngIf="sortColumn === 'fecha'"
                    [name]="sortDirection === 'desc' ? 'chevron-down' : 'chevron-up'"
                    class="w-3.5 h-3.5"></i-lucide>
                </button>
              </th>
              <th [class]="desktopThClass">
                <button type="button" (click)="toggleSort('pedido')" [class]="sortHeaderClass('pedido')">
                  Pedido
                  <i-lucide
                    *ngIf="sortColumn === 'pedido'"
                    [name]="sortDirection === 'desc' ? 'chevron-down' : 'chevron-up'"
                    class="w-3.5 h-3.5"></i-lucide>
                </button>
              </th>
              <th [class]="desktopThClass">Cliente</th>
              <th class="hidden sm:table-cell" [class]="desktopThClass">
                <button type="button" (click)="toggleSort('entrega')" [class]="sortHeaderClass('entrega')">
                  Entrega
                  <i-lucide
                    *ngIf="sortColumn === 'entrega'"
                    [name]="sortDirection === 'desc' ? 'chevron-down' : 'chevron-up'"
                    class="w-3.5 h-3.5"></i-lucide>
                </button>
              </th>
              <th [class]="desktopThClass">
                <button type="button" (click)="toggleSort('estado')" [class]="sortHeaderClass('estado')">
                  Estado
                  <i-lucide
                    *ngIf="sortColumn === 'estado'"
                    [name]="sortDirection === 'desc' ? 'chevron-down' : 'chevron-up'"
                    class="w-3.5 h-3.5"></i-lucide>
                </button>
              </th>
              <th
                *ngIf="auth.canViewOrderBalance"
                class="hidden sm:table-cell"
                [class]="desktopThClass">
                {{ auth.canViewOrderSalePrice ? 'Total / Saldo' : 'Saldo' }}
              </th>
              <th class="hidden sm:table-cell text-right" [class]="desktopThClass">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let order of paginatedDisplayOrders; trackBy: trackOrder"
              (click)="openEditOrder(order)"
              class="hover:bg-gray-50 transition-colors cursor-pointer">
              <td class="hidden sm:table-cell whitespace-nowrap text-gray-600" [class]="desktopTdClass">
                {{ getOrderDate(order) ? (getOrderDate(order) | date:'dd/MM/yyyy') : '—' }}
              </td>
              <td class="font-semibold text-teal-700 whitespace-nowrap" [class]="desktopTdClass">
                {{ getOrderNumber(order) ? ('#' + getOrderNumber(order)) : '—' }}
                <div class="text-[10px] font-normal text-gray-400 sm:hidden">
                  {{ getOrderDate(order) ? (getOrderDate(order) | date:'dd/MM/yyyy') : '—' }}
                </div>
              </td>
              <td class="min-w-0" [class]="desktopTdClass">
                <div class="font-medium text-gray-900 truncate">{{ getClientName(order) }}</div>
                <div class="text-[10px] text-gray-400 sm:hidden">
                  Entrega: {{ order.fechaEntrega ? (order.fechaEntrega | date:'dd/MM/yyyy') : '—' }}
                </div>
              </td>
              <td class="hidden sm:table-cell whitespace-nowrap text-gray-600" [class]="desktopTdClass">
                {{ order.fechaEntrega ? (order.fechaEntrega | date:'dd/MM/yyyy') : '—' }}
              </td>
              <td [class]="desktopTdClass">
                <div class="flex items-center gap-1 flex-nowrap">
                  <span
                    class="inline-flex shrink-0 whitespace-nowrap px-2 py-0.5 rounded-md text-[10px] font-semibold"
                    [title]="getOrderStatusLabelFor(order.estado)"
                    [ngClass]="getOrderStatusBadgeClass(order.estado)">
                    {{ getOrderStatusListLabel(order) }}
                  </span>
                  <span
                    *ngIf="orderShowsStockStatus(order) && (order.stockPreparado || order.estadoStock)"
                    class="inline-flex shrink-0 whitespace-nowrap px-2 py-0.5 rounded-md text-[10px] font-semibold border"
                    [title]="getOrderStockStatusLabel(order.estadoStock)"
                    [ngClass]="getOrderStockStatusBadgeClass(order.estadoStock)">
                    {{ getOrderStockStatusShortLabel(order.estadoStock) }}
                  </span>
                </div>
              </td>
              <td
                *ngIf="auth.canViewOrderBalance"
                class="hidden sm:table-cell"
                [class]="desktopTdClass">
                <div *ngIf="auth.canViewOrderSalePrice" class="font-semibold text-gray-900 tabular-nums">
                  {{ formatMoney(order.total) }}
                </div>
                <div
                  *ngIf="auth.canViewOrderBalance"
                  class="text-[10px] font-medium tabular-nums"
                  [class.text-orange-500]="getOrderSaldo(order) > 0"
                  [class.text-gray-400]="!(getOrderSaldo(order) > 0)">
                  Saldo {{ formatMoney(getOrderSaldo(order)) }}
                </div>
              </td>
              <td class="hidden sm:table-cell text-right" [class]="desktopTdClass" (click)="$event.stopPropagation()">
                <app-list-row-actions
                  [editIcon]="auth.canEditRecords ? 'pencil' : 'clipboard-list'"
                  [editLabel]="isCancelledOrder(order) ? 'Ver pedido' : (auth.canEditRecords ? 'Editar' : 'Ver pedido')"
                  (editClick)="openEditOrder(order)"
                  [showDuplicate]="auth.canEditRecords"
                  (duplicateClick)="duplicateOrder(order, $event)"
                  [showPrint]="auth.canPrintOrders"
                  [printLoading]="printingOrderId === order.id"
                  (printClick)="printOrder(order)"
                  [showDelete]="auth.canEditRecords"
                  [deleteDisabled]="isCancelledOrder(order)"
                  deleteLabel="Cancelar pedido"
                  (deleteClick)="confirmCancelOrder(order)">
                </app-list-row-actions>
              </td>
            </tr>
            <tr *ngIf="!loading && visibleOrders.length > 0 && displayOrders.length === 0">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                <ng-container *ngIf="listFilter === 'pendientes-entrega' && !searchQuery.trim()">
                  No hay pedidos confirmados pendientes de entrega.
                </ng-container>
                <ng-container *ngIf="listFilter !== 'pendientes-entrega' || searchQuery.trim()">
                  No se encontraron pedidos para "{{ searchQuery }}".
                </ng-container>
              </td>
            </tr>
            <tr *ngIf="!loading && visibleOrders.length === 0">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                No hay pedidos registrados.
              </td>
            </tr>
            <tr *ngIf="loading">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                Cargando pedidos...
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <app-list-pagination
          listFooter
          [page]="ordersPage"
          [pageSize]="listPageSize"
          [totalItems]="displayOrders.length"
          (pageChange)="ordersPage = $event">
        </app-list-pagination>
        <app-list-load-more
          listFooter
          [hasMore]="ordersHasMore"
          [loading]="loadingMore || loading"
          label="Cargar más pedidos"
          loadingLabel="Cargando más..."
          (loadMoreClick)="loadMoreOrders()">
        </app-list-load-more>
      </app-compact-data-list>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderListComponent implements OnInit, OnDestroy {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly desktopThClass = DESKTOP_TABLE_TH_CLASS;
  readonly desktopTdClass = DESKTOP_TABLE_TD_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly iconActionLinkClass = ICON_ACTION_LINK_CLASS;
  readonly auth = inject(AuthService);

  private orderService = inject(OrderService);
  private orderPrintService = inject(OrderPrintService);
  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);

  readonly getOrderStatusBadgeClass = getOrderStatusBadgeClass;
  getOrderStatusLabelFor(estado?: string): string {
    return getOrderStatusLabel(estado, this.appConfig.pedidos);
  }
  /** Etiqueta compacta para la grilla (evita que los badges salten de línea). */
  getOrderStatusListLabel(order: Order): string {
    const normalized = normalizeOrderStatus(order.estado, this.appConfig.pedidos);
    if (orderHasEntregaConSaldo(order.estado, order)) {
      return 'Entr. c/saldo';
    }
    if (normalized === 'entregado') return 'Entregado';
    return this.getOrderStatusLabelFor(order.estado);
  }
  getOrderEstadoCardLabel(value: string): string {
    const normalized = normalizeOrderEstadoValue(value);
    if (normalized === 'entregado' || normalized === 'entregado_con_saldo') {
      return 'Entregado';
    }
    return getOrderStatusLabelFromConfig(value, this.appConfig.pedidos);
  }
  readonly normalizeOrderStatus = normalizeOrderStatus;
  readonly getOrderStatusCardBorderClass = getOrderStatusCardBorderClass;
  readonly getOrderStatusCardTitleClass = getOrderStatusCardTitleClass;
  readonly getOrderStatusCardValueClass = getOrderStatusCardValueClass;
  readonly getOrderStockStatusLabel = getOrderStockStatusLabel;
  readonly getOrderStockStatusShortLabel = getOrderStockStatusShortLabel;
  readonly getOrderStockStatusBadgeClass = getOrderStockStatusBadgeClass;

  orders: Order[] = [];
  displayOrders: Order[] = [];
  clientsById = new Map<string, Client>();
  loading = true;
  loadingMore = false;
  ordersHasMore = false;
  ordersNextCursor: string | null = null;
  printingOrderId: string | null = null;
  searchQuery = '';
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  ordersPage = 1;
  listFilter: 'all' | 'pendientes-entrega' = 'all';
  statusCardFilter: string | null = null;
  sortColumn: OrderSortColumn = 'pedido';
  sortDirection: 'desc' | 'asc' = 'desc';
  statusCounts: Record<string, number> = {};

  private searchDebounce?: ReturnType<typeof setTimeout>;
  private backgroundLoadToken = 0;
  private readonly listLoadSession = new ProgressiveListSession();

  get statusCardEstados(): OrderEstadoConfig[] {
    return getOrderStatusCardEstados(this.appConfig.pedidos).filter((card) =>
      this.canShowStatusCard(card.value)
    );
  }

  /** Los 5 estados en celular (sin filtrar permisos; los no permitidos quedan deshabilitados). */
  get mobileStatusEstados(): OrderEstadoConfig[] {
    return getOrderStatusCardEstados(this.appConfig.pedidos);
  }

  getMobileEstadoChipLabel(value: string): string {
    const normalized = normalizeOrderEstadoValue(value);
    if (normalized === 'borrador') return 'Borrador';
    if (normalized === 'pendiente') return 'Pendiente';
    if (normalized === 'en_produccion') return 'En proceso';
    if (normalized === 'listo') return 'Listo';
    if (normalized === 'entregado' || normalized === 'entregado_con_saldo') return 'Entregado';
    return this.getOrderEstadoCardLabel(value);
  }

  get statusCardGridClass(): string {
    const count = this.statusCardEstados.length;
    if (count <= 1) return 'grid-cols-1';
    if (count === 2) return 'grid-cols-2';
    if (count === 3) return 'grid-cols-2 md:grid-cols-3';
    if (count === 4) return 'grid-cols-2 md:grid-cols-4';
    return 'grid-cols-2 md:grid-cols-5';
  }

  get visibleOrders(): Order[] {
    return this.orders.filter((order) => this.auth.canViewOrder(order.estado));
  }

  get paginatedDisplayOrders(): Order[] {
    return paginateSlice(this.displayOrders, this.ordersPage, this.listPageSize);
  }

  sortHeaderClass(column: OrderSortColumn): string {
    const base =
      'inline-flex items-center gap-1 font-inherit text-inherit leading-inherit tracking-inherit uppercase transition-colors';
    if (this.sortColumn === column) {
      return `${base} text-teal-600 dark:text-teal-400`;
    }
    return `${base} text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300`;
  }

  toggleSort(column: OrderSortColumn) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'desc' ? 'asc' : 'desc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'desc';
    }
    this.ordersPage = 1;
    this.rebuildDisplayOrders();
  }

  onSearchQueryChange(value: string) {
    this.searchQuery = value;
    this.ordersPage = 1;
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.rebuildDisplayOrders(), 120);
  }

  trackStatusCard(_index: number, card: OrderEstadoConfig): string {
    return card.value;
  }

  canShowStatusCard(value: string): boolean {
    if (value === 'en_produccion') return true;
    if (value === 'entregado' || value === 'entregado_con_saldo') {
      return this.auth.canViewDeliveredOrders;
    }
    return this.auth.canViewAllOrders;
  }

  orderShowsStockStatus(order: Order): boolean {
    return orderHasStockControlledLines(order.items ?? []);
  }

  setStatusCardFilter(status: string, event: Event) {
    event.stopPropagation();
    this.statusCardFilter = status;
    this.ordersPage = 1;
    this.rebuildDisplayOrders();
  }

  toggleStatusCardFilter(status: string, event: Event) {
    event.stopPropagation();
    if (!this.canShowStatusCard(status)) return;
    if (this.statusCardFilter === status) {
      this.clearStatusCardFilter();
      return;
    }
    this.setStatusCardFilter(status, event);
  }

  clearStatusCardFilter() {
    if (!this.statusCardFilter) return;
    this.statusCardFilter = null;
    this.ordersPage = 1;
    this.rebuildDisplayOrders();
  }

  statusCardClass(status: string, borderClass: string): string {
    const base = `bg-gray-50 p-4 rounded-xl border text-left w-full transition-all cursor-pointer hover:shadow-sm ${borderClass}`;
    if (this.statusCardFilter !== status) return base;
    return `${base} ring-2 ring-teal-500 ring-offset-2 shadow-md`;
  }

  mobileStatusChipClass(status: string, index: number): string {
    const base =
      'w-full min-w-0 text-left rounded-lg px-2 py-1.5 border transition-colors active:scale-[0.98] disabled:opacity-35 disabled:cursor-not-allowed bg-white dark:bg-gray-900';
    const borderClasses = [
      'border-gray-200 dark:border-gray-700',
      'border-blue-200 dark:border-blue-900/50',
      'border-purple-200 dark:border-purple-900/50',
      'border-green-200 dark:border-green-900/50',
      'border-teal-200 dark:border-teal-900/50',
    ];
    const borderClass = borderClasses[index % borderClasses.length] ?? borderClasses[0];
    const active = this.statusCardFilter === status;

    if (active) {
      return `${base} ring-1 ring-teal-500/40 border-teal-500 bg-teal-50 dark:bg-teal-950/50 dark:border-teal-600`;
    }

    return `${base} ${borderClass}`;
  }

  trackOrder(_index: number, order: Order): string {
    return order.id ?? String(order.numeroPedido ?? _index);
  }

  private rebuildDisplayOrders() {
    let list = this.visibleOrders;

    if (this.listFilter === 'pendientes-entrega') {
      list = list.filter((order) => isOrderPendingDelivery(order));
    }

    if (this.statusCardFilter) {
      list = list.filter((order) =>
        orderMatchesStatusCardFilter(order.estado, this.statusCardFilter!, this.appConfig.pedidos)
      );
    }

    const query = this.searchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter((order) => {
        const clientName = this.getClientName(order).toLowerCase();
        const orderNumber = this.getOrderNumber(order).toLowerCase();
        const descripcion = (order.descripcion || '').toLowerCase();
        const estado = this.getOrderStatusLabelFor(order.estado).toLowerCase();
        const productos = (order.productoNombres ?? order.items ?? [])
          .map((line) =>
            typeof line === 'string' ? line.toLowerCase() : line.nombre?.toLowerCase() || ''
          )
          .join(' ');

        return (
          clientName.includes(query) ||
          orderNumber.includes(query) ||
          descripcion.includes(query) ||
          estado.includes(query) ||
          productos.includes(query)
        );
      });
    }

    const direction = this.sortDirection === 'desc' ? -1 : 1;
    this.displayOrders = [...list].sort(
      (a, b) => this.compareOrders(a, b, this.sortColumn) * direction
    );

    const counts: Record<string, number> = {};
    for (const card of this.statusCardEstados) {
      counts[card.value] = 0;
    }

    for (const order of this.visibleOrders) {
      for (const card of this.statusCardEstados) {
        if (orderMatchesStatusCardFilter(order.estado, card.value, this.appConfig.pedidos)) {
          counts[card.value] = (counts[card.value] ?? 0) + 1;
        }
      }
    }

    this.statusCounts = counts;

    if (
      this.statusCardFilter &&
      !this.statusCardEstados.some((card) => card.value === this.statusCardFilter)
    ) {
      this.statusCardFilter = null;
    }
    this.cdr.markForCheck();
  }

  private compareOrders(a: Order, b: Order, column: OrderSortColumn): number {
    let left = 0;
    let right = 0;

    switch (column) {
      case 'fecha':
        left = this.getSortableDate(a.createdAt);
        right = this.getSortableDate(b.createdAt);
        break;
      case 'pedido':
        left = this.getOrderNumberValue(a);
        right = this.getOrderNumberValue(b);
        break;
      case 'entrega':
        left = this.getSortableDate(a.fechaEntrega);
        right = this.getSortableDate(b.fechaEntrega);
        break;
      case 'estado':
        left = this.getOrderStatusSortValue(a);
        right = this.getOrderStatusSortValue(b);
        break;
    }

    if (left === right) {
      return this.getOrderNumberValue(b) - this.getOrderNumberValue(a);
    }

    return left - right;
  }

  private getOrderStatusSortValue(order: Order): number {
    const normalized = normalizeOrderStatus(order.estado);
    const configured = this.appConfig.pedidos.estados ?? [];
    const configIndex = configured.findIndex(
      (estado) => normalizeOrderStatus(estado.value) === normalized
    );
    if (configIndex >= 0) return configIndex;

    const fallbackIndex = ORDER_STATUS_OPTIONS.findIndex((option) => option.value === normalized);
    if (fallbackIndex >= 0) return configured.length + fallbackIndex;

    return configured.length + ORDER_STATUS_OPTIONS.length;
  }

  private getSortableDate(value?: string | null): number {
    if (!value) return 0;
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  private getOrderNumberValue(order: Order): number {
    if (order.numeroPedido != null) {
      return Number(order.numeroPedido) || 0;
    }

    const label = formatOrderNumber(order).replace(/\D/g, '');
    const parsed = Number.parseInt(label, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  ngOnInit() {
    bindListPageRefreshOnReturn({
      listPath: '/orders',
      reload: () => this.reloadList(),
      router: this.router,
      destroyRef: this.destroyRef,
      injector: this.injector,
    });
    this.catalogConfigService.getAppConfig().subscribe((config) => {
      this.appConfig = config;
      this.rebuildDisplayOrders();
    });

    this.route.queryParamMap.subscribe((params) => {
      const nextFilter =
        params.get('filter') === 'pendientes-entrega' ? 'pendientes-entrega' : 'all';
      if (this.listFilter === nextFilter) return;
      this.listFilter = nextFilter;
      this.rebuildDisplayOrders();
    });

    this.fetchOrders();
  }

  ngOnDestroy() {
    clearTimeout(this.searchDebounce);
  }

  reloadList() {
    this.ordersPage = 1;
    this.ordersNextCursor = null;
    this.ordersHasMore = false;
    this.loadingMore = false;
    this.loadOrders();
  }

  loadOrders() {
    this.fetchOrders();
  }

  /**
   * Primer pintado rápido con una página chica y luego completa el resto en
   * segundo plano para que el buscador y los contadores cubran todo el historial.
   */
  private fetchOrders() {
    this.loading = true;
    this.backgroundLoadToken = this.listLoadSession.next();
    const token = this.backgroundLoadToken;
    this.cdr.markForCheck();

    this.orderService.getOrdersPage(PROGRESSIVE_LIST_FIRST_PAGE_SIZE).subscribe({
      next: (page) => {
        if (token !== this.backgroundLoadToken) return;
        this.orders = page.items;
        this.ordersHasMore = page.hasMore;
        this.ordersNextCursor = page.nextCursor;
        this.loading = false;
        this.rebuildDisplayOrders();
        this.loadRemainingOrdersInBackground(token);
      },
      error: () => {
        if (token !== this.backgroundLoadToken) return;
        this.orders = [];
        this.ordersHasMore = false;
        this.ordersNextCursor = null;
        this.loading = false;
        this.rebuildDisplayOrders();
      },
    });
  }

  private loadRemainingOrdersInBackground(token: number) {
    if (token !== this.backgroundLoadToken) return;
    if (!this.ordersHasMore || !this.ordersNextCursor) return;

    this.orderService
      .getOrdersPage(PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE, this.ordersNextCursor)
      .subscribe({
        next: (page) => {
          if (token !== this.backgroundLoadToken) return;
          this.orders = [...this.orders, ...page.items];
          this.ordersHasMore = page.hasMore;
          this.ordersNextCursor = page.nextCursor;
          this.rebuildDisplayOrders();
          this.loadRemainingOrdersInBackground(token);
        },
        error: () => {
          // Mantenemos lo cargado; el botón «cargar más» queda como respaldo.
        },
      });
  }

  loadMoreOrders() {
    if (!this.ordersHasMore || !this.ordersNextCursor || this.loadingMore || this.loading) return;
    this.loadingMore = true;
    this.orderService
      .getOrdersPage(PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE, this.ordersNextCursor)
      .subscribe({
        next: (page) => {
          this.orders = [...this.orders, ...page.items];
          this.ordersHasMore = page.hasMore;
          this.ordersNextCursor = page.nextCursor;
          this.loadingMore = false;
          this.rebuildDisplayOrders();
        },
        error: () => {
          this.loadingMore = false;
          this.cdr.markForCheck();
        },
      });
  }

  getClientName(order: Order): string {
    return (
      order.clienteNombre?.trim() ||
      this.clientsById.get(order.clienteId)?.nombre ||
      'Cliente sin nombre'
    );
  }

  getOrderNumber(order: Order): string {
    return formatOrderNumber(order);
  }

  getOrderDate(order: Order): string | null {
    return order.createdAt ?? null;
  }

  openEditOrder(order: Order) {
    if (!order.id || !this.auth.canViewOrder(order.estado)) return;
    const clientName = this.getClientName(order);
    const clienteNombre =
      order.clienteNombre?.trim() ||
      (clientName !== 'Cliente sin nombre' ? clientName : undefined);

    // Navegamos al instante con los datos que ya tenemos del listado (cabecera y,
    // si vinieron en la página, los ítems). El formulario revalida con getOrder en
    // segundo plano, así que evitamos la espera previa que dejaba los campos vacíos.
    this.router.navigate(['/orders', order.id, 'edit'], {
      state: {
        orderPreview: {
          ...order,
          clienteNombre: order.clienteNombre?.trim() || clienteNombre,
        },
      },
    });
  }

  duplicateOrder(order: Order, event: Event) {
    event.stopPropagation();
    if (!order.id || !this.auth.canEditRecords) return;
    this.router.navigate(['/orders/new'], { queryParams: { duplicate: order.id } });
  }

  printOrder(order: Order) {
    if (!this.auth.canPrintOrders || !order.id || this.printingOrderId === order.id) return;
    this.printingOrderId = order.id;

    this.orderService.getOrder(order.id, { includePhotoUrls: true }).subscribe({
      next: (fullOrder) => {
        this.orderPrintService.printOrders([fullOrder], this.clientsById);
        this.printingOrderId = null;
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el pedido para imprimir.',
        });
        this.printingOrderId = null;
      },
    });
  }

  getOrderSaldo(order: Order): number {
    return resolveOrderBalance(order).saldo;
  }

  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }

  confirmCancelOrder(order: Order) {
    if (!order.id || this.isCancelledOrder(order)) return;

    const clientName = this.getClientName(order);
    const orderNumber = this.getOrderNumber(order);
    const orderRef = orderNumber ? ` #${orderNumber}` : '';

    this.dialogService
      .confirm({
        title: 'Cancelar pedido',
        message:
          `¿Cancelar el pedido${orderRef} de ${clientName}? ` +
          (order.stockDescontado || (order.pagos?.length ?? 0) > 0 || order.movimientoSeniaId
            ? 'El pedido ya tiene movimientos de stock o caja vinculados: se registrarán documentos con signo contrario (restauración de stock y anulación de pagos). No se borra el historial. '
            : '') +
          (order.ventaId
            ? 'Este pedido tiene una venta vinculada: primero tenés que anular la venta.'
            : ''),
        confirmLabel: 'Cancelar pedido',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.orderService.deleteOrder(order.id!).subscribe({
          next: () => this.loadOrders(),
          error: (err) =>
            this.dialogService.alert({
              title: 'No se puede cancelar',
              message:
                typeof err.error?.error === 'string'
                  ? err.error.error
                  : 'No se pudo cancelar el pedido.',
            }),
        });
      });
  }

  isCancelledOrder(order: Order): boolean {
    return normalizeOrderStatus(order.estado) === 'cancelado';
  }
}

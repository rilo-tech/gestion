import { Component, inject, OnDestroy, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { OrderService, Order, formatOrderNumber, resolveOrderBalance } from '../../core/services/order.service';
import { ClientService, Client } from '../../core/services/client.service';
import { OrderPrintService } from '../../core/services/order-print.service';
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
  ORDER_STATUS_OPTIONS,
  canRegisterSaleFromOrder,
} from '../../core/constants/order-status';
import type { OrderEstadoConfig } from '../../core/constants/order-config';
import {
  getOrderStockStatusBadgeClass,
  getOrderStockStatusLabel,
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
        activityModule="orders">
        <a
          headerActions
          routerLink="/orders/new"
          [class]="iconActionLinkClass"
          aria-label="Nuevo pedido"
          title="Nuevo pedido">
          <i-lucide name="clipboard-list" class="w-4 h-4"></i-lucide>
          <span class="hidden sm:inline">Nuevo pedido</span>
        </a>
      </app-module-page-header>

      <div
        class="module-summary-kpis grid gap-3 sm:gap-4 mb-6 sm:mb-8"
        [ngClass]="statusCardGridClass"
        (click)="$event.stopPropagation()">
        <button
          *ngFor="let card of statusCardEstados; let i = index; trackBy: trackStatusCard"
          type="button"
          (click)="setStatusCardFilter(card.value, $event)"
          [class]="statusCardClass(card.value, getOrderStatusCardBorderClass(i))">
          <p class="text-xs font-bold uppercase mb-1" [ngClass]="getOrderStatusCardTitleClass(i)">
            {{ card.label }}
          </p>
          <p class="text-xl font-bold tabular-nums" [ngClass]="getOrderStatusCardValueClass(i)">
            {{ statusCounts[card.value] ?? 0 }}
          </p>
        </button>
      </div>

      <div
        *ngIf="statusCardFilter"
        class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-800">
        <span>
          Mostrando solo pedidos en «{{ getOrderEstadoCardLabel(statusCardFilter) }}».
          Hacé click fuera de las tarjetas para ver todos.
        </span>
        <button
          type="button"
          (click)="clearStatusCardFilter(); $event.stopPropagation()"
          class="font-semibold text-teal-700 hover:underline">
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
        Solo ves pedidos en producción. Pedí acceso al administrador para ver el resto o los entregados.
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
        <table [class]="nativeCompactTableClass + ' sm:min-w-[920px]'">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="hidden sm:table-cell px-6 py-4">
                <button type="button" (click)="toggleSort('fecha')" [class]="sortHeaderClass('fecha')">
                  Fecha
                  <i-lucide
                    *ngIf="sortColumn === 'fecha'"
                    [name]="sortDirection === 'desc' ? 'chevron-down' : 'chevron-up'"
                    class="w-3.5 h-3.5"></i-lucide>
                </button>
              </th>
              <th class="px-4 sm:px-6 py-3 sm:py-4">
                <button type="button" (click)="toggleSort('pedido')" [class]="sortHeaderClass('pedido')">
                  Pedido
                  <i-lucide
                    *ngIf="sortColumn === 'pedido'"
                    [name]="sortDirection === 'desc' ? 'chevron-down' : 'chevron-up'"
                    class="w-3.5 h-3.5"></i-lucide>
                </button>
              </th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Cliente</th>
              <th class="hidden sm:table-cell px-6 py-4">
                <button type="button" (click)="toggleSort('entrega')" [class]="sortHeaderClass('entrega')">
                  Entrega
                  <i-lucide
                    *ngIf="sortColumn === 'entrega'"
                    [name]="sortDirection === 'desc' ? 'chevron-down' : 'chevron-up'"
                    class="w-3.5 h-3.5"></i-lucide>
                </button>
              </th>
              <th class="px-4 sm:px-6 py-3 sm:py-4">
                <button type="button" (click)="toggleSort('estado')" [class]="sortHeaderClass('estado')">
                  Estado
                  <i-lucide
                    *ngIf="sortColumn === 'estado'"
                    [name]="sortDirection === 'desc' ? 'chevron-down' : 'chevron-up'"
                    class="w-3.5 h-3.5"></i-lucide>
                </button>
              </th>
              <th *ngIf="auth.canViewOrderSalePrice || auth.canViewAccountBalance" class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {{ auth.canViewOrderSalePrice && auth.canViewAccountBalance ? 'Total / Saldo' : (auth.canViewOrderSalePrice ? 'Total' : 'Saldo') }}
              </th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let order of paginatedDisplayOrders; trackBy: trackOrder"
              (click)="openEditOrder(order)"
              class="hover:bg-gray-50 transition-colors cursor-pointer">
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                {{ getOrderDate(order) ? (getOrderDate(order) | date:'dd/MM/yyyy') : '—' }}
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm font-semibold text-teal-700 whitespace-nowrap">
                {{ getOrderNumber(order) ? ('#' + getOrderNumber(order)) : '—' }}
                <div class="text-xs font-normal text-gray-400 sm:hidden">
                  {{ getOrderDate(order) ? (getOrderDate(order) | date:'dd/MM/yyyy') : '—' }}
                </div>
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4">
                <div class="font-medium text-gray-900 truncate">{{ getClientName(order) }}</div>
                <div class="text-xs text-gray-400 sm:hidden">
                  Entrega: {{ order.fechaEntrega ? (order.fechaEntrega | date:'dd/MM/yyyy') : '—' }}
                </div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                {{ order.fechaEntrega ? (order.fechaEntrega | date:'dd/MM/yyyy') : '—' }}
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    class="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold"
                    [ngClass]="getOrderStatusBadgeClass(order.estado)">
                    {{ getOrderStatusLabelFor(order.estado) }}
                  </span>
                  <span
                    *ngIf="order.stockPreparado || order.estadoStock"
                    class="inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold border"
                    [ngClass]="getOrderStockStatusBadgeClass(order.estadoStock)">
                    {{ getOrderStockStatusLabel(order.estadoStock) }}
                  </span>
                </div>
              </td>
              <td *ngIf="auth.canViewOrderSalePrice || auth.canViewAccountBalance" class="hidden sm:table-cell px-6 py-4">
                <div *ngIf="auth.canViewOrderSalePrice" class="text-sm font-bold text-gray-900 tabular-nums">{{ '$' + order.total }}</div>
                <div
                  *ngIf="auth.canViewAccountBalance"
                  class="text-xs font-semibold tabular-nums"
                  [class.text-orange-500]="getOrderSaldo(order) > 0"
                  [class.text-gray-400]="!(getOrderSaldo(order) > 0)">
                  Saldo {{ '$' + getOrderSaldo(order) }}
                </div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm font-medium text-right" (click)="$event.stopPropagation()">
                <app-list-row-actions
                  [editIcon]="auth.canEditRecords ? 'pencil' : 'clipboard-list'"
                  [editLabel]="isCancelledOrder(order) ? 'Ver pedido' : (auth.canEditRecords ? 'Editar' : 'Ver pedido')"
                  (editClick)="openEditOrder(order)"
                  [showDuplicate]="auth.canEditRecords"
                  (duplicateClick)="duplicateOrder(order, $event)"
                  [showPrint]="auth.canPrintOrders"
                  [printLoading]="printingOrderId === order.id"
                  (printClick)="printOrder(order)"
                  [showRegisterSale]="auth.canCreateSales && canRegisterSale(order)"
                  (registerSaleClick)="registerSaleFromOrder(order)"
                  [showDelete]="!isCancelledOrder(order) && auth.canEditRecords"
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
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly iconActionLinkClass = ICON_ACTION_LINK_CLASS;
  readonly auth = inject(AuthService);

  private orderService = inject(OrderService);
  private clientService = inject(ClientService);
  private orderPrintService = inject(OrderPrintService);
  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);

  readonly getOrderStatusBadgeClass = getOrderStatusBadgeClass;
  getOrderStatusLabelFor(estado?: string): string {
    return getOrderStatusLabel(estado, this.appConfig.pedidos);
  }
  getOrderEstadoCardLabel(value: string): string {
    return getOrderStatusLabelFromConfig(value, this.appConfig.pedidos);
  }
  readonly normalizeOrderStatus = normalizeOrderStatus;
  readonly getOrderStatusCardBorderClass = getOrderStatusCardBorderClass;
  readonly getOrderStatusCardTitleClass = getOrderStatusCardTitleClass;
  readonly getOrderStatusCardValueClass = getOrderStatusCardValueClass;
  readonly canRegisterSale = canRegisterSaleFromOrder;
  readonly getOrderStockStatusLabel = getOrderStockStatusLabel;
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

  get statusCardEstados(): OrderEstadoConfig[] {
    return getOrderStatusCardEstados(this.appConfig.pedidos).filter((card) =>
      this.canShowStatusCard(card.value)
    );
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
      'inline-flex items-center gap-1 uppercase tracking-wider font-semibold text-xs transition-colors';
    if (this.sortColumn === column) {
      return `${base} text-teal-600`;
    }
    return `${base} text-gray-400 hover:text-gray-600`;
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

  setStatusCardFilter(status: string, event: Event) {
    event.stopPropagation();
    this.statusCardFilter = status;
    this.ordersPage = 1;
    this.rebuildDisplayOrders();
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

    forkJoin({
      clients: this.clientService.getClients(),
      ordersPage: this.orderService.getOrdersPage(120),
    }).subscribe({
      next: ({ clients, ordersPage }) => {
        this.clientsById = new Map(
          clients.filter((client) => client.id).map((client) => [client.id!, client])
        );
        this.orders = ordersPage.items;
        this.ordersHasMore = ordersPage.hasMore;
        this.ordersNextCursor = ordersPage.nextCursor;
        this.loading = false;
        this.rebuildDisplayOrders();
      },
      error: () => {
        this.orders = [];
        this.ordersHasMore = false;
        this.ordersNextCursor = null;
        this.loading = false;
        this.rebuildDisplayOrders();
      },
    });
  }

  ngOnDestroy() {
    clearTimeout(this.searchDebounce);
  }

  loadOrders() {
    this.loading = true;
    this.cdr.markForCheck();
    this.orderService.getOrdersPage(120).subscribe({
      next: (page) => {
        this.orders = page.items;
        this.ordersHasMore = page.hasMore;
        this.ordersNextCursor = page.nextCursor;
        this.loading = false;
        this.rebuildDisplayOrders();
      },
      error: () => {
        this.orders = [];
        this.ordersHasMore = false;
        this.ordersNextCursor = null;
        this.loading = false;
        this.rebuildDisplayOrders();
      },
    });
  }

  loadMoreOrders() {
    if (!this.ordersHasMore || !this.ordersNextCursor || this.loadingMore || this.loading) return;
    this.loadingMore = true;
    this.orderService.getOrdersPage(120, this.ordersNextCursor).subscribe({
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
    return this.clientsById.get(order.clienteId)?.nombre ?? 'Cliente sin nombre';
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
    const orderPreview: Order = {
      ...order,
      clienteNombre:
        order.clienteNombre?.trim() ||
        (clientName !== 'Cliente sin nombre' ? clientName : undefined),
    };
    this.router.navigate(['/orders', order.id, 'edit'], {
      state: { orderPreview },
    });
  }

  duplicateOrder(order: Order, event: Event) {
    event.stopPropagation();
    if (!order.id || !this.auth.canEditRecords) return;
    this.router.navigate(['/orders/new'], { queryParams: { duplicate: order.id } });
  }

  registerSaleFromOrder(order: Order) {
    if (!order.id || !canRegisterSaleFromOrder(order)) return;
    this.router.navigate(['/sales'], { queryParams: { pedidoId: order.id } });
  }

  printOrder(order: Order) {
    if (!this.auth.canPrintOrders || !order.id || this.printingOrderId === order.id) return;
    this.printingOrderId = order.id;

    this.orderService.getOrder(order.id).subscribe({
      next: (fullOrder) => {
        this.orderPrintService.printOrders([fullOrder], this.clientsById);
        this.printingOrderId = null;
      },
      error: () => {
        this.orderPrintService.printOrders([order], this.clientsById);
        this.printingOrderId = null;
      },
    });
  }

  getOrderSaldo(order: Order): number {
    return resolveOrderBalance(order).saldo;
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

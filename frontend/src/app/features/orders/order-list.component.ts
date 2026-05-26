import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  ORDER_STATUS_CARD_KEYS,
  canRegisterSaleFromOrder,
} from '../../core/constants/order-status';
import {
  getOrderStockStatusBadgeClass,
  getOrderStockStatusLabel,
} from '../../core/constants/order-stock-status';
import {
  ICON_ACTION_LINK_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { LucideAngularModule } from 'lucide-angular';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink, ActivityLogTriggerComponent],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Pedidos</h1>
          <p class="text-sm sm:text-base text-gray-500">Gestiona tus pedidos personalizados y su producción.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <app-activity-log-trigger module="orders"></app-activity-log-trigger>
          <a
            routerLink="/orders/new"
            [class]="iconActionLinkClass"
            aria-label="Nuevo pedido"
            title="Nuevo pedido">
            <i-lucide name="clipboard-list" class="w-4 h-4"></i-lucide>
            <span class="hidden sm:inline">Nuevo pedido</span>
          </a>
        </div>
      </div>

      <div class="module-summary-kpis grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div *ngIf="auth.canViewAllOrders" class="bg-gray-50 p-4 rounded-xl border border-gray-200">
          <p class="text-xs font-bold text-gray-500 uppercase mb-1">{{ getOrderEstadoCardLabel('borrador') }}</p>
          <p class="text-xl font-bold text-gray-800">{{ statusCounts.borrador }}</p>
        </div>
        <div *ngIf="auth.canViewAllOrders" class="bg-gray-50 p-4 rounded-xl border border-blue-200">
          <p class="text-xs font-bold text-blue-500 uppercase mb-1">{{ getOrderEstadoCardLabel('pendiente') }}</p>
          <p class="text-xl font-bold text-blue-500">{{ statusCounts.pendiente }}</p>
        </div>
        <div class="bg-gray-50 p-4 rounded-xl border border-purple-200">
          <p class="text-xs font-bold text-purple-500 uppercase mb-1">{{ getOrderEstadoCardLabel('en_produccion') }}</p>
          <p class="text-xl font-bold text-purple-500">{{ statusCounts.en_produccion }}</p>
        </div>
        <div *ngIf="auth.canViewAllOrders" class="bg-gray-50 p-4 rounded-xl border border-green-200">
          <p class="text-xs font-bold text-green-500 uppercase mb-1">{{ getOrderEstadoCardLabel('listo') }}</p>
          <p class="text-xl font-bold text-green-500">{{ statusCounts.listo }}</p>
        </div>
        <div *ngIf="auth.canViewDeliveredOrders" class="bg-gray-50 p-4 rounded-xl border border-teal-200">
          <p class="text-xs font-bold text-teal-500 uppercase mb-1">{{ getOrderEstadoCardLabel('entregado') }}</p>
          <p class="text-xl font-bold text-teal-500">{{ statusCounts.entregado }}</p>
        </div>
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

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
          <input
            [(ngModel)]="searchQuery"
            name="ordersSearchQuery"
            placeholder="Buscar por pedido, cliente, descripción, estado o producto..."
            class="w-full max-w-xl px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 bg-white">
        </div>
        <div [class]="tableScrollClass">
        <table [class]="tableMinWidthClass">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Pedido</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Cliente</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Entrega</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
              <th *ngIf="auth.canViewOrderSalePrice || auth.canViewAccountBalance" class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {{ auth.canViewOrderSalePrice && auth.canViewAccountBalance ? 'Total / Saldo' : (auth.canViewOrderSalePrice ? 'Total' : 'Saldo') }}
              </th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let order of filteredOrders"
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
              <td class="hidden sm:table-cell px-6 py-4 text-sm font-medium" (click)="$event.stopPropagation()">
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    (click)="openEditOrder(order)"
                    [title]="isCancelledOrder(order) ? 'Ver pedido' : (auth.canEditRecords ? 'Editar' : 'Ver pedido')"
                    class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800">
                    <i-lucide [name]="auth.canEditRecords ? 'pencil' : 'clipboard-list'" class="w-4 h-4"></i-lucide>
                  </button>
                  <button
                    *ngIf="auth.canEditRecords"
                    type="button"
                    (click)="duplicateOrder(order, $event)"
                    title="Duplicar"
                    class="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900">
                    <i-lucide name="copy" class="w-4 h-4"></i-lucide>
                  </button>
                  <button
                    *ngIf="auth.canPrintOrders"
                    type="button"
                    (click)="printOrder(order)"
                    title="Imprimir pedido"
                    class="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900">
                    <i-lucide name="printer" class="w-4 h-4"></i-lucide>
                  </button>
                  <button
                    *ngIf="canRegisterSale(order) && auth.canCreateSales"
                    type="button"
                    (click)="registerSaleFromOrder(order)"
                    title="Registrar venta / entrega"
                    class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800">
                    <i-lucide name="truck" class="w-4 h-4"></i-lucide>
                  </button>
                  <button
                    *ngIf="!isCancelledOrder(order) && auth.canEditRecords"
                    type="button"
                    (click)="confirmCancelOrder(order)"
                    title="Cancelar pedido"
                    class="p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700">
                    <i-lucide name="trash-2" class="w-4 h-4"></i-lucide>
                  </button>
                </div>
              </td>
            </tr>
            <tr *ngIf="!loading && visibleOrders.length > 0 && filteredOrders.length === 0" class="sm:hidden">
              <td colspan="3" class="px-4 py-12 text-center text-gray-400">
                <ng-container *ngIf="listFilter === 'pendientes-entrega' && !searchQuery.trim()">
                  No hay pedidos confirmados pendientes de entrega.
                </ng-container>
                <ng-container *ngIf="listFilter !== 'pendientes-entrega' || searchQuery.trim()">
                  No se encontraron pedidos para "{{ searchQuery }}".
                </ng-container>
              </td>
            </tr>
            <tr *ngIf="!loading && visibleOrders.length > 0 && filteredOrders.length === 0" class="hidden sm:table-row">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                <ng-container *ngIf="listFilter === 'pendientes-entrega' && !searchQuery.trim()">
                  No hay pedidos confirmados pendientes de entrega.
                </ng-container>
                <ng-container *ngIf="listFilter !== 'pendientes-entrega' || searchQuery.trim()">
                  No se encontraron pedidos para "{{ searchQuery }}".
                </ng-container>
              </td>
            </tr>
            <tr *ngIf="!loading && visibleOrders.length === 0" class="sm:hidden">
              <td colspan="3" class="px-4 py-12 text-center text-gray-400">
                No hay pedidos registrados.
              </td>
            </tr>
            <tr *ngIf="!loading && visibleOrders.length === 0" class="hidden sm:table-row">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                No hay pedidos registrados.
              </td>
            </tr>
            <tr *ngIf="loading" class="sm:hidden">
              <td colspan="3" class="px-4 py-12 text-center text-gray-400">
                Cargando pedidos...
              </td>
            </tr>
            <tr *ngIf="loading" class="hidden sm:table-row">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                Cargando pedidos...
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </div>
  `,
})
export class OrderListComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly tableMinWidthClass = 'w-full text-left border-collapse sm:min-w-[920px]';
  readonly iconActionLinkClass = ICON_ACTION_LINK_CLASS;
  readonly auth = inject(AuthService);

  private orderService = inject(OrderService);
  private clientService = inject(ClientService);
  private orderPrintService = inject(OrderPrintService);
  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);

  readonly getOrderStatusBadgeClass = getOrderStatusBadgeClass;
  getOrderStatusLabelFor(estado?: string): string {
    return getOrderStatusLabel(estado, this.appConfig.pedidos);
  }
  getOrderEstadoCardLabel(value: string): string {
    return getOrderStatusLabelFromConfig(value, this.appConfig.pedidos);
  }
  readonly normalizeOrderStatus = normalizeOrderStatus;
  readonly canRegisterSale = canRegisterSaleFromOrder;
  readonly getOrderStockStatusLabel = getOrderStockStatusLabel;
  readonly getOrderStockStatusBadgeClass = getOrderStockStatusBadgeClass;

  orders: Order[] = [];
  clientsById = new Map<string, Client>();
  loading = true;
  searchQuery = '';
  listFilter: 'all' | 'pendientes-entrega' = 'all';

  get visibleOrders(): Order[] {
    return this.orders.filter((order) => this.auth.canViewOrder(order.estado));
  }

  get filteredOrders(): Order[] {
    let list = this.visibleOrders;

    if (this.listFilter === 'pendientes-entrega') {
      list = list.filter((order) => isOrderPendingDelivery(order));
    }

    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return list;

    return list.filter((order) => {
      const clientName = this.getClientName(order).toLowerCase();
      const orderNumber = this.getOrderNumber(order).toLowerCase();
      const descripcion = (order.descripcion || '').toLowerCase();
      const estado = this.getOrderStatusLabelFor(order.estado).toLowerCase();
      const productos = (order.items ?? [])
        .map((line) => line.nombre?.toLowerCase() || '')
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

  get statusCounts() {
    const counts: Record<(typeof ORDER_STATUS_CARD_KEYS)[number], number> = {
      borrador: 0,
      pendiente: 0,
      en_produccion: 0,
      listo: 0,
      entregado: 0,
    };

    for (const order of this.visibleOrders) {
      const status = normalizeOrderStatus(order.estado);
      if (status === 'entregado_con_saldo') {
        counts.entregado++;
      } else if (status !== 'otro') {
        counts[status]++;
      }
    }

    return counts;
  }

  ngOnInit() {
    this.catalogConfigService.getAppConfig().subscribe((config) => {
      this.appConfig = config;
    });

    this.route.queryParamMap.subscribe((params) => {
      this.listFilter = params.get('filter') === 'pendientes-entrega' ? 'pendientes-entrega' : 'all';
    });

    this.clientService.getClients().subscribe((clients) => {
      this.clientsById = new Map(
        clients.filter((client) => client.id).map((client) => [client.id!, client])
      );
    });
    this.loadOrders();
  }

  loadOrders() {
    this.loading = true;
    this.orderService.getOrders().subscribe({
      next: (orders) => {
        this.orders = orders;
        this.loading = false;
      },
      error: () => {
        this.orders = [];
        this.loading = false;
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
    this.router.navigate(['/orders', order.id, 'edit']);
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
    if (!this.auth.canPrintOrders || !order.id) return;

    this.orderService.getOrder(order.id).subscribe({
      next: (fullOrder) => {
        this.orderPrintService.printOrders([fullOrder], this.clientsById);
      },
      error: () => {
        this.orderPrintService.printOrders([order], this.clientsById);
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

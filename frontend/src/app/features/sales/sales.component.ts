import { Component, ViewChild, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  CreateSalePayload,
  EligibleOrderForSale,
  Sale,
  SaleLine,
  SaleLineExtraCost,
  SalesService,
  formatSaleLabel,
} from '../../core/services/sales.service';
import { Client, ClientService } from '../../core/services/client.service';
import { OrderService } from '../../core/services/order.service';
import { StockService } from '../../core/services/stock.service';
import { DialogService } from '../../core/services/dialog.service';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  readSalesFormDraft,
  clearSalesFormDraft,
  saveSalesFormDraft,
} from '../../core/utils/form-return-context';
import { prefersInlineFormPage } from '../../core/utils/responsive-form';
import {
  IconActionComponent,
  LIST_TABLE_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
  FORM_SUBMIT_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { SaleCounterFormPanelComponent } from './sale-counter-form-panel.component';
import { CompactListRowComponent } from '../../shared/components/compact-list/compact-list-row.component';
import {
  COMPACT_LIST_EMPTY_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
} from '../../shared/components/list-pagination/list-pagination.component';
import { ModalFormFooterComponent } from '../../shared/components/modal-form-footer/modal-form-footer.component';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { PERMISSIONS } from '../../core/constants/permissions';
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';
import {
  TransactionLinesTableComponent,
  buildTransactionTableColumns,
  SALE_DETAIL_TABLE_COLUMNS,
} from '../../shared/components/transaction-lines-table/transaction-lines-table.component';
import { TransactionTableLine } from '../../shared/components/transaction-lines-table/transaction-lines-table.types';
import { TransactionLinesSectionComponent } from '../../shared/components/transaction-lines-section/transaction-lines-section.component';
import {
  TransactionDetailPageComponent,
  TransactionDetailMetadataComponent,
  TransactionDetailMetaItem,
  TransactionSummaryPanelComponent,
  TransactionSummaryRowComponent,
  TransactionFormSaveEvent,
} from '../../shared/components/transaction-form';
import { RecordActionToolbarComponent, IconToolbarButtonComponent } from '../../shared/components/icon-toolbar';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { ListLoadMoreComponent } from '../../shared/components/list-load-more/list-load-more.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';

type SaleModalMode = 'mostrador' | 'pedido' | 'edit';

@Component({
  selector: 'app-sales',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    SearchableSelectComponent,
    TransactionModalComponent,
    IconActionComponent,
    HasPermissionDirective,
    ActivityLogTriggerComponent,
    ListRowActionsComponent,
    ListPaginationComponent,
    ModalFormFooterComponent,
    CompactListRowComponent,
    SaleCounterFormPanelComponent,
    TransactionLinesTableComponent,
    TransactionLinesSectionComponent,
    TransactionDetailPageComponent,
    TransactionDetailMetadataComponent,
    TransactionSummaryPanelComponent,
    TransactionSummaryRowComponent,
    RecordActionToolbarComponent,
    IconToolbarButtonComponent,
    ModulePageHeaderComponent,
    CompactDataListComponent,
    ListLoadMoreComponent,
    ListSearchFieldComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Ventas"
        description="Ventas de mostrador acá; la entrega de un pedido se registra desde Pedidos. Los pagos previos del pedido no se duplican en caja."
        [showMobileSearch]="auth.canViewSalesHistory"
        [(searchQuery)]="searchQuery"
        (searchQueryChange)="salesPage = 1"
        searchFieldName="salesSearchQueryMobile"
        activityModule="sales">
        <app-icon-action
          headerActions
          *ngIf="auth.canCreateSales"
          label="Venta mostrador"
          (clicked)="openSaleModal('mostrador')">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
        </app-icon-action>
      </app-module-page-header>

      <div *ngIf="auth.canViewSalesSummary" class="module-summary-kpis grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
        <div class="bg-white p-4 sm:p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Ventas registradas</p>
          <p class="text-2xl font-bold text-gray-900">{{ sales.length }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Facturado</p>
          <p class="text-2xl font-bold text-gray-900">{{ '$' + totalFacturado }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Cobrado en ventas</p>
          <p class="text-2xl font-bold text-teal-600">{{ '$' + totalCobradoEnVentas }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Saldo pendiente</p>
          <p class="text-2xl font-bold text-orange-500">{{ '$' + totalSaldoPendiente }}</p>
        </div>
      </div>

      <div
        *ngIf="auth.canCreateSales && !auth.canViewSalesHistory"
        class="mb-6 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-800 desc-lg-only">
        Podés registrar ventas de mostrador. Las entregas de pedidos se hacen desde Pedidos. El historial completo lo ve quien tenga ese permiso.
      </div>

      <app-compact-data-list *ngIf="auth.canViewSalesHistory" [showSearch]="true">
        <div listSearch [class]="desktopListSearchWrapClass">
          <app-list-search-field
            mode="filter"
            [(query)]="searchQuery"
            (queryChange)="salesPage = 1"
            name="salesSearchQuery"
            placeholder="Buscar por venta, cliente, pedido o producto...">
          </app-list-search-field>
        </div>
        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <app-compact-list-row
            *ngFor="let sale of paginatedFilteredSales"
            (activate)="openSaleDetail(sale)">
            <div compactTitle class="compact-list-title flex items-baseline gap-1.5 min-w-0">
              <span
                *ngIf="sale.estado === 'borrador'"
                class="shrink-0 text-amber-600 font-semibold">
                Borrador
              </span>
              <span *ngIf="sale.estado !== 'borrador'" class="shrink-0 tabular-nums">#{{ formatSaleLabel(sale) }}</span>
              <span class="truncate min-w-0 font-normal text-gray-600">{{ sale.clienteNombre?.trim() || '—' }}</span>
            </div>
            <div compactSubtitle class="compact-list-subtitle truncate">
              <ng-container *ngIf="sale.origen === 'pedido'">Pedido #{{ sale.numeroPedidoLabel || '—' }}</ng-container>
              <ng-container *ngIf="sale.origen !== 'pedido'">Mostrador</ng-container>
            </div>
            <span
              *ngIf="auth.canViewOrderSalePrice"
              compactTrailing
              class="text-[11px] font-bold tabular-nums shrink-0 text-gray-900">
              {{ '$' + (sale.total || 0) }}
            </span>
            <span
              *ngIf="!auth.canViewOrderSalePrice && auth.canViewAccountBalance"
              compactTrailing
              class="text-[11px] font-bold tabular-nums shrink-0"
              [class.text-orange-500]="(sale.saldoPendiente || 0) > 0"
              [class.text-gray-500]="!(sale.saldoPendiente || 0)">
              {{ '$' + (sale.saldoPendiente || 0) }}
            </span>
          </app-compact-list-row>
          <p *ngIf="loading" [class]="compactListEmptyClass">Cargando ventas...</p>
          <p *ngIf="!loading && sales.length === 0" [class]="compactListEmptyClass">
            Todavía no hay ventas. Registrá una venta de mostrador o entregá un pedido listo desde Pedidos.
          </p>
          <p *ngIf="!loading && sales.length > 0 && filteredSales.length === 0" [class]="compactListEmptyClass">
            No hay ventas que coincidan con la búsqueda.
          </p>
        </div>
        <div listDesktop class="hidden sm:block" [class]="tableScrollClass">
        <table [class]="nativeCompactTableClass + ' sm:min-w-[720px]'">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Venta</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Cliente</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Origen</th>
              <th *ngIf="auth.canViewOrderSalePrice" class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total</th>
              <th *ngIf="auth.canViewAccountBalance" class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Cobrado / Saldo</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let sale of paginatedFilteredSales"
              (click)="openSaleDetail(sale)"
              [class]="listTableRowClass">
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                {{ formatDate(sale.fecha) }}
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm font-semibold text-teal-700">
                <span *ngIf="sale.estado === 'borrador'" class="text-amber-700">Borrador</span>
                <span *ngIf="sale.estado !== 'borrador'">#{{ formatSaleLabel(sale) }}</span>
                <div class="text-xs font-normal text-gray-400 sm:hidden">{{ formatDate(sale.fecha) }}</div>
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm text-gray-700">
                <div class="truncate">{{ sale.clienteNombre?.trim() || '—' }}</div>
                <div class="text-xs text-gray-400 sm:hidden truncate">
                  <ng-container *ngIf="sale.origen === 'pedido'">Pedido #{{ sale.numeroPedidoLabel || '—' }}</ng-container>
                  <ng-container *ngIf="sale.origen !== 'pedido'">Mostrador</ng-container>
                </div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm" (click)="$event.stopPropagation()">
                <ng-container *ngIf="sale.origen === 'pedido' && sale.pedidoId">
                  <a
                    [routerLink]="['/orders', sale.pedidoId, 'edit']"
                    class="text-teal-600 hover:underline font-medium">
                    Pedido #{{ sale.numeroPedidoLabel || '—' }}
                  </a>
                  <p *ngIf="sale.totalPagadoAnterior" class="text-xs text-gray-400 mt-0.5">
                    Ya pagado en pedido: {{ '$' + sale.totalPagadoAnterior }}
                  </p>
                </ng-container>
                <span *ngIf="sale.origen !== 'pedido'" class="text-gray-600">Mostrador</span>
              </td>
              <td *ngIf="auth.canViewOrderSalePrice" class="hidden sm:table-cell px-6 py-4 text-sm font-semibold text-right tabular-nums text-gray-900">
                {{ '$' + (sale.total || 0) }}
                <div *ngIf="auth.canViewEconomics && sale.costoReal != null && sale.costoReal > 0" class="text-xs font-normal text-gray-400 mt-0.5">
                  Costo {{ '$' + sale.costoReal }}
                  · Gan. {{ '$' + (sale.gananciaEstimada || 0) }}
                </div>
              </td>
              <td *ngIf="auth.canViewAccountBalance" class="hidden sm:table-cell px-6 py-4 text-sm text-right tabular-nums">
                <div class="font-semibold text-teal-700">{{ '$' + (sale.montoCobrado || 0) }}</div>
                <div
                  class="text-xs font-semibold"
                  [class.text-orange-500]="(sale.saldoPendiente || 0) > 0"
                  [class.text-gray-400]="!(sale.saldoPendiente || 0)">
                  Saldo {{ '$' + (sale.saldoPendiente || 0) }}
                </div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm font-medium" (click)="$event.stopPropagation()">
                <app-list-row-actions
                  [showDelete]="canDeleteSale(sale)"
                  editLabel="Ver / editar venta"
                  (editClick)="openSaleDetail(sale)"
                  (deleteClick)="confirmDeleteSale(sale)">
                  <button
                    rowActionStart
                    *ngIf="auth.canAccessCash && canCollectSaleBalance(sale)"
                    type="button"
                    (click)="openCollectModal(sale); $event.stopPropagation()"
                    title="Cobrar saldo"
                    aria-label="Cobrar saldo"
                    class="p-2 rounded-lg text-orange-600 hover:bg-orange-50 hover:text-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/40">
                    <i-lucide name="wallet" class="w-4 h-4"></i-lucide>
                  </button>
                </app-list-row-actions>
              </td>
            </tr>
            <tr *ngIf="loading">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">Cargando ventas...</td>
            </tr>
            <tr *ngIf="!loading && sales.length === 0">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                Todavía no hay ventas. Registrá una venta de mostrador o entregá un pedido listo desde Pedidos.
              </td>
            </tr>
            <tr *ngIf="!loading && sales.length > 0 && filteredSales.length === 0">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                No hay ventas que coincidan con la búsqueda.
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <app-list-pagination
          listFooter
          [page]="salesPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredSales.length"
          (pageChange)="salesPage = $event">
        </app-list-pagination>
        <app-list-load-more
          listFooter
          [hasMore]="salesHasMore"
          [loading]="loadingMoreSales"
          label="Cargar más ventas"
          (loadMoreClick)="loadMoreSales()">
        </app-list-load-more>
      </app-compact-data-list>
    </div>

    <app-transaction-modal
      [open]="saleModalOpen"
      [title]="saleModalTitle"
      [subtitle]="saleModalSubtitle"
      (closed)="closeSaleModal()">

        <app-icon-toolbar-button
          *ngIf="saleModalMode === 'mostrador' || saleModalMode === 'edit'"
          headerActions
          class="sm:hidden"
          icon="save"
          [label]="saleModalSaveLabel"
          variant="primary"
          [disabled]="saleModalSaving"
          [loading]="saleModalSaving"
          (clicked)="saleCounterPanel?.submitSale()">
        </app-icon-toolbar-button>
        <app-icon-toolbar-button
          *ngIf="saleModalMode === 'pedido'"
          headerActions
          class="sm:hidden"
          icon="save"
          [label]="saleModalPrimaryLabel"
          variant="primary"
          [disabled]="!!saleSubmitBlockedReason || savingSale"
          [loading]="savingSale"
          (clicked)="submitSale()">
        </app-icon-toolbar-button>

        <ng-container *ngIf="saleModalMode === 'pedido'">
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Buscar por cliente (opcional)</label>
            <app-searchable-select
              [(ngModel)]="orderFilterClienteId"
              name="orderFilterClienteId"
              [labeledOptions]="clientOptions"
              (ngModelChange)="onOrderClientFilterChange()"
              placeholder="Filtrar pedidos por cliente..."
              listHint="Dejá vacío para ver todos los pedidos listos."
              emptyOptionsMessage="No hay clientes cargados.">
            </app-searchable-select>
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Pedido listo para entregar</label>
            <app-searchable-select
              [(ngModel)]="selectedOrderId"
              name="selectedOrderId"
              [labeledOptions]="orderSelectOptions"
              (ngModelChange)="onOrderSelected()"
              placeholder="Buscar por N° pedido, cliente o descripción..."
              listHint="El cobro se registra como pago del pedido en caja."
              emptyOptionsMessage="No hay pedidos listos sin venta.">
            </app-searchable-select>
            <p *ngIf="eligibleOrders.length === 0" class="text-xs text-orange-600 mt-2">
              No hay pedidos listos sin venta. Marcá un pedido como listo desde Pedidos.
            </p>
          </div>

          <div *ngIf="selectedOrder" class="rounded-xl border border-gray-100 bg-gray-50 p-4 mb-4 space-y-2 text-sm">
            <div class="flex justify-between gap-4">
              <span class="text-gray-500">Cliente</span>
              <span class="font-medium text-right">{{ selectedOrder.clienteNombre || getClientName(selectedOrder.clienteId) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">Total pedido</span>
              <span class="font-bold tabular-nums">{{ '$' + selectedOrder.total }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">Ya pagado (seña / cuotas)</span>
              <span class="font-semibold text-teal-700 tabular-nums">{{ '$' + selectedOrder.totalPagadoAnterior }}</span>
            </div>
            <div class="flex justify-between border-t border-gray-200 pt-2">
              <span class="text-gray-700 font-medium">Saldo a cobrar</span>
              <span class="font-bold text-orange-600 tabular-nums">{{ '$' + selectedOrder.saldoPedido }}</span>
            </div>
            <div *ngIf="auth.canViewEconomics && selectedOrder.costoReal" class="flex justify-between text-xs text-gray-500">
              <span>Costo registrado en pedido</span>
              <span class="tabular-nums">{{ '$' + selectedOrder.costoReal }}</span>
            </div>
            <p *ngIf="selectedOrder.descripcion" class="text-xs text-gray-500 pt-1">
              {{ selectedOrder.descripcion }}
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Monto a cobrar ahora</label>
              <input
                type="number"
                [(ngModel)]="montoCobrado"
                min="0"
                class="w-full px-4 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-teal-500"
                [class.border-red-300]="montoCobradoError"
                [class.border-gray-200]="!montoCobradoError">
              <p *ngIf="montoCobradoError" class="text-xs text-red-600 mt-1">
                {{ montoCobradoError }}
                <button
                  *ngIf="montoCobradoExceedsMax"
                  type="button"
                  (click)="useMaxMontoCobrado()"
                  class="ml-1 font-semibold text-teal-700 hover:underline">
                  Usar \${{ maxMontoCobrado }}
                </button>
              </p>
              <p *ngIf="!montoCobradoError" class="text-xs text-gray-400 mt-1">
                Dejá menos que el total si el cliente paga después.
              </p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Medio de pago</label>
              <select
                [(ngModel)]="medioPago"
                class="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-500">
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Notas (opcional)</label>
            <textarea
              [(ngModel)]="saleNotas"
              rows="2"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
            </textarea>
          </div>

          <p *ngIf="saleSubmitBlockedReason" class="text-sm text-red-600 mb-2 text-right">
            {{ saleSubmitBlockedReason }}
          </p>
          <app-modal-form-footer
            [saving]="savingSale"
            [primaryLabel]="saleModalPrimaryLabel"
            [primaryDisabled]="!!saleSubmitBlockedReason"
            (cancelClick)="closeSaleModal()"
            (primaryClick)="submitSale()">
          </app-modal-form-footer>
        </ng-container>

        <app-sale-counter-form-panel
          *ngIf="saleModalOpen && (saleModalMode === 'mostrador' || saleModalMode === 'edit')"
          #saleCounterPanel
          [editingSaleId]="saleModalMode === 'edit' ? editingSaleId : null"
          [pageLayout]="false"
          (saved)="onCounterSaleSaved($event)"
          (savingChange)="onCounterSaleSavingChange($event)"
          (cancelled)="closeSaleModal()">
        </app-sale-counter-form-panel>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="collectModalOpen"
      title="Cobrar saldo"
      [subtitle]="collectModalSubtitle"
      maxWidthClass="max-w-md"
      (closed)="closeCollectModal()">
      <div class="space-y-4">
        <div class="rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm">
          <div class="flex justify-between gap-4">
            <span class="text-gray-500">Saldo pendiente</span>
            <span class="font-bold tabular-nums text-orange-600">{{ '$' + collectSaldo }}</span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Monto a cobrar</label>
          <input
            type="number"
            [(ngModel)]="collectMonto"
            min="0"
            [max]="collectSaldo"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Medio de pago</label>
          <select
            [(ngModel)]="collectMedio"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-500">
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Notas (opcional)</label>
          <input
            [(ngModel)]="collectNotas"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
        </div>
      </div>
      <app-modal-form-footer
        [saving]="collectSaving"
        primaryLabel="Registrar en caja"
        (cancelClick)="closeCollectModal()"
        (primaryClick)="submitCollect()">
      </app-modal-form-footer>
    </app-transaction-modal>

    <app-transaction-detail-page
      *ngIf="detailModalOpen"
      [title]="detailModalTitle"
      [subtitle]="detailModalSubtitle"
      backLabel="Volver a ventas"
      backAriaLabel="Volver a ventas"
      [loading]="detailLoading"
      [hasContent]="!!detailSale"
      [hasHeaderActions]="!!detailSale"
      loadingMessage="Cargando venta..."
      refreshingMessage="Actualizando detalle..."
      (closeClick)="closeDetailModal()">
      <div headerActions *ngIf="detailSale as sale">
        <app-record-action-toolbar
          [showDuplicate]="canDuplicateDetailSale(sale)"
          duplicateLabel="Duplicar venta"
          (duplicateClick)="duplicateDetailSale()"
          [showEdit]="canEditSale(sale)"
          editLabel="Editar venta"
          (editClick)="editFromDetail()"
          [showCollect]="canCollectSaleBalance(sale)"
          (collectClick)="collectFromDetail()"
          [showDelete]="canDeleteSale(sale)"
          deleteLabel="Eliminar venta"
          (deleteClick)="confirmDeleteFromDetail()">
        </app-record-action-toolbar>
      </div>

      <ng-container main *ngIf="detailSale as sale">
        <app-transaction-detail-metadata [items]="getDetailSaleMetaItems(sale)"></app-transaction-detail-metadata>

        <app-transaction-lines-section
          title="Productos"
          icon="package"
          [lineCount]="sale.items?.length ?? 0"
          [searchVisible]="false">
          <app-transaction-lines-table
            [lines]="getDetailSaleTableLines(sale)"
            [columns]="detailSaleTableColumns"
            [readOnly]="true"
            [showEmptyPlaceholder]="true"
            emptyMessage="Sin productos registrados.">
          </app-transaction-lines-table>
        </app-transaction-lines-section>

        <div *ngIf="sale.cobros?.length" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          <div class="px-3 sm:px-4 py-2 sm:py-3 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-100 dark:border-gray-800">
            <p class="text-[11px] sm:text-sm font-semibold text-gray-700 dark:text-gray-200">Cobros posteriores</p>
          </div>
          <div class="divide-y divide-gray-50 dark:divide-gray-800">
            <div
              *ngFor="let cobro of sale.cobros"
              class="flex justify-between gap-4 px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">
              <span class="text-gray-600 dark:text-gray-400">{{ formatDate(cobro.fecha) }} · {{ cobro.medioPago || 'efectivo' }}</span>
              <span class="font-semibold tabular-nums text-teal-700 dark:text-teal-400">{{ '$' + cobro.monto }}</span>
            </div>
          </div>
        </div>

        <p *ngIf="sale.notas?.trim()" class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-3 sm:p-4">
          <span class="font-medium text-gray-700 dark:text-gray-300">Notas:</span> {{ sale.notas }}
        </p>
      </ng-container>

      <app-transaction-summary-panel aside *ngIf="detailSale as sale">
        <div class="space-y-2 sm:space-y-3">
          <app-transaction-summary-row label="Total venta" [value]="'$' + (sale.total || 0)"></app-transaction-summary-row>
          <app-transaction-summary-row
            *ngIf="sale.totalPagadoAnterior"
            label="Ya pagado en pedido"
            [value]="'$' + sale.totalPagadoAnterior"
            valueTone="teal"></app-transaction-summary-row>
          <app-transaction-summary-row
            label="Cobrado en esta venta"
            [value]="'$' + (sale.montoCobrado || 0)"
            valueTone="teal"></app-transaction-summary-row>
          <app-transaction-summary-row
            label="Saldo pendiente"
            [value]="'$' + (sale.saldoPendiente || 0)"
            [valueTone]="(sale.saldoPendiente || 0) > 0 ? 'orange' : 'default'"></app-transaction-summary-row>
          <app-transaction-summary-row
            *ngIf="auth.canViewEconomics && sale.costoReal != null"
            label="Costo · Ganancia"
            [value]="'$' + sale.costoReal + ' · $' + (sale.gananciaEstimada || 0)"
            [divider]="true"
            size="sm"></app-transaction-summary-row>
        </div>
      </app-transaction-summary-panel>
    </app-transaction-detail-page>
  `,
})
export class SalesComponent implements OnInit {
  @ViewChild('saleCounterPanel') saleCounterPanel?: SaleCounterFormPanelComponent;

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  readonly auth = inject(AuthService);
  readonly formSubmitClass = FORM_SUBMIT_CLASS;

  formatSaleLabel = formatSaleLabel;

  private salesService = inject(SalesService);
  private clientService = inject(ClientService);
  private orderService = inject(OrderService);
  private stockService = inject(StockService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  sales: Sale[] = [];
  salesHasMore = false;
  salesCursor: string | null = null;
  loadingMoreSales = false;
  searchQuery = '';
  salesPage = 1;
  eligibleOrders: EligibleOrderForSale[] = [];
  clients: Client[] = [];
  loading = true;

  saleModalOpen = false;
  saleModalMode: SaleModalMode = 'mostrador';
  saleModalSaving = false;
  savingSale = false;
  editingSaleId: string | null = null;

  collectModalOpen = false;
  collectingSale: Sale | null = null;
  collectMonto: number | null = null;
  collectMedio = 'efectivo';
  collectNotas = '';
  collectSaving = false;

  detailModalOpen = false;
  detailSale: Sale | null = null;
  detailLoading = false;

  readonly detailSaleTableColumns = buildTransactionTableColumns(SALE_DETAIL_TABLE_COLUMNS);

  selectedOrderId = '';
  orderFilterClienteId = '';
  montoCobrado: number | null = null;
  medioPago = 'efectivo';
  saleNotas = '';

  get saleModalTitle(): string {
    if (this.saleModalMode === 'edit') {
      const sale = this.sales.find((entry) => entry.id === this.editingSaleId);
      if (sale?.estado === 'borrador') return 'Borrador de venta';
      return 'Editar venta';
    }
    return this.saleModalMode === 'pedido' ? 'Registrar entrega / venta' : 'Venta de mostrador';
  }

  get saleModalSubtitle(): string {
    if (this.saleModalMode === 'edit') {
      const sale = this.sales.find((entry) => entry.id === this.editingSaleId);
      if (sale?.estado === 'borrador') {
        return 'Guardá el borrador sin mover stock ni caja. Confirmá cuando esté listo.';
      }
      return 'Corregí productos, cantidades o el monto cobrado al registrar la venta.';
    }
    return this.saleModalMode === 'pedido'
      ? 'Acción rápida desde el listado. Solo se registra en caja el saldo que cobrás ahora.'
      : 'Acción rápida desde el listado. Descuenta stock y registra el cobro en caja.';
  }

  get saleModalSaveLabel(): string {
    return this.saleModalMode === 'edit' ? 'Guardar cambios' : 'Registrar venta';
  }

  get filteredSales(): Sale[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return this.sales;

    return this.sales.filter((sale) => {
      const ventaLabel = formatSaleLabel(sale).toLowerCase();
      const cliente = (sale.clienteNombre || '').toLowerCase();
      const pedido = (sale.numeroPedidoLabel || '').toLowerCase();
      const notas = (sale.notas || '').toLowerCase();
      const productos = (sale.items ?? [])
        .map((line) => line.nombre?.toLowerCase() || '')
        .join(' ');

      return (
        ventaLabel.includes(query) ||
        cliente.includes(query) ||
        pedido.includes(query) ||
        notas.includes(query) ||
        productos.includes(query)
      );
    });
  }

  get paginatedFilteredSales(): Sale[] {
    return paginateSlice(this.filteredSales, this.salesPage, this.listPageSize);
  }

  get saleModalPrimaryLabel(): string {
    return 'Registrar entrega';
  }

  get detailModalTitle(): string {
    if (!this.detailSale) return 'Detalle de venta';
    return `Venta #${this.detailSale ? formatSaleLabel(this.detailSale) : '—'}`;
  }

  get detailModalSubtitle(): string {
    if (!this.detailSale) return 'Productos, cobros y saldo de la venta.';
    return this.detailSale.clienteNombre?.trim() || 'Detalle completo de la venta.';
  }

  get clientOptions() {
    return this.clients
      .filter((client) => client.id)
      .map((client) => ({ value: client.id!, label: client.nombre }));
  }

  get selectedOrder(): EligibleOrderForSale | undefined {
    return this.eligibleOrders.find((order) => order.id === this.selectedOrderId);
  }

  get orderSelectOptions() {
    return this.eligibleOrders.map((order) => ({
      value: order.id,
      label: this.formatOrderOptionLabel(order),
    }));
  }

  get maxMontoCobrado(): number {
    return this.selectedOrder?.saldoPedido ?? 0;
  }

  get montoCobradoExceedsMax(): boolean {
    const monto = Number(this.montoCobrado);
    if (!Number.isFinite(monto)) return false;
    return monto > this.maxMontoCobrado;
  }

  get montoCobradoError(): string | null {
    const monto = Number(this.montoCobrado);
    if (!Number.isFinite(monto) || monto < 0) {
      return 'Ingresá un monto a cobrar válido.';
    }
    if (this.montoCobradoExceedsMax) {
      return `El monto no puede superar el saldo pendiente del pedido ($${this.maxMontoCobrado}).`;
    }
    return null;
  }

  get saleSubmitBlockedReason(): string | null {
    if (this.savingSale) return null;
    if (this.montoCobradoError) return this.montoCobradoError;
    if (!this.selectedOrderId) {
      return 'Seleccioná el pedido que estás entregando.';
    }
    return null;
  }

  get collectSaldo(): number {
    return Number(this.collectingSale?.saldoPendiente) || 0;
  }

  get collectModalSubtitle(): string {
    if (!this.collectingSale) return '';
    const label = formatSaleLabel(this.collectingSale);
    if (this.collectingSale.origen === 'pedido') {
      return `Pedido #${this.collectingSale.numeroPedidoLabel || '—'} · se registra en caja y actualiza el saldo del pedido.`;
    }
    return `Venta #${label} · el cobro se registra en caja y reduce el saldo pendiente.`;
  }

  get totalFacturado(): number {
    return this.sales.reduce((acc, sale) => acc + (Number(sale.total) || 0), 0);
  }

  get totalCobradoEnVentas(): number {
    return this.sales.reduce((acc, sale) => acc + (Number(sale.montoCobrado) || 0), 0);
  }

  get totalSaldoPendiente(): number {
    return this.sales.reduce((acc, sale) => acc + (Number(sale.saldoPendiente) || 0), 0);
  }

  ngOnInit() {
    if (this.auth.canViewSalesHistory) {
      this.loadSales();
    } else {
      this.loading = false;
    }

    this.clientService.getClientsPage(120).subscribe((page) => {
      this.clients = page.items;
    });
    // Pedidos elegibles: solo al abrir el modal «venta desde pedido».

    this.route.queryParamMap.subscribe((params) => {
      if (params.get('restoreDraft') === '1') {
        this.tryRestoreSalesFormDraft(params.get('clienteId'));
        this.clearSalesQueryParam('restoreDraft');
        this.clearSalesQueryParam('clienteId');
        return;
      }

      const pedidoId = params.get('pedidoId');
      if (pedidoId) {
        if (!this.auth.canCreateSales) {
          this.dialogService.alert({
            title: 'Sin acceso',
            message: 'No tenés permiso para registrar ventas.',
          });
          this.clearSalesQueryParam('pedidoId');
          return;
        }
        this.openSaleModal('pedido', pedidoId);
        this.clearSalesQueryParam('pedidoId');
        return;
      }

      const ventaId = params.get('ventaId');
      if (ventaId) {
        if (!this.auth.canViewSalesHistory) {
          this.clearSalesQueryParam('ventaId');
          return;
        }
        this.openSaleFromQueryParam(ventaId);
      }
    });
  }

  private clearSalesQueryParam(key: string) {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private openSaleFromQueryParam(ventaId: string) {
    this.salesService.getSale(ventaId).subscribe({
      next: (sale) => {
        if (sale.origen === 'pedido' && sale.pedidoId) {
          this.router.navigate(['/orders', sale.pedidoId, 'edit']);
          this.clearSalesQueryParam('ventaId');
          return;
        }
        this.openSaleDetail(sale);
        this.clearSalesQueryParam('ventaId');
      },
      error: () => {
        this.dialogService.alert({
          title: 'Venta no encontrada',
          message: 'No se pudo abrir la venta seleccionada.',
        });
        this.clearSalesQueryParam('ventaId');
      },
    });
  }

  openSaleDetail(sale: Sale) {
    if (!sale.id) return;

    if (sale.estado === 'borrador' && sale.origen === 'mostrador') {
      this.openEditSale(sale);
      return;
    }

    this.detailModalOpen = true;
    this.detailLoading = true;
    this.detailSale = sale;

    this.salesService.getSale(sale.id).subscribe({
      next: (fullSale) => {
        this.detailSale = fullSale;
        this.detailLoading = false;
      },
      error: () => {
        this.detailLoading = false;
        this.detailModalOpen = false;
        this.dialogService.alert({
          title: 'Servidor no disponible',
          message:
            'No se pudo cargar la venta. Ejecutá npm run dev en la raíz del proyecto y recargá la página.',
        });
      },
    });
  }

  closeDetailModal() {
    this.detailModalOpen = false;
    this.detailSale = null;
    this.detailLoading = false;
  }

  editFromDetail() {
    if (!this.detailSale) return;
    const sale = this.detailSale;
    this.closeDetailModal();
    this.openEditSale(sale);
  }

  collectFromDetail() {
    if (!this.detailSale) return;
    const sale = this.detailSale;
    this.closeDetailModal();
    this.openCollectModal(sale);
  }

  duplicateDetailSale() {
    if (!this.detailSale || !this.canDuplicateDetailSale(this.detailSale)) return;
    const sale = this.detailSale;

    saveSalesFormDraft({
      saleModalMode: 'mostrador',
      saleModalOpen: true,
      saleClienteId: sale.clienteId ?? '',
      pendingClientName: '',
      draftLines: (sale.items ?? []).map((line) => ({
        stockItemId: line.stockItemId,
        cantidad: line.cantidad,
        precioUnitario: line.precioUnitario,
        costoUnitario: line.costoUnitario ?? 0,
        costosExtra: this.getDetailLineExtras(line),
      })),
      selectedOrderId: '',
      montoCobrado: sale.montoCobrado ?? sale.total,
      medioPago: sale.medioPago ?? 'efectivo',
      saleNotas: '',
      editingSaleId: null,
      editingSaleLabel: '',
      editHasExtraCobros: false,
      orderFilterClienteId: '',
    });

    this.closeDetailModal();

    if (prefersInlineFormPage()) {
      this.router.navigate(['/sales/new'], { queryParams: { restoreDraft: '1' } });
      return;
    }

    this.stockService.getStock().subscribe((items) => {
      if (items.length === 0) {
        clearSalesFormDraft();
        this.dialogService.alert({
          title: 'Sin productos',
          message: 'Cargá productos en Stock antes de duplicar una venta.',
        });
        return;
      }
      this.saleModalMode = 'mostrador';
      this.editingSaleId = null;
      this.saleModalOpen = true;
      queueMicrotask(() => this.saleCounterPanel?.restoreFromSessionDraft(null));
    });
  }

  confirmDeleteFromDetail() {
    if (!this.detailSale) return;
    this.confirmDeleteSale(this.detailSale, () => this.closeDetailModal());
  }

  getDetailLineExtras(line: SaleLine): SaleLineExtraCost[] {
    if (line.costosExtra?.length) {
      return line.costosExtra;
    }
    if (line.costoPersonalizacion && line.costoPersonalizacion > 0) {
      return [{ nombre: 'Personalización', costo: line.costoPersonalizacion }];
    }
    return [];
  }

  getDetailSaleTableLines(sale: Sale): TransactionTableLine[] {
    return (sale.items ?? []).map((line) => ({
      productName: line.nombre || 'Producto',
      quantity: line.cantidad,
      unitSale: line.precioUnitario,
      subtotal: line.subtotal ?? (Number(line.cantidad) || 0) * (Number(line.precioUnitario) || 0),
      extrasSummary: this.formatDetailLineExtrasSummary(line),
    }));
  }

  private formatDetailLineExtrasSummary(line: SaleLine): string | undefined {
    const extras = this.getDetailLineExtras(line);
    if (!extras.length) return undefined;
    return (
      'Extras: ' +
      extras.map((extra) => `${extra.nombre} $${extra.costo}`).join(' · ')
    );
  }

  getDetailSaleMetaItems(sale: Sale): TransactionDetailMetaItem[] {
    const items: TransactionDetailMetaItem[] = [
      { label: 'Cliente', value: sale.clienteNombre?.trim() || '—' },
      { label: 'Fecha', value: this.formatDate(sale.fecha) },
      { label: 'Medio de pago', value: sale.medioPago || '—', capitalize: true },
    ];

    if (sale.origen === 'pedido' && sale.pedidoId) {
      items.push({
        label: 'Origen',
        value: `Pedido #${sale.numeroPedidoLabel || '—'}`,
        routerLink: ['/orders', sale.pedidoId, 'edit'],
        linkClick: () => this.closeDetailModal(),
      });
    } else {
      items.push({ label: 'Origen', value: 'Mostrador' });
    }

    return items;
  }

  formatDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
  }

  getClientName(clienteId?: string): string {
    if (!clienteId) return 'Sin cliente';
    return this.clients.find((client) => client.id === clienteId)?.nombre ?? 'Cliente';
  }

  private tryRestoreSalesFormDraft(clienteId: string | null) {
    const draft = readSalesFormDraft();
    if (!draft) return;

    if (
      prefersInlineFormPage() &&
      (draft.saleModalMode === 'mostrador' || draft.saleModalMode === 'edit')
    ) {
      const queryParams: Record<string, string> = { restoreDraft: '1' };
      if (clienteId) queryParams.clienteId = clienteId;

      if (draft.saleModalMode === 'edit' && draft.editingSaleId) {
        this.router.navigate(['/sales', draft.editingSaleId, 'edit'], { queryParams });
      } else {
        this.router.navigate(['/sales/new'], { queryParams });
      }
      return;
    }

    this.saleModalMode = draft.saleModalMode as SaleModalMode;
    this.selectedOrderId = draft.selectedOrderId;
    this.montoCobrado = draft.montoCobrado;
    this.medioPago = draft.medioPago;
    this.saleNotas = draft.saleNotas;
    this.editingSaleId = draft.editingSaleId;
    this.orderFilterClienteId = draft.orderFilterClienteId;

    if (draft.saleModalMode === 'pedido') {
      clearSalesFormDraft();
      this.clientService.getClientsPage(120).subscribe((page) => {
        this.clients = page.items;
      });

      if (draft.saleModalOpen) {
        this.loadEligibleOrders(undefined, () => {
          if (this.selectedOrderId) {
            this.onOrderSelected();
          }
          this.saleModalOpen = true;
        });
      }
      return;
    }

    if (!draft.saleModalOpen) {
      clearSalesFormDraft();
      return;
    }

    this.saleModalMode = draft.saleModalMode as SaleModalMode;
    this.editingSaleId = draft.editingSaleId;
    this.saleModalOpen = true;
    queueMicrotask(() => {
      this.saleCounterPanel?.restoreFromSessionDraft(clienteId);
    });
  }

  useMaxMontoCobrado() {
    this.montoCobrado = this.maxMontoCobrado;
  }

  openSaleModal(mode: SaleModalMode, preselectedOrderId?: string) {
    if (!this.auth.canCreateSales) return;

    if (mode === 'mostrador' && prefersInlineFormPage()) {
      this.stockService.getStock().subscribe((items) => {
        if (items.length === 0) {
          this.dialogService.alert({
            title: 'Sin productos',
            message: 'Cargá productos en Stock antes de registrar una venta de mostrador.',
          });
          return;
        }
        this.router.navigate(['/sales/new']);
      });
      return;
    }

    this.saleModalMode = mode;
    this.editingSaleId = null;
    this.selectedOrderId = preselectedOrderId ?? '';
    this.orderFilterClienteId = '';
    this.medioPago = 'efectivo';
    this.saleNotas = '';
    this.montoCobrado = null;

    if (mode === 'mostrador') {
      this.stockService.getStock().subscribe({
        next: (items) => {
          if (items.length === 0) {
            this.dialogService.alert({
              title: 'Sin productos',
              message: 'Cargá productos en Stock antes de registrar una venta de mostrador.',
            });
            return;
          }
          this.saleModalOpen = true;
        },
        error: () => {
          this.dialogService.alert({
            title: 'Servidor no disponible',
            message:
              'No se pudo conectar con la API. Ejecutá npm run dev en la raíz del proyecto y recargá la página.',
          });
        },
      });
      return;
    }

    if (mode === 'pedido') {
      this.loadEligibleOrders(undefined, () => {
        if (preselectedOrderId) {
          const order = this.eligibleOrders.find((entry) => entry.id === preselectedOrderId);
          if (order?.clienteId) {
            this.orderFilterClienteId = order.clienteId;
          }
          if (!order) {
            this.dialogService.alert({
              title: 'Pedido no disponible',
              message:
                'Ese pedido no está listo para entrega, ya tiene venta registrada o no existe.',
            });
            return;
          }
        }
        this.onOrderSelected();
        this.saleModalOpen = true;
      });
    }
  }

  closeSaleModal() {
    this.saleModalOpen = false;
    this.editingSaleId = null;
    this.saleModalSaving = false;
  }

  onCounterSaleSavingChange(saving: boolean) {
    queueMicrotask(() => {
      this.saleModalSaving = saving;
    });
  }

  onCounterSaleSaved(event?: TransactionFormSaveEvent) {
    if (event?.draft) {
      this.saleModalMode = 'edit';
      this.editingSaleId = event.id;
      this.saleModalSaving = false;
      this.loadSales();
      return;
    }
    if (event?.id) {
      this.saleModalMode = 'edit';
      this.editingSaleId = event.id;
    }
    this.saleModalSaving = false;
    this.loadSales();
    this.loadEligibleOrders();
  }

  canEditSale(sale: Sale): boolean {
    return this.auth.canEditRecords && sale.origen === 'mostrador' && !!sale.id;
  }

  canDeleteSale(sale: Sale): boolean {
    if (!this.auth.canDeleteRecords || !sale.id) return false;
    return sale.origen === 'mostrador' || this.auth.isPrivileged;
  }

  canDuplicateDetailSale(sale: Sale): boolean {
    return this.auth.canCreateSales && sale.origen === 'mostrador';
  }

  getSaleCollectableSaldo(sale: Sale): number {
    return Math.max(0, Number(sale.saldoPendiente) || 0);
  }

  canCollectSaleBalance(sale: Sale): boolean {
    if (sale.estado === 'borrador') return false;
    return !!sale.id && this.getSaleCollectableSaldo(sale) > 0;
  }

  openEditSale(sale: Sale) {
    if (!sale.id || sale.origen !== 'mostrador') return;

    if (prefersInlineFormPage()) {
      this.router.navigate(['/sales', sale.id, 'edit']);
      return;
    }

    this.saleModalMode = 'edit';
    this.editingSaleId = sale.id;
    this.saleModalOpen = true;
  }

  openCollectModal(sale: Sale) {
    const saldo = this.getSaleCollectableSaldo(sale);
    if (!sale.id || saldo <= 0) return;
    this.collectingSale = sale;
    this.collectMonto = saldo;
    this.collectMedio = 'efectivo';
    this.collectNotas = '';
    this.collectModalOpen = true;
  }

  closeCollectModal() {
    this.collectModalOpen = false;
    this.collectingSale = null;
  }

  submitCollect() {
    if (!this.collectingSale?.id) return;

    const monto = Number(this.collectMonto);
    if (!Number.isFinite(monto) || monto <= 0) {
      this.dialogService.alert({
        title: 'Monto inválido',
        message: 'Ingresá un monto válido.',
      });
      return;
    }

    if (monto > this.collectSaldo) {
      this.dialogService.alert({
        title: 'Monto excedido',
        message: `El monto no puede superar el saldo pendiente ($${this.collectSaldo}).`,
      });
      return;
    }

    this.collectSaving = true;

    if (this.collectingSale.origen === 'pedido' && this.collectingSale.pedidoId) {
      this.orderService
        .addOrderPayment(this.collectingSale.pedidoId, {
          monto,
          tipo: 'pago',
          notas: this.collectNotas.trim() || undefined,
        })
        .subscribe({
          next: () => this.onCollectSuccess(),
          error: (err: HttpErrorResponse) => this.onCollectError(err),
        });
      return;
    }

    this.salesService
      .collectSaleBalance(this.collectingSale.id, {
        monto,
        medioPago: this.collectMedio,
        notas: this.collectNotas.trim() || undefined,
      })
      .subscribe({
        next: () => this.onCollectSuccess(),
        error: (err: HttpErrorResponse) => this.onCollectError(err),
      });
  }

  private onCollectSuccess() {
    this.collectSaving = false;
    this.closeCollectModal();
    this.loadSales();
  }

  private onCollectError(err: HttpErrorResponse) {
    this.collectSaving = false;
    this.dialogService.alert({
      title: 'Error',
      message:
        typeof err.error?.error === 'string' ? err.error.error : 'No se pudo registrar el cobro.',
    });
  }

  confirmDeleteSale(sale: Sale, onSuccess?: () => void) {
    if (!sale.id || !this.canDeleteSale(sale)) return;
    const label = formatSaleLabel(sale);
    const relatedParts = [
      'Se devolverán al depósito los productos de la venta que controlan stock (movimientos de stock vinculados).',
      'Se anularán en caja los ingresos generados al registrar la venta o cobros posteriores.',
    ];
    if (sale.origen === 'mostrador') {
      relatedParts.push(
        'Esto deshace lo que creó automáticamente la venta de mostrador (caja + stock del depósito).'
      );
    }
    if (sale.origen === 'pedido') {
      relatedParts.push('El pedido asociado quedará sin venta registrada (podés volver a registrar la entrega).');
    }

    this.dialogService
      .confirm({
        title: 'Eliminar venta',
        message: `¿Eliminar la venta #${label} y todo lo vinculado?\n\n${relatedParts.join('\n')}`,
        confirmLabel: 'Eliminar todo',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.salesService.deleteSale(sale.id!).subscribe({
          next: () => {
            this.loadSales();
            onSuccess?.();
          },
          error: (err: HttpErrorResponse) => {
            this.dialogService.alert({
              title: 'Error',
              message:
                typeof err.error?.error === 'string'
                  ? err.error.error
                  : 'No se pudo eliminar la venta.',
            });
          },
        });
      });
  }

  onOrderSelected() {
    if (this.selectedOrder) {
      this.montoCobrado = this.selectedOrder.saldoPedido;
      if (this.selectedOrder.clienteId && !this.orderFilterClienteId) {
        this.orderFilterClienteId = this.selectedOrder.clienteId;
      }
    }
  }

  onOrderClientFilterChange() {
    this.selectedOrderId = '';
    this.loadEligibleOrders(this.orderFilterClienteId || undefined);
  }

  formatOrderOptionLabel(order: EligibleOrderForSale): string {
    const cliente = order.clienteNombre || this.getClientName(order.clienteId);
    const descripcion = order.descripcion?.trim();
    const suffix = descripcion ? ` · ${descripcion.slice(0, 40)}` : '';
    return `#${order.numeroPedidoLabel} · ${cliente} · saldo $${order.saldoPedido}${suffix}`;
  }

  loadEligibleOrders(clienteId?: string, done?: () => void) {
    this.salesService.getEligibleOrders({ clienteId }).subscribe({
      next: (orders) => {
        this.eligibleOrders = orders;
        if (this.selectedOrderId && !orders.some((order) => order.id === this.selectedOrderId)) {
          this.selectedOrderId = '';
        }
        done?.();
      },
    });
  }

  submitSale() {
    const monto = Number(this.montoCobrado);
    if (!Number.isFinite(monto) || monto < 0) {
      this.dialogService.alert({
        title: 'Monto inválido',
        message: 'Ingresá un monto a cobrar válido.',
      });
      return;
    }

    if (!this.selectedOrderId) {
      this.dialogService.alert({
        title: 'Pedido requerido',
        message: 'Seleccioná el pedido que estás entregando.',
      });
      return;
    }

    if (monto > (this.selectedOrder?.saldoPedido ?? 0)) {
      this.dialogService.alert({
        title: 'Monto excedido',
        message: 'El monto no puede superar el saldo pendiente del pedido.',
      });
      return;
    }

    const payload: CreateSalePayload = {
      origen: 'pedido',
      pedidoId: this.selectedOrderId,
      montoCobrado: monto,
      medioPago: this.medioPago,
      notas: this.saleNotas.trim(),
    };

    this.savingSale = true;
    this.salesService.createSale(payload).subscribe({
      next: () => {
        this.savingSale = false;
        this.closeSaleModal();
        this.loadSales();
        this.loadEligibleOrders();
      },
      error: (err: HttpErrorResponse) => {
        this.savingSale = false;
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string' ? err.error.error : 'No se pudo registrar la venta.',
        });
      },
    });
  }

  private loadSales() {
    if (!this.auth.canViewSalesHistory) {
      this.loading = false;
      return;
    }

    this.loading = true;
    this.salesPage = 1;
    this.salesService.getSalesPage(this.listPageSize).subscribe({
      next: (page) => {
        this.sales = page.items;
        this.salesHasMore = page.hasMore;
        this.salesCursor = page.nextCursor;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar las ventas.',
        });
      },
    });
  }

  loadMoreSales() {
    if (!this.salesHasMore || this.loadingMoreSales) return;
    this.loadingMoreSales = true;
    this.salesService.getSalesPage(this.listPageSize, this.salesCursor ?? undefined).subscribe({
      next: (page) => {
        this.sales = [...this.sales, ...page.items];
        this.salesHasMore = page.hasMore;
        this.salesCursor = page.nextCursor;
        this.loadingMoreSales = false;
      },
      error: () => {
        this.loadingMoreSales = false;
      },
    });
  }
}

import { Component, inject, OnInit } from '@angular/core';
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
  UpdateSalePayload,
  formatSaleLabel,
} from '../../core/services/sales.service';
import { Client, ClientService } from '../../core/services/client.service';
import { OrderService } from '../../core/services/order.service';
import { StockItem, StockService } from '../../core/services/stock.service';
import { DialogService } from '../../core/services/dialog.service';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  ClientFormPanelComponent,
  ClientFormSaveEvent,
} from '../clients/client-form-panel.component';
import {
  IconActionComponent,
  LIST_TABLE_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_MIN_WIDTH_CLASS,
  TABLE_SCROLL_CLASS,
  TABLE_SEARCH_INPUT_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
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

interface SaleDraftLine {
  stockItemId: string;
  cantidad: number | null;
  precioUnitario: number | null;
  costoUnitario: number;
  costosExtra: SaleLineExtraCost[];
}

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
    ClientFormPanelComponent,
    ActivityLogTriggerComponent,
    ListRowActionsComponent,
    ListPaginationComponent,
    ModalFormFooterComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Ventas</h1>
          <p class="text-sm sm:text-base text-gray-500">
            Ventas de mostrador o entregas de pedidos. Los pagos previos del pedido no se duplican en caja.
          </p>
        </div>
        <div class="flex gap-2 shrink-0">
          <app-activity-log-trigger module="sales"></app-activity-log-trigger>
          <app-icon-action *ngIf="auth.canCreateSales" label="Venta mostrador" (clicked)="openSaleModal('mostrador')">
            <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          </app-icon-action>
          <app-icon-action *ngIf="auth.canCreateSales" label="Entrega pedido" variant="secondary" (clicked)="openSaleModal('pedido')">
            <i-lucide name="truck" class="w-4 h-4"></i-lucide>
          </app-icon-action>
        </div>
      </div>

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
        class="mb-6 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-800">
        Podés registrar ventas y entregas de pedidos. El historial completo lo ve quien tenga ese permiso.
      </div>

      <div *ngIf="auth.canViewSalesHistory" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50">
          <input
            [(ngModel)]="searchQuery"
            (ngModelChange)="salesPage = 1"
            name="salesSearchQuery"
            placeholder="Buscar por venta, cliente, pedido o producto..."
            [class]="tableSearchInputClass">
        </div>
        <div [class]="tableScrollClass">
        <table [class]="tableMinWidthClass">
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
                #{{ formatSaleLabel(sale) }}
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
                    *ngIf="auth.canAccessCash"
                    type="button"
                    (click)="openCollectModal(sale); $event.stopPropagation()"
                    [disabled]="!canCollectSaleBalance(sale)"
                    title="Cobrar saldo"
                    class="p-2 rounded-lg disabled:cursor-not-allowed"
                    [class.text-orange-600]="canCollectSaleBalance(sale)"
                    [class.hover:bg-orange-50]="canCollectSaleBalance(sale)"
                    [class.hover:text-orange-700]="canCollectSaleBalance(sale)"
                    [class.text-gray-300]="!canCollectSaleBalance(sale)">
                    <i-lucide name="wallet" class="w-4 h-4"></i-lucide>
                  </button>
                </app-list-row-actions>
              </td>
            </tr>
            <tr *ngIf="loading" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">Cargando ventas...</td>
            </tr>
            <tr *ngIf="loading" class="hidden sm:table-row">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">Cargando ventas...</td>
            </tr>
            <tr *ngIf="!loading && sales.length === 0" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">
                Todavía no hay ventas. Registrá una venta de mostrador o la entrega de un pedido listo.
              </td>
            </tr>
            <tr *ngIf="!loading && sales.length === 0" class="hidden sm:table-row">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                Todavía no hay ventas. Registrá una venta de mostrador o la entrega de un pedido listo.
              </td>
            </tr>
            <tr *ngIf="!loading && sales.length > 0 && filteredSales.length === 0" class="sm:hidden">
              <td colspan="2" class="px-4 py-12 text-center text-gray-400">
                No hay ventas que coincidan con la búsqueda.
              </td>
            </tr>
            <tr *ngIf="!loading && sales.length > 0 && filteredSales.length === 0" class="hidden sm:table-row">
              <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                No hay ventas que coincidan con la búsqueda.
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <app-list-pagination
          [page]="salesPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredSales.length"
          (pageChange)="salesPage = $event">
        </app-list-pagination>
      </div>
    </div>

    <app-transaction-modal
      [open]="saleModalOpen"
      [title]="saleModalTitle"
      [subtitle]="saleModalSubtitle"
      layout="fullscreen"
      (closed)="closeSaleModal()">

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
        </ng-container>

        <ng-container *ngIf="saleModalMode === 'mostrador' || saleModalMode === 'edit'">
          <div class="mb-4">
            <div class="flex items-center justify-between gap-3 mb-1">
              <label class="block text-sm font-medium text-gray-700">Cliente</label>
              <button
                type="button"
                (click)="goToNewClientForm()"
                class="text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline shrink-0">
                + Nuevo cliente
              </button>
            </div>
            <app-searchable-select
              [(ngModel)]="saleClienteId"
              name="saleClienteId"
              [labeledOptions]="clientOptions"
              [creatable]="true"
              createLabelPrefix="Crear cliente"
              (createRequested)="quickCreateClient($event)"
              (searchChange)="pendingClientName = $event"
              placeholder="Buscar cliente..."
              emptyOptionsMessage="No hay clientes cargados. Escribí el nombre para crearlo.">
            </app-searchable-select>
          </div>

          <div class="space-y-3 mb-4">
            <div
              *ngFor="let line of draftLines; let i = index"
              class="rounded-lg border border-gray-100 p-3 space-y-2">
              <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                <div class="sm:col-span-5">
                  <label *ngIf="i === 0" class="block text-xs font-medium text-gray-500 mb-1">Producto</label>
                  <select
                    [(ngModel)]="line.stockItemId"
                    [name]="'saleProduct' + i"
                    (ngModelChange)="onProductSelected(line)"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                    <option value="">Seleccionar...</option>
                    <option *ngFor="let item of stockItems" [value]="item.id">{{ item.nombre }}</option>
                  </select>
                  <button
                    *ngIf="line.stockItemId && auth.canEditPersonalization"
                    type="button"
                    (click)="openExtraCostsModal(i)"
                    class="text-teal-600 text-xs font-medium hover:text-teal-800 mt-1">
                    {{ getExtraCostsActionLabel(line) }}
                  </button>
                </div>
                <div class="sm:col-span-2">
                  <label *ngIf="i === 0" class="block text-xs font-medium text-gray-500 mb-1">Cant.</label>
                  <input
                    type="number"
                    [(ngModel)]="line.cantidad"
                    [name]="'saleQty' + i"
                    (ngModelChange)="onDraftLineChange()"
                    min="1"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                </div>
                <div class="sm:col-span-3">
                  <label *ngIf="i === 0" class="block text-xs font-medium text-gray-500 mb-1">Precio u.</label>
                  <input
                    type="number"
                    [(ngModel)]="line.precioUnitario"
                    [name]="'salePrice' + i"
                    (ngModelChange)="onDraftLineChange()"
                    min="0"
                    class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                </div>
                <div class="sm:col-span-2 flex gap-1 justify-end sm:justify-start">
                  <button
                    type="button"
                    (click)="removeLine(i)"
                    [disabled]="draftLines.length === 1"
                    class="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40">
                    <i-lucide name="minus" class="w-4 h-4"></i-lucide>
                  </button>
                  <button
                    *ngIf="i === draftLines.length - 1"
                    type="button"
                    (click)="addLine()"
                    class="p-2 rounded-lg text-teal-600 hover:bg-teal-50">
                    <i-lucide name="plus" class="w-4 h-4"></i-lucide>
                  </button>
                </div>
              </div>
              <p *ngIf="line.stockItemId && auth.canViewStockCosts" class="text-xs text-gray-400">
                Costo stock: {{ '$' + line.costoUnitario }}
                <ng-container *ngIf="auth.canEditPersonalization">
                  · Extras: {{ '$' + getLineExtraCostTotal(line) }}
                </ng-container>
              </p>
              <p *ngIf="line.stockItemId && !auth.canViewStockCosts && auth.canEditPersonalization" class="text-xs text-gray-400">
                Extras personalización: {{ '$' + getLineExtraCostTotal(line) }}
              </p>
            </div>
          </div>

          <div class="rounded-lg bg-gray-50 border border-gray-100 p-3 mb-4 space-y-1 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-600">Total venta</span>
              <span class="font-bold tabular-nums">{{ '$' + draftTotal }}</span>
            </div>
            <div *ngIf="auth.canViewEconomics" class="flex justify-between text-xs text-gray-500">
              <span>Costo estimado</span>
              <span class="tabular-nums">{{ '$' + draftCostTotal }}</span>
            </div>
            <div *ngIf="auth.canViewEconomics" class="flex justify-between text-xs text-teal-700 font-medium">
              <span>Ganancia estimada</span>
              <span class="tabular-nums">{{ '$' + draftProfitTotal }}</span>
            </div>
          </div>
        </ng-container>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Monto a cobrar ahora</label>
            <input
              type="number"
              [(ngModel)]="montoCobrado"
              min="0"
              [max]="maxMontoCobrado"
              [disabled]="saleModalMode === 'edit' && editHasExtraCobros"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50">
            <p class="text-xs text-gray-400 mt-1">
              <ng-container *ngIf="saleModalMode === 'edit' && editHasExtraCobros">
                El cobro inicial ya no se puede cambiar porque hay cobros posteriores. Usá «Cobrar saldo» para el resto.
              </ng-container>
              <ng-container *ngIf="!(saleModalMode === 'edit' && editHasExtraCobros)">
                Dejá menos que el total si el cliente paga después.
              </ng-container>
            </p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Medio de pago</label>
            <select
              [(ngModel)]="medioPago"
              [disabled]="saleModalMode === 'edit' && editHasExtraCobros"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50">
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

        <app-modal-form-footer
          [saving]="savingSale"
          [primaryLabel]="saleModalPrimaryLabel"
          (cancelClick)="closeSaleModal()"
          (primaryClick)="submitSale()">
        </app-modal-form-footer>
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

    <app-transaction-modal
      [open]="extraCostsModalIndex !== null && !!extraCostsModalLine"
      title="Costos de personalización"
      [subtitle]="extraCostsModalLine ? getDraftLineName(extraCostsModalLine) : ''"
      maxWidthClass="max-w-lg"
      zIndexClass="z-[60]"
      (closed)="cancelExtraCostsModal()">
          <div class="flex gap-2 items-end mb-4">
            <div class="flex-1 min-w-0">
              <label class="block text-xs font-medium text-gray-500 mb-1">Concepto</label>
              <input
                [(ngModel)]="extraCostInputNombre"
                name="saleExtraCostInputNombre"
                placeholder="Ej. Estampado"
                (keydown.enter)="confirmExtraCostInput()"
                class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
            </div>
            <div class="w-28">
              <label class="block text-xs font-medium text-gray-500 mb-1">Costo</label>
              <input
                type="number"
                [(ngModel)]="extraCostInputCosto"
                name="saleExtraCostInputCosto"
                (keydown.enter)="confirmExtraCostInput()"
                min="0"
                placeholder="0"
                class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-right tabular-nums outline-none focus:ring-2 focus:ring-teal-500">
            </div>
            <button
              type="button"
              (click)="confirmExtraCostInput()"
              class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 shrink-0"
              title="Agregar">
              <i-lucide name="check" class="w-4 h-4"></i-lucide>
            </button>
          </div>

          <div *ngIf="extraCostsDraft.length === 0" class="text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">
            Agregá costos extra de personalización, materiales, etc.
          </div>

          <div *ngIf="extraCostsDraft.length > 0" class="space-y-2">
            <div
              *ngFor="let extra of extraCostsDraft; let j = index"
              class="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
              <span class="flex-1 min-w-0 text-sm text-gray-900 truncate">{{ extra.nombre }}</span>
              <span class="text-sm font-semibold tabular-nums">{{ '$' + extra.costo }}</span>
              <button
                type="button"
                (click)="removeExtraCostFromDraft(j)"
                class="text-red-400 hover:text-red-600 p-1"
                title="Quitar">
                ×
              </button>
            </div>
          </div>

        <div class="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <div>
            <span class="text-sm text-gray-500">Total extras</span>
            <span class="ml-2 text-base font-bold tabular-nums">{{ '$' + getExtraCostsDraftTotal() }}</span>
          </div>
          <button
            type="button"
            (click)="acceptExtraCostsModal()"
            class="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
            Listo
          </button>
        </div>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="clientModalOpen"
      title="Nuevo cliente"
      subtitle="Al guardar queda seleccionado en esta venta."
      maxWidthClass="max-w-lg"
      zIndexClass="z-[60]"
      (closed)="closeClientModal()">
      <app-client-form-panel
        [prefillNombre]="clientModalPrefillNombre"
        [showHistorialLink]="false"
        (saved)="onClientSavedFromModal($event)"
        (cancelled)="closeClientModal()">
      </app-client-form-panel>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="detailModalOpen"
      [title]="detailModalTitle"
      [subtitle]="detailModalSubtitle"
      layout="fullscreen"
      (closed)="closeDetailModal()">
      <div *ngIf="detailLoading" class="py-12 text-center text-gray-400">Cargando venta...</div>

      <ng-container *ngIf="!detailLoading && detailSale">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 text-sm">
          <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p class="text-xs text-gray-400 uppercase mb-1">Cliente</p>
            <p class="font-medium text-gray-900">{{ detailSale.clienteNombre?.trim() || '—' }}</p>
          </div>
          <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p class="text-xs text-gray-400 uppercase mb-1">Fecha</p>
            <p class="font-medium text-gray-900">{{ formatDate(detailSale.fecha) }}</p>
          </div>
          <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p class="text-xs text-gray-400 uppercase mb-1">Origen</p>
            <p class="font-medium text-gray-900">
              <ng-container *ngIf="detailSale.origen === 'pedido'">
                Pedido #{{ detailSale.numeroPedidoLabel || '—' }}
              </ng-container>
              <ng-container *ngIf="detailSale.origen !== 'pedido'">Mostrador</ng-container>
            </p>
          </div>
          <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p class="text-xs text-gray-400 uppercase mb-1">Medio de pago</p>
            <p class="font-medium text-gray-900">{{ detailSale.medioPago || '—' }}</p>
          </div>
        </div>

        <div class="rounded-xl border border-gray-100 overflow-hidden mb-5">
          <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 text-xs uppercase text-gray-400">
              <tr>
                <th class="px-4 py-3">Producto</th>
                <th class="px-4 py-3 text-right">Cant.</th>
                <th class="px-4 py-3 text-right">Precio u.</th>
                <th class="px-4 py-3 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr *ngFor="let line of detailSale.items">
                <td class="px-4 py-3">
                  <p class="font-medium text-gray-900">{{ line.nombre || 'Producto' }}</p>
                  <p *ngIf="getDetailLineExtras(line).length" class="text-xs text-gray-500 mt-1">
                    Extras:
                    <span *ngFor="let extra of getDetailLineExtras(line); let last = last">
                      {{ extra.nombre }} {{ '$' + extra.costo }}<span *ngIf="!last"> · </span>
                    </span>
                  </p>
                </td>
                <td class="px-4 py-3 text-right tabular-nums">{{ line.cantidad }}</td>
                <td class="px-4 py-3 text-right tabular-nums">{{ '$' + line.precioUnitario }}</td>
                <td class="px-4 py-3 text-right tabular-nums font-semibold">
                  {{ '$' + (line.subtotal ?? line.cantidad * line.precioUnitario) }}
                </td>
              </tr>
              <tr *ngIf="!(detailSale.items?.length)">
                <td colspan="4" class="px-4 py-8 text-center text-gray-400">Sin productos registrados.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="rounded-lg bg-gray-50 border border-gray-100 p-4 mb-4 space-y-2 text-sm">
          <div class="flex justify-between gap-4">
            <span class="text-gray-600">Total venta</span>
            <span class="font-bold tabular-nums">{{ '$' + (detailSale.total || 0) }}</span>
          </div>
          <div *ngIf="detailSale.totalPagadoAnterior" class="flex justify-between gap-4 text-teal-700">
            <span>Ya pagado en pedido</span>
            <span class="font-semibold tabular-nums">{{ '$' + detailSale.totalPagadoAnterior }}</span>
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-gray-600">Cobrado en esta venta</span>
            <span class="font-semibold tabular-nums text-teal-700">{{ '$' + (detailSale.montoCobrado || 0) }}</span>
          </div>
          <div class="flex justify-between gap-4">
            <span class="text-gray-600">Saldo pendiente</span>
            <span
              class="font-semibold tabular-nums"
              [class.text-orange-600]="(detailSale.saldoPendiente || 0) > 0"
              [class.text-gray-500]="!(detailSale.saldoPendiente || 0)">
              {{ '$' + (detailSale.saldoPendiente || 0) }}
            </span>
          </div>
          <div *ngIf="auth.canViewEconomics && detailSale.costoReal != null" class="flex justify-between gap-4 text-xs text-gray-500 pt-2 border-t border-gray-200">
            <span>Costo · Ganancia estimada</span>
            <span class="tabular-nums">{{ '$' + detailSale.costoReal }} · {{ '$' + (detailSale.gananciaEstimada || 0) }}</span>
          </div>
        </div>

        <div *ngIf="detailSale.cobros?.length" class="mb-4">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Cobros posteriores</p>
          <div class="space-y-2">
            <div
              *ngFor="let cobro of detailSale.cobros"
              class="flex justify-between gap-4 rounded-lg border border-gray-100 px-3 py-2 text-sm">
              <span class="text-gray-600">{{ formatDate(cobro.fecha) }} · {{ cobro.medioPago || 'efectivo' }}</span>
              <span class="font-semibold tabular-nums text-teal-700">{{ '$' + cobro.monto }}</span>
            </div>
          </div>
        </div>

        <p *ngIf="detailSale.notas?.trim()" class="text-sm text-gray-600 mb-4">
          <span class="font-medium text-gray-700">Notas:</span> {{ detailSale.notas }}
        </p>
      </ng-container>

      <div class="flex flex-wrap justify-end gap-3 mt-6">
        <button
          type="button"
          (click)="closeDetailModal()"
          class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cerrar
        </button>
        <a
          *ngIf="detailSale?.origen === 'pedido' && detailSale?.pedidoId"
          [routerLink]="['/orders', detailSale!.pedidoId!, 'edit']"
          (click)="closeDetailModal()"
          class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Ver pedido
        </a>
        <button
          *ngIf="detailSale && canEditSale(detailSale)"
          type="button"
          (click)="editFromDetail()"
          class="rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-100">
          Editar
        </button>
        <button
          *ngIf="detailSale && canCollectSaleBalance(detailSale)"
          type="button"
          (click)="collectFromDetail()"
          class="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700">
          Cobrar saldo
        </button>
      </div>
    </app-transaction-modal>
  `,
})
export class SalesComponent implements OnInit {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly tableMinWidthClass = TABLE_MIN_WIDTH_CLASS;
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly tableSearchInputClass = TABLE_SEARCH_INPUT_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  readonly auth = inject(AuthService);

  formatSaleLabel = formatSaleLabel;

  private salesService = inject(SalesService);
  private clientService = inject(ClientService);
  private orderService = inject(OrderService);
  private stockService = inject(StockService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  sales: Sale[] = [];
  searchQuery = '';
  salesPage = 1;
  eligibleOrders: EligibleOrderForSale[] = [];
  clients: Client[] = [];
  stockItems: StockItem[] = [];
  loading = true;

  saleModalOpen = false;
  saleModalMode: SaleModalMode = 'mostrador';
  savingSale = false;
  editingSaleId: string | null = null;
  editingSaleLabel = '';
  editHasExtraCobros = false;

  collectModalOpen = false;
  collectingSale: Sale | null = null;
  collectMonto: number | null = null;
  collectMedio = 'efectivo';
  collectNotas = '';
  collectSaving = false;

  detailModalOpen = false;
  detailSale: Sale | null = null;
  detailLoading = false;

  saleClienteId = '';
  pendingClientName = '';
  creatingClient = false;
  clientModalOpen = false;
  clientModalPrefillNombre = '';
  draftLines: SaleDraftLine[] = [this.emptyLine()];
  selectedOrderId = '';
  orderFilterClienteId = '';
  montoCobrado: number | null = null;
  medioPago = 'efectivo';
  saleNotas = '';

  extraCostsModalIndex: number | null = null;
  extraCostsDraft: SaleLineExtraCost[] = [];
  extraCostInputNombre = '';
  extraCostInputCosto: number | null = null;

  get saleModalTitle(): string {
    if (this.saleModalMode === 'edit') {
      return `Editar venta #${this.editingSaleLabel || '—'}`;
    }
    return this.saleModalMode === 'pedido' ? 'Registrar entrega / venta' : 'Venta de mostrador';
  }

  get saleModalSubtitle(): string {
    if (this.saleModalMode === 'edit') {
      return 'Corregí productos, cantidades o el monto cobrado al registrar la venta.';
    }
    return this.saleModalMode === 'pedido'
      ? 'Acción rápida desde el listado. Solo se registra en caja el saldo que cobrás ahora.'
      : 'Acción rápida desde el listado. Descuenta stock y registra el cobro en caja.';
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
    if (this.saleModalMode === 'edit') return 'Guardar cambios';
    if (this.saleModalMode === 'pedido') return 'Registrar entrega';
    return 'Registrar venta';
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
    if (this.saleModalMode === 'pedido' && this.selectedOrder) {
      return this.selectedOrder.saldoPedido;
    }
    return this.draftTotal;
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

  get draftTotal(): number {
    return this.draftLines.reduce((acc, line) => {
      const qty = Number(line.cantidad) || 0;
      const price = Number(line.precioUnitario) || 0;
      return acc + qty * price;
    }, 0);
  }

  get draftCostTotal(): number {
    return this.draftLines.reduce((acc, line) => {
      const qty = Number(line.cantidad) || 0;
      const base = qty * (Number(line.costoUnitario) || 0);
      return acc + base + this.getLineExtraCostTotal(line);
    }, 0);
  }

  get draftProfitTotal(): number {
    return Math.round((this.draftTotal - this.draftCostTotal) * 100) / 100;
  }

  get extraCostsModalLine(): SaleDraftLine | null {
    if (this.extraCostsModalIndex === null) return null;
    return this.draftLines[this.extraCostsModalIndex] ?? null;
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

    this.clientService.getClients().subscribe((clients) => (this.clients = clients));
    this.stockService.getStock().subscribe((items) => (this.stockItems = items));
    if (this.auth.canCreateSales) {
      this.loadEligibleOrders();
    }

    this.route.queryParamMap.subscribe((params) => {
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

    this.detailModalOpen = true;
    this.detailLoading = true;
    this.detailSale = null;

    this.salesService.getSale(sale.id).subscribe({
      next: (fullSale) => {
        this.detailSale = fullSale;
        this.detailLoading = false;
      },
      error: () => {
        this.detailLoading = false;
        this.detailModalOpen = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el detalle de la venta.',
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

  getDetailLineExtras(line: SaleLine): SaleLineExtraCost[] {
    if (line.costosExtra?.length) {
      return line.costosExtra;
    }
    if (line.costoPersonalizacion && line.costoPersonalizacion > 0) {
      return [{ nombre: 'Personalización', costo: line.costoPersonalizacion }];
    }
    return [];
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

  private refreshClients() {
    this.clientService.getClients().subscribe((clients) => {
      this.clients = clients;
    });
  }

  quickCreateClient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || this.creatingClient) return;

    this.creatingClient = true;
    this.clientService.createClient({ nombre: trimmed }).subscribe({
      next: (response) => {
        this.creatingClient = false;
        const client: Client = { id: response.id, nombre: trimmed };
        this.clients = [...this.clients, client];
        this.saleClienteId = response.id;
        this.pendingClientName = trimmed;
      },
      error: () => {
        this.creatingClient = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo crear el cliente. Intentá de nuevo o usá «Nuevo cliente» para cargar la ficha completa.',
        });
      },
    });
  }

  goToNewClientForm() {
    const nombre = this.pendingClientName.trim();
    this.router.navigate(['/clients/new'], {
      queryParams: nombre ? { nombre } : {},
    });
  }

  closeClientModal() {
    this.clientModalOpen = false;
    this.clientModalPrefillNombre = '';
  }

  onClientSavedFromModal(event: ClientFormSaveEvent) {
    this.saleClienteId = event.id;
    this.pendingClientName = event.client.nombre ?? '';
    this.refreshClients();
    this.closeClientModal();
  }

  openSaleModal(mode: SaleModalMode, preselectedOrderId?: string) {
    if (!this.auth.canCreateSales) return;

    this.saleModalMode = mode;
    this.editingSaleId = null;
    this.editingSaleLabel = '';
    this.editHasExtraCobros = false;
    this.saleClienteId = '';
    this.pendingClientName = '';
    this.draftLines = [this.emptyLine()];
    this.selectedOrderId = preselectedOrderId ?? '';
    this.orderFilterClienteId = '';
    this.medioPago = 'efectivo';
    this.saleNotas = '';
    this.montoCobrado = null;

    if (mode === 'mostrador' && this.stockItems.length === 0) {
      this.dialogService.alert({
        title: 'Sin productos',
        message: 'Cargá productos en Stock antes de registrar una venta de mostrador.',
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
      return;
    }

    this.onOrderSelected();
    this.saleModalOpen = true;
  }

  closeSaleModal() {
    this.saleModalOpen = false;
    this.editingSaleId = null;
    this.editingSaleLabel = '';
    this.editHasExtraCobros = false;
    this.pendingClientName = '';
    this.closeClientModal();
    this.cancelExtraCostsModal();
  }

  canEditSale(sale: Sale): boolean {
    return this.auth.canEditRecords && sale.origen === 'mostrador' && !!sale.id;
  }

  canDeleteSale(sale: Sale): boolean {
    return this.auth.canDeleteRecords && sale.origen === 'mostrador' && !!sale.id;
  }

  canCollectSaleBalance(sale: Sale): boolean {
    return (Number(sale.saldoPendiente) || 0) > 0 && !!sale.id;
  }

  openEditSale(sale: Sale) {
    if (!sale.id || sale.origen !== 'mostrador') return;

    this.salesService.getSale(sale.id).subscribe({
      next: (fullSale) => {
        this.saleModalMode = 'edit';
        this.editingSaleId = fullSale.id ?? sale.id!;
        this.editingSaleLabel = fullSale.ventaLabel || sale.ventaLabel || '';
        this.saleClienteId = fullSale.clienteId ?? '';
        this.medioPago = fullSale.medioPago || 'efectivo';
        this.saleNotas = fullSale.notas || '';
        this.montoCobrado = Number(fullSale.montoCobrado) || 0;
        this.editHasExtraCobros = this.saleHasExtraCobros(fullSale);
        this.draftLines = (fullSale.items ?? []).map((line) => ({
          stockItemId: line.stockItemId,
          cantidad: line.cantidad,
          precioUnitario: line.precioUnitario,
          costoUnitario: Number(line.costoUnitario) || 0,
          costosExtra: (line.costosExtra ?? []).map((extra) => ({
            nombre: extra.nombre,
            costo: Number(extra.costo) || 0,
          })),
        }));
        if (this.draftLines.length === 0) {
          this.draftLines = [this.emptyLine()];
        }
        this.saleModalOpen = true;
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar la venta para editar.',
        });
      },
    });
  }

  openCollectModal(sale: Sale) {
    if (!sale.id || !(Number(sale.saldoPendiente) > 0)) return;
    this.collectingSale = sale;
    this.collectMonto = Number(sale.saldoPendiente) || 0;
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

  confirmDeleteSale(sale: Sale) {
    if (!sale.id || sale.origen !== 'mostrador') return;
    const label = formatSaleLabel(sale);

    this.dialogService
      .confirm({
        title: 'Eliminar venta',
        message: `¿Eliminar la venta #${label}? Se restaurará el stock y se anularán los cobros en caja.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.salesService.deleteSale(sale.id!).subscribe({
          next: () => this.loadSales(),
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

  private saleHasExtraCobros(sale: Sale & { cobros?: Array<{ monto?: number }> }): boolean {
    return Array.isArray(sale.cobros) && sale.cobros.length > 0;
  }

  onOrderSelected() {
    if (this.saleModalMode === 'pedido' && this.selectedOrder) {
      this.montoCobrado = this.selectedOrder.saldoPedido;
      if (this.selectedOrder.clienteId && !this.orderFilterClienteId) {
        this.orderFilterClienteId = this.selectedOrder.clienteId;
      }
    } else if (this.saleModalMode === 'mostrador') {
      this.montoCobrado = this.draftTotal;
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

  addLine() {
    this.draftLines = [...this.draftLines, this.emptyLine()];
  }

  removeLine(index: number) {
    if (this.draftLines.length === 1) return;
    if (this.extraCostsModalIndex === index) {
      this.cancelExtraCostsModal();
    } else if (this.extraCostsModalIndex !== null && this.extraCostsModalIndex > index) {
      this.extraCostsModalIndex--;
    }
    this.draftLines = this.draftLines.filter((_, i) => i !== index);
    if (this.saleModalMode === 'mostrador') {
      this.montoCobrado = this.draftTotal;
    }
  }

  onDraftLineChange() {
    if (this.saleModalMode === 'mostrador' || this.saleModalMode === 'edit') {
      if (this.saleModalMode === 'mostrador') {
        this.montoCobrado = this.draftTotal;
      }
    }
  }

  onProductSelected(line: SaleDraftLine) {
    const item = this.stockItems.find((entry) => entry.id === line.stockItemId);
    if (!item) return;
    line.costoUnitario = Number(item.costo) || 0;
    if (line.precioUnitario == null || line.precioUnitario === 0) {
      line.precioUnitario = Number(item.precioSugerido) || line.costoUnitario || 0;
    }
    if (!line.costosExtra.length) {
      line.costosExtra = [];
    }
    this.onDraftLineChange();
  }

  getExtraCostsActionLabel(line: SaleDraftLine): string {
    return line.costosExtra.length > 0 ? 'Editar costos' : '+ Agregar costo';
  }

  getDraftLineName(line: SaleDraftLine): string {
    const item = this.stockItems.find((entry) => entry.id === line.stockItemId);
    return item?.nombre ?? 'Producto';
  }

  getLineExtraCostTotal(line: SaleDraftLine): number {
    return line.costosExtra.reduce((acc, extra) => acc + (Number(extra.costo) || 0), 0);
  }

  openExtraCostsModal(lineIndex: number) {
    const line = this.draftLines[lineIndex];
    if (!line) return;
    this.extraCostsDraft = line.costosExtra.map((extra) => ({
      nombre: extra.nombre,
      costo: Number(extra.costo) || 0,
    }));
    this.extraCostInputNombre = '';
    this.extraCostInputCosto = null;
    this.extraCostsModalIndex = lineIndex;
  }

  cancelExtraCostsModal() {
    this.extraCostsModalIndex = null;
    this.extraCostsDraft = [];
    this.extraCostInputNombre = '';
    this.extraCostInputCosto = null;
  }

  acceptExtraCostsModal() {
    const line = this.extraCostsModalLine;
    if (!line) return;
    line.costosExtra = this.extraCostsDraft.map((extra) => ({
      nombre: extra.nombre,
      costo: Number(extra.costo) || 0,
    }));
    this.cancelExtraCostsModal();
  }

  confirmExtraCostInput() {
    const nombre = this.extraCostInputNombre.trim();
    const costo = Number(this.extraCostInputCosto);

    if (!nombre) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá el concepto del costo.',
      });
      return;
    }

    if (
      this.extraCostInputCosto === null ||
      this.extraCostInputCosto === undefined ||
      Number.isNaN(costo) ||
      costo < 0
    ) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un costo válido.',
      });
      return;
    }

    this.extraCostsDraft.push({ nombre, costo });
    this.extraCostInputNombre = '';
    this.extraCostInputCosto = null;
  }

  removeExtraCostFromDraft(index: number) {
    this.extraCostsDraft.splice(index, 1);
  }

  getExtraCostsDraftTotal(): number {
    return this.extraCostsDraft.reduce((acc, extra) => acc + (Number(extra.costo) || 0), 0);
  }

  submitSale() {
    if (this.saleModalMode === 'edit') {
      this.submitEditSale();
      return;
    }

    const monto = Number(this.montoCobrado);
    if (!Number.isFinite(monto) || monto < 0) {
      this.dialogService.alert({
        title: 'Monto inválido',
        message: 'Ingresá un monto a cobrar válido.',
      });
      return;
    }

    let payload: CreateSalePayload;

    if (this.saleModalMode === 'pedido') {
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

      payload = {
        origen: 'pedido',
        pedidoId: this.selectedOrderId,
        montoCobrado: monto,
        medioPago: this.medioPago,
        notas: this.saleNotas.trim(),
      };
    } else {
      if (!this.saleClienteId) {
        this.dialogService.alert({
          title: 'Cliente requerido',
          message: 'Seleccioná un cliente para la venta.',
        });
        return;
      }

      const items = this.draftLines
        .map((line) => {
          const item = this.stockItems.find((entry) => entry.id === line.stockItemId);
          const costosExtra = (line.costosExtra ?? []).filter(
            (extra) => extra.nombre?.trim() || extra.costo
          );
          const costoPersonalizacion = costosExtra.reduce(
            (acc, extra) => acc + (Number(extra.costo) || 0),
            0
          );
          return {
            stockItemId: line.stockItemId,
            nombre: item?.nombre ?? '',
            cantidad: Number(line.cantidad) || 0,
            precioUnitario: Number(line.precioUnitario) || 0,
            costoUnitario: Number(line.costoUnitario) || Number(item?.costo) || 0,
            costoPersonalizacion,
            costosExtra: costosExtra.map((extra) => ({
              nombre: extra.nombre.trim(),
              costo: Number(extra.costo) || 0,
            })),
          };
        })
        .filter((line) => line.stockItemId && line.cantidad > 0);

      if (items.length === 0) {
        this.dialogService.alert({
          title: 'Productos requeridos',
          message: 'Agregá al menos un producto con cantidad.',
        });
        return;
      }

      if (monto > this.draftTotal) {
        this.dialogService.alert({
          title: 'Monto excedido',
          message: 'El monto cobrado no puede superar el total de la venta.',
        });
        return;
      }

      payload = {
        origen: 'mostrador',
        clienteId: this.saleClienteId,
        items,
        montoCobrado: monto,
        medioPago: this.medioPago,
        notas: this.saleNotas.trim(),
      };
    }

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

  private submitEditSale() {
    if (!this.editingSaleId) return;

    const monto = Number(this.montoCobrado);
    if (!Number.isFinite(monto) || monto < 0) {
      this.dialogService.alert({
        title: 'Monto inválido',
        message: 'Ingresá un monto a cobrar válido.',
      });
      return;
    }

    if (!this.saleClienteId) {
      this.dialogService.alert({
        title: 'Cliente requerido',
        message: 'Seleccioná un cliente para la venta.',
      });
      return;
    }

    const items = this.draftLines
      .map((line) => {
        const item = this.stockItems.find((entry) => entry.id === line.stockItemId);
        const costosExtra = (line.costosExtra ?? []).filter(
          (extra) => extra.nombre?.trim() || extra.costo
        );
        const costoPersonalizacion = costosExtra.reduce(
          (acc, extra) => acc + (Number(extra.costo) || 0),
          0
        );
        return {
          stockItemId: line.stockItemId,
          nombre: item?.nombre ?? '',
          cantidad: Number(line.cantidad) || 0,
          precioUnitario: Number(line.precioUnitario) || 0,
          costoUnitario: Number(line.costoUnitario) || Number(item?.costo) || 0,
          costoPersonalizacion,
          costosExtra: costosExtra.map((extra) => ({
            nombre: extra.nombre.trim(),
            costo: Number(extra.costo) || 0,
          })),
        };
      })
      .filter((line) => line.stockItemId && line.cantidad > 0);

    if (items.length === 0) {
      this.dialogService.alert({
        title: 'Productos requeridos',
        message: 'Agregá al menos un producto con cantidad.',
      });
      return;
    }

    const draftTotal = items.reduce(
      (acc, line) => acc + line.cantidad * line.precioUnitario,
      0
    );

    if (monto > draftTotal) {
      this.dialogService.alert({
        title: 'Monto excedido',
        message: 'El monto cobrado no puede superar el total de la venta.',
      });
      return;
    }

    const payload: UpdateSalePayload = {
      clienteId: this.saleClienteId,
      items,
      notas: this.saleNotas.trim(),
      medioPago: this.medioPago,
    };

    if (!this.editHasExtraCobros) {
      payload.montoCobrado = monto;
    }

    this.savingSale = true;
    this.salesService.updateSale(this.editingSaleId, payload).subscribe({
      next: () => {
        this.savingSale = false;
        this.closeSaleModal();
        this.loadSales();
      },
      error: (err: HttpErrorResponse) => {
        this.savingSale = false;
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : 'No se pudo actualizar la venta.',
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
    this.salesService.getSales().subscribe({
      next: (sales) => {
        this.sales = sales;
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

  private emptyLine(): SaleDraftLine {
    return { stockItemId: '', cantidad: 1, precioUnitario: 0, costoUnitario: 0, costosExtra: [] };
  }
}

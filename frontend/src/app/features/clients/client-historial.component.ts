import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ClientAccount,
  ClientAccountOrder,
  ClientAccountSale,
  ClientService,
} from '../../core/services/client.service';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import { OrderService } from '../../core/services/order.service';
import { SalesService } from '../../core/services/sales.service';
import { DialogService } from '../../core/services/dialog.service';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { ConceptRefLinksComponent } from '../../shared/components/concept-ref-links/concept-ref-links.component';
import {
  LIST_TOOLBAR_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_MIN_WIDTH_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { IconToolbarButtonComponent } from '../../shared/components/icon-toolbar/icon-toolbar-button.component';
import { COMPACT_LIST_TRAILING_ROW_CLASS } from '../../shared/components/compact-list/compact-list.constants';
import { AuthService } from '../../core/services/auth.service';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import { FormPageHeaderComponent } from '../../shared/components/form-shell';
import { FormFooterComponent } from '../../shared/components/form-shell/form-footer.component';
import { NavigationBackService } from '../../core/services/navigation-back.service';
import {
  ClientBalancePrintService,
  ClientBalancePrintMode,
  ClientBalanceSummaryGroup,
} from '../../core/services/client-balance-print.service';
import type { ClientAccountLineItem } from '../../core/services/client.service';
import {
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getCajaAmbitos,
  getDefaultCashAmbitoId,
  usesCashAmbitoSeparation,
} from '../../core/services/catalog-config.service';
import { SegmentedControlComponent } from '../../shared/components/segmented-control/segmented-control.component';

type CollectTarget =
  | { kind: 'pedido'; item: ClientAccountOrder }
  | { kind: 'venta'; item: ClientAccountSale };

type CollectMode = 'client' | 'item';

@Component({
  selector: 'app-client-historial',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TransactionModalComponent,
    IconToolbarButtonComponent,
    ConceptRefLinksComponent,
    ListSearchFieldComponent,
    FormPageHeaderComponent,
    FormFooterComponent,
    SegmentedControlComponent,
  ],
  template: `
    <div [class]="pageShellClass + ' pb-20 sm:pb-24'">
      <app-form-page-header
        title="Historial"
        subtitle="Cuenta corriente, compras y cobros registrados en caja."
        backLabel="Volver a clientes"
        backShortLabel="Volver"
        backAriaLabel="Volver a clientes"
        (backClick)="goBack()"
        [hasHeaderActions]="true"
        [hasHeaderExtra]="true">
        <div headerExtra class="pl-[calc(2.5rem+0.5rem)] sm:pl-[calc(2.75rem+0.75rem)] -mt-1 sm:mt-0">
          <p
            class="text-[11px] sm:text-sm font-semibold text-gray-800 dark:text-gray-100 truncate leading-tight max-w-full"
            [title]="clientName">
            {{ clientName }}
          </p>
        </div>
        <div headerActions [class]="listToolbarRowClass + ' w-full sm:w-auto sm:justify-end'">
          <app-list-search-field
            mode="filter"
            [(query)]="searchQuery"
            name="historialSearchQueryMobile"
            placeholder="Buscar..."
            [constrainWidth]="false"
            extraClass="sm:hidden flex-1 min-w-0">
          </app-list-search-field>
          <app-icon-toolbar-button
            *ngIf="auth.canAccessCash && account?.debe"
            icon="wallet"
            label="Cobrar cuenta"
            variant="orange-outline"
            [disabled]="collectSaving"
            (clicked)="openClientCollectModal()">
          </app-icon-toolbar-button>
          <app-icon-toolbar-button
            *ngIf="clientId"
            icon="pencil"
            label="Editar datos"
            variant="outline"
            (clicked)="goEditClient()">
          </app-icon-toolbar-button>
        </div>
      </app-form-page-header>

      <div *ngIf="loading" class="py-16 text-center text-gray-400">Cargando historial...</div>

      <ng-container *ngIf="!loading && account">
        <div *ngIf="auth.canViewAccountBalance" class="module-summary-kpis grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4">
          <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 shadow-sm">
            <p class="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Saldo pendiente</p>
            <p
              class="text-lg sm:text-xl font-bold tabular-nums leading-tight"
              [class.text-orange-600]="account.debe"
              [class.text-gray-900]="!account.debe"
              [class.dark:text-gray-100]="!account.debe">
              {{ formatMoney(account.saldoTotal) }}
            </p>
          </div>
          <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 shadow-sm">
            <p class="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Total facturado</p>
            <p class="text-lg sm:text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-tight">
              {{ formatMoney(account.totalFacturado || 0) }}
            </p>
          </div>
          <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 shadow-sm">
            <p class="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Total cobrado</p>
            <p class="text-lg sm:text-xl font-bold tabular-nums text-teal-700 dark:text-teal-400 leading-tight">
              {{ formatMoney(account.totalCobrado || 0) }}
            </p>
          </div>
          <div class="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 shadow-sm col-span-2 lg:col-span-1">
            <p class="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Desglose deuda</p>
            <p class="text-xs text-gray-600 dark:text-gray-300 leading-snug">Pedidos: {{ formatMoney(account.saldoPedidos) }}</p>
            <p class="text-xs text-gray-600 dark:text-gray-300 leading-snug">Mostrador: {{ formatMoney(account.saldoVentasMostrador) }}</p>
          </div>
        </div>

        <section
          *ngIf="auth.canViewAccountBalance && pendingItems.length"
          class="mb-4 rounded-xl border border-orange-100 dark:border-orange-900/40 bg-orange-50 dark:bg-orange-950/30 overflow-hidden">
          <div class="flex flex-col gap-2 px-3 py-2 border-b border-orange-100 dark:border-orange-900/30">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
              <h2 class="text-xs font-bold text-orange-900 dark:text-orange-200">Saldos pendientes de cobro</h2>
              <div class="flex items-center gap-2 flex-wrap">
                <app-icon-toolbar-button
                  *ngIf="auth.canViewAccountBalance"
                  icon="printer"
                  label="Resumen"
                  variant="orange-outline"
                  size="row"
                  (clicked)="openBalanceSummary()">
                </app-icon-toolbar-button>
              </div>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p class="text-[10px] text-orange-800 dark:text-orange-300/90 leading-snug">
                Cobrá uno por uno o usá «Cobrar cuenta».
              </p>
              <app-segmented-control
                ariaLabel="Vista de saldos"
                size="sm"
                [options]="pendingViewOptions"
                [value]="pendingViewMode"
                (valueChange)="onPendingViewModeChange($event)">
              </app-segmented-control>
            </div>
          </div>
          <div class="divide-y divide-orange-100/80 dark:divide-orange-900/30">
            <div
              *ngFor="let entry of pendingItems"
              class="bg-white/70 dark:bg-gray-900/50">
              <div class="flex items-center gap-1.5 px-2.5 py-1.5 min-h-[38px]">
                <button
                  *ngIf="entry.lineas.length; else pendingSpacer"
                  type="button"
                  class="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-orange-700 dark:text-orange-300 hover:bg-orange-100/80 dark:hover:bg-orange-900/30"
                  [attr.aria-expanded]="isPendingDetailOpen(entry)"
                  [attr.aria-label]="isPendingDetailOpen(entry) ? 'Ocultar ítems' : 'Ver ítems'"
                  (click)="togglePendingDetail(entry)">
                  <span class="text-[10px] leading-none">{{ isPendingDetailOpen(entry) ? '▲' : '▼' }}</span>
                </button>
                <ng-template #pendingSpacer><span class="w-7 shrink-0" aria-hidden="true"></span></ng-template>

                <a
                  [routerLink]="getPendingItemRoute(entry.target)"
                  [queryParams]="getPendingItemQueryParams(entry.target)"
                  class="min-w-0 flex-1 group">
                  <p class="text-xs font-medium text-gray-900 dark:text-gray-100 leading-snug truncate group-hover:text-teal-700 dark:group-hover:text-teal-400">
                    {{ entry.label }}<span *ngIf="entry.fecha" class="font-normal text-gray-500 dark:text-gray-400"> · {{ formatDate(entry.fecha) }}</span>
                  </p>
                  <p class="text-[10px] text-gray-500 dark:text-gray-400 truncate leading-snug">{{ entry.detail }}</p>
                </a>

                <div [class]="compactListTrailingClass">
                  <span
                    *ngIf="!isPendingDetailOpen(entry)"
                    class="text-xs font-bold tabular-nums text-orange-700 dark:text-orange-400 min-w-[4.5rem] text-right">
                    {{ formatMoney(entry.saldo) }}
                  </span>
                  <app-icon-toolbar-button
                    *ngIf="auth.canAccessCash"
                    icon="wallet"
                    label="Cobrar"
                    variant="ghost-teal"
                    size="row"
                    [disabled]="collectSaving"
                    (clicked)="openCollectModal(entry.target)">
                  </app-icon-toolbar-button>
                </div>
              </div>

              <div
                *ngIf="isPendingDetailOpen(entry)"
                class="mx-2.5 mb-2 rounded-lg border border-orange-100 dark:border-orange-900/40 overflow-hidden bg-white dark:bg-gray-950/60">
                <div
                  *ngIf="entry.lineas.length; else pendingSaldoOnly"
                  class="overflow-x-auto">
                  <table class="w-full text-[10px] sm:text-xs">
                    <thead class="bg-orange-50/80 dark:bg-orange-950/40 text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      <tr>
                        <th class="px-2 py-1.5 text-left font-semibold">Ítem</th>
                        <th class="px-2 py-1.5 text-right font-semibold w-12">Cant.</th>
                        <th class="px-2 py-1.5 text-right font-semibold w-20">P. unit.</th>
                        <th class="px-2 py-1.5 text-right font-semibold w-20">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-orange-50 dark:divide-orange-900/20 text-gray-700 dark:text-gray-300">
                      <tr *ngFor="let linea of entry.lineas">
                        <td class="px-2 py-1.5 align-top">{{ linea.nombre }}</td>
                        <td class="px-2 py-1.5 text-right tabular-nums align-top">{{ linea.cantidad }}</td>
                        <td class="px-2 py-1.5 text-right tabular-nums align-top whitespace-nowrap">{{ formatMoney(linea.precioUnitario) }}</td>
                        <td class="px-2 py-1.5 text-right tabular-nums font-medium align-top whitespace-nowrap">{{ formatMoney(linea.subtotal) }}</td>
                      </tr>
                    </tbody>
                    <tfoot class="bg-orange-50/90 dark:bg-orange-950/50 border-t border-orange-200 dark:border-orange-900/40">
                      <tr>
                        <td colspan="3" class="px-2 py-1.5 text-right font-semibold text-orange-900 dark:text-orange-200">Saldo pendiente</td>
                        <td class="px-2 py-1.5 text-right tabular-nums font-bold text-orange-700 dark:text-orange-400 whitespace-nowrap">{{ formatMoney(entry.saldo) }}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <ng-template #pendingSaldoOnly>
                  <div class="flex items-center justify-between gap-3 px-2.5 py-2 text-xs">
                    <span class="text-gray-500 dark:text-gray-400">Sin detalle de ítems</span>
                    <span class="font-bold tabular-nums text-orange-700 dark:text-orange-400">{{ formatMoney(entry.saldo) }}</span>
                  </div>
                </ng-template>
              </div>
            </div>
          </div>
        </section>

        <section class="mb-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <h2 class="text-xs font-bold text-gray-900 dark:text-gray-100 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            Historial de cobros (caja)
          </h2>
          <div *ngIf="!(account.historialPagos?.length)" class="px-3 py-6 text-center text-gray-400 text-xs">
            Todavía no hay cobros registrados para este cliente.
          </div>
          <div *ngIf="account.historialPagos?.length" class="divide-y divide-gray-50 dark:divide-gray-800">
            <div
              *ngFor="let pago of account.historialPagos"
              class="px-2.5 py-1.5 min-h-[34px] flex items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs font-medium text-gray-900 dark:text-gray-100 leading-snug">
                  <app-concept-ref-links
                    [text]="pago.concepto"
                    [pedidoId]="pago.pedidoId"
                    [ventaId]="pago.ventaId"
                    [numeroPedidoLabel]="pago.numeroPedidoLabel"
                    [ventaLabel]="pago.ventaLabel">
                  </app-concept-ref-links>
                </p>
                <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
                  {{ formatDate(pago.fecha) }}
                  <span *ngIf="pago.medio"> · {{ pago.medio }}</span>
                </p>
              </div>
              <span class="text-xs font-bold tabular-nums text-teal-700 dark:text-teal-400 shrink-0">
                {{ formatMoney(pago.monto) }}
              </span>
            </div>
          </div>
        </section>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div class="hidden sm:block xl:col-span-2 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <app-list-search-field
              mode="filter"
              [(query)]="searchQuery"
              name="historialSearchQuery"
              placeholder="Buscar por pedido, venta, descripción u origen...">
            </app-list-search-field>
          </div>

          <section class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <h2 class="text-sm font-bold text-gray-900 px-4 py-3 border-b border-gray-100">Pedidos</h2>
            <div [class]="tableScrollClass">
              <table [class]="tableMinWidthClass">
                <thead class="bg-gray-50 text-xs uppercase text-gray-400">
                  <tr>
                    <th class="px-4 py-3">Pedido</th>
                    <th class="hidden sm:table-cell px-4 py-3">Fecha</th>
                    <th class="px-4 py-3">Estado</th>
                    <th *ngIf="auth.canViewOrderSalePrice" class="hidden sm:table-cell px-4 py-3 text-right">Total</th>
                    <th *ngIf="auth.canViewAccountBalance" class="hidden sm:table-cell px-4 py-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50 text-sm">
                  <tr *ngFor="let pedido of filteredPedidos">
                    <td class="px-4 py-3">
                      <a [routerLink]="['/orders', pedido.id, 'edit']" class="font-semibold text-teal-700 hover:underline">
                        #{{ pedido.numeroPedidoLabel }}
                      </a>
                      <p class="text-xs text-gray-500 truncate">{{ pedido.descripcion || '—' }}</p>
                      <p class="text-[10px] text-gray-400 sm:hidden">{{ formatPedidoFecha(pedido) }}</p>
                    </td>
                    <td class="hidden sm:table-cell px-4 py-3 text-xs text-gray-600 tabular-nums whitespace-nowrap">
                      {{ formatPedidoFecha(pedido) }}
                    </td>
                    <td class="px-4 py-3 text-gray-600">{{ pedido.estado || '—' }}</td>
                    <td *ngIf="auth.canViewOrderSalePrice" class="hidden sm:table-cell px-4 py-3 text-right tabular-nums">{{ formatMoney(pedido.total) }}</td>
                    <td *ngIf="auth.canViewAccountBalance" class="hidden sm:table-cell px-4 py-3 text-right tabular-nums font-semibold" [class.text-orange-600]="pedido.saldo > 0">
                      {{ formatMoney(pedido.saldo) }}
                    </td>
                  </tr>
                  <tr *ngIf="account.pedidos.length === 0">
                    <td [attr.colspan]="3 + (auth.canViewOrderSalePrice ? 1 : 0) + (auth.canViewAccountBalance ? 1 : 0)" class="px-4 py-8 text-center text-gray-400">Sin pedidos visibles.</td>
                  </tr>
                  <tr *ngIf="account.pedidos.length > 0 && filteredPedidos.length === 0">
                    <td [attr.colspan]="3 + (auth.canViewOrderSalePrice ? 1 : 0) + (auth.canViewAccountBalance ? 1 : 0)" class="px-4 py-8 text-center text-gray-400">
                      No hay pedidos que coincidan con la búsqueda.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <h2 class="text-sm font-bold text-gray-900 px-4 py-3 border-b border-gray-100">Ventas</h2>
            <div [class]="tableScrollClass">
              <table [class]="tableMinWidthClass">
                <thead class="bg-gray-50 text-xs uppercase text-gray-400">
                  <tr>
                    <th class="px-4 py-3">Venta</th>
                    <th class="hidden sm:table-cell px-4 py-3">Fecha</th>
                    <th class="hidden sm:table-cell px-4 py-3">Origen</th>
                    <th *ngIf="auth.canViewOrderSalePrice" class="hidden sm:table-cell px-4 py-3 text-right">Total</th>
                    <th *ngIf="auth.canViewAccountBalance" class="hidden sm:table-cell px-4 py-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50 text-sm">
                  <tr *ngFor="let venta of filteredVentas" class="hover:bg-gray-50">
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="getVentaRoute(venta)"
                        [queryParams]="getVentaQueryParams(venta)"
                        class="font-semibold text-teal-700 hover:underline">
                        #{{ venta.ventaLabel }}
                      </a>
                      <p class="text-xs text-gray-500 sm:hidden truncate">
                        {{ formatDate(venta.fecha) }}
                        ·
                        <ng-container *ngIf="venta.origen === 'pedido'">Pedido #{{ venta.numeroPedidoLabel || '—' }}</ng-container>
                        <ng-container *ngIf="venta.origen !== 'pedido'">Mostrador</ng-container>
                      </p>
                    </td>
                    <td class="hidden sm:table-cell px-4 py-3 text-xs text-gray-600 tabular-nums whitespace-nowrap">
                      {{ formatDate(venta.fecha) }}
                    </td>
                    <td class="hidden sm:table-cell px-4 py-3 text-gray-600">
                      <a
                        *ngIf="venta.origen === 'pedido' && venta.pedidoId"
                        [routerLink]="['/orders', venta.pedidoId, 'edit']"
                        class="text-teal-700 hover:underline">
                        Pedido #{{ venta.numeroPedidoLabel || '—' }}
                      </a>
                      <span *ngIf="venta.origen !== 'pedido'">Mostrador</span>
                    </td>
                    <td *ngIf="auth.canViewOrderSalePrice" class="hidden sm:table-cell px-4 py-3 text-right tabular-nums">{{ formatMoney(venta.total) }}</td>
                    <td *ngIf="auth.canViewAccountBalance" class="hidden sm:table-cell px-4 py-3 text-right tabular-nums font-semibold" [class.text-orange-600]="venta.saldoPendiente > 0">
                      {{ formatMoney(venta.saldoPendiente) }}
                    </td>
                  </tr>
                  <tr *ngIf="account.ventas.length === 0">
                    <td [attr.colspan]="3 + (auth.canViewOrderSalePrice ? 1 : 0) + (auth.canViewAccountBalance ? 1 : 0)" class="px-4 py-8 text-center text-gray-400">Sin ventas.</td>
                  </tr>
                  <tr *ngIf="account.ventas.length > 0 && filteredVentas.length === 0">
                    <td [attr.colspan]="3 + (auth.canViewOrderSalePrice ? 1 : 0) + (auth.canViewAccountBalance ? 1 : 0)" class="px-4 py-8 text-center text-gray-400">
                      No hay ventas que coincidan con la búsqueda.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </ng-container>
    </div>

    <app-transaction-modal
      [open]="collectModalOpen"
      [title]="collectModalTitle"
      [subtitle]="collectModalSubtitle"
      maxWidthClass="max-w-md"
      (closed)="onCollectModalClosed()">
      <div class="space-y-4" [class.opacity-60]="collectSaving" [class.pointer-events-none]="collectSaving">
        <div class="rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm space-y-2">
          <div class="flex justify-between gap-4">
            <span class="text-gray-500">
              {{ collectMode === 'client' ? 'Saldo total del cliente' : 'Saldo pendiente' }}
            </span>
            <span class="font-bold tabular-nums text-orange-600">{{ formatMoney(collectSaldoMax) }}</span>
          </div>
          <div *ngIf="collectMode === 'client' && collectAllocationPreview.length" class="pt-2 border-t border-gray-200">
            <p class="text-xs font-semibold text-gray-500 uppercase mb-2">Se aplicará en este orden</p>
            <div class="space-y-1">
              <div
                *ngFor="let row of collectAllocationPreview"
                class="flex justify-between gap-3 text-xs text-gray-700">
                <span class="truncate">{{ row.label }}</span>
                <span class="font-semibold tabular-nums shrink-0">{{ formatMoney(row.monto) }}</span>
              </div>
            </div>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Monto a cobrar</label>
          <input
            type="number"
            [(ngModel)]="collectMonto"
            min="0"
            [max]="collectSaldoMax"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-teal-500">
          <p *ngIf="collectMode === 'client'" class="text-xs text-gray-400 mt-1">
            El pago se distribuye automáticamente sobre los saldos más antiguos.
          </p>
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
        <div *ngIf="showCollectAmbitoSelector">
          <span class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Caja</span>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2 leading-snug">
            La venta no tiene caja asignada. Elegí dónde registrar el ingreso.
          </p>
          <app-segmented-control
            ariaLabel="Caja"
            size="sm"
            [options]="cajaAmbitos"
            [(value)]="collectAmbito">
          </app-segmented-control>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas (opcional)</label>
          <input
            [(ngModel)]="collectNotas"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-2 focus:ring-teal-500">
        </div>
        <app-form-footer
          mode="modal"
          saveLabel="Registrar en caja"
          [saving]="collectSaving"
          [saveDisabled]="collectSaving"
          footerClass="mt-2 pointer-events-auto"
          (cancelClick)="onCollectModalClosed()"
          (saveClick)="submitCollect()">
        </app-form-footer>
      </div>
    </app-transaction-modal>

    <app-transaction-modal
      [open]="balanceSummaryOpen"
      title="Resumen de saldo pendiente"
      [subtitle]="clientName"
      maxWidthClass="max-w-2xl"
      (closed)="closeBalanceSummary()">
      <div class="space-y-4 max-h-[min(70vh,32rem)] overflow-y-auto pr-1 -mr-1">
        <div class="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-900/40 px-3 py-2 flex items-center justify-between gap-3">
          <span class="text-xs font-semibold uppercase text-orange-900 dark:text-orange-200">Total pendiente</span>
          <span class="text-lg font-bold tabular-nums text-orange-700 dark:text-orange-400">
            {{ formatMoney(account?.saldoTotal) }}
          </span>
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p class="text-xs text-gray-500 dark:text-gray-400">Elegí cómo imprimir el resumen.</p>
          <app-segmented-control
            ariaLabel="Formato de impresión"
            size="sm"
            [options]="printViewOptions"
            [(value)]="printViewMode">
          </app-segmented-control>
        </div>

        <ng-container *ngIf="printViewMode === 'totals'; else summaryItemsView">
          <div class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table class="w-full text-xs">
              <thead class="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th class="px-3 py-2 text-left font-semibold">Comprobante</th>
                  <th class="px-3 py-2 text-left font-semibold hidden sm:table-cell">Fecha</th>
                  <th class="px-3 py-2 text-right font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr *ngFor="let group of balanceSummaryGroups">
                  <td class="px-3 py-2">
                    <p class="font-medium text-gray-900 dark:text-gray-100">{{ group.label }}</p>
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 sm:hidden">{{ formatDate(group.fecha) }} · {{ group.detail }}</p>
                  </td>
                  <td class="px-3 py-2 text-gray-600 dark:text-gray-300 hidden sm:table-cell whitespace-nowrap">{{ formatDate(group.fecha) }}</td>
                  <td class="px-3 py-2 text-right font-bold tabular-nums text-orange-700 dark:text-orange-400 whitespace-nowrap">{{ formatMoney(group.saldo) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ng-container>

        <ng-template #summaryItemsView>
          <section
            *ngFor="let group of balanceSummaryGroups"
            class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div class="flex items-start justify-between gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-100 dark:border-gray-700">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ group.label }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {{ group.detail }}<span *ngIf="group.fecha"> · {{ formatDate(group.fecha) }}</span>
                </p>
              </div>
              <span class="text-sm font-bold tabular-nums text-orange-700 dark:text-orange-400 shrink-0">
                {{ formatMoney(group.saldo) }}
              </span>
            </div>
            <div *ngIf="group.lineas.length; else summaryNoLineas" class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead class="text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <tr>
                    <th class="px-3 py-1.5 text-left font-semibold">Ítem</th>
                    <th class="px-3 py-1.5 text-right font-semibold w-12">Cant.</th>
                    <th class="px-3 py-1.5 text-right font-semibold w-20">P. unit.</th>
                    <th class="px-3 py-1.5 text-right font-semibold w-20">Subtotal</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50 dark:divide-gray-800 text-gray-700 dark:text-gray-300">
                  <tr *ngFor="let linea of group.lineas">
                    <td class="px-3 py-1.5 align-top">{{ linea.nombre }}</td>
                    <td class="px-3 py-1.5 text-right tabular-nums align-top">{{ linea.cantidad }}</td>
                    <td class="px-3 py-1.5 text-right tabular-nums align-top whitespace-nowrap">{{ formatMoney(linea.precioUnitario) }}</td>
                    <td class="px-3 py-1.5 text-right tabular-nums font-medium align-top whitespace-nowrap">{{ formatMoney(linea.subtotal) }}</td>
                  </tr>
                </tbody>
                <tfoot class="bg-orange-50/80 dark:bg-orange-950/40 border-t border-orange-100 dark:border-orange-900/40">
                  <tr>
                    <td colspan="3" class="px-3 py-1.5 text-right font-semibold text-orange-900 dark:text-orange-200">Saldo pendiente</td>
                    <td class="px-3 py-1.5 text-right font-bold tabular-nums text-orange-700 dark:text-orange-400 whitespace-nowrap">{{ formatMoney(group.saldo) }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <ng-template #summaryNoLineas>
              <div class="flex items-center justify-between gap-3 px-3 py-2 text-xs border-t border-gray-100 dark:border-gray-800">
                <span class="text-gray-400">Sin detalle de ítems</span>
                <span class="font-bold tabular-nums text-orange-700 dark:text-orange-400">{{ formatMoney(group.saldo) }}</span>
              </div>
            </ng-template>
          </section>
        </ng-template>
      </div>
      <app-form-footer
        mode="modal"
        saveLabel="Imprimir"
        cancelLabel="Cerrar"
        footerClass="mt-4"
        (cancelClick)="closeBalanceSummary()"
        (saveClick)="printBalanceSummary()">
      </app-form-footer>
    </app-transaction-modal>
  `,
})
export class ClientHistorialComponent implements OnInit {
  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly listToolbarRowClass = LIST_TOOLBAR_ROW_CLASS;
  readonly compactListTrailingClass = COMPACT_LIST_TRAILING_ROW_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly tableMinWidthClass = TABLE_MIN_WIDTH_CLASS;
  readonly auth = inject(AuthService);

  private clientService = inject(ClientService);
  private orderService = inject(OrderService);
  private salesService = inject(SalesService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private navigationBack = inject(NavigationBackService);
  private catalogConfig = inject(CatalogConfigService);
  private balancePrint = inject(ClientBalancePrintService);

  appConfig = DEFAULT_APP_CONFIG;
  collectAmbito = getDefaultCashAmbitoId(DEFAULT_APP_CONFIG);

  clientId = '';
  clientName = 'Cliente';
  account: ClientAccount | null = null;
  loading = true;
  searchQuery = '';

  collectModalOpen = false;
  collectMode: CollectMode = 'item';
  collectTarget: CollectTarget | null = null;
  collectMonto: number | null = null;
  collectMedio = 'efectivo';
  collectNotas = '';
  collectSaving = false;
  balanceSummaryOpen = false;
  pendingViewMode: 'totals' | 'items' = 'totals';
  printViewMode: ClientBalancePrintMode = 'items';
  private expandedPendingKeys = new Set<string>();
  private collapsedPendingKeys = new Set<string>();

  readonly pendingViewOptions = [
    { id: 'totals', label: 'Totales' },
    { id: 'items', label: 'Por ítem' },
  ];

  readonly printViewOptions = [
    { id: 'totals', label: 'Solo totales' },
    { id: 'items', label: 'Con ítems' },
  ];

  pendingItems: Array<{
    key: string;
    label: string;
    detail: string;
    saldo: number;
    fecha: string;
    lineas: ClientAccountLineItem[];
    target: CollectTarget;
  }> = [];

  get balanceSummaryGroups(): ClientBalanceSummaryGroup[] {
    return this.pendingItems.map((entry) => ({
      label: entry.label,
      detail: entry.detail,
      fecha: entry.fecha,
      saldo: entry.saldo,
      lineas: entry.lineas,
    }));
  }

  get collectSaldoMax(): number {
    if (this.collectMode === 'client') {
      return Number(this.account?.saldoTotal) || 0;
    }
    if (!this.collectTarget) return 0;
    return this.collectTarget.kind === 'pedido'
      ? this.collectTarget.item.saldo
      : this.collectTarget.item.saldoPendiente;
  }

  get collectModalTitle(): string {
    return this.collectMode === 'client' ? 'Cobrar cuenta corriente' : 'Registrar cobro';
  }

  get collectModalSubtitle(): string {
    if (this.collectMode === 'client') {
      return `Un solo pago puede cubrir varios pedidos y ventas de ${this.clientName}.`;
    }
    if (!this.collectTarget) return '';
    if (this.collectTarget.kind === 'pedido') {
      return `Pedido #${this.collectTarget.item.numeroPedidoLabel} · se registra en caja y actualiza el saldo del pedido.`;
    }
    return `Venta #${this.collectTarget.item.ventaLabel} · cobro de saldo mostrador.`;
  }

  get collectAllocationPreview(): Array<{ label: string; monto: number }> {
    const monto = Number(this.collectMonto);
    if (!Number.isFinite(monto) || monto <= 0) return [];

    let remaining = monto;
    const preview: Array<{ label: string; monto: number }> = [];
    const sorted = [...this.pendingItems].sort((a, b) => a.fecha.localeCompare(b.fecha));

    for (const entry of sorted) {
      if (remaining <= 0) break;
      const apply = Math.min(remaining, entry.saldo);
      if (apply <= 0) continue;
      preview.push({ label: entry.label, monto: apply });
      remaining -= apply;
    }

    return preview;
  }

  get usesAmbitoSeparation(): boolean {
    return usesCashAmbitoSeparation(this.appConfig);
  }

  get cajaAmbitos() {
    return getCajaAmbitos(this.appConfig);
  }

  get showCollectAmbitoSelector(): boolean {
    if (!this.usesAmbitoSeparation) return false;
    if (this.collectMode === 'item') {
      return this.collectTarget?.kind === 'venta' && !this.collectTarget.item.ambito;
    }
    return this.allocationTouchesUnmarkedVenta();
  }

  get filteredPedidos(): ClientAccountOrder[] {
    const pedidos = (this.account?.pedidos ?? []).filter((pedido) =>
      this.auth.canViewOrder(pedido.estado)
    );
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return pedidos;

    return pedidos.filter((pedido) => {
      const haystack = [
        pedido.numeroPedidoLabel,
        pedido.descripcion,
        pedido.estado,
        pedido.fecha,
        pedido.fechaEntrega,
        String(pedido.total),
        String(pedido.saldo),
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');

      return haystack.includes(query);
    });
  }

  get filteredVentas(): ClientAccountSale[] {
    const ventas = this.account?.ventas ?? [];
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return ventas;

    return ventas.filter((venta) => {
      const origen =
        venta.origen === 'pedido'
          ? `pedido ${venta.numeroPedidoLabel ?? ''}`
          : 'mostrador';
      const haystack = [
        venta.ventaLabel,
        venta.numeroPedidoLabel,
        origen,
        venta.fecha,
        String(venta.total),
        String(venta.saldoPendiente),
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');

      return haystack.includes(query);
    });
  }

  ngOnInit() {
    this.catalogConfig.appConfig$.subscribe((config) => {
      this.appConfig = config;
      this.collectAmbito = getDefaultCashAmbitoId(config);
    });
    this.catalogConfig.getAppConfig().subscribe();

    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.router.navigate(['/clients']);
        return;
      }
      this.clientId = id;
      this.loadAccount();
    });
  }

  goBack(): void {
    this.navigationBack.back(['/clients']);
  }

  goEditClient(): void {
    if (!this.clientId) return;
    this.router.navigate(['/clients', this.clientId, 'edit']);
  }

  openBalanceSummary(): void {
    if (!this.pendingItems.length) return;
    this.printViewMode = this.pendingViewMode === 'items' ? 'items' : 'totals';
    this.balanceSummaryOpen = true;
  }

  closeBalanceSummary(): void {
    this.balanceSummaryOpen = false;
  }

  printBalanceSummary(): void {
    if (!this.pendingItems.length) return;
    this.balancePrint.printSummary(
      this.clientName,
      this.balanceSummaryGroups,
      Number(this.account?.saldoTotal) || 0,
      this.printViewMode
    );
  }

  pendingEntryKey(entry: { key: string }): string {
    return entry.key;
  }

  isPendingDetailOpen(entry: { key: string; lineas: ClientAccountLineItem[] }): boolean {
    if (!entry.lineas.length) return false;
    if (this.pendingViewMode === 'items') {
      return !this.collapsedPendingKeys.has(entry.key);
    }
    return this.expandedPendingKeys.has(entry.key);
  }

  togglePendingDetail(entry: { key: string; lineas: ClientAccountLineItem[] }): void {
    if (!entry.lineas.length) return;
    if (this.pendingViewMode === 'items') {
      if (this.collapsedPendingKeys.has(entry.key)) {
        this.collapsedPendingKeys.delete(entry.key);
      } else {
        this.collapsedPendingKeys.add(entry.key);
      }
      return;
    }
    if (this.expandedPendingKeys.has(entry.key)) {
      this.expandedPendingKeys.delete(entry.key);
    } else {
      this.expandedPendingKeys.add(entry.key);
    }
  }

  onPendingViewModeChange(mode: string): void {
    this.pendingViewMode = mode === 'items' ? 'items' : 'totals';
    this.expandedPendingKeys.clear();
    this.collapsedPendingKeys.clear();
  }

  private buildPendingEntryKey(target: CollectTarget): string {
    const id = target.kind === 'pedido' ? target.item.id : target.item.id;
    return `${target.kind}-${id}`;
  }

  loadAccount() {
    this.loading = true;
    this.clientService.getClientAccount(this.clientId).subscribe({
      next: (account) => {
        this.account = account;
        this.clientName = account.cliente.nombre || 'Cliente';
        this.buildPendingItems(account);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el historial del cliente.',
        });
        this.router.navigate(['/clients']);
      },
    });
  }

  buildPendingItems(account: ClientAccount) {
    const items: typeof this.pendingItems = [];

    for (const pedido of account.pedidos) {
      if (pedido.saldo <= 0) continue;
      items.push({
        key: this.buildPendingEntryKey({ kind: 'pedido', item: pedido }),
        label: `Pedido #${pedido.numeroPedidoLabel}`,
        detail: pedido.descripcion || pedido.estado || 'Pedido',
        saldo: pedido.saldo,
        fecha: pedido.fecha || pedido.fechaEntrega || '',
        lineas: pedido.lineas ?? [],
        target: { kind: 'pedido', item: pedido },
      });
    }

    for (const venta of account.ventas) {
      if (venta.origen === 'pedido' || venta.saldoPendiente <= 0) continue;
      items.push({
        key: this.buildPendingEntryKey({ kind: 'venta', item: venta }),
        label: `Venta #${venta.ventaLabel}`,
        detail: 'Venta mostrador',
        saldo: venta.saldoPendiente,
        fecha: venta.fecha || '',
        lineas: venta.lineas ?? [],
        target: { kind: 'venta', item: venta },
      });
    }

    items.sort((a, b) => a.fecha.localeCompare(b.fecha));
    this.pendingItems = items;
    this.expandedPendingKeys.clear();
    this.collapsedPendingKeys.clear();
  }

  formatDate(value?: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-AR');
  }

  formatPedidoFecha(pedido: ClientAccountOrder): string {
    return this.formatDate(pedido.fecha || pedido.fechaEntrega);
  }

  getPendingItemRoute(target: CollectTarget): string[] {
    if (target.kind === 'pedido') {
      return ['/orders', target.item.id, 'edit'];
    }
    return ['/sales'];
  }

  getPendingItemQueryParams(target: CollectTarget): Record<string, string> | null {
    if (target.kind === 'venta') {
      return { ventaId: target.item.id };
    }
    return null;
  }

  getVentaRoute(venta: ClientAccountSale): string[] {
    if (venta.origen === 'pedido' && venta.pedidoId) {
      return ['/orders', venta.pedidoId, 'edit'];
    }
    return ['/sales'];
  }

  getVentaQueryParams(venta: ClientAccountSale): Record<string, string> | null {
    if (venta.origen !== 'pedido') {
      return { ventaId: venta.id };
    }
    return null;
  }

  openClientCollectModal() {
    if (this.collectSaving) return;
    if (!(Number(this.account?.saldoTotal) > 0)) return;
    this.collectMode = 'client';
    this.collectTarget = null;
    this.collectMonto = Number(this.account?.saldoTotal) || 0;
    this.resetCollectFormFields();
    this.collectModalOpen = true;
  }

  openCollectModal(target: CollectTarget) {
    if (this.collectSaving) return;
    this.collectMode = 'item';
    this.collectTarget = target;
    this.collectMonto =
      target.kind === 'pedido' ? target.item.saldo : target.item.saldoPendiente;
    this.resetCollectFormFields();
    this.collectModalOpen = true;
  }

  private resetCollectFormFields() {
    this.collectMedio = 'efectivo';
    this.collectNotas = '';
    this.collectAmbito = getDefaultCashAmbitoId(this.appConfig);
  }

  private allocationTouchesUnmarkedVenta(): boolean {
    const monto = Number(this.collectMonto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return this.pendingItems.some(
        (entry) => entry.target.kind === 'venta' && !entry.target.item.ambito
      );
    }

    let remaining = monto;
    const sorted = [...this.pendingItems].sort((a, b) => a.fecha.localeCompare(b.fecha));
    for (const entry of sorted) {
      if (remaining <= 0) break;
      const apply = Math.min(remaining, entry.saldo);
      if (apply <= 0) continue;
      if (entry.target.kind === 'venta' && !entry.target.item.ambito) return true;
      remaining -= apply;
    }
    return false;
  }

  private buildCollectAmbitoPayload(): string | undefined {
    return this.showCollectAmbitoSelector ? this.collectAmbito : undefined;
  }

  closeCollectModal() {
    if (this.collectSaving) return;
    this.collectModalOpen = false;
    this.collectTarget = null;
    this.collectMode = 'item';
  }

  onCollectModalClosed() {
    if (this.collectSaving) return;
    this.closeCollectModal();
  }

  submitCollect() {
    if (this.collectSaving) return;

    const monto = Number(this.collectMonto);
    if (!Number.isFinite(monto) || monto <= 0) {
      this.dialogService.alert({
        title: 'Monto inválido',
        message: 'Ingresá un monto válido.',
      });
      return;
    }

    if (monto > this.collectSaldoMax) {
      this.dialogService.alert({
        title: 'Monto excedido',
        message: `El monto no puede superar el saldo pendiente ($${this.collectSaldoMax}).`,
      });
      return;
    }

    if (this.showCollectAmbitoSelector && !this.collectAmbito) {
      this.dialogService.alert({
        title: 'Caja requerida',
        message: 'Seleccioná la caja donde registrar el cobro.',
      });
      return;
    }

    this.collectSaving = true;
    const ambito = this.buildCollectAmbitoPayload();

    if (this.collectMode === 'client') {
      this.clientService
        .collectClientBalance(this.clientId, {
          monto,
          medioPago: this.collectMedio,
          notas: this.collectNotas.trim() || undefined,
          ambito,
        })
        .subscribe({
          next: () => this.onCollectSuccess(),
          error: (err) => this.onCollectError(err),
        });
      return;
    }

    if (!this.collectTarget) {
      this.collectSaving = false;
      return;
    }

    if (this.collectTarget.kind === 'pedido') {
      this.orderService
        .addOrderPayment(this.collectTarget.item.id, {
          monto,
          tipo: 'pago',
          notas: this.collectNotas.trim() || undefined,
        })
        .subscribe({
          next: () => this.onCollectSuccess(),
          error: (err) => this.onCollectError(err),
        });
      return;
    }

    this.salesService
      .collectSaleBalance(this.collectTarget.item.id, {
        monto,
        medioPago: this.collectMedio,
        notas: this.collectNotas.trim() || undefined,
        ambito,
      })
      .subscribe({
        next: () => this.onCollectSuccess(),
        error: (err) => this.onCollectError(err),
      });
  }

  private onCollectSuccess() {
    this.collectSaving = false;
    this.closeCollectModal();
    this.loadAccount();
  }

  private onCollectError(err: { error?: { error?: string } }) {
    this.collectSaving = false;
    this.dialogService.alert({
      title: 'Error',
      message: typeof err.error?.error === 'string' ? err.error.error : 'No se pudo registrar el cobro.',
    });
  }
}

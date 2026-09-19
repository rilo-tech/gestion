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
import {
  LIST_TOOLBAR_ROW_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_MIN_WIDTH_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { IconToolbarButtonComponent } from '../../shared/components/icon-toolbar/icon-toolbar-button.component';
import { AuthService } from '../../core/services/auth.service';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import { FormPageHeaderComponent } from '../../shared/components/form-shell';
import { FormFooterComponent } from '../../shared/components/form-shell/form-footer.component';
import { NavigationBackService } from '../../core/services/navigation-back.service';
import {
  buildClientHistorialReturnQueryParams,
} from '../../core/utils/client-historial-return-context';
import {
  ClientBalancePrintService,
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
import { buildClientAccountDetail } from '../../core/utils/client-account-detail';

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
    ListSearchFieldComponent,
    FormPageHeaderComponent,
    FormFooterComponent,
    SegmentedControlComponent,
  ],
  template: `
    <div [class]="pageShellClass + ' pb-20 sm:pb-24 min-h-full bg-gradient-to-b from-stone-50 via-white to-teal-50/40 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900'">
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
            class="text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-100 truncate leading-tight max-w-full"
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
        <div *ngIf="auth.canViewAccountBalance" class="module-summary-kpis grid grid-cols-2 lg:grid-cols-12 gap-2 sm:gap-3 mb-4">
          <div class="col-span-2 lg:col-span-5 rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-gradient-to-br from-amber-50 to-orange-50/80 dark:from-amber-950/40 dark:to-orange-950/20 p-3.5 sm:p-4 shadow-sm">
            <p class="text-[11px] font-semibold text-amber-800/70 dark:text-amber-200/70 uppercase tracking-wide mb-1">Saldo pendiente</p>
            <p
              class="text-2xl sm:text-3xl font-bold tabular-nums leading-none"
              [class.text-amber-700]="account.debe"
              [class.dark:text-amber-300]="account.debe"
              [class.text-gray-900]="!account.debe"
              [class.dark:text-gray-100]="!account.debe">
              {{ formatMoney(account.saldoTotal) }}
            </p>
          </div>
          <div class="lg:col-span-2 rounded-2xl border border-stone-200/80 dark:border-gray-700 bg-white/90 dark:bg-gray-900/80 p-3 sm:p-3.5 shadow-sm backdrop-blur-sm">
            <p class="text-[11px] font-semibold text-gray-400 uppercase mb-0.5">Facturado</p>
            <p class="text-base sm:text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-tight">
              {{ formatMoney(account.totalFacturado || 0) }}
            </p>
          </div>
          <div class="lg:col-span-2 rounded-2xl border border-teal-200/70 dark:border-teal-900/40 bg-gradient-to-br from-teal-50 to-emerald-50/70 dark:from-teal-950/30 dark:to-emerald-950/20 p-3 sm:p-3.5 shadow-sm">
            <p class="text-[11px] font-semibold text-teal-800/70 dark:text-teal-200/70 uppercase mb-0.5">Cobrado</p>
            <p class="text-base sm:text-lg font-bold tabular-nums text-teal-700 dark:text-teal-300 leading-tight">
              {{ formatMoney(account.totalCobrado || 0) }}
            </p>
          </div>
          <div class="col-span-2 lg:col-span-3 rounded-2xl border border-stone-200/80 dark:border-gray-700 bg-white/90 dark:bg-gray-900/80 p-3 sm:p-3.5 shadow-sm backdrop-blur-sm">
            <p class="text-[11px] font-semibold text-gray-400 uppercase mb-1">Desglose deuda</p>
            <p class="text-xs text-gray-600 dark:text-gray-300 leading-snug">Pedidos: {{ formatMoney(account.saldoPedidos) }}</p>
            <p class="text-xs text-gray-600 dark:text-gray-300 leading-snug">Mostrador: {{ formatMoney(account.saldoVentasMostrador) }}</p>
          </div>
        </div>

        <section
          *ngIf="auth.canViewAccountBalance && pendingItems.length"
          class="mb-4 rounded-2xl border border-amber-200/80 dark:border-amber-900/40 bg-white dark:bg-gray-950/60 overflow-hidden shadow-sm">
          <div class="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-amber-100 dark:border-amber-900/30 bg-amber-50/70 dark:bg-amber-950/30">
            <h2 class="text-xs font-bold text-amber-950 dark:text-amber-100">Saldos pendientes de cobro</h2>
            <app-icon-toolbar-button
              *ngIf="auth.canViewAccountBalance"
              icon="printer"
              label="Imprimir"
              variant="orange-outline"
              size="row"
              (clicked)="printBalanceSummary()">
            </app-icon-toolbar-button>
          </div>

          <!-- Desktop table -->
          <div class="hidden sm:block overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="bg-stone-50 dark:bg-gray-900/80 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th class="px-2.5 py-1.5 text-left font-semibold w-[6.5rem]">Fecha</th>
                  <th class="px-2.5 py-1.5 text-left font-semibold">Detalle</th>
                  <th class="px-2.5 py-1.5 text-right font-semibold w-[6.5rem]">Pendiente</th>
                  <th *ngIf="auth.canAccessCash" class="px-1.5 py-1.5 text-right font-semibold w-10"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-stone-100 dark:divide-gray-800">
                <ng-container *ngFor="let entry of pendingItems">
                  <tr class="hover:bg-amber-50/40 dark:hover:bg-amber-950/20">
                    <td class="px-2.5 py-1 tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap align-middle">
                      {{ formatDate(entry.fecha) }}
                    </td>
                    <td class="px-2.5 py-1 align-middle min-w-0">
                      <button
                        type="button"
                        class="w-full text-left group flex items-baseline gap-1.5 min-w-0"
                        (click)="togglePendingDetail(entry)">
                        <span class="font-semibold text-gray-900 dark:text-gray-100 truncate group-hover:text-teal-700 dark:group-hover:text-teal-400">
                          {{ inlineDetail(entry.detailPrimary) }}
                        </span>
                        <span class="shrink-0 text-[10px] text-gray-400">{{ entry.label }}</span>
                      </button>
                    </td>
                    <td class="px-2.5 py-1 text-right font-bold tabular-nums text-amber-800 dark:text-amber-300 whitespace-nowrap align-middle">
                      {{ formatMoney(entry.saldo) }}
                    </td>
                    <td *ngIf="auth.canAccessCash" class="px-1.5 py-0.5 text-right align-middle">
                      <app-icon-toolbar-button
                        icon="wallet"
                        label="Cobrar"
                        variant="ghost-teal"
                        size="row"
                        [disabled]="collectSaving"
                        (clicked)="openCollectModal(entry.target)">
                      </app-icon-toolbar-button>
                    </td>
                  </tr>
                  <tr *ngIf="isPendingDetailOpen(entry)" class="bg-stone-50/90 dark:bg-gray-900/70">
                    <td [attr.colspan]="auth.canAccessCash ? 4 : 3" class="px-2.5 py-1.5">
                      <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <a
                          [routerLink]="getPendingItemRoute(entry.target)"
                          [queryParams]="getPendingItemQueryParams(entry.target)"
                          class="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline">
                          Abrir {{ entry.label }}
                        </a>
                        <span class="text-[11px] text-gray-500">Saldo: {{ formatMoney(entry.saldo) }}</span>
                      </div>
                      <div *ngIf="entry.lineas.length; else pendingSaldoOnly" class="space-y-0.5">
                        <div
                          *ngFor="let linea of entry.lineas"
                          class="flex items-baseline justify-between gap-2 text-xs leading-tight">
                          <span class="min-w-0 truncate text-gray-800 dark:text-gray-100">
                            <span *ngIf="linea.cantidad > 1" class="tabular-nums text-gray-500">{{ linea.cantidad }}× </span>{{ linea.nombre }}
                          </span>
                          <span class="shrink-0 tabular-nums font-medium text-gray-900 dark:text-gray-100">{{ formatMoney(linea.subtotal) }}</span>
                        </div>
                      </div>
                      <ng-template #pendingSaldoOnly>
                        <p class="text-xs text-gray-400">Sin detalle de ítems en el comprobante.</p>
                      </ng-template>
                    </td>
                  </tr>
                </ng-container>
              </tbody>
              <tfoot>
                <tr class="border-t border-stone-300 dark:border-gray-600 bg-amber-50/60 dark:bg-amber-950/25">
                  <td colspan="2" class="px-2.5 py-1.5 text-right text-[10px] font-bold uppercase tracking-wide text-amber-950 dark:text-amber-100">
                    Total pendiente
                  </td>
                  <td class="px-2.5 py-1.5 text-right text-sm font-bold tabular-nums text-amber-800 dark:text-amber-300 whitespace-nowrap">
                    {{ formatMoney(account.saldoTotal) }}
                  </td>
                  <td *ngIf="auth.canAccessCash"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- Mobile compact rows -->
          <div class="sm:hidden divide-y divide-stone-100 dark:divide-gray-800">
            <div *ngFor="let entry of pendingItems" class="px-2.5 py-1.5 bg-white dark:bg-gray-950/40">
              <div class="flex items-center gap-2">
                <button type="button" class="min-w-0 flex-1 text-left" (click)="togglePendingDetail(entry)">
                  <div class="flex items-baseline gap-2 min-w-0">
                    <span class="shrink-0 text-[11px] tabular-nums text-gray-500 w-[4.5rem]">{{ formatDate(entry.fecha) }}</span>
                    <span class="min-w-0 flex-1 truncate text-xs font-semibold text-gray-900 dark:text-gray-100">{{ inlineDetail(entry.detailPrimary) }}</span>
                    <span class="shrink-0 text-xs font-bold tabular-nums text-amber-800 dark:text-amber-300">{{ formatMoney(entry.saldo) }}</span>
                  </div>
                  <p class="text-[10px] text-gray-400 pl-[4.5rem] truncate">{{ entry.label }}</p>
                </button>
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
              <div *ngIf="isPendingDetailOpen(entry)" class="mt-1.5 rounded-md border border-stone-200 dark:border-gray-700 bg-stone-50 dark:bg-gray-900 px-2 py-1.5">
                <a
                  [routerLink]="getPendingItemRoute(entry.target)"
                  [queryParams]="getPendingItemQueryParams(entry.target)"
                  class="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline">
                  Abrir {{ entry.label }}
                </a>
                <div *ngIf="entry.lineas.length" class="mt-1 space-y-0.5">
                  <div *ngFor="let linea of entry.lineas" class="flex justify-between gap-2 text-xs">
                    <span class="truncate">{{ linea.cantidad > 1 ? linea.cantidad + '× ' : '' }}{{ linea.nombre }}</span>
                    <span class="tabular-nums shrink-0">{{ formatMoney(linea.subtotal) }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="px-2.5 py-1.5 flex items-center justify-between bg-amber-50/80 dark:bg-amber-950/30">
              <span class="text-[10px] font-bold uppercase text-amber-950 dark:text-amber-100">Total pendiente</span>
              <span class="text-sm font-bold tabular-nums text-amber-800 dark:text-amber-300">{{ formatMoney(account.saldoTotal) }}</span>
            </div>
          </div>
        </section>

        <section
          *ngIf="auth.canViewAccountBalance"
          class="mb-4 bg-white/95 dark:bg-gray-900/90 rounded-2xl border border-stone-200/80 dark:border-gray-700 shadow-sm overflow-hidden backdrop-blur-sm">
          <h2 class="text-xs font-bold text-gray-900 dark:text-gray-100 px-3 py-1.5 border-b border-stone-100 dark:border-gray-800 bg-stone-50/80 dark:bg-gray-950/40">
            Cuenta corriente
          </h2>
          <div *ngIf="!accountLedgerRows.length" class="px-3 py-6 text-center text-gray-400 text-xs">
            Todavía no hay movimientos para este cliente.
          </div>

          <div *ngIf="accountLedgerRows.length" class="hidden sm:block overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="bg-stone-50 dark:bg-gray-900/80 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th class="px-2.5 py-1.5 text-left font-semibold w-[6.5rem]">Fecha</th>
                  <th class="px-2.5 py-1.5 text-left font-semibold w-[4.75rem]">Mov.</th>
                  <th class="px-2.5 py-1.5 text-left font-semibold">Detalle</th>
                  <th class="px-2.5 py-1.5 text-right font-semibold w-[6.5rem]">Importe</th>
                  <th class="px-2.5 py-1.5 text-right font-semibold w-[11rem]">Cobrado / saldo</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-stone-100 dark:divide-gray-800">
                <tr *ngFor="let row of accountLedgerRows">
                  <td class="px-2.5 py-1 tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap align-middle">{{ formatDate(row.fecha) }}</td>
                  <td class="px-2.5 py-1 align-middle">
                    <span
                      class="inline-flex text-[10px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded"
                      [class.bg-stone-100]="row.kind !== 'cobro'"
                      [class.text-stone-700]="row.kind !== 'cobro'"
                      [class.dark:bg-gray-800]="row.kind !== 'cobro'"
                      [class.dark:text-gray-200]="row.kind !== 'cobro'"
                      [class.bg-teal-50]="row.kind === 'cobro'"
                      [class.text-teal-800]="row.kind === 'cobro'"
                      [class.dark:bg-teal-950/40]="row.kind === 'cobro'"
                      [class.dark:text-teal-300]="row.kind === 'cobro'">
                      {{ row.movimiento }}
                    </span>
                  </td>
                  <td class="px-2.5 py-1 align-middle min-w-0">
                    <div class="flex items-baseline gap-1.5 min-w-0">
                      <span class="font-medium text-gray-900 dark:text-gray-100 truncate">{{ inlineDetail(row.detailPrimary) }}</span>
                      <span *ngIf="row.referencia" class="shrink-0 text-[10px] text-gray-400">{{ row.referencia }}</span>
                    </div>
                  </td>
                  <td
                    class="px-2.5 py-1 text-right tabular-nums font-semibold whitespace-nowrap align-middle"
                    [class.text-teal-700]="row.kind === 'cobro'"
                    [class.dark:text-teal-400]="row.kind === 'cobro'"
                    [class.text-gray-900]="row.kind !== 'cobro'"
                    [class.dark:text-gray-100]="row.kind !== 'cobro'">
                    {{ row.kind === 'cobro' ? '−' : '' }}{{ formatMoney(row.importe) }}
                  </td>
                  <td class="px-2.5 py-1 text-right text-[11px] text-gray-600 dark:text-gray-300 whitespace-nowrap align-middle">
                    {{ row.secondary }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div *ngIf="accountLedgerRows.length" class="sm:hidden divide-y divide-stone-100 dark:divide-gray-800">
            <div *ngFor="let row of accountLedgerRows" class="px-2.5 py-1.5">
              <div class="flex items-center gap-2 min-w-0">
                <span class="shrink-0 text-[11px] tabular-nums text-gray-500 w-[4.5rem]">{{ formatDate(row.fecha) }}</span>
                <span
                  class="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-500 w-12"
                  [class.text-teal-700]="row.kind === 'cobro'"
                  [class.dark:text-teal-400]="row.kind === 'cobro'">
                  {{ row.movimiento }}
                </span>
                <span class="min-w-0 flex-1 truncate text-xs font-medium text-gray-900 dark:text-gray-100">{{ inlineDetail(row.detailPrimary) }}</span>
                <span
                  class="shrink-0 text-xs font-bold tabular-nums"
                  [class.text-teal-700]="row.kind === 'cobro'"
                  [class.dark:text-teal-400]="row.kind === 'cobro'"
                  [class.text-gray-900]="row.kind !== 'cobro'"
                  [class.dark:text-gray-100]="row.kind !== 'cobro'">
                  {{ row.kind === 'cobro' ? '−' : '' }}{{ formatMoney(row.importe) }}
                </span>
              </div>
              <p class="text-[10px] text-gray-400 pl-[4.5rem] truncate">
                <span *ngIf="row.referencia">{{ row.referencia }}</span>
                <span *ngIf="row.referencia && row.secondary"> · </span>
                <span *ngIf="row.secondary">{{ row.secondary }}</span>
              </p>
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
                      <p class="text-xs text-gray-700 truncate whitespace-pre-line">{{ orderDetailPrimary(pedido) }}</p>
                      <p class="text-xs text-gray-400 sm:hidden">{{ formatPedidoFecha(pedido) }}</p>
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
                      <p class="text-xs text-gray-700 truncate whitespace-pre-line">{{ saleDetailPrimary(venta) }}</p>
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
  `,
})
export class ClientHistorialComponent implements OnInit {
  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }

  inlineDetail(value?: string | null): string {
    return String(value ?? '')
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' · ');
  }

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly listToolbarRowClass = LIST_TOOLBAR_ROW_CLASS;
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
  private expandedPendingKeys = new Set<string>();

  pendingItems: Array<{
    key: string;
    label: string;
    detail: string;
    detailPrimary: string;
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

  get accountLedgerRows(): Array<{
    key: string;
    fecha: string;
    kind: 'pedido' | 'venta' | 'cobro';
    movimiento: string;
    detailPrimary: string;
    referencia: string;
    importe: number;
    secondary: string;
  }> {
    if (!this.account) return [];
    const rows: Array<{
      key: string;
      fecha: string;
      kind: 'pedido' | 'venta' | 'cobro';
      movimiento: string;
      detailPrimary: string;
      referencia: string;
      importe: number;
      secondary: string;
      sortKey: string;
    }> = [];

    for (const pedido of this.account.pedidos ?? []) {
      if (!this.auth.canViewOrder(pedido.estado)) continue;
      const referencia = `Pedido #${pedido.numeroPedidoLabel}`;
      const detail = buildClientAccountDetail({
        lineas: pedido.lineas,
        concepto: pedido.descripcion,
        referencia,
      });
      const cobrado = Number(pedido.totalPagado) || 0;
      const saldo = Number(pedido.saldo) || 0;
      rows.push({
        key: `pedido-${pedido.id}`,
        fecha: pedido.fecha || pedido.fechaEntrega || '',
        kind: 'pedido',
        movimiento: 'Pedido',
        detailPrimary: detail.primary,
        referencia,
        importe: Number(pedido.total) || 0,
        secondary: `Cobrado ${this.formatMoney(cobrado)} · Saldo ${this.formatMoney(saldo)}`,
        sortKey: pedido.fecha || pedido.fechaEntrega || '',
      });
    }

    for (const venta of this.account.ventas ?? []) {
      if (venta.origen === 'pedido') continue;
      const referencia = `Venta #${venta.ventaLabel}`;
      const detail = buildClientAccountDetail({
        lineas: venta.lineas,
        concepto: null,
        referencia,
      });
      const cobrado = Number(venta.montoCobrado) || 0;
      const saldo = Number(venta.saldoPendiente) || 0;
      rows.push({
        key: `venta-${venta.id}`,
        fecha: venta.fecha || '',
        kind: 'venta',
        movimiento: 'Venta',
        detailPrimary: detail.primary,
        referencia,
        importe: Number(venta.total) || 0,
        secondary: `Cobrado ${this.formatMoney(cobrado)} · Saldo ${this.formatMoney(saldo)}`,
        sortKey: venta.fecha || '',
      });
    }

    for (const pago of this.account.historialPagos ?? []) {
      const referenciaParts = [
        pago.numeroPedidoLabel ? `Pedido #${pago.numeroPedidoLabel}` : '',
        pago.ventaLabel ? `Venta #${pago.ventaLabel}` : '',
      ].filter(Boolean);
      rows.push({
        key: `cobro-${pago.id}`,
        fecha: pago.fecha || '',
        kind: 'cobro',
        movimiento: 'Cobro',
        detailPrimary: String(pago.concepto || pago.medio || 'Cobro').trim() || 'Cobro',
        referencia: referenciaParts.join(' · '),
        importe: Number(pago.monto) || 0,
        secondary: pago.medio ? String(pago.medio) : '',
        sortKey: pago.fecha || '',
      });
    }

    rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return rows.map(({ sortKey: _sortKey, ...row }) => row);
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
      const detail = this.orderDetailPrimary(pedido);
      const haystack = [
        pedido.numeroPedidoLabel,
        pedido.descripcion,
        detail,
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
      const detail = this.saleDetailPrimary(venta);
      const haystack = [
        venta.ventaLabel,
        venta.numeroPedidoLabel,
        origen,
        detail,
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

  printBalanceSummary(): void {
    if (!this.pendingItems.length) return;
    this.balancePrint.printSummary(
      this.clientName,
      this.balanceSummaryGroups,
      Number(this.account?.saldoTotal) || 0
    );
  }

  orderDetailPrimary(pedido: ClientAccountOrder): string {
    return buildClientAccountDetail({
      lineas: pedido.lineas,
      concepto: pedido.descripcion,
      referencia: `Pedido #${pedido.numeroPedidoLabel}`,
    }).primary;
  }

  saleDetailPrimary(venta: ClientAccountSale): string {
    const referencia =
      venta.origen === 'pedido'
        ? `Pedido #${venta.numeroPedidoLabel || '—'}`
        : `Venta #${venta.ventaLabel}`;
    return buildClientAccountDetail({
      lineas: venta.lineas,
      concepto: null,
      referencia,
    }).primary;
  }

  isPendingDetailOpen(entry: { key: string }): boolean {
    return this.expandedPendingKeys.has(entry.key);
  }

  togglePendingDetail(entry: { key: string }): void {
    if (this.expandedPendingKeys.has(entry.key)) {
      this.expandedPendingKeys.delete(entry.key);
    } else {
      this.expandedPendingKeys.add(entry.key);
    }
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
      const label = `Pedido #${pedido.numeroPedidoLabel}`;
      const detail = buildClientAccountDetail({
        lineas: pedido.lineas,
        concepto: pedido.descripcion,
        referencia: label,
      });
      items.push({
        key: this.buildPendingEntryKey({ kind: 'pedido', item: pedido }),
        label,
        detail: pedido.descripcion || '',
        detailPrimary: detail.primary,
        saldo: pedido.saldo,
        fecha: pedido.fecha || pedido.fechaEntrega || '',
        lineas: pedido.lineas ?? [],
        target: { kind: 'pedido', item: pedido },
      });
    }

    for (const venta of account.ventas) {
      if (venta.origen === 'pedido' || venta.saldoPendiente <= 0) continue;
      const label = `Venta #${venta.ventaLabel}`;
      const detail = buildClientAccountDetail({
        lineas: venta.lineas,
        concepto: null,
        referencia: label,
      });
      items.push({
        key: this.buildPendingEntryKey({ kind: 'venta', item: venta }),
        label,
        detail: '',
        detailPrimary: detail.primary,
        saldo: venta.saldoPendiente,
        fecha: venta.fecha || '',
        lineas: venta.lineas ?? [],
        target: { kind: 'venta', item: venta },
      });
    }

    items.sort((a, b) => a.fecha.localeCompare(b.fecha));
    this.pendingItems = items;
    this.expandedPendingKeys.clear();
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
    if (!this.clientId) return null;
    if (target.kind === 'venta') {
      return buildClientHistorialReturnQueryParams(this.clientId, { ventaId: target.item.id });
    }
    return buildClientHistorialReturnQueryParams(this.clientId);
  }

  getVentaRoute(venta: ClientAccountSale): string[] {
    if (venta.origen === 'pedido' && venta.pedidoId) {
      return ['/orders', venta.pedidoId, 'edit'];
    }
    return ['/sales'];
  }

  getVentaQueryParams(venta: ClientAccountSale): Record<string, string> | null {
    if (!this.clientId) return null;
    if (venta.origen !== 'pedido') {
      return buildClientHistorialReturnQueryParams(this.clientId, { ventaId: venta.id });
    }
    return buildClientHistorialReturnQueryParams(this.clientId);
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

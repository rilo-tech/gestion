import {
  Component,
  DestroyRef,
  HostListener,
  ViewChild,
  inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ClientService, Client } from '../../core/services/client.service';
import { StockService, StockItem, itemControlsStock, getStockDisponible } from '../../core/services/stock.service';
import {
  OrderLineItem,
  OrderLineExtraCost,
  OrderPayment,
  OrderService,
  Order,
  OrderUpdateResult,
  formatOrderNumber,
  OrderStockDiscountPreview,
  OrderPhysicalStockScope,
  resolveOrderBalance,
} from '../../core/services/order.service';
import { OrderPrintService } from '../../core/services/order-print.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  getOrderWorkflowStatusOptions,
  getOrderStatusLabelFromConfig,
  validateOrderEstadoTransition,
  orderConfigUsesReservedStock,
  orderEstadoMatchesStockTrigger,
  OrderExtraCostPreset,
  usesDetailedOrderExtraCosts,
} from '../../core/services/catalog-config.service';
import {
  shouldConsumeStockOnStatusChange,
  orderStockFullyConsumed,
  getOrderPhysicalStockScopeLabel,
  resolveOrderPhysicalStockScope,
} from '../../core/constants/order-config';
import { PERMISSIONS } from '../../core/constants/permissions';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { TransactionPartySearchComponent } from '../../shared/components/transaction-party-search/transaction-party-search.component';
import { SearchableSelectOption } from '../../shared/components/searchable-select/searchable-select.component';
import {
  getOrderStatusBadgeClass,
  getOrderStatusLabel,
  normalizeOrderStatus,
  canRegisterSaleFromOrder,
  orderIsLockedForEdit,
  isOrderDeliveryEstado,
} from '../../core/constants/order-status';
import {
  getOrderStockStatusBadgeClass,
  getOrderStockStatusLabel,
} from '../../core/constants/order-stock-status';
import { OrderStockPreparationPanelComponent } from './order-stock-preparation-panel.component';
import { buildSuggestedStockAllocations } from '../../core/utils/order-stock-prep';
import {
  saveOrderFormDraft,
  readOrderFormDraft,
  clearOrderFormDraft,
} from '../../core/utils/form-return-context';
import { LucideAngularModule } from 'lucide-angular';
import { TransactionLinesSectionComponent } from '../../shared/components/transaction-lines-section/transaction-lines-section.component';
import { TransactionProductSearchComponent } from '../../shared/components/transaction-product-search/transaction-product-search.component';
import {
  TransactionLinesTableComponent,
  buildTransactionTableColumns,
  ORDER_FORM_TABLE_COLUMNS,
} from '../../shared/components/transaction-lines-table/transaction-lines-table.component';
import {
  TransactionExtraCostsFormComponent,
  TransactionExtraCost,
} from '../../shared/components/transaction-extra-costs-form/transaction-extra-costs-form.component';
import {
  TransactionTableFieldChange,
  TransactionTableLine,
} from '../../shared/components/transaction-lines-table/transaction-lines-table.types';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import { NavigationBackService } from '../../core/services/navigation-back.service';
import {
  ClientFormPanelComponent,
  ClientFormSaveEvent,
} from '../clients/client-form-panel.component';
import {
  matchCatalogEntry,
  PriceCatalogEntry,
  PriceCatalogService,
  resolveVariantUnitPrice,
} from '../../core/services/price-catalog.service';
import {
  TransactionPartyFieldComponent,
  TransactionSummaryPanelComponent,
  TransactionFormPageComponent,
  TransactionDateFieldComponent,
  TransactionSaveBannerComponent,
} from '../../shared/components/transaction-form';
import {
  dateInputToIso,
  toDateInputValue,
} from '../../core/utils/transaction-date';
import { FormFooterComponent } from '../../shared/components/form-shell';
import { RecordActionToolbarComponent } from '../../shared/components/icon-toolbar';

@Component({
  selector: 'app-new-order',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, TransactionPartySearchComponent, RouterLink, HasPermissionDirective, TransactionModalComponent, ClientFormPanelComponent, OrderStockPreparationPanelComponent, TransactionLinesSectionComponent, TransactionProductSearchComponent, TransactionLinesTableComponent, TransactionExtraCostsFormComponent, TransactionPartyFieldComponent, TransactionDateFieldComponent, TransactionSummaryPanelComponent, RecordActionToolbarComponent, TransactionFormPageComponent, FormFooterComponent, TransactionSaveBannerComponent],
  template: `
    <app-transaction-form-page
      [title]="orderPageTitle"
      [titleBadge]="orderPageTitleBadge"
      [subtitle]="orderPageSubtitle"
      backLabel="Volver a pedidos"
      backShortLabel="Volver"
      backAriaLabel="Volver a pedidos"
      (backClick)="goBack()"
      [hasHeaderActions]="hasOrderHeaderActions">
      <div headerActions *ngIf="hasOrderHeaderActions" class="flex flex-wrap items-center gap-2.5 sm:gap-3">
        <app-record-action-toolbar
          [showSave]="!isReadOnlyOrder || canSaveLockedDescription"
          [saveLabel]="primaryButtonLabel"
          [saveDisabled]="orderSaveState === 'saving'"
          [saveLoading]="orderSaveState === 'saving' && orderSaveAction === 'submit'"
          (saveClick)="onOrderSaveClick()"
          [showDuplicate]="canDuplicateOrder"
          duplicateLabel="Duplicar pedido"
          (duplicateClick)="duplicateOrder()"
          [showPrint]="isEditing && auth.canPrintOrders"
          printLabel="Imprimir pedido"
          (printClick)="printCurrentOrder()"
          [showDelete]="isEditing && !isReadOnlyOrder && auth.canEditRecords && !isCancelledOrder && !isLockedOrder"
          deleteLabel="Cancelar pedido"
          (deleteClick)="confirmCancelCurrentOrder()"
          [showRegisterSale]="canRegisterSale && auth.canCreateSales"
          (registerSaleClick)="registerSaleFromOrder()">
        </app-record-action-toolbar>
      </div>

      <ng-container main *ngIf="orderPageReady; else orderPageLoading">
      <app-transaction-save-banner [message]="orderSaveBannerText"></app-transaction-save-banner>

      <div
        *ngIf="isDeliveryPendingSave"
        class="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Elegiste <span class="font-semibold">{{ getOrderStatusLabelFor(order.estado) }}</span>.
        Guardá el pedido para {{ deliveryPendingSaveHint }} y cerrarlo (después no se podrá editar).
      </div>

      <div
        *ngIf="isLockedOrder && !isCancelledOrder"
        class="mb-6 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
        Pedido en estado <span class="font-semibold">Entregado total</span>. Montos, productos y estado no se modifican.
        Podés actualizar la <span class="font-semibold">descripción del trabajo</span>.
        Registrá pagos pendientes desde caja, el saldo del cliente o la venta asociada.
      </div>

      <div
        *ngIf="isCancelledOrder"
        class="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        Pedido en estado <span class="font-semibold">Cancelado</span>. No podés editarlo, cambiar el estado ni registrar pagos.
      </div>

      <div class="space-y-4">
          <section class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <div
              class="relative z-50 overflow-visible grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_10.5rem_10.5rem] items-start mb-4">
              <div class="min-w-0 overflow-visible col-span-2 lg:col-span-1">
                <app-transaction-party-field
                  label="Cliente"
                  [showCreateAction]="!isReadOnlyOrder"
                  createActionLabel="+ Nuevo cliente"
                  (createClick)="goToNewClientForm()">
                  <app-transaction-party-search
                    [(ngModel)]="order.clienteId"
                    inputName="clienteId"
                    [labeledOptions]="clientOptions"
                    [fallbackLabel]="selectedClientLabel"
                    [disabled]="isReadOnlyOrder"
                    [creatable]="!isReadOnlyOrder"
                    createLabelPrefix="Crear cliente"
                    (partySelected)="onOrderPartySelected($event)"
                    (createRequested)="quickCreateClient($event)"
                    (searchChange)="pendingClientName = $event"
                    placeholder="Buscar cliente..."
                    emptyOptionsMessage="Escribí al menos 2 letras para buscar clientes.">
                  </app-transaction-party-search>
                </app-transaction-party-field>
              </div>

              <div class="min-w-0">
                <app-transaction-date-field
                  [date]="orderFechaInput"
                  (dateChange)="onOrderFechaChange($event)"
                  fieldName="orderFecha"
                  label="Fecha"
                  [disabled]="isReadOnlyOrder">
                </app-transaction-date-field>
              </div>

              <div class="min-w-0">
                <app-transaction-date-field
                  [date]="fechaEntregaInput"
                  (dateChange)="onFechaEntregaChange($event)"
                  fieldName="fechaEntrega"
                  label="Entrega"
                  [disabled]="isReadOnlyOrder">
                </app-transaction-date-field>
              </div>
            </div>

            <div *ngIf="isEditing" class="mb-4">
              <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1.5 sm:gap-y-0 min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300 shrink-0">Estado</label>
                  <select
                    *ngIf="!isReadOnlyOrder"
                    [ngModel]="orderEstadoDisplay"
                    (ngModelChange)="onOrderEstadoChange($event)"
                    name="estado"
                    class="order-status-select min-w-0 flex-1 sm:flex-none sm:min-w-[9rem] sm:w-[10.5rem] lg:min-w-[11rem] lg:w-[12.5rem] px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 disabled:opacity-60 cursor-pointer">
                    <option *ngFor="let option of orderStatusOptions" [value]="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                  <span
                    *ngIf="isReadOnlyOrder"
                    class="inline-flex px-2 py-0.5 rounded-md text-xs font-semibold shrink-0"
                    [ngClass]="getOrderStatusBadgeClass(order.estado)">
                    {{ getOrderStatusLabelFor(order.estado) }}
                  </span>
                </div>
                <div
                  *ngIf="canReviewStock"
                  class="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                  <span
                    *ngIf="order.estadoStock"
                    class="inline-flex px-2 py-1 rounded-md text-xs font-semibold shrink-0 whitespace-nowrap"
                    [ngClass]="getOrderStockStatusBadgeClass(order.estadoStock)">
                    {{ getOrderStockStatusLabel(order.estadoStock) }}
                  </span>
                  <button
                    type="button"
                    (click)="openStockPreparation()"
                    class="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:text-teal-900 dark:hover:text-teal-300 underline shrink-0 whitespace-nowrap">
                    {{ order.stockPreparado ? 'Editar stock' : 'Revisar stock' }}
                  </button>
                  <button
                    *ngIf="canConsumePendingReservedStockNow"
                    type="button"
                    (click)="openConsumePendingDialog()"
                    [disabled]="consumingPendingStock"
                    class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 hover:bg-teal-100 dark:hover:bg-teal-950/60 disabled:opacity-60 disabled:cursor-not-allowed shrink-0 whitespace-nowrap">
                    {{ consumingPendingStock ? 'Descontando…' : ('Descontar (' + pendingReservedToConsumeUnits + ' u.)') }}
                  </button>
                  <span *ngIf="lastStockOperationLabel" class="text-[10px] text-gray-500 dark:text-gray-400 hidden sm:inline shrink-0">
                    {{ lastStockOperationLabel }}
                  </span>
                </div>
              </div>
              <p
                *ngIf="orderPhysicalDiscountHint"
                class="mt-1.5 text-xs text-gray-600 rounded-lg bg-gray-50 border border-gray-100 px-2 py-1.5">
                {{ orderPhysicalDiscountHint }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Descripción del trabajo</label>
              <textarea
                [(ngModel)]="order.descripcion"
                name="descripcion"
                rows="3"
                [disabled]="!canEditOrderDescription"
                placeholder="Ej. 13 canguros — seña recibida, faltan talles y diseños"
                class="w-full px-4 py-2 rounded-lg border border-gray-200 text-xs sm:text-sm outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 disabled:text-gray-500 max-lg:min-h-[5.5rem]">
              </textarea>
            </div>
          </section>

          <div
            *ngIf="orderDetailLoading && orderLines.length === 0"
            class="py-6 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl bg-white">
            Cargando productos del pedido...
          </div>

          <app-transaction-lines-section
            *ngIf="!(orderDetailLoading && orderLines.length === 0)"
            title="Productos del pedido"
            icon="package"
            [lineCount]="orderLines.length"
            [searchVisible]="!isReadOnlyOrder"
            searchTitle="Agregar productos"
            searchHint="Buscá y hacé clic en un producto para agregarlo a la lista.">
            <app-transaction-product-search
              search
              *ngIf="!isReadOnlyOrder"
              [selectOnRowClick]="true"
              [showAddButton]="false"
              [showBaseCost]="false"
              [addedProductIds]="addedOrderProductIds"
              addedLabel="En el pedido"
              [itemMeta]="orderSearchResultSubtitle"
              inputName="orderProductSearch"
              (focused)="onProductSearchFocused()"
              (productSelected)="onOrderProductSelected($event)">
            </app-transaction-product-search>

            <app-transaction-lines-table
              #orderLinesTable
              [hideWhenEmpty]="true"
              [lines]="orderTableLines"
              [columns]="orderTableColumns"
              [readOnly]="isReadOnlyOrder"
              fieldNamePrefix="orderLine"
              (fieldChange)="onOrderTableFieldChange($event)"
              (removeLine)="removeLine($event)"
              (productClick)="onOrderTableProductClick($event)"
              (metaAction)="onOrderTableMetaAction($event)">
              <ng-template #metaRow let-line let-index="index">
                <div
                  *ngIf="hasOrderLineMeta(orderLines[index])"
                  class="mt-0.5 sm:mt-1 text-[9px] sm:text-xs leading-snug flex flex-wrap items-center gap-x-1.5 sm:gap-x-2 gap-y-0.5"
                  [class.text-green-700]="orderLines[index].stockItemId && lineControlsStock(orderLines[index]) && isOrderLineStockComplete(orderLines[index])"
                  [class.text-orange-700]="orderLines[index].stockItemId && lineControlsStock(orderLines[index]) && order.stockPreparado && !isOrderLineStockComplete(orderLines[index])">
                  <span *ngIf="orderLines[index].stockItemId && lineControlsStock(orderLines[index])" class="tabular-nums">
                    <ng-container *ngIf="order.stockPreparado">
                      <ng-container *ngIf="isOrderLineStockComplete(orderLines[index])">Completo</ng-container>
                      <ng-container *ngIf="!isOrderLineStockComplete(orderLines[index]) && (orderLines[index].cantidadFaltante || 0) > 0">
                        Faltan {{ orderLines[index].cantidadFaltante }}
                      </ng-container>
                    </ng-container>
                    <ng-container *ngIf="!order.stockPreparado">
                      Disp. {{ orderLines[index].stockDisponible ?? 0 }}
                    </ng-container>
                  </span>
                  <span *ngIf="orderLines[index].stockItemId && !lineControlsStock(orderLines[index])" class="text-gray-400">Sin stock</span>
                  <button
                    *ngIf="canReviewStock && orderLines[index].stockItemId && lineControlsStock(orderLines[index])"
                    type="button"
                    (click)="openStockPreparation()"
                    class="text-teal-700 font-semibold hover:underline">
                    Ajustar
                  </button>
                  <ng-container *appHasPermission="permissions.ORDERS_PERSONALIZATION">
                    <button
                      *ngIf="useDetailedExtraCosts"
                      type="button"
                      [disabled]="isReadOnlyOrder"
                      (click)="openExtraCostsModal(index)"
                      class="text-[10px] sm:text-xs text-teal-600 font-medium hover:text-teal-800 disabled:opacity-40">
                      {{ getExtraCostsActionLabel(orderLines[index]) }}
                    </button>
                  </ng-container>
                  <ng-container *ngIf="auth.canViewPriceCatalog">
                    <button
                      *ngFor="let option of getCatalogPriceOptions(orderLines[index])"
                      type="button"
                      [disabled]="isReadOnlyOrder || !auth.canViewOrderSalePrice"
                      (click)="applyCatalogPrice(orderLines[index], option.price)"
                      class="font-semibold text-teal-700 hover:text-teal-900 hover:underline disabled:opacity-40">
                      {{ option.label }} {{ '$' + option.price }}
                    </button>
                  </ng-container>
                </div>
              </ng-template>
            </app-transaction-lines-table>
          </app-transaction-lines-section>

        <app-form-footer
          *ngIf="!isReadOnlyOrder"
          mode="inline"
          [saveLabel]="primaryButtonLabel"
          [saving]="orderSaveState === 'saving' && orderSaveAction === 'submit'"
          [saveDisabled]="orderSaveState === 'saving'"
          [successMessage]="orderSaveSuccessMessage"
          [secondaryActionLabel]="showSaveDraftButton ? draftButtonLabel : ''"
          [secondarySaving]="orderSaveState === 'saving' && orderSaveAction === 'draft'"
          [secondaryActionDisabled]="orderSaveState === 'saving'"
          cancelLabel="Cancelar"
          (cancelClick)="goBack()"
          (saveClick)="submitOrder()"
          (secondaryActionClick)="saveDraft()">
        </app-form-footer>

        <app-form-footer
          *ngIf="isReadOnlyOrder && canDuplicateOrder"
          mode="inline"
          [showSave]="false"
          cancelLabel="Volver"
          secondaryActionLabel="Duplicar pedido"
          (cancelClick)="goBack()"
          (secondaryActionClick)="duplicateOrder()">
        </app-form-footer>
      </div>
      </ng-container>

      <ng-container aside *ngIf="orderPageReady">
        <div class="space-y-4">
          <app-transaction-summary-panel
            *ngIf="auth.canViewEconomics"
            title="Resumen Económico"
            variant="light"
            class="sm:sticky sm:top-8">

            <div
              *ngIf="auth.canViewAccountBalance || auth.canViewOrderSalePrice"
              class="grid grid-cols-2 gap-x-3 gap-y-1 mb-2 sm:hidden text-xs">
              <div *ngIf="auth.canViewAccountBalance">
                <p class="text-[10px] uppercase text-gray-500">Saldo</p>
                <p class="font-bold text-orange-600 tabular-nums">{{ '$' + (order.saldo || 0) }}</p>
              </div>
              <div
                *ngIf="auth.canViewOrderSalePrice"
                [class.text-right]="auth.canViewAccountBalance">
                <p class="text-[10px] uppercase text-gray-500">Venta</p>
                <p class="font-bold text-teal-600 tabular-nums">{{ '$' + (order.total || 0) }}</p>
              </div>
              <div>
                <p class="text-[10px] uppercase text-gray-500">Costo</p>
                <p class="font-semibold text-gray-900 tabular-nums">{{ '$' + totalCost }}</p>
              </div>
              <div class="text-right">
                <p class="text-[10px] uppercase text-gray-500">Ganancia</p>
                <p class="font-semibold text-green-600 tabular-nums">{{ '$' + (order.gananciaEstimada || 0) }}</p>
              </div>
              <div class="col-span-2 flex justify-between pt-1 border-t border-gray-100">
                <span class="text-[10px] uppercase text-gray-500">Margen</span>
                <span class="font-semibold text-teal-700 tabular-nums">{{ ((order.margen || 0) * 100).toFixed(1) }}%</span>
              </div>
            </div>

            <div class="hidden sm:block space-y-3 mb-6 text-sm">
              <div class="flex justify-between">
                <span class="text-gray-500">Costo base</span>
                <span class="text-gray-900 tabular-nums">{{ '$' + baseProductCost }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500">Personalización</span>
                <span class="text-gray-900 tabular-nums">{{ '$' + customizationCostTotal }}</span>
              </div>
              <div class="border-t border-gray-200 pt-3 flex justify-between font-bold text-gray-900">
                <span>Costo total</span>
                <span class="tabular-nums">{{ '$' + totalCost }}</span>
              </div>
              <div *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" class="flex justify-between font-bold text-teal-700">
                <span>Precio venta</span>
                <span class="tabular-nums">{{ '$' + (order.total || 0) }}</span>
              </div>
            </div>

            <div *ngIf="auth.canViewAccountBalance" class="mb-2 sm:mb-4 p-2 sm:p-3 rounded-lg sm:rounded-xl border border-gray-100 bg-gray-50">
              <ng-container *ngIf="!isEditing && !seniaBloqueada">
                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Seña recibida</label>
                <input
                  type="number"
                  [(ngModel)]="order.senia"
                  name="senia"
                  [disabled]="isReadOnlyOrder"
                  (ngModelChange)="calculateTotals()"
                  min="0"
                  class="w-full px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border border-gray-200 bg-white text-lg sm:text-xl font-bold text-gray-900 tabular-nums outline-none focus:ring-2 focus:ring-teal-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
                <p class="mt-1 text-xs text-gray-500 hidden sm:block">
                  Al guardar el pedido, se registra en caja con la fecha de hoy y queda bloqueada.
                </p>
              </ng-container>

              <ng-container *ngIf="seniaBloqueada || isEditing">
                <div class="flex items-center justify-between gap-2 mb-1 sm:mb-2">
                  <span class="text-[10px] sm:text-xs font-bold text-gray-500 uppercase">Pagos</span>
                  <button
                    type="button"
                    (click)="openPaymentModal()"
                    *ngIf="auth.canAccessCash"
                    [disabled]="!canRegisterOrderPayment"
                    class="text-[10px] sm:text-xs font-semibold text-teal-700 hover:text-teal-900 disabled:opacity-40 disabled:cursor-not-allowed">
                    + Pago
                  </button>
                </div>
                <div class="space-y-0.5 mb-1 sm:mb-3 max-h-14 sm:max-h-28 overflow-auto">
                  <div
                    *ngFor="let pago of order.pagos"
                    class="flex items-center justify-between gap-2 text-[10px] sm:text-[11px] leading-tight text-gray-700">
                    <span class="truncate min-w-0">
                      {{ getPaymentLineLabel(pago) }}
                      <span class="text-gray-500 hidden sm:inline">· {{ formatPaymentDate(pago.fecha) }}</span>
                      <span *ngIf="shouldShowPaymentNotas(pago)" class="text-gray-500 hidden sm:inline">· {{ pago.notas }}</span>
                    </span>
                    <span class="text-[10px] sm:text-xs font-semibold text-gray-900 tabular-nums shrink-0">{{ '$' + pago.monto }}</span>
                  </div>
                </div>
                <div class="flex justify-between text-[10px] sm:text-xs text-gray-600">
                  <span>Pagado</span>
                  <span class="tabular-nums text-gray-900">{{ '$' + getTotalPagado() }}</span>
                </div>
              </ng-container>

              <div class="flex justify-between text-[10px] sm:text-xs text-gray-600 mt-1 sm:mt-2 pt-1 sm:pt-2 border-t border-gray-200">
                <span>Saldo pendiente</span>
                <span class="font-semibold text-orange-600 tabular-nums">{{ '$' + (order.saldo || 0) }}</span>
              </div>
            </div>

            <div class="hidden sm:block space-y-2 mb-6 text-sm">
              <div class="flex justify-between">
                <span class="text-gray-500">Ganancia est.</span>
                <span class="text-green-600 font-bold tabular-nums">{{ '$' + (order.gananciaEstimada || 0) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500">Margen</span>
                <span class="text-teal-700 tabular-nums">{{ ((order.margen || 0) * 100).toFixed(1) }}%</span>
              </div>
            </div>

            <a
              *ngIf="isEditing && order.ventaId"
              [routerLink]="['/sales']"
              [queryParams]="{ ventaId: order.ventaId }"
              class="mb-2 sm:mb-3 inline-block text-[10px] sm:text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline">
              Ver venta
            </a>
            <div *ngIf="isReadOnlyOrder && canDuplicateOrder" class="space-y-2 sm:space-y-3">
              <p class="text-xs sm:text-sm text-gray-500 hidden sm:block">
                Este pedido no se puede modificar. Podés duplicarlo para crear uno nuevo con los mismos datos.
              </p>
              <button
                type="button"
                (click)="duplicateOrder()"
                class="w-full rounded-lg sm:rounded-xl bg-teal-600 py-2 sm:py-3 text-sm font-bold text-white hover:bg-teal-700 transition-all">
                Duplicar pedido
              </button>
            </div>
          </app-transaction-summary-panel>

          <app-transaction-summary-panel
            *ngIf="!auth.canViewEconomics"
            title="Resumen"
            variant="light"
            class="sm:sticky sm:top-8">
            <div *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" class="mb-2 sm:mb-4 flex items-baseline justify-between gap-3 sm:block">
              <p class="text-[10px] sm:text-xs font-bold text-gray-500 uppercase sm:mb-1">Total venta</p>
              <p class="text-lg sm:text-2xl font-bold text-teal-700 tabular-nums">{{ '$' + (order.total || 0) }}</p>
            </div>
            <div *ngIf="auth.canViewAccountBalance" class="mb-2 sm:mb-4 p-2 sm:p-3 rounded-lg sm:rounded-xl border border-gray-100 bg-gray-50 space-y-1 sm:space-y-2">
              <ng-container *ngIf="!isEditing && !seniaBloqueada">
                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Seña recibida</label>
                <input
                  type="number"
                  [(ngModel)]="order.senia"
                  name="seniaStaffSummary"
                  [disabled]="isReadOnlyOrder"
                  (ngModelChange)="calculateTotals()"
                  min="0"
                  class="w-full px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border border-gray-200 text-base sm:text-lg font-bold tabular-nums outline-none focus:ring-2 focus:ring-teal-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
                <p class="text-xs text-gray-500 hidden sm:block">
                  Al guardar el pedido, la seña queda registrada y bloqueada.
                </p>
              </ng-container>
              <ng-container *ngIf="seniaBloqueada || isEditing">
                <div class="flex items-center justify-between gap-2 mb-1 sm:mb-2">
                  <span class="text-[10px] sm:text-xs font-bold text-gray-500 uppercase">Pagos</span>
                  <button
                    type="button"
                    (click)="openPaymentModal()"
                    *ngIf="auth.canAccessCash"
                    [disabled]="!canRegisterOrderPayment"
                    class="text-[10px] sm:text-xs font-semibold text-teal-700 hover:text-teal-900 disabled:opacity-40 disabled:cursor-not-allowed">
                    + Pago
                  </button>
                </div>
                <div class="flex justify-between text-xs sm:text-sm">
                  <span class="text-gray-600">Pagado</span>
                  <span class="font-semibold tabular-nums text-gray-900">{{ '$' + getTotalPagado() }}</span>
                </div>
                <div class="flex justify-between text-xs sm:text-sm pt-1 sm:pt-2 border-t border-gray-200">
                  <span class="text-gray-600">Saldo</span>
                  <span class="font-semibold tabular-nums text-orange-600">{{ '$' + pendingOrderSaldo }}</span>
                </div>
              </ng-container>
            </div>
            <a
              *ngIf="isEditing && order.ventaId"
              [routerLink]="['/sales']"
              [queryParams]="{ ventaId: order.ventaId }"
              class="mb-2 sm:mb-3 inline-block text-[10px] sm:text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline">
              Ver venta
            </a>
            <div *ngIf="isReadOnlyOrder && canDuplicateOrder" class="space-y-2 sm:space-y-3">
              <p class="text-xs sm:text-sm text-gray-500 hidden sm:block">
                Este pedido no se puede modificar. Podés duplicarlo para crear uno nuevo con los mismos datos.
              </p>
              <button
                type="button"
                (click)="duplicateOrder()"
                class="w-full rounded-lg sm:rounded-xl bg-teal-600 py-2 sm:py-3 text-sm font-bold text-white hover:bg-teal-700 transition-all">
                Duplicar pedido
              </button>
            </div>
          </app-transaction-summary-panel>
        </div>
      </ng-container>

      <ng-template #orderPageLoading>
        <div class="py-16 flex flex-col items-center justify-center text-gray-400">
          <div class="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mb-3"></div>
          <p class="text-sm">Cargando pedido...</p>
        </div>
      </ng-template>
    </app-transaction-form-page>

    <div
        *ngIf="paymentModalOpen"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true">
        <button
          type="button"
          class="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px]"
          aria-label="Cerrar"
          (click)="closePaymentModal()">
        </button>
        <div class="relative w-full max-w-sm rounded-2xl border border-gray-100 bg-white shadow-2xl p-5">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div class="min-w-0">
              <h2 class="text-base font-bold text-gray-900">Registrar pago</h2>
              <p class="text-xs text-gray-500 mt-0.5">Se registra en caja hoy, asociado al cliente.</p>
            </div>
            <div class="shrink-0 text-right leading-tight">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Saldo</p>
              <p class="text-lg font-bold text-orange-600 tabular-nums">{{ '$' + paymentSaldoSnapshot }}</p>
            </div>
          </div>

          <div class="flex items-center gap-2 flex-wrap mb-2">
            <div class="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 shrink-0">
              <button
                type="button"
                (click)="setPaymentModo('total')"
                class="h-8 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap"
                [class.bg-teal-600]="paymentModo === 'total'"
                [class.text-white]="paymentModo === 'total'"
                [class.shadow-sm]="paymentModo === 'total'"
                [class.text-gray-600]="paymentModo !== 'total'"
                [class.hover:bg-white]="paymentModo !== 'total'">
                Saldo total
              </button>
              <button
                type="button"
                (click)="setPaymentModo('parcial')"
                class="h-8 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap"
                [class.bg-amber-500]="paymentModo === 'parcial'"
                [class.text-white]="paymentModo === 'parcial'"
                [class.shadow-sm]="paymentModo === 'parcial'"
                [class.text-gray-600]="paymentModo !== 'parcial'"
                [class.hover:bg-white]="paymentModo !== 'parcial'">
                Parcial
              </button>
            </div>

            <div *ngIf="paymentModo === 'parcial'" class="relative shrink-0">
              <span
                class="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs font-medium text-gray-400">
                $
              </span>
              <input
                type="number"
                [(ngModel)]="paymentMonto"
                [ngModelOptions]="{ standalone: true }"
                min="1"
                placeholder="0"
                aria-label="Monto a cobrar"
                class="h-8 w-[5.25rem] pl-5 pr-1.5 rounded-md border border-gray-200 bg-white text-gray-900 text-sm font-medium tabular-nums outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
            </div>

            <p *ngIf="paymentModo === 'total'" class="text-xs text-gray-500 min-w-0 flex-1">
              Cobrás todo y cerrás el saldo.
            </p>
          </div>

          <p *ngIf="paymentModo === 'parcial'" class="text-[11px] text-gray-400 mb-0">
            Si superás el saldo, el excedente va como pago extra en caja.
          </p>

          <div class="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
            <button
              type="button"
              (click)="closePaymentModal()"
              [disabled]="paymentSubmitting"
              class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Cancelar
            </button>
            <button
              type="button"
              (click)="submitPayment()"
              [disabled]="paymentSubmitting"
              class="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
              {{ paymentSubmitting ? 'Registrando…' : 'Registrar' }}
            </button>
          </div>
        </div>
      </div>

      <app-transaction-modal
        [open]="extraCostsModalIndex !== null && !!extraCostsModalLine"
        title="Costos de personalización"
        [subtitle]="extraCostsModalLine?.nombre ?? ''"
        maxWidthClass="max-w-lg"
        zIndexClass="z-50"
        [compact]="true"
        (closed)="cancelExtraCostsModal()">
        <app-transaction-extra-costs-form
          *ngIf="extraCostsModalLine as modalLine"
          [presets]="orderExtraCostPresets"
          [initialCosts]="modalLine.costosExtra ?? []"
          inputNamePrefix="orderExtraCost"
          (accepted)="acceptExtraCostsModal($event)">
        </app-transaction-extra-costs-form>
      </app-transaction-modal>

    <app-transaction-modal
      [open]="clientModalOpen"
      title="Nuevo cliente"
      subtitle="Al guardar queda seleccionado en este pedido."
      maxWidthClass="max-w-lg"
      (closed)="closeClientModal()">
      <app-client-form-panel
        [prefillNombre]="clientModalPrefillNombre"
        [showHistorialLink]="false"
        (saved)="onClientSavedFromModal($event)"
        (cancelled)="closeClientModal()">
      </app-client-form-panel>
    </app-transaction-modal>

    <div
      *ngIf="stockDiscountDialogOpen && stockDiscountPreview"
      class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stock-discount-title">
      <div class="w-full max-w-lg rounded-xl bg-white shadow-xl border border-gray-200 max-h-[90vh] flex flex-col">
        <header class="px-4 py-3 border-b border-gray-200">
          <h2 id="stock-discount-title" class="text-base font-bold text-gray-900">Descuento de depósito</h2>
          <p class="text-sm text-gray-600 mt-1">
            Al guardar con estado «{{ stockDiscountPreview.nextEstadoLabel }}» se descontará stock físico del depósito.
          </p>
        </header>

        <div class="px-4 py-3 overflow-y-auto flex-1 space-y-3">
          <div *ngIf="stockDiscountPreview.canChooseScope" class="space-y-2">
            <label class="flex items-start gap-2 cursor-pointer rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50">
              <input
                type="radio"
                name="stockDiscountScope"
                value="solo_reservado"
                [(ngModel)]="stockDiscountSelectedScope"
                class="mt-1 h-4 w-4 border-gray-300 text-primary focus:ring-primary">
              <span class="text-sm">
                <span class="font-semibold text-gray-900">Solo lo reservado</span>
                <span class="block text-gray-600">{{ stockDiscountPreview.totalReservado }} u. en total</span>
              </span>
            </label>
            <label class="flex items-start gap-2 cursor-pointer rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50">
              <input
                type="radio"
                name="stockDiscountScope"
                value="pedido_completo"
                [(ngModel)]="stockDiscountSelectedScope"
                class="mt-1 h-4 w-4 border-gray-300 text-primary focus:ring-primary">
              <span class="text-sm">
                <span class="font-semibold text-gray-900">Todo el pedido pendiente</span>
                <span class="block text-gray-600">{{ stockDiscountPreview.totalCompleto }} u. en total</span>
              </span>
            </label>
          </div>

          <p *ngIf="!stockDiscountPreview.canChooseScope" class="text-sm text-gray-700">
            Se descontará: <span class="font-semibold">{{ getOrderPhysicalStockScopeLabel(stockDiscountSelectedScope) }}</span>
            ({{ stockDiscountUnitsForSelectedScope }} u. en total).
          </p>

          <div *ngIf="stockDiscountPreview.lines.length" class="rounded-lg border border-gray-200 overflow-hidden">
            <table class="w-full text-xs">
              <thead class="bg-gray-50 text-gray-600">
                <tr>
                  <th class="text-left px-2 py-1.5 font-semibold">Producto</th>
                  <th class="text-right px-2 py-1.5 font-semibold">Res.</th>
                  <th class="text-right px-2 py-1.5 font-semibold">Pend.</th>
                  <th class="text-right px-2 py-1.5 font-semibold">Baja</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let line of stockDiscountPreview.lines" class="border-t border-gray-200">
                  <td class="px-2 py-1.5 text-gray-900">{{ line.nombre }}</td>
                  <td class="px-2 py-1.5 text-right text-gray-700">{{ line.cantidadReservada }}</td>
                  <td class="px-2 py-1.5 text-right text-gray-700">{{ line.pendiente }}</td>
                  <td class="px-2 py-1.5 text-right font-semibold text-teal-800">
                    {{ stockDiscountLineAmount(line) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p
            *ngIf="stockDiscountPreview.requiresFullStock && stockDiscountSelectedScope === 'pedido_completo'"
            class="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Este estado exige tener todo el stock disponible antes de descontar el pedido completo.
          </p>
        </div>

        <footer class="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            (click)="cancelStockDiscountDialog()"
            class="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="button"
            (click)="confirmStockDiscountDialog()"
            [disabled]="stockDiscountUnitsForSelectedScope <= 0"
            class="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
            Confirmar y guardar
          </button>
        </footer>
      </div>
    </div>

    <div
      *ngIf="consumePendingDialogOpen"
      class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consume-pending-title">
      <div class="w-full max-w-lg rounded-xl bg-white shadow-xl border border-gray-200 max-h-[90vh] flex flex-col">
        <header class="px-4 py-3 border-b border-gray-200">
          <h2 id="consume-pending-title" class="text-base font-bold text-gray-900">Descontar stock del depósito</h2>
          <p class="text-sm text-gray-600 mt-1">
            Elegí cuánto descontar ahora (solo de lo reservado). Podés hacerlo parcial si te llegó stock parcial.
          </p>
        </header>

        <div class="px-4 py-3 overflow-y-auto flex-1 space-y-3">
          <div class="rounded-lg border border-gray-200 overflow-hidden">
            <table class="w-full text-xs">
              <thead class="bg-gray-50 text-gray-600">
                <tr>
                  <th class="text-left px-2 py-1.5 font-semibold">Producto</th>
                  <th class="text-right px-2 py-1.5 font-semibold">Máx.</th>
                  <th class="text-right px-2 py-1.5 font-semibold">Descontar</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of consumePendingDraft" class="border-t border-gray-200">
                  <td class="px-2 py-1.5 text-gray-900">{{ row.nombre }}</td>
                  <td class="px-2 py-1.5 text-right text-gray-700">{{ row.max }}</td>
                  <td class="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      min="0"
                      [max]="row.max"
                      [(ngModel)]="row.input"
                      (ngModelChange)="clampConsumePending(row)"
                      class="w-24 px-2 py-1 rounded-md border border-gray-200 text-right" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="text-sm text-gray-700">
            Total a descontar ahora: <span class="font-semibold">{{ consumePendingSelectedTotal }} u.</span>
          </p>
          <p class="text-xs text-gray-500">
            Quedará registrado en el pedido con fecha y detalle.
          </p>
        </div>

        <footer class="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            (click)="closeConsumePendingDialog()"
            class="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="button"
            (click)="consumePendingReservedStockNow()"
            [disabled]="consumePendingSelectedTotal <= 0 || consumingPendingStock"
            class="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
            {{ consumingPendingStock ? 'Descontando…' : 'Descontar ahora' }}
          </button>
        </footer>
      </div>
    </div>

    <app-order-stock-preparation-panel
      [open]="stockPrepOpen"
      [orderId]="editingOrderId ?? ''"
      (closed)="onStockPrepClosed()"
      (confirmed)="onStockPrepConfirmed($event)">
    </app-order-stock-preparation-panel>
  `,
})
export class NewOrderComponent implements OnInit, OnDestroy {
  private static readonly MAX_ORDER_LINES = 400;
  private static readonly MAX_EXTRA_COSTS_PER_LINE = 24;

  private clientService = inject(ClientService);
  private stockService = inject(StockService);
  private orderService = inject(OrderService);
  private orderPrintService = inject(OrderPrintService);
  private catalogConfigService = inject(CatalogConfigService);
  private priceCatalogService = inject(PriceCatalogService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private navigationBack = inject(NavigationBackService);
  readonly auth = inject(AuthService);
  readonly permissions = PERMISSIONS;

  @ViewChild('orderLinesTable') orderLinesTable?: TransactionLinesTableComponent;

  readonly getOrderStatusBadgeClass = getOrderStatusBadgeClass;
  get orderStatusOptions() {
    const key = JSON.stringify(this.appConfig.pedidos?.estados ?? []);
    if (key === this.orderStatusOptionsKey) {
      return this.orderStatusOptionsCache;
    }
    this.orderStatusOptionsKey = key;
    this.orderStatusOptionsCache = getOrderWorkflowStatusOptions(this.appConfig.pedidos);
    return this.orderStatusOptionsCache;
  }
  readonly controlsStockForCatalogItem = (item: StockItem) =>
    itemControlsStock(item);

  clients: Client[] = [];
  clientOptionsCache: Array<{ value: string; label: string }> = [];
  private clientOptionsKey = '';
  orderStatusOptionsCache: Array<{ value: string; label: string }> = [];
  private orderStatusOptionsKey = '';
  selectedClientLabel = '';
  pendingClientName = '';
  creatingClient = false;
  clientModalOpen = false;
  clientModalPrefillNombre = '';
  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  editingOrderId: string | null = null;
  orderPageReady = true;
  orderDetailLoading = false;
  private loadedOrderSnapshot: Order | null = null;
  isDraftOrder = false;
  orderLines: OrderLineItem[] = [];
  private addedOrderProductIdsCache: string[] = [];
  private addedOrderProductIdsKey = '';
  private orderTableLinesCache: TransactionTableLine[] = [];
  private orderTableLinesKey = '';
  private orderTableColumnsCache: ReturnType<typeof buildTransactionTableColumns> | null = null;
  private orderTableColumnsKey = '';
  private catalogPriceOptionsCache = new Map<string, Array<{ label: string; price: number }>>();
  private loadOrderRequestId = 0;
  priceCatalogEntries: PriceCatalogEntry[] = [];
  extraCostsModalIndex: number | null = null;
  paymentModalOpen = false;
  paymentModo: 'total' | 'parcial' = 'total';
  paymentMonto: number | null = null;
  paymentSaldoSnapshot = 0;
  paymentSubmitting = false;
  orderSaveState: 'idle' | 'saving' | 'success' = 'idle';
  orderSaveAction: 'draft' | 'submit' | null = null;
  orderSaveBannerText = '';
  private orderSaveFeedbackTimeout?: ReturnType<typeof setTimeout>;
  private savedOrderEstado = '';
  private orderFormLocked = false;
  stockPrepOpen = false;
  stockDiscountDialogOpen = false;
  stockDiscountPreview: OrderStockDiscountPreview | null = null;
  stockDiscountSelectedScope: OrderPhysicalStockScope = 'solo_reservado';
  private pendingEstadoForStockDiscount: string | null = null;
  private pendingSaveEstado: string | null = null;
  readonly getOrderPhysicalStockScopeLabel = getOrderPhysicalStockScopeLabel;
  private pendingEstadoChange: string | null = null;
  private stockPrepFromEstadoChange = false;
  private awaitingStockPrepAfterSave = false;
  private stockEnrichTimer?: ReturnType<typeof setTimeout>;
  private stockEnrichRequestId = 0;
  consumingPendingStock = false;
  consumePendingDialogOpen = false;
  consumePendingDraft: Array<{ lineIndex: number; nombre: string; max: number; input: string }> = [];

  get canReviewStock(): boolean {
    return (
      this.isEditing &&
      !this.isReadOnlyOrder &&
      !this.isCancelledOrder &&
      orderConfigUsesReservedStock(this.appConfig)
    );
  }

  getOrderStatusLabelFor(estado?: string): string {
    return getOrderStatusLabel(estado, this.appConfig.pedidos);
  }

  private isStockDiscountTrigger(estado: string): boolean {
    return orderEstadoMatchesStockTrigger(estado, this.appConfig.pedidos);
  }

  get orderPhysicalDiscountHint(): string | null {
    if (!this.isEditing || this.isReadOnlyOrder || !this.canReviewStock) return null;
    const next = normalizeOrderStatus(this.orderEstadoDisplay);
    const scope = resolveOrderPhysicalStockScope(this.appConfig.pedidos, next);
    const trigger = this.appConfig.pedidos.estadoDescuentaStock;
    const stockFullyConsumed = orderStockFullyConsumed(this.orderLines);
    const crosses = shouldConsumeStockOnStatusChange({
      previousEstado: this.savedOrderEstado || this.order.estado,
      nextEstado: next,
      triggerEstado: trigger,
      stockDescontado: this.order.stockDescontado,
      stockFullyConsumed,
      estados: this.appConfig.pedidos.estados,
    });
    if (!crosses || stockFullyConsumed) return null;
    return `Al guardar, si queda en «${this.getOrderStatusLabelFor(next)}», por defecto se descontará: ${getOrderPhysicalStockScopeLabel(scope)}.`;
  }

  get pendingReservedToConsumeUnits(): number {
    return this.orderLines.reduce((sum, line) => {
      if (!line.stockItemId || !this.lineControlsStock(line)) return sum;
      const cantidad = Number(line.cantidad) || 0;
      const usada = Math.max(0, Number(line.cantidadUsada) || 0);
      const reservada = Math.max(0, Number(line.cantidadReservada) || 0);
      const pendiente = Math.max(0, cantidad - usada);
      return sum + Math.min(reservada, pendiente);
    }, 0);
  }

  get canConsumePendingReservedStockNow(): boolean {
    if (!this.isEditing || this.isReadOnlyOrder || !this.editingOrderId) return false;
    if (normalizeOrderStatus(this.order.estado) !== 'en_produccion') return false;
    if (this.consumingPendingStock) return false;
    return this.pendingReservedToConsumeUnits > 0;
  }

  get lastStockOperationLabel(): string | null {
    const ops = (this.order.stockOperaciones ?? []) as Array<{
      fecha: string;
      tipo: string;
      total: number;
      detalle: string;
    }>;
    const last = ops.length ? ops[ops.length - 1] : null;
    if (!last || !last.total) return null;
    const date = new Date(last.fecha);
    const when = Number.isNaN(date.getTime()) ? last.fecha : date.toLocaleString();
    return `Último descuento manual: ${last.total} u. · ${when}`;
  }

  openConsumePendingDialog() {
    if (!this.canConsumePendingReservedStockNow) return;
    this.consumePendingDraft = this.orderLines
      .map((line, idx) => {
        if (!line.stockItemId || !this.lineControlsStock(line)) return null;
        const cantidad = Number(line.cantidad) || 0;
        const usada = Math.max(0, Number(line.cantidadUsada) || 0);
        const reservada = Math.max(0, Number(line.cantidadReservada) || 0);
        const pendiente = Math.max(0, cantidad - usada);
        const max = Math.min(reservada, pendiente);
        if (max <= 0) return null;
        return { lineIndex: idx, nombre: line.nombre, max, input: String(max) };
      })
      .filter(Boolean) as Array<{ lineIndex: number; nombre: string; max: number; input: string }>;
    this.consumePendingDialogOpen = true;
  }

  closeConsumePendingDialog() {
    this.consumePendingDialogOpen = false;
  }

  get consumePendingSelectedTotal(): number {
    return this.consumePendingDraft.reduce((sum, row) => sum + Math.max(0, Number(row.input) || 0), 0);
  }

  clampConsumePending(row: { max: number; input: string }) {
    const parsed = Math.floor(Number(String(row.input).replace(',', '.')) || 0);
    row.input = String(Math.min(row.max, Math.max(0, parsed)));
  }

  get stockDiscountUnitsForSelectedScope(): number {
    if (!this.stockDiscountPreview) return 0;
    return this.stockDiscountSelectedScope === 'solo_reservado'
      ? this.stockDiscountPreview.totalReservado
      : this.stockDiscountPreview.totalCompleto;
  }

  stockDiscountLineAmount(line: OrderStockDiscountPreview['lines'][number]): number {
    if (!this.stockDiscountPreview) return 0;
    return this.stockDiscountSelectedScope === 'solo_reservado'
      ? line.aDescontarReservado
      : line.aDescontarCompleto;
  }

  readonly getStockDisponible = getStockDisponible;

  lineControlsStock(line: OrderLineItem): boolean {
    return line.controlaStock !== false;
  }

  getLinePurchaseShortage(line: OrderLineItem): number | null {
    if (!line.stockItemId || !this.lineControlsStock(line)) return null;

    if (this.order.stockPreparado) {
      return Math.max(0, Number(line.cantidadFaltante) || 0);
    }

    if (line.stockDisponible === undefined) return null;
    const qty = Number(line.cantidad) || 0;
    const available = Number(line.stockDisponible) || 0;
    return Math.max(0, qty - available);
  }

  isOrderLineStockComplete(line: OrderLineItem): boolean {
    if (!line.stockItemId || !this.lineControlsStock(line) || !this.order.stockPreparado) {
      return false;
    }
    const qty = Number(line.cantidad) || 0;
    if (qty <= 0) return true;
    const faltante = Math.max(0, Number(line.cantidadFaltante) || 0);
    if (faltante > 0) return false;
    const usada = Math.max(0, Number(line.cantidadUsada) || 0);
    const reservada = Math.max(0, Number(line.cantidadReservada) || 0);
    return usada + reservada >= qty;
  }

  /** Reservado visible solo mientras el pedido no está entregado y falta descontar del depósito. */
  showOrderLineReserved(line: OrderLineItem): boolean {
    if (this.isLockedOrder || isOrderDeliveryEstado(this.order.estado)) return false;
    const reserved = Math.max(0, Number(line.cantidadReservada) || 0);
    if (reserved <= 0) return false;
    const usada = Math.max(0, Number(line.cantidadUsada) || 0);
    const cantidad = Math.max(0, Number(line.cantidad) || 0);
    return usada < cantidad;
  }

  order: Partial<Order> = this.emptyOrder();

  baseProductCost = 0;
  customizationCostTotal = 0;
  totalCost = 0;

  get isEditing(): boolean {
    return !!this.editingOrderId;
  }

  get orderPageTitle(): string {
    if (this.isCancelledOrder) return 'Pedido cancelado';
    if (this.isLockedOrder) return 'Pedido entregado total';
    if (this.isEditing) return 'Editar pedido';
    return 'Nuevo pedido personalizado';
  }

  get orderPageTitleBadge(): string {
    if (!this.isEditing) return '';
    const fromSnapshot = this.loadedOrderSnapshot ? formatOrderNumber(this.loadedOrderSnapshot) : '';
    if (fromSnapshot) return fromSnapshot;
    if (this.editingOrderId) return this.editingOrderId.slice(-6).toUpperCase();
    return '';
  }

  get orderPageSubtitle(): string {
    if (this.isCancelledOrder) {
      return 'Solo lectura. Este pedido no se puede modificar; creá uno nuevo si necesitás continuar.';
    }
    if (this.isLockedOrder) {
      return 'Podés editar la descripción del trabajo; el resto del pedido queda bloqueado.';
    }
    return '';
  }

  get orderSaveSuccessMessage(): string {
    return this.orderSaveState === 'success' ? this.orderSaveBannerText : '';
  }

  goBack() {
    this.navigationBack.back(['/orders']);
  }

  get isDraft(): boolean {
    return this.isDraftOrder;
  }

  get showSaveDraftButton(): boolean {
    return !this.isEditing || this.isDraftOrder;
  }

  get primaryOrderActionLabel(): string {
    return this.isEditing && !this.isDraftOrder ? 'Guardar' : 'Confirmar pedido';
  }

  get orderActionsLocked(): boolean {
    return this.orderSaveState === 'saving';
  }

  get draftButtonLabel(): string {
    if (this.orderSaveState === 'saving' && this.orderSaveAction === 'draft') return 'Guardando...';
    if (this.orderSaveState === 'success' && this.orderSaveAction === 'draft') return 'Borrador guardado';
    return 'Guardar borrador';
  }

  get primaryButtonLabel(): string {
    if (this.orderSaveState === 'saving' && this.orderSaveAction === 'submit') return 'Guardando...';
    if (this.orderSaveState === 'success' && this.orderSaveAction === 'submit') {
      if (this.isLockedOrder) return 'Descripción guardada';
      return this.isEditing && !this.isDraftOrder ? 'Guardado' : 'Pedido confirmado';
    }
    if (this.canSaveLockedDescription) return 'Guardar descripción';
    return this.primaryOrderActionLabel;
  }

  get canEditOrderDescription(): boolean {
    return this.isEditing && !this.isCancelledOrder && this.auth.canEditRecords;
  }

  get hasPendingDescriptionChange(): boolean {
    if (!this.loadedOrderSnapshot) return false;
    const current = (this.order.descripcion ?? '').trim();
    const saved = (this.loadedOrderSnapshot.descripcion ?? '').trim();
    return current !== saved;
  }

  get canSaveLockedDescription(): boolean {
    return this.isLockedOrder && this.canEditOrderDescription && this.hasPendingDescriptionChange;
  }

  get isCancelledOrder(): boolean {
    return normalizeOrderStatus(this.savedOrderEstado || this.order.estado) === 'cancelado';
  }

  get isLockedOrder(): boolean {
    return this.orderFormLocked;
  }

  get isDeliveryPendingSave(): boolean {
    if (this.orderFormLocked) return false;
    const current = normalizeOrderStatus(this.order.estado);
    const saved = normalizeOrderStatus(this.savedOrderEstado);
    return isOrderDeliveryEstado(current) && current !== saved;
  }

  get deliveryPendingSaveHint(): string {
    return normalizeOrderStatus(this.order.estado) === 'entregado'
      ? 'registrar la venta y el cobro del saldo'
      : 'registrar la venta';
  }

  get isReadOnlyOrder(): boolean {
    if (this.isCancelledOrder || this.isLockedOrder) return true;
    if (this.isEditing && !this.auth.canEditRecords) return true;
    return false;
  }

  get canDuplicateOrder(): boolean {
    return this.isEditing && !!this.editingOrderId && this.auth.canEditRecords;
  }

  /** Hay al menos una acción para mostrar arriba a la derecha (guardar/duplicar/imprimir/etc.). */
  get hasOrderHeaderActions(): boolean {
    return (
      !this.isReadOnlyOrder ||
      this.canSaveLockedDescription ||
      this.canDuplicateOrder ||
      (this.isEditing && this.auth.canPrintOrders) ||
      (this.canRegisterSale && this.auth.canCreateSales)
    );
  }

  get pendingOrderSaldo(): number {
    return this.resolveCurrentOrderBalance().saldo;
  }

  get canRegisterOrderPayment(): boolean {
    if (
      !this.editingOrderId ||
      !this.auth.canAccessCash ||
      this.isCancelledOrder ||
      this.isLockedOrder
    ) {
      return false;
    }
    return this.pendingOrderSaldo > 0;
  }

  get orderEstadoDisplay(): string {
    const normalized = normalizeOrderStatus(this.order.estado);
    return normalized === 'otro' ? 'pendiente' : normalized;
  }

  get clientOptions() {
    const key = this.clients.map((client) => `${client.id ?? ''}\u0001${client.nombre ?? ''}`).join('\u0002');
    if (key === this.clientOptionsKey) {
      return this.clientOptionsCache;
    }
    this.clientOptionsKey = key;
    this.clientOptionsCache = this.clients
      .filter((client) => client.id)
      .map((client) => ({
        value: client.id!,
        label: client.nombre,
      }));
    return this.clientOptionsCache;
  }

  get orderExtraCostPresets(): OrderExtraCostPreset[] {
    return this.appConfig.pedidos?.costosExtraPredeterminados ?? [];
  }

  readonly getOrderStockStatusLabel = getOrderStockStatusLabel;
  readonly getOrderStockStatusBadgeClass = getOrderStockStatusBadgeClass;

  onOrderEstadoChange(newEstado: string) {
    if (!this.editingOrderId) return;
    if (this.orderFormLocked) {
      this.order.estado = this.savedOrderEstado || this.order.estado;
      return;
    }
    if (normalizeOrderStatus(this.savedOrderEstado) === 'cancelado') return;

    const previous = normalizeOrderStatus(this.order.estado);
    const next = normalizeOrderStatus(newEstado);
    if (next === previous) return;

    const transition = validateOrderEstadoTransition({
      previousEstado: previous,
      nextEstado: next,
      triggerEstado: this.appConfig.pedidos.estadoDescuentaStock,
      stockDescontado: this.order.stockDescontado,
      estados: this.appConfig.pedidos.estados,
    });

    if (!transition.allowed) {
      this.order.estado = previous;
      this.dialogService.alert({
        title: 'Estado del pedido',
        message: transition.error ?? 'No podés retroceder el estado del pedido.',
      });
      return;
    }

    this.order.estado = newEstado;
  }

  confirmStockDiscountDialog() {
    const newEstado = this.pendingEstadoForStockDiscount ?? this.pendingSaveEstado;
    if (!newEstado || !this.editingOrderId) return;
    const scope = this.stockDiscountSelectedScope;
    this.closeStockDiscountDialog();
    this.executePersistOrder(newEstado, scope);
  }

  cancelStockDiscountDialog() {
    this.closeStockDiscountDialog();
    this.pendingSaveEstado = null;
    this.resetOrderSaveState();
  }

  private closeStockDiscountDialog() {
    this.stockDiscountDialogOpen = false;
    this.stockDiscountPreview = null;
    this.pendingEstadoForStockDiscount = null;
  }

  openStockPreparation() {
    if (!this.editingOrderId || !this.canReviewStock) return;
    this.stockPrepFromEstadoChange = false;
    this.pendingEstadoChange = null;
    this.stockPrepOpen = true;
  }

  onStockPrepClosed() {
    this.stockPrepOpen = false;
    if (this.awaitingStockPrepAfterSave) {
      this.dialogService.alert({
        title: 'Falta reservar stock',
        message:
          'El pedido quedó guardado, pero todavía no se reservó stock. Usá «Revisar stock» para confirmar reserva y faltantes antes de imprimir o cargar otro pedido.',
      });
      return;
    }
    if (this.stockPrepFromEstadoChange) {
      this.pendingEstadoChange = null;
      this.order.estado = this.savedOrderEstado || this.order.estado;
    }
    this.stockPrepFromEstadoChange = false;
  }

  onStockPrepConfirmed(result: { estadoStock: string; stockPreparado: boolean }) {
    if (!this.editingOrderId) return;

    const shouldChangeEstado = this.stockPrepFromEstadoChange && this.pendingEstadoChange;

    this.orderService.getOrder(this.editingOrderId).subscribe({
      next: (order) => {
        this.order.estadoStock = order.estadoStock ?? result.estadoStock;
        this.order.stockPreparado = order.stockPreparado ?? result.stockPreparado;
        if (order.items?.length) {
          this.orderLines = order.items.map((line) => this.normalizeOrderLine(line));
          this.enrichOrderLinesWithStock();
        }
        if (this.loadedOrderSnapshot) {
          this.loadedOrderSnapshot = { ...this.loadedOrderSnapshot, ...order };
        }

        if (shouldChangeEstado) {
          const nextEstado = this.pendingEstadoChange ?? this.appConfig.pedidos.estadoDescuentaStock;
          this.pendingEstadoChange = null;
          this.stockPrepFromEstadoChange = false;
          this.order.estado = nextEstado;
        } else {
          this.stockPrepFromEstadoChange = false;
          if (this.awaitingStockPrepAfterSave) {
            this.awaitingStockPrepAfterSave = false;
            this.finishOrderSaveSuccess();
          }
        }
      },
      error: () => {
        this.order.estadoStock = result.estadoStock;
        this.order.stockPreparado = result.stockPreparado;
        if (shouldChangeEstado) {
          const nextEstado = this.pendingEstadoChange ?? this.appConfig.pedidos.estadoDescuentaStock;
          this.pendingEstadoChange = null;
          this.stockPrepFromEstadoChange = false;
          this.order.estado = nextEstado;
        } else {
          this.stockPrepFromEstadoChange = false;
          if (this.awaitingStockPrepAfterSave) {
            this.awaitingStockPrepAfterSave = false;
            this.finishOrderSaveSuccess();
          }
        }
      },
    });
  }

  private applyOrderUpdateResult(result: OrderUpdateResult) {
    if (result.estado) {
      this.order.estado = result.estado;
      this.savedOrderEstado = result.estado;
    }
    if (result.pagos) this.order.pagos = result.pagos;
    if (result.totalPagado !== undefined) this.order.totalPagado = result.totalPagado;
    if (result.saldo !== undefined) this.order.saldo = result.saldo;
    if (result.ventaId) this.order.ventaId = result.ventaId;
    if (result.estadoStock) this.order.estadoStock = result.estadoStock;
    if (result.stockPreparado !== undefined) this.order.stockPreparado = result.stockPreparado;
    if (result.stockDescontado !== undefined) this.order.stockDescontado = result.stockDescontado;
    if (result.locked) this.orderFormLocked = true;
    if (result.items) {
      this.orderLines = result.items.map((line) => this.normalizeOrderLine(line));
      this.order.items = result.items;
      this.enrichOrderLinesWithStock();
    }
    this.calculateTotals();

    if (result.stockWarning?.trim()) {
      this.dialogService.alert({
        title: 'Stock del pedido',
        message: result.stockWarning,
      });
    }
  }

  consumePendingReservedStockNow() {
    if (!this.editingOrderId || !this.canConsumePendingReservedStockNow) return;
    if (!this.consumePendingDraft.length) {
      this.openConsumePendingDialog();
      return;
    }

    const lines = this.consumePendingDraft
      .map((row) => ({ lineIndex: row.lineIndex, cantidad: Math.max(0, Number(row.input) || 0) }))
      .filter((row) => row.cantidad > 0);

    if (lines.length === 0) {
      this.dialogService.alert({ title: 'Nada para descontar', message: 'Elegí una cantidad mayor a 0.' });
      return;
    }

    this.consumingPendingStock = true;
    this.orderService.consumePendingReservedStock(this.editingOrderId, lines).subscribe({
      next: (result) => {
        this.consumingPendingStock = false;
        this.consumePendingDialogOpen = false;
        this.applyOrderUpdateResult(result);
      },
      error: (err: HttpErrorResponse) => {
        this.consumingPendingStock = false;
        this.dialogService.alert({
          title: 'No se pudo descontar',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : 'No se pudo descontar el stock reservado del pedido.',
        });
      },
    });
  }

  get seniaBloqueada(): boolean {
    return !!(
      this.order.seniaBloqueada ||
      this.order.movimientoSeniaId ||
      (this.order.pagos?.length ?? 0) > 0
    );
  }

  get canRegisterSale(): boolean {
    if (!this.editingOrderId || this.isReadOnlyOrder) return false;
    return canRegisterSaleFromOrder({
      estado: this.order.estado,
      ventaId: this.order.ventaId,
      seniaBloqueada: this.order.seniaBloqueada,
      movimientoSeniaId: this.order.movimientoSeniaId,
      pagos: this.order.pagos,
      stockDescontado: this.order.stockDescontado,
    });
  }

  get fechaEntregaInput(): string {
    return toDateInputValue(this.order.fechaEntrega);
  }

  get orderFechaInput(): string {
    return toDateInputValue(this.order.createdAt);
  }

  get useDetailedExtraCosts(): boolean {
    return usesDetailedOrderExtraCosts(this.appConfig);
  }

  get extraCostsModalLine(): OrderLineItem | null {
    if (this.extraCostsModalIndex === null) return null;
    return this.orderLines[this.extraCostsModalIndex] ?? null;
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.extraCostsModalIndex !== null) {
      this.cancelExtraCostsModal();
    }
  }

  openOrderLineProduct(line: OrderLineItem, event?: Event) {
    event?.stopPropagation();
    const stockItemId = String(line.stockItemId ?? '').trim();
    if (!stockItemId) return;
    this.saveOrderFormDraftForReturn();
    this.router.navigate(['/stock', stockItemId, 'edit'], {
      queryParams: {
        returnTo: 'orders',
        ...(this.editingOrderId ? { orderId: this.editingOrderId } : {}),
      },
    });
  }

  get addedOrderProductIds(): string[] {
    const key = this.orderLines.map((line) => line.stockItemId ?? '').join('\u0001');
    if (key === this.addedOrderProductIdsKey) {
      return this.addedOrderProductIdsCache;
    }
    this.addedOrderProductIdsKey = key;
    this.addedOrderProductIdsCache = this.orderLines
      .map((line) => line.stockItemId)
      .filter((id): id is string => !!id);
    return this.addedOrderProductIdsCache;
  }

  orderSearchResultSubtitle = (item: StockItem): string => {
    const parts: string[] = [];
    if (this.auth.canViewStockCosts) {
      parts.push(`Costo base: $${item.costo || 0}`);
    }
    if (this.controlsStockForCatalogItem(item)) {
      parts.push(`Disponible: ${getStockDisponible(item)} u.`);
    }
    return parts.join(' · ');
  };

  onProductSearchFocused() {
    this.enrichOrderLinesWithStock({ debounceMs: 250 });
  }

  hasOrderLineMeta(line: OrderLineItem): boolean {
    if (line.stockItemId) return true;
    if (this.useDetailedExtraCosts && this.auth.canEditPersonalization) return true;
    return this.auth.canViewPriceCatalog && this.getCatalogPriceOptions(line).length > 0;
  }

  ngOnInit() {
    this.catalogConfigService
      .getAppConfig()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((config) => {
        this.appConfig = config;
      });

    if (this.auth.canViewPriceCatalog) {
      this.priceCatalogService
        .getEntries()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (entries) => {
            this.priceCatalogEntries = entries.filter((entry) => entry.activo !== false);
            this.refreshOrderLineCatalogLinks();
          },
        });
    }

    this.refreshClients();

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncRouteState();
    });

    this.syncRouteState();
  }

  private syncRouteState(): void {
    const duplicateId = this.route.snapshot.queryParamMap.get('duplicate');
    const orderId = this.route.snapshot.paramMap.get('id');
    const restoreDraft = this.route.snapshot.queryParamMap.get('restoreDraft') === '1';
    const clienteId = this.route.snapshot.queryParamMap.get('clienteId');

    if (restoreDraft && this.tryRestoreOrderFormDraft(orderId, clienteId)) {
      this.clearRestoreQueryParams();
      return;
    }

    if (orderId) {
      this.startEditingOrder(orderId);
      return;
    }

    this.editingOrderId = null;
    this.loadedOrderSnapshot = null;
    this.orderPageReady = true;
    this.orderDetailLoading = false;

    if (duplicateId) {
      this.loadOrderForDuplicate(duplicateId);
    } else {
      this.resetForm();
    }
  }

  private readOrderPreview(orderId: string): Order | null {
    const nav = this.router.getCurrentNavigation();
    const candidate = (nav?.extras?.state?.['orderPreview'] ??
      history.state?.orderPreview) as Order | undefined;
    if (!candidate?.id || candidate.id !== orderId) return null;
    return candidate;
  }

  private startEditingOrder(orderId: string) {
    this.editingOrderId = orderId;
    this.orderLines = [];
    this.invalidateOrderLinesViewCache();
    this.orderPageReady = true;
    this.orderDetailLoading = true;

    // Pintamos al instante con la mejor fuente disponible para que los campos no
    // queden en blanco mientras llega la respuesta del backend: preferimos la que
    // traiga líneas (preview de navegación o caché del listado) y, si ninguna las
    // tiene, usamos al menos la cabecera conocida. loadOrder revalida en segundo plano.
    const preview = this.readOrderPreview(orderId);
    const cached = this.orderService.getCachedOrder(orderId);
    const previewHasLines = this.orderHasLinePayload(preview);
    const cachedHasLines = this.orderHasLinePayload(cached);
    const instant = previewHasLines ? preview : cachedHasLines ? cached : preview ?? cached;
    const instantHasLines = this.orderHasLinePayload(instant);

    if (instant) {
      if (!this.auth.canViewOrder(instant.estado)) {
        this.dialogService.alert({
          title: 'Sin acceso',
          message: 'No tenés permiso para ver este pedido.',
        });
        this.router.navigate(['/orders']);
        return;
      }
      this.applyLoadedOrder(instant, { includeLines: instantHasLines });
      if (instantHasLines) {
        this.orderDetailLoading = false;
      }
    } else {
      this.order = this.emptyOrder();
      this.isDraftOrder = false;
      this.loadedOrderSnapshot = null;
    }

    this.loadOrder(orderId);
  }

  private orderHasLinePayload(order: Order | null | undefined): boolean {
    if (!order) return false;
    if (order.stockItemId) return true;
    return this.coerceOrderItems(order.items).length > 0;
  }

  private refreshClients() {
    this.clientService.getClientsPage(120, undefined, { soloActivos: true }).subscribe((page) => {
      this.clients = page.items;
      this.ensureSelectedClient(this.order.clienteId, this.selectedClientLabel);
    });
  }

  private ensureSelectedClient(clienteId?: string, clienteNombre?: string) {
    const id = String(clienteId ?? '').trim();
    if (!id) {
      this.selectedClientLabel = '';
      return;
    }

    const cachedName = String(clienteNombre ?? this.selectedClientLabel ?? '').trim();
    if (cachedName) {
      if (this.selectedClientLabel !== cachedName) {
        this.selectedClientLabel = cachedName;
      }
      this.mergeClientOption(id, cachedName);
      return;
    }

    const existing = this.clients.find((client) => client.id === id);
    if (existing?.nombre) {
      this.selectedClientLabel = existing.nombre;
      return;
    }

    this.clientService.getClient(id).subscribe({
      next: (client) => {
        if (String(this.order.clienteId ?? '').trim() !== id) return;
        const nombre = String(client.nombre ?? '').trim();
        if (!nombre) return;
        this.selectedClientLabel = nombre;
        this.mergeClientOption(id, nombre);
      },
    });
  }

  private mergeClientOption(id: string, nombre: string) {
    if (this.clients.some((client) => client.id === id)) return;
    this.clients = [{ id, nombre }, ...this.clients];
  }

  onOrderPartySelected(option: SearchableSelectOption) {
    this.order.clienteId = option.value;
    this.pendingClientName = option.label;
    this.selectedClientLabel = option.label;
    this.mergeClientOption(option.value, option.label);
  }

  quickCreateClient(name: string) {
    const trimmed = name.trim();
    if (!trimmed || this.creatingClient || this.isReadOnlyOrder) return;

    this.creatingClient = true;
    this.clientService.createClient({ nombre: trimmed }).subscribe({
      next: (response) => {
        this.creatingClient = false;
        const client: Client = { id: response.id, nombre: trimmed };
        this.clients = [...this.clients, client];
        this.order.clienteId = response.id;
        this.selectedClientLabel = trimmed;
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
    if (this.isReadOnlyOrder) return;

    this.saveOrderFormDraftForReturn();
    const nombre = this.pendingClientName.trim();
    this.router.navigate(['/clients/new'], {
      queryParams: {
        ...(nombre ? { nombre } : {}),
        returnTo: 'orders',
        ...(this.editingOrderId ? { orderId: this.editingOrderId } : {}),
      },
    });
  }

  private saveOrderFormDraftForReturn() {
    saveOrderFormDraft({
      order: { ...this.order },
      orderLines: structuredClone(this.orderLines),
      pendingClientName: this.pendingClientName,
      editingOrderId: this.editingOrderId,
      isDraftOrder: this.isDraftOrder,
      savedOrderEstado: this.savedOrderEstado,
      orderFormLocked: this.orderFormLocked,
    });
  }

  private tryRestoreOrderFormDraft(
    routeOrderId: string | null,
    clienteId: string | null
  ): boolean {
    const draft = readOrderFormDraft();
    if (!draft) return false;

    const draftOrderId = draft.editingOrderId ?? null;
    if (draftOrderId !== routeOrderId) return false;

    this.editingOrderId = draft.editingOrderId;
    this.order = { ...draft.order };
    this.orderLines = draft.orderLines.map((line) => this.normalizeOrderLine(line));
    this.pendingClientName = draft.pendingClientName;
    this.isDraftOrder = draft.isDraftOrder;
    this.savedOrderEstado = draft.savedOrderEstado;
    this.orderFormLocked = draft.orderFormLocked;
    this.loadedOrderSnapshot = null;
    this.orderPageReady = true;

    if (clienteId) {
      this.order.clienteId = clienteId;
      this.pendingClientName = '';
      this.ensureSelectedClient(clienteId);
    }

    this.calculateTotals();
    this.enrichOrderLinesWithStock({ debounceMs: 0 });
    clearOrderFormDraft();
    this.refreshClients();
    return true;
  }

  private clearRestoreQueryParams() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { restoreDraft: null, clienteId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private resetForm() {
    this.order = this.emptyOrder();
    this.orderLines = [];
    this.pendingClientName = '';
    this.selectedClientLabel = '';
    this.isDraftOrder = false;
    this.savedOrderEstado = 'pendiente';
    this.orderFormLocked = false;
  }

  closeClientModal() {
    this.clientModalOpen = false;
    this.clientModalPrefillNombre = '';
  }

  onClientSavedFromModal(event: ClientFormSaveEvent) {
    this.order.clienteId = event.id;
    this.pendingClientName = event.client.nombre ?? '';
    this.selectedClientLabel = event.client.nombre ?? '';
    this.mergeClientOption(event.id, event.client.nombre ?? '');
    this.refreshClients();
    this.closeClientModal();
  }

  registerSaleFromOrder() {
    if (!this.editingOrderId || !this.canRegisterSale || !this.auth.canCreateSales) return;
    this.router.navigate(['/sales'], { queryParams: { pedidoId: this.editingOrderId } });
  }

  duplicateOrder() {
    if (!this.editingOrderId) return;
    this.router.navigate(['/orders/new'], {
      queryParams: { duplicate: this.editingOrderId },
    });
  }

  confirmCancelCurrentOrder() {
    if (!this.editingOrderId || this.isCancelledOrder || this.isLockedOrder) return;

    const clientName = this.selectedClientLabel.trim() || 'este cliente';
    const orderRef = this.editingOrderId.slice(-6).toUpperCase();

    this.dialogService
      .confirm({
        title: 'Cancelar pedido',
        message:
          `¿Cancelar el pedido #${orderRef} de ${clientName}? ` +
          (this.order.stockDescontado ||
          (this.order.pagos?.length ?? 0) > 0 ||
          this.order.movimientoSeniaId
            ? 'El pedido ya tiene movimientos de stock o caja vinculados: se registrarán documentos con signo contrario. No se borra el historial. '
            : '') +
          (this.order.ventaId
            ? 'Este pedido tiene una venta vinculada: primero tenés que anular la venta.'
            : ''),
        confirmLabel: 'Cancelar pedido',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.orderService.deleteOrder(this.editingOrderId!).subscribe({
          next: () => this.router.navigate(['/orders']),
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

  printCurrentOrder() {
    if (!this.auth.canPrintOrders || !this.loadedOrderSnapshot?.id) return;

    const snapshot: Order = {
      ...this.loadedOrderSnapshot,
      clienteId: this.order.clienteId ?? this.loadedOrderSnapshot.clienteId,
      descripcion: this.order.descripcion ?? this.loadedOrderSnapshot.descripcion,
      estado: this.order.estado ?? this.loadedOrderSnapshot.estado,
      fechaEntrega: this.order.fechaEntrega ?? this.loadedOrderSnapshot.fechaEntrega,
      total: this.order.total ?? this.loadedOrderSnapshot.total,
      saldo: this.order.saldo ?? this.loadedOrderSnapshot.saldo,
      totalPagado: this.order.totalPagado ?? this.loadedOrderSnapshot.totalPagado,
      senia: this.order.senia ?? this.loadedOrderSnapshot.senia,
      pagos: this.order.pagos ?? this.loadedOrderSnapshot.pagos,
      stockPreparado: this.order.stockPreparado ?? this.loadedOrderSnapshot.stockPreparado,
      estadoStock: this.order.estadoStock ?? this.loadedOrderSnapshot.estadoStock,
      items: (this.orderLines.length ? this.orderLines : this.loadedOrderSnapshot.items).map((line) => ({
        ...line,
        cantidadReservada: line.cantidadReservada,
        cantidadFaltante: line.cantidadFaltante,
        cantidadUsada: line.cantidadUsada,
        controlaStock: line.controlaStock,
        stockDisponible: line.stockDisponible,
      })),
    };

    const clientsById = new Map(
      this.clients.filter((client) => client.id).map((client) => [client.id!, client])
    );
    this.orderPrintService.printOrders([snapshot], clientsById);
  }

  onOrderFechaChange(value: string) {
    this.order.createdAt = dateInputToIso(value);
  }

  onFechaEntregaChange(value: string) {
    if (!value) {
      this.order.fechaEntrega = new Date().toISOString();
      return;
    }
    this.order.fechaEntrega = dateInputToIso(value);
  }

  onOrderProductSelected(item: StockItem) {
    if (!this.ensureEditable('agregar productos')) return;
    this.addProduct(item);
  }

  addProduct(item: StockItem) {
    if (!item.id || this.addedOrderProductIds.includes(item.id)) return;

    const costoUnitario = Number(item.costo) || 0;
    const precioSugerido = Number(item.precioSugerido) || costoUnitario * 2;

    const line: OrderLineItem = {
      stockItemId: item.id,
      nombre: item.nombre,
      cantidad: 1,
      costoUnitario,
      costosExtra: [],
      precioVenta: null,
      precioSugerido,
      controlaStock: item.controlaStock !== false,
      permitirStockNegativo: item.permitirStockNegativo !== false,
      stockDisponible: getStockDisponible(item),
    };
    this.attachCatalogToLine(line, item);
    this.orderLines.push(line);
    this.invalidateOrderLinesViewCache();
    this.calculateTotals();
  }

  getCatalogPriceOptions(line: OrderLineItem): Array<{ label: string; price: number }> {
    const cacheKey = `${line.priceCatalogId ?? ''}|${line.cantidad}|${line.stockItemId ?? ''}`;
    const cached = this.catalogPriceOptionsCache.get(cacheKey);
    if (cached) return cached;

    const entry = this.getCatalogEntry(line);
    if (!entry) {
      this.catalogPriceOptionsCache.set(cacheKey, []);
      return [];
    }

    const options: Array<{ label: string; price: number }> = [];
    for (const variant of entry.variantes ?? []) {
      const nombre = variant.nombre.trim();
      if (!nombre) continue;
      const price = resolveVariantUnitPrice(variant, line.cantidad);
      if (price > 0) {
        options.push({
          label: `${nombre} (${line.cantidad} u.)`,
          price,
        });
      }
    }
    this.catalogPriceOptionsCache.set(cacheKey, options);
    return options;
  }

  applyCatalogPrice(line: OrderLineItem, price: number) {
    if (!this.auth.canViewOrderSalePrice || !price) return;
    line.precioVenta = price;
    this.calculateTotals();
  }

  getExtraCostsActionLabel(line: OrderLineItem): string {
    return (line.costosExtra?.length ?? 0) > 0 ? 'Editar costos' : '+ Agregar costo';
  }

  openExtraCostsModal(lineIndex: number) {
    if (!this.ensureEditable('editar costos')) return;
    if (!this.orderLines[lineIndex]) return;
    this.extraCostsModalIndex = lineIndex;
  }

  cancelExtraCostsModal() {
    this.extraCostsModalIndex = null;
  }

  acceptExtraCostsModal(costs: TransactionExtraCost[]) {
    const line = this.extraCostsModalLine;
    if (!line) return;

    line.costosExtra = costs.map((extra) => ({
      nombre: extra.nombre,
      costo: Number(extra.costo) || 0,
    }));
    this.cancelExtraCostsModal();
    this.calculateTotals();
  }

  getLineCustomizationTotal(line: OrderLineItem): number {
    return (line.costosExtra ?? []).reduce((acc, extra) => acc + (Number(extra.costo) || 0), 0);
  }

  getLinePersUnitCost(line: OrderLineItem): number {
    return this.getLineCustomizationTotal(line);
  }

  setLinePersUnitCost(line: OrderLineItem, value: number | string | null) {
    const costo = Math.max(0, Number(value) || 0);
    line.costosExtra = costo > 0 ? [{ nombre: 'Personalización', costo }] : [];
    this.calculateTotals();
  }

  getLinePersTotal(line: OrderLineItem): number {
    return (Number(line.cantidad) || 0) * this.getLineCustomizationTotal(line);
  }

  getLineSaleTotal(line: OrderLineItem): number {
    return (Number(line.cantidad) || 0) * (Number(line.precioVenta) || 0);
  }

  get orderTableColumns() {
    const key = [
      this.isReadOnlyOrder,
      this.auth.hasPermission(this.permissions.STOCK_VIEW_COSTS),
      this.auth.hasPermission(this.permissions.ORDERS_PERSONALIZATION),
      this.auth.hasPermission(this.permissions.ORDERS_VIEW_SALE_PRICE),
    ].join('|');
    if (key === this.orderTableColumnsKey && this.orderTableColumnsCache) {
      return this.orderTableColumnsCache;
    }
    this.orderTableColumnsKey = key;
    this.orderTableColumnsCache = buildTransactionTableColumns(ORDER_FORM_TABLE_COLUMNS, {
      unitCost: this.auth.hasPermission(this.permissions.STOCK_VIEW_COSTS),
      personalization: this.auth.hasPermission(this.permissions.ORDERS_PERSONALIZATION),
      unitSale: this.auth.hasPermission(this.permissions.ORDERS_VIEW_SALE_PRICE),
      actions: !this.isReadOnlyOrder,
    });
    return this.orderTableColumnsCache;
  }

  get orderTableLines(): TransactionTableLine[] {
    const key = this.orderLines
      .map(
        (line) =>
          `${line.stockItemId ?? ''}\u0001${line.cantidad}\u0001${line.costoUnitario}\u0001${line.precioVenta}\u0001${this.getLinePersTotal(line)}`
      )
      .join('\u0002');
    if (key === this.orderTableLinesKey) {
      return this.orderTableLinesCache;
    }
    this.orderTableLinesKey = key;
    this.orderTableLinesCache = this.orderLines.map((line) => ({
      productName: line.nombre,
      productId: line.stockItemId,
      productClickable: !!line.stockItemId,
      quantity: line.cantidad,
      unitCost: line.costoUnitario,
      personalization: this.useDetailedExtraCosts
        ? this.getLinePersTotal(line)
        : this.getLinePersUnitCost(line),
      unitSale: line.precioVenta,
      subtotal: this.getLineSaleTotal(line),
      quantityEditable: !this.isReadOnlyOrder,
      unitCostEditable: false,
      personalizationEditable:
        !this.isReadOnlyOrder &&
        !this.useDetailedExtraCosts &&
        this.auth.hasPermission(this.permissions.ORDERS_PERSONALIZATION),
      unitSaleEditable: !this.isReadOnlyOrder && this.auth.canViewOrderSalePrice,
      removable: !this.isReadOnlyOrder,
    }));
    return this.orderTableLinesCache;
  }

  private invalidateOrderLinesViewCache(): void {
    this.orderTableLinesKey = '';
    this.orderTableLinesCache = [];
    this.addedOrderProductIdsKey = '';
    this.addedOrderProductIdsCache = [];
    this.catalogPriceOptionsCache.clear();
  }

  onOrderTableFieldChange(event: TransactionTableFieldChange): void {
    const line = this.orderLines[event.index];
    if (!line) return;
    if (event.field === 'quantity') {
      line.cantidad = event.value;
      this.calculateTotals();
      return;
    }
    if (event.field === 'personalization') {
      this.setLinePersUnitCost(line, event.value);
      return;
    }
    if (event.field === 'unitSale') {
      line.precioVenta = event.value;
      this.calculateTotals();
    }
  }

  onOrderTableProductClick(event: { index: number; productId?: string }): void {
    const line = this.orderLines[event.index];
    if (line) this.openOrderLineProduct(line);
  }

  onOrderTableMetaAction(_event: { index: number; action: string }): void {
    // Meta actions handled inline in the metaRow template.
  }

  removeLine(index: number) {
    if (!this.ensureEditable('quitar productos')) return;
    if (this.extraCostsModalIndex === index) {
      this.cancelExtraCostsModal();
    } else if (this.extraCostsModalIndex !== null && this.extraCostsModalIndex > index) {
      this.extraCostsModalIndex--;
    }
    this.orderLinesTable?.clearNumericDraftsForIndex(index);
    this.orderLines.splice(index, 1);
    this.invalidateOrderLinesViewCache();
    this.calculateTotals();
  }

  onLineQuantityChange(line: OrderLineItem) {
    if (!line.cantidad || line.cantidad < 1) {
      line.cantidad = 1;
    }
    this.calculateTotals();
  }

  calculateTotals() {
    const baseProductCost = this.orderLines.reduce(
      (acc, line) => acc + (Number(line.cantidad) || 0) * (Number(line.costoUnitario) || 0),
      0
    );
    const customizationCostTotal = this.orderLines.reduce(
      (acc, line) => acc + this.getLinePersTotal(line),
      0
    );
    const totalCost = baseProductCost + customizationCostTotal;

    const lineTotal = this.orderLines.reduce(
      (acc, line) => acc + this.getLineSaleTotal(line),
      0
    );
    const preservedTotal =
      Number(this.order.total) ||
      Number(this.loadedOrderSnapshot?.total) ||
      0;

    // Una línea con precio explícito (incluido 0, p. ej. donación) manda sobre el total
    // guardado. Solo conservamos el total a nivel pedido cuando ninguna línea tiene precio
    // propio (pedidos antiguos que guardaban el total sin desglose por línea).
    const hasExplicitLinePrice = this.orderLines.some((line) => line.precioVenta != null);
    const nextTotal =
      this.orderLines.length > 0
        ? hasExplicitLinePrice
          ? lineTotal
          : preservedTotal || lineTotal
        : preservedTotal;
    const nextCostoReal =
      this.orderLines.length > 0
        ? totalCost
        : Number(this.order.costoReal) ||
          Number(this.loadedOrderSnapshot?.costoReal) ||
          0;
    const nextGanancia = nextTotal - nextCostoReal;
    const nextMargen = nextTotal ? nextGanancia / nextTotal : 0;

    let changed = false;
    if (this.baseProductCost !== baseProductCost) {
      this.baseProductCost = baseProductCost;
      changed = true;
    }
    if (this.customizationCostTotal !== customizationCostTotal) {
      this.customizationCostTotal = customizationCostTotal;
      changed = true;
    }
    if (this.totalCost !== totalCost) {
      this.totalCost = totalCost;
      changed = true;
    }
    if (this.order.total !== nextTotal) {
      this.order.total = nextTotal;
      changed = true;
    }
    if (this.order.costoReal !== nextCostoReal) {
      this.order.costoReal = nextCostoReal;
      changed = true;
    }
    if (this.order.gananciaEstimada !== nextGanancia) {
      this.order.gananciaEstimada = nextGanancia;
      changed = true;
    }
    if (this.order.margen !== nextMargen) {
      this.order.margen = nextMargen;
      changed = true;
    }

    if (changed) {
      this.syncOrderBalance();
    }
  }

  private resolveCurrentOrderBalance() {
    return resolveOrderBalance({
      total: this.order.total ?? this.loadedOrderSnapshot?.total,
      senia: this.order.senia ?? this.loadedOrderSnapshot?.senia,
      totalPagado: this.order.totalPagado ?? this.loadedOrderSnapshot?.totalPagado,
      pagos: this.order.pagos ?? this.loadedOrderSnapshot?.pagos,
      seniaBloqueada: this.order.seniaBloqueada ?? this.loadedOrderSnapshot?.seniaBloqueada,
      movimientoSeniaId: this.order.movimientoSeniaId ?? this.loadedOrderSnapshot?.movimientoSeniaId,
    });
  }

  private syncOrderBalance() {
    const balance = this.resolveCurrentOrderBalance();
    if (this.order.saldo !== balance.saldo) {
      this.order.saldo = balance.saldo;
    }
    if (this.order.totalPagado !== balance.pagado) {
      this.order.totalPagado = balance.pagado;
    }
  }

  getTotalPagado(): number {
    if (this.order.pagos?.length) {
      return this.order.pagos
        .filter((pago) => pago.tipo !== 'extra')
        .reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
    }
    if (this.seniaBloqueada || this.order.movimientoSeniaId) {
      return Number(this.order.totalPagado ?? this.order.senia) || 0;
    }
    return 0;
  }

  get paymentFechaHoyLabel(): string {
    return new Date().toLocaleDateString('es-AR');
  }

  formatPaymentDate(value?: string): string {
    if (!value) return this.paymentFechaHoyLabel;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
  }

  getPaymentLabel(pago: OrderPayment): string {
    if (pago.tipo === 'seña') return 'Seña';
    if (pago.notas === 'Pago total') return 'Pago total';
    if (pago.tipo === 'cuota') return 'Cuota';
    if (pago.tipo === 'extra') return 'Pago extra';
    return 'Pago';
  }

  getPaymentLineLabel(pago: OrderPayment): string {
    const ventaCobro = this.extractVentaCobroLabel(pago.notas);
    if (ventaCobro) return ventaCobro;
    return this.getPaymentLabel(pago);
  }

  shouldShowPaymentNotas(pago: OrderPayment): boolean {
    if (!pago.notas?.trim()) return false;
    if (pago.notas === 'Pago total') return false;
    if (this.extractVentaCobroLabel(pago.notas)) return false;
    return true;
  }

  private extractVentaCobroLabel(notas?: string): string | null {
    if (!notas) return null;
    const match = notas.match(/venta\s*#(\S+)/i);
    if (!match) return null;
    return `Cobro venta #${match[1]}`;
  }

  setPaymentModo(modo: 'total' | 'parcial') {
    this.paymentModo = modo;
    if (modo === 'total') {
      this.paymentMonto = this.paymentSaldoSnapshot;
    } else if (this.paymentMonto == null || this.paymentMonto === this.paymentSaldoSnapshot) {
      this.paymentMonto = null;
    }
  }

  openPaymentModal() {
    if (!this.ensurePaymentAllowed()) return;
    this.paymentSaldoSnapshot = this.pendingOrderSaldo;
    this.paymentModo = 'total';
    this.paymentMonto = this.paymentSaldoSnapshot;
    this.paymentSubmitting = false;
    this.paymentModalOpen = true;
  }

  closePaymentModal() {
    this.paymentModalOpen = false;
    this.paymentSubmitting = false;
  }

  submitPayment() {
    if (!this.ensurePaymentAllowed() || this.paymentSubmitting) return;

    const saldo = this.paymentSaldoSnapshot;
    const monto = this.paymentModo === 'total' ? saldo : Number(this.paymentMonto);

    if (!monto || monto <= 0) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un monto válido.',
      });
      return;
    }

    if (monto > saldo) {
      const extra = monto - saldo;
      this.dialogService
        .confirm({
          title: 'Pago mayor al saldo',
          message: `El monto supera el saldo pendiente (${this.formatMoney(saldo)}). ¿Registrar ${this.formatMoney(saldo)} del pedido y ${this.formatMoney(extra)} como pago extra en caja?`,
          confirmLabel: 'Sí, registrar',
        })
        .subscribe((confirmed) => {
          if (confirmed) this.registerPayment(monto, true);
        });
      return;
    }

    this.registerPayment(monto, false);
  }

  private formatMoney(value: number): string {
    return `$${value}`;
  }

  private registerPayment(monto: number, allowExtra: boolean) {
    if (!this.editingOrderId || this.paymentSubmitting) return;

    this.paymentSubmitting = true;
    this.orderService
      .addOrderPayment(this.editingOrderId, {
        monto,
        tipo: this.paymentModo === 'parcial' ? 'cuota' : 'pago',
        allowExtra,
      })
      .subscribe({
        next: (result) => {
          this.order.pagos = result.allPagos ?? [
            ...(this.order.pagos ?? []),
            ...(result.pagos ?? [result.pago]),
          ];
          this.order.totalPagado = result.totalPagado;
          this.order.saldo = result.saldo;
          this.order.seniaBloqueada = true;
          this.syncOrderBalance();
          if (this.loadedOrderSnapshot) {
            this.loadedOrderSnapshot = {
              ...this.loadedOrderSnapshot,
              pagos: this.order.pagos,
              totalPagado: this.order.totalPagado,
              saldo: this.order.saldo,
              seniaBloqueada: true,
            };
          }
          this.paymentSubmitting = false;
          this.closePaymentModal();
        },
        error: (err: HttpErrorResponse) => {
          this.paymentSubmitting = false;
          this.dialogService.alert({
            title: 'Error',
            message:
              typeof err.error?.error === 'string'
                ? err.error.error
                : 'No se pudo registrar el pago.',
          });
        },
      });
  }

  ngOnDestroy() {
    window.clearTimeout(this.orderSaveFeedbackTimeout);
    window.clearTimeout(this.stockEnrichTimer);
  }

  saveDraft() {
    if (!this.ensureEditable('guardar el pedido')) return;
    if (!this.validateClient()) return;
    if (!this.beginOrderSave('draft')) return;
    this.persistOrder('borrador');
  }

  submitOrder() {
    if (!this.ensureEditable('confirmar el pedido')) return;
    if (!this.validateClient()) return;
    if (!this.validateProducts()) return;

    this.confirmDonationIfNeeded(() => this.proceedSubmitOrder());
  }

  private proceedSubmitOrder() {
    const estado =
      !this.isEditing || this.isDraftOrder ? 'pendiente' : this.order.estado || 'pendiente';

    if (this.isEditing && this.isDeliveryPendingSave) {
      const nextLabel = getOrderStatusLabelFromConfig(estado, this.appConfig.pedidos);
      this.dialogService
        .confirm({
          title: 'Cerrar pedido',
          message: `Al guardar, el pedido pasará a «${nextLabel}» y quedará cerrado (no podrás editarlo después). ¿Continuar?`,
          confirmLabel: 'Guardar y cerrar',
          cancelLabel: 'Cancelar',
        })
        .subscribe((confirmed) => {
          if (!confirmed) return;
          if (!this.beginOrderSave('submit')) return;
          this.persistOrder(estado);
        });
      return;
    }

    if (!this.beginOrderSave('submit')) {
      if (this.orderSaveState === 'saving') return;
      this.dialogService.alert({
        title: 'Guardar pedido',
        message: 'Esperá a que termine el guardado anterior o recargá la página.',
      });
      return;
    }
    this.persistOrder(estado);
  }

  private validateClient(): boolean {
    if (!this.order.clienteId) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message:
          'Seleccioná un cliente del listado o creá uno escribiendo el nombre y eligiendo «Crear cliente».',
      });
      return false;
    }
    return true;
  }

  private validateProducts(): boolean {
    if (this.orderLines.length === 0) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Agregá al menos un producto para confirmar el pedido',
      });
      return false;
    }

    if (this.auth.canViewOrderSalePrice) {
      // Un precio 0 es válido (donación / ítem sin cargo). Solo exigimos completar precios
      // cuando el pedido tiene un total de venta > 0 pero quedó alguna línea sin precio cargado.
      const totalVenta = this.orderLines.reduce(
        (acc, line) => acc + this.getLineSaleTotal(line),
        0
      );
      if (totalVenta > 0) {
        const missingPrice = this.orderLines.filter((line) => line.precioVenta == null);
        if (missingPrice.length > 0) {
          this.dialogService.alert({
            title: 'Campo requerido',
            message:
              'Falta el precio de venta en algún producto. Ingresalo (puede ser 0) antes de confirmar el pedido.',
          });
          return false;
        }
      }
    }

    return true;
  }

  /** El total de venta es 0 (todos los productos sin cargo) → es una donación. */
  private get isDonationOrder(): boolean {
    if (!this.auth.canViewOrderSalePrice || this.orderLines.length === 0) return false;
    const totalVenta = this.orderLines.reduce(
      (acc, line) => acc + this.getLineSaleTotal(line),
      0
    );
    return totalVenta === 0;
  }

  private confirmDonationIfNeeded(onConfirm: () => void): void {
    if (!this.isDonationOrder) {
      onConfirm();
      return;
    }
    this.dialogService
      .confirm({
        title: 'Guardar como donación',
        message:
          'El precio de venta es $0. ¿Querés registrar este pedido como donación? No genera saldo a cobrar y la ganancia queda en negativo por el costo.',
        confirmLabel: 'Sí, es donación',
        cancelLabel: 'Volver',
      })
      .subscribe((confirmed) => {
        if (confirmed) onConfirm();
      });
  }

  private beginOrderSave(action: 'draft' | 'submit'): boolean {
    if (this.orderSaveState === 'success') {
      this.resetOrderSaveState();
    }
    if (this.orderSaveState !== 'idle') return false;
    this.orderSaveAction = action;
    this.orderSaveState = 'saving';
    this.orderSaveBannerText = '';
    return true;
  }

  private resetOrderSaveState() {
    window.clearTimeout(this.orderSaveFeedbackTimeout);
    this.orderSaveState = 'idle';
    this.orderSaveAction = null;
    this.orderSaveBannerText = '';
  }

  private resolveOrderSaveBannerText(): string {
    if (this.orderSaveAction === 'draft') return 'Borrador guardado';
    if (this.isLockedOrder) return 'Descripción guardada';
    if (this.isEditing && !this.isDraftOrder) return 'Pedido guardado correctamente';
    return 'Pedido confirmado';
  }

  onOrderSaveClick() {
    if (this.canSaveLockedDescription) {
      this.saveLockedOrderDescription();
      return;
    }
    this.submitOrder();
  }

  private saveLockedOrderDescription() {
    if (!this.editingOrderId || !this.canSaveLockedDescription) return;
    if (!this.beginOrderSave('submit')) return;

    this.orderService
      .updateOrder(this.editingOrderId, {
        descripcion: this.order.descripcion?.trim() ?? '',
      })
      .subscribe({
        next: (result) => {
          this.applyOrderUpdateResult(result);
          if (this.loadedOrderSnapshot) {
            this.loadedOrderSnapshot = {
              ...this.loadedOrderSnapshot,
              descripcion: this.order.descripcion?.trim() ?? '',
            };
          }
          this.finishOrderSaveSuccess();
        },
        error: (err: HttpErrorResponse) => {
          this.resetOrderSaveState();
          const serverMessage =
            typeof err.error?.error === 'string' ? err.error.error : '';
          this.dialogService.alert({
            title: 'Error',
            message: serverMessage || 'No se pudo guardar la descripción.',
          });
        },
      });
  }

  private finishOrderSaveSuccess() {
    this.orderSaveState = 'success';
    this.orderSaveBannerText = this.resolveOrderSaveBannerText();
    window.clearTimeout(this.orderSaveFeedbackTimeout);
    this.orderSaveFeedbackTimeout = window.setTimeout(() => {
      this.resetOrderSaveState();
    }, 6000);
  }

  private autoReserveStockForOrder(orderId: string) {
    this.awaitingStockPrepAfterSave = true;
    this.orderService.getStockPreparation(orderId).subscribe({
      next: (view) => {
        if (view.stockPreparado || view.lines.length === 0) {
          this.awaitingStockPrepAfterSave = false;
          this.finishOrderSaveSuccess();
          return;
        }

        const allocations = buildSuggestedStockAllocations(view);
        this.orderService.confirmStockPreparation(orderId, allocations).subscribe({
          next: (result) => {
            this.applyStockPrepFromServer(result, { refreshStock: false });
            this.awaitingStockPrepAfterSave = false;
            this.finishOrderSaveSuccess();
          },
          error: (err: HttpErrorResponse) => {
            this.orderSaveState = 'idle';
            this.orderSaveAction = null;
            this.dialogService
              .alert({
                title: 'Revisá el stock',
                message:
                  typeof err.error?.error === 'string'
                    ? `${err.error.error} Ajustá cantidades y confirmá la reserva.`
                    : 'No se pudo reservar stock automáticamente. Ajustá cantidades y confirmá la reserva.',
              })
              .subscribe(() => {
                this.stockPrepOpen = true;
              });
          },
        });
      },
      error: () => {
        this.awaitingStockPrepAfterSave = false;
        this.finishOrderSaveSuccess();
      },
    });
  }

  private applyStockPrepFromServer(
    result: {
      items?: OrderLineItem[];
      estadoStock?: string;
      stockPreparado?: boolean;
    },
    options?: { refreshStock?: boolean }
  ) {
    if (result.estadoStock) this.order.estadoStock = result.estadoStock;
    if (result.stockPreparado !== undefined) this.order.stockPreparado = result.stockPreparado;
    if (result.items?.length) {
      this.orderLines = result.items.map((line) => this.normalizeOrderLine(line));
      if (options?.refreshStock !== false) {
        this.enrichOrderLinesWithStock();
      }
    }
    if (this.loadedOrderSnapshot) {
      this.loadedOrderSnapshot = {
        ...this.loadedOrderSnapshot,
        estadoStock: this.order.estadoStock,
        stockPreparado: this.order.stockPreparado,
        items: this.orderLines,
      };
    }
  }

  private persistOrder(estado: string) {
    if (!this.ensureEditable('guardar el pedido')) {
      this.resetOrderSaveState();
      return;
    }

    if (this.editingOrderId) {
      this.pendingSaveEstado = estado;
      this.runPreSaveEstadoFlow(estado, () => this.executePersistOrder(estado));
      return;
    }

    this.executePersistOrder(estado);
  }

  private runPreSaveEstadoFlow(targetEstado: string, onReady: () => void) {
    const previous = normalizeOrderStatus(this.savedOrderEstado);
    const next = normalizeOrderStatus(targetEstado);
    if (next === previous) {
      onReady();
      return;
    }

    const transition = validateOrderEstadoTransition({
      previousEstado: previous,
      nextEstado: next,
      triggerEstado: this.appConfig.pedidos.estadoDescuentaStock,
      stockDescontado: this.order.stockDescontado,
      estados: this.appConfig.pedidos.estados,
    });

    if (!transition.allowed) {
      this.resetOrderSaveState();
      this.pendingSaveEstado = null;
      this.dialogService.alert({
        title: 'Estado del pedido',
        message: transition.error ?? 'No podés retroceder el estado del pedido.',
      });
      return;
    }

    if (transition.requiresStockRestore) {
      const nextLabel = getOrderStatusLabelFromConfig(next, this.appConfig.pedidos);
      this.dialogService
        .confirm({
          title: 'Retroceder estado',
          message: `Al guardar en «${nextLabel}», se devolverá el stock al depósito (entrada de stock). ¿Continuar?`,
          confirmLabel: 'Sí, guardar',
          cancelLabel: 'Cancelar',
          variant: 'danger',
        })
        .subscribe((confirmed) => {
          if (!confirmed) {
            this.resetOrderSaveState();
            this.pendingSaveEstado = null;
            return;
          }
          this.continuePreSaveStockDiscountCheck(targetEstado, onReady);
        });
      return;
    }

    this.continuePreSaveStockDiscountCheck(targetEstado, onReady);
  }

  private continuePreSaveStockDiscountCheck(targetEstado: string, onReady: () => void) {
    if (!this.editingOrderId) {
      onReady();
      return;
    }

    const previous = normalizeOrderStatus(this.savedOrderEstado);
    const next = normalizeOrderStatus(targetEstado);

    if (isOrderDeliveryEstado(next)) {
      onReady();
      return;
    }

    const stockFullyConsumed = orderStockFullyConsumed(this.orderLines);
    const crossesStock = shouldConsumeStockOnStatusChange({
      previousEstado: previous,
      nextEstado: next,
      triggerEstado: this.appConfig.pedidos.estadoDescuentaStock,
      stockDescontado: this.order.stockDescontado,
      stockFullyConsumed,
      estados: this.appConfig.pedidos.estados,
    });

    if (!crossesStock) {
      onReady();
      return;
    }

    this.orderService.getStockDiscountPreview(this.editingOrderId, next).subscribe({
      next: (preview) => {
        if (preview.blocked) {
          this.resetOrderSaveState();
          this.pendingSaveEstado = null;
          this.dialogService.alert({
            title: 'Stock insuficiente',
            message: preview.blockReason ?? 'No podés guardar con este estado todavía.',
          });
          return;
        }

        if (!preview.willConsume) {
          onReady();
          return;
        }

        this.stockDiscountPreview = preview;
        this.stockDiscountSelectedScope = preview.defaultScope;
        this.pendingEstadoForStockDiscount = targetEstado;
        this.stockDiscountDialogOpen = true;
      },
      error: () => {
        onReady();
      },
    });
  }

  private executePersistOrder(estado: string, descuentoFisicoAlcance?: OrderPhysicalStockScope) {
    if (!this.ensureEditable('guardar el pedido')) {
      this.resetOrderSaveState();
      this.pendingSaveEstado = null;
      return;
    }
    this.calculateTotals();

    const firstLine = this.orderLines[0];
    const payload: Partial<Order> & { descuentoFisicoAlcance?: OrderPhysicalStockScope } = {
      clienteId: this.order.clienteId!,
      // Guardamos el nombre denormalizado para que la grilla no tenga que
      // resolver cada cliente contra Firestore al listar pedidos.
      clienteNombre: (this.selectedClientLabel ?? this.order.clienteNombre ?? '').trim(),
      descripcion: this.order.descripcion?.trim() ?? '',
      estado,
      fechaEntrega: this.order.fechaEntrega || new Date().toISOString(),
      createdAt: this.order.createdAt || new Date().toISOString(),
      total: Number(this.order.total) || 0,
      costoReal: Number(this.order.costoReal) || 0,
      gananciaEstimada: Number(this.order.gananciaEstimada) || 0,
      margen: Number(this.order.margen) || 0,
      saldo: Number(this.order.saldo) || 0,
      items: this.orderLines.map((line) => {
        const customizationTotal = this.getLinePersTotal(line);
        return {
          stockItemId: line.stockItemId,
          nombre: line.nombre,
          cantidad: Number(line.cantidad) || 1,
          costoUnitario: Number(line.costoUnitario) || 0,
          costoPersonalizacion: customizationTotal,
          costosExtra: (line.costosExtra ?? [])
            .filter((extra) => extra.nombre?.trim() || extra.costo)
            .map((extra) => ({
              nombre: extra.nombre.trim(),
              costo: Number(extra.costo) || 0,
            })),
          precioVenta: Number(line.precioVenta) || 0,
        };
      }),
      stockItemId: firstLine?.stockItemId,
      cantidad: firstLine ? Number(firstLine.cantidad) || 1 : undefined,
    };

    if (!this.editingOrderId) {
      payload.senia = Number(this.order.senia) || 0;
    } else if (!this.seniaBloqueada) {
      payload.senia = Number(this.order.senia) || 0;
    }

    if (descuentoFisicoAlcance) {
      payload.descuentoFisicoAlcance = descuentoFisicoAlcance;
    }

    const request = this.editingOrderId
      ? this.orderService.updateOrder(this.editingOrderId, payload)
      : this.orderService.createOrder(payload as Order);

    request.subscribe({
      next: (result) => {
        this.pendingSaveEstado = null;
        const createdId = 'id' in result ? result.id : undefined;
        const wasNew = !this.editingOrderId;
        if (createdId && wasNew) {
          this.editingOrderId = createdId;
          this.router.navigate(['/orders', createdId, 'edit'], { replaceUrl: true });
        }
        this.applyOrderUpdateResult(result as OrderUpdateResult);
        this.isDraftOrder = estado === 'borrador';
        this.savedOrderEstado = this.order.estado ?? estado;
        if (orderIsLockedForEdit(this.order.estado) || !!(result as OrderUpdateResult).locked) {
          this.orderFormLocked = true;
          if (this.loadedOrderSnapshot) {
            this.loadedOrderSnapshot = {
              ...this.loadedOrderSnapshot,
              ...this.order,
              estado: this.order.estado,
              ventaId: this.order.ventaId,
              pagos: this.order.pagos,
              saldo: this.order.saldo,
              totalPagado: this.order.totalPagado,
            };
          }
        }

        const shouldAutoReserve =
          this.orderSaveAction === 'submit' &&
          estado !== 'borrador' &&
          !!this.editingOrderId &&
          orderConfigUsesReservedStock(this.appConfig);

        if (shouldAutoReserve) {
          this.autoReserveStockForOrder(this.editingOrderId!);
          return;
        }

        this.finishOrderSaveSuccess();
      },
      error: (err: HttpErrorResponse) => {
        this.pendingSaveEstado = null;
        this.resetOrderSaveState();
        const serverMessage =
          typeof err.error?.error === 'string' ? err.error.error : '';
        this.dialogService.alert({
          title: 'Error',
          message:
            serverMessage && serverMessage !== 'Error creating order'
              ? serverMessage
              : 'No se pudo guardar el pedido. Intentá de nuevo.',
        });
      },
    });
  }

  private loadOrderForDuplicate(sourceId: string) {
    this.orderService.getOrder(sourceId).subscribe({
      next: (order) => {
        if (!this.auth.canViewOrder(order.estado)) {
          this.dialogService.alert({
            title: 'Sin acceso',
            message: 'No tenés permiso para ver este pedido.',
          });
          this.router.navigate(['/orders']);
          return;
        }

        this.applyOrderFieldsForDuplicate(order);
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el pedido a duplicar.',
        });
        this.order = this.emptyOrder();
        this.orderLines = [];
      },
    });
  }

  private applyOrderFieldsForDuplicate(source: Order) {
    this.editingOrderId = null;
    this.loadedOrderSnapshot = null;
    this.isDraftOrder = false;
    this.savedOrderEstado = 'pendiente';
    this.orderFormLocked = false;

    this.order = {
      ...this.emptyOrder(),
      clienteId: source.clienteId ?? '',
      descripcion: source.descripcion ?? '',
      estado: 'pendiente',
      fechaEntrega: source.fechaEntrega ?? new Date().toISOString(),
    };

    if (source.items?.length) {
      this.orderLines = source.items.map((line) => this.duplicateOrderLine(line));
      this.enrichOrderLinesWithStock();
      this.refreshOrderLineCatalogLinks();
    } else if (source.stockItemId) {
      this.orderLines = [
        this.duplicateOrderLine({
          stockItemId: source.stockItemId,
          nombre: 'Producto',
          cantidad: Number(source.cantidad) || 1,
          costoUnitario: 0,
          costoPersonalizacion: Number(source.costosExtra?.[0]?.costoUnitario) || 0,
          costosExtra: (source.costosExtra ?? []).map((extra) => ({
            nombre: extra.nombre,
            costo: Number(extra.costoUnitario) || 0,
          })),
          precioVenta: Number(source.total) || 0,
        }),
      ];

      this.stockService.getItem(source.stockItemId).subscribe({
        next: (stockItem) => {
          this.orderLines[0].nombre = stockItem.nombre;
          this.orderLines[0].costoUnitario = Number(stockItem.costo) || 0;
          this.orderLines[0].controlaStock = stockItem.controlaStock !== false;
          this.orderLines[0].permitirStockNegativo = stockItem.permitirStockNegativo !== false;
          this.orderLines[0].stockDisponible = getStockDisponible(stockItem);
          this.calculateTotals();
        },
      });
    } else {
      this.orderLines = [];
    }

    this.calculateTotals();
  }

  private duplicateOrderLine(line: OrderLineItem): OrderLineItem {
    const normalized = this.normalizeOrderLine(line);
    return {
      stockItemId: normalized.stockItemId,
      nombre: normalized.nombre,
      cantidad: Number(normalized.cantidad) || 1,
      costoUnitario: Number(normalized.costoUnitario) || 0,
      costoPersonalizacion: Number(normalized.costoPersonalizacion) || 0,
      costosExtra: (normalized.costosExtra ?? []).map((extra) => ({
        nombre: extra.nombre,
        costo: Number(extra.costo) || 0,
      })),
      precioVenta: normalized.precioVenta,
      priceCatalogId: normalized.priceCatalogId,
    };
  }

  private loadOrder(orderId: string) {
    const requestId = ++this.loadOrderRequestId;
    this.orderService.getOrder(orderId).subscribe({
      next: (order) => {
        if (requestId !== this.loadOrderRequestId) return;
        if (this.editingOrderId !== orderId) return;

        if (!this.auth.canViewOrder(order.estado)) {
          this.orderDetailLoading = false;
          this.dialogService.alert({
            title: 'Sin acceso',
            message: 'No tenés permiso para ver este pedido.',
          });
          this.router.navigate(['/orders']);
          return;
        }

        this.applyLoadedOrder(order);
        this.orderPageReady = true;
        this.orderDetailLoading = false;
      },
      error: () => {
        if (requestId !== this.loadOrderRequestId) return;
        this.orderPageReady = true;
        this.orderDetailLoading = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el pedido.',
        });
        this.router.navigate(['/orders']);
      },
    });
  }

  private coerceOrderItems(raw: unknown): OrderLineItem[] {
    let items: OrderLineItem[] = [];
    if (Array.isArray(raw)) {
      items = raw.filter((line) => line && typeof line === 'object') as OrderLineItem[];
    } else if (raw && typeof raw === 'object') {
      items = Object.values(raw as Record<string, OrderLineItem>).filter(
        (line) => line && typeof line === 'object'
      );
    }
    if (items.length > NewOrderComponent.MAX_ORDER_LINES) {
      items = items.slice(0, NewOrderComponent.MAX_ORDER_LINES);
    }
    return items;
  }

  private applyLoadedOrder(order: Order, options?: { includeLines?: boolean }) {
    const includeLines = options?.includeLines ?? true;
    const normalizedStatus = normalizeOrderStatus(order.estado);
    this.isDraftOrder = normalizedStatus === 'borrador';
    this.loadedOrderSnapshot = order;
    this.ensureSelectedClient(order.clienteId, order.clienteNombre);

    this.order = {
      clienteId: order.clienteId ?? '',
      descripcion: order.descripcion ?? '',
      estado: order.estado ?? 'pendiente',
      createdAt: order.createdAt ?? new Date().toISOString(),
      fechaEntrega: order.fechaEntrega ?? new Date().toISOString(),
      total: Number(order.total) || 0,
      costoReal: Number(order.costoReal) || 0,
      gananciaEstimada: Number(order.gananciaEstimada) || 0,
      margen: Number(order.margen) || 0,
      senia: Number(order.senia) || 0,
      totalPagado: Number(order.totalPagado) || 0,
      saldo: Number(order.saldo) || 0,
      pagos: order.pagos ?? [],
      seniaBloqueada: order.seniaBloqueada,
      movimientoSeniaId: order.movimientoSeniaId,
      stockDescontado: order.stockDescontado,
      stockPreparado: order.stockPreparado,
      estadoStock: order.estadoStock,
      ventaId: order.ventaId,
      items: order.items ?? [],
    };
    this.savedOrderEstado = this.order.estado ?? 'pendiente';
    this.orderFormLocked = orderIsLockedForEdit(order.estado);

    if (!includeLines) {
      this.calculateTotals();
      return;
    }

    const items = this.coerceOrderItems(order.items);
    this.invalidateOrderLinesViewCache();

    if (items.length) {
      this.orderLines = items.map((line) => this.normalizeOrderLine(line));
      queueMicrotask(() => this.enrichOrderLinesWithStock());
    } else if (order.stockItemId) {
      this.orderLines = [
        this.normalizeOrderLine({
          stockItemId: order.stockItemId,
          nombre: 'Producto',
          cantidad: Number(order.cantidad) || 1,
          costoUnitario: 0,
          costoPersonalizacion: Number(order.costosExtra?.[0]?.costoUnitario) || 0,
          costosExtra: (order.costosExtra ?? []).map((extra) => ({
            nombre: extra.nombre,
            costo: Number(extra.costoUnitario) || 0,
          })),
          precioVenta: Number(order.total) || 0,
        }),
      ];

      this.stockService.getItem(order.stockItemId).subscribe({
        next: (stockItem) => {
          this.orderLines[0].nombre = stockItem.nombre;
          this.orderLines[0].costoUnitario = Number(stockItem.costo) || 0;
          this.orderLines[0].controlaStock = stockItem.controlaStock !== false;
          this.orderLines[0].permitirStockNegativo = stockItem.permitirStockNegativo !== false;
          this.orderLines[0].stockDisponible = getStockDisponible(stockItem);
          this.calculateTotals();
        },
      });
    } else {
      this.orderLines = [];
    }

    this.calculateTotals();
  }

  private normalizeOrderLine(line: OrderLineItem): OrderLineItem {
    const costosExtraRaw = Array.isArray(line.costosExtra) ? line.costosExtra : [];
    const costosExtra = costosExtraRaw
      .slice(0, NewOrderComponent.MAX_EXTRA_COSTS_PER_LINE)
      .map((extra) => ({
        nombre: String(extra?.nombre ?? '').trim() || 'Extra',
        costo: Number(extra?.costo) || 0,
      }));

    if (costosExtra.length) {
      return {
        stockItemId: String(line.stockItemId ?? '').trim(),
        nombre: String(line.nombre ?? '').trim() || 'Producto',
        cantidad: Math.max(1, Number(line.cantidad) || 1),
        costoUnitario: Number(line.costoUnitario) || 0,
        costoPersonalizacion: Number(line.costoPersonalizacion) || 0,
        costosExtra,
        precioVenta: line.precioVenta == null ? null : Number(line.precioVenta) || 0,
        precioSugerido: line.precioSugerido,
        priceCatalogId: line.priceCatalogId,
        controlaStock: line.controlaStock,
        permitirStockNegativo: line.permitirStockNegativo,
        stockDisponible: line.stockDisponible,
        cantidadReservada: line.cantidadReservada,
        cantidadUsada: line.cantidadUsada,
        cantidadFaltante: line.cantidadFaltante,
        estadoStockItem: line.estadoStockItem,
      };
    }

    const legacyTotal = Number(line.costoPersonalizacion) || 0;
    const qty = Math.max(1, Number(line.cantidad) || 1);
    const legacyUnit = legacyTotal > 0 ? legacyTotal / qty : 0;
    return {
      stockItemId: String(line.stockItemId ?? '').trim(),
      nombre: String(line.nombre ?? '').trim() || 'Producto',
      cantidad: qty,
      costoUnitario: Number(line.costoUnitario) || 0,
      costoPersonalizacion: legacyTotal,
      costosExtra: legacyTotal > 0 ? [{ nombre: 'Personalización', costo: legacyUnit }] : [],
      precioVenta: line.precioVenta == null ? null : Number(line.precioVenta) || 0,
      precioSugerido: line.precioSugerido,
      priceCatalogId: line.priceCatalogId,
      controlaStock: line.controlaStock,
      permitirStockNegativo: line.permitirStockNegativo,
      stockDisponible: line.stockDisponible,
      cantidadReservada: line.cantidadReservada,
      cantidadUsada: line.cantidadUsada,
      cantidadFaltante: line.cantidadFaltante,
      estadoStockItem: line.estadoStockItem,
    };
  }

  private enrichOrderLinesWithStock(options?: { debounceMs?: number }) {
    window.clearTimeout(this.stockEnrichTimer);

    const debounceMs = options?.debounceMs ?? 0;
    if (debounceMs > 0) {
      this.stockEnrichTimer = window.setTimeout(() => this.runEnrichOrderLinesWithStock(), debounceMs);
      return;
    }

    this.runEnrichOrderLinesWithStock();
  }

  private runEnrichOrderLinesWithStock() {
    const ids = [...new Set(this.orderLines.map((line) => line.stockItemId).filter(Boolean))] as string[];
    if (!ids.length) return;

    const requestId = ++this.stockEnrichRequestId;
    this.stockService.getItemsByIds(ids).subscribe({
      next: (items) => {
        if (requestId !== this.stockEnrichRequestId) return;

        const byId = new Map(items.filter((item) => item.id).map((item) => [item.id!, item]));
        let changed = false;
        for (const line of this.orderLines) {
          const stockItemId = String(line.stockItemId ?? '').trim();
          if (!stockItemId) continue;
          const stockItem = byId.get(stockItemId);
          if (!stockItem) continue;

          const nextControlaStock = stockItem.controlaStock !== false;
          const nextPermitirNegativo = stockItem.permitirStockNegativo !== false;
          const nextDisponible = getStockDisponible(stockItem);
          const stockCost = Number(stockItem.costo) || 0;
          const nextCosto =
            !(Number(line.costoUnitario) > 0) && stockCost > 0
              ? stockCost
              : Number(line.costoUnitario) || stockCost || 0;
          const costo = Number(line.costoUnitario) || stockCost || 0;
          const nextPrecioSugerido =
            Number(stockItem.precioSugerido) || costo * 2 || undefined;

          if (line.controlaStock !== nextControlaStock) {
            line.controlaStock = nextControlaStock;
            changed = true;
          }
          if (line.permitirStockNegativo !== nextPermitirNegativo) {
            line.permitirStockNegativo = nextPermitirNegativo;
            changed = true;
          }
          if (line.stockDisponible !== nextDisponible) {
            line.stockDisponible = nextDisponible;
            changed = true;
          }
          if (!(Number(line.costoUnitario) > 0) && stockCost > 0 && line.costoUnitario !== nextCosto) {
            line.costoUnitario = nextCosto;
            changed = true;
          }
          if (line.precioSugerido !== nextPrecioSugerido) {
            line.precioSugerido = nextPrecioSugerido;
            changed = true;
          }
          const prevCatalogId = line.priceCatalogId;
          this.attachCatalogToLine(line, stockItem);
          if (line.priceCatalogId !== prevCatalogId) {
            changed = true;
          }
        }
        if (changed) {
          this.invalidateOrderLinesViewCache();
          this.calculateTotals();
        }
      },
    });
  }

  private refreshOrderLineCatalogLinks() {
    if (!this.priceCatalogEntries.length || this.orderDetailLoading) return;
    this.catalogPriceOptionsCache.clear();
    this.enrichOrderLinesWithStock();
  }

  private attachCatalogToLine(
    line: OrderLineItem,
    item: Pick<StockItem, 'nombre' | 'nombreBase'>
  ) {
    if (!this.auth.canViewPriceCatalog || !this.priceCatalogEntries.length) {
      line.priceCatalogId = undefined;
      return;
    }

    const match = matchCatalogEntry(this.priceCatalogEntries, item);
    line.priceCatalogId = match?.id;
  }

  private getCatalogEntry(line: OrderLineItem): PriceCatalogEntry | undefined {
    if (!line.priceCatalogId) return undefined;
    return this.priceCatalogEntries.find((entry) => entry.id === line.priceCatalogId);
  }

  private ensureEditable(action: string): boolean {
    if (this.isLockedOrder) {
      this.dialogService.alert({
        title: 'Pedido entregado total',
        message: `Este pedido fue entregado total y no se puede ${action}.`,
      });
      return false;
    }
    if (!this.isCancelledOrder) return true;
    this.dialogService.alert({
      title: 'Pedido cancelado',
      message: `Este pedido está cancelado y no se puede ${action}. Creá un pedido nuevo si necesitás continuar.`,
    });
    return false;
  }

  private ensurePaymentAllowed(): boolean {
    if (!this.auth.canAccessCash) return false;
    if (this.isCancelledOrder) {
      this.dialogService.alert({
        title: 'Pedido cancelado',
        message: 'Este pedido está cancelado y no se pueden registrar pagos.',
      });
      return false;
    }
    if (this.isLockedOrder) {
      this.dialogService.alert({
        title: 'Pedido entregado total',
        message:
          'Este pedido fue entregado total. Registrá el pago desde caja, el saldo del cliente o la venta asociada.',
      });
      return false;
    }
    if (!this.editingOrderId) {
      this.dialogService.alert({
        title: 'Guardá el pedido',
        message: 'Guardá el pedido antes de registrar un pago.',
      });
      return false;
    }
    if (this.pendingOrderSaldo <= 0) {
      this.dialogService.alert({
        title: 'Sin saldo pendiente',
        message: 'Este pedido no tiene saldo pendiente para registrar.',
      });
      return false;
    }
    return true;
  }

  private emptyOrder(): Partial<Order> {
    return {
      clienteId: '',
      descripcion: '',
      estado: 'pendiente',
      createdAt: new Date().toISOString(),
      fechaEntrega: new Date().toISOString(),
      total: 0,
      costoReal: 0,
      gananciaEstimada: 0,
      margen: 0,
      senia: 0,
      totalPagado: 0,
      saldo: 0,
      pagos: [],
      seniaBloqueada: false,
      items: [],
    };
  }
}

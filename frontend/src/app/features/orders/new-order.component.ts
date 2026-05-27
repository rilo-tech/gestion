import { Component, HostListener, inject, OnDestroy, OnInit } from '@angular/core';
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
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { DuplicateActionButtonComponent } from '../../shared/components/duplicate-action-button/duplicate-action-button.component';
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
import { LucideAngularModule } from 'lucide-angular';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
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

@Component({
  selector: 'app-new-order',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, SearchableSelectComponent, DuplicateActionButtonComponent, RouterLink, HasPermissionDirective, ConfigSettingsLinkComponent, TransactionModalComponent, ClientFormPanelComponent, OrderStockPreparationPanelComponent],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 pb-20 sm:pb-24">
      <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">
            {{ isCancelledOrder ? 'Pedido cancelado' : (isLockedOrder ? 'Pedido entregado total' : (isEditing ? 'Editar Pedido' : 'Nuevo Pedido Personalizado')) }}
          </h1>
          <p *ngIf="isReadOnlyOrder" class="text-sm text-gray-500">
            <ng-container *ngIf="isCancelledOrder">
              Solo lectura. Este pedido no se puede modificar; creá uno nuevo si necesitás continuar.
            </ng-container>
            <ng-container *ngIf="isLockedOrder && !isCancelledOrder">
              Solo lectura. El pedido fue entregado total y ya no se puede modificar.
            </ng-container>
          </p>
          <app-config-settings-link
            *ngIf="!isReadOnlyOrder"
            settingsTab="pedidos"
            message="¿Preferís editar Pers. directo en lugar de costos extra?"
            linkLabel="Configuralo acá">
          </app-config-settings-link>
          <a
            *ngIf="!isReadOnlyOrder && auth.canViewPriceCatalog"
            routerLink="/price-catalog"
            class="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 font-medium mt-1">
            Consultar catálogo de precios
          </a>
        </div>
        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <button
            *ngIf="isEditing && auth.canPrintOrders"
            type="button"
            (click)="printCurrentOrder()"
            title="Imprimir pedido"
            aria-label="Imprimir pedido"
            class="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-gray-200 bg-white">
            <i-lucide name="printer" class="w-4 h-4"></i-lucide>
          </button>
          <app-duplicate-action-button
            *ngIf="isEditing && auth.canEditRecords && !isReadOnlyOrder"
            variant="outline"
            label="Duplicar pedido"
            (duplicateClick)="duplicateOrder()">
          </app-duplicate-action-button>
          <button
            routerLink="/orders"
            class="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900">
            <i-lucide name="arrow-left" class="w-4 h-4"></i-lucide>
            Volver a pedidos
          </button>
        </div>
      </div>

      <ng-container *ngIf="orderPageReady; else orderPageLoading">
      <div
        *ngIf="isDeliveryPendingSave"
        class="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Elegiste <span class="font-semibold">{{ getOrderStatusLabelFor(order.estado) }}</span>.
        Guardá el pedido para {{ deliveryPendingSaveHint }} y cerrarlo (después no se podrá editar).
      </div>

      <div
        *ngIf="isLockedOrder && !isCancelledOrder"
        class="mb-6 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
        Pedido en estado <span class="font-semibold">Entregado total</span>. No podés editarlo, cambiar el estado ni registrar pagos.
      </div>

      <div
        *ngIf="isCancelledOrder"
        class="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        Pedido en estado <span class="font-semibold">Cancelado</span>. No podés editarlo, cambiar el estado ni registrar pagos.
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 space-y-4">
          <section class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <div class="mb-4">
              <div class="flex items-center justify-between gap-3 mb-1">
                <label class="block text-sm font-medium text-gray-700">Cliente</label>
                <button
                  *ngIf="!isReadOnlyOrder"
                  type="button"
                  (click)="goToNewClientForm()"
                  class="text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline shrink-0">
                  + Nuevo cliente
                </button>
              </div>
              <app-searchable-select
                [(ngModel)]="order.clienteId"
                name="clienteId"
                [labeledOptions]="clientOptions"
                [disabled]="isReadOnlyOrder"
                [creatable]="!isReadOnlyOrder"
                createLabelPrefix="Crear cliente"
                (createRequested)="quickCreateClient($event)"
                (searchChange)="pendingClientName = $event"
                placeholder="Buscar cliente..."
                emptyOptionsMessage="No hay clientes cargados. Escribí el nombre para crearlo.">
              </app-searchable-select>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Fecha de entrega</label>
                <input
                  type="date"
                  [ngModel]="fechaEntregaInput"
                  (ngModelChange)="onFechaEntregaChange($event)"
                  name="fechaEntrega"
                  [disabled]="isReadOnlyOrder"
                  class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 disabled:text-gray-500">
              </div>
              <div *ngIf="isEditing">
                <div class="flex items-center justify-between gap-2 mb-1">
                  <label class="block text-sm font-medium text-gray-700">Estado</label>
                  <span
                    *ngIf="!isReadOnlyOrder"
                    class="inline-flex px-2 py-0.5 rounded-md text-xs font-semibold shrink-0"
                    [ngClass]="getOrderStatusBadgeClass(orderEstado)">
                    {{ getOrderStatusLabelFor(orderEstado) }}
                  </span>
                </div>
                <select
                  *ngIf="!isReadOnlyOrder"
                  [(ngModel)]="orderEstado"
                  (ngModelChange)="onOrderEstadoChange($event)"
                  name="estado"
                  [disabled]="savingEstado"
                  class="order-status-select w-full px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 disabled:opacity-60 cursor-pointer">
                  <option *ngFor="let option of orderStatusOptions" [value]="option.value">
                    {{ option.label }}
                  </option>
                </select>
                <span
                  *ngIf="isReadOnlyOrder"
                  class="inline-flex px-3 py-2 rounded-lg text-sm font-semibold"
                  [ngClass]="getOrderStatusBadgeClass(order.estado)">
                  {{ getOrderStatusLabelFor(order.estado) }}
                </span>
                <div *ngIf="canReviewStock" class="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    *ngIf="order.estadoStock"
                    class="inline-flex px-2 py-0.5 rounded-md text-xs font-semibold"
                    [ngClass]="getOrderStockStatusBadgeClass(order.estadoStock)">
                    Stock: {{ getOrderStockStatusLabel(order.estadoStock) }}
                  </span>
                  <button
                    type="button"
                    (click)="openStockPreparation()"
                    class="text-xs font-semibold text-teal-700 hover:text-teal-900 underline">
                    {{ order.stockPreparado ? 'Actualizar revisión de stock' : 'Revisar stock' }}
                  </button>
                  <button
                    *ngIf="canConsumePendingReservedStockNow"
                    type="button"
                    (click)="openConsumePendingDialog()"
                    [disabled]="consumingPendingStock"
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border border-teal-200 text-teal-800 bg-teal-50 hover:bg-teal-100 disabled:opacity-60 disabled:cursor-not-allowed">
                    {{ consumingPendingStock ? 'Descontando…' : ('Descontar faltantes ahora (' + pendingReservedToConsumeUnits + ' u.)') }}
                  </button>
                  <span *ngIf="lastStockOperationLabel" class="text-xs text-gray-500">
                    {{ lastStockOperationLabel }}
                  </span>
                </div>
                <p
                  *ngIf="orderPhysicalDiscountHint"
                  class="mt-2 text-xs text-gray-600 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                  {{ orderPhysicalDiscountHint }}
                </p>
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Descripción del trabajo</label>
              <textarea
                [(ngModel)]="order.descripcion"
                name="descripcion"
                rows="3"
                [disabled]="isReadOnlyOrder"
                placeholder="Ej. 13 canguros — seña recibida, faltan talles y diseños"
                class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 disabled:text-gray-500">
              </textarea>
            </div>
          </section>

          <section *ngIf="!isReadOnlyOrder" class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-base font-bold mb-3 flex items-center gap-2">
              <i-lucide name="package" class="w-4 h-4 text-teal-600"></i-lucide>
              Agregar productos
            </h2>

            <div class="relative">
              <input
                [(ngModel)]="productSearch"
                name="productSearch"
                (ngModelChange)="onProductSearchChange()"
                (focus)="openProductSearch()"
                (blur)="onProductSearchBlur()"
                placeholder="Buscar producto por nombre..."
                class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">

              <div
                *ngIf="productSearchOpen && productSearch.trim().length >= 2"
                class="product-search-menu absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white text-gray-900 shadow-lg divide-y divide-gray-100">
                <p *ngIf="searchingProducts" class="px-3 py-3 text-sm text-gray-400 text-center">
                  Buscando...
                </p>
                <div
                  *ngFor="let item of productSearchResults"
                  (mousedown)="onProductResultClick(item, $event)"
                  class="product-search-option flex items-center justify-between gap-3 px-3 py-2 transition-colors cursor-default"
                  [class.product-search-option--added]="isProductAdded(item.id)"
                  [class.product-search-option--interactive]="!isProductAdded(item.id)"
                  [class.hover:bg-teal-50]="!isProductAdded(item.id)"
                  [class.cursor-pointer]="!isProductAdded(item.id)">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-gray-900 truncate">{{ item.nombre }}</p>
                    <p class="text-xs text-gray-500">
                      <ng-container *appHasPermission="permissions.STOCK_VIEW_COSTS">
                        Costo base: {{ '$' + (item.costo || 0) }}
                        <ng-container *ngIf="controlsStockForCatalogItem(item)"> · </ng-container>
                      </ng-container>
                      <ng-container *ngIf="controlsStockForCatalogItem(item)">
                        Disponible: {{ getStockDisponible(item) }} u.
                      </ng-container>
                    </p>
                  </div>
                  <span
                    class="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg"
                    [class.bg-teal-50]="!isProductAdded(item.id)"
                    [class.text-teal-700]="!isProductAdded(item.id)"
                    [class.bg-gray-100]="isProductAdded(item.id)"
                    [class.text-gray-400]="isProductAdded(item.id)">
                    <i-lucide [name]="isProductAdded(item.id) ? 'check' : 'plus'" class="w-4 h-4"></i-lucide>
                  </span>
                </div>
                <p
                  *ngIf="!searchingProducts && productSearchResults.length === 0"
                  class="px-3 py-3 text-sm text-gray-400 text-center">
                  No se encontraron productos.
                </p>
              </div>
            </div>
          </section>

          <section class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-base font-bold mb-3">Productos del pedido</h2>

            <div *ngIf="orderLines.length === 0" class="py-6 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">
              Buscá productos arriba y hacé clic en uno para agregarlo acá.
            </div>

            <div *ngIf="orderLines.length > 0" class="rounded-lg border border-gray-200 overflow-hidden">
              <table class="hidden md:table w-full table-fixed">
                <colgroup>
                  <col />
                  <col class="w-[4rem]" />
                  <col *appHasPermission="permissions.STOCK_VIEW_COSTS" class="w-[5rem]" />
                  <col *appHasPermission="permissions.ORDERS_PERSONALIZATION" class="w-[5rem]" />
                  <col *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" class="w-[5.75rem]" />
                  <col class="w-10" />
                </colgroup>
                <thead class="bg-gray-50 border-b border-gray-200">
                  <tr class="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    <th scope="col" class="px-3 py-2 text-left font-medium">Producto</th>
                    <th scope="col" class="px-2 py-2 text-center font-medium">Cant.</th>
                    <th *appHasPermission="permissions.STOCK_VIEW_COSTS" scope="col" class="px-2 py-2 text-right font-medium">Costo u.</th>
                    <th *appHasPermission="permissions.ORDERS_PERSONALIZATION" scope="col" class="px-2 py-2 text-right font-medium">Pers. u.</th>
                    <th *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" scope="col" class="px-2 py-2 text-right font-medium">Venta u.</th>
                    <th scope="col" class="px-1 py-2 text-center font-medium w-10" aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let line of orderLines; let i = index" class="border-t border-gray-200">
                    <td class="px-3 py-2.5 align-middle">
                      <button
                        *ngIf="line.stockItemId; else orderLineNamePlain"
                        type="button"
                        (click)="openOrderLineProduct(line, $event)"
                        class="font-medium text-gray-900 truncate leading-snug text-left hover:text-teal-700 hover:underline max-w-full"
                        [title]="'Abrir producto: ' + line.nombre">
                        {{ line.nombre }}
                      </button>
                      <ng-template #orderLineNamePlain>
                        <p class="font-medium text-gray-900 truncate leading-snug" [title]="line.nombre">{{ line.nombre }}</p>
                      </ng-template>
                      <p
                        *ngIf="line.stockItemId && lineControlsStock(line)"
                        class="text-xs tabular-nums mt-0.5"
                        [class.text-green-700]="getLinePurchaseShortage(line) === 0"
                        [class.text-orange-700]="(getLinePurchaseShortage(line) ?? 0) > 0">
                        <ng-container *ngIf="order.stockPreparado">
                          <ng-container *ngIf="(line.cantidadReservada || 0) > 0">
                            Reservado {{ line.cantidadReservada || 0 }}
                          </ng-container>
                          <ng-container *ngIf="!(line.cantidadReservada || 0) && order.stockDescontado && (line.cantidadFaltante || 0) > 0">
                            Descontado del depósito
                          </ng-container>
                          <span *ngIf="(line.cantidadFaltante || 0) > 0"> · Faltan {{ line.cantidadFaltante }} para comprar</span>
                          <span *ngIf="!(line.cantidadFaltante || 0)"> · Stock alcanza</span>
                          <button
                            *ngIf="canReviewStock"
                            type="button"
                            (click)="openStockPreparation()"
                            class="ml-2 text-teal-700 font-semibold hover:underline">
                            Ajustar
                          </button>
                        </ng-container>
                        <ng-container *ngIf="!order.stockPreparado">
                          Libre {{ line.stockDisponible ?? 0 }} u.
                          <span *ngIf="(getLinePurchaseShortage(line) ?? 0) > 0">
                            · Faltarían {{ getLinePurchaseShortage(line) }} para comprar
                          </span>
                          <span *ngIf="getLinePurchaseShortage(line) === 0"> · Stock alcanza</span>
                          <span class="text-gray-400"> · sin reservar</span>
                        </ng-container>
                      </p>
                      <p *ngIf="line.stockItemId && !lineControlsStock(line)" class="text-xs text-gray-400 mt-0.5">
                        Sin control de stock
                      </p>
                      <ng-container *appHasPermission="permissions.ORDERS_PERSONALIZATION">
                        <button
                          *ngIf="useDetailedExtraCosts"
                          type="button"
                          [disabled]="isReadOnlyOrder"
                          (click)="openExtraCostsModal(i)"
                          class="text-teal-600 text-xs font-medium hover:text-teal-800 leading-none mt-0.5 disabled:opacity-40 disabled:cursor-not-allowed">
                          {{ getExtraCostsActionLabel(line) }}
                        </button>
                      </ng-container>
                      <ng-container *ngIf="auth.canViewPriceCatalog">
                        <button
                          *ngFor="let option of getCatalogPriceOptions(line)"
                          type="button"
                          [disabled]="isReadOnlyOrder || !auth.canViewOrderSalePrice"
                          (click)="applyCatalogPrice(line, option.price)"
                          class="text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline leading-none mt-0.5 block disabled:opacity-40 disabled:cursor-not-allowed">
                          {{ option.label }}: {{ '$' + option.price }}
                        </button>
                      </ng-container>
                    </td>
                    <td class="px-2 py-2.5 align-middle text-center">
                      <input
                        type="text"
                        inputmode="numeric"
                        [ngModel]="orderNumericModel('cantidad', i, line.cantidad)"
                        (ngModelChange)="onOrderNumericInput('cantidad', i, $event)"
                        [name]="'cantidadDesktop' + i"
                        [disabled]="isReadOnlyOrder"
                        (focus)="onOrderNumericFocus('cantidad', i, line.cantidad, $event)"
                        (blur)="onOrderNumericBlurCantidad(i, line)"
                        class="block w-full max-w-[4rem] mx-auto px-1.5 py-1 rounded-md border border-gray-200 text-xs text-center tabular-nums">
                    </td>
                    <td
                      *appHasPermission="permissions.STOCK_VIEW_COSTS"
                      class="px-2 py-2.5 align-middle text-right text-sm text-gray-600 tabular-nums">
                      {{ line.costoUnitario }}
                    </td>
                    <td
                      *appHasPermission="permissions.ORDERS_PERSONALIZATION"
                      class="px-2 py-2.5 align-middle text-right text-sm tabular-nums">
                      <input
                        *ngIf="!useDetailedExtraCosts"
                        type="text"
                        inputmode="numeric"
                        [ngModel]="orderNumericModel('pers', i, getLinePersUnitCost(line))"
                        (ngModelChange)="onOrderNumericInput('pers', i, $event)"
                        [name]="'persUnitDesktop' + i"
                        [disabled]="isReadOnlyOrder"
                        (focus)="onOrderNumericFocus('pers', i, getLinePersUnitCost(line), $event)"
                        (blur)="onOrderNumericBlurPers(i, line)"
                        class="block w-full max-w-[5rem] ml-auto px-1.5 py-1 rounded-md border border-gray-200 text-xs text-right tabular-nums">
                      <span *ngIf="useDetailedExtraCosts" class="inline-block w-full max-w-[5rem] ml-auto text-gray-600">
                        {{ getLinePersTotal(line) }}
                      </span>
                    </td>
                    <td *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" class="px-2 py-2.5 align-middle text-right">
                      <input
                        type="text"
                        inputmode="numeric"
                        [ngModel]="orderNumericModel('venta', i, line.precioVenta)"
                        (ngModelChange)="onOrderNumericInput('venta', i, $event)"
                        [name]="'precioVentaDesktop' + i"
                        [disabled]="isReadOnlyOrder"
                        (focus)="onOrderNumericFocus('venta', i, line.precioVenta, $event)"
                        (blur)="onOrderNumericBlurVenta(i, line)"
                        class="block w-full max-w-[4.25rem] ml-auto px-1.5 py-1 rounded-md border border-gray-200 text-xs text-right tabular-nums">
                    </td>
                    <td class="px-1 py-2.5 align-middle text-center w-10">
                      <button
                        *ngIf="!isReadOnlyOrder"
                        type="button"
                        (click)="removeLine(i)"
                        class="inline-flex items-center justify-center w-8 h-8 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Quitar producto"
                        aria-label="Quitar producto">
                        ×
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <article
                *ngFor="let line of orderLines; let i = index"
                class="md:hidden border-b border-gray-200 last:border-b-0 p-3 space-y-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <button
                        *ngIf="line.stockItemId; else orderLineNamePlainMobile"
                        type="button"
                        (click)="openOrderLineProduct(line, $event)"
                        class="font-medium text-gray-900 text-left hover:text-teal-700 hover:underline"
                        [title]="'Abrir producto: ' + line.nombre">
                        {{ line.nombre }}
                      </button>
                      <ng-template #orderLineNamePlainMobile>
                        <p class="font-medium text-gray-900">{{ line.nombre }}</p>
                      </ng-template>
                      <p
                        *ngIf="line.stockItemId && lineControlsStock(line)"
                        class="text-xs tabular-nums mt-0.5"
                        [class.text-green-700]="getLinePurchaseShortage(line) === 0"
                        [class.text-orange-700]="(getLinePurchaseShortage(line) ?? 0) > 0">
                        <ng-container *ngIf="order.stockPreparado">
                          <ng-container *ngIf="(line.cantidadReservada || 0) > 0">
                            Reservado {{ line.cantidadReservada || 0 }}
                          </ng-container>
                          <ng-container *ngIf="!(line.cantidadReservada || 0) && order.stockDescontado && (line.cantidadFaltante || 0) > 0">
                            Descontado del depósito
                          </ng-container>
                          <span *ngIf="(line.cantidadFaltante || 0) > 0"> · Faltan {{ line.cantidadFaltante }} para comprar</span>
                          <span *ngIf="!(line.cantidadFaltante || 0)"> · Stock alcanza</span>
                        </ng-container>
                        <ng-container *ngIf="!order.stockPreparado">
                          Disp. {{ line.stockDisponible ?? 0 }} u.
                          <span *ngIf="(getLinePurchaseShortage(line) ?? 0) > 0">
                            · Faltarían {{ getLinePurchaseShortage(line) }}
                          </span>
                        </ng-container>
                      </p>
                      <p class="text-xs text-gray-400 mt-0.5">
                        <ng-container *appHasPermission="permissions.STOCK_VIEW_COSTS">
                          Costo u.: {{ line.costoUnitario }}
                          <ng-container *ngIf="useDetailedExtraCosts"> · </ng-container>
                        </ng-container>
                        <ng-container *ngIf="useDetailedExtraCosts && auth.canEditPersonalization">
                          Pers. u.: {{ getLinePersTotal(line) }}
                        </ng-container>
                      </p>
                      <ng-container *appHasPermission="permissions.ORDERS_PERSONALIZATION">
                        <button
                          *ngIf="useDetailedExtraCosts"
                          type="button"
                          [disabled]="isReadOnlyOrder"
                          (click)="openExtraCostsModal(i)"
                          class="text-teal-600 text-xs font-medium hover:text-teal-800 mt-0.5 disabled:opacity-40 disabled:cursor-not-allowed">
                          {{ getExtraCostsActionLabel(line) }}
                        </button>
                      </ng-container>
                      <ng-container *ngIf="auth.canViewPriceCatalog">
                        <button
                          *ngFor="let option of getCatalogPriceOptions(line)"
                          type="button"
                          [disabled]="isReadOnlyOrder || !auth.canViewOrderSalePrice"
                          (click)="applyCatalogPrice(line, option.price)"
                          class="text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline mt-0.5 block disabled:opacity-40 disabled:cursor-not-allowed">
                          {{ option.label }}: {{ '$' + option.price }}
                        </button>
                      </ng-container>
                    </div>
                    <button
                      *ngIf="!isReadOnlyOrder"
                      type="button"
                      (click)="removeLine(i)"
                      class="text-red-400 hover:text-red-600 p-1 shrink-0"
                      title="Quitar producto">
                      ×
                    </button>
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Cantidad</label>
                      <input
                        type="text"
                        inputmode="numeric"
                        [ngModel]="orderNumericModel('cantidad', i, line.cantidad)"
                        (ngModelChange)="onOrderNumericInput('cantidad', i, $event)"
                        [name]="'cantidadMobile' + i"
                        [disabled]="isReadOnlyOrder"
                        (focus)="onOrderNumericFocus('cantidad', i, line.cantidad, $event)"
                        (blur)="onOrderNumericBlurCantidad(i, line)"
                        class="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm tabular-nums">
                    </div>
                    <div *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE">
                      <label class="block text-xs text-gray-500 mb-1">Precio venta u.</label>
                      <input
                        type="text"
                        inputmode="numeric"
                        [ngModel]="orderNumericModel('venta', i, line.precioVenta)"
                        (ngModelChange)="onOrderNumericInput('venta', i, $event)"
                        [name]="'precioVentaMobile' + i"
                        [disabled]="isReadOnlyOrder"
                        (focus)="onOrderNumericFocus('venta', i, line.precioVenta, $event)"
                        (blur)="onOrderNumericBlurVenta(i, line)"
                        class="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm tabular-nums">
                    </div>
                  </div>
                  <div *ngIf="auth.canEditPersonalization && !useDetailedExtraCosts" class="mt-2">
                    <label class="block text-xs text-gray-500 mb-1">Pers. u.</label>
                    <input
                      type="text"
                      inputmode="numeric"
                      [ngModel]="orderNumericModel('pers', i, getLinePersUnitCost(line))"
                      (ngModelChange)="onOrderNumericInput('pers', i, $event)"
                      [name]="'persUnitMobile' + i"
                      [disabled]="isReadOnlyOrder"
                      (focus)="onOrderNumericFocus('pers', i, getLinePersUnitCost(line), $event)"
                      (blur)="onOrderNumericBlurPers(i, line)"
                      class="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm tabular-nums">
                  </div>
              </article>
            </div>
          </section>
        </div>

        <div class="space-y-4">
          <div
            *ngIf="auth.canViewEconomics"
            class="bg-gray-900 text-white p-6 rounded-2xl shadow-xl sticky top-8">
            <h2 class="text-lg font-bold mb-4 text-teal-400">Resumen Económico</h2>

            <div class="space-y-3 mb-6 text-sm">
              <div class="flex justify-between">
                <span class="text-gray-400">Costo base</span>
                <span>{{ '$' + baseProductCost }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Personalización</span>
                <span>{{ '$' + customizationCostTotal }}</span>
              </div>
              <div class="border-t border-gray-800 pt-3 flex justify-between font-bold">
                <span>Costo total</span>
                <span>{{ '$' + totalCost }}</span>
              </div>
              <div *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" class="flex justify-between font-bold text-teal-300">
                <span>Precio venta</span>
                <span>{{ '$' + (order.total || 0) }}</span>
              </div>
            </div>

            <div *ngIf="auth.canViewAccountBalance" class="mb-4 p-3 bg-gray-800/60 rounded-xl border border-gray-700">
              <ng-container *ngIf="!isEditing && !seniaBloqueada">
                <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Seña recibida</label>
                <input
                  type="number"
                  [(ngModel)]="order.senia"
                  name="senia"
                  [disabled]="isReadOnlyOrder"
                  (ngModelChange)="calculateTotals()"
                  min="0"
                  class="w-full px-3 py-2 rounded-xl border border-gray-600 bg-gray-900/40 text-xl font-bold tabular-nums outline-none focus:ring-2 focus:ring-teal-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
                <p class="mt-1 text-xs text-gray-500">
                  Al guardar el pedido, se registra en caja con la fecha de hoy y queda bloqueada.
                </p>
              </ng-container>

              <ng-container *ngIf="seniaBloqueada || isEditing">
                <div class="flex items-center justify-between gap-2 mb-2">
                  <span class="text-xs font-bold text-gray-400 uppercase">Pagos del cliente</span>
                  <button
                    type="button"
                    (click)="openPaymentModal()"
                    *ngIf="auth.canAccessCash"
                    [disabled]="isCancelledOrder || !(order.saldo && order.saldo > 0)"
                    class="text-xs font-semibold text-teal-300 hover:text-teal-200 disabled:opacity-40 disabled:cursor-not-allowed">
                    + Registrar pago / cuota
                  </button>
                </div>
                <div class="space-y-1 mb-3 max-h-28 overflow-auto">
                  <div
                    *ngFor="let pago of order.pagos"
                    class="flex items-center justify-between gap-2 text-[11px] leading-tight text-gray-300">
                    <span class="truncate min-w-0">
                      {{ getPaymentLineLabel(pago) }}
                      <span class="text-gray-500">· {{ formatPaymentDate(pago.fecha) }}</span>
                      <span *ngIf="shouldShowPaymentNotas(pago)" class="text-gray-500">· {{ pago.notas }}</span>
                    </span>
                    <span class="text-xs font-semibold tabular-nums shrink-0">{{ '$' + pago.monto }}</span>
                  </div>
                </div>
                <div class="flex justify-between text-xs text-gray-400">
                  <span>Total pagado</span>
                  <span class="tabular-nums">{{ '$' + getTotalPagado() }}</span>
                </div>
              </ng-container>

              <div class="flex justify-between text-xs text-gray-400 mt-2 pt-2 border-t border-gray-700">
                <span>Saldo pendiente</span>
                <span class="font-semibold text-orange-300 tabular-nums">{{ '$' + (order.saldo || 0) }}</span>
              </div>
            </div>

            <div class="space-y-2 mb-6 text-sm">
              <div class="flex justify-between">
                <span class="text-gray-400">Ganancia est.</span>
                <span class="text-green-400 font-bold">{{ '$' + (order.gananciaEstimada || 0) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Margen</span>
                <span class="text-teal-400">{{ ((order.margen || 0) * 100).toFixed(1) }}%</span>
              </div>
            </div>

            <a
              *ngIf="isEditing && order.ventaId"
              [routerLink]="['/sales']"
              [queryParams]="{ ventaId: order.ventaId }"
              class="mb-3 inline-block text-xs font-semibold text-teal-300 hover:text-teal-200 hover:underline">
              Ver venta registrada
            </a>
            <ng-container *ngIf="!isReadOnlyOrder">
              <button
                *ngIf="canRegisterSale && auth.canCreateSales"
                type="button"
                (click)="registerSaleFromOrder()"
                class="w-full mb-3 py-3 rounded-xl border border-teal-500 bg-teal-50 text-teal-800 text-sm font-bold hover:bg-teal-100 transition-all flex items-center justify-center gap-2">
                <i-lucide name="truck" class="w-4 h-4"></i-lucide>
                Registrar venta / entrega
              </button>
              <ng-container *ngTemplateOutlet="orderActions"></ng-container>
            </ng-container>
            <div *ngIf="isCancelledOrder" class="space-y-3">
              <p class="text-sm text-gray-400">
                Este pedido quedó cerrado. Para seguir trabajando, creá un pedido nuevo.
              </p>
              <button
                type="button"
                routerLink="/orders/new"
                class="w-full rounded-xl bg-teal-500 py-3 text-sm font-bold text-gray-900 hover:bg-teal-400 transition-all">
                Nuevo pedido
              </button>
            </div>
          </div>

          <div
            *ngIf="!auth.canViewEconomics"
            class="bg-white border border-gray-100 p-6 rounded-2xl shadow-sm sticky top-8">
            <h2 class="text-lg font-bold mb-4 text-gray-900">Resumen</h2>
            <div *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" class="mb-4">
              <p class="text-xs font-bold text-gray-400 uppercase mb-1">Total venta</p>
              <p class="text-2xl font-bold text-teal-600">{{ '$' + (order.total || 0) }}</p>
            </div>
            <div *ngIf="auth.canViewAccountBalance" class="mb-4 p-3 rounded-xl border border-gray-100 bg-gray-50 space-y-2">
              <ng-container *ngIf="!isEditing && !seniaBloqueada">
                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Seña recibida</label>
                <input
                  type="number"
                  [(ngModel)]="order.senia"
                  name="seniaStaffSummary"
                  [disabled]="isReadOnlyOrder"
                  (ngModelChange)="calculateTotals()"
                  min="0"
                  class="w-full px-3 py-2 rounded-xl border border-gray-200 text-lg font-bold tabular-nums outline-none focus:ring-2 focus:ring-teal-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
                <p class="text-xs text-gray-500">
                  Al guardar el pedido, la seña queda registrada y bloqueada.
                </p>
              </ng-container>
              <ng-container *ngIf="seniaBloqueada || isEditing">
                <div class="flex justify-between text-sm">
                  <span class="text-gray-600">Total pagado</span>
                  <span class="font-semibold tabular-nums text-gray-900">{{ '$' + getTotalPagado() }}</span>
                </div>
                <div class="flex justify-between text-sm pt-2 border-t border-gray-200">
                  <span class="text-gray-600">Saldo pendiente</span>
                  <span class="font-semibold tabular-nums text-orange-600">{{ '$' + (order.saldo || 0) }}</span>
                </div>
              </ng-container>
            </div>
            <a
              *ngIf="isEditing && order.ventaId"
              [routerLink]="['/sales']"
              [queryParams]="{ ventaId: order.ventaId }"
              class="mb-3 inline-block text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline">
              Ver venta registrada
            </a>
            <ng-container *ngIf="!isReadOnlyOrder">
              <button
                *ngIf="canRegisterSale && auth.canCreateSales"
                type="button"
                (click)="registerSaleFromOrder()"
                class="w-full mb-3 py-3 rounded-xl border border-teal-500 bg-teal-50 text-teal-800 text-sm font-bold hover:bg-teal-100 transition-all flex items-center justify-center gap-2">
                <i-lucide name="truck" class="w-4 h-4"></i-lucide>
                Registrar venta / entrega
              </button>
              <ng-container *ngTemplateOutlet="orderActions"></ng-container>
            </ng-container>
            <div *ngIf="isCancelledOrder" class="space-y-3">
              <p class="text-sm text-gray-500">
                Pedido cancelado. Creá uno nuevo para continuar.
              </p>
              <button
                type="button"
                routerLink="/orders/new"
                class="w-full rounded-xl bg-teal-500 py-3 text-sm font-bold text-gray-900 hover:bg-teal-400 transition-all">
                Nuevo pedido
              </button>
            </div>
          </div>
        </div>
      </div>

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
        <div class="relative w-full max-w-md rounded-2xl border border-gray-100 bg-white shadow-2xl p-6">
          <h2 class="text-lg font-bold text-gray-900 mb-1">Registrar pago</h2>
          <p class="text-sm text-gray-500 mb-4">Se registra en caja con la fecha de hoy y queda asociado al cliente.</p>

          <div class="rounded-lg bg-gray-50 border border-gray-100 p-3 mb-4 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-gray-500">Saldo pendiente</span>
              <span class="font-bold text-orange-600 tabular-nums">{{ '$' + (order.saldo || 0) }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-gray-500">Fecha del pago</span>
              <span class="font-medium text-gray-900">{{ paymentFechaHoyLabel }}</span>
            </div>
          </div>

          <div class="flex gap-2 mb-4">
            <button
              type="button"
              (click)="setPaymentModo('total')"
              class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
              [class.border-primary]="paymentModo === 'total'"
              [class.bg-teal-50]="paymentModo === 'total'"
              [class.text-teal-800]="paymentModo === 'total'"
              [class.border-gray-200]="paymentModo !== 'total'"
              [class.text-gray-700]="paymentModo !== 'total'">
              Saldo total
            </button>
            <button
              type="button"
              (click)="setPaymentModo('parcial')"
              class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
              [class.border-primary]="paymentModo === 'parcial'"
              [class.bg-teal-50]="paymentModo === 'parcial'"
              [class.text-teal-800]="paymentModo === 'parcial'"
              [class.border-gray-200]="paymentModo !== 'parcial'"
              [class.text-gray-700]="paymentModo !== 'parcial'">
              Pago parcial
            </button>
          </div>

          <div class="mb-4 rounded-lg border border-teal-100 bg-teal-50 px-3 py-3 text-sm text-teal-800">
            <ng-container *ngIf="paymentModo === 'total'">
              Vas a registrar
              <strong class="tabular-nums">{{ '$' + (order.saldo || 0) }}</strong>
              y cerrar el saldo del pedido.
            </ng-container>
            <ng-container *ngIf="paymentModo === 'parcial'">
              <label class="block text-sm font-medium text-teal-900 mb-2">Monto a cobrar</label>
              <input
                type="number"
                [(ngModel)]="paymentMonto"
                name="paymentMonto"
                min="1"
                placeholder="Ej. 2000"
                class="w-full px-4 py-2 rounded-lg border border-teal-200 bg-white text-gray-900 text-sm outline-none focus:ring-2 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
              <p class="mt-2 text-xs text-teal-700">
                Saldo pendiente: {{ '$' + (order.saldo || 0) }}.
                Si ingresás más, se registra el excedente como pago extra en caja.
              </p>
            </ng-container>
          </div>

          <div class="flex justify-end gap-3 mt-6">
            <button
              type="button"
              (click)="closePaymentModal()"
              class="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="button"
              (click)="submitPayment()"
              class="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700">
              Registrar
            </button>
          </div>
        </div>
      </div>

      <div
        *ngIf="extraCostsModalIndex !== null && extraCostsModalLine"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="extra-costs-title">
        <button
          type="button"
          class="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px]"
          aria-label="Cerrar"
          (click)="cancelExtraCostsModal()">
        </button>

        <div class="relative w-full max-w-lg rounded-2xl border border-gray-100 bg-white shadow-2xl">
          <div class="px-6 py-5 border-b border-gray-100">
            <h2 id="extra-costs-title" class="text-lg font-bold text-gray-900">Costos de personalización</h2>
            <p class="text-sm text-gray-500 mt-1 truncate">{{ extraCostsModalLine.nombre }}</p>
          </div>

          <div class="px-6 py-4 max-h-[50vh] overflow-auto">
            <div *ngIf="orderExtraCostPresets.length > 0" class="mb-4">
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Precargados
              </p>
              <div class="space-y-2">
                <label
                  *ngFor="let preset of orderExtraCostPresets"
                  class="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    [checked]="isExtraCostPresetSelected(preset)"
                    (change)="toggleExtraCostPreset(preset, $any($event.target).checked)"
                    class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary">
                  <span class="flex-1 min-w-0 text-sm text-gray-900 truncate">{{ preset.nombre }}</span>
                  <span class="text-sm font-semibold text-gray-700 tabular-nums shrink-0">{{ '$' + preset.costo }}</span>
                </label>
              </div>
            </div>

            <p *ngIf="orderExtraCostPresets.length > 0" class="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Agregar otro concepto
            </p>

            <div class="flex gap-2 items-end mb-4">
              <div class="flex-1 min-w-0">
                <label class="block text-xs font-medium text-gray-500 mb-1">Concepto</label>
                <input
                  [(ngModel)]="extraCostInputNombre"
                  name="extraCostInputNombre"
                  placeholder="Ej. Estampado"
                  (keydown.enter)="confirmExtraCostInput()"
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
              </div>
              <div class="w-28">
                <label class="block text-xs font-medium text-gray-500 mb-1">Precio</label>
                <input
                  type="number"
                  [(ngModel)]="extraCostInputCosto"
                  name="extraCostInputCosto"
                  (keydown.enter)="confirmExtraCostInput()"
                  min="0"
                  placeholder="0"
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-right tabular-nums outline-none focus:ring-2 focus:ring-primary">
              </div>
              <button
                type="button"
                (click)="confirmExtraCostInput()"
                class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 shrink-0"
                title="Agregar a la lista">
                <i-lucide name="check" class="w-4 h-4"></i-lucide>
              </button>
            </div>

            <div *ngIf="extraCostsDraft.length === 0" class="text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">
              {{
                orderExtraCostPresets.length > 0
                  ? 'Tildá conceptos precargados o agregá uno nuevo.'
                  : 'Completá concepto y precio, y confirmá con el tilde.'
              }}
            </div>

            <div *ngIf="extraCostsDraft.length > 0" class="rounded-lg border border-gray-100 overflow-hidden">
              <div class="grid grid-cols-[minmax(0,1fr)_6.5rem_2.25rem] gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide items-center">
                <span>Concepto</span>
                <span class="text-right">Precio</span>
                <span></span>
              </div>

              <div
                *ngFor="let extra of extraCostsDraft; let j = index"
                class="grid grid-cols-[minmax(0,1fr)_6.5rem_2.25rem] gap-2 px-3 py-2 border-b border-gray-100 last:border-b-0 items-center"
                [class.bg-teal-50/40]="editingExtraCostIndex === j">
                <ng-container *ngIf="editingExtraCostIndex !== j">
                  <button
                    type="button"
                    (click)="startEditingExtraCost(j)"
                    class="min-w-0 text-left text-sm text-gray-900 truncate hover:text-teal-700">
                    {{ extra.nombre }}
                  </button>
                  <button
                    type="button"
                    (click)="startEditingExtraCost(j)"
                    class="text-right text-sm font-semibold text-gray-900 tabular-nums hover:text-teal-700">
                    {{ '$' + extra.costo }}
                  </button>
                </ng-container>

                <ng-container *ngIf="editingExtraCostIndex === j">
                  <input
                    [(ngModel)]="extra.nombre"
                    [name]="'editExtraNombre' + j"
                    (keydown.enter)="focusExtraCostPriceInput(j)"
                    class="w-full min-w-0 px-2 py-1.5 rounded-lg border border-teal-200 text-sm outline-none focus:ring-2 focus:ring-primary">
                  <input
                    type="number"
                    [(ngModel)]="extra.costo"
                    [name]="'editExtraCosto' + j"
                    [attr.data-extra-index]="j"
                    (keydown.enter)="finishEditingExtraCost(j)"
                    min="0"
                    class="w-full px-2 py-1.5 rounded-lg border border-teal-200 text-sm text-right tabular-nums outline-none focus:ring-2 focus:ring-primary">
                </ng-container>

                <button
                  type="button"
                  (click)="removeExtraCostFromDraft(j)"
                  class="inline-flex items-center justify-center w-8 h-8 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg justify-self-end"
                  title="Quitar costo">
                  ×
                </button>
              </div>
            </div>
          </div>

          <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
            <div class="flex items-center justify-between mb-4">
              <span class="text-sm text-gray-500">Total personalización</span>
              <span class="text-base font-bold text-gray-900 tabular-nums">
                {{ '$' + getExtraCostsDraftTotal() }}
              </span>
            </div>
            <div class="flex justify-end">
              <button
                type="button"
                (click)="acceptExtraCostsModal()"
                class="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700">
                Listo
              </button>
            </div>
          </div>
        </div>
      </div>
      </ng-container>

      <ng-template #orderPageLoading>
        <div class="py-16 flex flex-col items-center justify-center text-gray-400">
          <div class="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mb-3"></div>
          <p class="text-sm">Cargando pedido...</p>
        </div>
      </ng-template>
    </div>

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

    <ng-template #orderActions>
      <button
        *ngIf="showSaveDraftButton"
        type="button"
        (click)="saveDraft()"
        [disabled]="orderActionsLocked"
        class="w-full mb-2 py-2.5 rounded-xl border text-sm font-medium transition-all disabled:cursor-not-allowed"
        [class.border-gray-600]="orderSaveState !== 'success' || orderSaveAction !== 'draft'"
        [class.text-gray-200]="orderSaveState !== 'success' || orderSaveAction !== 'draft'"
        [class.hover:bg-gray-800]="!orderActionsLocked && auth.canViewEconomics"
        [class.!border-gray-200]="!auth.canViewEconomics && orderSaveState !== 'success'"
        [class.!text-gray-700]="!auth.canViewEconomics && orderSaveState !== 'success'"
        [class.hover:!bg-gray-50]="!orderActionsLocked && !auth.canViewEconomics"
        [class.border-green-300]="orderSaveState === 'success' && orderSaveAction === 'draft'"
        [class.bg-green-50]="orderSaveState === 'success' && orderSaveAction === 'draft'"
        [class.text-green-800]="orderSaveState === 'success' && orderSaveAction === 'draft'"
        [class.opacity-60]="orderActionsLocked && !(orderSaveState === 'success' && orderSaveAction === 'draft')">
        {{ draftButtonLabel }}
      </button>
      <button
        type="button"
        (click)="submitOrder()"
        [disabled]="orderActionsLocked"
        class="w-full font-bold py-3 rounded-xl transition-all disabled:cursor-not-allowed"
        [class.bg-teal-500]="orderSaveState !== 'success' || orderSaveAction !== 'submit'"
        [class.text-gray-900]="orderSaveState !== 'success' || orderSaveAction !== 'submit'"
        [class.hover:bg-teal-400]="!orderActionsLocked"
        [class.bg-green-600]="orderSaveState === 'success' && orderSaveAction === 'submit'"
        [class.text-white]="orderSaveState === 'success' && orderSaveAction === 'submit'"
        [class.opacity-60]="orderActionsLocked && !(orderSaveState === 'success' && orderSaveAction === 'submit')">
        {{ primaryButtonLabel }}
      </button>
    </ng-template>

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
            Al pasar a «{{ stockDiscountPreview.nextEstadoLabel }}» se descontará stock físico del depósito.
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
            Confirmar y cambiar estado
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
  private clientService = inject(ClientService);
  private stockService = inject(StockService);
  private orderService = inject(OrderService);
  private orderPrintService = inject(OrderPrintService);
  private catalogConfigService = inject(CatalogConfigService);
  private priceCatalogService = inject(PriceCatalogService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  readonly auth = inject(AuthService);
  readonly permissions = PERMISSIONS;

  readonly getOrderStatusBadgeClass = getOrderStatusBadgeClass;
  get orderStatusOptions() {
    return getOrderWorkflowStatusOptions(this.appConfig.pedidos);
  }
  readonly controlsStockForCatalogItem = (item: StockItem) =>
    itemControlsStock(item, this.appConfig.productos?.categoriasSinStock ?? []);

  clients: Client[] = [];
  pendingClientName = '';
  creatingClient = false;
  clientModalOpen = false;
  clientModalPrefillNombre = '';
  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  editingOrderId: string | null = null;
  orderPageReady = true;
  private loadedOrderSnapshot: Order | null = null;
  isDraftOrder = false;
  productSearch = '';
  productSearchResults: StockItem[] = [];
  productSearchOpen = false;
  searchingProducts = false;
  orderLines: OrderLineItem[] = [];
  priceCatalogEntries: PriceCatalogEntry[] = [];
  extraCostsModalIndex: number | null = null;
  extraCostsDraft: OrderLineExtraCost[] = [];
  extraCostInputNombre = '';
  extraCostInputCosto: number | null = null;
  editingExtraCostIndex: number | null = null;
  paymentModalOpen = false;
  paymentModo: 'total' | 'parcial' = 'total';
  paymentMonto: number | null = null;
  savingEstado = false;
  orderSaveState: 'idle' | 'saving' | 'success' = 'idle';
  orderSaveAction: 'draft' | 'submit' | null = null;
  private orderSaveFeedbackTimeout?: ReturnType<typeof setTimeout>;
  private editingNumericFields = new Map<string, string>();
  private savedOrderEstado = '';
  private orderFormLocked = false;
  stockPrepOpen = false;
  stockDiscountDialogOpen = false;
  stockDiscountPreview: OrderStockDiscountPreview | null = null;
  stockDiscountSelectedScope: OrderPhysicalStockScope = 'solo_reservado';
  private pendingEstadoForStockDiscount: string | null = null;
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
    const next = normalizeOrderStatus(this.orderEstado);
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
    return `Si pasás a «${this.getOrderStatusLabelFor(next)}», por defecto se descontará: ${getOrderPhysicalStockScopeLabel(scope)}.`;
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
    if (this.consumingPendingStock || this.savingEstado) return false;
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

  private productSearchTimeout?: ReturnType<typeof setTimeout>;

  order: Partial<Order> = this.emptyOrder();

  baseProductCost = 0;
  customizationCostTotal = 0;
  totalCost = 0;

  get isEditing(): boolean {
    return !!this.editingOrderId;
  }

  get isDraft(): boolean {
    return this.isDraftOrder;
  }

  get showSaveDraftButton(): boolean {
    return !this.isEditing;
  }

  get primaryOrderActionLabel(): string {
    return this.isEditing && !this.isDraftOrder ? 'Guardar' : 'Confirmar pedido';
  }

  get orderActionsLocked(): boolean {
    return this.orderSaveState !== 'idle';
  }

  get draftButtonLabel(): string {
    if (this.orderSaveState === 'saving' && this.orderSaveAction === 'draft') return 'Guardando...';
    if (this.orderSaveState === 'success' && this.orderSaveAction === 'draft') return 'Borrador guardado';
    return 'Guardar borrador';
  }

  get primaryButtonLabel(): string {
    if (this.orderSaveState === 'saving' && this.orderSaveAction === 'submit') return 'Guardando...';
    if (this.orderSaveState === 'success' && this.orderSaveAction === 'submit') {
      return this.isEditing && !this.isDraftOrder ? 'Guardado' : 'Pedido confirmado';
    }
    return this.primaryOrderActionLabel;
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

  get orderEstado(): string {
    const normalized = normalizeOrderStatus(this.order.estado);
    return normalized === 'otro' ? 'pendiente' : normalized;
  }

  set orderEstado(value: string) {
    if (this.orderFormLocked) return;
    if (normalizeOrderStatus(this.savedOrderEstado) === 'cancelado') return;
    this.order.estado = value;
  }

  get orderExtraCostPresets(): OrderExtraCostPreset[] {
    return this.appConfig.pedidos?.costosExtraPredeterminados ?? [];
  }

  isExtraCostPresetSelected(preset: OrderExtraCostPreset): boolean {
    const key = preset.nombre.trim().toLowerCase();
    return this.extraCostsDraft.some((extra) => extra.nombre.trim().toLowerCase() === key);
  }

  toggleExtraCostPreset(preset: OrderExtraCostPreset, selected: boolean) {
    const key = preset.nombre.trim().toLowerCase();
    if (selected) {
      if (!this.isExtraCostPresetSelected(preset)) {
        this.extraCostsDraft.push({ nombre: preset.nombre, costo: preset.costo });
      }
    } else {
      this.extraCostsDraft = this.extraCostsDraft.filter(
        (extra) => extra.nombre.trim().toLowerCase() !== key
      );
    }
    this.editingExtraCostIndex = null;
  }

  readonly getOrderStockStatusLabel = getOrderStockStatusLabel;
  readonly getOrderStockStatusBadgeClass = getOrderStockStatusBadgeClass;

  onOrderEstadoChange(newEstado: string) {
    if (!this.editingOrderId || this.savingEstado || this.orderFormLocked) return;
    if (normalizeOrderStatus(this.savedOrderEstado) === 'cancelado') return;

    const previous = normalizeOrderStatus(this.savedOrderEstado || this.order.estado);
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
      this.order.estado = this.savedOrderEstado || previous;
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
          message: `Al volver a «${nextLabel}», se devolverá el stock al depósito (entrada de stock). ¿Continuar?`,
          confirmLabel: 'Sí, retroceder',
          cancelLabel: 'Cancelar',
          variant: 'danger',
        })
        .subscribe((confirmed) => {
          if (confirmed) {
            this.commitOrderEstadoChange(newEstado);
          } else {
            this.order.estado = this.savedOrderEstado || previous;
          }
        });
      return;
    }

    if (isOrderDeliveryEstado(next)) {
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
      this.commitOrderEstadoChange(newEstado);
      return;
    }

    this.orderService.getStockDiscountPreview(this.editingOrderId, newEstado).subscribe({
      next: (preview) => {
        if (preview.blocked) {
          this.order.estado = this.savedOrderEstado || previous;
          this.dialogService.alert({
            title: 'Stock insuficiente',
            message: preview.blockReason ?? 'No podés pasar a este estado todavía.',
          });
          return;
        }

        if (!preview.willConsume) {
          this.commitOrderEstadoChange(newEstado);
          return;
        }

        this.stockDiscountPreview = preview;
        this.stockDiscountSelectedScope = preview.defaultScope;
        this.pendingEstadoForStockDiscount = newEstado;
        this.stockDiscountDialogOpen = true;
      },
      error: () => {
        this.commitOrderEstadoChange(newEstado);
      },
    });
  }

  confirmStockDiscountDialog() {
    const newEstado = this.pendingEstadoForStockDiscount;
    if (!newEstado || !this.editingOrderId) return;
    this.stockDiscountDialogOpen = false;
    this.stockDiscountPreview = null;
    this.pendingEstadoForStockDiscount = null;
    this.commitOrderEstadoChange(newEstado, this.stockDiscountSelectedScope);
  }

  cancelStockDiscountDialog() {
    this.stockDiscountDialogOpen = false;
    this.stockDiscountPreview = null;
    this.pendingEstadoForStockDiscount = null;
    this.order.estado = this.savedOrderEstado || normalizeOrderStatus(this.order.estado);
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
          this.commitOrderEstadoChange(nextEstado);
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
          this.commitOrderEstadoChange(nextEstado);
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

  private commitOrderEstadoChange(newEstado: string, descuentoFisicoAlcance?: OrderPhysicalStockScope) {
    if (!this.editingOrderId) return;

    this.savingEstado = true;
    this.orderService
      .updateOrderStatus(this.editingOrderId, newEstado, descuentoFisicoAlcance ? { descuentoFisicoAlcance } : undefined)
      .subscribe({
      next: (result) => {
        this.applyOrderUpdateResult(result);
        this.savedOrderEstado = newEstado;
        this.savingEstado = false;
      },
      error: (err: HttpErrorResponse) => {
        this.savingEstado = false;
        this.order.estado = this.savedOrderEstado || normalizeOrderStatus(this.order.estado);
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : 'No se pudo actualizar el estado del pedido.',
        });
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
    return this.toDateInputValue(this.order.fechaEntrega);
  }

  get clientOptions() {
    return this.clients
      .filter((client) => client.id)
      .map((client) => ({
        value: client.id!,
        label: client.nombre,
      }));
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

  openProductSearch() {
    this.productSearchOpen = true;
    this.enrichOrderLinesWithStock({ debounceMs: 250 });
  }

  openOrderLineProduct(line: OrderLineItem, event: Event) {
    event.stopPropagation();
    const stockItemId = String(line.stockItemId ?? '').trim();
    if (!stockItemId) return;
    this.router.navigate(['/stock', stockItemId, 'edit']);
  }

  ngOnInit() {
    this.catalogConfigService.getAppConfig().subscribe((config) => {
      this.appConfig = config;
    });

    if (this.auth.canViewPriceCatalog) {
      this.priceCatalogService.getEntries().subscribe({
        next: (entries) => {
          this.priceCatalogEntries = entries.filter((entry) => entry.activo !== false);
          this.refreshOrderLineCatalogLinks();
        },
      });
    }

    this.refreshClients();

    this.route.paramMap.subscribe(() => {
      const duplicateId = this.route.snapshot.queryParamMap.get('duplicate');
      const orderId = this.route.snapshot.paramMap.get('id');

      if (orderId) {
        this.startEditingOrder(orderId);
        return;
      }

      this.editingOrderId = null;
      this.loadedOrderSnapshot = null;
      this.orderPageReady = true;

      if (duplicateId) {
        this.loadOrderForDuplicate(duplicateId);
      } else {
        this.resetForm();
      }
    });
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
    const preview = this.readOrderPreview(orderId);

    if (preview) {
      if (!this.auth.canViewOrder(preview.estado)) {
        this.dialogService.alert({
          title: 'Sin acceso',
          message: 'No tenés permiso para ver este pedido.',
        });
        this.router.navigate(['/orders']);
        return;
      }
      this.applyLoadedOrder(preview);
      this.orderPageReady = true;
    } else {
      this.orderPageReady = false;
      this.order = this.emptyOrder();
      this.orderLines = [];
      this.isDraftOrder = false;
      this.loadedOrderSnapshot = null;
    }

    this.loadOrder(orderId);
  }

  private refreshClients() {
    this.clientService.getClients().subscribe((clients) => {
      this.clients = clients;
    });
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
    const nombre = this.pendingClientName.trim();
    this.router.navigate(['/clients/new'], {
      queryParams: {
        ...(nombre ? { nombre } : {}),
        returnTo: 'orders',
        ...(this.editingOrderId ? { orderId: this.editingOrderId } : {}),
      },
    });
  }

  closeClientModal() {
    this.clientModalOpen = false;
    this.clientModalPrefillNombre = '';
  }

  onClientSavedFromModal(event: ClientFormSaveEvent) {
    this.order.clienteId = event.id;
    this.pendingClientName = event.client.nombre ?? '';
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

  onFechaEntregaChange(value: string) {
    if (!value) {
      this.order.fechaEntrega = new Date().toISOString();
      return;
    }
    this.order.fechaEntrega = new Date(`${value}T12:00:00`).toISOString();
  }

  private toDateInputValue(value?: string): string {
    if (!value) return this.toDateInputValue(new Date().toISOString());
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  onProductSearchChange() {
    window.clearTimeout(this.productSearchTimeout);

    const query = this.productSearch.trim();
    if (query.length < 2) {
      this.productSearchResults = [];
      this.searchingProducts = false;
      return;
    }

    this.searchingProducts = true;
    this.productSearchTimeout = window.setTimeout(() => {
      this.stockService.searchStock(query).subscribe({
        next: (items) => {
          this.productSearchResults = items;
          this.searchingProducts = false;
        },
        error: () => {
          this.productSearchResults = [];
          this.searchingProducts = false;
        },
      });
    }, 300);
  }

  onProductSearchBlur() {
    window.setTimeout(() => {
      this.productSearchOpen = false;
    }, 150);
  }

  onProductResultClick(item: StockItem, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.ensureEditable('agregar productos')) return;
    if (!item.id || this.isProductAdded(item.id)) {
      this.closeProductSearch();
      return;
    }
    this.addProductFromSearch(item);
  }

  addProductFromSearch(item: StockItem) {
    this.addProduct(item);
    this.closeProductSearch();
  }

  private closeProductSearch() {
    this.productSearchOpen = false;
    this.productSearch = '';
    this.productSearchResults = [];
    window.clearTimeout(this.productSearchTimeout);
    this.searchingProducts = false;
  }

  isProductAdded(stockItemId?: string): boolean {
    if (!stockItemId) return false;
    return this.orderLines.some((line) => line.stockItemId === stockItemId);
  }

  addProduct(item: StockItem) {
    if (!item.id || this.isProductAdded(item.id)) return;

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
    this.calculateTotals();
  }

  getCatalogPriceOptions(line: OrderLineItem): Array<{ label: string; price: number }> {
    const entry = this.getCatalogEntry(line);
    if (!entry) return [];

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
    const line = this.orderLines[lineIndex];
    if (!line) return;

    this.extraCostsDraft = (line.costosExtra ?? []).map((extra) => ({
      nombre: extra.nombre,
      costo: Number(extra.costo) || 0,
    }));
    this.extraCostInputNombre = '';
    this.extraCostInputCosto = null;
    this.editingExtraCostIndex = null;
    this.extraCostsModalIndex = lineIndex;
  }

  cancelExtraCostsModal() {
    this.extraCostsModalIndex = null;
    this.extraCostsDraft = [];
    this.extraCostInputNombre = '';
    this.extraCostInputCosto = null;
    this.editingExtraCostIndex = null;
  }

  acceptExtraCostsModal() {
    if (this.editingExtraCostIndex !== null && !this.finishEditingExtraCost(this.editingExtraCostIndex)) {
      return;
    }

    const line = this.extraCostsModalLine;
    if (!line) return;

    line.costosExtra = this.extraCostsDraft.map((extra) => ({
      nombre: extra.nombre,
      costo: Number(extra.costo) || 0,
    }));
    this.cancelExtraCostsModal();
    this.calculateTotals();
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

    if (this.extraCostInputCosto === null || this.extraCostInputCosto === undefined || Number.isNaN(costo) || costo < 0) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un precio válido.',
      });
      return;
    }

    this.extraCostsDraft.push({ nombre, costo });
    this.extraCostInputNombre = '';
    this.extraCostInputCosto = null;
    this.editingExtraCostIndex = null;
  }

  startEditingExtraCost(index: number) {
    this.editingExtraCostIndex = index;
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(`input[name="editExtraNombre${index}"]`);
      input?.focus();
      input?.select();
    });
  }

  focusExtraCostPriceInput(index: number) {
    const input = document.querySelector<HTMLInputElement>(`input[data-extra-index="${index}"]`);
    input?.focus();
    input?.select();
  }

  finishEditingExtraCost(index: number): boolean {
    const extra = this.extraCostsDraft[index];
    if (!extra) return true;

    const nombre = extra.nombre.trim();
    const costo = Number(extra.costo);

    if (!nombre) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'El concepto no puede quedar vacío.',
      });
      return false;
    }

    if (Number.isNaN(costo) || costo < 0) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un precio válido.',
      });
      return false;
    }

    extra.nombre = nombre;
    extra.costo = costo;
    this.editingExtraCostIndex = null;
    return true;
  }

  removeExtraCostFromDraft(extraIndex: number) {
    if (this.editingExtraCostIndex === extraIndex) {
      this.editingExtraCostIndex = null;
    } else if (this.editingExtraCostIndex !== null && this.editingExtraCostIndex > extraIndex) {
      this.editingExtraCostIndex--;
    }
    this.extraCostsDraft.splice(extraIndex, 1);
  }

  getExtraCostsDraftTotal(): number {
    return this.extraCostsDraft.reduce((acc, extra) => acc + (Number(extra.costo) || 0), 0);
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

  removeLine(index: number) {
    if (!this.ensureEditable('quitar productos')) return;
    if (this.extraCostsModalIndex === index) {
      this.cancelExtraCostsModal();
    } else if (this.extraCostsModalIndex !== null && this.extraCostsModalIndex > index) {
      this.extraCostsModalIndex--;
    }
    this.clearOrderNumericDraftsForIndex(index);
    this.orderLines.splice(index, 1);
    this.calculateTotals();
  }

  private orderNumericKey(field: string, index: number): string {
    return `${field}:${index}`;
  }

  orderNumericModel(field: string, index: number, value: number | null | undefined): string {
    const key = this.orderNumericKey(field, index);
    if (this.editingNumericFields.has(key)) {
      return this.editingNumericFields.get(key)!;
    }
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : '0';
  }

  onOrderNumericFocus(
    field: string,
    index: number,
    value: number | null | undefined,
    event: FocusEvent
  ): void {
    const key = this.orderNumericKey(field, index);
    const num = Number(value) || 0;
    const input = event.target as HTMLInputElement;

    if (num === 0) {
      this.editingNumericFields.set(key, '');
      return;
    }

    this.editingNumericFields.set(key, String(num));
    window.setTimeout(() => input.select());
  }

  onOrderNumericInput(field: string, index: number, raw: string): void {
    this.editingNumericFields.set(this.orderNumericKey(field, index), raw);
  }

  private parseOrderNumericInput(raw: string, fallback: number): number {
    const normalized = String(raw ?? '').trim().replace(',', '.');
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private clearOrderNumericDraft(field: string, index: number): void {
    this.editingNumericFields.delete(this.orderNumericKey(field, index));
  }

  private clearOrderNumericDraftsForIndex(index: number): void {
    for (const field of ['cantidad', 'pers', 'venta']) {
      this.clearOrderNumericDraft(field, index);
    }
  }

  onOrderNumericBlurCantidad(index: number, line: OrderLineItem): void {
    const key = this.orderNumericKey('cantidad', index);
    const raw = this.editingNumericFields.get(key) ?? String(line.cantidad ?? 1);
    this.clearOrderNumericDraft('cantidad', index);
    const parsed = Math.floor(this.parseOrderNumericInput(raw, 1));
    line.cantidad = parsed >= 1 ? parsed : 1;
    this.calculateTotals();
  }

  onOrderNumericBlurPers(index: number, line: OrderLineItem): void {
    const key = this.orderNumericKey('pers', index);
    const raw = this.editingNumericFields.get(key) ?? String(this.getLinePersUnitCost(line));
    this.clearOrderNumericDraft('pers', index);
    this.setLinePersUnitCost(line, this.parseOrderNumericInput(raw, 0));
  }

  onOrderNumericBlurVenta(index: number, line: OrderLineItem): void {
    const key = this.orderNumericKey('venta', index);
    const raw = this.editingNumericFields.get(key) ?? String(line.precioVenta ?? 0);
    this.clearOrderNumericDraft('venta', index);
    line.precioVenta = Math.max(0, this.parseOrderNumericInput(raw, 0));
    this.calculateTotals();
  }

  onLineQuantityChange(line: OrderLineItem) {
    if (!line.cantidad || line.cantidad < 1) {
      line.cantidad = 1;
    }
    this.calculateTotals();
  }

  calculateTotals() {
    this.baseProductCost = this.orderLines.reduce(
      (acc, line) => acc + (Number(line.cantidad) || 0) * (Number(line.costoUnitario) || 0),
      0
    );
    this.customizationCostTotal = this.orderLines.reduce(
      (acc, line) => acc + this.getLinePersTotal(line),
      0
    );
    this.totalCost = this.baseProductCost + this.customizationCostTotal;

    this.order.total = this.orderLines.reduce(
      (acc, line) => acc + this.getLineSaleTotal(line),
      0
    );
    this.order.costoReal = this.totalCost;
    this.order.gananciaEstimada = (this.order.total || 0) - this.totalCost;
    this.order.margen = this.order.total ? this.order.gananciaEstimada! / this.order.total : 0;

    const balance = resolveOrderBalance({
      total: this.order.total,
      senia: this.order.senia,
      totalPagado: this.order.totalPagado,
      pagos: this.order.pagos,
      seniaBloqueada: this.order.seniaBloqueada,
      movimientoSeniaId: this.order.movimientoSeniaId,
    });
    this.order.saldo = balance.saldo;
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
      this.paymentMonto = Number(this.order.saldo) || 0;
    } else {
      this.paymentMonto = null;
    }
  }

  openPaymentModal() {
    if (!this.auth.canAccessCash) return;
    if (!this.ensureEditable('registrar pagos')) return;
    if (!this.editingOrderId || !(this.order.saldo && this.order.saldo > 0)) return;
    this.paymentModo = 'total';
    this.paymentMonto = Number(this.order.saldo) || 0;
    this.paymentModalOpen = true;
  }

  closePaymentModal() {
    this.paymentModalOpen = false;
  }

  submitPayment() {
    if (!this.ensureEditable('registrar pagos')) return;
    if (!this.editingOrderId) return;

    const saldo = Number(this.order.saldo) || 0;
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
    if (!this.editingOrderId) return;

    this.orderService
      .addOrderPayment(this.editingOrderId, {
        monto,
        tipo: 'pago',
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
          this.closePaymentModal();
        },
        error: (err: HttpErrorResponse) =>
          this.dialogService.alert({
            title: 'Error',
            message:
              typeof err.error?.error === 'string'
                ? err.error.error
                : 'No se pudo registrar el pago.',
          }),
      });
  }

  ngOnDestroy() {
    window.clearTimeout(this.orderSaveFeedbackTimeout);
    window.clearTimeout(this.stockEnrichTimer);
    window.clearTimeout(this.productSearchTimeout);
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

    const estado =
      !this.isEditing || this.isDraftOrder ? 'pendiente' : this.order.estado || 'pendiente';

    if (!this.beginOrderSave('submit')) return;
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
      const missingPrice = this.orderLines.filter((line) => !Number(line.precioVenta));
      if (missingPrice.length > 0) {
        this.dialogService.alert({
          title: 'Campo requerido',
          message: 'Ingresá el precio de venta de cada producto antes de confirmar el pedido.',
        });
        return false;
      }
    }

    return true;
  }

  private beginOrderSave(action: 'draft' | 'submit'): boolean {
    if (this.orderSaveState !== 'idle') return false;
    this.orderSaveAction = action;
    this.orderSaveState = 'saving';
    return true;
  }

  private resetOrderSaveState() {
    window.clearTimeout(this.orderSaveFeedbackTimeout);
    this.orderSaveState = 'idle';
    this.orderSaveAction = null;
  }

  private finishOrderSaveSuccess() {
    this.orderSaveState = 'success';
    window.clearTimeout(this.orderSaveFeedbackTimeout);
    this.orderSaveFeedbackTimeout = window.setTimeout(() => {
      this.resetOrderSaveState();
    }, 2500);
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
    this.calculateTotals();

    const firstLine = this.orderLines[0];
    const payload: Partial<Order> = {
      clienteId: this.order.clienteId!,
      descripcion: this.order.descripcion?.trim() ?? '',
      estado,
      fechaEntrega: this.order.fechaEntrega || new Date().toISOString(),
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

    const request = this.editingOrderId
      ? this.orderService.updateOrder(this.editingOrderId, payload)
      : this.orderService.createOrder(payload as Order);

    request.subscribe({
      next: (result) => {
        const createdId = 'id' in result ? result.id : undefined;
        if (createdId && !this.editingOrderId) {
          this.editingOrderId = createdId;
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
        this.resetOrderSaveState();
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : 'No se pudo guardar el pedido. Reiniciá el dev server si cambiaste la API.',
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
    this.orderService.getOrder(orderId).subscribe({
      next: (order) => {
        if (!this.auth.canViewOrder(order.estado)) {
          this.dialogService.alert({
            title: 'Sin acceso',
            message: 'No tenés permiso para ver este pedido.',
          });
          this.router.navigate(['/orders']);
          return;
        }

        this.applyLoadedOrder(order);
        this.orderPageReady = true;
      },
      error: () => {
        this.orderPageReady = true;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el pedido.',
        });
        this.router.navigate(['/orders']);
      },
    });
  }

  private applyLoadedOrder(order: Order) {
    const normalizedStatus = normalizeOrderStatus(order.estado);
    this.isDraftOrder = normalizedStatus === 'borrador';
    this.loadedOrderSnapshot = order;

    this.order = {
      clienteId: order.clienteId ?? '',
      descripcion: order.descripcion ?? '',
      estado: order.estado ?? 'pendiente',
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

    if (order.items?.length) {
      this.orderLines = order.items.map((line) => this.normalizeOrderLine(line));
      this.enrichOrderLinesWithStock();
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
    if (line.costosExtra?.length) {
      return {
        ...line,
        costosExtra: line.costosExtra.map((extra) => ({
          nombre: extra.nombre ?? '',
          costo: Number(extra.costo) || 0,
        })),
      };
    }

    const legacyTotal = Number(line.costoPersonalizacion) || 0;
    return {
      ...line,
      costosExtra: legacyTotal > 0 ? [{ nombre: 'Personalización', costo: legacyTotal }] : [],
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
    const ids = [...new Set(this.orderLines.map((line) => line.stockItemId).filter(Boolean))];
    if (!ids.length) return;

    const requestId = ++this.stockEnrichRequestId;
    for (const stockItemId of ids) {
      this.stockService.getItem(stockItemId).subscribe({
        next: (stockItem) => {
          if (requestId !== this.stockEnrichRequestId) return;

          for (const line of this.orderLines) {
            if (line.stockItemId !== stockItemId) continue;
            line.controlaStock = stockItem.controlaStock !== false;
            line.permitirStockNegativo = stockItem.permitirStockNegativo !== false;
            line.stockDisponible = getStockDisponible(stockItem);
            const costo = Number(line.costoUnitario) || Number(stockItem.costo) || 0;
            line.precioSugerido = Number(stockItem.precioSugerido) || costo * 2 || undefined;
            this.attachCatalogToLine(line, stockItem);
          }
        },
      });
    }
  }

  private refreshOrderLineCatalogLinks() {
    if (!this.priceCatalogEntries.length) return;

    const ids = [...new Set(this.orderLines.map((line) => line.stockItemId).filter(Boolean))];
    for (const stockItemId of ids) {
      this.stockService.getItem(stockItemId).subscribe({
        next: (stockItem) => {
          for (const line of this.orderLines) {
            if (line.stockItemId !== stockItemId) continue;
            this.attachCatalogToLine(line, stockItem);
          }
        },
      });
    }
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

  private emptyOrder(): Partial<Order> {
    return {
      clienteId: '',
      descripcion: '',
      estado: 'pendiente',
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

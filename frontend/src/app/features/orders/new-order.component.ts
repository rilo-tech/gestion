import { Component, HostListener, inject, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ClientService, Client } from '../../core/services/client.service';
import { StockService, StockItem, itemControlsStock } from '../../core/services/stock.service';
import { OrderLineItem, OrderLineExtraCost, OrderPayment, OrderService, Order } from '../../core/services/order.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { PERMISSIONS } from '../../core/constants/permissions';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import {
  getOrderStatusBadgeClass,
  getOrderStatusLabel,
  normalizeOrderStatus,
  ORDER_WORKFLOW_STATUS_OPTIONS,
  canRegisterSaleFromOrder,
} from '../../core/constants/order-status';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-new-order',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, SearchableSelectComponent, RouterLink, HasPermissionDirective],
  template: `
    <div class="p-8 pb-24">
      <div class="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">
            {{ isCancelledOrder ? 'Pedido cancelado' : (isEditing ? 'Editar Pedido' : 'Nuevo Pedido Personalizado') }}
          </h1>
          <p class="text-sm text-gray-500">
            <ng-container *ngIf="isCancelledOrder">
              Solo lectura. Este pedido no se puede modificar; creá uno nuevo si necesitás continuar.
            </ng-container>
            <ng-container *ngIf="!isCancelledOrder">
              Cliente, productos y precios en un solo flujo compacto.
            </ng-container>
          </p>
        </div>
        <button
          routerLink="/orders"
          class="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900">
          <i-lucide name="arrow-left" class="w-4 h-4"></i-lucide>
          Volver a pedidos
        </button>
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
              <label class="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
              <app-searchable-select
                [(ngModel)]="order.clienteId"
                name="clienteId"
                [labeledOptions]="clientOptions"
                [disabled]="isCancelledOrder"
                placeholder="Buscar cliente..."
                listHint=""
                emptyOptionsMessage="No hay clientes cargados.">
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
                  [disabled]="isCancelledOrder"
                  class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 disabled:text-gray-500">
              </div>
              <div *ngIf="isEditing">
                <label class="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                <select
                  *ngIf="!isCancelledOrder"
                  [(ngModel)]="orderEstado"
                  name="estado"
                  class="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary"
                  [ngClass]="getOrderStatusBadgeClass(orderEstado)">
                  <option *ngFor="let option of orderStatusOptions" [value]="option.value">
                    {{ option.label }}
                  </option>
                </select>
                <span
                  *ngIf="isCancelledOrder"
                  class="inline-flex px-3 py-2 rounded-lg text-sm font-semibold"
                  [ngClass]="getOrderStatusBadgeClass(order.estado)">
                  {{ getOrderStatusLabel(order.estado) }}
                </span>
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Descripción del trabajo</label>
              <textarea
                [(ngModel)]="order.descripcion"
                name="descripcion"
                rows="3"
                [disabled]="isCancelledOrder"
                placeholder="Ej. 13 canguros — seña recibida, faltan talles y diseños"
                class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 disabled:text-gray-500">
              </textarea>
            </div>
          </section>

          <section *ngIf="!isCancelledOrder" class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-base font-bold mb-3 flex items-center gap-2">
              <i-lucide name="package" class="w-4 h-4 text-teal-600"></i-lucide>
              Agregar productos
            </h2>

            <div class="relative">
              <input
                [(ngModel)]="productSearch"
                name="productSearch"
                (ngModelChange)="onProductSearchChange()"
                (focus)="productSearchOpen = true"
                (blur)="onProductSearchBlur()"
                placeholder="Buscar producto por nombre..."
                class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">

              <div
                *ngIf="productSearchOpen && productSearch.trim().length >= 2"
                class="absolute z-20 mt-1 w-full max-h-48 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg divide-y divide-gray-50">
                <p *ngIf="searchingProducts" class="px-3 py-3 text-sm text-gray-400 text-center">
                  Buscando...
                </p>
                <div
                  *ngFor="let item of productSearchResults"
                  (mousedown)="onProductResultClick(item, $event)"
                  class="flex items-center justify-between gap-3 px-3 py-2 transition-colors"
                  [class.hover:bg-teal-50]="!isProductAdded(item.id)"
                  [class.cursor-pointer]="!isProductAdded(item.id)"
                  [class.bg-gray-50]="isProductAdded(item.id)">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-gray-900 truncate">{{ item.nombre }}</p>
                    <p *appHasPermission="permissions.ORDERS_VIEW_ECONOMICS" class="text-xs text-gray-400">
                      Costo base: {{ '$' + (item.costo || 0) }}
                      · Stock: {{ item.stockActual || 0 }} u.
                      <span *ngIf="!itemControlsStock(item)"> · sin control</span>
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

            <p class="mt-2 text-xs text-gray-400">
              Escribí al menos 2 caracteres y hacé clic en un producto para agregarlo abajo.
            </p>
          </section>

          <section class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-base font-bold mb-3">Productos del pedido</h2>

            <div *ngIf="orderLines.length === 0" class="py-6 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">
              Buscá productos arriba y hacé clic en uno para agregarlo acá.
            </div>

            <div *ngIf="orderLines.length > 0" class="rounded-lg border border-gray-100 overflow-hidden">
              <table class="hidden md:table w-full table-fixed">
                <colgroup>
                  <col />
                  <col class="w-[4.5rem]" />
                  <col *appHasPermission="permissions.ORDERS_VIEW_ECONOMICS" class="w-[5.5rem]" />
                  <col *appHasPermission="permissions.ORDERS_VIEW_ECONOMICS" class="w-[5.5rem]" />
                  <col *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" class="w-[6.5rem]" />
                  <col class="w-[2.75rem]" />
                </colgroup>
                <thead class="bg-gray-50 border-b border-gray-100">
                  <tr class="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    <th scope="col" class="px-3 py-2 text-left font-medium">Producto</th>
                    <th scope="col" class="px-2 py-2 text-center font-medium">Cant.</th>
                    <th *appHasPermission="permissions.ORDERS_VIEW_ECONOMICS" scope="col" class="px-2 py-2 text-right font-medium">Costo</th>
                    <th *appHasPermission="permissions.ORDERS_VIEW_ECONOMICS" scope="col" class="px-2 py-2 text-right font-medium">Pers.</th>
                    <th *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" scope="col" class="px-2 py-2 text-right font-medium">Venta</th>
                    <th scope="col" class="px-1 py-2"><span class="sr-only">Quitar</span></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr *ngFor="let line of orderLines; let i = index">
                    <td class="px-3 py-2.5 align-middle">
                      <p class="font-medium text-gray-900 truncate leading-snug" [title]="line.nombre">{{ line.nombre }}</p>
                      <button
                        *appHasPermission="permissions.ORDERS_VIEW_ECONOMICS"
                        type="button"
                        [disabled]="isCancelledOrder"
                        (click)="openExtraCostsModal(i)"
                        class="text-teal-600 text-xs font-medium hover:text-teal-800 leading-none mt-0.5 disabled:opacity-40 disabled:cursor-not-allowed">
                        {{ getExtraCostsActionLabel(line) }}
                      </button>
                    </td>
                    <td class="px-2 py-2.5 align-middle">
                      <input
                        type="number"
                        [(ngModel)]="line.cantidad"
                        [name]="'cantidadDesktop' + i"
                        [disabled]="isCancelledOrder"
                        (ngModelChange)="onLineQuantityChange(line)"
                        min="1"
                        class="block w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-center tabular-nums">
                    </td>
                    <td
                      *appHasPermission="permissions.ORDERS_VIEW_ECONOMICS"
                      class="px-2 py-2.5 align-middle text-right text-sm text-gray-600 tabular-nums">
                      {{ line.costoUnitario }}
                    </td>
                    <td
                      *appHasPermission="permissions.ORDERS_VIEW_ECONOMICS"
                      class="px-2 py-2.5 align-middle text-right text-sm text-gray-600 tabular-nums">
                      {{ getLinePersTotal(line) }}
                    </td>
                    <td *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" class="px-2 py-2.5 align-middle">
                      <input
                        type="number"
                        [(ngModel)]="line.precioVenta"
                        [name]="'precioVentaDesktop' + i"
                        [disabled]="isCancelledOrder"
                        (ngModelChange)="calculateTotals()"
                        min="0"
                        class="block w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-right tabular-nums">
                    </td>
                    <td class="px-1 py-2.5 align-middle text-center">
                      <button
                        *ngIf="!isCancelledOrder"
                        type="button"
                        (click)="removeLine(i)"
                        class="inline-flex items-center justify-center w-8 h-8 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Quitar producto">
                        ×
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <article
                *ngFor="let line of orderLines; let i = index"
                class="md:hidden border-b border-gray-100 last:border-b-0 p-3 space-y-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="font-medium text-gray-900">{{ line.nombre }}</p>
                      <p *appHasPermission="permissions.ORDERS_VIEW_ECONOMICS" class="text-xs text-gray-400 mt-0.5">
                        Costo stock: {{ line.costoUnitario }}
                        · Pers.: {{ getLinePersTotal(line) }}
                      </p>
                      <button
                        *appHasPermission="permissions.ORDERS_VIEW_ECONOMICS"
                        type="button"
                        [disabled]="isCancelledOrder"
                        (click)="openExtraCostsModal(i)"
                        class="text-teal-600 text-xs font-medium hover:text-teal-800 mt-0.5 disabled:opacity-40 disabled:cursor-not-allowed">
                        {{ getExtraCostsActionLabel(line) }}
                      </button>
                    </div>
                    <button
                      *ngIf="!isCancelledOrder"
                      type="button"
                      (click)="removeLine(i)"
                      class="text-red-400 hover:text-red-600 p-1 shrink-0"
                      title="Quitar producto">
                      ×
                    </button>
                  </div>

                  <div
                    class="grid gap-2"
                    [ngClass]="auth.canViewOrderSalePrice ? 'grid-cols-2' : 'grid-cols-1'">
                    <div>
                      <label class="block text-xs text-gray-500 mb-1">Cantidad</label>
                      <input
                        type="number"
                        [(ngModel)]="line.cantidad"
                        [name]="'cantidadMobile' + i"
                        [disabled]="isCancelledOrder"
                        (ngModelChange)="onLineQuantityChange(line)"
                        min="1"
                        class="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm">
                    </div>
                    <div *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE">
                      <label class="block text-xs text-gray-500 mb-1">Precio venta</label>
                      <input
                        type="number"
                        [(ngModel)]="line.precioVenta"
                        [name]="'precioVentaMobile' + i"
                        [disabled]="isCancelledOrder"
                        (ngModelChange)="calculateTotals()"
                        min="0"
                        class="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm">
                    </div>
                  </div>
              </article>
            </div>
          </section>
        </div>

        <div class="space-y-4">
          <div
            *ngIf="auth.canViewOrderEconomics"
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

            <div class="mb-4 p-3 bg-gray-800/60 rounded-xl border border-gray-700">
              <ng-container *ngIf="!seniaBloqueada">
                <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Seña recibida</label>
                <input
                  type="number"
                  [(ngModel)]="order.senia"
                  name="senia"
                  [disabled]="isCancelledOrder"
                  (ngModelChange)="calculateTotals()"
                  min="0"
                  class="w-full bg-transparent text-xl font-bold outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
                <p class="mt-1 text-xs text-gray-500">
                  Al guardar el pedido, se registra en caja con la fecha de hoy y queda bloqueada.
                </p>
              </ng-container>

              <ng-container *ngIf="seniaBloqueada">
                <div class="flex items-center justify-between gap-2 mb-2">
                  <span class="text-xs font-bold text-gray-400 uppercase">Pagos del cliente</span>
                  <button
                    type="button"
                    (click)="openPaymentModal()"
                    [disabled]="isCancelledOrder || !(order.saldo && order.saldo > 0)"
                    class="text-xs font-semibold text-teal-300 hover:text-teal-200 disabled:opacity-40 disabled:cursor-not-allowed">
                    + Registrar pago / cuota
                  </button>
                </div>
                <div class="space-y-1 mb-3 max-h-28 overflow-auto">
                  <div
                    *ngFor="let pago of order.pagos"
                    class="flex items-center justify-between gap-2 text-xs text-gray-300">
                    <span class="truncate min-w-0">
                      {{ getPaymentLabel(pago) }}
                      <span class="text-gray-500">· {{ formatPaymentDate(pago.fecha) }}</span>
                      <span *ngIf="pago.notas" class="text-gray-500">· {{ pago.notas }}</span>
                    </span>
                    <span class="font-semibold tabular-nums shrink-0">{{ '$' + pago.monto }}</span>
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

            <ng-container *ngIf="!isCancelledOrder">
              <div *ngIf="isEditing && order.ventaId" class="mb-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
                Venta registrada
                <a routerLink="/sales" class="font-semibold underline hover:text-teal-900">Ver en Ventas</a>
              </div>
              <button
                *ngIf="canRegisterSale"
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
            *ngIf="!auth.canViewOrderEconomics"
            class="bg-white border border-gray-100 p-6 rounded-2xl shadow-sm sticky top-8">
            <h2 class="text-lg font-bold mb-4 text-gray-900">Resumen</h2>
            <div *appHasPermission="permissions.ORDERS_VIEW_SALE_PRICE" class="mb-6">
              <p class="text-xs font-bold text-gray-400 uppercase mb-1">Total venta</p>
              <p class="text-2xl font-bold text-teal-600">{{ '$' + (order.total || 0) }}</p>
            </div>
            <ng-container *ngIf="!isCancelledOrder">
              <div *ngIf="isEditing && order.ventaId" class="mb-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
                Venta registrada
                <a routerLink="/sales" class="font-semibold underline hover:text-teal-900">Ver en Ventas</a>
              </div>
              <button
                *ngIf="canRegisterSale"
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
              Completá concepto y precio, y confirmá con el tilde.
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
    </div>

    <ng-template #orderActions>
      <button
        type="button"
        (click)="saveDraft()"
        class="w-full mb-2 py-2.5 rounded-xl border border-gray-600 text-gray-200 text-sm font-medium hover:bg-gray-800 transition-all"
        [class.!border-gray-200]="!auth.canViewOrderEconomics"
        [class.!text-gray-700]="!auth.canViewOrderEconomics"
        [class.hover:!bg-gray-50]="!auth.canViewOrderEconomics">
        Guardar borrador
      </button>
      <button
        type="button"
        (click)="submitOrder()"
        class="w-full bg-teal-500 text-gray-900 font-bold py-3 rounded-xl hover:bg-teal-400 transition-all">
        Confirmar pedido
      </button>
    </ng-template>
  `,
})
export class NewOrderComponent implements OnInit {
  private clientService = inject(ClientService);
  private stockService = inject(StockService);
  private orderService = inject(OrderService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  readonly auth = inject(AuthService);
  readonly permissions = PERMISSIONS;

  readonly getOrderStatusLabel = getOrderStatusLabel;
  readonly getOrderStatusBadgeClass = getOrderStatusBadgeClass;
  readonly orderStatusOptions = ORDER_WORKFLOW_STATUS_OPTIONS;
  readonly itemControlsStock = itemControlsStock;

  clients: Client[] = [];
  editingOrderId: string | null = null;
  isDraftOrder = false;
  productSearch = '';
  productSearchResults: StockItem[] = [];
  productSearchOpen = false;
  searchingProducts = false;
  orderLines: OrderLineItem[] = [];
  extraCostsModalIndex: number | null = null;
  extraCostsDraft: OrderLineExtraCost[] = [];
  extraCostInputNombre = '';
  extraCostInputCosto: number | null = null;
  editingExtraCostIndex: number | null = null;
  paymentModalOpen = false;
  paymentModo: 'total' | 'parcial' = 'total';
  paymentMonto: number | null = null;

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

  get isCancelledOrder(): boolean {
    return normalizeOrderStatus(this.order.estado) === 'cancelado';
  }

  get orderEstado(): string {
    const normalized = normalizeOrderStatus(this.order.estado);
    return normalized === 'otro' ? 'pendiente' : normalized;
  }

  set orderEstado(value: string) {
    if (this.isCancelledOrder) return;
    this.order.estado = value;
  }

  get seniaBloqueada(): boolean {
    return !!(
      this.order.seniaBloqueada ||
      this.order.movimientoSeniaId ||
      (this.order.pagos?.length ?? 0) > 0
    );
  }

  get canRegisterSale(): boolean {
    if (!this.editingOrderId || this.isCancelledOrder) return false;
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

  ngOnInit() {
    this.clientService.getClients().subscribe((clients) => {
      this.clients = clients;
    });

    this.editingOrderId = this.route.snapshot.paramMap.get('id');
    if (this.editingOrderId) {
      this.loadOrder(this.editingOrderId);
    }
  }

  registerSaleFromOrder() {
    if (!this.editingOrderId || !this.canRegisterSale) return;
    this.router.navigate(['/sales'], { queryParams: { pedidoId: this.editingOrderId } });
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
    if (!this.ensureEditable('agregar productos')) return;
    if (!item.id || this.isProductAdded(item.id)) return;
    this.addProductFromSearch(item);
  }

  addProductFromSearch(item: StockItem) {
    this.addProduct(item);
  }

  isProductAdded(stockItemId?: string): boolean {
    if (!stockItemId) return false;
    return this.orderLines.some((line) => line.stockItemId === stockItemId);
  }

  addProduct(item: StockItem) {
    if (!item.id || this.isProductAdded(item.id)) return;

    const costoUnitario = Number(item.costo) || 0;
    const precioSugerido = Number(item.precioSugerido) || costoUnitario * 2;

    this.orderLines.push({
      stockItemId: item.id,
      nombre: item.nombre,
      cantidad: 1,
      costoUnitario,
      costosExtra: [],
      precioVenta: precioSugerido,
      controlaStock: itemControlsStock(item),
      stockDisponible: Number(item.stockActual) || 0,
    });
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
    this.orderLines.splice(index, 1);
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

    const pagado = this.getTotalPagado();
    this.order.saldo = (this.order.total || 0) - pagado;
  }

  getTotalPagado(): number {
    if (this.order.pagos?.length) {
      return this.order.pagos.reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
    }
    if (this.seniaBloqueada) {
      return Number(this.order.senia) || 0;
    }
    return Number(this.order.senia) || 0;
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
    if (pago.tipo === 'cuota') return 'Cuota';
    if (pago.tipo === 'extra') return 'Pago extra';
    return 'Pago';
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

  saveDraft() {
    if (!this.ensureEditable('guardar el pedido')) return;
    if (!this.validateClient()) return;
    this.persistOrder('borrador');
  }

  submitOrder() {
    if (!this.ensureEditable('confirmar el pedido')) return;
    if (!this.validateClient()) return;
    if (!this.validateProducts()) return;

    const estado =
      !this.isEditing || this.isDraftOrder ? 'pendiente' : this.order.estado || 'pendiente';

    const willDiscountStock = !this.order.stockDescontado && estado !== 'borrador';
    if (willDiscountStock && !this.validateStockForConfirm()) return;

    this.persistOrder(estado);
  }

  private validateClient(): boolean {
    if (!this.order.clienteId) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Seleccioná un cliente',
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
    return true;
  }

  private validateStockForConfirm(): boolean {
    const insufficient: string[] = [];

    for (const line of this.orderLines) {
      if (line.controlaStock === false) continue;
      if (line.stockDisponible === undefined) continue;

      const qty = Number(line.cantidad) || 0;
      const available = Number(line.stockDisponible) || 0;
      if (qty > available) {
        insufficient.push(`${line.nombre}: hay ${available} u., pediste ${qty} u.`);
      }
    }

    if (insufficient.length === 0) return true;

    this.dialogService.alert({
      title: 'Stock insuficiente',
      message: `No se puede confirmar el pedido:\n\n${insufficient.join('\n')}`,
    });
    return false;
  }

  private persistOrder(estado: string) {
    if (!this.ensureEditable('guardar el pedido')) return;
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
      next: () => {
        this.isDraftOrder = estado === 'borrador';
        this.router.navigate(['/orders']);
      },
      error: (err: HttpErrorResponse) =>
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : 'No se pudo guardar el pedido. Reiniciá el dev server si cambiaste la API.',
        }),
    });
  }

  private loadOrder(orderId: string) {
    this.orderService.getOrder(orderId).subscribe({
      next: (order) => {
        const normalizedStatus = normalizeOrderStatus(order.estado);
        this.isDraftOrder = normalizedStatus === 'borrador';

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
          ventaId: order.ventaId,
          items: order.items ?? [],
        };

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
              this.orderLines[0].controlaStock = itemControlsStock(stockItem);
              this.orderLines[0].stockDisponible = Number(stockItem.stockActual) || 0;
              this.calculateTotals();
            },
          });
        }

        this.calculateTotals();
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el pedido.',
        });
        this.router.navigate(['/orders']);
      },
    });
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

  private enrichOrderLinesWithStock() {
    const ids = [...new Set(this.orderLines.map((line) => line.stockItemId).filter(Boolean))];
    for (const stockItemId of ids) {
      this.stockService.getItem(stockItemId).subscribe({
        next: (stockItem) => {
          for (const line of this.orderLines) {
            if (line.stockItemId !== stockItemId) continue;
            line.controlaStock = itemControlsStock(stockItem);
            line.stockDisponible = Number(stockItem.stockActual) || 0;
          }
        },
      });
    }
  }

  private ensureEditable(action: string): boolean {
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

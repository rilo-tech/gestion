import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import {
  StockItem,
  StockMovement,
  StockOrigenGrupo,
  StockReservationRow,
  StockService,
  computeItemValorEstimado,
  computeValorDepositoEstimado,
  getStockDisponible,
  itemControlsStock,
  itemIsLowStock,
  type StockCatalogChange,
} from '../../core/services/stock.service';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
} from '../../core/services/catalog-config.service';
import {
  getStockOrigenes,
  getStockOrigenNombre,
  getStockTipoNombre,
  getStockTipos,
  matchesStockOrigenFilter,
  normalizeOrderStockMotivo,
} from '../../core/constants/stock-movimientos';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { isDeletableStockMovement } from '../../core/utils/deletion-rules';
import { PERMISSIONS } from '../../core/constants/permissions';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { LucideAngularModule } from 'lucide-angular';
import { ConfigSettingsLinkComponent } from '../../shared/components/config-settings-link/config-settings-link.component';
import { ConceptRefLinksComponent } from '../../shared/components/concept-ref-links/concept-ref-links.component';
import {
  ICON_ACTION_LINK_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
} from '../../shared/components/list-pagination/list-pagination.component';
import { DuplicateActionButtonComponent } from '../../shared/components/duplicate-action-button/duplicate-action-button.component';
import { CompactListRowComponent } from '../../shared/components/compact-list/compact-list-row.component';
import {
  CompactInlineStatsComponent,
  CompactInlineStat,
} from '../../shared/components/compact-list/compact-inline-stats.component';
import {
  COMPACT_LIST_EMPTY_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { getOrderStatusLabel } from '../../core/constants/order-status';
import { OrderService, ReservationTargetOrder } from '../../core/services/order.service';

type StockTab = 'productos' | 'movimientos' | 'reservas';

@Component({
  selector: 'app-stock',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, FormsModule, RouterLink, ConfigSettingsLinkComponent, ConceptRefLinksComponent, HasPermissionDirective, ActivityLogTriggerComponent, ListPaginationComponent, DuplicateActionButtonComponent, CompactListRowComponent, CompactInlineStatsComponent],
  template: `
    <div [class]="pageShellClass">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Stock & Inventario</h1>
          <app-config-settings-link
            settingsTab="productos"
            message="¿Falta tipo, talle o color?"
            linkLabel="Configuralo acá">
          </app-config-settings-link>
          <p class="mt-2">
            <a
              routerLink="/stock/faltantes"
              class="text-sm font-semibold text-orange-700 hover:text-orange-900 hover:underline">
              Ver faltantes para comprar
            </a>
          </p>
        </div>
        <div class="flex gap-2 shrink-0">
          <app-activity-log-trigger module="stock"></app-activity-log-trigger>
          <a
            routerLink="/stock/new"
            [class]="iconActionLinkClass"
            aria-label="Nuevo producto"
            title="Nuevo producto">
            <i-lucide name="plus" class="w-4 h-4"></i-lucide>
            <span class="hidden sm:inline">Nuevo producto</span>
          </a>
        </div>
      </div>

      <div
        *ngIf="!auth.canViewStockCosts"
        class="module-summary-kpis module-summary-kpis--3 grid gap-4 sm:gap-6 mb-6 sm:mb-8 w-full">
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Total items</p>
          <p class="text-2xl font-bold">{{ totalItemsCount }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Con stock bajo</p>
          <p class="text-2xl font-bold text-orange-500">{{ lowStockCount }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0 col-span-2 lg:col-span-1">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Movimientos mes</p>
          <p class="text-2xl font-bold">{{ movementsThisMonthLabel }}</p>
        </div>
      </div>

      <div
        *ngIf="auth.canViewStockCosts"
        class="module-summary-kpis module-summary-kpis--4 grid gap-4 sm:gap-6 mb-6 sm:mb-8 w-full">
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Total items</p>
          <p class="text-2xl font-bold">{{ totalItemsCount }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Con stock bajo</p>
          <p class="text-2xl font-bold text-orange-500">{{ lowStockCount }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0">
          <p
            class="text-xs font-semibold text-gray-400 uppercase mb-2"
            title="Costo × unidades en depósito (disponible + reservado, sin duplicar)">
            Valor estimado
          </p>
          <p class="text-2xl font-bold text-teal-600">{{ formatStockMoney(estimatedStockValue) }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-w-0">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">Movimientos mes</p>
          <p class="text-2xl font-bold">{{ movementsThisMonthLabel }}</p>
        </div>
      </div>

      <div class="mb-4 flex gap-2 border-b border-gray-100">
        <button
          type="button"
          (click)="setTab('productos')"
          class="px-4 py-2 text-sm font-semibold border-b-2 transition-colors"
          [class.border-teal-600]="activeTab === 'productos'"
          [class.text-teal-700]="activeTab === 'productos'"
          [class.border-transparent]="activeTab !== 'productos'"
          [class.text-gray-500]="activeTab !== 'productos'">
          Productos
        </button>
        <button
          type="button"
          (click)="setTab('movimientos')"
          class="px-4 py-2 text-sm font-semibold border-b-2 transition-colors"
          [class.border-teal-600]="activeTab === 'movimientos'"
          [class.text-teal-700]="activeTab === 'movimientos'"
          [class.border-transparent]="activeTab !== 'movimientos'"
          [class.text-gray-500]="activeTab !== 'movimientos'">
          Movimientos
        </button>
        <button
          type="button"
          (click)="setTab('reservas')"
          class="px-4 py-2 text-sm font-semibold border-b-2 transition-colors"
          [class.border-teal-600]="activeTab === 'reservas'"
          [class.text-teal-700]="activeTab === 'reservas'"
          [class.border-transparent]="activeTab !== 'reservas'"
          [class.text-gray-500]="activeTab !== 'reservas'">
          Reservas
          <span
            *ngIf="reservationRows.length > 0"
            class="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-bold leading-none text-white tabular-nums">
            {{ reservationRows.length }}
          </span>
        </button>
      </div>

      <div
        *ngIf="lowStockOnly && activeTab === 'productos'"
        class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-800">
        <span>Productos con stock en o por debajo del mínimo.</span>
        <a routerLink="/stock" class="font-semibold text-orange-700 hover:underline">Ver todos</a>
      </div>

      <div *ngIf="activeTab === 'productos'" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-3 py-2 sm:px-6 sm:py-4 border-b border-gray-100 bg-gray-50">
          <input
            [(ngModel)]="searchQuery"
            (ngModelChange)="onProductsSearchChange()"
            name="searchQuery"
            placeholder="Buscar producto..."
            class="w-full sm:max-w-md px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>

        <div class="sm:hidden native-compact-list">
          <app-compact-list-row
            *ngFor="let item of paginatedFilteredItems"
            (activate)="openEditItem(item)">
            <div compactTitle class="compact-list-title truncate">{{ item.nombre }}</div>
            <div compactSubtitle class="compact-list-subtitle truncate">
              {{ productMobileSubtitle(item) }}
            </div>
            <app-compact-inline-stats
              *ngIf="controlsStockItem(item)"
              compactTrailing
              [items]="stockMobileStats(item)">
            </app-compact-inline-stats>
            <span
              *ngIf="!controlsStockItem(item)"
              compactTrailing
              class="text-[11px] font-medium text-violet-600">
              Servicio
            </span>
          </app-compact-list-row>
          <p *ngIf="loadingItems" [class]="compactListEmptyClass">Cargando productos...</p>
          <p *ngIf="!loadingItems && items.length === 0" [class]="compactListEmptyClass">
            No hay productos cargados. Usá <span class="font-semibold">Nuevo producto</span> para empezar.
          </p>
          <p *ngIf="!loadingItems && items.length > 0 && filteredItems.length === 0" [class]="compactListEmptyClass">
            <ng-container *ngIf="lowStockOnly && !searchQuery.trim()">No hay productos con stock bajo.</ng-container>
            <ng-container *ngIf="!lowStockOnly || searchQuery.trim()">
              No se encontraron productos para "{{ searchQuery }}".
            </ng-container>
          </p>
        </div>

        <div class="hidden sm:block" [class]="tableScrollClass">
        <table [class]="nativeCompactTableClass + ' sm:min-w-[820px]'">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Item</th>
              <th class="px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Categoría</th>
              <th class="px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center" title="Unidades en depósito">
                Depósito
              </th>
              <th class="px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center" title="Apartadas para pedidos">
                Reservado
              </th>
              <th class="px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center" title="Libre para usar en pedidos nuevos">
                Disponible
              </th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Mín. stock</th>
              <th *appHasPermission="permissions.STOCK_VIEW_COSTS" class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Costo ref.</th>
              <th
                *ngIf="auth.isAdmin"
                class="hidden lg:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right"
                title="Costo × unidades en depósito">
                Valor estimado
              </th>
              <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let item of paginatedFilteredItems"
              (click)="openEditItem(item)"
              class="hover:bg-gray-50 transition-colors cursor-pointer">
              <td class="px-4 sm:px-6 py-3 sm:py-4">
                <a
                  *ngIf="item.id; else stockItemNamePlain"
                  [routerLink]="['/stock', item.id, 'edit']"
                  (click)="$event.stopPropagation()"
                  class="font-medium text-gray-900 truncate block hover:text-teal-700 hover:underline">
                  {{ item.nombre }}
                </a>
                <ng-template #stockItemNamePlain>
                  <div class="font-medium text-gray-900 truncate">{{ item.nombre }}</div>
                </ng-template>
                <span
                  *ngIf="!controlsStockItem(item)"
                  class="inline-flex mt-1 px-2 py-0.5 text-[10px] rounded-full uppercase font-bold bg-violet-50 text-violet-700">
                  Servicio
                </span>
              </td>
              <td class="px-4 py-4">
                <span class="px-2 py-0.5 text-xs rounded-full uppercase font-bold bg-teal-50 text-teal-700">
                  {{ item.categoria || '—' }}
                </span>
              </td>
              <td class="px-4 py-4 text-center text-sm tabular-nums" [class]="stockTotalClass(item)">
                {{ controlsStockItem(item) ? item.stockActual + ' u.' : '—' }}
              </td>
              <td class="px-4 py-4 text-center text-sm tabular-nums" [class]="stockReservedClass(item)">
                {{ controlsStockItem(item) ? (item.stockReservado || 0) + ' u.' : '—' }}
              </td>
              <td class="px-4 py-4 text-center text-sm tabular-nums font-bold" [class]="stockAvailableClass(item)">
                {{ controlsStockItem(item) ? getStockDisponible(item) + ' u.' : '—' }}
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 tabular-nums text-center">
                {{ controlsStockItem(item) ? (item.stockMinimo || 0) + ' u.' : '—' }}
              </td>
              <td *appHasPermission="permissions.STOCK_VIEW_COSTS" class="px-6 py-4 text-sm text-gray-600">
                {{ '$' + (item.costo || 0) }}
              </td>
              <td
                *ngIf="auth.isAdmin"
                class="hidden lg:table-cell px-6 py-4 text-sm text-right tabular-nums"
                [class.text-teal-700]="itemValorEstimado(item) > 0"
                [class.font-medium]="itemValorEstimado(item) > 0"
                [class.text-gray-400]="itemValorEstimado(item) <= 0">
                {{ itemValorEstimadoLabel(item) }}
              </td>
              <td class="px-6 py-4 text-sm font-medium" (click)="$event.stopPropagation()">
                <div class="flex items-center gap-1">
                  <button
                    *ngIf="auth.canEditRecords"
                    type="button"
                    (click)="openEditItem(item)"
                    title="Editar"
                    class="p-2 rounded-lg text-teal-600 hover:bg-teal-50 hover:text-teal-800">
                    <i-lucide name="pencil" class="w-4 h-4"></i-lucide>
                  </button>
                  <app-duplicate-action-button
                    *ngIf="auth.canEditRecords"
                    (duplicateClick)="duplicateItem(item, $event)">
                  </app-duplicate-action-button>
                  <button
                    *ngIf="auth.canDeleteRecords"
                    type="button"
                    (click)="confirmDeleteItem(item)"
                    title="Eliminar"
                    class="p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700">
                    <i-lucide name="trash-2" class="w-4 h-4"></i-lucide>
                  </button>
                </div>
              </td>
            </tr>
            <tr *ngIf="loadingItems">
              <td [attr.colspan]="productTableDesktopColspan" class="px-6 py-12 text-center text-gray-400">Cargando productos...</td>
            </tr>
            <tr *ngIf="!loadingItems && items.length === 0">
              <td [attr.colspan]="productTableDesktopColspan" class="px-6 py-12 text-center text-gray-400">
                No hay productos cargados. Usá <span class="font-semibold">Nuevo producto</span> para empezar.
              </td>
            </tr>
            <tr *ngIf="!loadingItems && items.length > 0 && filteredItems.length === 0">
              <td [attr.colspan]="productTableDesktopColspan" class="px-6 py-12 text-center text-gray-400">
                <ng-container *ngIf="lowStockOnly && !searchQuery.trim()">
                  No hay productos con stock bajo.
                </ng-container>
                <ng-container *ngIf="!lowStockOnly || searchQuery.trim()">
                  No se encontraron productos para "{{ searchQuery }}".
                </ng-container>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <app-list-pagination
          [page]="productsPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredItems.length"
          (pageChange)="productsPage = $event">
        </app-list-pagination>
      </div>

      <div *ngIf="activeTab === 'movimientos'" class="bg-white rounded-xl shadow-sm border border-gray-100">
        <div class="px-3 py-2 sm:px-6 sm:py-4 border-b border-gray-100 bg-gray-50 space-y-1.5 sm:space-y-2">
          <div class="grid grid-cols-1 gap-2 sm:flex sm:flex-row sm:items-center sm:gap-3">
            <input
              [(ngModel)]="movementSearchQuery"
              (ngModelChange)="onMovementsSearchChange()"
              name="movementSearchQuery"
              placeholder="Buscar por producto o motivo..."
              class="w-full sm:max-w-md px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
            <div class="grid grid-cols-2 gap-2 sm:contents">
              <select
                [(ngModel)]="movementTipoFilter"
                (ngModelChange)="movementsPage = 1"
                name="movementTipoFilter"
                class="min-w-0 w-full sm:w-auto px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary bg-white">
                <option value="all">Todos los tipos</option>
                <option value="entrada">{{ getTipoLabel('entrada') }}</option>
                <option value="salida">{{ getTipoLabel('salida') }}</option>
              </select>
              <select
                [(ngModel)]="movementOrigenFilter"
                (ngModelChange)="movementsPage = 1"
                name="movementOrigenFilter"
                class="min-w-0 w-full sm:w-auto px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary bg-white">
                <option value="all">Todos los orígenes</option>
                <option *ngFor="let origen of stockOrigenes" [value]="origen.grupo">{{ origen.nombre }}</option>
              </select>
            </div>
          </div>
          <app-config-settings-link
            settingsTab="stock"
            message="¿Querés renombrar tipos u orígenes?"
            linkLabel="Configuralo acá"
            [compact]="true">
          </app-config-settings-link>
        </div>
        <div [class]="'sm:hidden ' + nativeCompactListClass">
          <app-compact-list-row
            *ngFor="let movement of paginatedFilteredMovements"
            (activate)="openMovementRow(movement)">
            <div compactTitle class="compact-list-title truncate">{{ movement.productoNombre || '—' }}</div>
            <div compactSubtitle class="compact-list-subtitle truncate">
              {{ formatDate(movement.fecha) }} · {{ getTipoLabel(movement.tipo === 'entrada' ? 'entrada' : 'salida') }}
            </div>
            <span
              compactTrailing
              class="text-[11px] font-bold tabular-nums shrink-0"
              [class.text-teal-600]="movement.tipo === 'entrada'"
              [class.text-red-500]="movement.tipo === 'salida'">
              {{ movement.tipo === 'salida' ? '-' : '+' }}{{ movement.cantidad }}
            </span>
          </app-compact-list-row>
          <p *ngIf="loadingMovements" [class]="compactListEmptyClass">Cargando movimientos...</p>
          <p *ngIf="!loadingMovements && movements.length === 0" [class]="compactListEmptyClass">
            Todavía no hay movimientos de stock.
          </p>
          <p
            *ngIf="!loadingMovements && movements.length > 0 && filteredMovements.length === 0"
            [class]="compactListEmptyClass">
            No se encontraron movimientos para los filtros aplicados.
          </p>
        </div>
        <div class="hidden sm:block" [class]="tableScrollClass">
          <table [class]="nativeCompactTableClass + ' sm:min-w-[860px]'">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
                <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Producto</th>
                <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tipo</th>
                <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Cantidad</th>
                <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Motivo</th>
                <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Origen</th>
                <th class="hidden sm:table-cell px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr
                *ngFor="let movement of paginatedFilteredMovements"
                (click)="openMovementRow(movement)"
                class="hover:bg-gray-50 transition-colors cursor-pointer">
                <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                  {{ formatDate(movement.fecha) }}
                </td>
                <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm font-medium text-gray-900">
                  <div class="truncate">{{ movement.productoNombre || '—' }}</div>
                  <div class="text-xs text-gray-400 sm:hidden">{{ formatDate(movement.fecha) }}</div>
                </td>
                <td class="hidden sm:table-cell px-6 py-4">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                    [class.bg-teal-50]="movement.tipo === 'entrada'"
                    [class.text-teal-700]="movement.tipo === 'entrada'"
                    [class.bg-red-50]="movement.tipo === 'salida'"
                    [class.text-red-600]="movement.tipo === 'salida'">
                    {{ getTipoLabel(movement.tipo === 'entrada' ? 'entrada' : 'salida') }}
                  </span>
                </td>
                <td class="px-4 sm:px-6 py-3 sm:py-4 text-sm font-semibold text-right tabular-nums"
                  [class.text-teal-600]="movement.tipo === 'entrada'"
                  [class.text-red-500]="movement.tipo === 'salida'">
                  <span
                    class="inline-flex sm:hidden items-center rounded-full px-2 py-0.5 text-[10px] font-medium mr-1 align-middle"
                    [class.bg-teal-50]="movement.tipo === 'entrada'"
                    [class.text-teal-700]="movement.tipo === 'entrada'"
                    [class.bg-red-50]="movement.tipo === 'salida'"
                    [class.text-red-600]="movement.tipo === 'salida'">
                    {{ movement.tipo === 'entrada' ? getTipoShortLabel('entrada') : getTipoShortLabel('salida') }}
                  </span>
                  {{ movement.tipo === 'salida' ? '-' : '+' }}{{ movement.cantidad }}
                </td>
                <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-700">
                  <ng-container *ngIf="movement.pedidoId || movement.ventaId; else motivoFallback">
                    <app-concept-ref-links
                      [text]="getMovementMotivoText(movement)"
                      [pedidoId]="movement.pedidoId"
                      [ventaId]="movement.ventaId"
                      [numeroPedidoLabel]="movement.numeroPedidoLabel"
                      [ventaLabel]="movement.ventaLabel">
                    </app-concept-ref-links>
                    <p
                      *ngIf="movement.clienteNombre && !isReservationStockMovement(movement)"
                      class="text-xs text-gray-500 mt-0.5">
                      Cliente: {{ movement.clienteNombre }}
                    </p>
                  </ng-container>
                  <ng-template #motivoFallback>
                    <ng-container *ngIf="getMotivoLink(movement) as link; else plainMotivo">
                      {{ link.before }}                      <button
                        *ngIf="link.kind === 'pedido'"
                        type="button"
                        (click)="openOrder(movement); $event.stopPropagation()"
                        class="text-teal-600 font-semibold hover:text-teal-800 hover:underline">
                        {{ link.ref }}
                      </button><a
                        *ngIf="link.kind === 'compra'"
                        routerLink="/purchases"
                        [queryParams]="movement.compraId ? { detail: movement.compraId } : null"
                        (click)="$event.stopPropagation()"
                        class="text-teal-600 font-semibold hover:text-teal-800 hover:underline">
                        {{ link.ref }}
                      </a>{{ link.after }}
                    </ng-container>
                    <ng-template #plainMotivo>{{ getMovementMotivoText(movement) }}</ng-template>
                  </ng-template>
                </td>
                <td class="hidden sm:table-cell px-6 py-4">
                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                    [ngClass]="getOrigenBadgeClass(movement)">
                    {{ getOrigenLabel(movement) }}
                  </span>
                </td>
                <td class="hidden sm:table-cell px-4 py-4 text-sm font-medium text-right" (click)="$event.stopPropagation()">
                  <button
                    *ngIf="auth.canDeleteRecords && isDeletableStockMovement(movement)"
                    type="button"
                    (click)="confirmDeleteMovement(movement)"
                    title="Eliminar movimiento"
                    class="p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700">
                    <i-lucide name="trash-2" class="w-4 h-4"></i-lucide>
                  </button>
                </td>
              </tr>
              <tr *ngIf="loadingMovements">
                <td colspan="7" class="px-6 py-12 text-center text-gray-400">Cargando movimientos...</td>
              </tr>
              <tr *ngIf="!loadingMovements && movements.length === 0">
                <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                  Todavía no hay movimientos de stock.
                </td>
              </tr>
              <tr *ngIf="!loadingMovements && movements.length > 0 && filteredMovements.length === 0">
                <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                  No se encontraron movimientos con los filtros actuales.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-list-pagination
          [page]="movementsPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredMovements.length"
          (pageChange)="movementsPage = $event">
        </app-list-pagination>
      </div>

      <div *ngIf="activeTab === 'reservas'" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50 space-y-2">
          <p class="text-sm text-gray-600">
            Stock apartado para pedidos pendientes. El depósito real baja al pasar a producción.
          </p>
          <input
            [(ngModel)]="reservationSearchQuery"
            (ngModelChange)="onReservationsSearchChange()"
            name="reservationSearchQuery"
            placeholder="Buscar producto, pedido o cliente..."
            class="w-full max-w-md px-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
        </div>
        <div class="sm:hidden native-compact-list">
          <app-compact-list-row
            *ngFor="let row of paginatedFilteredReservations"
            (activate)="openReservationRow(row)">
            <div compactTitle class="compact-list-title truncate">{{ row.productoNombre }}</div>
            <div compactSubtitle class="compact-list-subtitle truncate">
              #{{ row.orderLabel }} · {{ row.clienteNombre }}
            </div>
            <span compactTrailing class="text-[11px] font-bold text-teal-700 tabular-nums">
              {{ row.cantidadActiva }} u.
            </span>
          </app-compact-list-row>
          <p *ngIf="loadingReservations" [class]="compactListEmptyClass">Cargando reservas...</p>
          <p *ngIf="!loadingReservations && reservationRows.length === 0" [class]="compactListEmptyClass">
            No hay stock reservado para pedidos en curso.
          </p>
          <p
            *ngIf="!loadingReservations && reservationRows.length > 0 && filteredReservations.length === 0"
            [class]="compactListEmptyClass">
            No se encontraron reservas para "{{ reservationSearchQuery }}".
          </p>
        </div>
        <div class="hidden sm:block" [class]="tableScrollClass">
          <table [class]="nativeCompactTableClass + ' sm:min-w-[760px]'">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-100">
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Producto</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Pedido</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Cliente</th>
                <th class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Reservado</th>
                <th class="px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Estado pedido</th>
                <th *ngIf="auth.canEditRecords" class="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr
                *ngFor="let row of paginatedFilteredReservations"
                (click)="openReservationRow(row)"
                class="hover:bg-gray-50 cursor-pointer transition-colors">
                <td class="px-4 sm:px-6 py-3 text-sm font-medium text-gray-900 max-w-[12rem] truncate" [title]="row.productoNombre">
                  {{ row.productoNombre }}
                </td>
                <td class="px-4 sm:px-6 py-3 text-sm">
                  <a
                    [routerLink]="['/orders', row.orderId, 'edit']"
                    (click)="$event.stopPropagation()"
                    class="font-semibold text-teal-700 hover:text-teal-900 hover:underline">
                    #{{ row.orderLabel }}
                  </a>
                </td>
                <td class="px-4 sm:px-6 py-3 text-sm text-gray-700">{{ row.clienteNombre }}</td>
                <td class="px-4 sm:px-6 py-3 text-sm text-center tabular-nums font-bold text-teal-700">
                  {{ row.cantidadActiva }} u.
                </td>
                <td class="px-6 py-3 text-sm text-gray-600">
                  {{ getOrderStatusLabel(row.orderEstado) }}
                </td>
                <td *ngIf="auth.canEditRecords" class="px-4 sm:px-6 py-3 text-right" (click)="$event.stopPropagation()">
                  <button
                    type="button"
                    (click)="openReservationTransfer(row)"
                    class="text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline">
                    Mover a pedido
                  </button>
                </td>
              </tr>
              <tr *ngIf="loadingReservations">
                <td [attr.colspan]="auth.canEditRecords ? 6 : 5" class="px-6 py-12 text-center text-gray-400">Cargando reservas...</td>
              </tr>
              <tr *ngIf="!loadingReservations && reservationRows.length === 0">
                <td [attr.colspan]="auth.canEditRecords ? 6 : 5" class="px-6 py-12 text-center text-gray-400">
                  No hay stock reservado para pedidos en curso.
                </td>
              </tr>
              <tr *ngIf="!loadingReservations && reservationRows.length > 0 && filteredReservations.length === 0">
                <td [attr.colspan]="auth.canEditRecords ? 6 : 5" class="px-6 py-12 text-center text-gray-400">
                  No se encontraron reservas para "{{ reservationSearchQuery }}".
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-list-pagination
          [page]="reservationsPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredReservations.length"
          (pageChange)="reservationsPage = $event">
        </app-list-pagination>
      </div>

      <div
        *ngIf="transferReservationRow"
        class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <button type="button" class="absolute inset-0 bg-black/75 backdrop-blur-sm" (click)="closeReservationTransfer()" aria-label="Cerrar"></button>
        <div class="relative z-[1] w-full max-w-md rounded-xl bg-white border border-gray-100 shadow-2xl p-5 space-y-4">
          <div>
            <h3 class="text-base font-bold text-gray-900">Mover reserva a otro pedido</h3>
            <p class="text-sm text-gray-500 mt-1">
              Desde #{{ transferReservationRow.orderLabel }} · {{ transferReservationRow.productoNombre }} ·
              {{ transferReservationRow.cantidadActiva }} u. disponibles para mover.
            </p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Pedido destino</label>
            <select
              class="form-control w-full"
              [(ngModel)]="transferTargetKey"
              name="transferTargetKey"
              [disabled]="loadingTransferTargets || transferringReservation">
              <option value="">Elegir pedido...</option>
              <option *ngFor="let target of transferTargets" [value]="reservationTargetKey(target)">
                #{{ target.orderLabel }} · admite {{ target.cantidadRoom }} u.
              </option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Cantidad</label>
            <input
              type="text"
              inputmode="numeric"
              class="form-control w-full max-w-[6rem] text-center tabular-nums"
              [(ngModel)]="transferQtyInput"
              name="transferQtyInput"
              [disabled]="transferringReservation" />
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" (click)="closeReservationTransfer()" class="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="button"
              (click)="executeReservationTransfer()"
              [disabled]="transferringReservation || !transferTargetKey"
              class="px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-opacity-90 disabled:opacity-60">
              {{ transferringReservation ? 'Moviendo...' : 'Transferir' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class StockComponent implements OnInit, OnDestroy {
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly iconActionLinkClass = ICON_ACTION_LINK_CLASS;
  readonly auth = inject(AuthService);
  readonly permissions = PERMISSIONS;
  readonly getStockDisponible = getStockDisponible;
  readonly getOrderStatusLabel = getOrderStatusLabel;
  isDeletableStockMovement = isDeletableStockMovement;

  private stockService = inject(StockService);
  private orderService = inject(OrderService);
  private configService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private configSub?: Subscription;
  private catalogSub?: Subscription;
  private routerSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  items: StockItem[] = [];
  stockMetrics = {
    totalItems: 0,
    lowStockCount: 0,
    valorDepositoEstimado: 0,
    updatedAt: '',
  };
  movements: StockMovement[] = [];
  reservationRows: StockReservationRow[] = [];
  searchQuery = '';
  movementSearchQuery = '';
  reservationSearchQuery = '';
  reservationProductFilter = '';
  movementTipoFilter: 'all' | 'entrada' | 'salida' = 'all';
  movementOrigenFilter: 'all' | string = 'all';
  activeTab: StockTab = 'productos';
  lowStockOnly = false;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  productsPage = 1;
  movementsPage = 1;
  reservationsPage = 1;
  loadingItems = true;
  loadingMovements = false;
  loadingReservations = false;
  private movementsLoaded = false;
  private reservationsLoaded = false;
  transferReservationRow: StockReservationRow | null = null;
  transferTargets: ReservationTargetOrder[] = [];
  transferTargetKey = '';
  transferQtyInput = '1';
  loadingTransferTargets = false;
  transferringReservation = false;

  ngOnInit() {
    this.configSub = this.configService.appConfig$.subscribe((config) => {
      this.appConfig = config;
    });
    this.configService.getAppConfig().subscribe();

    this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');
      if (tab === 'movimientos') {
        this.activeTab = 'movimientos';
      } else if (tab === 'reservas') {
        this.activeTab = 'reservas';
      } else {
        this.activeTab = 'productos';
      }

      this.lowStockOnly = params.get('filter') === 'stock-bajo';
      this.reservationProductFilter = params.get('producto') ?? '';
      if (this.reservationProductFilter) {
        this.activeTab = 'reservas';
      }

      this.ensureTabDataLoaded(this.activeTab);
    });

    this.catalogSub = this.stockService.stockCatalogChanged$.subscribe((change) => {
      this.onStockCatalogChanged(change);
    });

    this.routerSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        if (event.urlAfterRedirects.startsWith('/stock') && !event.urlAfterRedirects.includes('/edit')) {
          this.loadStockMetrics(true);
          if (this.activeTab === 'productos') {
            this.loadStock();
          }
        }
      });

    this.refreshStockData();
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
    this.catalogSub?.unsubscribe();
    this.routerSub?.unsubscribe();
  }

  get stockOrigenes() {
    return getStockOrigenes(this.appConfig.stock?.origenes);
  }

  getTipoLabel(grupo: 'entrada' | 'salida'): string {
    return getStockTipoNombre(this.appConfig.stock?.tipos, grupo);
  }

  getTipoShortLabel(grupo: 'entrada' | 'salida'): string {
    const label = this.getTipoLabel(grupo);
    return label.length > 4 ? `${label.slice(0, 3)}.` : label;
  }

  setTab(tab: StockTab) {
    this.activeTab = tab;
    if (tab !== 'reservas') {
      this.reservationProductFilter = '';
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tab: tab === 'productos' ? null : tab,
        producto: tab === 'reservas' ? this.reservationProductFilter || null : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.ensureTabDataLoaded(tab);
    if (tab === 'productos') {
      this.loadStockMetrics(true);
    }
    if (tab === 'reservas') {
      this.loadReservations(this.reservationProductFilter || undefined);
    }
  }

  private ensureTabDataLoaded(tab: StockTab) {
    if (tab === 'movimientos') {
      this.ensureMovementsLoaded();
    } else if (tab === 'reservas') {
      this.ensureReservationsLoaded();
    }
  }

  private ensureMovementsLoaded() {
    if (this.movementsLoaded || this.loadingMovements) return;
    this.loadMovements();
  }

  private ensureReservationsLoaded() {
    if (this.reservationsLoaded || this.loadingReservations) return;
    this.loadReservations(this.reservationProductFilter || undefined);
  }

  onProductsSearchChange() {
    this.productsPage = 1;
  }

  onMovementsSearchChange() {
    this.movementsPage = 1;
  }

  onReservationsSearchChange() {
    this.reservationsPage = 1;
  }

  get filteredReservations(): StockReservationRow[] {
    let list = this.reservationRows;
    if (this.reservationProductFilter) {
      list = list.filter((row) => row.stockItemId === this.reservationProductFilter);
    }
    const query = this.reservationSearchQuery.trim().toLowerCase();
    if (!query) return list;
    return list.filter((row) => {
      const haystack = [row.productoNombre, row.orderLabel, row.clienteNombre, row.orderEstado]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(query);
    });
  }

  get paginatedFilteredReservations(): StockReservationRow[] {
    return paginateSlice(this.filteredReservations, this.reservationsPage, this.listPageSize);
  }

  get totalItemsCount(): number {
    return this.stockMetrics.totalItems;
  }

  get lowStockCount(): number {
    return this.stockMetrics.lowStockCount;
  }

  get estimatedStockValue(): number {
    if (this.items.length > 0) {
      return computeValorDepositoEstimado(
        this.items,
        this.appConfig.productos?.categoriasSinStock ?? []
      );
    }
    return this.stockMetrics.valorDepositoEstimado;
  }

  formatStockMoney(value: number): string {
    const amount = Number(value) || 0;
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  itemValorEstimado(item: StockItem): number {
    return computeItemValorEstimado(item, this.appConfig.productos?.categoriasSinStock ?? []);
  }

  itemValorEstimadoLabel(item: StockItem): string {
    if (!this.controlsStockItem(item)) return '—';
    return this.formatStockMoney(this.itemValorEstimado(item));
  }

  get movementsThisMonthLabel(): string | number {
    if (!this.movementsLoaded) return '—';
    return this.movementsThisMonth;
  }

  get movementsThisMonth(): number {
    const now = new Date();
    return this.movements.filter((movement) => {
      const date = new Date(movement.fecha);
      return (
        !Number.isNaN(date.getTime()) &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      );
    }).length;
  }

  get filteredItems(): StockItem[] {
    let list = this.items;

    if (this.lowStockOnly) {
      list = list.filter((item) => this.isLowStock(item));
    }

    const query = this.searchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter((item) => {
        const searchable = [item.nombre, item.nombreBase, item.categoria, item.talle, item.color]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchable.includes(query);
      });
    }

    return this.sortItemsByName(list);
  }

  get paginatedFilteredItems(): StockItem[] {
    return paginateSlice(this.filteredItems, this.productsPage, this.listPageSize);
  }

  private sortItemsByName(items: StockItem[]): StockItem[] {
    return [...items].sort((a, b) =>
      (a.nombre ?? a.nombreBase ?? '').localeCompare(b.nombre ?? b.nombreBase ?? '', 'es', {
        numeric: true,
        sensitivity: 'base',
      })
    );
  }

  get filteredMovements(): StockMovement[] {
    let list = this.movements;

    if (this.movementTipoFilter !== 'all') {
      list = list.filter((movement) => movement.tipo === this.movementTipoFilter);
    }

    if (this.movementOrigenFilter !== 'all') {
      list = list.filter((movement) =>
        matchesStockOrigenFilter(this.resolveOrigenGrupo(movement), this.movementOrigenFilter)
      );
    }

    const query = this.movementSearchQuery.trim().toLowerCase();
    if (!query) return list;

    return list.filter((movement) => {
      const haystack = [movement.productoNombre, movement.motivo, movement.origenLabel]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(query);
    });
  }

  get paginatedFilteredMovements(): StockMovement[] {
    return paginateSlice(this.filteredMovements, this.movementsPage, this.listPageSize);
  }

  formatDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
  }

  isLowStock(item: StockItem): boolean {
    const minStock = Number(item.stockMinimo) || 0;
    if (!this.controlsStockItem(item) || minStock <= 0) return false;
    return itemIsLowStock(item, this.appConfig.productos?.categoriasSinStock ?? []);
  }

  controlsStockItem(item: StockItem): boolean {
    return itemControlsStock(item, this.appConfig.productos?.categoriasSinStock ?? []);
  }

  get productTableDesktopColspan(): number {
    let cols = 7;
    if (this.auth.canViewStockCosts) cols += 1;
    if (this.auth.isAdmin) cols += 1;
    return cols;
  }

  stockTotalClass(item: StockItem): string {
    if (!this.controlsStockItem(item)) return 'text-gray-400';
    return this.isLowStock(item) ? 'text-orange-600 font-bold' : 'text-gray-900 font-semibold';
  }

  stockReservedClass(item: StockItem): string {
    if (!this.controlsStockItem(item)) return 'text-gray-400';
    const reserved = Number(item.stockReservado) || 0;
    return reserved > 0 ? 'text-amber-700 font-semibold' : 'text-gray-400';
  }

  stockAvailableClass(item: StockItem): string {
    if (!this.controlsStockItem(item)) return 'text-gray-400';
    const available = getStockDisponible(item);
    if (available <= 0) return 'text-red-600';
    return 'text-teal-700';
  }

  productMobileSubtitle(item: StockItem): string {
    if (!this.controlsStockItem(item)) {
      const categoria = String(item.categoria ?? '').trim();
      return categoria ? `${categoria} · Servicio` : 'Servicio';
    }
    const color = String(item.color ?? '').trim();
    const talle = String(item.talle ?? '').trim();
    const variant = [color, talle].filter(Boolean).join(' · ');
    if (variant) return variant;
    return String(item.categoria ?? '').trim() || '—';
  }

  stockMobileStats(item: StockItem): CompactInlineStat[] {
    const reserved = Number(item.stockReservado) || 0;
    const available = getStockDisponible(item);
    return [
      {
        label: 'Dep',
        value: String(item.stockActual ?? 0),
        tone: this.isLowStock(item) ? 'warning' : 'default',
      },
      {
        label: 'Res',
        value: String(reserved),
        tone: reserved > 0 ? 'warning' : 'muted',
      },
      {
        label: 'Disp',
        value: String(available),
        tone: available <= 0 ? 'danger' : 'accent',
      },
    ];
  }

  getOrigenLabel(movement: StockMovement): string {
    if (movement.origenLabel) return movement.origenLabel;
    return getStockOrigenNombre(this.appConfig.stock?.origenes, this.resolveOrigenGrupo(movement));
  }

  getOrigenBadgeClass(movement: StockMovement): Record<string, boolean> {
    const grupo = this.resolveOrigenGrupo(movement);
    return {
      'bg-purple-50 text-purple-700': grupo === 'compra',
      'bg-teal-50 text-teal-700': grupo === 'pedido' || grupo === 'venta',
      'bg-gray-100 text-gray-700': grupo === 'ajuste',
      'bg-amber-50 text-amber-700': grupo === 'carga_inicial',
      'bg-slate-100 text-slate-700': grupo === 'otro',
    };
  }

  getMotivoLink(
    movement: StockMovement
  ): { before: string; ref: string; after: string; kind: 'pedido' | 'compra' } | null {
    const motivo = this.getMovementMotivoText(movement);
    const pedidoRef = movement.numeroPedidoLabel ? `#${movement.numeroPedidoLabel}` : null;
    if (movement.pedidoId && pedidoRef && motivo.includes(pedidoRef)) {
      const index = motivo.indexOf(pedidoRef);
      return {
        before: motivo.slice(0, index),
        ref: pedidoRef,
        after: motivo.slice(index + pedidoRef.length),
        kind: 'pedido',
      };
    }

    const compraMatch = motivo.match(/^(.*?)(#\S+)(.*)$/);
    if (compraMatch && this.resolveOrigenGrupo(movement) === 'compra') {
      return {
        before: compraMatch[1],
        ref: compraMatch[2],
        after: compraMatch[3],
        kind: 'compra',
      };
    }

    if (movement.pedidoId) {
      const generic = motivo.match(/^(.*?)(#\S+)(.*)$/);
      if (generic) {
        return {
          before: generic[1],
          ref: generic[2],
          after: generic[3],
          kind: 'pedido',
        };
      }
    }

    return null;
  }

  isReservationStockMovement(movement: StockMovement): boolean {
    const origen = movement.origenTipo ?? '';
    return (
      origen === 'pedido_reserva' ||
      origen === 'pedido_liberacion_reserva' ||
      origen === 'pedido_transferencia_reserva'
    );
  }

  getMovementMotivoText(movement: StockMovement): string {
    const origen = movement.origenTipo ?? '';

    if (origen.startsWith('pedido')) {
      const normalized = normalizeOrderStockMotivo(
        movement.motivo ?? '',
        origen,
        movement.numeroPedidoLabel
      );
      const clientIdx = normalized.indexOf(' · ');
      return clientIdx > 0 ? normalized.slice(0, clientIdx) : normalized;
    }

    const motivo = (movement.motivo ?? '').trim();
    if (!motivo) return '—';

    const clientIdx = motivo.indexOf(' · ');
    return clientIdx > 0 ? motivo.slice(0, clientIdx) : motivo;
  }

  openOrder(movement: StockMovement) {
    if (!movement.pedidoId) return;
    this.router.navigate(['/orders', movement.pedidoId, 'edit']);
  }

  openMovementRow(movement: StockMovement) {
    if (movement.pedidoId) {
      this.openOrder(movement);
      return;
    }
    if (movement.ventaId) {
      this.router.navigate(['/sales'], { queryParams: { ventaId: movement.ventaId } });
      return;
    }
    if (movement.compraId) {
      this.router.navigate(['/purchases'], { queryParams: { detail: movement.compraId } });
      return;
    }
    if (movement.productoId) {
      this.router.navigate(['/stock', movement.productoId, 'edit']);
    }
  }

  openReservationRow(row: StockReservationRow) {
    if (!row.orderId) return;
    this.router.navigate(['/orders', row.orderId, 'edit']);
  }

  openEditItem(item: StockItem) {
    if (!item.id) return;
    this.router.navigate(['/stock', item.id, 'edit']);
  }

  duplicateItem(item: StockItem, event: Event) {
    event.stopPropagation();
    if (!item.id) return;
    this.router.navigate(['/stock/new'], { queryParams: { duplicate: item.id } });
  }

  confirmDeleteItem(item: StockItem) {
    if (!item.id) return;

    this.dialogService
      .confirm({
        title: 'Eliminar producto',
        message: `¿Eliminar ${item.nombre}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.stockService.deleteItem(item.id!).subscribe({
          next: () => this.refreshStockData(),
          error: () =>
            this.dialogService.alert({
              title: 'Error',
              message: 'No se pudo eliminar el producto.',
            }),
        });
      });
  }

  confirmDeleteMovement(movement: StockMovement) {
    if (!movement.id) return;

    if (!isDeletableStockMovement(movement)) {
      this.dialogService.alert({
        title: 'Movimiento vinculado',
        message:
          'Este movimiento está vinculado a un pedido, compra u otro documento y no se puede eliminar. Registrá un ajuste o documento con signo contrario desde el origen.',
      });
      return;
    }

    this.dialogService
      .confirm({
        title: 'Eliminar movimiento',
        message:
          `¿Eliminar este movimiento de ${movement.productoNombre || 'stock'}? ` +
          'Se revertirá la cantidad en el producto.',
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !movement.id) return;

        this.stockService.deleteMovement(movement.id).subscribe({
          next: () => {
            this.loadMovements();
            this.refreshStockData();
          },
          error: (err) =>
            this.dialogService.alert({
              title: 'No se puede eliminar',
              message: err?.error?.error || 'No se pudo eliminar el movimiento.',
            }),
        });
      });
  }

  private refreshStockData() {
    this.loadStock(true);
  }

  private onStockCatalogChanged(change?: StockCatalogChange | void) {
    const patch = change?.item;
    if (patch?.id) {
      const index = this.items.findIndex((item) => item.id === patch.id);
      if (index >= 0) {
        this.items[index] = { ...this.items[index], ...patch };
        this.items = this.sortItemsByName([...this.items]);
      }
    }
    this.loadStockMetrics(true);
    this.applyMetricsFromLoadedItems();
  }

  private loadStockMetrics(refresh = false) {
    this.stockService.getStockMetrics({ refresh }).subscribe({
      next: (metrics) => {
        this.stockMetrics = metrics;
        this.applyMetricsFromLoadedItems();
      },
      error: () => {
        this.stockMetrics = {
          totalItems: 0,
          lowStockCount: 0,
          valorDepositoEstimado: 0,
          updatedAt: '',
        };
      },
    });
  }

  private resolveOrigenGrupo(movement: StockMovement): StockOrigenGrupo {
    if (movement.origenGrupo) return movement.origenGrupo;
    const tipo = String(movement.origenTipo ?? '');
    if (tipo === 'compra' || movement.compraId) return 'compra';
    if (tipo.startsWith('pedido')) return 'pedido';
    if (tipo === 'venta' || tipo.startsWith('venta')) return 'venta';
    if (tipo === 'carga_inicial') return 'carga_inicial';
    if (tipo.startsWith('ajuste')) return 'ajuste';
    return 'otro';
  }

  private applyMetricsFromLoadedItems() {
    if (this.items.length === 0) return;
    const categoriasSinStock = this.appConfig.productos?.categoriasSinStock ?? [];
    this.stockMetrics = {
      ...this.stockMetrics,
      totalItems: this.items.length,
      lowStockCount: this.items.filter((item) => this.isLowStock(item)).length,
      valorDepositoEstimado: computeValorDepositoEstimado(this.items, categoriasSinStock),
    };
  }

  private loadStock(refreshMetrics = false) {
    this.loadingItems = true;
    this.productsPage = 1;
    this.stockService.getStock().subscribe({
      next: (items) => {
        this.items = this.sortItemsByName(items);
        this.loadingItems = false;
        if (refreshMetrics) {
          this.loadStockMetrics(true);
        } else {
          this.applyMetricsFromLoadedItems();
        }
      },
      error: () => {
        this.loadingItems = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los productos.',
        });
      },
    });
  }

  private loadMovements() {
    this.loadingMovements = true;
    this.stockService.getMovements().subscribe({
      next: (movements) => {
        this.movements = movements;
        this.movementsLoaded = true;
        this.loadingMovements = false;
      },
      error: () => {
        this.loadingMovements = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los movimientos de stock.',
        });
      },
    });
  }

  private loadReservations(stockItemId?: string) {
    this.loadingReservations = true;
    this.stockService.getReservations(stockItemId).subscribe({
      next: (data) => {
        this.reservationRows = data.rows;
        this.reservationsLoaded = true;
        this.loadingReservations = false;
      },
      error: () => {
        this.loadingReservations = false;
      },
    });
  }

  reservationTargetKey(target: ReservationTargetOrder): string {
    return `${target.orderId}:${target.lineIndex}`;
  }

  private parseReservationTargetKey(key: string): { orderId: string; lineIndex: number } | null {
    const [orderId, lineIndexRaw] = key.split(':');
    const lineIndex = Number(lineIndexRaw);
    if (!orderId || Number.isNaN(lineIndex)) return null;
    return { orderId, lineIndex };
  }

  openReservationTransfer(row: StockReservationRow) {
    this.transferReservationRow = row;
    this.transferTargetKey = '';
    this.transferQtyInput = String(row.cantidadActiva);
    this.transferTargets = [];
    this.loadingTransferTargets = true;

    this.orderService.getReservationTargets(row.stockItemId, row.orderId).subscribe({
      next: (targets) => {
        this.transferTargets = targets;
        this.loadingTransferTargets = false;
        if (targets.length === 1) {
          this.transferTargetKey = this.reservationTargetKey(targets[0]);
          this.transferQtyInput = String(
            Math.min(row.cantidadActiva, targets[0].cantidadRoom)
          );
        }
      },
      error: () => {
        this.loadingTransferTargets = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron buscar pedidos destino.',
        });
      },
    });
  }

  closeReservationTransfer() {
    this.transferReservationRow = null;
    this.transferTargets = [];
    this.transferTargetKey = '';
    this.transferQtyInput = '1';
    this.transferringReservation = false;
  }

  executeReservationTransfer() {
    const row = this.transferReservationRow;
    const parsed = this.parseReservationTargetKey(this.transferTargetKey);
    if (!row || !parsed) return;

    const cantidad = Number(this.transferQtyInput) || 0;
    if (cantidad <= 0) return;

    this.transferringReservation = true;
    this.orderService
      .transferStockReservation({
        sourceOrderId: row.orderId,
        targetOrderId: parsed.orderId,
        stockItemId: row.stockItemId,
        cantidad,
        sourceLineIndex: row.lineIndex,
        targetLineIndex: parsed.lineIndex,
      })
      .subscribe({
        next: () => {
          this.transferringReservation = false;
          this.closeReservationTransfer();
          this.loadReservations(this.reservationProductFilter || undefined);
          this.refreshStockData();
        },
        error: (err) => {
          this.transferringReservation = false;
          this.dialogService.alert({
            title: 'No se pudo transferir',
            message:
              typeof err.error?.error === 'string'
                ? err.error.error
                : 'Revisá la cantidad e intentá de nuevo.',
          });
        },
      });
  }
}

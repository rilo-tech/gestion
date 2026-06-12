import { Component, DestroyRef, Injector, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
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
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import { AuthService } from '../../core/services/auth.service';
import { isDeletableStockMovement } from '../../core/utils/deletion-rules';
import { PERMISSIONS } from '../../core/constants/permissions';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { LucideAngularModule } from 'lucide-angular';
import { ConceptRefLinksComponent } from '../../shared/components/concept-ref-links/concept-ref-links.component';
import {
  ICON_ACTION_LINK_CLASS,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { ActivityLogTriggerComponent } from '../../shared/components/activity-log-trigger/activity-log-trigger.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
  totalListPages,
} from '../../shared/components/list-pagination/list-pagination.component';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
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
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import { bindListPageRefreshOnReturn } from '../../core/utils/list-page-refresh';

type StockTab = 'productos' | 'movimientos' | 'reservas';

@Component({
  selector: 'app-stock',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, FormsModule, RouterLink, ConceptRefLinksComponent, HasPermissionDirective, ListPaginationComponent, ListRowActionsComponent, CompactListRowComponent, CompactInlineStatsComponent, ModulePageHeaderComponent, CompactDataListComponent, ListSearchFieldComponent],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Stock & Inventario"
        [showMobileSearch]="activeTab === 'productos' || activeTab === 'movimientos' || activeTab === 'reservas'"
        [searchQuery]="headerSearchQuery"
        (searchQueryChange)="onHeaderSearchChange($event)"
        [searchFieldName]="headerSearchFieldName"
        activityModule="stock"
        [showRefresh]="true"
        [refreshing]="loadingItems || loadingMoreProducts"
        (refreshClick)="reloadList()">
        <p headerExtra class="mt-2">
          <a routerLink="/stock/faltantes" class="text-sm font-semibold text-orange-700 hover:text-orange-900 hover:underline">
            Ver faltantes para comprar
          </a>
        </p>
        <a
          headerActions
          routerLink="/stock/new"
          [class]="iconActionLinkClass"
          aria-label="Nuevo producto"
          title="Nuevo producto">
          <i-lucide name="plus" class="w-4 h-4"></i-lucide>
          <span class="hidden sm:inline">Nuevo producto</span>
        </a>
      </app-module-page-header>

      <div class="mb-4 border-b border-gray-100 dark:border-gray-800">
        <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div class="flex min-w-0 gap-2 order-2 sm:order-1 overflow-x-auto">
            <button
              type="button"
              (click)="setTab('productos')"
              class="px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap"
              [class.border-teal-600]="activeTab === 'productos'"
              [class.text-teal-700]="activeTab === 'productos'"
              [class.border-transparent]="activeTab !== 'productos'"
              [class.text-gray-500]="activeTab !== 'productos'">
              Productos
            </button>
            <button
              type="button"
              (click)="setTab('movimientos')"
              class="px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap"
              [class.border-teal-600]="activeTab === 'movimientos'"
              [class.text-teal-700]="activeTab === 'movimientos'"
              [class.border-transparent]="activeTab !== 'movimientos'"
              [class.text-gray-500]="activeTab !== 'movimientos'">
              Movimientos
            </button>
            <button
              type="button"
              (click)="setTab('reservas')"
              class="px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap"
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

          <div class="order-1 sm:order-2 w-full sm:w-auto sm:ml-auto shrink-0 pb-2 sm:pb-2.5">
            <app-compact-inline-stats
              class="block w-full sm:w-auto"
              variant="strip"
              density="compact"
              align="end"
              [items]="stockSummaryKpiItems"
              ariaLabel="Resumen de stock">
            </app-compact-inline-stats>
          </div>
        </div>
      </div>

      <div
        *ngIf="lowStockOnly && activeTab === 'productos'"
        class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-800">
        <span>Productos con stock en o por debajo del mínimo.</span>
        <a routerLink="/stock" class="font-semibold text-orange-700 hover:underline">Ver todos</a>
      </div>

      <app-compact-data-list *ngIf="activeTab === 'productos'" [showSearch]="true">
        <div listSearch [class]="desktopListSearchWrapClass + ' px-3 py-2 sm:px-6 sm:py-4'">
          <app-list-search-field
            mode="filter"
            [(query)]="searchQuery"
            (queryChange)="onProductsSearchChange()"
            name="searchQuery"
            placeholder="Buscar por nombre o código..."
            extraClass="sm:max-w-md">
          </app-list-search-field>
        </div>

        <div listMobile class="sm:hidden native-compact-list">
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
          <p *ngIf="loadingItems || loadingProductSearch" [class]="compactListEmptyClass">
            {{ loadingProductSearch ? 'Buscando productos...' : 'Cargando productos...' }}
          </p>
          <p *ngIf="!loadingItems && !loadingProductSearch && items.length === 0 && !productSearchActive" [class]="compactListEmptyClass">
            No hay productos cargados. Usá <span class="font-semibold">Nuevo producto</span> para empezar.
          </p>
          <p *ngIf="!loadingItems && !loadingProductSearch && filteredItems.length === 0 && (productSearchActive || items.length > 0)" [class]="compactListEmptyClass">
            <ng-container *ngIf="lowStockOnly && !searchQuery.trim()">No hay productos con stock bajo.</ng-container>
            <ng-container *ngIf="!lowStockOnly || searchQuery.trim()">
              No se encontraron productos para "{{ searchQuery }}".
            </ng-container>
          </p>
        </div>

        <div listDesktop>
        <table [class]="nativeCompactTableClass + ' stock-products-table sm:table-fixed w-full max-w-full'">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th
                data-col-weight="28"
                class="px-2 sm:px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Item
              </th>
              <th
                *ngIf="showCodigoColumn"
                data-col-weight="5"
                class="px-1 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center whitespace-nowrap">
                Cód.
              </th>
              <th data-col-weight="13" class="px-1.5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Categoría</th>
              <th
                data-col-weight="6"
                class="px-0.5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center whitespace-nowrap"
                title="Unidades en depósito">
                Dep.
              </th>
              <th
                data-col-weight="6"
                class="px-0.5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center whitespace-nowrap"
                title="Apartadas para pedidos">
                Res.
              </th>
              <th
                data-col-weight="6"
                class="px-0.5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center whitespace-nowrap"
                title="Libre para usar en pedidos nuevos">
                Disp.
              </th>
              <th
                data-col-weight="4"
                class="px-0.5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center whitespace-nowrap"
                title="Mínimo de stock">
                Mín.
              </th>
              <th
                *appHasPermission="permissions.STOCK_VIEW_COSTS"
                data-col-weight="7"
                class="hidden xl:table-cell px-2 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                Costo ref.
              </th>
              <th
                *ngIf="auth.isAdmin"
                data-col-weight="7"
                class="hidden xl:table-cell px-2 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap"
                title="Costo × unidades en depósito">
                Valor est.
              </th>
              <th
                data-col-weight="9"
                class="stock-products-actions px-1 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let item of paginatedFilteredItems"
              (click)="openEditItem(item)"
              class="hover:bg-gray-50 transition-colors cursor-pointer">
              <td class="px-2 sm:px-3 py-3 max-w-0">
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
              <td *ngIf="showCodigoColumn" class="px-1 py-3 text-xs tabular-nums text-gray-700 text-center whitespace-nowrap">
                {{ item.codigo || '—' }}
              </td>
              <td class="px-1.5 py-3">
                <span
                  class="inline-flex w-fit max-w-full truncate px-2 py-0.5 text-xs rounded-full uppercase font-bold bg-teal-50 text-teal-700"
                  [title]="item.categoria || ''">
                  {{ item.categoria || '—' }}
                </span>
              </td>
              <td class="px-0.5 py-3 text-center text-xs tabular-nums whitespace-nowrap" [class]="stockTotalClass(item)">
                {{ stockUnitsLabel(item, 'actual') }}
              </td>
              <td class="px-0.5 py-3 text-center text-xs tabular-nums whitespace-nowrap" [class]="stockReservedClass(item)">
                {{ stockUnitsLabel(item, 'reservado') }}
              </td>
              <td class="px-0.5 py-3 text-center text-xs tabular-nums font-bold whitespace-nowrap" [class]="stockAvailableClass(item)">
                {{ stockUnitsLabel(item, 'disponible') }}
              </td>
              <td class="px-0.5 py-3 text-xs text-gray-600 tabular-nums text-center whitespace-nowrap">
                {{ stockUnitsLabel(item, 'minimo') }}
              </td>
              <td
                *appHasPermission="permissions.STOCK_VIEW_COSTS"
                class="hidden xl:table-cell px-2 py-3 text-sm text-gray-600 tabular-nums whitespace-nowrap">
                {{ formatMoney(item.costo || 0) }}
              </td>
              <td
                *ngIf="auth.isAdmin"
                class="hidden xl:table-cell px-2 py-3 text-sm text-right tabular-nums whitespace-nowrap"
                [class.text-teal-700]="itemValorEstimado(item) > 0"
                [class.font-medium]="itemValorEstimado(item) > 0"
                [class.text-gray-400]="itemValorEstimado(item) <= 0">
                {{ itemValorEstimadoLabel(item) }}
              </td>
              <td
                class="stock-products-actions px-1 py-3 text-right text-sm font-medium"
                (click)="$event.stopPropagation()">
                <app-list-row-actions
                  [showEdit]="auth.canEditRecords"
                  (editClick)="openEditItem(item)"
                  [showDuplicate]="auth.canEditRecords"
                  (duplicateClick)="duplicateItem(item, $event)"
                  [showDelete]="auth.canDeleteRecords"
                  (deleteClick)="confirmDeleteItem(item)">
                </app-list-row-actions>
              </td>
            </tr>
            <tr *ngIf="loadingItems || loadingProductSearch">
              <td [attr.colspan]="productTableDesktopColspan" class="px-6 py-12 text-center text-gray-400">
                {{ loadingProductSearch ? 'Buscando productos...' : 'Cargando productos...' }}
              </td>
            </tr>
            <tr *ngIf="!loadingItems && !loadingProductSearch && items.length === 0 && !productSearchActive">
              <td [attr.colspan]="productTableDesktopColspan" class="px-6 py-12 text-center text-gray-400">
                No hay productos cargados. Usá <span class="font-semibold">Nuevo producto</span> para empezar.
              </td>
            </tr>
            <tr *ngIf="!loadingItems && !loadingProductSearch && filteredItems.length === 0 && (productSearchActive || items.length > 0)">
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
          listFooter
          [page]="productsPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredItems.length"
          [canFetchMore]="productsHasMore && !searchQuery.trim()"
          [loadingMore]="loadingMoreProducts"
          (pageChange)="productsPage = $event"
          (fetchMore)="loadMoreProducts()">
        </app-list-pagination>
      </app-compact-data-list>

      <div *ngIf="activeTab === 'movimientos'" class="bg-white rounded-xl shadow-sm border border-gray-100">
        <p
          *ngIf="deletingMovementId"
          class="px-3 py-2 sm:px-6 text-xs sm:text-sm font-medium text-amber-800 bg-amber-50 border-b border-amber-100 flex items-center gap-2"
          role="status"
          aria-live="polite">
          <span
            class="inline-block w-3.5 h-3.5 rounded-full border-2 border-amber-300 border-t-amber-700 animate-spin shrink-0"
            aria-hidden="true"></span>
          Eliminando movimiento…
        </p>
        <div class="px-3 py-2 sm:px-6 sm:py-4 border-b border-gray-100 bg-gray-50 space-y-1.5 sm:space-y-2">
          <div class="grid grid-cols-1 gap-2 sm:flex sm:flex-row sm:items-center sm:gap-3">
            <app-list-search-field
              mode="filter"
              [(query)]="movementSearchQuery"
              (queryChange)="onMovementsSearchChange()"
              name="movementSearchQuery"
              placeholder="Buscar por producto o motivo..."
              [constrainWidth]="false"
              extraClass="hidden sm:block sm:flex-1 sm:min-w-0 sm:max-w-3xl">
            </app-list-search-field>
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
          <p *ngIf="loadingMovements" [class]="compactListEmptyClass">
            {{ deletingMovementId ? 'Eliminando movimiento…' : 'Cargando movimientos...' }}
          </p>
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
          <table [class]="nativeCompactTableClass + ' sm:table-fixed max-w-full'">
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
                <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-700 max-w-[12rem] lg:max-w-[16rem]">
                  <div class="leading-snug" [title]="getMovementMotivoTooltip(movement)">
                    <ng-container *ngIf="movement.pedidoId; else nonPedidoMotivo">
                      <app-concept-ref-links
                        [text]="getMovementPedidoMotivoLabel(movement)"
                        [pedidoId]="movement.pedidoId"
                        [numeroPedidoLabel]="movement.numeroPedidoLabel"
                        [pedidoQueryParams]="stockOrderReturnQueryParams()">
                      </app-concept-ref-links>
                      <div *ngIf="movement.clienteNombre?.trim()" class="text-xs text-gray-500 mt-0.5 truncate">
                        {{ movement.clienteNombre }}
                      </div>
                    </ng-container>
                    <ng-template #nonPedidoMotivo>
                      <div class="line-clamp-2 break-words">
                        <ng-container *ngIf="movement.ventaId; else motivoFallback">
                          <app-concept-ref-links
                            [text]="getMovementMotivoText(movement)"
                            [ventaId]="movement.ventaId"
                            [ventaLabel]="movement.ventaLabel">
                          </app-concept-ref-links>
                          <span *ngIf="movement.clienteNombre?.trim()" class="text-gray-500">
                            · {{ movement.clienteNombre }}
                          </span>
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
                      </div>
                    </ng-template>
                  </div>
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
                    [disabled]="!!deletingMovementId"
                    [attr.aria-busy]="deletingMovementId === movement.id"
                    class="inline-flex items-center justify-center p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                    <span
                      *ngIf="deletingMovementId === movement.id"
                      class="w-4 h-4 rounded-full border-2 border-red-300 border-t-red-600 animate-spin"
                      aria-hidden="true"></span>
                    <i-lucide
                      *ngIf="deletingMovementId !== movement.id"
                      name="trash-2"
                      class="w-4 h-4"></i-lucide>
                  </button>
                </td>
              </tr>
              <tr *ngIf="loadingMovements">
                <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                  {{ deletingMovementId ? 'Eliminando movimiento…' : 'Cargando movimientos...' }}
                </td>
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
          <p class="text-sm text-gray-600 desc-lg-only">
            Stock apartado para pedidos pendientes. El depósito real baja al pasar a producción.
          </p>
          <app-list-search-field
            mode="filter"
            [(query)]="reservationSearchQuery"
            (queryChange)="onReservationsSearchChange()"
            name="reservationSearchQuery"
            placeholder="Buscar producto, pedido o cliente..."
            extraClass="hidden sm:block sm:max-w-md">
          </app-list-search-field>
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
          <table [class]="nativeCompactTableClass + ' sm:table-fixed max-w-full'">
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
                    [queryParams]="stockOrderReturnQueryParams('reservas')"
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
  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
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

  get headerSearchQuery(): string {
    if (this.activeTab === 'movimientos') return this.movementSearchQuery;
    if (this.activeTab === 'reservas') return this.reservationSearchQuery;
    return this.searchQuery;
  }

  get headerSearchFieldName(): string {
    if (this.activeTab === 'movimientos') return 'movementSearchQueryMobile';
    if (this.activeTab === 'reservas') return 'reservationSearchQueryMobile';
    return 'searchQueryMobile';
  }

  onHeaderSearchChange(value: string) {
    if (this.activeTab === 'movimientos') {
      this.movementSearchQuery = value;
      this.onMovementsSearchChange();
      return;
    }
    if (this.activeTab === 'reservas') {
      this.reservationSearchQuery = value;
      this.onReservationsSearchChange();
      return;
    }
    this.searchQuery = value;
    this.onProductsSearchChange();
  }

  private stockService = inject(StockService);
  private orderService = inject(OrderService);
  private configService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private configSub?: Subscription;
  private catalogSub?: Subscription;

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
  loadingProductSearch = false;
  searchResultItems: StockItem[] = [];
  private productSearchTimeout?: ReturnType<typeof setTimeout>;
  loadingMoreProducts = false;
  productsHasMore = false;
  productsNextCursor: string | null = null;
  private productsLoadMorePageBefore = 0;
  private productsLoadMoreTotalPagesBefore = 0;
  loadingMovements = false;
  deletingMovementId: string | null = null;
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
    bindListPageRefreshOnReturn({
      listPath: '/stock',
      reload: () => this.reloadList(),
      router: this.router,
      destroyRef: this.destroyRef,
      injector: this.injector,
    });
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

    this.loadStockMetrics(false);
    this.loadStock(false);
    this.stockService.preloadSearchIndex();
  }

  ngOnDestroy() {
    window.clearTimeout(this.productSearchTimeout);
    this.configSub?.unsubscribe();
    this.catalogSub?.unsubscribe();
  }

  get productSearchActive(): boolean {
    return this.searchQuery.trim().length >= 2;
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
      this.loadStockMetrics(false);
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
    window.clearTimeout(this.productSearchTimeout);

    const query = this.searchQuery.trim();
    if (query.length < 2) {
      this.loadingProductSearch = false;
      this.searchResultItems = [];
      return;
    }

    this.loadingProductSearch = true;
    this.productSearchTimeout = window.setTimeout(() => {
      this.runProductSearch(query);
    }, 200);
  }

  private runProductSearch(query: string) {
    this.stockService.searchStockForList(query).subscribe({
      next: (hits) => {
        this.searchResultItems = this.enrichSearchHits(hits);
        this.loadingProductSearch = false;
      },
      error: () => {
        this.searchResultItems = [];
        this.loadingProductSearch = false;
      },
    });
  }

  private enrichSearchHits(hits: StockItem[]): StockItem[] {
    const loadedById = new Map(
      this.items
        .filter((item) => item.id)
        .map((item) => [String(item.id), item] as const)
    );

    return hits.map((hit) => {
      const id = String(hit.id ?? '').trim();
      const loaded = id ? loadedById.get(id) : undefined;
      if (!loaded) return this.normalizeSearchHit(hit);
      return { ...loaded, ...hit, nombre: hit.nombre || loaded.nombre };
    });
  }

  private normalizeSearchHit(hit: StockItem): StockItem {
    return {
      ...hit,
      tipo: hit.tipo || 'producto',
      stockActual: Number(hit.stockActual) || 0,
      stockReservado: Number(hit.stockReservado) || 0,
      stockMinimo: Number(hit.stockMinimo) || 0,
    };
  }

  private itemMatchesNameOrCode(item: StockItem, query: string): boolean {
    const normalized = query
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!normalized) return true;

    const compactQuery = normalized.replace(/\s+/g, '');
    const name = [item.nombre, item.nombreBase]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const codigo = String(item.codigo ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');

    if (codigo && (codigo.includes(compactQuery) || compactQuery.includes(codigo))) {
      return true;
    }

    return name.includes(normalized);
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
      return computeValorDepositoEstimado(this.items);
    }
    return this.stockMetrics.valorDepositoEstimado;
  }

  get stockSummaryKpiItems(): CompactInlineStat[] {
    const items: CompactInlineStat[] = [
      { label: 'Total items', value: String(this.totalItemsCount) },
      {
        label: 'Con stock bajo',
        value: String(this.lowStockCount),
        tone: this.lowStockCount > 0 ? 'warning' : 'default',
      },
    ];
    if (this.auth.canViewStockCosts) {
      items.push({
        label: 'Valor estimado',
        value: this.formatStockMoney(this.estimatedStockValue),
        tone: 'success',
      });
    }
    return items;
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
    return computeItemValorEstimado(item);
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
    const query = this.searchQuery.trim();
    let list =
      query.length >= 2 ? this.searchResultItems : this.items;

    if (query.length > 0 && query.length < 2) {
      list = list.filter((item) => this.itemMatchesNameOrCode(item, query));
    }

    if (this.lowStockOnly) {
      list = list.filter((item) => this.isLowStock(item));
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
    return itemIsLowStock(item);
  }

  controlsStockItem(item: StockItem): boolean {
    return itemControlsStock(item);
  }

  stockUnitsLabel(
    item: StockItem,
    field: 'actual' | 'reservado' | 'disponible' | 'minimo'
  ): string {
    if (!this.controlsStockItem(item)) return '—';
    const value =
      field === 'actual'
        ? item.stockActual
        : field === 'reservado'
          ? item.stockReservado || 0
          : field === 'disponible'
            ? this.getStockDisponible(item)
            : item.stockMinimo || 0;
    return `${value}u`;
  }

  get showCodigoColumn(): boolean {
    if (this.appConfig.productos?.codigo?.automatico) return true;
    return this.items.some((item) => String(item.codigo ?? '').trim().length > 0);
  }

  get productTableDesktopColspan(): number {
    let cols = 7;
    if (this.showCodigoColumn) cols += 1;
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
    const codigo = String(item.codigo ?? '').trim();
    if (!this.controlsStockItem(item)) {
      const categoria = String(item.categoria ?? '').trim();
      const parts = [codigo, categoria ? `${categoria} · Servicio` : 'Servicio'].filter(Boolean);
      return parts.join(' · ');
    }
    const color = String(item.color ?? '').trim();
    const talle = String(item.talle ?? '').trim();
    const variant = [codigo, color, talle].filter(Boolean).join(' · ');
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

  getMovementPedidoMotivoLabel(movement: StockMovement): string {
    const label = movement.numeroPedidoLabel?.trim();
    if (label) return `Pedido #${label}`;
    const hash = (movement.motivo ?? '').match(/(#\S+)/)?.[1];
    return hash ? `Pedido ${hash}` : 'Pedido';
  }

  getMovementMotivoTooltip(movement: StockMovement): string {
    const motivo = (movement.motivo ?? '').trim();
    if (motivo) return motivo;
    if (movement.pedidoId) {
      const parts = [this.getMovementPedidoMotivoLabel(movement)];
      if (movement.clienteNombre?.trim()) parts.push(movement.clienteNombre.trim());
      return parts.join(' · ');
    }
    const parts = [this.getMovementMotivoText(movement)];
    if (movement.clienteNombre?.trim()) {
      parts.push(movement.clienteNombre.trim());
    }
    return parts.filter((part) => part && part !== '—').join(' · ');
  }

  openOrder(movement: StockMovement) {
    if (!movement.pedidoId) return;
    this.router.navigate(['/orders', movement.pedidoId, 'edit'], {
      queryParams: this.stockOrderReturnQueryParams(),
    });
  }

  stockOrderReturnQueryParams(tab: StockTab = this.activeTab): Record<string, string> {
    return {
      returnTo: 'stock',
      stockTab: tab,
    };
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
      this.router.navigate(['/purchases', movement.compraId]);
      return;
    }
    if (movement.productoId) {
      this.router.navigate(['/stock', movement.productoId, 'edit']);
    }
  }

  openReservationRow(row: StockReservationRow) {
    if (!row.orderId) return;
    this.router.navigate(['/orders', row.orderId, 'edit'], {
      queryParams: this.stockOrderReturnQueryParams('reservas'),
    });
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
    if (!movement.id || !this.auth.canDeleteRecords || this.deletingMovementId) return;

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

        this.deletingMovementId = movement.id;
        this.stockService.deleteMovement(movement.id).subscribe({
          next: () => {
            this.loadMovements();
            this.refreshStockData();
          },
          error: (err) => {
            this.deletingMovementId = null;
            this.dialogService.alert({
              title: 'No se puede eliminar',
              message: err?.error?.error || 'No se pudo eliminar el movimiento.',
            });
          },
        });
      });
  }

  reloadList() {
    this.stockService.clearListCaches();
    this.productsPage = 1;
    this.movementsPage = 1;
    this.reservationsPage = 1;
    this.movementsLoaded = false;
    this.reservationsLoaded = false;
    this.loadStock(true);
    this.stockService.preloadSearchIndex();
    if (this.activeTab === 'movimientos') {
      this.loadMovements();
    } else if (this.activeTab === 'reservas') {
      this.loadReservations(this.reservationProductFilter || undefined);
    }
    this.loadStockMetrics(false);
  }

  private refreshStockData() {
    this.loadStock(true);
  }

  loadMoreProducts() {
    if (!this.productsHasMore || !this.productsNextCursor || this.loadingMoreProducts || this.loadingItems) {
      return;
    }
    if (this.searchQuery.trim()) return;
    this.productsLoadMorePageBefore = this.productsPage;
    this.productsLoadMoreTotalPagesBefore = totalListPages(this.filteredItems.length, this.listPageSize);
    this.loadStock(false, true);
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
    const query = this.searchQuery.trim();
    if (query.length >= 2) {
      this.runProductSearch(query);
    }
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
    this.stockMetrics = {
      ...this.stockMetrics,
      totalItems: this.items.length,
      lowStockCount: this.items.filter((item) => this.isLowStock(item)).length,
      valorDepositoEstimado: computeValorDepositoEstimado(this.items),
    };
  }

  private loadStock(refreshMetrics = false, append = false) {
    if (append) {
      this.loadingMoreProducts = true;
    } else {
      this.loadingItems = true;
      this.productsPage = 1;
      this.productsNextCursor = null;
    }

    this.stockService
      .getStockPage(120, append ? this.productsNextCursor ?? undefined : undefined)
      .subscribe({
        next: (page) => {
          const incoming = page.items ?? [];
          const merged = append
            ? this.sortItemsByName([
                ...this.items,
                ...incoming.filter((item) => !this.items.some((existing) => existing.id === item.id)),
              ])
            : this.sortItemsByName(incoming);
          this.items = merged;
          this.productsHasMore = page.hasMore;
          this.productsNextCursor = page.nextCursor;
          if (append && this.productsLoadMoreTotalPagesBefore > 0) {
            if (this.productsLoadMorePageBefore >= this.productsLoadMoreTotalPagesBefore) {
              this.productsPage = Math.min(
                this.productsLoadMorePageBefore + 1,
                totalListPages(this.filteredItems.length, this.listPageSize)
              );
            }
            this.productsLoadMorePageBefore = 0;
            this.productsLoadMoreTotalPagesBefore = 0;
          }
          this.loadingItems = false;
          this.loadingMoreProducts = false;
          if (refreshMetrics) {
            this.loadStockMetrics(true);
          } else if (!this.stockMetrics.updatedAt) {
            this.applyMetricsFromLoadedItems();
          }
        },
        error: () => {
          this.loadingItems = false;
          this.loadingMoreProducts = false;
          this.productsLoadMorePageBefore = 0;
          this.productsLoadMoreTotalPagesBefore = 0;
          this.dialogService.alert({
            title: 'Error',
            message: 'No se pudieron cargar los productos.',
          });
        },
      });
  }

  private loadMovements() {
    this.loadingMovements = true;
    this.stockService.getMovements().pipe(finalize(() => {
      this.deletingMovementId = null;
    })).subscribe({
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

import { Component, DestroyRef, ElementRef, Injector, ViewChild, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CashMovement, CashService, CashSummary } from '../../core/services/cash.service';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
  findCategoriaGastoByLabel,
  getCashMovementConceptOptions,
  getCashOrigenNombre,
  getCajaAmbitos,
  getDefaultCashAmbitoId,
  resolveCategoriaIdForCashConcept,
  usesCashMovementConceptPicker,
  usesCashAmbitoSeparation,
  resolveCashAmbito,
  getCashAmbitoLabel,
  CashAmbito,
  CajaAmbitoConfig,
} from '../../core/services/catalog-config.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { isDeletableCashMovement } from '../../core/utils/deletion-rules';
import {
  CalendarMonthRange,
  formatMonthYearLabel,
  getCalendarMonthRange,
  isIsoDateInRange,
  monthYearQueryParams,
  parseMonthYearQueryParams,
} from '../../core/utils/calendar-range';
import {
  computeCashPeriodKpisFromMovements,
} from '../../core/utils/cash-period-summary';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  IconActionComponent,
  LIST_TABLE_ROW_CLASS,
  LIST_TOOLBAR_CONTROL_HEIGHT,
  PAGE_SHELL_CLASS,
  TABLE_SCROLL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import { CompactListRowComponent } from '../../shared/components/compact-list/compact-list-row.component';
import {
  CompactInlineStat,
  CompactInlineStatsComponent,
} from '../../shared/components/compact-list/compact-inline-stats.component';
import {
  COMPACT_LIST_EMPTY_CLASS,
  COMPACT_LIST_ROW_CLASS,
  NATIVE_COMPACT_LIST_CLASS,
  NATIVE_COMPACT_TABLE_CLASS,
} from '../../shared/components/compact-list/compact-list.constants';
import { ListRowActionsComponent } from '../../shared/components/list-row-actions/list-row-actions.component';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPaginationComponent,
  paginateSlice,
} from '../../shared/components/list-pagination/list-pagination.component';
import { RecordActionToolbarComponent } from '../../shared/components/icon-toolbar';
import { CompactDataListComponent } from '../../shared/components/compact-list/compact-data-list.component';
import { ListLoadMoreComponent } from '../../shared/components/list-load-more/list-load-more.component';
import { FORM_CANCEL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { ConceptRefLinksComponent } from '../../shared/components/concept-ref-links/concept-ref-links.component';
import { ModulePageHeaderComponent } from '../../shared/components/module-page-header/module-page-header.component';
import { LucideAngularModule } from 'lucide-angular';
import {
  LIST_SEARCH_INPUT_CLASS,
  ListSearchFieldComponent,
} from '../../shared/components/list-search-field/list-search-field.component';
import {
  TransactionDateFieldComponent,
  TransactionSaveBannerComponent,
  TransactionSaveFeedback,
} from '../../shared/components/transaction-form';
import {
  combineDateAndTimeToIso,
  currentTimeInputValue,
  todayDateInputValue,
  toDateInputValue,
  toTimeInputValue,
  formatDisplayDate,
  formatIsoDatesInText,
} from '../../core/utils/transaction-date';
import { Subscription, finalize } from 'rxjs';
import { bindListPageRefreshOnReturn } from '../../core/utils/list-page-refresh';
import {
  buildCashReturnQueryParams,
} from '../../core/utils/cash-return-context';
import { sortCashMovementsByRecency } from '../../../../../shared/cash-movement-sort.ts';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import {
  PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE,
  PROGRESSIVE_LIST_FIRST_PAGE_SIZE,
  ProgressiveListSession,
} from '../../core/utils/progressive-list-load';

@Component({
  selector: 'app-cash',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SearchableSelectComponent,
    TransactionModalComponent,
    IconActionComponent,
    ConceptRefLinksComponent,
    ModulePageHeaderComponent,
    CompactInlineStatsComponent,
    ListRowActionsComponent,
    ListPaginationComponent,
    CompactListRowComponent,
    RecordActionToolbarComponent,
    CompactDataListComponent,
    ListLoadMoreComponent,
    ListSearchFieldComponent,
    TransactionDateFieldComponent,
    TransactionSaveBannerComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Caja"
        description="Ingresos y egresos del negocio. Pedidos y ventas se registran solos; usá Ingreso o Egreso para movimientos manuales."
        [showMobileSearch]="true"
        [(searchQuery)]="searchQuery"
        (searchQueryChange)="movementsPage = 1"
        searchFieldName="cashSearchQueryMobile"
        activityModule="cash"
        [showRefresh]="true"
        [refreshing]="loading"
        (refreshClick)="reloadList()">
        <ng-container headerActions *ngIf="auth.canEditRecords">
          <app-icon-action label="Ingreso" (clicked)="openMovementModal('ingreso')">
            <i-lucide name="arrow-up" class="w-4 h-4"></i-lucide>
          </app-icon-action>
          <app-icon-action label="Egreso" variant="danger" (clicked)="openMovementModal('egreso')">
            <i-lucide name="arrow-down" class="w-4 h-4"></i-lucide>
          </app-icon-action>
        </ng-container>
      </app-module-page-header>

      <div *ngIf="usesAmbitoSeparation" class="mb-3">
        <div class="rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div class="flex items-stretch border-b border-gray-100">
            <div class="flex min-w-0 flex-1 gap-0">
              <button
                *ngFor="let ambito of cajaAmbitos"
                type="button"
                (click)="activeAmbitoTab = ambito.id"
                class="px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap"
                [class.border-teal-600]="activeAmbitoTab === ambito.id"
                [class.text-teal-700]="activeAmbitoTab === ambito.id"
                [class.bg-teal-50]="activeAmbitoTab === ambito.id"
                [class.border-transparent]="activeAmbitoTab !== ambito.id"
                [class.text-gray-500]="activeAmbitoTab !== ambito.id">
                {{ ambito.label }}
              </button>
            </div>
            <div
              *ngIf="cajaAmbitos.length > 1"
              class="flex shrink-0 items-center gap-2 border-l-2 border-teal-600/40 bg-teal-50/70 px-3 py-2 text-sm">
              <span class="text-[10px] font-semibold uppercase tracking-wide text-teal-800/70">Total neto</span>
              <span class="text-base font-bold tabular-nums text-teal-900">{{ formatMoney(totalNetoSaldo) }}</span>
            </div>
          </div>
          <div class="px-2 py-1 sm:px-3 sm:py-1.5 border-t border-gray-100 dark:border-gray-800">
            <app-compact-inline-stats
              class="block sm:hidden"
              variant="strip"
              density="compact"
              [items]="activeAmbitoKpiItemsCompact"
              [centerCaption]="kpiPeriodMonthLabel"
              ariaLabel="Indicadores del mes y saldo">
            </app-compact-inline-stats>
            <app-compact-inline-stats
              class="hidden sm:block"
              variant="strip"
              [items]="activeAmbitoKpiItems"
              [centerCaption]="kpiPeriodMonthLabel"
              ariaLabel="Indicadores del mes y saldo acumulado">
            </app-compact-inline-stats>
          </div>
        </div>
      </div>

      <div
        *ngIf="!usesAmbitoSeparation"
        class="mb-2 sm:mb-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-2 py-1 sm:px-3 sm:py-2 shadow-sm">
        <app-compact-inline-stats
          class="block sm:hidden"
          variant="strip"
          density="compact"
          [items]="cashKpiItemsCompact"
          [centerCaption]="kpiPeriodMonthLabel"
          ariaLabel="Indicadores del mes y saldo">
        </app-compact-inline-stats>
        <app-compact-inline-stats
          class="hidden sm:block"
          variant="strip"
          [items]="cashKpiItems"
          [centerCaption]="kpiPeriodMonthLabel"
          ariaLabel="Indicadores del mes y saldo acumulado">
        </app-compact-inline-stats>
      </div>

      <app-compact-data-list [showSearch]="true">
        <div listSearch>
          <div class="hidden sm:flex sm:items-center sm:gap-3 w-full min-w-0">
            <div class="min-w-0 flex-1">
              <app-list-search-field
                mode="filter"
                [(query)]="searchQuery"
                (queryChange)="movementsPage = 1"
                name="cashSearchQuery"
                placeholder="Buscar..."
                [constrainWidth]="false"
                extraClass="w-full">
              </app-list-search-field>
            </div>
            <input
              type="month"
              [ngModel]="filterMonthInput"
              (ngModelChange)="onFilterMonthChange($event)"
              name="cashFilterMonth"
              [disabled]="loading"
              title="Filtrar por mes"
              [class]="listMonthFilterClass" />
          </div>
          <input
            type="month"
            [ngModel]="filterMonthInput"
            (ngModelChange)="onFilterMonthChange($event)"
            name="cashFilterMonthMobile"
            [disabled]="loading"
            title="Filtrar por mes"
            [class]="'sm:hidden w-full mt-2 ' + listSearchInputClass" />
        </div>
        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <app-compact-list-row
            *ngFor="let movement of paginatedFilteredMovements"
            (activate)="onMovementRowClick(movement)">
            <div compactTitle class="compact-list-title truncate">
              {{ getMovementMobileTitle(movement) }}
            </div>
            <div compactSubtitle class="compact-list-subtitle truncate">
              {{ formatDate(movement.fecha) }} · {{ getOrigenLabel(movement) }}<ng-container *ngIf="getMovementDescripcionDisplay(movement) !== '—'"> · {{ getMovementDescripcionDisplay(movement) }}</ng-container>
            </div>
            <span
              compactTrailing
              class="text-[11px] font-bold tabular-nums"
              [class.text-teal-600]="movement.tipo === 'ingreso'"
              [class.text-red-500]="movement.tipo === 'egreso'">
              {{ movement.tipo === 'egreso' ? '-' : '+' }}{{ formatMoney(movement.monto || 0) }}
            </span>
          </app-compact-list-row>
          <p *ngIf="loading" [class]="compactListEmptyClass">Cargando movimientos...</p>
          <p *ngIf="!loading && movements.length === 0" [class]="compactListEmptyClass">
            Todavía no hay movimientos. Se registran al confirmar pedidos o manualmente desde arriba.
          </p>
          <p *ngIf="!loading && movements.length > 0 && filteredMovements.length === 0" [class]="compactListEmptyClass">
            No se encontraron movimientos con los filtros actuales.
          </p>
        </div>
        <div listDesktop class="hidden sm:block" [class]="tableScrollClass">
        <table [class]="nativeCompactTableClass + ' cash-movements-table table-fixed w-full max-w-full'">
          <colgroup>
            <col style="width: 4.75rem" />
            <col style="width: 18%" />
            <col style="width: 33%" />
            <col style="width: 9.5rem" />
            <col style="width: 7.25rem" />
            <col style="width: 5.25rem" />
          </colgroup>
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="hidden sm:table-cell px-3 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-3 sm:px-4 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Concepto</th>
              <th class="hidden sm:table-cell px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Descripción</th>
              <th class="hidden sm:table-cell px-2 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Origen</th>
              <th class="px-3 sm:px-4 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Monto</th>
              <th class="hidden sm:table-cell px-2 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let movement of paginatedFilteredMovements"
              (click)="onMovementRowClick(movement)"
              [class]="listTableRowClass">
              <td class="hidden sm:table-cell px-3 py-4 text-xs text-gray-500 whitespace-nowrap tabular-nums">
                {{ formatDate(movement.fecha) }}
              </td>
              <td class="px-3 sm:px-4 py-3 sm:py-4 max-w-0">
                <div class="text-xs font-medium text-gray-700 truncate">
                  <app-concept-ref-links
                    [text]="getMovementConceptoDisplay(movement)"
                    [pedidoId]="movement.pedidoId"
                    [ventaId]="movement.ventaId"
                    [compraId]="resolveMovementCompraId(movement)"
                    [numeroPedidoLabel]="getOrderNumberLabel(movement)"
                    [ventaLabel]="movement.ventaLabel"
                    [compraLabel]="movement.compraLabel">
                  </app-concept-ref-links>
                </div>
                <div class="text-xs text-gray-400 mt-0.5 sm:hidden">
                  {{ formatDate(movement.fecha) }} · {{ getOrigenLabel(movement) }}<ng-container *ngIf="getMovementDescripcionDisplay(movement) !== '—'"> · {{ getMovementDescripcionDisplay(movement) }}</ng-container>
                </div>
              </td>
              <td class="hidden sm:table-cell px-4 py-4 text-sm font-semibold text-gray-900 dark:text-gray-100 max-w-0">
                <span
                  class="block truncate leading-snug"
                  [class.text-gray-400]="getMovementDescripcionDisplay(movement) === '—'"
                  [class.font-normal]="getMovementDescripcionDisplay(movement) === '—'"
                  [title]="getMovementDescripcionDisplay(movement)">
                  {{ getMovementDescripcionDisplay(movement) }}
                </span>
              </td>
              <td class="hidden sm:table-cell px-2 py-4 text-center whitespace-nowrap">
                <span
                  class="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-medium max-w-full truncate"
                  [ngClass]="getOrigenBadgeClass(movement)">
                  {{ getOrigenLabel(movement) }}
                </span>
              </td>
              <td
                class="px-3 sm:px-4 py-3 sm:py-4 text-sm font-semibold text-right tabular-nums whitespace-nowrap"
                [class.text-teal-600]="movement.tipo === 'ingreso'"
                [class.text-red-500]="movement.tipo === 'egreso'">
                {{ movement.tipo === 'egreso' ? '-' : '+' }}{{ formatMoney(movement.monto || 0) }}
              </td>
              <td class="hidden sm:table-cell px-2 py-3 text-sm font-medium whitespace-nowrap text-right" (click)="$event.stopPropagation()">
                <app-list-row-actions
                  *ngIf="showDesktopMovementRowActions"
                  [showDuplicate]="auth.canEditRecords"
                  (duplicateClick)="duplicateMovement(movement, $event)"
                  [showEdit]="auth.canEditRecords"
                  [showDelete]="canDeleteCashAsAdmin"
                  (editClick)="openEditMovement(movement)"
                  (deleteClick)="confirmDeleteMovement(movement)">
                </app-list-row-actions>
              </td>
            </tr>
            <tr *ngIf="loading">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">Cargando movimientos...</td>
            </tr>
            <tr *ngIf="!loading && movements.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                Todavía no hay movimientos. Se registran al confirmar pedidos o manualmente desde arriba.
              </td>
            </tr>
            <tr *ngIf="!loading && movements.length > 0 && filteredMovements.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-400">
                No se encontraron movimientos con los filtros actuales.
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <app-list-pagination
          listFooter
          [page]="movementsPage"
          [pageSize]="listPageSize"
          [totalItems]="filteredMovements.length"
          (pageChange)="movementsPage = $event">
        </app-list-pagination>
        <app-list-load-more
          listFooter
          [hasMore]="hasMoreMovements"
          [loading]="loadingMoreMovements"
          label="Cargar más movimientos"
          loadingLabel="Cargando más..."
          (loadMoreClick)="loadMoreMovements()">
        </app-list-load-more>
      </app-compact-data-list>
    </div>

    <app-transaction-modal
      [open]="movementModalOpen"
      [title]="movementModalTitle"
      [subtitle]="movementModalSubtitle"
      [compact]="true"
      [hideSubtitleOnMobile]="true"
      maxWidthClass="max-w-lg"
      (closed)="closeMovementModal()">
      <div headerActions *ngIf="showMovementModalActions" class="inline-flex items-center gap-1 shrink-0">
        <app-record-action-toolbar
          activityModule="cash"
          [activityEntityId]="editingMovementId"
          [showEdit]="canEditFromDetail"
          editLabel="Editar"
          [editDisabled]="savingMovement"
          (editClick)="enableMovementEditFromDetail()"
          [showDuplicate]="canDuplicateInModal"
          duplicateLabel="Duplicar"
          [duplicateDisabled]="savingMovement"
          (duplicateClick)="duplicateMovementInModal()"
          [showDelete]="canDeleteInModal"
          deleteLabel="Eliminar"
          [deleteDisabled]="savingMovement"
          (deleteClick)="confirmDeleteEditingMovement()">
        </app-record-action-toolbar>
      </div>

        <div class="space-y-2.5 sm:space-y-3">
          <app-transaction-save-banner [message]="movementSaveFeedback.successMessage"></app-transaction-save-banner>
          <p
            *ngIf="movementSaveHint"
            class="text-[11px] sm:text-xs text-teal-800 bg-teal-50 border border-teal-100 rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2"
            role="status">
            {{ movementSaveHint }}
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_8.5rem] gap-2 sm:gap-3">
            <div #movementConceptField>
              <label class="block text-xs font-medium text-gray-700 mb-0.5">
                {{ movementTipo === 'egreso' ? 'Gasto / concepto' : 'Concepto' }}
              </label>
              <div
                *ngIf="movementViewOnly && editingMovement && hasMovementTransactionLink(editingMovement)"
                class="w-full px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-900">
                <app-concept-ref-links
                  [text]="getMovementConceptoDisplay(editingMovement)"
                  [pedidoId]="editingMovement.pedidoId"
                  [ventaId]="editingMovement.ventaId"
                  [compraId]="resolveMovementCompraId(editingMovement)"
                  [numeroPedidoLabel]="getOrderNumberLabel(editingMovement)"
                  [ventaLabel]="editingMovement.ventaLabel"
                  [compraLabel]="editingMovement.compraLabel"
                  [pedidoQueryParams]="cashTransactionReturnQueryParams"
                  [ventaQueryParams]="cashTransactionReturnQueryParams"
                  [compraQueryParams]="cashTransactionReturnQueryParams">
                </app-concept-ref-links>
              </div>
              <app-searchable-select
                *ngIf="usesConceptList && !(movementViewOnly && editingMovement && hasMovementTransactionLink(editingMovement))"
                [(ngModel)]="movementConcepto"
                (ngModelChange)="onMovementConceptoChange($event)"
                name="movementConcepto"
                [options]="conceptOptions"
                [allowCustomValue]="true"
                [showDropdownOnTypeOnly]="true"
                [disabled]="movementFormDisabled"
                [placeholder]="movementConceptPickerPlaceholder"
                [plainPlaceholder]="movementConceptPlainPlaceholder">
              </app-searchable-select>
              <input
                *ngIf="!usesConceptList && !(movementViewOnly && editingMovement && hasMovementTransactionLink(editingMovement))"
                #movementConceptoText
                [(ngModel)]="movementConcepto"
                name="movementConceptoText"
                placeholder="Ej. Venta mostrador"
                [disabled]="movementFormDisabled"
                class="w-full px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50">
            </div>
            <div class="hidden sm:block">
              <label class="block text-xs font-medium text-gray-700 mb-0.5">Monto</label>
              <input
                #movementMontoInput
                type="number"
                [(ngModel)]="movementMonto"
                name="movementMonto"
                min="1"
                step="1"
                placeholder="0"
                [disabled]="movementFormDisabled"
                class="w-full px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-gray-200 text-sm tabular-nums text-center sm:text-left outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
            </div>
          </div>

          <app-transaction-date-field
            [date]="movementFecha"
            (dateChange)="movementFecha = $event"
            [time]="movementHora"
            (timeChange)="movementHora = $event"
            fieldName="movementFecha"
            timeFieldName="movementHora"
            label="Fecha"
            timeLabel="Hora"
            [showTime]="true"
            [disabled]="movementFormDisabled">
          </app-transaction-date-field>

          <div
            class="grid gap-2 sm:gap-3"
            [ngClass]="usesAmbitoSeparation ? 'grid-cols-2' : 'grid-cols-1'">
            <div class="min-w-0 flex flex-col">
              <span class="block text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1 min-h-[1.125rem] sm:min-h-[1.375rem]">Tipo</span>
              <div class="min-h-10 flex items-center">
                <div class="grid grid-cols-2 gap-1 w-full rounded-lg sm:rounded-xl border border-gray-200 bg-gray-50 p-0.5 sm:p-1">
                <button
                  type="button"
                  (click)="setMovementTipo('ingreso')"
                  [disabled]="movementFormDisabled"
                  title="Ingreso"
                  aria-label="Ingreso"
                  class="inline-flex items-center justify-center gap-1 rounded-md sm:rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-sm font-semibold transition-colors min-h-[36px] sm:min-h-0 disabled:opacity-70 disabled:cursor-default"
                  [class.bg-teal-600]="movementTipo === 'ingreso'"
                  [class.text-white]="movementTipo === 'ingreso'"
                  [class.shadow-sm]="movementTipo === 'ingreso'"
                  [class.text-gray-600]="movementTipo !== 'ingreso'"
                  [class.hover:bg-white]="movementTipo !== 'ingreso'">
                  <i-lucide name="arrow-up" class="w-4 h-4 shrink-0"></i-lucide>
                  <span class="hidden sm:inline">Ingreso</span>
                </button>
                <button
                  type="button"
                  (click)="setMovementTipo('egreso')"
                  [disabled]="movementFormDisabled"
                  title="Egreso"
                  aria-label="Egreso"
                  class="inline-flex items-center justify-center gap-1 rounded-md sm:rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-sm font-semibold transition-colors min-h-[36px] sm:min-h-0 disabled:opacity-70 disabled:cursor-default"
                  [class.bg-red-500]="movementTipo === 'egreso'"
                  [class.text-white]="movementTipo === 'egreso'"
                  [class.shadow-sm]="movementTipo === 'egreso'"
                  [class.text-gray-600]="movementTipo !== 'egreso'"
                  [class.hover:bg-white]="movementTipo !== 'egreso'">
                  <i-lucide name="arrow-down" class="w-4 h-4 shrink-0"></i-lucide>
                  <span class="hidden sm:inline">Egreso</span>
                </button>
                </div>
              </div>
            </div>
            <div *ngIf="usesAmbitoSeparation" class="min-w-0 flex flex-col">
              <span class="block text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1 min-h-[1.125rem] sm:min-h-[1.375rem]">Ámbito</span>
              <div class="min-h-10 flex items-center">
                <div
                  class="grid gap-1 sm:gap-1.5 w-full"
                  [ngClass]="cajaAmbitos.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
                <button
                  *ngFor="let ambito of cajaAmbitos; trackBy: trackCajaAmbitoId"
                  type="button"
                  (click)="selectMovementAmbito(ambito.id, $event)"
                  [disabled]="movementFormDisabled"
                  [title]="ambito.label"
                  [attr.aria-pressed]="isMovementAmbitoSelected(ambito.id)"
                  class="inline-flex items-center justify-center rounded-md sm:rounded-lg border-2 px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium min-h-[36px] sm:min-h-0 truncate touch-manipulation select-none transition-colors disabled:opacity-70 disabled:cursor-default"
                  [ngClass]="
                    isMovementAmbitoSelected(ambito.id)
                      ? 'border-teal-600 bg-teal-600 text-white font-semibold shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  ">
                  {{ ambito.label }}
                </button>
                </div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-[minmax(0,1fr)_5.5rem] sm:grid-cols-1 gap-2 sm:gap-3">
            <div class="min-w-0">
              <label class="block text-xs font-medium text-gray-700 mb-0.5">
                <span class="sm:hidden">Medio</span>
                <span class="hidden sm:inline">Medio de pago</span>
              </label>
              <select
                [(ngModel)]="movementMedio"
                name="movementMedio"
                [disabled]="movementFormDisabled"
                class="w-full px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50">
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
            </div>
            <div class="min-w-0 sm:hidden">
              <label class="block text-xs font-medium text-gray-700 mb-0.5">Monto</label>
              <input
                type="number"
                [(ngModel)]="movementMonto"
                name="movementMontoMobile"
                min="1"
                step="1"
                placeholder="0"
                [disabled]="movementFormDisabled"
                class="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm tabular-nums text-center outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-gray-700 mb-0.5">Descripción (opcional)</label>
            <textarea
              [(ngModel)]="movementDescripcion"
              name="movementDescripcion"
              rows="2"
              placeholder="Detalle adicional del movimiento..."
              [disabled]="movementFormDisabled"
              class="w-full px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 resize-y min-h-[2.5rem]"></textarea>
          </div>
        </div>

        <div class="form-actions mt-4 sm:mt-5 pt-2 border-t border-gray-100 sm:border-0">
          <p *ngIf="!editingMovementId" class="hidden sm:block text-xs text-gray-500 mb-3">
            Al guardar, la ventana queda abierta para cargar otro movimiento.
          </p>
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0"></div>
            <button type="button" (click)="closeMovementModal()" [class]="formCancelClass + ' sm:inline-flex'">
              Cerrar
            </button>
            <button
              *ngIf="!movementViewOnly"
              type="button"
              [disabled]="savingMovement"
              [class]="movementModalSaveButtonClass + ' min-h-[42px] px-4 sm:px-5'"
              (click)="submitMovement()">
              {{ savingMovement ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </div>
    </app-transaction-modal>
  `,
})
export class CashComponent implements OnInit, OnDestroy {
  private static readonly OPENING_BALANCE_CONCEPT = 'Saldo inicial de caja';

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly listSearchInputClass = LIST_SEARCH_INPUT_CLASS;
  readonly listMonthFilterClass =
    'box-border shrink-0 w-[10.5rem] px-2 sm:px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs sm:text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 dark:disabled:bg-gray-800 ' +
    LIST_TOOLBAR_CONTROL_HEIGHT;
  readonly tableScrollClass = TABLE_SCROLL_CLASS;
  readonly listTableRowClass = LIST_TABLE_ROW_CLASS;
  readonly nativeCompactTableClass = NATIVE_COMPACT_TABLE_CLASS;
  readonly nativeCompactListClass = NATIVE_COMPACT_LIST_CLASS;
  readonly compactListEmptyClass = COMPACT_LIST_EMPTY_CLASS;
  readonly compactListRowClass = COMPACT_LIST_ROW_CLASS;
  readonly formCancelClass = FORM_CANCEL_CLASS;
  readonly listPageSize = DEFAULT_LIST_PAGE_SIZE;
  readonly auth = inject(AuthService);

  @ViewChild('movementConceptField') movementConceptField?: ElementRef<HTMLElement>;
  @ViewChild('movementConceptoText') movementConceptoText?: ElementRef<HTMLInputElement>;
  @ViewChild('movementMontoInput') movementMontoInput?: ElementRef<HTMLInputElement>;

  private cashService = inject(CashService);
  private configService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private configSub?: Subscription;
  private routeSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  movements: CashMovement[] = [];
  cashSummary: CashSummary | null = null;
  monthFilterRange: CalendarMonthRange = getCalendarMonthRange();
  searchQuery = '';
  movementsPage = 1;
  activeAmbitoTab = '';
  loading = true;

  movementModalOpen = false;
  movementViewOnly = false;
  editingMovementId: string | null = null;
  movementTipo: 'ingreso' | 'egreso' = 'ingreso';
  movementConcepto = '';
  movementDescripcion = '';
  movementFecha = todayDateInputValue();
  movementHora = currentTimeInputValue();
  movementMonto: number | null = null;
  movementMedio = 'efectivo';
  movementAmbito = '';
  readonly movementSaveFeedback = new TransactionSaveFeedback();

  get savingMovement(): boolean {
    return this.movementSaveFeedback.saving;
  }

  movementSaveHint: string | null = null;
  private movementSessionSavedCount = 0;
  hasMoreMovements = false;
  nextMovementsCursor: string | null = null;
  loadingMoreMovements = false;
  private readonly listLoadSession = new ProgressiveListSession();
  private pendingMovementIdFromQuery: string | null = null;

  ngOnInit() {
    bindListPageRefreshOnReturn({
      listPath: '/cash',
      reload: () => this.reloadList(),
      reset: () => this.closeMovementModal(),
      router: this.router,
      destroyRef: this.destroyRef,
      injector: this.injector,
    });
    this.configSub = this.configService.appConfig$.subscribe((config) => {
      this.appConfig = config;
      this.syncActiveAmbitoTab();
    });
    this.configService.getAppConfig().subscribe();

    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const parsed = parseMonthYearQueryParams(params.get('mes'), params.get('anio'));
      if (!parsed) {
        const current = getCalendarMonthRange();
        const { mes, anio } = monthYearQueryParams(current);
        this.router.navigate(['/cash'], { queryParams: { mes, anio }, replaceUrl: true });
        return;
      }
      this.monthFilterRange = parsed;
      this.movementsPage = 1;
      this.pendingMovementIdFromQuery = params.get('movementId')?.trim() || null;
      this.loadCashSummary();
      this.reloadMovements();
    });
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    this.movementSaveFeedback.destroy();
  }

  get filterMonthInput(): string {
    const range = this.summaryPeriodRange;
    const month = String(range.month + 1).padStart(2, '0');
    return `${range.year}-${month}`;
  }

  /** Mes al que corresponden Ing. y Egr. */
  get kpiPeriodMonthLabel(): string {
    return formatMonthYearLabel(this.summaryPeriodRange.label);
  }

  get periodMovements(): CashMovement[] {
    return this.movements.filter((movement) =>
      isIsoDateInRange(movement.fecha, this.monthFilterRange.start, this.monthFilterRange.end)
    );
  }

  onFilterMonthChange(value: string) {
    if (!value) return;
    const [yearStr, monthStr] = value.split('-');
    const mes = Number(monthStr);
    const anio = Number(yearStr);
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) return;
    if (!Number.isFinite(anio) || anio < 2000 || anio > 2100) return;
    this.router.navigate(['/cash'], { queryParams: { mes, anio } });
  }

  get cajaAmbitos(): CajaAmbitoConfig[] {
    return getCajaAmbitos(this.appConfig);
  }

  get usesAmbitoSeparation(): boolean {
    return usesCashAmbitoSeparation(this.appConfig);
  }

  get activeAmbitoLabel(): string {
    return getCashAmbitoLabel(this.activeAmbitoTab, this.appConfig);
  }

  get activeAmbitoIngresos(): number {
    return this.getAmbitoPeriodKpis(this.activeAmbitoTab).ingreso;
  }

  get activeAmbitoEgresos(): number {
    return this.getAmbitoPeriodKpis(this.activeAmbitoTab).egreso;
  }

  get activeAmbitoSaldo(): number {
    const row = this.cashSummary?.ambitos?.[this.activeAmbitoTab];
    if (row) return row.saldo;
    return this.sumByTipo('ingreso', this.activeAmbitoTab) - this.sumByTipo('egreso', this.activeAmbitoTab);
  }

  get cashKpiItems(): CompactInlineStat[] {
    return [
      { label: 'Ing.', value: this.formatMoney(this.totalIngresos), tone: 'success' },
      { label: 'Egr.', value: this.formatMoney(this.totalEgresos), tone: 'danger' },
      { label: 'Saldo acum.', value: this.formatMoney(this.saldoCaja), alignEnd: true },
    ];
  }

  get cashKpiItemsCompact(): CompactInlineStat[] {
    return [
      { label: 'Ing.', value: this.formatMoney(this.totalIngresos), tone: 'success' },
      { label: 'Egr.', value: this.formatMoney(this.totalEgresos), tone: 'danger' },
      { label: 'Saldo', value: this.formatMoney(this.saldoCaja), alignEnd: true },
    ];
  }

  get activeAmbitoKpiItems(): CompactInlineStat[] {
    return [
      { label: 'Ing.', value: this.formatMoney(this.activeAmbitoIngresos), tone: 'success' },
      { label: 'Egr.', value: this.formatMoney(this.activeAmbitoEgresos), tone: 'danger' },
      { label: 'Saldo acum.', value: this.formatMoney(this.activeAmbitoSaldo), alignEnd: true },
    ];
  }

  get activeAmbitoKpiItemsCompact(): CompactInlineStat[] {
    return [
      { label: 'Ing.', value: this.formatMoney(this.activeAmbitoIngresos), tone: 'success' },
      { label: 'Egr.', value: this.formatMoney(this.activeAmbitoEgresos), tone: 'danger' },
      { label: 'Saldo', value: this.formatMoney(this.activeAmbitoSaldo), alignEnd: true },
    ];
  }

  get totalNetoSaldo(): number {
    if (this.cashSummary) return this.cashSummary.saldo;
    return this.sumByTipo('ingreso') - this.sumByTipo('egreso');
  }

  getAmbitoSaldo(ambitoId: string): number {
    const row = this.cashSummary?.ambitos?.[ambitoId];
    if (row) return row.saldo;
    return this.sumByTipo('ingreso', ambitoId) - this.sumByTipo('egreso', ambitoId);
  }

  get filteredMovements(): CashMovement[] {
    let list = this.periodMovements;

    if (this.usesAmbitoSeparation) {
      list = list.filter(
        (movement) => resolveCashAmbito(movement, this.appConfig) === this.activeAmbitoTab
      );
    }

    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return list;

    return list.filter((movement) => {
      const haystack = [
        movement.concepto,
        movement.origenLabel,
        movement.numeroPedidoLabel,
        movement.ventaLabel,
        movement.medio,
        this.usesAmbitoSeparation
          ? getCashAmbitoLabel(resolveCashAmbito(movement, this.appConfig), this.appConfig)
          : '',
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(query);
    });
  }

  get paginatedFilteredMovements(): CashMovement[] {
    return paginateSlice(this.filteredMovements, this.movementsPage, this.listPageSize);
  }

  get movementModalPrimaryLabel(): string {
    if (this.editingMovementId) return 'Guardar';
    return this.movementTipo === 'egreso' ? 'Guardar egreso' : 'Guardar ingreso';
  }

  get movementModalPrimaryLabelLong(): string {
    if (this.editingMovementId) return 'Guardar cambios';
    return this.movementTipo === 'egreso'
      ? 'Guardar egreso y continuar'
      : 'Guardar ingreso y continuar';
  }

  get movementFormDisabled(): boolean {
    return this.movementViewOnly || this.savingMovement;
  }

  get canDuplicateInModal(): boolean {
    return (
      this.auth.canEditRecords &&
      this.movementModalOpen &&
      !this.movementViewOnly &&
      !!this.editingMovementId &&
      !!this.editingMovement &&
      this.isManualMovement(this.editingMovement)
    );
  }

  get canEditFromDetail(): boolean {
    const movement = this.editingMovement;
    return (
      this.movementViewOnly &&
      !!movement &&
      this.auth.canEditRecords &&
      this.isManualMovement(movement)
    );
  }

  get editingMovement(): CashMovement | undefined {
    if (!this.editingMovementId) return undefined;
    return this.movements.find((movement) => movement.id === this.editingMovementId);
  }

  get canDeleteCashAsAdmin(): boolean {
    return this.auth.isPrivileged;
  }

  get showDesktopMovementRowActions(): boolean {
    return this.auth.canEditRecords || this.canDeleteCashAsAdmin;
  }

  get canDeleteInModal(): boolean {
    const movement = this.editingMovement;
    if (!movement || !this.canDeleteCashAsAdmin) return false;
    return this.isManualMovement(movement) && isDeletableCashMovement(movement);
  }

  get showMovementModalActions(): boolean {
    return this.canEditFromDetail || this.canDuplicateInModal || this.canDeleteInModal;
  }

  get movementModalPrimaryButtonClass(): string {
    const base =
      'form-btn-primary rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60';
    return this.movementTipo === 'egreso'
      ? `${base} bg-red-500 hover:bg-red-600`
      : `${base} bg-teal-600 hover:bg-teal-700`;
  }

  get movementModalSaveButtonLabel(): string {
    if (this.savingMovement) return 'Guardando...';
    return this.movementModalPrimaryLabelLong;
  }

  get movementModalSaveButtonClass(): string {
    return this.movementModalPrimaryButtonClass;
  }

  get totalIngresos(): number {
    return this.getGlobalPeriodKpis().ingreso;
  }

  get totalEgresos(): number {
    return this.getGlobalPeriodKpis().egreso;
  }

  get saldoCaja(): number {
    if (this.cashSummary) return this.cashSummary.saldo;
    return this.sumByTipo('ingreso') - this.sumByTipo('egreso');
  }

  get usesConceptList(): boolean {
    return usesCashMovementConceptPicker(this.appConfig, this.movementTipo);
  }

  get conceptOptions(): string[] {
    return getCashMovementConceptOptions(this.appConfig, this.movementTipo);
  }

  get movementConceptPickerPlaceholder(): string {
    return this.movementTipo === 'egreso'
      ? 'Buscar categoría de gasto...'
      : 'Buscar concepto...';
  }

  get movementConceptPlainPlaceholder(): string {
    return this.movementTipo === 'egreso' ? 'Ej. Envío' : 'Ej. Venta mostrador';
  }

  get movementModalTitle(): string {
    if (this.movementViewOnly) return 'Detalle';
    if (this.editingMovementId) return 'Editar';
    return 'Movimiento';
  }

  get movementModalSubtitle(): string {
    if (this.movementViewOnly) {
      const movement = this.editingMovement;
      if (movement && !this.isManualMovement(movement)) {
        return 'Movimiento automático. Para cambiarlo, usá el enlace del pedido, venta o compra en el concepto.';
      }
      return 'Tocá Editar para modificar o Eliminá si corresponde.';
    }
    if (this.editingMovementId) {
      return 'Modificá el movimiento o duplicá como nuevo para cargar varios seguidos.';
    }
    if (this.usesAmbitoSeparation) {
      return `Caja: ${this.activeAmbitoLabel}. Podés alternar ingreso/egreso sin cerrar.`;
    }
    return 'Podés alternar ingreso y egreso y cargar varios movimientos seguidos.';
  }

  isManualMovement(movement: CashMovement): boolean {
    if (movement.pedidoId || movement.ventaId) return false;

    const tipo = String(movement.origenTipo ?? '');
    if (
      tipo === 'colaborador_pago' ||
      tipo === 'cuenta_pagar' ||
      tipo === 'tarjeta_resumen' ||
      tipo === 'compra'
    ) {
      return false;
    }
    if (tipo.startsWith('pedido') || tipo === 'venta' || tipo.startsWith('venta')) return false;
    if (movement.origenGrupo === 'pedido' || movement.origenGrupo === 'venta') return false;
    if (movement.origenGrupo === 'manual') return true;
    if (tipo.startsWith('caja_manual')) return true;

    return !tipo;
  }

  formatDate(value?: string): string {
    return formatDisplayDate(value);
  }

  /** Concepto acortado: el origen ya indica el tipo (colaborador, cuenta a pagar, etc.). */
  getMovementConceptoDisplay(movement: CashMovement): string {
    const concepto = String(movement.concepto ?? '').trim();
    if (!concepto) return '—';

    const tipo = String(movement.origenTipo ?? '');
    let display = concepto;
    if (tipo === 'colaborador_pago') {
      display = concepto.replace(/^Pago colaborador · /i, '').trim() || concepto;
    } else if (tipo === 'tarjeta_resumen') {
      display =
        concepto
          .replace(/^Pago parcial resumen\s+/i, 'Pago parcial · ')
          .replace(/^Resumen\s+/i, '')
          .replace(/\s·\s\d{4}-\d{2}(-\d{2})?$/i, '')
          .trim() || concepto;
    } else if (tipo === 'cuenta_pagar' && movement.origenGrupo !== 'compra') {
      if (!/^Préstamo ·/i.test(concepto) && !/^Cuota \d/i.test(concepto)) {
        const first = concepto.split(' · ')[0]?.trim();
        if (first) display = first;
      }
    }

    return formatIsoDatesInText(display);
  }

  getMovementDescripcionDisplay(movement: CashMovement): string {
    const descripcion = String(movement.descripcion ?? '').trim();
    return descripcion || '—';
  }

  /** Título corto en celular: «Pago Despues» sin categoría ni cuota. */
  getMovementMobileTitle(movement: CashMovement): string {
    const concepto = String(movement.concepto ?? '').trim();
    const tipo = String(movement.origenTipo ?? '');
    if (tipo === 'cuenta_pagar' && concepto.includes(' · ')) {
      const first = concepto.split(' · ')[0]?.trim();
      if (first) return first;
    }
    if (tipo === 'colaborador_pago') {
      return concepto.replace(/^Pago colaborador · /i, '').split(' · ')[0]?.trim() || concepto;
    }
    return this.getMovementConceptoDisplay(movement);
  }

  getOrigenLabel(movement: CashMovement): string {
    if (movement.origenLabel) return movement.origenLabel;
    const tipo = String(movement.origenTipo ?? '');
    if (tipo === 'colaborador_pago') return 'Colaboradores · pago';
    if (tipo === 'cuenta_pagar') return 'Cuentas a pagar';
    if (tipo === 'tarjeta_resumen') return 'Tarjeta · resumen';
    const grupo = this.resolveOrigenGrupo(movement);
    const base = getCashOrigenNombre(this.appConfig.caja.origenes, grupo);
    if (grupo === 'manual') {
      return movement.tipo === 'egreso' ? `${base} · egreso` : `${base} · ingreso`;
    }
    return base;
  }

  getOrigenBadgeClass(movement: CashMovement): Record<string, boolean> {
    const grupo = this.resolveOrigenGrupo(movement);
    return this.getOrigenBadgeClassByGrupo(grupo);
  }

  getAmbitoLabel(movement: CashMovement): string {
    return getCashAmbitoLabel(resolveCashAmbito(movement, this.appConfig), this.appConfig);
  }

  getAmbitoBadgeClass(_movement: CashMovement): Record<string, boolean> {
    return { 'bg-gray-100 text-gray-700': true };
  }

  private getOrigenBadgeClassByGrupo(grupo: string): Record<string, boolean> {
    return {
      'bg-teal-50 text-teal-700': grupo === 'pedido',
      'bg-purple-50 text-purple-700': grupo === 'venta',
      'bg-amber-50 text-amber-700': grupo === 'compra',
      'bg-gray-100 text-gray-700': grupo === 'manual',
      'bg-slate-100 text-slate-700':
        grupo !== 'pedido' && grupo !== 'venta' && grupo !== 'compra' && grupo !== 'manual',
    };
  }

  getOrderNumberLabel(movement: CashMovement): string {
    if (movement.numeroPedidoLabel) return movement.numeroPedidoLabel;
    if (movement.numeroPedido) {
      return String(movement.numeroPedido).padStart(5, '0');
    }
    return '—';
  }

  get cashTransactionReturnQueryParams(): Record<string, string> | null {
    const movement = this.editingMovement;
    if (!movement?.id) return null;
    const { mes, anio } = monthYearQueryParams(this.summaryPeriodRange);
    return buildCashReturnQueryParams({
      movementId: movement.id,
      mes,
      anio,
    });
  }

  hasMovementTransactionLink(movement: CashMovement): boolean {
    return !!(
      movement.pedidoId ||
      movement.ventaId ||
      this.resolveMovementCompraId(movement)
    );
  }

  resolveMovementCompraId(movement: CashMovement): string | null {
    if (movement.compraId) return String(movement.compraId);
    const tipo = String(movement.origenTipo ?? '');
    if ((tipo === 'compra' || tipo.startsWith('compra')) && movement.origenId) {
      return String(movement.origenId);
    }
    return null;
  }

  private tryOpenPendingMovementDetail() {
    const movementId = this.pendingMovementIdFromQuery;
    if (!movementId || this.loading) return;

    const movement = this.movements.find((item) => item.id === movementId);
    if (!movement) return;

    this.pendingMovementIdFromQuery = null;
    this.openMovementDetail(movement);
    this.clearMovementQueryParam();
  }

  private clearMovementQueryParam() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { movementId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private resolveOrigenGrupo(movement: CashMovement): string {
    if (movement.origenGrupo) return movement.origenGrupo;
    const tipo = String(movement.origenTipo ?? '');
    if (tipo.startsWith('pedido') || movement.pedidoId) return 'pedido';
    if (tipo === 'compra' || tipo.startsWith('compra')) return 'compra';
    if (tipo === 'venta' || tipo.startsWith('venta')) return 'venta';
    if (tipo.startsWith('caja_manual')) return 'manual';
    if (!movement.pedidoId && !tipo.startsWith('pedido') && tipo !== 'venta' && !tipo.startsWith('venta')) {
      return 'manual';
    }
    return 'otro';
  }

  private syncActiveAmbitoTab() {
    const ambitos = this.cajaAmbitos;
    if (!ambitos.length) {
      this.activeAmbitoTab = getDefaultCashAmbitoId(this.appConfig);
      return;
    }
    if (!ambitos.some((ambito) => ambito.id === this.activeAmbitoTab)) {
      this.activeAmbitoTab = ambitos[0].id;
    }
  }

  private sumByTipo(tipo: 'ingreso' | 'egreso', ambito?: string): number {
    return this.movements
      .filter((movement) => {
        if (movement.tipo !== tipo) return false;
        if (!ambito) return true;
        return resolveCashAmbito(movement, this.appConfig) === ambito;
      })
      .reduce((acc, movement) => acc + (Number(movement.monto) || 0), 0);
  }

  private get summaryPeriodRange(): CalendarMonthRange {
    return this.monthFilterRange;
  }

  private getGlobalPeriodKpis() {
    if (this.cashSummary?.periodo) {
      return {
        ingreso: this.cashSummary.periodo.ingreso,
        egreso: this.cashSummary.periodo.egreso,
      };
    }
    return computeCashPeriodKpisFromMovements(this.movements, this.summaryPeriodRange);
  }

  private getAmbitoPeriodKpis(ambitoId: string) {
    const row = this.cashSummary?.ambitos?.[ambitoId];
    if (row?.periodo) {
      return { ingreso: row.periodo.ingreso, egreso: row.periodo.egreso };
    }
    return computeCashPeriodKpisFromMovements(this.movements, this.summaryPeriodRange, (movement) =>
      resolveCashAmbito(movement, this.appConfig) === ambitoId
    );
  }

  isDeletableCashMovement = isDeletableCashMovement;

  openMovementModal(tipo: 'ingreso' | 'egreso') {
    if (!this.auth.canEditRecords) {
      this.showEditPermissionAlert();
      return;
    }
    this.editingMovementId = null;
    this.movementViewOnly = false;
    this.movementTipo = tipo;
    this.movementConcepto = '';
    this.movementDescripcion = '';
    this.movementFecha = todayDateInputValue();
    this.movementHora = currentTimeInputValue();
    this.movementMonto = null;
    this.movementMedio = 'efectivo';
    this.movementAmbito = this.usesAmbitoSeparation
      ? this.activeAmbitoTab
      : getDefaultCashAmbitoId(this.appConfig);
    this.movementSaveHint = null;
    this.movementSessionSavedCount = 0;
    this.movementModalOpen = true;
    this.focusMovementConcept();
  }

  openOpeningBalanceEditor() {
    if (!this.auth.canEditRecords) {
      this.showEditPermissionAlert();
      return;
    }

    const local = this.findOpeningBalanceMovement(this.movements);
    if (local) {
      this.openEditMovement(local);
      return;
    }

    this.cashService.getMovementsPage(PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE).subscribe({
      next: (page) => {
        const remote = this.findOpeningBalanceMovement(page.items);
        if (remote) {
          this.openEditMovement(remote);
          return;
        }
        if (page.hasMore && page.nextCursor) {
          this.searchOpeningBalanceAcrossPages(page.nextCursor);
          return;
        }
        this.openNewOpeningBalanceModal();
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo buscar el saldo inicial. Intentá de nuevo.',
        });
      },
    });
  }

  private openNewOpeningBalanceModal() {
    this.editingMovementId = null;
    this.movementTipo = 'ingreso';
    this.movementConcepto = CashComponent.OPENING_BALANCE_CONCEPT;
    this.movementDescripcion = '';
    this.movementFecha = todayDateInputValue();
    this.movementHora = currentTimeInputValue();
    this.movementMonto = null;
    this.movementMedio = 'efectivo';
    this.movementAmbito = this.usesAmbitoSeparation
      ? this.activeAmbitoTab
      : getDefaultCashAmbitoId(this.appConfig);
    this.movementSaveHint = `Cargá el saldo inicial de ${this.activeAmbitoLabel}. Podés editarlo después desde este mismo botón.`;
    this.movementSessionSavedCount = 0;
    this.movementModalOpen = true;
    this.focusMovementMonto();
  }

  private findOpeningBalanceMovement(list: CashMovement[]): CashMovement | undefined {
    const ambito = this.usesAmbitoSeparation
      ? this.activeAmbitoTab
      : getDefaultCashAmbitoId(this.appConfig);

    return list.find((movement) => {
      if (!this.isManualMovement(movement)) return false;
      if (resolveCashAmbito(movement, this.appConfig) !== ambito) return false;
      return /saldo inicial/i.test(String(movement.concepto ?? '').trim());
    });
  }

  private showEditPermissionAlert() {
    this.dialogService.alert({
      title: 'Sin permiso para editar',
      message:
        'Tu usuario puede ver caja pero no registrar ni modificar movimientos. Pedile al administrador que active el permiso de edición.',
    });
  }

  private focusMovementMonto() {
    setTimeout(() => {
      const input = this.movementMontoInput?.nativeElement;
      input?.focus();
      input?.select();
    }, 0);
  }

  duplicateMovement(movement: CashMovement, event: Event) {
    event.stopPropagation();
    if (!this.auth.canEditRecords) {
      this.showEditPermissionAlert();
      return;
    }
    if (!this.isManualMovement(movement)) {
      this.dialogService.alert({
        title: 'Movimiento automático',
        message:
          'Solo podés duplicar movimientos cargados a mano en caja. Este registro se generó desde otro módulo.',
      });
      return;
    }
    this.openMovementFromTemplate(movement);
  }

  duplicateMovementInModal() {
    if (!this.auth.canEditRecords) return;
    this.editingMovementId = null;
    this.movementSaveHint = 'Listo para guardar una copia como movimiento nuevo.';
    this.focusMovementConcept();
  }

  trackCajaAmbitoId = (_index: number, ambito: CajaAmbitoConfig) => ambito.id;

  isMovementAmbitoSelected(ambitoId: string): boolean {
    return this.movementAmbito === ambitoId;
  }

  selectMovementAmbito(ambitoId: string, event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.movementFormDisabled || this.movementAmbito === ambitoId) return;
    this.movementAmbito = ambitoId;
  }

  setMovementTipo(tipo: 'ingreso' | 'egreso') {
    if (this.movementFormDisabled || this.movementTipo === tipo) return;
    this.movementTipo = tipo;
    if (this.movementConcepto.trim()) {
      const stillValid = this.conceptOptions.some(
        (option) => option.toLowerCase() === this.movementConcepto.trim().toLowerCase()
      );
      if (!stillValid) {
        this.movementConcepto = '';
      }
    }
  }

  onMovementConceptoChange(concepto: string) {
    if (this.movementTipo !== 'egreso' || !this.usesAmbitoSeparation) return;
    const categoria = findCategoriaGastoByLabel(this.appConfig, concepto);
    if (!categoria?.ambitoDefault) return;
    const ambitos = this.cajaAmbitos.map((a) => a.id);
    if (ambitos.includes(categoria.ambitoDefault)) {
      this.movementAmbito = categoria.ambitoDefault;
    }
  }

  private openMovementFromTemplate(movement: CashMovement) {
    this.editingMovementId = null;
    this.movementViewOnly = false;
    this.movementTipo = movement.tipo;
    this.movementConcepto = movement.concepto ?? '';
    this.movementDescripcion = movement.descripcion ?? '';
    this.movementFecha = toDateInputValue(movement.fecha);
    this.movementHora = toTimeInputValue(movement.fecha);
    this.movementMonto = Number(movement.monto) || null;
    this.movementMedio = movement.medio || 'efectivo';
    this.movementAmbito = resolveCashAmbito(movement, this.appConfig);
    this.movementSaveHint = 'Copiado desde un movimiento existente. Ajustá y guardá.';
    this.movementModalOpen = true;
    this.focusMovementConcept();
  }

  private focusMovementConcept() {
    setTimeout(() => {
      const hostInput = this.movementConceptField?.nativeElement?.querySelector('input');
      const input =
        (hostInput as HTMLInputElement | null) ??
        this.movementConceptoText?.nativeElement ??
        this.movementMontoInput?.nativeElement;
      input?.focus();
      if (input && 'select' in input) {
        input.select();
      }
    }, 0);
  }

  private prepareNextMovementEntry() {
    this.movementSaveFeedback.clearSuccess();
    this.movementConcepto = '';
    this.movementDescripcion = '';
    this.movementFecha = todayDateInputValue();
    this.movementHora = currentTimeInputValue();
    this.movementMonto = null;
    this.movementSaveHint =
      this.movementSessionSavedCount === 1
        ? 'Movimiento guardado. Cargá el siguiente.'
        : `${this.movementSessionSavedCount} movimientos guardados en esta sesión.`;
    this.focusMovementConcept();
  }

  onMovementRowClick(movement: CashMovement) {
    if (!movement.id) return;
    if (this.auth.canEditRecords && this.isManualMovement(movement)) {
      this.openEditMovement(movement);
      return;
    }
    this.openMovementDetail(movement);
  }

  openEditMovement(movement: CashMovement) {
    if (!movement.id) return;
    this.populateMovementForm(movement);
    this.movementViewOnly = false;
    this.movementSaveHint = null;
    this.movementModalOpen = true;
  }

  openMovementDetail(movement: CashMovement) {
    if (!movement.id) return;
    this.populateMovementForm(movement);
    this.movementViewOnly = true;
    this.movementSaveHint = null;
    this.movementModalOpen = true;
  }

  enableMovementEditFromDetail() {
    if (!this.canEditFromDetail) return;
    this.movementViewOnly = false;
    this.movementSaveHint = null;
  }

  private populateMovementForm(movement: CashMovement) {
    this.editingMovementId = movement.id ?? null;
    this.movementTipo = movement.tipo;
    this.movementConcepto = movement.concepto ?? '';
    this.movementDescripcion = movement.descripcion ?? '';
    this.movementFecha = toDateInputValue(movement.fecha);
    this.movementHora = toTimeInputValue(movement.fecha);
    this.movementMonto = Number(movement.monto) || null;
    this.movementMedio = movement.medio || 'efectivo';
    this.movementAmbito = resolveCashAmbito(movement, this.appConfig);
  }

  closeMovementModal() {
    this.movementModalOpen = false;
    this.movementViewOnly = false;
    this.editingMovementId = null;
    this.movementSaveHint = null;
    this.movementSessionSavedCount = 0;
    this.movementSaveFeedback.clearSuccess();
    this.movementSaveFeedback.endSave();
  }

  confirmDeleteEditingMovement(): void {
    const movement = this.editingMovement;
    if (movement) this.confirmDeleteMovement(movement);
  }

  confirmDeleteMovement(movement: CashMovement) {
    if (!movement.id) return;

    if (!this.canDeleteCashAsAdmin) {
      this.dialogService.alert({
        title: 'Sin permiso para eliminar',
        message:
          'Solo un perfil administrador puede eliminar movimientos de caja. Pedile al administrador de la empresa si necesitás borrar un registro.',
      });
      return;
    }

    const blockReason = this.getMovementDeleteBlockReason(movement);
    if (blockReason) {
      this.dialogService.alert({
        title: 'No se puede eliminar',
        message: `${this.buildMovementDetailMessage(movement)}\n\n${blockReason}`,
      });
      return;
    }

    this.dialogService
      .confirm({
        title: 'Eliminar movimiento de caja',
        message: `${this.buildMovementDetailMessage(movement)}\n\nEsta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !movement.id) return;

        this.cashService.deleteMovement(movement.id).subscribe({
          next: () => {
            this.removeLocalMovement(movement.id);
            this.applySummaryMovement(
              movement.tipo,
              Number(movement.monto) || 0,
              resolveCashAmbito(movement, this.appConfig),
              -1
            );
            if (this.editingMovementId === movement.id) {
              this.closeMovementModal();
            }
            this.refreshMovementsSilently();
            this.loadCashSummary();
          },
          error: (err) =>
            this.dialogService.alert({
              title: 'No se puede eliminar',
              message:
                typeof err.error?.error === 'string'
                  ? err.error.error
                  : 'No se pudo eliminar el movimiento.',
            }),
        });
      });
  }

  private buildMovementDetailMessage(movement: CashMovement): string {
    const lines = [
      'Vas a eliminar este movimiento:',
      `• Concepto: ${movement.concepto?.trim() || '—'}`,
      `• Tipo: ${movement.tipo === 'egreso' ? 'Egreso' : 'Ingreso'}`,
      `• Monto: ${this.formatMoney(movement.monto)}`,
      `• Fecha: ${this.formatDate(movement.fecha)}`,
      `• Medio: ${this.capitalizeMedio(movement.medio)}`,
      `• Origen: ${this.getOrigenLabel(movement)}`,
    ];

    if (this.usesAmbitoSeparation) {
      lines.push(
        `• Ámbito: ${getCashAmbitoLabel(resolveCashAmbito(movement, this.appConfig), this.appConfig)}`
      );
    }

    if (movement.pedidoId) {
      const pedidoRef = movement.numeroPedidoLabel
        ? `#${movement.numeroPedidoLabel}`
        : movement.pedidoId;
      lines.push(`• Pedido vinculado: ${pedidoRef}`);
    }
    if (movement.ventaId) {
      const ventaRef = movement.ventaLabel ? `#${movement.ventaLabel}` : movement.ventaId;
      lines.push(`• Venta vinculada: ${ventaRef}`);
    }
    const compraId = this.resolveMovementCompraId(movement);
    if (compraId) {
      const compraRef = movement.compraLabel ? `#${movement.compraLabel}` : compraId;
      lines.push(`• Compra vinculada: ${compraRef}`);
    }

    return lines.join('\n');
  }

  private getMovementDeleteBlockReason(movement: CashMovement): string | null {
    if (!isDeletableCashMovement(movement)) {
      return 'Este movimiento está vinculado a un pedido, venta u otro documento. Anulalo desde el módulo que lo generó en lugar de borrarlo acá.';
    }
    if (!this.isManualMovement(movement)) {
      return 'Este movimiento no es manual (se generó desde otro módulo) y no se puede eliminar desde caja.';
    }
    return null;
  }

  private capitalizeMedio(medio?: string): string {
    const value = String(medio ?? '').trim();
    if (!value) return '—';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  formatMoney(value?: number): string {
    return formatMoneyValue(value);
  }

  submitMovement() {
    if (!this.auth.canEditRecords) {
      this.showEditPermissionAlert();
      return;
    }
    if (!this.movementSaveFeedback.tryBeginSave()) return;

    const monto = Number(this.movementMonto);
    const concepto = this.movementConcepto.trim();

    if (!concepto) {
      this.movementSaveFeedback.endSave();
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un concepto.',
      });
      return;
    }

    if (!monto || monto <= 0) {
      this.movementSaveFeedback.endSave();
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un monto válido.',
      });
      return;
    }

    const categoriaId = resolveCategoriaIdForCashConcept(
      this.appConfig,
      this.movementTipo,
      concepto
    );

    const payload = {
      tipo: this.movementTipo,
      monto,
      concepto,
      medio: this.movementMedio,
      descripcion: this.movementDescripcion.trim() || null,
      fecha: combineDateAndTimeToIso(this.movementFecha, this.movementHora),
      ...(categoriaId ? { categoriaId } : { categoriaId: null }),
      ...(this.usesAmbitoSeparation ? { ambito: this.movementAmbito } : {}),
    };

    const request = this.editingMovementId
      ? this.cashService.updateMovement(this.editingMovementId, payload)
      : this.cashService.createMovement(payload);

    const editingId = this.editingMovementId;
    const previousMovement = editingId
      ? this.movements.find((movement) => movement.id === editingId)
      : undefined;
    const ambitoForPayload = this.usesAmbitoSeparation
      ? this.movementAmbito
      : getDefaultCashAmbitoId(this.appConfig);

    request.pipe(finalize(() => this.movementSaveFeedback.endSave())).subscribe({
      next: (result) => {
        if (previousMovement) {
          this.applySummaryMovement(
            previousMovement.tipo,
            Number(previousMovement.monto) || 0,
            resolveCashAmbito(previousMovement, this.appConfig),
            -1
          );
        }

        const movementId = editingId ?? result.id;
        const localMovement = this.buildLocalMovement(
          movementId,
          {
            ...payload,
            ambito: ambitoForPayload,
          },
          previousMovement?.createdAt
        );
        this.upsertLocalMovement(localMovement);
        this.applySummaryMovement(
          payload.tipo,
          monto,
          resolveCashAmbito(localMovement, this.appConfig),
          1
        );

        this.refreshMovementsSilently();
        this.loadCashSummary();

        if (editingId) {
          this.editingMovementId = movementId;
          this.movementSaveFeedback.showSuccess('Movimiento actualizado');
          return;
        }

        this.movementSaveFeedback.showSuccess(
          payload.tipo === 'egreso' ? 'Egreso registrado' : 'Ingreso registrado'
        );
        this.movementSessionSavedCount += 1;
        this.prepareNextMovementEntry();
      },
      error: (err) => {
        this.dialogService.alert({
          title: 'Error',
          message:
            typeof err.error?.error === 'string'
              ? err.error.error
              : this.editingMovementId
                ? 'No se pudo actualizar el movimiento.'
                : 'No se pudo registrar el movimiento.',
        });
      },
    });
  }

  reloadList() {
    this.movementsPage = 1;
    this.nextMovementsCursor = null;
    this.hasMoreMovements = false;
    this.loadingMoreMovements = false;
    this.reloadMovements();
    this.loadCashSummary();
  }

  private loadCashSummary() {
    const range = this.summaryPeriodRange;
    const { mes, anio } = monthYearQueryParams(range);
    this.cashService.getSummary(mes, anio).subscribe({
      next: (summary) => {
        this.cashSummary = summary;
      },
      error: () => {
        // Mantener totales optimistas si falla el resumen.
      },
    });
  }

  private reloadMovements(showLoading = true) {
    this.loadMovements(showLoading);
  }

  private loadMovements(showLoading = true) {
    const loadToken = this.listLoadSession.next();
    if (showLoading) this.loading = true;
    this.hasMoreMovements = false;
    this.nextMovementsCursor = null;
    this.loadingMoreMovements = false;
    const { mes, anio } = monthYearQueryParams(this.summaryPeriodRange);
    this.cashService
      .getMovementsPage(PROGRESSIVE_LIST_FIRST_PAGE_SIZE, undefined, mes, anio)
      .subscribe({
        next: (page) => {
          if (!this.listLoadSession.isActive(loadToken)) return;
          this.movements = sortCashMovementsByRecency(page.items);
          this.hasMoreMovements = page.hasMore;
          this.nextMovementsCursor = page.nextCursor;
          if (showLoading) this.loading = false;
          this.tryOpenPendingMovementDetail();
          if (page.hasMore && page.nextCursor) {
            this.loadRemainingMovementsInBackground(loadToken);
          }
        },
        error: () => {
          if (!this.listLoadSession.isActive(loadToken)) return;
          if (showLoading) this.loading = false;
          if (showLoading) {
            this.dialogService.alert({
              title: 'Error',
              message: 'No se pudieron cargar los movimientos de caja desde el servidor.',
            });
          }
        },
      });
  }

  private loadRemainingMovementsInBackground(loadToken: number) {
    if (!this.listLoadSession.isActive(loadToken)) return;
    if (!this.hasMoreMovements || !this.nextMovementsCursor || this.loadingMoreMovements) return;

    this.loadingMoreMovements = true;
    const { mes, anio } = monthYearQueryParams(this.summaryPeriodRange);
    this.cashService
      .getMovementsPage(PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE, this.nextMovementsCursor, mes, anio)
      .subscribe({
        next: (page) => {
          if (!this.listLoadSession.isActive(loadToken)) return;
          this.movements = sortCashMovementsByRecency([
            ...this.movements,
            ...page.items,
          ]);
          this.hasMoreMovements = page.hasMore;
          this.nextMovementsCursor = page.nextCursor;
          this.loadingMoreMovements = false;
          this.tryOpenPendingMovementDetail();
          if (page.hasMore && page.nextCursor) {
            this.loadRemainingMovementsInBackground(loadToken);
          }
        },
        error: () => {
          if (!this.listLoadSession.isActive(loadToken)) return;
          this.loadingMoreMovements = false;
        },
      });
  }

  private searchOpeningBalanceAcrossPages(cursor: string) {
    this.cashService.getMovementsPage(this.movementsPageFetchSize, cursor).subscribe({
      next: (page) => {
        const remote = this.findOpeningBalanceMovement(page.items);
        if (remote) {
          this.openEditMovement(remote);
          return;
        }
        if (page.hasMore && page.nextCursor) {
          this.searchOpeningBalanceAcrossPages(page.nextCursor);
          return;
        }
        this.openNewOpeningBalanceModal();
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo buscar el saldo inicial. Intentá de nuevo.',
        });
      },
    });
  }

  private refreshMovementsSilently() {
    window.setTimeout(() => this.reloadMovements(false), 600);
  }

  private buildLocalMovement(
    id: string,
    payload: {
      tipo: 'ingreso' | 'egreso';
      monto: number;
      concepto: string;
      medio: string;
      descripcion?: string | null;
      fecha?: string;
      ambito?: string;
      categoriaId?: string | null;
    },
    createdAt?: string
  ): CashMovement {
    const ambito = payload.ambito ?? getDefaultCashAmbitoId(this.appConfig);
    const descripcion = payload.descripcion?.trim() || undefined;
    const fechaIso = payload.fecha ?? new Date().toISOString();
    return {
      id,
      tipo: payload.tipo,
      monto: payload.monto,
      concepto: payload.concepto,
      medio: payload.medio,
      ...(descripcion ? { descripcion } : {}),
      categoriaId: payload.categoriaId ?? null,
      fecha: fechaIso,
      createdAt: createdAt ?? new Date().toISOString(),
      ambito,
      origenGrupo: 'manual',
      origenTipo: payload.tipo === 'egreso' ? 'caja_manual_egreso' : 'caja_manual_ingreso',
    };
  }

  private upsertLocalMovement(movement: CashMovement) {
    if (!movement.id) return;
    const without = this.movements.filter((item) => item.id !== movement.id);
    this.movements = sortCashMovementsByRecency([movement, ...without]);
    this.movementsPage = 1;
  }

  private removeLocalMovement(movementId?: string) {
    if (!movementId) return;
    this.movements = this.movements.filter((movement) => movement.id !== movementId);
  }

  private applySummaryMovement(
    tipo: 'ingreso' | 'egreso',
    monto: number,
    ambito: string,
    direction: 1 | -1
  ) {
    const delta = (Number(monto) || 0) * direction;
    if (!delta) return;

    if (!this.cashSummary) {
      this.cashSummary = { ingreso: 0, egreso: 0, saldo: 0, ambitos: {} };
    }

    if (tipo === 'egreso') {
      this.cashSummary.egreso += delta;
    } else {
      this.cashSummary.ingreso += delta;
    }
    this.cashSummary.saldo = this.cashSummary.ingreso - this.cashSummary.egreso;

    if (!this.cashSummary.ambitos[ambito]) {
      this.cashSummary.ambitos[ambito] = { ingreso: 0, egreso: 0, saldo: 0 };
    }
    const row = this.cashSummary.ambitos[ambito];
    if (tipo === 'egreso') {
      row.egreso += delta;
    } else {
      row.ingreso += delta;
    }
    row.saldo = row.ingreso - row.egreso;
  }

  loadMoreMovements() {
    if (!this.hasMoreMovements || !this.nextMovementsCursor || this.loadingMoreMovements) return;
    this.loadingMoreMovements = true;
    const { mes, anio } = monthYearQueryParams(this.summaryPeriodRange);
    this.cashService
      .getMovementsPage(PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE, this.nextMovementsCursor, mes, anio)
      .subscribe({
      next: (page) => {
        this.movements = sortCashMovementsByRecency([
          ...this.movements,
          ...page.items,
        ]);
        this.hasMoreMovements = page.hasMore;
        this.nextMovementsCursor = page.nextCursor;
        this.loadingMoreMovements = false;
      },
      error: () => {
        this.loadingMoreMovements = false;
      },
    });
  }
}

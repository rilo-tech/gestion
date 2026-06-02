import { Component, ElementRef, ViewChild, inject, OnDestroy, OnInit } from '@angular/core';
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
  getCashOrigenes,
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
  CajaOrigen,
} from '../../core/services/catalog-config.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { isDeletableCashMovement } from '../../core/utils/deletion-rules';
import {
  CalendarMonthRange,
  formatMonthYearLabel,
  isIsoDateInRange,
  monthYearQueryParams,
  parseMonthYearQueryParams,
} from '../../core/utils/calendar-range';
import {
  computeCashPeriodKpisFromMovements,
  resolveCashSummaryPeriodRange,
} from '../../core/utils/cash-period-summary';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { TransactionModalComponent } from '../../shared/components/transaction-modal/transaction-modal.component';
import {
  IconActionComponent,
  DESKTOP_LIST_SEARCH_WRAP_CLASS,
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
import { ListSearchFieldComponent } from '../../shared/components/list-search-field/list-search-field.component';
import { TransactionDateFieldComponent } from '../../shared/components/transaction-form';
import {
  combineDateAndTimeToIso,
  currentTimeInputValue,
  todayDateInputValue,
  toDateInputValue,
  toTimeInputValue,
} from '../../core/utils/transaction-date';
import { Subscription } from 'rxjs';

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
  ],
  template: `
    <div [class]="pageShellClass">
      <app-module-page-header
        title="Caja"
        description="Ingresos y egresos del negocio. Pedidos y ventas se registran solos; usá Ingreso o Egreso para movimientos manuales. Ing. y Egr. son del mes; Saldo es acumulado."
        [hideDescriptionOnMobile]="false"
        [showMobileSearch]="true"
        [(searchQuery)]="searchQuery"
        (searchQueryChange)="movementsPage = 1"
        searchFieldName="cashSearchQueryMobile"
        activityModule="cash">
        <ng-container headerActions *ngIf="auth.canEditRecords">
          <app-icon-action label="Ingreso" (clicked)="openMovementModal('ingreso')">
            <i-lucide name="arrow-up" class="w-4 h-4"></i-lucide>
          </app-icon-action>
          <app-icon-action label="Egreso" variant="danger" (clicked)="openMovementModal('egreso')">
            <i-lucide name="arrow-down" class="w-4 h-4"></i-lucide>
          </app-icon-action>
        </ng-container>
      </app-module-page-header>

      <div
        *ngIf="monthFilterLabel"
        class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-teal-100 bg-teal-50 px-4 py-2.5">
        <p class="text-sm text-teal-900">
          Movimientos de <span class="font-semibold">{{ monthFilterLabel }}</span>
        </p>
        <button
          type="button"
          (click)="clearMonthFilter()"
          class="text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline">
          Ver todos
        </button>
      </div>

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
              <span class="text-base font-bold tabular-nums text-teal-900">{{ '$' + totalNetoSaldo }}</span>
            </div>
          </div>
          <div class="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800">
            <app-compact-inline-stats
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
        class="mb-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 shadow-sm">
        <app-compact-inline-stats
          variant="strip"
          [items]="cashKpiItems"
          [centerCaption]="kpiPeriodMonthLabel"
          ariaLabel="Indicadores del mes y saldo acumulado">
        </app-compact-inline-stats>
      </div>

      <app-compact-data-list [showSearch]="true">
        <div listSearch [class]="desktopListSearchWrapClass">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div class="min-w-0 w-full sm:flex-1 sm:max-w-xl">
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
            <select
              [(ngModel)]="origenFilter"
              (ngModelChange)="movementsPage = 1"
              name="origenFilter"
              [class]="'hidden sm:block shrink-0 px-3 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 ' + listToolbarControlHeight">
              <option value="all">Orígenes</option>
              <option *ngFor="let origen of cashOrigenes" [value]="origen.grupo">
                {{ origen.nombre }}
              </option>
            </select>
          </div>
        </div>
        <div listMobile [class]="'sm:hidden ' + nativeCompactListClass">
          <div
            *ngFor="let movement of paginatedFilteredMovements"
            [class]="compactListRowClass + ' cursor-default hover:bg-gray-50 active:bg-gray-100'">
            <button
              type="button"
              class="min-w-0 flex-1 overflow-hidden text-left border-0 bg-transparent p-0 cursor-pointer"
              (click)="onMovementRowClick(movement)">
              <div class="compact-list-title truncate">
                <app-concept-ref-links
                  [text]="movement.concepto"
                  [pedidoId]="movement.pedidoId"
                  [ventaId]="movement.ventaId"
                  [numeroPedidoLabel]="getOrderNumberLabel(movement)"
                  [ventaLabel]="movement.ventaLabel">
                </app-concept-ref-links>
              </div>
              <div class="compact-list-subtitle truncate">
                {{ formatDate(movement.fecha) }} · {{ getOrigenLabel(movement) }} · {{ movement.medio || '—' }}
              </div>
            </button>
            <span
              class="text-[11px] font-bold tabular-nums shrink-0 pl-1"
              [class.text-teal-600]="movement.tipo === 'ingreso'"
              [class.text-red-500]="movement.tipo === 'egreso'">
              {{ movement.tipo === 'egreso' ? '-' : '+' }}{{ '$' + (movement.monto || 0) }}
            </span>
            <app-list-row-actions
              *ngIf="showMovementRowActions"
              [showDuplicate]="auth.canEditRecords"
              [showEdit]="auth.canEditRecords"
              [showDelete]="canDeleteCashAsAdmin"
              (duplicateClick)="duplicateMovement(movement, $event)"
              (editClick)="openEditMovement(movement)"
              (deleteClick)="confirmDeleteMovement(movement)">
            </app-list-row-actions>
          </div>
          <p *ngIf="loading" [class]="compactListEmptyClass">Cargando movimientos...</p>
          <p *ngIf="!loading && movements.length === 0" [class]="compactListEmptyClass">
            Todavía no hay movimientos. Se registran al confirmar pedidos o manualmente desde arriba.
          </p>
          <p *ngIf="!loading && movements.length > 0 && filteredMovements.length === 0" [class]="compactListEmptyClass">
            No se encontraron movimientos con los filtros actuales.
          </p>
        </div>
        <div listDesktop class="hidden sm:block" [class]="tableScrollClass">
        <table [class]="nativeCompactTableClass + ' sm:min-w-[820px]'">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Concepto</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Origen</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Medio</th>
              <th class="px-4 sm:px-6 py-3 sm:py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Monto</th>
              <th class="hidden sm:table-cell px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr
              *ngFor="let movement of paginatedFilteredMovements"
              (click)="onMovementRowClick(movement)"
              [class]="listTableRowClass">
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                {{ formatDate(movement.fecha) }}
              </td>
              <td class="px-4 sm:px-6 py-3 sm:py-4">
                <div class="font-medium text-gray-900 text-sm">
                  <app-concept-ref-links
                    [text]="movement.concepto"
                    [pedidoId]="movement.pedidoId"
                    [ventaId]="movement.ventaId"
                    [numeroPedidoLabel]="getOrderNumberLabel(movement)"
                    [ventaLabel]="movement.ventaLabel">
                  </app-concept-ref-links>
                </div>
                <div class="text-xs text-gray-400 mt-0.5 sm:hidden">
                  {{ formatDate(movement.fecha) }} · {{ getOrigenLabel(movement) }} · {{ movement.medio || '—' }}
                </div>
              </td>
              <td class="hidden sm:table-cell px-6 py-4">
                <span
                  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                  [ngClass]="getOrigenBadgeClass(movement)">
                  {{ getOrigenLabel(movement) }}
                </span>
              </td>
              <td class="hidden sm:table-cell px-6 py-4 text-sm text-gray-500 capitalize">
                {{ movement.medio || '—' }}
              </td>
              <td
                class="px-4 sm:px-6 py-3 sm:py-4 text-sm font-semibold text-right tabular-nums"
                [class.text-teal-600]="movement.tipo === 'ingreso'"
                [class.text-red-500]="movement.tipo === 'egreso'">
                {{ movement.tipo === 'egreso' ? '-' : '+' }}{{ '$' + (movement.monto || 0) }}
              </td>
              <td class="hidden sm:table-cell px-4 py-3 text-sm font-medium whitespace-nowrap" (click)="$event.stopPropagation()">
                <app-list-row-actions
                  *ngIf="showMovementRowActions"
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
          [hasMore]="hasMoreMovements && !monthFilterRange"
          [loading]="loadingMoreMovements || loading"
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

        <div class="space-y-2.5 sm:space-y-3">
          <p
            *ngIf="movementSaveHint"
            class="text-[11px] sm:text-xs text-teal-800 bg-teal-50 border border-teal-100 rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2"
            role="status">
            {{ movementSaveHint }}
          </p>

          <div class="grid grid-cols-[minmax(0,1fr)_5.25rem] sm:grid-cols-[minmax(0,1fr)_8.5rem] gap-2 sm:gap-3">
            <div #movementConceptField>
              <label class="block text-xs font-medium text-gray-700 mb-0.5">
                {{ movementTipo === 'egreso' ? 'Gasto / concepto' : 'Concepto' }}
              </label>
              <app-searchable-select
                *ngIf="usesConceptList"
                [(ngModel)]="movementConcepto"
                (ngModelChange)="onMovementConceptoChange($event)"
                name="movementConcepto"
                [options]="conceptOptions"
                [allowCustomValue]="true"
                [placeholder]="movementConceptPickerPlaceholder"
                [plainPlaceholder]="movementConceptPlainPlaceholder">
              </app-searchable-select>
              <input
                *ngIf="!usesConceptList"
                #movementConceptoText
                [(ngModel)]="movementConcepto"
                name="movementConceptoText"
                placeholder="Ej. Venta mostrador"
                class="w-full px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-0.5">Monto</label>
              <input
                #movementMontoInput
                type="number"
                [(ngModel)]="movementMonto"
                name="movementMonto"
                min="1"
                step="1"
                placeholder="0"
                [disabled]="savingMovement"
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
            [disabled]="savingMovement">
          </app-transaction-date-field>

          <div
            class="grid gap-2 sm:gap-3 items-start"
            [ngClass]="usesAmbitoSeparation ? 'grid-cols-2' : 'grid-cols-1'">
            <div class="min-w-0">
              <span class="block text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Tipo</span>
              <div class="grid grid-cols-2 gap-1 rounded-lg sm:rounded-xl border border-gray-200 bg-gray-50 p-0.5 sm:p-1">
                <button
                  type="button"
                  (click)="setMovementTipo('ingreso')"
                  title="Ingreso"
                  aria-label="Ingreso"
                  class="inline-flex items-center justify-center gap-1 rounded-md sm:rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-sm font-semibold transition-colors min-h-[36px] sm:min-h-0"
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
                  title="Egreso"
                  aria-label="Egreso"
                  class="inline-flex items-center justify-center gap-1 rounded-md sm:rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-sm font-semibold transition-colors min-h-[36px] sm:min-h-0"
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
            <div *ngIf="usesAmbitoSeparation" class="min-w-0">
              <span class="block text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Ámbito</span>
              <div
                class="grid gap-1 sm:gap-1.5"
                [ngClass]="cajaAmbitos.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
                <button
                  *ngFor="let ambito of cajaAmbitos; trackBy: trackCajaAmbitoId"
                  type="button"
                  (click)="selectMovementAmbito(ambito.id, $event)"
                  [title]="ambito.label"
                  [attr.aria-pressed]="isMovementAmbitoSelected(ambito.id)"
                  class="inline-flex items-center justify-center rounded-md sm:rounded-lg border-2 px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium min-h-[36px] sm:min-h-0 truncate bg-white touch-manipulation select-none"
                  [ngClass]="
                    isMovementAmbitoSelected(ambito.id)
                      ? 'border-teal-500 bg-teal-50 text-teal-800 font-semibold'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  ">
                  {{ ambito.label }}
                </button>
              </div>
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-gray-700 mb-0.5">
              <span class="sm:hidden">Medio</span>
              <span class="hidden sm:inline">Medio de pago</span>
            </label>
            <select
              [(ngModel)]="movementMedio"
              name="movementMedio"
              class="w-full px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-gray-700 mb-0.5">Descripción (opcional)</label>
            <textarea
              [(ngModel)]="movementDescripcion"
              name="movementDescripcion"
              rows="2"
              placeholder="Detalle adicional del movimiento..."
              [disabled]="savingMovement"
              class="w-full px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 resize-y min-h-[2.5rem]"></textarea>
          </div>
        </div>

        <div class="form-actions mt-4 sm:mt-5 pt-2 border-t border-gray-100 sm:border-0">
          <p *ngIf="!editingMovementId" class="hidden sm:block text-xs text-gray-500 mb-3">
            Al guardar, la ventana queda abierta para cargar otro movimiento.
          </p>
          <div class="flex items-center gap-2">
            <app-record-action-toolbar
              [showDuplicate]="canDuplicateInModal"
              duplicateLabel="Duplicar"
              [duplicateDisabled]="savingMovement"
              (duplicateClick)="duplicateMovementInModal()"
              [showDelete]="canDeleteInModal"
              deleteLabel="Eliminar"
              [deleteDisabled]="savingMovement"
              (deleteClick)="confirmDeleteEditingMovement()">
            </app-record-action-toolbar>
            <div class="flex-1 min-w-0"></div>
            <button type="button" (click)="closeMovementModal()" [class]="formCancelClass + ' hidden sm:inline-flex'">
              Cerrar
            </button>
            <button
              type="button"
              [disabled]="savingMovement"
              [class]="movementModalPrimaryButtonClass + ' min-h-[42px] min-w-[42px] sm:min-w-0 px-2.5 sm:px-5'"
              [attr.title]="movementModalPrimaryLabelLong"
              [attr.aria-label]="movementModalPrimaryLabelLong"
              (click)="submitMovement()">
              <span *ngIf="savingMovement" class="hidden sm:inline">Guardando...</span>
              <i-lucide *ngIf="savingMovement" name="clock" class="w-5 h-5 sm:hidden animate-pulse"></i-lucide>
              <ng-container *ngIf="!savingMovement">
                <i-lucide name="check" class="w-5 h-5 sm:hidden"></i-lucide>
                <span class="hidden sm:inline">{{ movementModalPrimaryLabelLong }}</span>
              </ng-container>
            </button>
          </div>
        </div>
    </app-transaction-modal>
  `,
})
export class CashComponent implements OnInit, OnDestroy {
  private static readonly OPENING_BALANCE_CONCEPT = 'Saldo inicial de caja';

  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly listToolbarControlHeight = LIST_TOOLBAR_CONTROL_HEIGHT;
  readonly desktopListSearchWrapClass = DESKTOP_LIST_SEARCH_WRAP_CLASS;
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
  private configSub?: Subscription;
  private routeSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  movements: CashMovement[] = [];
  cashSummary: CashSummary | null = null;
  monthFilterRange: CalendarMonthRange | null = null;
  searchQuery = '';
  movementsPage = 1;
  origenFilter: 'all' | string = 'all';
  activeAmbitoTab = '';
  loading = true;

  movementModalOpen = false;
  editingMovementId: string | null = null;
  movementTipo: 'ingreso' | 'egreso' = 'ingreso';
  movementConcepto = '';
  movementDescripcion = '';
  movementFecha = todayDateInputValue();
  movementHora = currentTimeInputValue();
  movementMonto: number | null = null;
  movementMedio = 'efectivo';
  movementAmbito = '';
  savingMovement = false;
  movementSaveHint: string | null = null;
  private movementSessionSavedCount = 0;
  hasMoreMovements = false;
  nextMovementsCursor: string | null = null;
  loadingMoreMovements = false;

  ngOnInit() {
    this.configSub = this.configService.appConfig$.subscribe((config) => {
      this.appConfig = config;
      this.syncActiveAmbitoTab();
    });
    this.configService.getAppConfig().subscribe();

    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      this.monthFilterRange = parseMonthYearQueryParams(
        params.get('mes'),
        params.get('anio')
      );
      this.movementsPage = 1;
      this.loadCashSummary();
      this.reloadMovements();
    });
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
    this.routeSub?.unsubscribe();
  }

  get monthFilterLabel(): string {
    if (!this.monthFilterRange) return '';
    return formatMonthYearLabel(this.monthFilterRange.label);
  }

  /** Mes al que corresponden Ing. y Egr. (mes actual o filtro de URL). */
  get kpiPeriodMonthLabel(): string {
    return formatMonthYearLabel(this.summaryPeriodRange.label);
  }

  get periodMovements(): CashMovement[] {
    if (!this.monthFilterRange) return this.movements;
    return this.movements.filter((movement) =>
      isIsoDateInRange(movement.fecha, this.monthFilterRange!.start, this.monthFilterRange!.end)
    );
  }

  clearMonthFilter() {
    this.router.navigate(['/cash']);
  }

  get cashOrigenes(): CajaOrigen[] {
    return getCashOrigenes(this.appConfig.caja.origenes);
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
      { label: 'Ing.', value: '$' + this.totalIngresos, tone: 'success' },
      { label: 'Egr.', value: '$' + this.totalEgresos, tone: 'danger' },
      { label: 'Saldo acum.', value: '$' + this.saldoCaja, alignEnd: true },
    ];
  }

  get activeAmbitoKpiItems(): CompactInlineStat[] {
    return [
      { label: 'Ing.', value: '$' + this.activeAmbitoIngresos, tone: 'success' },
      { label: 'Egr.', value: '$' + this.activeAmbitoEgresos, tone: 'danger' },
      { label: 'Saldo acum.', value: '$' + this.activeAmbitoSaldo, alignEnd: true },
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

    if (this.origenFilter !== 'all') {
      list = list.filter((movement) => this.resolveOrigenGrupo(movement) === this.origenFilter);
    }

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

  get canDuplicateInModal(): boolean {
    return this.auth.canEditRecords && this.movementModalOpen;
  }

  get editingMovement(): CashMovement | undefined {
    if (!this.editingMovementId) return undefined;
    return this.movements.find((movement) => movement.id === this.editingMovementId);
  }

  get canDeleteCashAsAdmin(): boolean {
    return this.auth.isPrivileged;
  }

  get showMovementRowActions(): boolean {
    return this.auth.canEditRecords || this.canDeleteCashAsAdmin;
  }

  get canDeleteInModal(): boolean {
    const movement = this.editingMovement;
    if (!movement || !this.canDeleteCashAsAdmin) return false;
    return this.isManualMovement(movement) && isDeletableCashMovement(movement);
  }

  get movementModalPrimaryButtonClass(): string {
    const base =
      'form-btn-primary rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60';
    return this.movementTipo === 'egreso'
      ? `${base} bg-red-500 hover:bg-red-600`
      : `${base} bg-teal-600 hover:bg-teal-700`;
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
    if (this.editingMovementId) return 'Editar';
    return 'Movimiento';
  }

  get movementModalSubtitle(): string {
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
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR');
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
    return resolveCashSummaryPeriodRange(this.monthFilterRange);
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

    this.cashService.getMovements().subscribe({
      next: (allMovements) => {
        const remote = this.findOpeningBalanceMovement(allMovements);
        if (remote) {
          this.openEditMovement(remote);
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
    if (this.movementAmbito === ambitoId) return;
    this.movementAmbito = ambitoId;
  }

  setMovementTipo(tipo: 'ingreso' | 'egreso') {
    if (this.movementTipo === tipo) return;
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
    if (!this.auth.canEditRecords) return;
    this.openEditMovement(movement);
  }

  openEditMovement(movement: CashMovement) {
    if (!movement.id) return;

    if (!this.isManualMovement(movement)) {
      this.dialogService.alert({
        title: 'Movimiento automático',
        message: 'Este movimiento se generó desde un pedido o venta. Para modificarlo, usá el enlace del pedido en el concepto.',
      });
      return;
    }

    this.editingMovementId = movement.id;
    this.movementTipo = movement.tipo;
    this.movementConcepto = movement.concepto ?? '';
    this.movementDescripcion = movement.descripcion ?? '';
    this.movementFecha = toDateInputValue(movement.fecha);
    this.movementHora = toTimeInputValue(movement.fecha);
    this.movementMonto = Number(movement.monto) || null;
    this.movementMedio = movement.medio || 'efectivo';
    this.movementAmbito = resolveCashAmbito(movement, this.appConfig);
    this.movementSaveHint = null;
    this.movementModalOpen = true;
  }

  closeMovementModal() {
    this.movementModalOpen = false;
    this.editingMovementId = null;
    this.movementSaveHint = null;
    this.movementSessionSavedCount = 0;
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

  private formatMoney(value?: number): string {
    return `$${Number(value) || 0}`;
  }

  submitMovement() {
    if (!this.auth.canEditRecords) {
      this.showEditPermissionAlert();
      return;
    }

    const monto = Number(this.movementMonto);
    const concepto = this.movementConcepto.trim();

    if (!concepto) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un concepto.',
      });
      return;
    }

    if (!monto || monto <= 0) {
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

    this.savingMovement = true;
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

    request.subscribe({
      next: (result) => {
        this.savingMovement = false;

        if (previousMovement) {
          this.applySummaryMovement(
            previousMovement.tipo,
            Number(previousMovement.monto) || 0,
            resolveCashAmbito(previousMovement, this.appConfig),
            -1
          );
        }

        const movementId = editingId ?? result.id;
        const localMovement = this.buildLocalMovement(movementId, {
          ...payload,
          ambito: ambitoForPayload,
        });
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
          this.closeMovementModal();
          return;
        }
        this.movementSessionSavedCount += 1;
        this.prepareNextMovementEntry();
      },
      error: (err) => {
        this.savingMovement = false;
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
    if (this.monthFilterRange) {
      this.loadAllMovements(showLoading);
      return;
    }
    this.loadMovements(showLoading);
  }

  private loadAllMovements(showLoading = true) {
    if (showLoading) this.loading = true;
    this.hasMoreMovements = false;
    this.nextMovementsCursor = null;
    this.cashService.getMovements().subscribe({
      next: (items) => {
        this.movements = items;
        if (showLoading) this.loading = false;
      },
      error: () => {
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

  private loadMovements(showLoading = true) {
    if (showLoading) this.loading = true;
    this.cashService.getMovementsPage(120).subscribe({
      next: (page) => {
        this.movements = page.items;
        this.hasMoreMovements = page.hasMore;
        this.nextMovementsCursor = page.nextCursor;
        if (showLoading) this.loading = false;
      },
      error: () => {
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
    }
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
      ambito,
      origenGrupo: 'manual',
      origenTipo: payload.tipo === 'egreso' ? 'caja_manual_egreso' : 'caja_manual_ingreso',
    };
  }

  private upsertLocalMovement(movement: CashMovement) {
    if (!movement.id) return;
    const without = this.movements.filter((item) => item.id !== movement.id);
    this.movements = [movement, ...without];
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
    this.cashService.getMovementsPage(120, this.nextMovementsCursor).subscribe({
      next: (page) => {
        this.movements = [...this.movements, ...page.items];
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
